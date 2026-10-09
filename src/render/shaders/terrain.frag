// ---------------------------------------------------------------------------
// Horneado del terreno (una vez por sala, paleta o calidad): todo lo estático
// de la capa pictórica, a su misma resolución. La pasada por fotograma solo
// añade lo que cambia (luz, niebla, estrellas, respiración).
// Salida 0: sdf deshilachado, t del acantilado (<0 = no hay), L del acantilado, alfa del suelo
// Salida 1: albedo del suelo en OKLab (L, a, b), borde plateado
// ---------------------------------------------------------------------------

uniform vec2 uGrid;
uniform float uSamples;
uniform float uAspect;
uniform sampler2D uField;
uniform vec3 uPal[PAL_SIZE];
uniform int uOctaves;

layout(location = 0) out vec4 oTerrain;
layout(location = 1) out vec4 oGround;

float fieldAt(vec2 cellPos) { return texture(uField, cellPos / uGrid).r; }

// Costa orgánica: deformación de baja frecuencia + detalle fino.
float islandSdf(vec2 cellPos) {
  vec2 p = vec2(cellPos.x * uAspect, cellPos.y);
  float warp = (fbm(vec3(p * 0.085, 3.7), 3) - 0.5) * 5.0 + (fbm(vec3(p * 0.42, 8.1), 2) - 0.5) * 1.4;
  return fieldAt(cellPos) + warp;
}

void main() {
  vec2 cellPos = gl_FragCoord.xy / uSamples;
  vec2 p = vec2(cellPos.x * uAspect, cellPos.y);
  float sdf = islandSdf(cellPos);
  float groundA = smoothstep(0.3, -0.3, sdf);

  // Acantilado colgante bajo el borde sur: busca tierra hacia arriba.
  float cliffT = -1.0;
  float cliffL = 0.0;
  if (sdf > -0.3 && sdf < 14.0) {
    float colHash = hash12(ivec2(floor(cellPos.x), 911));
    float maxDepth = 4.0 + 6.0 * fbm(vec3(p.x * 0.3, 0.0, 7.7), 2) + 4.0 * pow(colHash, 5.0);
    for (int k = 1; k <= 48; k++) {
      float dy = float(k) * 0.25;
      if (dy > maxDepth) break;
      if (islandSdf(cellPos - vec2(0.0, dy)) < 0.0) {
        // Cono invertido: bajo el centro de la isla la roca cuelga más que bajo
        // sus extremos (se mide cuánta isla hay por encima del borde).
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

  // Suelo: manchas grandes de musgo, grano fino y matas.
  float nA = fbm(vec3(p * 0.1, 1.3), uOctaves);
  float nB = fbm(vec3(p * 0.3 + 5.0, 2.1), max(uOctaves - 1, 1));
  float nC = fbm(vec3(p * 0.95, 11.0), 2);
  vec3 lab = mix(uPal[P_GROUND_DEEP], uPal[P_GROUND], smoothstep(0.3, 0.7, nA));
  lab = mix(lab, uPal[P_MOSS], smoothstep(0.5, 0.74, nB) * 0.9);
  lab.x += (nC - 0.5) * 0.22;
  float tuft = smoothstep(0.64, 0.84, fbm(vec3(p * 1.6, 9.0), 2));
  lab.x += tuft * 0.14;
  float rim = smoothstep(-1.6, -0.15, sdf);

  oTerrain = vec4(sdf, cliffT, cliffL, groundA);
  oGround = vec4(lab, rim);
}
