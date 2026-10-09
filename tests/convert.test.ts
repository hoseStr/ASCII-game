import { describe, expect, it } from 'vitest';
import shapes from '../src/data/glyphShapes.json';
import { REPO_RAMP_COMPLEX } from '../src/render/ascii';
import { COLOR_FLOOR, COVER_MIN, convertCell, newCellResult, PROP_RAMP, PROP_SX, PROP_SY } from '../src/render/stampConvert';

const N = PROP_RAMP.length;
const [GX, GY] = shapes.grid as [number, number];

/** Una celda (PROP_SX × PROP_SY muestras) pintada por una función (x, y) → [r, g, b, a] | null. */
function cell(paint: (x: number, y: number) => [number, number, number, number] | null): Uint8Array {
  const d = new Uint8Array(PROP_SX * PROP_SY * 4);
  for (let y = 0; y < PROP_SY; y++) {
    for (let x = 0; x < PROP_SX; x++) {
      const v = paint(x, y);
      if (v) d.set(v, (y * PROP_SX + x) * 4);
    }
  }
  return d;
}
const convert = (d: Uint8Array) => convertCell(d, PROP_SX, 0, 0, newCellResult());
/** tinta del glifo elegido en una zona de la rejilla de formas (filas y columnas inclusivas) */
function ink(pos: number, r0: number, r1: number, c0: number, c1: number): number {
  const cov = shapes.coverage[pos]!;
  let s = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) s += cov[r * GX + c]!;
  return s / ((r1 - r0 + 1) * (c1 - c0 + 1));
}

describe('conversión de las piezas: zonas lisas = algoritmo del repo', () => {
  it('la rampa es la del repo, en sentido light (vacío → tinta)', () => {
    expect(PROP_RAMP.join('')).toBe(Array.from(REPO_RAMP_COMPLEX).reverse().join(''));
  });

  it('una celda uniforme y opaca toma el glifo del repo: min(floor(L·N/255), N−1)', () => {
    for (let L = 0; L <= 255; L += 5) {
      const res = convert(cell(() => [L, L, L, 255]));
      expect(res.pos, `L=${L}`).toBe(Math.min(Math.floor((L * N) / 255), N - 1));
    }
  });

  it('el color es el promedio real de la celda (ponderado por alfa)', () => {
    const res = convert(cell((x) => (x < 3 ? [200, 100, 40, 255] : [160, 140, 120, 255])));
    expect([res.r, res.g, res.b]).toEqual([180, 120, 80]);
  });

  it('el color en sombra sube hasta el brillo mínimo sin cambiar de tono', () => {
    const res = convert(cell(() => [40, 20, 10, 255]));
    expect(Math.max(res.r, res.g, res.b)).toBe(COLOR_FLOOR);
    expect(res.r / res.g).toBeCloseTo(2, 1);
    expect(res.g / res.b).toBeCloseTo(2, 1);
  });
});

describe('conversión de las piezas: bordes y detalles por forma', () => {
  const white: [number, number, number, number] = [235, 235, 235, 255];

  it('fuera de la silueta (cobertura < mínimo) no hay pieza', () => {
    expect(convert(cell(() => null)).pos).toBe(-1);
    const sliver = convert(cell((x, y) => (y === 0 && x < 2 ? white : null)));
    expect(sliver.cov / 255).toBeLessThan(COVER_MIN);
    expect(sliver.pos).toBe(-1);
  });

  it('borde inferior de la silueta (mitad de arriba cubierta): glifo con la tinta arriba', () => {
    const res = convert(cell((_x, y) => (y < PROP_SY / 2 ? white : null)));
    expect(res.pos).toBeGreaterThan(0);
    expect(ink(res.pos, 0, 1, 0, GX - 1)).toBeGreaterThan(ink(res.pos, GY - 2, GY - 1, 0, GX - 1));
  });

  it('borde superior (mitad de abajo cubierta): glifo con la tinta abajo', () => {
    const res = convert(cell((_x, y) => (y >= PROP_SY / 2 ? white : null)));
    expect(ink(res.pos, GY - 2, GY - 1, 0, GX - 1)).toBeGreaterThan(ink(res.pos, 0, 1, 0, GX - 1));
  });

  it('línea vertical en el centro: glifo con la tinta en la columna central', () => {
    const res = convert(cell((x) => (x >= 2 && x < 4 ? white : null)));
    expect(ink(res.pos, 0, GY - 1, 1, 1)).toBeGreaterThan(2 * Math.max(ink(res.pos, 0, GY - 1, 0, 0), ink(res.pos, 0, GY - 1, 2, 2)));
  });

  it('diagonal (triángulo de abajo a la izquierda cubierto): tinta abajo-izquierda > arriba-derecha', () => {
    const res = convert(cell((x, y) => (x / PROP_SX + (PROP_SY - 1 - y) / PROP_SY < 0.9 ? white : null)));
    expect(ink(res.pos, GY - 2, GY - 1, 0, 0)).toBeGreaterThan(ink(res.pos, 0, 1, GX - 1, GX - 1));
  });

  it('un detalle claro sobre fondo oscuro dentro de la silueta marca su sitio', () => {
    // celda opaca y oscura con un punto brillante abajo en el centro
    const res = convert(cell((x, y) => (y >= 6 && x >= 2 && x < 4 ? white : [25, 25, 25, 255])));
    expect(ink(res.pos, GY - 2, GY - 1, 1, 1)).toBeGreaterThan(ink(res.pos, 0, 1, 1, 1));
  });

  it('es determinista', () => {
    const d = cell((x, y) => [(x * 40) % 256, (y * 25) % 256, 128, y > 2 ? 255 : 0]);
    const a = convert(d);
    const b = convert(d);
    expect(b).toEqual(a);
  });
});
