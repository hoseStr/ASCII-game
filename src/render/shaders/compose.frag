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

layout(location = 0) out vec4 oFg;    // rgb, emisividad (bloom)
layout(location = 1) out vec4 oBg;
layout(location = 2) out vec4 oGlyph; // índice de glifo en 2 bytes
layout(location = 3) out vec4 oState;

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  ivec2 gridSize = textureSize(uSem, 0);

  // Promedio del bloque (igual que el repo) y material de mayor peso.
  vec3 sum = vec3(0.0);
  float bestW = -1.0;
  int mat = 0;
  for (int y = 0; y < 4; y++) {
    if (y >= uS) break;
    for (int x = 0; x < 4; x++) {
      if (x >= uS) break;
      ivec2 q = cell * uS + ivec2(x, y);
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
      ivec2 q = clamp(cell + ivec2(dx, dy), ivec2(0), gridSize - 1);
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
  bool sameMat = uReset == 0 && prev.a > 0.5 && int(prev.b + 0.5) == mat;
  float Ls = sameMat ? mix(prev.r, L, uTemporalK) : L;
  int n = uRampLen[mat];
  float t = Ls * float(n) / 255.0;
  int idx = min(int(floor(t)), n - 1);
  if (sameMat && uHyst > 0.0) {
    int pIdx = int(prev.g + 0.5);
    if (t >= float(pIdx) - uHyst && t < float(pIdx + 1) + uHyst) idx = pIdx;
  }
  int ri = uInk == 1 ? n - 1 - idx : idx;
  uint glyph = texelFetch(uRamps, ivec2(ri, mat), 0).r;

  // El despeje vacía de glifos el entorno de la entidad, pero conserva el fondo
  // pintado: alrededor de una luz no queda un hueco oscuro, sino su resplandor.
  vec3 fg = clamp(avgc * uInkGain, 0.0, 1.0) * (1.0 - 0.45 * uClearance * clear);
  vec3 bg = uPaper + avgc * uBgFill * (1.0 + 0.6 * clear);
  float lum = luminance(avg);
  float emissive = smoothstep(0.45, 1.1, lum);

  if (uLegibility == 1) {
    glyph = 0u;
    bg = uPaper;
    emissive = 0.0;
  }

  // Capa semántica encima.
  uvec2 sem = texelFetch(uSem, cell, 0).rg;
  if ((sem.y & FLAG_OCCUPIED) != 0u) {
    vec4 sf = texelFetch(uSemFg, cell, 0);
    vec4 sb = texelFetch(uSemBg, cell, 0);
    glyph = sem.x;
    fg = sf.rgb;
    bg = mix(bg, sb.rgb, sb.a);
    emissive = (sem.y & FLAG_EMISSIVE) != 0u ? sf.a : 0.0;
  }

  oFg = vec4(fg, emissive);
  oBg = vec4(bg, 1.0);
  oGlyph = vec4(float(glyph & 255u) / 255.0, float(glyph >> 8u) / 255.0, 0.0, 1.0);
  oState = vec4(Ls, float(idx), float(mat), 1.0);
}
