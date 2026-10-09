import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { signedDistanceField } from '../src/render/field';
import { linearRgbToOklab, oklabToLinearRgb, oklchToSrgb, srgbToLinear, linearToSrgb } from '../src/render/palette';

describe('Rng', () => {
  it('es determinista por semilla', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    const sc = Array.from({ length: 8 }, () => c.nextU32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('next() ∈ [0,1) e int() respeta el rango', () => {
    const r = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const k = r.int(3, 9);
      expect(k).toBeGreaterThanOrEqual(3);
      expect(k).toBeLessThan(9);
    }
  });
});

describe('OKLab', () => {
  it('blanco = (1, 0, 0) y el rojo sRGB coincide con la referencia', () => {
    const [L, a, b] = linearRgbToOklab([1, 1, 1]);
    expect(L).toBeCloseTo(1, 4);
    expect(a).toBeCloseTo(0, 4);
    expect(b).toBeCloseTo(0, 4);
    const red = linearRgbToOklab([1, 0, 0]);
    expect(red[0]).toBeCloseTo(0.627955, 4);
    expect(red[1]).toBeCloseTo(0.224863, 4);
    expect(red[2]).toBeCloseTo(0.125846, 4);
  });

  it('ida y vuelta sin pérdida', () => {
    const c: [number, number, number] = [0.2, 0.5, 0.8];
    const back = oklabToLinearRgb(linearRgbToOklab(c));
    back.forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 5));
    expect(linearToSrgb(srgbToLinear(0.37))).toBeCloseTo(0.37, 6);
  });

  it('mapea al gamut reduciendo el croma', () => {
    const rgb = oklchToSrgb([0.7, 0.5, 150]);
    for (const v of rgb) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('campo de distancia', () => {
  it('negativo dentro, positivo fuera y distancias anisótropas', () => {
    const cols = 21;
    const rows = 11;
    const mask = new Uint8Array(cols * rows);
    // bloque central de 5×3 celdas
    for (let y = 4; y <= 6; y++) for (let x = 8; x <= 12; x++) mask[y * cols + x] = 1;
    const aspect = 0.6;
    const sdf = signedDistanceField(mask, cols, rows, aspect);
    expect(sdf[5 * cols + 10]).toBeLessThan(0);
    expect(sdf[0]).toBeGreaterThan(0);
    // 3 columnas a la derecha del borde: 3·0.6 − 0.3 = 1.5 unidades
    expect(sdf[5 * cols + 15]).toBeCloseTo(3 * aspect - 0.3, 5);
    // 3 filas debajo del borde: 3 − 0.3 = 2.7 unidades
    expect(sdf[9 * cols + 10]).toBeCloseTo(3 - 0.3, 5);
  });
});
