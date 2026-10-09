/**
 * Campo de distancia con signo a partir de una máscara de celdas (p. ej. "isla").
 * Transformada de distancia euclídea exacta (Felzenszwalb & Huttenlocher, 2012),
 * separable y anisótropa: las celdas no son cuadradas, así que cada eje lleva su
 * propia escala y la distancia queda en unidades visuales (1 unidad = alto de fila).
 *
 * Convención: negativo dentro de la máscara, positivo fuera, ≈0 en el borde.
 */

const INF = 1e20;

/** Distancia al cuadrado 1D con escala `s` por paso (in-place sobre f). */
function edt1d(f: Float64Array, n: number, s: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  const s2 = s * s;
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let p = v[k]!;
    let sx = (f[q]! + s2 * q * q - (f[p]! + s2 * p * p)) / (2 * s2 * (q - p));
    while (sx <= z[k]!) {
      k--;
      p = v[k]!;
      sx = (f[q]! + s2 * q * q - (f[p]! + s2 * p * p)) / (2 * s2 * (q - p));
    }
    k++;
    v[k] = q;
    z[k] = sx;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const p = v[k]!;
    d[q] = s2 * (q - p) * (q - p) + f[p]!;
  }
}

/** Distancia (no al cuadrado) de cada celda a la celda `true` más cercana. */
function distanceTo(mask: Uint8Array, cols: number, rows: number, sx: number, sy: number, target: number): Float64Array {
  const n = Math.max(cols, rows);
  const grid = new Float64Array(cols * rows);
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] === target ? 0 : INF;
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) f[y] = grid[y * cols + x]!;
    edt1d(f, rows, sy, d, v, z);
    for (let y = 0; y < rows; y++) grid[y * cols + x] = d[y]!;
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) f[x] = grid[y * cols + x]!;
    edt1d(f, cols, sx, d, v, z);
    for (let x = 0; x < cols; x++) grid[y * cols + x] = Math.sqrt(d[x]!);
  }
  return grid;
}

/**
 * SDF de la máscara. `cellAspect` = ancho/alto de la celda (las columnas miden
 * `cellAspect` unidades, las filas 1). El borde queda a medio paso entre celdas.
 */
export function signedDistanceField(mask: Uint8Array, cols: number, rows: number, cellAspect: number): Float32Array {
  const outside = distanceTo(mask, cols, rows, cellAspect, 1, 1);
  const inside = distanceTo(mask, cols, rows, cellAspect, 1, 0);
  const out = new Float32Array(cols * rows);
  const half = 0.5 * Math.min(cellAspect, 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = mask[i] ? -(inside[i]! - half) : outside[i]! - half;
  }
  return out;
}

/**
 * Suavizado separable (cajas repetidas ≈ gaussiano) de un campo por celda.
 * Aplicado al SDF de un tilemap redondea las esquinas de la escalera de tiles.
 */
export function blurField(field: Float32Array, cols: number, rows: number, rx: number, ry: number, passes = 2): Float32Array {
  let src = Float32Array.from(field);
  let dst = new Float32Array(field.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let sum = 0;
        for (let k = -rx; k <= rx; k++) sum += src[y * cols + Math.min(cols - 1, Math.max(0, x + k))]!;
        dst[y * cols + x] = sum / (2 * rx + 1);
      }
    }
    [src, dst] = [dst, src];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let sum = 0;
        for (let k = -ry; k <= ry; k++) sum += src[Math.min(rows - 1, Math.max(0, y + k)) * cols + x]!;
        dst[y * cols + x] = sum / (2 * ry + 1);
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}
