import { describe, expect, it } from 'vitest';
import { REPO_RAMP_COMPLEX } from '../src/render/ascii';
import {
  COLOR_FLOOR,
  COVER_MIN,
  convertCell,
  FILL_GLYPHS,
  LINE_GLYPHS,
  newCellResult,
  PROP_RAMP,
  PROP_SX,
  PROP_SY,
} from '../src/render/stampConvert';

// Lienzo de 3×3 celdas; se convierte la del centro (la conversión lee también las vecinas).
const W = 3 * PROP_SX;
const H = 3 * PROP_SY;
const X0 = PROP_SX;
const Y0 = PROP_SY;
type Px = [number, number, number, number] | null;
type Fx = [number, number, number];

/** Imagen y forma pintadas por funciones de la muestra (x, y) del lienzo. */
function canvas(paint: (x: number, y: number) => Px, form: (x: number, y: number) => Fx = () => [128, 0, 0]) {
  const rgb = new Uint8Array(W * H * 4);
  const frm = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = paint(x, y);
      if (v) rgb.set(v, (y * W + x) * 4);
      frm.set([...form(x, y), 255], (y * W + x) * 4);
    }
  }
  return { rgb, frm };
}
const convert = (c: { rgb: Uint8Array; frm: Uint8Array }) => convertCell(c.rgb, c.frm, W, H, X0, Y0, newCellResult());
const glyph = (c: { rgb: Uint8Array; frm: Uint8Array }): string => {
  const res = convert(c);
  return res.pos < 0 ? '' : PROP_RAMP[res.pos]!;
};
const grey: [number, number, number, number] = [160, 160, 160, 255];
/** muestra (x, y) relativa a la celda del centro */
const local = (f: (u: number, v: number) => boolean) => (x: number, y: number): Px => (f(x - X0, y - Y0) ? grey : null);

describe('conversión de las piezas: relleno por el tono de la forma', () => {
  it('la rampa es la del repo, en sentido light (vacío → tinta), y todos los glifos salen de ella', () => {
    expect(PROP_RAMP.join('')).toBe(Array.from(REPO_RAMP_COMPLEX).reverse().join(''));
    for (const ch of FILL_GLYPHS + LINE_GLYPHS) expect(PROP_RAMP, ch).toContain(ch);
  });

  it('una celda dentro de la pieza toma el glifo isótropo de su tono (nunca vacío)', () => {
    const n = FILL_GLYPHS.length;
    for (let t = 0; t <= 255; t += 15) {
      const g = glyph(canvas(() => grey, () => [t, 0, 0]));
      expect(g, `tono ${t}`).toBe(FILL_GLYPHS[1 + Math.min(Math.floor((t / 255) * (n - 1)), n - 2)]);
    }
  });

  it('el color es el promedio real de la celda (ponderado por alfa)', () => {
    const res = convert(canvas((x) => (x < X0 + 3 ? [200, 100, 40, 255] : [160, 140, 120, 255])));
    expect([res.r, res.g, res.b]).toEqual([180, 120, 80]);
  });

  it('el color en sombra sube hasta el brillo mínimo sin cambiar de tono', () => {
    const res = convert(canvas(() => [40, 20, 10, 255]));
    expect(Math.max(res.r, res.g, res.b)).toBe(COLOR_FLOOR);
    expect(res.r / res.g).toBeCloseTo(2, 1);
    expect(res.g / res.b).toBeCloseTo(2, 1);
  });

  it('fuera de la silueta no hay pieza', () => {
    expect(convert(canvas(() => null)).pos).toBe(-1);
    const sliver = convert(canvas(local((u, v) => v === 0 && u >= 0 && u < 2)));
    expect(sliver.cov / 255).toBeLessThan(COVER_MIN);
    expect(sliver.pos).toBe(-1);
  });
});

describe('conversión de las piezas: el contorno, con glifos de línea orientados', () => {
  it('borde de abajo, bajo en la celda: _ ; a media altura: -', () => {
    expect(glyph(canvas(local((_u, v) => v < 8)))).toBe('_');
    expect(glyph(canvas(local((_u, v) => v < 5)))).toBe('-');
  });

  it('el borde de arriba se dibuja en la celda de encima, como el _ del ASCII clásico', () => {
    const c = canvas(local((_u, v) => v >= PROP_SY)); // la pieza empieza justo debajo de la celda
    const res = convert(c);
    expect(res.cov).toBe(0);
    expect(PROP_RAMP[res.pos]).toBe('_');
    // con el color de la pieza, no vacío
    expect(Math.max(res.r, res.g, res.b)).toBeGreaterThanOrEqual(COLOR_FLOOR);
  });

  it('borde vertical: |', () => {
    expect(glyph(canvas(local((u) => u < 3)))).toBe('|');
  });

  it('diagonales: \\ y / según el lado', () => {
    // la pieza abajo a la izquierda de la diagonal que baja hacia la derecha
    expect(glyph(canvas(local((u, v) => v / PROP_SY > u / PROP_SX)))).toBe('\\');
    // la pieza abajo a la derecha de la diagonal que sube hacia la derecha
    expect(glyph(canvas(local((u, v) => v / PROP_SY > 1 - u / PROP_SX)))).toBe('/');
  });

  it('una hoja fina (una columna de muestras) es un trazo: |', () => {
    expect(glyph(canvas(local((u) => u === 2)))).toBe('|');
  });

  it('un detalle pequeño es un punto: . abajo y \' arriba', () => {
    expect(glyph(canvas(local((u, v) => u >= 2 && u < 5 && v >= 6 && v < 9)))).toBe('.');
    expect(glyph(canvas(local((u, v) => u >= 2 && u < 5 && v >= 1 && v < 4)))).toBe("'");
  });

  it('una curva de un solo lado del cuerpo: ( o )', () => {
    // la punta redondeada de un cuerpo que entra por la derecha (más corta que la celda:
    // un arco largo sería un trazo recto, |)
    const round = (u: number, v: number): boolean => (u - 6) ** 2 / 16 + (v - 5) ** 2 / 9 < 1;
    expect(glyph(canvas(local(round)))).toBe('(');
    expect(glyph(canvas(local((u, v) => round(PROP_SX - 1 - u, v))))).toBe(')');
  });
});

describe('conversión de las piezas: las líneas del modelo 3D', () => {
  it('una arista interna (canal G de la forma) se dibuja orientada dentro del cuerpo', () => {
    const edge = (on: (u: number, v: number) => boolean) => (x: number, y: number): Fx => [128, on(x - X0, y - Y0) ? 255 : 0, 0];
    expect(glyph(canvas(() => grey, edge((_u, v) => v === 4)))).toBe('-');
    expect(glyph(canvas(() => grey, edge((u) => u === 3)))).toBe('|');
    expect(glyph(canvas(() => grey, edge((u, v) => Math.round((u / (PROP_SX - 1)) * (PROP_SY - 1)) === v)))).toBe('\\');
    // sin arista, la misma celda es relleno
    expect(FILL_GLYPHS).toContain(glyph(canvas(() => grey)));
  });

  it('entre dos piezas solapadas, el borde de la de delante se dibuja sobre la de detrás', () => {
    // canal B: orden de dibujo; la pieza de delante (1) empieza a media celda
    const front = (_x: number, y: number): Fx => [128, 0, y - Y0 >= 5 ? 1 : 0];
    expect(glyph(canvas(() => grey, front))).toBe('-');
    // la misma imagen sin piezas distintas: relleno
    expect(FILL_GLYPHS).toContain(glyph(canvas(() => grey)));
  });

  it('es determinista', () => {
    const c = canvas(
      (x, y) => [(x * 40) % 256, (y * 25) % 256, 128, (x * 7 + y * 3) % 5 ? 255 : 0],
      (x, y) => [(x * 13) % 256, (y * 29) % 256, 0],
    );
    expect(convert(c)).toEqual(convert(c));
  });
});
