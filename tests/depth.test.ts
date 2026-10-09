import { describe, expect, it } from 'vitest';
import { GRID_COLS } from '../src/config';
import { CellBuffer } from '../src/render/cellBuffer';
import { PROP_SAMPLES, PROP_W, PropLayer } from '../src/render/propLayer';
import { DEPTH_MASK, DEPTH_SHIFT } from '../src/render/shaders';
import { stampImageFromRgba } from '../src/render/stamps';
import type { PlacedProp, StampDef } from '../src/world/props';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../src/world/tiles';

// Pieza de prueba: 1×2 tiles (5×6 celdas = 20×24 muestras), un poste opaco en el centro.
const def: StampDef = {
  id: 'poste',
  image: 'poste.png',
  use: 'prop',
  sizeTiles: [1, 2],
  cells: [5, 6],
  samples: 4,
  solid: true,
  shadow: 'cast',
  footprint: ['.', '#'],
  credits: { title: '', author: '', license: 'CC0-1.0', sourceUrl: '' },
};
const W = 20;
const H = 24;
const rgba = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 8; x < 12; x++) rgba.set([200, 180, 150, 255], (y * W + x) * 4);
const images = new Map([['poste', stampImageFromRgba(rgba, W, H)]]);
const prop: PlacedProp = { def, tx: 10, ty: 4, flip: false };
const ox = prop.tx * TILE_COLS * PROP_SAMPLES;
const oy = (HUD_ROWS + prop.ty * TILE_ROWS) * PROP_SAMPLES;
const baseY = oy + H - 1;

describe('sombras proyectadas por las piezas', () => {
  const layer = new PropLayer();
  layer.build([prop], [], images);
  const sh = (x: number, y: number): number => layer.shadow[y * PROP_W + x]!;

  it('la sombra cae hacia abajo a la derecha de la base (luz desde arriba a la izquierda)', () => {
    const right = sh(ox + 20, baseY + 4);
    const left = sh(ox - 6, baseY + 2);
    const above = sh(ox + 10, oy - 6);
    expect(right).toBeGreaterThan(40);
    expect(left).toBe(0);
    expect(above).toBe(0);
  });

  it('es más oscura junto a la base que en la punta de la sombra', () => {
    let nearMax = 0;
    let farMax = 0;
    // poste de 6 unidades: la punta de la sombra llega a 6·0,5 = 3 u (20 muestras) a la derecha
    for (let y = baseY - 2; y <= baseY + 10; y++) {
      for (let x = ox + 8; x < ox + 16; x++) nearMax = Math.max(nearMax, sh(x, y));
      for (let x = ox + 28; x < ox + 34; x++) farMax = Math.max(farMax, sh(x, y));
    }
    expect(nearMax).toBeGreaterThan(farMax);
    expect(farMax).toBeGreaterThan(0); // la sombra llega lejos (el poste es alto)
  });

  it('no modifica los bytes de la foto', () => {
    const i = ((oy + 5) * PROP_W + ox + 9) * 4;
    expect(Array.from(layer.rgb.subarray(i, i + 4))).toEqual([200, 180, 150, 255]);
  });

  it('anota la fila de base en las celdas que cubre la pieza', () => {
    const baseRow = Math.floor(baseY / PROP_SAMPLES);
    const col = Math.floor((ox + 9) / PROP_SAMPLES);
    for (let row = Math.floor(oy / PROP_SAMPLES); row <= baseRow; row++) {
      expect(layer.base[row * GRID_COLS + col], `fila ${row}`).toBe(baseRow + 1);
    }
    expect(layer.base[baseRow * GRID_COLS + col - 2]).toBe(0); // fuera de la silueta
  });
});

describe('profundidad de las entidades', () => {
  it('la fila de los pies viaja en los bits altos de los flags', () => {
    const cells = new CellBuffer(GRID_COLS, 54);
    cells.put(3, 4, 7, 1, 1, 1, 0, true, 0, 0, 0, 0, 20);
    const flags = cells.glyphFlags[(4 * GRID_COLS + 3) * 2 + 1]!;
    expect((flags >> DEPTH_SHIFT) & DEPTH_MASK).toBe(21);
    cells.put(5, 4, 7, 1, 1, 1);
    expect((cells.glyphFlags[(4 * GRID_COLS + 5) * 2 + 1]! >> DEPTH_SHIFT) & DEPTH_MASK).toBe(0);
  });

  it('regla: la pieza tapa a la entidad solo si sus pies están más al norte que la base', () => {
    // la misma comparación que hace compose.frag: semDepth < propBase (ambos +1)
    const hidden = (feetRow: number, baseRow: number): boolean => feetRow + 1 < baseRow + 1;
    expect(hidden(30, 38)).toBe(true); // detrás de la columna
    expect(hidden(38, 38)).toBe(false); // a la altura de la base: delante
    expect(hidden(41, 38)).toBe(false); // delante
  });
});
