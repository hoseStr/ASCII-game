// ---------------------------------------------------------------------------
// P1 · Capa pictórica: pinta la atmósfera como si fuera un fotograma de video.
// Resolución: (columnas · S) × (filas · S); S×S muestras por celda que la
// pasada de conversión promedia por bloque, igual que el conversor del repo.
// Lo estático (costa, acantilados, suelo) llega horneado en uTerrain/uGround;
// aquí solo se calcula lo que cambia: luz, estrellas, niebla y respiración.
// Salidas: color sRGB (puede superar 1 en luces) y material dominante + peso.
// ---------------------------------------------------------------------------

uniform vec2 uGrid;          // columnas, filas
uniform float uAspect;       // ancho / alto de la celda (mapeo mundo ↔ celda)
uniform float uSamples;      // S
uniform float uTime;
uniform vec2 uCam;           // desplazamiento de cámara para el parallax (unidades)
uniform sampler2D uTerrain;  // sdf, t acantilado, L acantilado, alfa suelo
uniform sampler2D uGround;   // OKLab del suelo, borde
uniform vec3 uPal[PAL_SIZE]; // paleta de zona en OKLab
uniform vec4 uLightPos[MAX_LIGHTS]; // xy, radio, sigma del núcleo visible
uniform vec4 uLightCol[MAX_LIGHTS]; // rgb lineal · intensidad, intensidad del núcleo
uniform int uLightCount;
uniform vec4 uCrystals[MAX_CRYSTALS]; // xy, tamaño, fase
uniform int uCrystalCount;
uniform vec4 uShoot;         // estrella fugaz: cabeza xy, dirección zw
uniform vec2 uShootT;        // intensidad (0 = no hay), largo de la cola
uniform float uAmbient;
uniform float uExposure;
uniform float uFog;
uniform float uBreath;
uniform int uOctaves;

layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oMat;

// Atenuación suave con ventana: inversa del cuadrado que llega a 0 en el radio.
float atten(float d, float r) {
  float x = d / r;
  float win = clamp(1.0 - x * x, 0.0, 1.0);
  return win * win / (1.0 + 9.0 * x * x);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec2 cellPos = gl_FragCoord.xy / uSamples; // (columna, fila) continuas; fila 0 arriba
  vec2 p = vec2(cellPos.x * uAspect, cellPos.y);   // unidades visuales isótropas
  vec2 cellSize = vec2(uAspect, 1.0);
  vec4 ter = texelFetch(uTerrain, px, 0);
  vec4 gr = texelFetch(uGround, px, 0);
  float sdf = ter.x;
  float groundA = ter.w;

  // --- luz -------------------------------------------------------------------
  // Ambiente: solo el tinte de la paleta (luminancia 1) por la intensidad de la zona.
  vec3 ambient = oklabToLinear(vec3(1.0, uPal[P_AMBIENT].yz)) * uAmbient;
  vec3 dynLight = vec3(0.0);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLightCount) break;
    vec4 lp = uLightPos[i];
    vec4 lc = uLightCol[i];
    vec2 dv = p - lp.xy;
    float d2 = dot(dv, dv);
    if (d2 < lp.z * lp.z) dynLight += lc.rgb * atten(sqrt(d2), lp.z);
    if (lp.w > 0.0) {
      // Núcleos pequeños (luciérnagas): centrados en su celda, para que sean un
      // único glifo que salta de celda en celda; su luz sobre el suelo es continua.
      vec2 dc = lp.w < 0.6 ? (p - (floor(lp.xy / cellSize) + 0.5) * cellSize) / cellSize : dv / lp.w;
      float k = lp.w < 0.6 ? 3.2 : 1.0;
      glow += lc.rgb * (lc.w * exp(-dot(dc, dc) * k));
    }
  }
  vec3 lightSum = ambient + dynLight;

  // --- vacío estelar con parallax ---------------------------------------------
  float vy = clamp(cellPos.y / uGrid.y, 0.0, 1.0);
  vec3 col = oklabToLinear(mix(uPal[P_VOID_TOP], uPal[P_VOID_BOTTOM], vy * vy * (3.0 - 2.0 * vy)));
  vec3 starLight = vec3(0.0);
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float size = 3.4 - fl * 0.9;
    vec2 shift = uCam * (0.25 + 0.35 * fl) + vec2(uTime * (0.025 + 0.02 * fl), 0.0);
    vec2 base = floor((p + shift) / size);
    vec4 h = hash42(ivec2(base) + ivec2(l * 7919, l * 104729));
    if (h.x < 0.3 - 0.06 * fl) {
      // posición de la estrella en el mundo → centro de su celda (un glifo por estrella)
      vec2 world = (base + 0.15 + 0.7 * h.yz) * size - shift;
      vec2 dc = (p - (floor(world / cellSize) + 0.5) * cellSize) / cellSize;
      float g = exp(-dot(dc, dc) * 3.2);
      float twinkle = 0.72 + 0.28 * sin(uTime * (0.5 + 2.4 * h.y) + 6.2831 * h.z);
      float bright = (0.14 + 2.4 * pow(h.w, 3.0)) * twinkle * (1.25 - 0.35 * fl);
      vec3 tint = h.y < 0.5 ? uPal[P_STAR_A] : (h.y < 0.8 ? uPal[P_STAR_B] : uPal[P_STAR_C]);
      starLight += oklabToLinear(tint) * g * bright * 1.8;
    }
  }
  // estrella fugaz
  if (uShootT.x > 0.0) {
    vec2 rel = p - uShoot.xy;
    float along = -dot(rel, uShoot.zw);
    float perp = length(rel + uShoot.zw * along);
    if (along > -0.8 && along < uShootT.y) {
      float tail = 1.0 - clamp(along / uShootT.y, 0.0, 1.0);
      starLight += oklabToLinear(uPal[P_STAR_A]) * (exp(-perp * perp / 0.06) * tail * tail * uShootT.x * 3.0);
    }
  }

  // --- acantilado y suelo (horneados) -------------------------------------------
  float cliffA = 0.0;
  if (ter.y >= 0.0) {
    vec3 lab = mix(uPal[P_CLIFF], uPal[P_CLIFF_DEEP], smoothstep(0.0, 1.0, ter.y));
    lab.x = ter.z;
    vec3 cliffCol = oklabToLinear(lab) * (0.95 * ambient + 0.9 * dynLight);
    cliffA = (1.0 - smoothstep(0.6, 1.0, ter.y)) * (1.0 - groundA);
    col = mix(col + starLight, cliffCol, cliffA);
  } else {
    col += starLight;
  }
  if (groundA > 0.0) {
    vec3 lab = mix(gr.xyz, uPal[P_RIM], gr.w * 0.55);
    col = mix(col, oklabToLinear(lab) * lightSum, groundA);
  }

  // Cristales: rombos que brillan con su propio pulso.
  float crystalW = 0.0;
  for (int i = 0; i < MAX_CRYSTALS; i++) {
    if (i >= uCrystalCount) break;
    vec4 c = uCrystals[i];
    vec2 d = p - c.xy;
    float shape = abs(d.x) / (0.55 * c.z) + abs(d.y + 0.25 * c.z) / (1.25 * c.z);
    float m = smoothstep(1.0, 0.75, shape);
    if (m > 0.0) {
      float glint = 0.75 + 0.25 * sin(uTime * 1.3 + c.w + d.y * 2.5);
      vec3 lab = uPal[P_CRYSTAL];
      lab.x = mix(lab.x * 0.9, 1.0, smoothstep(0.85, 0.2, shape) * 0.6);
      col = mix(col, oklabToLinear(lab) * (0.9 + 0.8 * glint), m);
      crystalW = max(crystalW, m);
    }
  }

  // Luz visible en el aire (núcleos de luciérnagas, halo de la princesa).
  col += glow;

  // --- niebla fbm que se desplaza, más densa en los bordes de las islas ---------
  vec3 fq = vec3(p * 0.075 + vec2(uTime * 0.021, uTime * 0.007), uTime * 0.017);
  float warp = fbm(fq * 1.7 + 3.1, 2);
  float fn = fbm(fq + warp * 0.85, uOctaves);
  float density = smoothstep(0.46, 0.82, fn);
  float edge = exp(-abs(sdf) / 2.4);
  float inside = smoothstep(-0.5, -5.0, sdf);
  float fogA = (density * 0.32 + edge * (0.12 + 0.45 * density)) * (1.0 - 0.8 * inside) * uFog;
  fogA = clamp(fogA, 0.0, 0.55);
  vec3 fogCol = oklabToLinear(uPal[P_FOG]) * (0.07 + 0.1 * ambient + 0.28 * dynLight);
  col = mix(col, fogCol, fogA);

  // --- respiración del mundo: la luminancia oscila con ruido lento -----------------
  col *= 1.0 + uBreath * gnoise(vec3(p * 0.05, uTime * 0.07));
  col *= uExposure;

  // --- material dominante ---------------------------------------------------------
  // El vacío y la niebla usan la rampa de niebla (puntos → sombreado); las letras
  // de la rampa del repo quedan para la roca.
  float wLight = luminance(glow + starLight * (1.0 - groundA) * (1.0 - cliffA)) * 4.0;
  float wMist = max(fogA * 3.0 * (1.0 - 0.75 * groundA), 0.05);
  float wVeg = groundA * 0.85;
  float wCrystal = crystalW * 2.0;
  float wBase = cliffA * 0.9;
  float best = wMist;
  float mat = float(MAT_MIST);
  if (wBase > best) { best = wBase; mat = float(MAT_BASE); }
  if (wVeg > best) { best = wVeg; mat = float(MAT_VEG); }
  if (wLight > best) { best = wLight; mat = float(MAT_LIGHT); }
  if (wCrystal > best) { best = wCrystal; mat = float(MAT_CRYSTAL); }

  oColor = vec4(linearToSrgb(col), 1.0);
  oMat = vec4(mat / 255.0, best / (1.0 + best), 0.0, 1.0);
}
