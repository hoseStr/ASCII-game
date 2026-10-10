// ---------------------------------------------------------------------------
// P4b · Composición final: bloom, desenfoque de sueño, aberración cromática
// radial muy sutil, viñeta teñida de índigo y grano fino. Escribe en el lienzo
// (dentro del rectángulo del letterbox).
// ---------------------------------------------------------------------------

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uViewOrigin;   // esquina del letterbox en píxeles del lienzo
uniform vec2 uViewSize;
uniform float uBloomStrength;
uniform float uDream;       // 0..1, desenfoque onírico (transiciones/menús)
uniform float uCA;          // aberración en píxeles en las esquinas
uniform float uVignette;
uniform vec3 uVignetteTint;
uniform float uGrain;
uniform float uFrame;

out vec4 oColor;

void main() {
  vec2 local = gl_FragCoord.xy - uViewOrigin;
  vec2 uv = local / uViewSize;
  vec2 dir = uv - 0.5;
  float r2 = dot(dir * vec2(uViewSize.x / uViewSize.y, 1.0), dir * vec2(uViewSize.x / uViewSize.y, 1.0));

  vec3 col;
  if (uCA > 0.0) {
    vec2 off = dir * r2 * (uCA * 2.0) / uViewSize;
    col.r = texture(uScene, uv - off).r;
    col.g = texture(uScene, uv).g;
    col.b = texture(uScene, uv + off).b;
  } else {
    col = texelFetch(uScene, ivec2(local), 0).rgb;
  }

  // Las piezas de escenario (alfa 0 en la escena) se muestran tal cual: la imagen
  // convertida a ASCII, sin bloom, viñeta, aberración ni grano.
  vec4 sc = texelFetch(uScene, ivec2(local), 0);
  if (sc.a < 0.25) {
    oColor = vec4(sc.rgb, 1.0);
    return;
  }

  vec3 bloom = texture(uBloom, uv).rgb;
  col = mix(col, bloom * 0.9 + col * 0.25, uDream);
  col += bloom * uBloomStrength;

  float v = smoothstep(0.25, 1.15, r2 * 1.35);
  col = mix(col, col * uVignetteTint, v * uVignette);

  uint h = hashU2(ivec2(gl_FragCoord.xy) + ivec2(int(uFrame) * 7, int(uFrame) * 13));
  float n = float(h >> 8) * (1.0 / 16777216.0) - 0.5;
  col += n * uGrain * (0.35 + luminance(col));

  oColor = vec4(col, 1.0);
}
