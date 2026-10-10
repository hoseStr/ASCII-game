/**
 * Color perceptual: OKLab / OKLCH ↔ sRGB (Björn Ottosson, 2020).
 * Las paletas se definen en OKLCH (datos JSON) y los shaders mezclan en OKLab,
 * así los gradientes interpolan sin grises sucios.
 */

export type Vec3 = [number, number, number];

/** OKLCH tal como se escribe en los JSON de paletas: [L 0..1, C ≥ 0, h en grados]. */
export type Oklch = [number, number, number];

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function linearRgbToOklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinearRgb([L, a, b]: Vec3): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklchToOklab([L, C, h]: Oklch): Vec3 {
  const rad = (h * Math.PI) / 180;
  return [L, C * Math.cos(rad), C * Math.sin(rad)];
}

function inGamut([r, g, b]: Vec3, eps = 1e-4): boolean {
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
}

/**
 * OKLCH → OKLab dentro del gamut sRGB: si el color no cabe, reduce el croma
 * (búsqueda binaria) conservando luminosidad y tono.
 */
export function oklchToOklabInGamut(c: Oklch): Vec3 {
  if (inGamut(oklabToLinearRgb(oklchToOklab(c)))) return oklchToOklab(c);
  let lo = 0;
  let hi = c[1];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinearRgb(oklchToOklab([c[0], mid, c[2]])))) lo = mid;
    else hi = mid;
  }
  return oklchToOklab([c[0], lo, c[2]]);
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** OKLCH → sRGB codificado (0..1), con mapeo al gamut. */
export function oklchToSrgb(c: Oklch): Vec3 {
  const [r, g, b] = oklabToLinearRgb(oklchToOklabInGamut(c));
  return [clamp01(linearToSrgb(r)), clamp01(linearToSrgb(g)), clamp01(linearToSrgb(b))];
}

/** OKLCH → RGB lineal (0..1), para luces. */
export function oklchToLinear(c: Oklch): Vec3 {
  const [r, g, b] = oklabToLinearRgb(oklchToOklabInGamut(c));
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/** Interpolación en OKLab (para gradientes del lado CPU). */
