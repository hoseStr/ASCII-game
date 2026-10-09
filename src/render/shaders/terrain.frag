// ---------------------------------------------------------------------------
// P0 · Horneado del terreno (una vez por sala, paleta o calidad): todo lo
// estático de la capa pictórica, a su misma resolución, a partir del tilemap.
// La pasada por fotograma solo añade lo que cambia (luz, agua, niebla, cielo).
//
// Salida 0: sdf de la isla deshilachado, t del acantilado (<0 = no hay), L del acantilado, alfa del suelo
// Salida 1: albedo en OKLab (L, a, b), tipo de superficie (K_*)
// Salida 2: borde plateado, sombra (1 = sin sombra), profundidad del agua, —
// ---------------------------------------------------------------------------

uniform vec2 uGrid;
uniform float uSamples;
uniform float uAspect;
uniform sampler2D uField;
uniform highp usampler2D uTiles;   // id de tile por tile de pantalla (32×18)
uniform vec3 uPal[PAL_SIZE];
uniform int uOctaves;
uniform int uCliffSteps;   // 48 · límites uniform: bucles reales en D3D (compilación rápida)
uniform int uOne;          // 1: radio de las vecindades 3×3

layout(location = 0) out vec4 oTerrain;
layout(location = 1) out vec4 oSurface;
layout(location = 2) out vec4 oExtra;

// LOD explícito: sin derivadas implícitas, el compilador D3D no está obligado a
// desenrollar los bucles que llaman a esta función (compilación mucho más rápida).
float fieldAt(vec2 cellPos) { return textureLod(uField, cellPos / uGrid, 0.0).r; }

uint tileAt(ivec2 t) {
  if (t.x < 0 || t.y < 0 || t.x >= TILES_W || t.y >= TILES_H) return T_VOID;
  return texelFetch(uTiles, t, 0).r;
}

// Costa orgánica: deformación de baja frecuencia + detalle fino.
float islandSdf(vec2 cellPos) {
  vec2 p = vec2(cellPos.x * uAspect, cellPos.y);
  float warp = (fbm(vec3(p * 0.085, 3.7), 3) - 0.5) * 3.6 + (fbm(vec3(p * 0.42, 8.1), 2) - 0.5) * 1.1;
  return fieldAt(cellPos) + warp;
}

float boxDist(vec2 p, vec2 c, float h) {
  vec2 d = abs(p - c) - vec2(h);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// SDF de la unión de los tiles de un tipo en la vecindad 3×3 (cajas redondeadas).
float typeSdf(vec2 p, uint type, float shrink, float round) {
  ivec2 tc = ivec2(floor(p / TILE_U));
  float d = 1e3;
  for (int j = -uOne; j <= uOne; j++) {
    for (int i = -uOne; i <= uOne; i++) {
      ivec2 t = tc + ivec2(i, j);
      if (tileAt(t) == type) d = min(d, boxDist(p, (vec2(t) + 0.5) * TILE_U, 0.5 * TILE_U - shrink) - round);
    }
  }
  return d;
}

void main() {
  vec2 cellPos = gl_FragCoord.xy / uSamples;
  vec2 p = vec2(cellPos.x * uAspect, cellPos.y);
  float sdf = islandSdf(cellPos);
  float groundA = smoothstep(0.3, -0.3, sdf);

  // --- acantilado colgante (cono invertido) ---------------------------------------
  float cliffT = -1.0;
  float cliffL = 0.0;
  if (sdf > -0.3 && sdf < 14.0) {
    float colHash = hash12(ivec2(floor(cellPos.x), 911));
    float maxDepth = 4.0 + 6.0 * fbm(vec3(p.x * 0.3, 0.0, 7.7), 2) + 4.0 * pow(colHash, 5.0);
    for (int k = 1; k <= uCliffSteps; k++) {
      float dy = float(k) * 0.25;
      if (dy > maxDepth) break;
      if (islandSdf(cellPos - vec2(0.0, dy)) < 0.0) {
        float thickness = -islandSdf(cellPos - vec2(0.0, dy + 6.0));
        float depthHere = maxDepth * smoothstep(0.0, 6.0, thickness);
        if (dy <= depthHere) cliffT = dy / max(depthHere, 1e-3);
        break;
      }
    }
    if (cliffT >= 0.0) {
      float strata = fbm(vec3(p.x * 2.2, p.y * 0.16, 4.2), 3);
      vec3 lab = mix(uPal[P_CLIFF], uPal[P_CLIFF_DEEP], smoothstep(0.0, 1.0, cliffT));
      cliffL = lab.x + (strata - 0.5) * 0.24 + 0.1 * (1.0 - smoothstep(0.0, 0.22, cliffT));
    }
  }

  // --- suelo base: musgo con manchas, grano fino y matas ---------------------------
  float nA = fbm(vec3(p * 0.1, 1.3), uOctaves);
  float nB = fbm(vec3(p * 0.3 + 5.0, 2.1), max(uOctaves - 1, 1));
  float nC = fbm(vec3(p * 0.95, 11.0), 2);
  vec3 lab = mix(uPal[P_GROUND_DEEP], uPal[P_GROUND], smoothstep(0.3, 0.7, nA));
  lab = mix(lab, uPal[P_MOSS], smoothstep(0.5, 0.74, nB) * 0.9);
  lab.x += (nC - 0.5) * 0.22;
  float tuft = smoothstep(0.64, 0.84, fbm(vec3(p * 1.6, 9.0), 2));
  lab.x += tuft * 0.14;
  float kind = float(K_GROUND);
  float rim = smoothstep(-1.6, -0.15, sdf);
  float shadow = 1.0;
  float waterDepth = 0.0;
  float edgeNoise = (fbm(vec3(p * 0.7, 21.0), 2) - 0.5);

  // --- caminos ----------------------------------------------------------------------
  float pathD = typeSdf(p, T_PATH, 0.55, 0.5) + edgeNoise * 0.7;
  if (pathD < 0.0) {
    lab = mix(lab, uPal[P_PATH], 0.85);
    lab.x += (nC - 0.5) * 0.12;
    kind = float(K_PATH);
  }

  // --- flores: manchas de color sobre el suelo ------------------------------------
  if (tileAt(ivec2(floor(p / TILE_U))) == T_FLOWERS) {
    ivec2 cell = ivec2(floor(cellPos));
    float hf = hash12(cell + ivec2(31, 77));
    if (hf < 0.42) {
      lab = mix(uPal[P_FLOWER], uPal[P_FLOWER_B], step(0.5, hash12(cell + ivec2(5, 9))));
      lab.x -= hash12(cell) * 0.12;
      kind = float(K_FLOWER);
    } else {
      lab.x += 0.05;
    }
  }

  // --- agua: lagos de borde redondeado y orilla de arena --------------------------
  float waterD = typeSdf(p, T_WATER, -0.35, 0.9) + edgeNoise * 0.9;
  if (waterD < 0.0) {
    kind = float(K_WATER);
    waterDepth = -waterD;
  } else if (waterD < 1.1 && groundA > 0.0) {
    float s = smoothstep(1.1, 0.2, waterD);
    lab = mix(lab, uPal[P_SHORE], s * 0.9);
    if (s > 0.5) kind = float(K_SHORE);
  }

  // --- rocas: bloques en vista 3/4 (cara superior clara, frente oscuro con estratos) ---
  float rockD = typeSdf(p, T_ROCK, 0.15, 0.45) + edgeNoise * 0.5;
  if (rockD < 0.0) {
    float below = typeSdf(p + vec2(0.0, 1.3), T_ROCK, 0.15, 0.45) + edgeNoise * 0.5;
    float strata = fbm(vec3(p.x * 1.8, p.y * 0.3, 13.0), 3);
    if (below > 0.0) {
      lab = mix(uPal[P_ROCK_FRONT], uPal[P_CLIFF_DEEP], 0.25 + 0.3 * smoothstep(-1.3, 0.0, -below));
      lab.x += (strata - 0.5) * 0.2;
      kind = float(K_ROCK_FRONT);
    } else {
      lab = uPal[P_ROCK];
      lab.x += (fbm(vec3(p * 0.9, 17.0), 3) - 0.5) * 0.18 - 0.1 * smoothstep(-0.8, 0.0, rockD);
      kind = float(K_ROCK);
    }
  } else if (rockD < 1.2) {
    shadow = min(shadow, 0.55 + 0.45 * smoothstep(0.0, 1.2, rockD)); // contacto con el suelo
  }

  // --- árboles: copa redonda sobre el tile, tronco y sombra al sureste ----------------
  ivec2 tc = ivec2(floor(p / TILE_U));
  float canopyD = 1e3;
  vec2 canopyC = vec2(0.0);
  float canopyR = 1.0;
  for (int j = -uOne; j <= uOne; j++) {
    for (int i = -uOne; i <= uOne; i++) {
      ivec2 t = tc + ivec2(i, j);
      if (tileAt(t) != T_TREE) continue;
      vec2 c = (vec2(t) + 0.5) * TILE_U + vec2((hash12(t) - 0.5) * 0.6, -0.9);
      float r = 1.95 + 0.4 * hash12(t + ivec2(7, 3));
      // sombra proyectada
      vec2 sd = (p - c - vec2(0.9, 2.2)) / vec2(2.2, 1.3);
      shadow = min(shadow, 0.5 + 0.5 * smoothstep(0.6, 1.1, length(sd)));
      // tronco
      if (abs(p.x - c.x) < 0.42 && p.y > c.y + 0.6 && p.y < c.y + 2.4) {
        lab = uPal[P_TRUNK];
        lab.x += (hash12(ivec2(floor(cellPos))) - 0.5) * 0.08;
        kind = float(K_TRUNK);
      }
      float d = length((p - c) * vec2(1.0, 1.08)) - r;
      if (d < canopyD) {
        canopyD = d;
        canopyC = c;
        canopyR = r;
      }
    }
  }
  canopyD += (fbm(vec3(p * 1.3, 27.0), 2) - 0.5) * 0.9;
  if (canopyD < 0.0) {
    vec2 n = (p - canopyC) / canopyR;
    float lit = clamp(0.55 - 0.5 * dot(n, normalize(vec2(0.6, 0.8))), 0.0, 1.0);
    float leaves = fbm(vec3(p * 1.1, 33.0), 3);
    lab = mix(uPal[P_CANOPY_DARK], uPal[P_CANOPY], clamp(lit * 0.7 + (leaves - 0.5) * 0.8 + 0.3, 0.0, 1.0));
    lab.x *= mix(0.55, 1.0, smoothstep(0.0, 0.55, -canopyD)); // contorno: silueta legible
    kind = float(K_CANOPY);
    shadow = 1.0;
  }

  if (groundA <= 0.0 && kind != float(K_CANOPY)) kind = float(K_VOID);

  oTerrain = vec4(sdf, cliffT, cliffL, groundA);
  oSurface = vec4(lab, kind);
  oExtra = vec4(rim, shadow, waterDepth, 0.0);
}
