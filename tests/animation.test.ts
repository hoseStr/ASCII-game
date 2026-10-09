import { describe, expect, it } from 'vitest';
import { PROP_H, PROP_SAMPLES, PROP_W, PropLayer } from '../src/render/propLayer';
import { splitFrames, stampImageFromRgba, type StampAsset } from '../src/render/stamps';
import type { PlacedProp, StampDef } from '../src/world/props';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../src/world/tiles';

// Pieza animada de prueba: 1×1 tile (5×3 celdas = 20×12 muestras) y 2 fotogramas.
// Fotograma 0: barra opaca en x 4..7; fotograma 1: la misma barra en x 12..15.
const W = 20;
const H = 12;
const FRAMES = 2;
const def: StampDef = {
  id: 'hoja',
  image: 'hoja.png',
  use: 'prop',
  sizeTiles: [1, 1],
  cells: [5, 3],
  samples: 4,
  solid: false,
  shadow: 'cast',
  footprint: ['.'],
  frames: FRAMES,
  fps: 4,
  credits: { title: '', author: '', license: 'CC0-1.0', sourceUrl: '' },
};
const strip = new Uint8Array(W * H * FRAMES * 4);
for (let y = 0; y < H; y++) {
  for (let x = 4; x < 8; x++) strip.set([10, 200, 30, 255], (y * W + x) * 4);
  for (let x = 12; x < 16; x++) strip.set([10, 200, 30, 255], ((H + y) * W + x) * 4);
}
const asset: StampAsset = { frames: splitFrames(stampImageFromRgba(strip, W, H * FRAMES), FRAMES), shadow: null };
const images = new Map([['hoja', asset]]);
// fila y columna 0: fase 0 (el fotograma depende solo del tiempo)
const prop: PlacedProp = { def, tx: 0, ty: 0, flip: false };
const ox = prop.tx * TILE_COLS * PROP_SAMPLES;
const oy = (HUD_ROWS + prop.ty * TILE_ROWS) * PROP_SAMPLES;
const alphaAt = (layer: PropLayer, x: number, y: number): number => layer.rgb[((oy + y) * PROP_W + ox + x) * 4 + 3]!;

describe('piezas animadas', () => {
  it('splitFrames separa la tira vertical sin copiar bytes', () => {
    expect(asset.frames).toHaveLength(2);
    expect(asset.frames[1]!.h).toBe(H);
    expect(asset.frames[1]!.data.buffer).toBe(asset.frames[0]!.data.buffer);
  });

  it('al entrar se compone el fotograma 0', () => {
    const layer = new PropLayer();
    layer.build([prop], [], images);
    expect(alphaAt(layer, 5, 3)).toBe(255);
    expect(alphaAt(layer, 13, 3)).toBe(0);
  });

  it('animate cambia de fotograma, recompone la región y anota el rectángulo sucio', () => {
    const layer = new PropLayer();
    layer.build([prop], [], images);
    expect(layer.animate(0.1, true)).toBe(false); // sigue en el fotograma 0
    expect(layer.animate(0.3, true)).toBe(true); // 0,3 s · 4 fps → fotograma 1
    expect(alphaAt(layer, 5, 3)).toBe(0);
    expect(alphaAt(layer, 13, 3)).toBe(255);
    expect(layer.dirtyCount).toBe(1);
    expect(Array.from(layer.dirtyRects.subarray(0, 4))).toEqual([ox, oy, ox + W - 1, oy + H - 1]);
    expect(layer.animate(0.35, true)).toBe(false); // mismo fotograma: nada que subir
    expect(layer.animate(0.5, true)).toBe(true); // vuelta al 0 (bucle)
    expect(alphaAt(layer, 5, 3)).toBe(255);
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
    expect(area(0)).toBe(W * H);
    expect(area(1)).toBe(W * H);
  });

  it('con movimiento reducido se queda en el fotograma 0', () => {
    const layer = new PropLayer();
    layer.build([prop], [], images);
    for (const t of [0.3, 0.8, 1.3]) {
      layer.animate(t, false);
      expect(alphaAt(layer, 5, 3)).toBe(255);
      expect(alphaAt(layer, 13, 3)).toBe(0);
    }
  });

  it('no toca lo que queda fuera de la pieza y respeta a las vecinas', () => {
    // vecina estática que se solapa por la derecha (más al sur: se dibuja encima)
    const still: StampDef = { ...def, id: 'roca', frames: 1, fps: 0 };
    const solid = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) solid.set([90, 90, 90, 255], i * 4);
    const imgs = new Map<string, StampAsset>([
      ['hoja', asset],
      ['roca', { frames: [stampImageFromRgba(solid, W, H)], shadow: null }],
    ]);
    const layer = new PropLayer();
    // vecina estática en la misma caja, dibujada después (encima)
    layer.build([prop, { def: still, tx: 0, ty: 0, flip: false }], [], imgs);
    const before = layer.rgb.slice();
    layer.animate(0.3, true);
    // la roca (encima) tapa la hoja en toda la caja: la recomposición la respeta
    expect(Array.from(layer.rgb.subarray(((oy + 3) * PROP_W + ox + 13) * 4, ((oy + 3) * PROP_W + ox + 13) * 4 + 4))).toEqual([90, 90, 90, 255]);
    // fuera del rectángulo sucio nada cambia
    for (let y = 0; y < PROP_H; y++) {
      for (let x = 0; x < PROP_W; x++) {
        const [x0, y0, x1, y1] = layer.dirtyRects;
        if (x >= x0! && x <= x1! && y >= y0! && y <= y1!) continue;
        const i = (y * PROP_W + x) * 4;
        if (layer.rgb[i + 3] !== before[i + 3]) throw new Error(`cambió (${x}, ${y}) fuera del rectángulo sucio`);
      }
    }
  });

  it('dos piezas iguales en sitios distintos no se mueven al unísono (fase por posición)', () => {
    const layer = new PropLayer();
    const twin: PlacedProp = { def, tx: 1, ty: 0, flip: false }; // fase ((1·7 + 0·13) % 17) / 17 = 7/17
    layer.build([prop, twin], [], images);
    const a = (tx: number, x: number): number => layer.rgb[((oy + 3) * PROP_W + tx * TILE_COLS * PROP_SAMPLES + x) * 4 + 3]!;
    // t = 0,05 s, 4 fps, 2 fotogramas: sin fase → floor(0,2) = 0; con fase 7/17 → floor(0,2 + 0,82) = 1
    layer.animate(0.05, true);
    expect([a(0, 5), a(0, 13)]).toEqual([255, 0]);
    expect([a(1, 5), a(1, 13)]).toEqual([0, 255]);
  });
});

describe('sombras renderizadas', () => {
  // sombra de 16×8 muestras, desplazada (+6, +10) respecto al origen de la estampa
  const shadow = { w: 16, h: 8, data: new Uint8Array(128).fill(255) };
  const shDef: StampDef = { ...def, id: 'helecho', frames: 1, fps: 0, shadow: 'render', shadowImage: { image: 'x', offset: [6, 10], size: [16, 8] } };
  const one = { frames: [asset.frames[0]!], shadow };
  const imgs = new Map<string, StampAsset>([['helecho', one]]);

  it('se usa la sombra del render, en su sitio', () => {
    const layer = new PropLayer();
    layer.build([{ def: shDef, tx: 2, ty: 2, flip: false }], [], imgs);
    const sx = 2 * TILE_COLS * PROP_SAMPLES + 6 + 8;
    const sy = (HUD_ROWS + 2 * TILE_ROWS) * PROP_SAMPLES + 10 + 4;
    expect(layer.shadow[sy * PROP_W + sx]!).toBeGreaterThan(120);
    // lejos de la sombra renderizada no hay nada (no se proyecta la silueta además)
    expect(layer.shadow[(sy + 20) * PROP_W + sx + 30]!).toBe(0);
  });

  it('una pieza en espejo proyecta su silueta (la sombra del render iría al lado contrario)', () => {
    const layer = new PropLayer();
    layer.build([{ def: shDef, tx: 2, ty: 2, flip: true }], [], imgs);
    let total = 0;
    for (const v of layer.shadow) total += v;
    expect(total).toBeGreaterThan(0);
  });
});
