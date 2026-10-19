import { describe, expect, it } from 'vitest';
import { GRID_COLS } from '../src/config';
import { CellBuffer } from '../src/render/cellBuffer';
import { PROP_SX, PROP_SY, PROP_W, PropLayer, SHADOW_S, SHADOW_W } from '../src/render/propLayer';
import { DEPTH_MASK, DEPTH_SHIFT } from '../src/render/shaders';
import { stampImageFromRgba } from '../src/render/stamps';
import type { PlacedProp, StampDef } from '../src/world/props';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../src/world/tiles';

// Pieza de prueba: 1×2 tiles (5×6 celdas = 30×60 muestras), un poste opaco en el centro
// (3 celdas de ancho: muestras 6..23; la del medio es relleno). Sin sombra renderizada:
// proyecta su silueta.
const def: StampDef = {
  id: 'poste',
  image: 'poste.png',
  form: 'poste.form.png',
  use: 'prop',
  sizeTiles: [1, 2],
  cells: [5, 6],
  samples: [PROP_SX, PROP_SY],
  solid: true,
  shadow: 'cast',
  footprint: ['.', '#'],
  frames: 1,
  fps: 0,
  credits: { title: '', author: '', license: 'CC0-1.0', sourceUrl: '' },
};
const W = 5 * PROP_SX;
const H = 6 * PROP_SY;
const rgba = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 6; x < 24; x++) rgba.set([200, 180, 150, 255], (y * W + x) * 4);
const form = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) form.set([128, 0, 0, 255], i * 4);
const images = new Map([['poste', { frames: [stampImageFromRgba(rgba, W, H)], forms: [stampImageFromRgba(form, W, H)], shadow: null }]]);
const prop: PlacedProp = { def, tx: 10, ty: 4, flip: false };
const ox = prop.tx * TILE_COLS * PROP_SX;
const oy = (HUD_ROWS + prop.ty * TILE_ROWS) * PROP_SY;
// en la rejilla de sombras (SHADOW_S muestras por celda)
const sox = prop.tx * TILE_COLS * SHADOW_S;
const soy = (HUD_ROWS + prop.ty * TILE_ROWS) * SHADOW_S;
const sBaseY = soy + 6 * SHADOW_S - 1;

describe('sombras proyectadas por las piezas', () => {
  const layer = new PropLayer();
  layer.build([prop], [], images);
  const sh = (x: number, y: number): number => layer.shadow[y * SHADOW_W + x]!;

  it('la sombra cae hacia abajo a la derecha de la base (luz desde arriba a la izquierda)', () => {
    const right = sh(sox + 20, sBaseY + 4);
    const left = sh(sox - 4, sBaseY + 2);
    const above = sh(sox + 10, soy - 4);
    expect(right).toBeGreaterThan(40);
    expect(left).toBe(0);
    expect(above).toBe(0);
  });

  it('es más oscura junto a la base que en la punta de la sombra', () => {
    let nearMax = 0;
    let farMax = 0;
    // poste de 6 unidades: la punta de la sombra llega a 6·0,5 = 3 u (≈ 20 muestras) a la derecha
    for (let y = sBaseY - 2; y <= sBaseY + 10; y++) {
      for (let x = sox + 8; x < sox + 16; x++) nearMax = Math.max(nearMax, sh(x, y));
      for (let x = sox + 26; x < sox + 32; x++) farMax = Math.max(farMax, sh(x, y));
    }
    expect(nearMax).toBeGreaterThan(farMax);
    expect(farMax).toBeGreaterThan(0); // la sombra llega lejos (el poste es alto)
  });

  it('no modifica los bytes de la imagen', () => {
    const i = ((oy + 5) * PROP_W + ox + 14) * 4;
    expect(Array.from(layer.rgb.subarray(i, i + 4))).toEqual([200, 180, 150, 255]);
  });

  it('anota la fila de base en las celdas que cubre la pieza', () => {
    const baseRow = Math.floor((oy + H - 1) / PROP_SY);
    const col = Math.floor((ox + 14) / PROP_SX);
    for (let row = Math.floor(oy / PROP_SY); row <= baseRow; row++) {
      expect(layer.baseCov[(row * GRID_COLS + col) * 2], `fila ${row}`).toBe(baseRow + 1);
    }
    expect(layer.baseCov[(baseRow * GRID_COLS + col - 2) * 2]).toBe(0); // fuera de la silueta
  });

  it('las celdas del poste quedan convertidas (color real y glifo) y las de fuera vacías', () => {
    const row = Math.floor(oy / PROP_SY) + 2;
    const inside = (row * GRID_COLS + Math.floor((ox + 14) / PROP_SX)) * 4;
    expect(Array.from(layer.cells.subarray(inside, inside + 3))).toEqual([200, 180, 150]);
    expect(layer.cells[inside + 3]).toBeGreaterThan(0);
    const outside = (row * GRID_COLS + Math.floor(ox / PROP_SX)) * 4;
    expect(layer.cells[outside + 3]).toBe(0);
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
