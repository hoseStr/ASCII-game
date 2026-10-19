// ---------------------------------------------------------------------------
// P0 · Horneado del terreno (una vez por sala, paleta o calidad): todo lo
// estático de la capa pictórica, a su misma resolución, a partir del tilemap.
// La pasada por fotograma solo añade lo que cambia (luz, agua, niebla, cielo).
//
// Salida 0: sdf de la isla deshilachado, t del acantilado (<0 = no hay), L del acantilado, alfa del suelo
// Salida 1: albedo en OKLab (L, a, b), tipo de superficie (K_*)
// Salida 2: borde plateado, sombra (1 = sin sombra), profundidad del agua (−1 = camino:
//           la composición lo empiedra), SDF de los obstáculos
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
uniform sampler2D uPropShadow; // sombra que proyectan las piezas (renders 3D y rocas) sobre el suelo

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
  // deformación moderada: la costa visible se mantiene cerca de la de colisión
  float warp = (fbm(vec3(p * 0.085, 3.7), 3) - 0.5) * 1.6 + (fbm(vec3(p * 0.42, 8.1), 2) - 0.5) * 0.5;
  return fieldAt(cellPos) + warp;
}

float boxDist(vec2 p, vec2 c, float h) {
  vec2 d = abs(p - c) - vec2(h);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// SDF de la región formada por los tiles de un tipo (vecindad 3×3), con las
// esquinas EXTERIORES redondeadas con radio `round`. Cada tile extiende su caja
// hasta los vecinos del mismo tipo, así que la unión es exacta: sin agujeros
// donde se tocan cuatro tiles ni costuras entre vecinos (cada hueco dibujaría
// un contorno interno). `shrink` mete el borde exterior hacia dentro.
float typeSdf(vec2 p, uint type, float shrink, float round) {
  ivec2 tc = ivec2(floor(p / TILE_U));
  float d = 1e3;
  float inset = shrink + round;
  for (int j = -uOne; j <= uOne; j++) {
    for (int i = -uOne; i <= uOne; i++) {
      ivec2 t = tc + ivec2(i, j);
      if (tileAt(t) != type) continue;
      vec2 lo = vec2(t) * TILE_U;
      vec2 hi = lo + TILE_U;
      if (tileAt(t + ivec2(-1, 0)) != type) lo.x += inset;
      if (tileAt(t + ivec2(1, 0)) != type) hi.x -= inset;
      if (tileAt(t + ivec2(0, -1)) != type) lo.y += inset;
      if (tileAt(t + ivec2(0, 1)) != type) hi.y -= inset;
      vec2 c = 0.5 * (lo + hi);
      vec2 q = abs(p - c) - 0.5 * (hi - lo);
      d = min(d, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - round);
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
  float pathD = typeSdf(p, T_PATH, 0.05, 0.6) + edgeNoise * 0.3;
  if (pathD < 0.0) {
    lab = uPal[P_PATH];
    lab.x += (nC - 0.5) * 0.08 - 0.06 * smoothstep(-0.6, 0.0, pathD);
    kind = float(K_PATH);
  } else if (pathD < 0.9) {
    shadow = min(shadow, mix(0.5, 1.0, smoothstep(0.0, 0.9, pathD))); // margen: el camino se recorta
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
  // orillas redondeadas: el lago no debe leerse como una escalera de tiles
  float waterD = typeSdf(p, T_WATER, 0.0, 1.2) + edgeNoise * 0.6;
  if (waterD < 0.0) {
    kind = float(K_WATER);
    waterDepth = -waterD;
  } else if (waterD < 1.1 && groundA > 0.0) {
    float s = smoothstep(1.1, 0.2, waterD);
    lab = mix(lab, uPal[P_SHORE], s * 0.9);
    if (s > 0.5) kind = float(K_SHORE);
  }

  // --- árboles: los tiles de árbol contiguos forman UNA masa de copas (un solo
  // contorno), algo elevada (vista 3/4); los troncos asoman en el borde sur ----------
  ivec2 tc = ivec2(floor(p / TILE_U));
  float trunkD = 1e3;
  vec2 canopyC = vec2(0.0);
  float nearest = 1e3;
  for (int j = -uOne; j <= uOne; j++) {
    for (int i = -uOne; i <= uOne; i++) {
      ivec2 t = tc + ivec2(i, j);
      if (tileAt(t) != T_TREE) continue;
      vec2 c = (vec2(t) + 0.5) * TILE_U + vec2((hash12(t) - 0.5) * 0.3, -0.45);
      float dc = length(p - c);
      if (dc < nearest) {
        nearest = dc;
        canopyC = c;
      }
      if (tileAt(t + ivec2(0, 1)) == T_TREE) continue; // tronco y sombra solo en el borde sur
      vec2 sd = (p - c - vec2(0.9, 2.2)) / vec2(2.2, 1.3);
      shadow = min(shadow, 0.5 + 0.5 * smoothstep(0.6, 1.1, length(sd)));
      vec2 tq = abs(p - vec2(c.x, c.y + 1.5)) - vec2(0.4, 0.45);
      float trunk = length(max(tq, 0.0)) + min(max(tq.x, tq.y), 0.0);
      trunkD = min(trunkD, trunk);
      if (trunk < 0.0) {
        lab = uPal[P_TRUNK];
        lab.x += (hash12(ivec2(floor(cellPos))) - 0.5) * 0.08;
        kind = float(K_TRUNK);
      }
    }
  }
  float canopyD = typeSdf(p + vec2(0.0, 0.5), T_TREE, 0.0, 1.2) + (fbm(vec3(p * 1.3, 27.0), 2) - 0.5) * 0.5;
  if (canopyD < 0.0) {
    vec2 n = (p - canopyC) / 1.6;
    float lit = clamp(0.55 - 0.5 * dot(n, normalize(vec2(0.6, 0.8))), 0.0, 1.0);
    float leaves = fbm(vec3(p * 1.1, 33.0), 3);
    lab = mix(uPal[P_CANOPY_DARK], uPal[P_CANOPY], clamp(lit * 0.6 + (leaves - 0.5) * 0.8 + 0.35, 0.0, 1.0));
    kind = float(K_CANOPY);
    shadow = 1.0;
  }

  // --- obstáculos: un único SDF (negativo dentro) para los contornos de tinta ----------
  float crystalD = typeSdf(p, T_CRYSTAL, 0.0, 0.6);
  float obstacleD = min(min(waterD, min(canopyD, trunkD)), crystalD);
  if (obstacleD > 0.0 && obstacleD < 0.8 && kind != float(K_PATH)) {
    shadow = min(shadow, mix(0.45, 1.0, smoothstep(0.0, 0.8, obstacleD))); // anillo de sombra
  }

  // Junto a los puentes no se dibuja la línea de costa: sería una barrera falsa
  // en la entrada. Se marca con borde negativo (la pictórica usa max(rim, 0)).
  float bridgeD = min(typeSdf(p, T_BRIDGE_H, 0.0, 0.0), typeSdf(p, T_BRIDGE_V, 0.0, 0.0));
  if (bridgeD < 1.8) rim = -1.0;

  // Sombra que proyectan las piezas de escenario (render/propLayer.ts).
  shadow *= 1.0 - textureLod(uPropShadow, gl_FragCoord.xy / (uGrid * uSamples), 0.0).r;

  if (groundA <= 0.0 && kind != float(K_CANOPY)) kind = float(K_VOID);
  if (kind == float(K_PATH)) waterDepth = -1.0; // marca para los adoquines (compose.frag)

  oTerrain = vec4(sdf, cliffT, cliffL, groundA);
  oSurface = vec4(lab, kind);
  oExtra = vec4(rim, shadow, waterDepth, obstacleD);
}
