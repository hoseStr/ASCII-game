// ---------------------------------------------------------------------------
// P4a · Bloom con filtro dual (Kawase): prefiltro, reducciones y ampliaciones.
// MODE 0 = prefiltro (umbral suave sobre glifos brillantes y emisivos)
// MODE 1 = reducción (5 muestras)    MODE 2 = ampliación (8 muestras) + nivel
// ---------------------------------------------------------------------------

uniform sampler2D uSrc;
uniform sampler2D uAdd;      // MODE 2: nivel reducido del mismo tamaño que la salida
uniform vec2 uSrcTexel;      // 1 / tamaño de uSrc
uniform vec2 uDstSize;
uniform float uThreshold;
uniform float uKnee;
uniform float uEmissiveBoost;

out vec4 oColor;

vec3 prefilter(vec4 s) {
  float l = luminance(s.rgb);
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  return s.rgb * (max(w, 0.0) + s.a * uEmissiveBoost);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uDstSize;
  vec2 hp = uSrcTexel * 0.5;
#if MODE == 0
  vec3 c = prefilter(texture(uSrc, uv + vec2(-hp.x, -hp.y)))
         + prefilter(texture(uSrc, uv + vec2( hp.x, -hp.y)))
         + prefilter(texture(uSrc, uv + vec2(-hp.x,  hp.y)))
         + prefilter(texture(uSrc, uv + vec2( hp.x,  hp.y)));
  oColor = vec4(c * 0.25, 1.0);
#elif MODE == 1
  vec3 c = texture(uSrc, uv).rgb * 4.0
         + texture(uSrc, uv - hp).rgb
         + texture(uSrc, uv + hp).rgb
         + texture(uSrc, uv + vec2(hp.x, -hp.y)).rgb
         + texture(uSrc, uv - vec2(hp.x, -hp.y)).rgb;
  oColor = vec4(c / 8.0, 1.0);
#else
  vec2 o = uSrcTexel;
  vec3 c = texture(uSrc, uv + vec2(-o.x * 2.0, 0.0)).rgb
         + texture(uSrc, uv + vec2(-o.x, o.y)).rgb * 2.0
         + texture(uSrc, uv + vec2(0.0, o.y * 2.0)).rgb
         + texture(uSrc, uv + vec2(o.x, o.y)).rgb * 2.0
         + texture(uSrc, uv + vec2(o.x * 2.0, 0.0)).rgb
         + texture(uSrc, uv + vec2(o.x, -o.y)).rgb * 2.0
         + texture(uSrc, uv + vec2(0.0, -o.y * 2.0)).rgb
         + texture(uSrc, uv + vec2(-o.x, -o.y)).rgb * 2.0;
  oColor = vec4(c / 12.0 + texture(uAdd, uv).rgb, 1.0);
#endif
}
