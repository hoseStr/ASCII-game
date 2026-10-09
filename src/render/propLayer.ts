/**
 * Capa de piezas de una sala, compuesta en CPU una vez al entrar:
 *  - rgb:  bytes REALES de la foto (RGBA8, sin premultiplicar), a 4 muestras por
 *          celda (160·4 × 54·4);
 *  - info: modo (1 pieza, 2 textura de roca) y si la pieza es sólida.
 * La composición (compose.frag) convierte esas celdas a ASCII tal cual, con el
 * algoritmo del repo y sin tinte, luz, niebla ni contornos: la pieza se ve como
 * la foto. Los buffers se reservan una vez.
 */
import { GRID_COLS, GRID_ROWS } from '../config';
import type { PlacedProp, RockFill } from '../world/props';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../world/tiles';
import type { StampImage } from './stamps';

export const PROP_SAMPLES = 4;
export const PROP_W = GRID_COLS * PROP_SAMPLES;
export const PROP_H = GRID_ROWS * PROP_SAMPLES;
export const PROP_MODE_PIECE = 1;
export const PROP_MODE_ROCK = 2;

export class PropLayer {
  readonly rgb = new Uint8Array(PROP_W * PROP_H * 4);
  readonly info = new Uint8Array(PROP_W * PROP_H * 4);
  /** tiempo de la última composición (ms), para el overlay F3 */
  lastBuildMs = 0;

  build(props: PlacedProp[], rockFills: RockFill[], images: Map<string, StampImage>): void {
    const t0 = performance.now();
    this.rgb.fill(0);
    this.info.fill(0);
    for (const r of rockFills) this.drawRockFill(r, images);
    for (const p of props) this.drawProp(p, images);
    this.lastBuildMs = performance.now() - t0;
  }

  private drawProp(p: PlacedProp, images: Map<string, StampImage>): void {
    const img = images.get(p.def.id);
    if (!img) return;
    const ox = p.tx * TILE_COLS * PROP_SAMPLES;
    const oy = (HUD_ROWS + p.ty * TILE_ROWS) * PROP_SAMPLES;
    const solid = p.def.solid ? 255 : 0;
    for (let y = 0; y < img.h; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= PROP_H) continue;
      for (let x = 0; x < img.w; x++) {
        const si = (y * img.w + (p.flip ? img.w - 1 - x : x)) * 4;
        if (img.data[si + 3]! === 0) continue;
        const dx = ox + x;
        if (dx < 0 || dx >= PROP_W) continue;
        // Una pieza más al sur tapa a la anterior: la muestra se reemplaza (sin
        // mezclar colores, para conservar los bytes exactos de la foto).
        const di = (dy * PROP_W + dx) * 4;
        this.rgb[di] = img.data[si]!;
        this.rgb[di + 1] = img.data[si + 1]!;
        this.rgb[di + 2] = img.data[si + 2]!;
        this.rgb[di + 3] = img.data[si + 3]!;
        this.info[di] = PROP_MODE_PIECE;
        this.info[di + 1] = solid;
        this.info[di + 3] = 255;
      }
    }
  }

  /** Textura de roca estirada a la caja del grupo (bilineal); la composición la recorta a las rocas. */
  private drawRockFill(r: RockFill, images: Map<string, StampImage>): void {
    const img = images.get(r.def.id);
    if (!img) return;
    const x0 = r.tx0 * TILE_COLS * PROP_SAMPLES;
    const y0 = (HUD_ROWS + r.ty0 * TILE_ROWS) * PROP_SAMPLES;
    const bw = (r.tx1 - r.tx0 + 1) * TILE_COLS * PROP_SAMPLES;
    const bh = (r.ty1 - r.ty0 + 1) * TILE_ROWS * PROP_SAMPLES;
    for (let y = 0; y < bh; y++) {
      const dy = y0 + y;
      if (dy >= PROP_H) break;
      const v = Math.min(img.h - 1, Math.max(0, ((y + 0.5) / bh) * img.h - 0.5));
      const vy = Math.floor(v);
      const fy = v - vy;
      const vy1 = Math.min(img.h - 1, vy + 1);
      for (let x = 0; x < bw; x++) {
        const dx = x0 + x;
        if (dx >= PROP_W) break;
        const u = Math.min(img.w - 1, Math.max(0, ((x + 0.5) / bw) * img.w - 0.5));
        const ux = Math.floor(u);
        const fx = u - ux;
        const ux1 = Math.min(img.w - 1, ux + 1);
        const di = (dy * PROP_W + dx) * 4;
        for (let c = 0; c < 3; c++) {
          const p00 = img.data[(vy * img.w + ux) * 4 + c]!;
          const p10 = img.data[(vy * img.w + ux1) * 4 + c]!;
          const p01 = img.data[(vy1 * img.w + ux) * 4 + c]!;
          const p11 = img.data[(vy1 * img.w + ux1) * 4 + c]!;
          this.rgb[di + c] = Math.round((p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy);
        }
        this.rgb[di + 3] = 255;
        this.info[di] = PROP_MODE_ROCK;
        this.info[di + 1] = 0;
        this.info[di + 3] = 255;
      }
    }
  }
}
