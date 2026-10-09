// ---------------------------------------------------------------------------
// P2 · Conversión a ASCII + composición, un fragmento por celda (160×54).
//
// Conversión (misma fórmula que el repo, ver render/ascii.ts):
//   color  = promedio del bloque S×S
//   L      = (R + G + B) / 3 · 255           (media sin pesos, sRGB)
//   índice = min(floor(L · N / 255), N − 1)
// Añadidos del juego (desactivables con el modo "fidelidad"):
//   suavizado temporal (EMA) + histéresis por celda contra el estado t−1,
//   rampa por material, ganancia de tinta y "fondo pintado" tenue.
// Después la capa semántica se impone y la pictórica se atenúa a su alrededor.
//
// Transiciones (solo en el área de juego, el HUD queda fijo):
//   1 · deslizamiento: la sala vieja (instantánea) sale y la nueva entra; los
//       glifos se desordenan recorriendo su rampa y se reordenan al llegar.
//   2 · derretido: las columnas de la sala vieja caen y descubren la nueva.
// ---------------------------------------------------------------------------

uniform highp sampler2D uPict;   // RGBA16F, color de la capa pictórica
uniform highp sampler2D uMat;    // RGBA8, material + peso
uniform highp sampler2D uPrev;   // estado t−1: L suavizada, índice, material, válido
uniform highp usampler2D uSem;   // RG16UI: glifo, flags
uniform highp sampler2D uSemFg;  // RGBA8
uniform highp sampler2D uSemBg;  // RGBA8 (a = opacidad del fondo semántico)
uniform highp usampler2D uRamps; // R16UI: fila = material, columna = posición en la rampa
uniform int uRampLen[MAT_COUNT];
uniform int uS;
uniform int uInk;            // 1 = sentido del repo (más luz → glifo más ralo)
uniform float uTemporalK;    // 1 = sin suavizado
uniform float uHyst;         // histéresis en escalones de rampa (0 = ninguna)
uniform int uReset;          // 1 = ignorar el estado anterior
uniform int uLegibility;     // 1 = ocultar la capa pictórica
uniform float uInkGain;
uniform float uBgFill;
uniform vec3 uPaper;
uniform float uClearance;
// transiciones
uniform int uTransMode;      // 0 ninguna, 1 deslizamiento, 2 derretido
uniform float uTransT;       // progreso suavizado 0..1
uniform ivec2 uTransDir;     // dirección de la cámara: (1,0) = hacia el este
uniform int uPlayTop;        // primera fila del área de juego
uniform int uFrame;
uniform highp sampler2D uSnapFg;
uniform highp sampler2D uSnapBg;
uniform highp sampler2D uSnapGlyph;
uniform highp sampler2D uSnapState;
// contornos de tinta
uniform highp sampler2D uTerrainTex; // .x = SDF de la costa (negativo dentro de la isla)
uniform highp sampler2D uExtraTex;   // .w = SDF de los obstáculos (negativo dentro)
uniform int uEdges;                  // 1 = dibujar contornos
// piezas de escenario: fotos convertidas TAL CUAL (ver render/propLayer.ts)
uniform highp usampler2D uPropRgb;   // bytes reales de la foto (RGBA8UI), 4 muestras por celda
uniform uint uEdgeGlyph[4];          // ─ │ / \

layout(location = 0) out vec4 oFg;    // rgb, emisividad (bloom)
layout(location = 1) out vec4 oBg;
layout(location = 2) out vec4 oGlyph; // índice de glifo en 2 bytes, ¿semántica?
layout(location = 3) out vec4 oState;

uint rampGlyph(int mat, int idx) {
  int n = uRampLen[mat];
  int ri = uInk == 1 ? n - 1 - idx : idx;
  return texelFetch(uRamps, ivec2(clamp(ri, 0, n - 1), mat), 0).r;
}

// Desorden de transición: desplaza el índice dentro de la rampa del material.
int scrambleIdx(int idx, int mat, ivec2 cell, float amount) {
  if (amount <= 0.0) return idx;
  int n = uRampLen[mat];
  float h = hash12(cell + ivec2(uFrame / 3 * 17, uFrame / 3 * 5)) - 0.5;
  return clamp(idx + int(round(h * 2.0 * amount * float(n) * 0.7)), 0, n - 1);
}

// SDF por celda (muestra central del bloque pictórico).
float obstacleAt(ivec2 c, ivec2 gridSize) {
  c = clamp(c, ivec2(0), gridSize - 1);
  return texelFetch(uExtraTex, c * uS + uS / 2, 0).w;
}
float coastAt(ivec2 c, ivec2 gridSize) {
  c = clamp(c, ivec2(0), gridSize - 1);
  return texelFetch(uTerrainTex, c * uS + uS / 2, 0).x;
}

// Glifo de contorno según la orientación del borde (perpendicular al gradiente), corregida por el aspecto
// de la celda: ─ │ / \.
uint edgeGlyph(float l, float r, float u, float d) {
  vec2 g = vec2((r - l) / CELL_W_UNITS, d - u);
  float ax = abs(g.x);
  float ay = abs(g.y);
  if (ay < ax * 0.42) return uEdgeGlyph[1];
  if (ax < ay * 0.42) return uEdgeGlyph[0];
  return g.x * g.y > 0.0 ? uEdgeGlyph[2] : uEdgeGlyph[3];
}

float sdfAt(ivec2 c, ivec2 gridSize, int which) {
  return which == 0 ? obstacleAt(c, gridSize) : coastAt(c, gridSize);
}

vec3 pictAt(ivec2 c) {
  return clamp(texelFetch(uPict, c * uS + uS / 2, 0).rgb, 0.0, 1.0);
}

// Contorno de una celda de grosor: entre dos celdas vecinas con distinto signo,
// la línea va en la más cercana al borde real (de dentro o de fuera). `inner`
// devuelve la celda interior del par (de ella se toma el color).
bool contour(ivec2 src, ivec2 gridSize, int which, out uint glyph, out ivec2 inner) {
  float d0 = sdfAt(src, gridSize, which);
  float l = sdfAt(src + ivec2(-1, 0), gridSize, which);
  float r = sdfAt(src + ivec2(1, 0), gridSize, which);
  float u = sdfAt(src + ivec2(0, -1), gridSize, which);
  float d = sdfAt(src + ivec2(0, 1), gridSize, which);
  bool in0 = d0 < 0.0;
  inner = src;
  bool hit = false;
  if ((l < 0.0) != in0 && abs(d0) <= abs(l)) { hit = true; if (!in0) inner = src + ivec2(-1, 0); }
  if ((r < 0.0) != in0 && abs(d0) <= abs(r)) { hit = true; if (!in0) inner = src + ivec2(1, 0); }
  if ((u < 0.0) != in0 && abs(d0) <= abs(u)) { hit = true; if (!in0) inner = src + ivec2(0, -1); }
  if ((d < 0.0) != in0 && abs(d0) <= abs(d)) { hit = true; if (!in0) inner = src + ivec2(0, 1); }
  glyph = edgeGlyph(l, r, u, d);
  return hit;
}

vec4 glyphOut(uint glyph, float semantic) {
  return vec4(float(glyph & 255u) / 255.0, float(glyph >> 8u) / 255.0, semantic, 1.0);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  ivec2 gridSize = textureSize(uSem, 0);

  // --- transición: ¿de dónde sale esta celda? -------------------------------------
  ivec2 src = cell;
  bool fromSnap = false;
  float scramble = 0.0;
  if (uTransMode != 0 && cell.y >= uPlayTop) {
    ivec2 play = ivec2(gridSize.x, gridSize.y - uPlayTop);
    if (uTransMode == 1) {
      ivec2 shift = ivec2(round(vec2(uTransDir) * uTransT * vec2(play)));
      ivec2 o = cell + shift;
      if (o.x >= 0 && o.x < gridSize.x && o.y >= uPlayTop && o.y < gridSize.y) {
        src = o;
        fromSnap = true;
      } else {
        src = o - uTransDir * play;
      }
      // el desorden es máximo a mitad de camino y crece cerca de la costura
      scramble = sin(3.14159 * uTransT) * (0.55 + 0.45 * hash12(cell + ivec2(3, 1)));
    } else {
      float delay = hash12(ivec2(cell.x, 777)) * 0.35 + 0.08 * sin(float(cell.x) * 0.21);
      float fall = max(0.0, uTransT * 1.5 - delay);
      int drop = int(fall * fall * float(play.y) * 1.25);
      ivec2 o = cell - ivec2(0, drop);
      if (o.y >= uPlayTop && drop < play.y) {
        src = o;
        fromSnap = true;
        scramble = clamp(fall * 1.5, 0.0, 1.0);
      } else {
        scramble = 1.0 - uTransT;
      }
    }
  }

  if (fromSnap) {
    vec4 sg = texelFetch(uSnapGlyph, src, 0);
    vec4 sf = texelFetch(uSnapFg, src, 0);
    vec4 st = texelFetch(uSnapState, src, 0);
    uint glyph = uint(sg.r * 255.0 + 0.5) + 256u * uint(sg.g * 255.0 + 0.5);
    if (sg.b < 0.5 && uLegibility == 0) {
      int mat = int(st.b + 0.5);
      glyph = rampGlyph(mat, scrambleIdx(int(st.g + 0.5), mat, cell, scramble));
    }
    oFg = sf;
    oBg = texelFetch(uSnapBg, src, 0);
    oGlyph = glyphOut(glyph, sg.b);
    oState = vec4(0.0);
    return;
  }

  // --- promedio del bloque (igual que el repo) y material de mayor peso -----------
  vec3 sum = vec3(0.0);
  float bestW = -1.0;
  int mat = 0;
  for (int y = 0; y < uS; y++) {
    for (int x = 0; x < uS; x++) {
      ivec2 q = src * uS + ivec2(x, y);
      sum += texelFetch(uPict, q, 0).rgb;
      vec4 m = texelFetch(uMat, q, 0);
      if (m.g > bestW) { bestW = m.g; mat = int(m.r * 255.0 + 0.5); }
    }
  }
  vec3 avg = sum / float(uS * uS);
  vec3 avgc = clamp(avg, 0.0, 1.0);
  float L = (avgc.r + avgc.g + avgc.b) / 3.0 * 255.0;

  // Zona de despeje alrededor de entidades (contraste garantizado).
  float clear = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      ivec2 q = clamp(src + ivec2(dx, dy), ivec2(0), gridSize - 1);
      uint f = texelFetch(uSem, q, 0).g;
      if ((f & FLAG_CLEAR) != 0u) {
        float w = 1.0 - 0.22 * float(abs(dx)) - 0.3 * float(abs(dy));
        clear = max(clear, w);
      }
    }
  }
  L *= 1.0 - uClearance * clear;

  // Estabilidad temporal: EMA de la luminancia + histéresis del índice.
  vec4 prev = texelFetch(uPrev, cell, 0);
  bool sameMat = uReset == 0 && uTransMode == 0 && prev.a > 0.5 && int(prev.b + 0.5) == mat;
  float Ls = sameMat ? mix(prev.r, L, uTemporalK) : L;
  int n = uRampLen[mat];
  float t = Ls * float(n) / 255.0;
  int idx = min(int(floor(t)), n - 1);
  if (sameMat && uHyst > 0.0) {
    int pIdx = int(prev.g + 0.5);
    if (t >= float(pIdx) - uHyst && t < float(pIdx + 1) + uHyst) idx = pIdx;
  }
  uint glyph = rampGlyph(mat, scrambleIdx(idx, mat, cell, scramble));

  // El despeje vacía de glifos el entorno de la entidad, pero conserva el fondo
  // pintado: alrededor de una luz no queda un hueco oscuro, sino su resplandor.
  vec3 fg = clamp(avgc * uInkGain, 0.0, 1.0) * (1.0 - 0.45 * uClearance * clear);
  vec3 bg = uPaper + avgc * uBgFill * (1.0 + 0.6 * clear);
  float lum = luminance(avg);
  float emissive = smoothstep(0.45, 1.1, lum);

  // --- piezas de escenario: la foto convertida a ASCII tal cual -------------------------
  // Algoritmo del repo sobre los colores REALES de la foto (sin tinte, luz, niebla,
  // respiración, contornos ni bloom): color = promedio de las muestras cubiertas,
  // L = (R + G + B) / 3, índice = min(floor(L·N/255), N−1) en la rampa de 70.
  // Aritmética entera (bytes de la foto): el resultado es idéntico al de la CPU.
  uvec3 pSumCA = uvec3(0u); // suma de color · alfa
  uint pSumA = 0u;          // suma de alfa
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      uvec4 v = texelFetch(uPropRgb, src * 4 + ivec2(x, y), 0);
      pSumCA += v.rgb * v.a;
      pSumA += v.a;
    }
  }
  // la celda es parte de la pieza si la silueta de la foto cubre al menos la mitad
  bool pure = pSumA * 2u >= 16u * 255u;
  bool noBloom = false;
  if (pure && uLegibility == 0) {
    // color del bloque en 8 bits (como los píxeles del repo) e índice con enteros:
    // idx = min(floor((R+G+B)/3 · N / 255), N−1) sin errores de redondeo de coma flotante
    ivec3 c8 = ivec3((2u * pSumCA + pSumA) / (2u * pSumA)); // color: floor(suma(c·a)/suma(a) + 0,5)
    vec3 pc = vec3(c8) / 255.0;
    // índice con la media EXACTA de los píxeles (np.mean del repo), en enteros:
    // floor(suma(c·a) · N / (3 · 255 · suma(a)))
    uint pAll = pSumCA.r + pSumCA.g + pSumCA.b;
    float pL = float(pAll) / (3.0 * float(pSumA));
    int pn = uRampLen[MAT_BASE];
    int pIdx = min(int(pAll * uint(pn) / (765u * pSumA)), pn - 1);
    mat = MAT_BASE;
    idx = pIdx;
    Ls = pL;
    glyph = rampGlyph(MAT_BASE, scrambleIdx(pIdx, MAT_BASE, cell, scramble));
    fg = pc;
    // el fondo de la celda es el del entorno: la pieza no lleva caja ni marco
    emissive = 0.0;
    noBloom = true;
  }
  bool pureProp = pure;

  // Contornos de tinta: obstáculos (fuerte) y costa de la isla (suave). Nunca sobre una pieza.
  if (uEdges == 1 && !pureProp) {
    ivec2 inner;
    uint eg;
    if (contour(src, gridSize, 0, eg, inner)) {
      glyph = eg;
      fg = clamp(pictAt(inner) * uInkGain * 1.45 + 0.07, 0.0, 1.0);
    } else if (texelFetch(uExtraTex, src * uS + uS / 2, 0).x >= 0.0 && contour(src, gridSize, 1, eg, inner)) {
      glyph = eg;
      fg = clamp(pictAt(inner) * uInkGain * 1.15 + 0.04, 0.0, 1.0);
    }
  }

  if (uLegibility == 1) {
    glyph = 0u;
    bg = uPaper;
    emissive = 0.0;
  }

  // Capa semántica encima.
  uvec2 sem = texelFetch(uSem, src, 0).rg;
  float isSem = 0.0;
  if ((sem.y & FLAG_OCCUPIED) != 0u) {
    vec4 sf = texelFetch(uSemFg, src, 0);
    vec4 sb = texelFetch(uSemBg, src, 0);
    glyph = sem.x;
    fg = sf.rgb;
    bg = mix(bg, sb.rgb, sb.a);
    emissive = (sem.y & FLAG_EMISSIVE) != 0u ? sf.a : 0.0;
    isSem = 1.0;
  }

  oFg = vec4(fg, emissive);
  // a = 0: celda excluida del bloom (piezas de escenario puras)
  oBg = vec4(bg, noBloom && isSem < 0.5 ? 0.0 : 1.0);
  oGlyph = glyphOut(glyph, isSem);
  oState = vec4(Ls, float(idx), float(mat), 1.0);
}
