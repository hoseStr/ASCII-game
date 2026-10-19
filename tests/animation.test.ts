import { describe, expect, it } from 'vitest';
import { GRID_COLS, GRID_ROWS } from '../src/config';
import { PROP_SX, PROP_SY, PropLayer, SHADOW_S, SHADOW_W } from '../src/render/propLayer';
import { splitFrames, stampImageFromRgba, type StampAsset } from '../src/render/stamps';
import type { PlacedProp, StampDef } from '../src/world/props';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../src/world/tiles';

// Pieza animada de prueba: 1×1 tile (5×3 celdas = 30×30 muestras) y 2 fotogramas.
// Fotograma 0: barra opaca en las columnas de celdas 0–2; fotograma 1: en las 2–4.
// La celda central de cada barra (columna 1 o 3) es relleno; sus bordes, líneas.
const W = 5 * PROP_SX;
const H = 3 * PROP_SY;
const FRAMES = 2;
const def: StampDef = {
  id: 'hoja',
  image: 'hoja.png',
  form: 'hoja.form.png',
  use: 'prop',
  sizeTiles: [1, 1],
  cells: [5, 3],
  samples: [PROP_SX, PROP_SY],
  solid: false,
  shadow: 'cast',
  footprint: ['.'],
  frames: FRAMES,
  fps: 4,
  credits: { title: '', author: '', license: 'CC0-1.0', sourceUrl: '' },
};
const strip = new Uint8Array(W * H * FRAMES * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < 3 * PROP_SX; x++) strip.set([10, 200, 30, 255], (y * W + x) * 4);
  for (let x = 2 * PROP_SX; x < 5 * PROP_SX; x++) strip.set([10, 200, 30, 255], ((H + y) * W + x) * 4);
}
/** forma lisa (tono medio, sin líneas internas) del tamaño de `n` fotogramas */
const flatForm = (n: number): Uint8Array => {
  const f = new Uint8Array(W * H * n * 4);
  for (let i = 0; i < W * H * n; i++) f.set([128, 0, 0, 255], i * 4);
  return f;
};
const asset: StampAsset = {
  frames: splitFrames(stampImageFromRgba(strip, W, H * FRAMES), FRAMES),
  forms: splitFrames(stampImageFromRgba(flatForm(FRAMES), W, H * FRAMES), FRAMES),
  shadow: null,
};
const images = new Map([['hoja', asset]]);
// fila y columna 0: fase 0 (el fotograma depende solo del tiempo)
const prop: PlacedProp = { def, tx: 0, ty: 0, flip: false };
const cx = (tx: number): number => tx * TILE_COLS;
const cy = (ty: number): number => HUD_ROWS + ty * TILE_ROWS;
/** ¿la celda (columna de la pieza `col`, fila 1) es parte de la pieza ya convertida? */
const pieceAt = (layer: PropLayer, col: number, tx = 0, ty = 0): boolean =>
  layer.cells[((cy(ty) + 1) * GRID_COLS + cx(tx) + col) * 4 + 3]! > 0;

describe('piezas animadas', () => {
  it('splitFrames separa la tira vertical sin copiar bytes', () => {
    expect(asset.frames).toHaveLength(2);
    expect(asset.frames[1]!.h).toBe(H);
    expect(asset.frames[1]!.data.buffer).toBe(asset.frames[0]!.data.buffer);
  });

  it('al entrar se compone y convierte el fotograma 0', () => {
    const layer = new PropLayer();
    layer.build([prop], [], images);
    expect(pieceAt(layer, 1)).toBe(true);
    expect(pieceAt(layer, 3)).toBe(false);
    // color real de la barra
    const o = ((cy(0) + 1) * GRID_COLS + 1) * 4;
    expect(Array.from(layer.cells.subarray(o, o + 3))).toEqual([10, 200, 30]);
  });

  it('animate cambia de fotograma, reconvierte sus celdas y anota el rectángulo sucio', () => {
    const layer = new PropLayer();
    layer.build([prop], [], images);
    expect(layer.animate(0.1, true)).toBe(false); // sigue en el fotograma 0
    expect(layer.animate(0.3, true)).toBe(true); // 0,3 s · 4 fps → fotograma 1
    expect(pieceAt(layer, 1)).toBe(false);
    expect(pieceAt(layer, 3)).toBe(true);
    expect(layer.dirtyCount).toBe(1);
    // la caja de la pieza y su anillo de una celda (recortado al borde de la pantalla)
    expect(Array.from(layer.dirtyRects.subarray(0, 4))).toEqual([cx(0), cy(0) - 1, cx(0) + 5, cy(0) + 3]);
    expect(layer.animate(0.35, true)).toBe(false); // mismo fotograma: nada que subir
    expect(layer.animate(0.5, true)).toBe(true); // vuelta al 0 (bucle)
    expect(pieceAt(layer, 1)).toBe(true);
  });

  it('dos piezas lejanas que cambian a la vez dan dos rectángulos (no uno que lo abarque todo)', () => {
    const layer = new PropLayer();
    const far: PlacedProp = { def, tx: 20, ty: 10, flip: false }; // fase ((20·7 + 10·13) % 17) / 17 = 15/17
    const twin: PlacedProp = { def, tx: 3, ty: 1, flip: false }; // fase ((3·7 + 1·13) % 17) / 17 = 0
    layer.build([prop, twin, far], [], images);
    expect(layer.animate(0.3, true)).toBe(true); // prop y twin (fase 0) pasan al fotograma 1; far ya iba por el suyo
    expect(layer.dirtyCount).toBe(2);
    const area = (k: number): number => {
      const r = layer.dirtyRects;
      return (r[k * 4 + 2]! - r[k * 4]! + 1) * (r[k * 4 + 3]! - r[k * 4 + 1]! + 1);
    };
    // cada una, su caja de 5×3 celdas y el anillo (la de la columna 0, recortada a la izquierda)
    expect(area(0)).toBe(6 * 5);
    expect(area(1)).toBe(7 * 5);
  });

  it('con movimiento reducido se queda en el fotograma 0', () => {
    const layer = new PropLayer();
    layer.build([prop], [], images);
    for (const t of [0.3, 0.8, 1.3]) {
      layer.animate(t, false);
      expect(pieceAt(layer, 1)).toBe(true);
      expect(pieceAt(layer, 3)).toBe(false);
    }
  });

  it('no toca lo que queda fuera de la pieza y respeta a las vecinas', () => {
    // vecina estática en la misma caja, dibujada después (encima)
    const still: StampDef = { ...def, id: 'roca', frames: 1, fps: 0 };
    const solid = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) solid.set([150, 150, 150, 255], i * 4);
    const imgs = new Map<string, StampAsset>([
      ['hoja', asset],
      ['roca', { frames: [stampImageFromRgba(solid, W, H)], forms: [stampImageFromRgba(flatForm(1), W, H)], shadow: null }],
    ]);
    const layer = new PropLayer();
    layer.build([prop, { def: still, tx: 0, ty: 0, flip: false }], [], imgs);
    const before = layer.cells.slice();
    layer.animate(0.3, true);
    // la roca (encima) tapa la hoja en toda la caja: la recomposición la respeta
    const o = ((cy(0) + 1) * GRID_COLS + 3) * 4;
    expect(Array.from(layer.cells.subarray(o, o + 3))).toEqual([150, 150, 150]);
    // fuera del rectángulo sucio nada cambia
    const [x0, y0, x1, y1] = layer.dirtyRects;
    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        if (x >= x0! && x <= x1! && y >= y0! && y <= y1!) continue;
        const i = (y * GRID_COLS + x) * 4;
        for (let c = 0; c < 4; c++) if (layer.cells[i + c] !== before[i + c]) throw new Error(`cambió (${x}, ${y}) fuera del rectángulo sucio`);
      }
    }
  });

  it('dos piezas iguales en sitios distintos no se mueven al unísono (fase por posición)', () => {
    const layer = new PropLayer();
    const twin: PlacedProp = { def, tx: 1, ty: 0, flip: false }; // fase ((1·7 + 0·13) % 17) / 17 = 7/17
    layer.build([prop, twin], [], images);
    // t = 0,05 s, 4 fps, 2 fotogramas: sin fase → floor(0,2) = 0; con fase 7/17 → floor(0,2 + 0,82) = 1
    layer.animate(0.05, true);
    expect([pieceAt(layer, 1, 0), pieceAt(layer, 3, 0)]).toEqual([true, false]);
    expect([pieceAt(layer, 1, 1), pieceAt(layer, 3, 1)]).toEqual([false, true]);
  });
});

describe('sombras renderizadas', () => {
  // sombra de 16×8 muestras de sombra, desplazada (+6, +10) respecto al origen de la estampa
  const shadow = { w: 16, h: 8, data: new Uint8Array(128).fill(255) };
  const shDef: StampDef = { ...def, id: 'helecho', frames: 1, fps: 0, shadow: 'render', shadowImage: { image: 'x', offset: [6, 10], size: [16, 8] } };
  const one = { frames: [asset.frames[0]!], forms: [asset.forms[0]!], shadow };
  const imgs = new Map<string, StampAsset>([['helecho', one]]);

  it('se usa la sombra del render, en su sitio (rejilla de sombras)', () => {
    const layer = new PropLayer();
    layer.build([{ def: shDef, tx: 2, ty: 2, flip: false }], [], imgs);
    const sx = 2 * TILE_COLS * SHADOW_S + 6 + 8;
    const sy = (HUD_ROWS + 2 * TILE_ROWS) * SHADOW_S + 10 + 4;
    expect(layer.shadow[sy * SHADOW_W + sx]!).toBeGreaterThan(120);
    // lejos de la sombra renderizada no hay nada (no se proyecta la silueta además)
    expect(layer.shadow[(sy + 20) * SHADOW_W + sx + 30]!).toBe(0);
  });

  it('una pieza en espejo proyecta su silueta (la sombra del render iría al lado contrario)', () => {
    const layer = new PropLayer();
    layer.build([{ def: shDef, tx: 2, ty: 2, flip: true }], [], imgs);
    let total = 0;
    for (const v of layer.shadow) total += v;
    expect(total).toBeGreaterThan(0);
  });
});
