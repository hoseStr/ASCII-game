// ---------------------------------------------------------------------------
// Código común a todos los shaders: hash entero, ruido de gradiente, fbm y OKLab.
// (Se antepone a cada fragment shader al compilar; ver render/shaders.ts.)
// ---------------------------------------------------------------------------

uint hashU(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
uint hashU2(ivec2 p) { return hashU(uint(p.x) * 0x8da6b343u ^ hashU(uint(p.y) * 0xd8163841u)); }
uint hashU3(ivec3 p) { return hashU(uint(p.x) * 0x8da6b343u ^ hashU(uint(p.y) * 0xd8163841u ^ hashU(uint(p.z) * 0xcb1ab31fu))); }
float hash12(ivec2 p) { return float(hashU2(p) >> 8) * (1.0 / 16777216.0); }
vec2 hash22(ivec2 p) {
  uint h = hashU2(p);
  return vec2(float(h >> 16), float(h & 0xffffu)) * (1.0 / 65536.0);
}
vec4 hash42(ivec2 p) {
  uint a = hashU2(p);
  uint b = hashU(a ^ 0x9e3779b9u);
  return vec4(float(a >> 16), float(a & 0xffffu), float(b >> 16), float(b & 0xffffu)) * (1.0 / 65536.0);
}

vec3 grad3(ivec3 p) {
  uint h = hashU3(p);
  // 12 direcciones de arista del cubo + variación: gradiente unitario barato
  vec3 g = vec3(float(h & 0x3ffu), float((h >> 10) & 0x3ffu), float((h >> 20) & 0x3ffu)) * (2.0 / 1023.0) - 1.0;
  return normalize(g + 1e-4);
}

// Ruido de gradiente 3D (tipo Perlin) en [-1, 1] aprox.
float gnoise(vec3 x) {
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(grad3(i + ivec3(0, 0, 0)), f - vec3(0, 0, 0));
  float n100 = dot(grad3(i + ivec3(1, 0, 0)), f - vec3(1, 0, 0));
  float n010 = dot(grad3(i + ivec3(0, 1, 0)), f - vec3(0, 1, 0));
  float n110 = dot(grad3(i + ivec3(1, 1, 0)), f - vec3(1, 1, 0));
  float n001 = dot(grad3(i + ivec3(0, 0, 1)), f - vec3(0, 0, 1));
  float n101 = dot(grad3(i + ivec3(1, 0, 1)), f - vec3(1, 0, 1));
  float n011 = dot(grad3(i + ivec3(0, 1, 1)), f - vec3(0, 1, 1));
  float n111 = dot(grad3(i + ivec3(1, 1, 1)), f - vec3(1, 1, 1));
  return 1.6 * mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                   mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

// fbm en [0, 1] aprox., octavas variables (calidad)
float fbm(vec3 x, int octaves) {
  float a = 0.5;
  float s = 0.0;
  float norm = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= octaves) break;
    s += a * gnoise(x);
    norm += a;
    x = x * 2.03 + vec3(17.1, -9.3, 4.7);
    a *= 0.5;
  }
  return 0.5 + 0.5 * s / norm;
}

// --- color -----------------------------------------------------------------
vec3 oklabToLinear(vec3 c) {
  float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
