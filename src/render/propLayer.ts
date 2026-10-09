/**
 * Capa de piezas de una sala, compuesta en CPU una vez al entrar:
 *  - rgb:  bytes REALES de la foto (RGBA8, sin premultiplicar), a 4 muestras por
 *          celda (160·4 × 54·4);
 *  - info: 1 donde hay una muestra de pieza (alfa > 0).
 * La composición (compose.frag) convierte esas celdas a ASCII tal cual, con el
 * algoritmo del repo y sin tinte, luz, niebla ni contornos: la pieza se ve como
 * la foto. Los buffers se reservan una vez.
 */
import { GRID_COLS, GRID_ROWS } from '../config';
import type { PlacedProp, RockFill } from '../world/props';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../world/tiles';
import { resampleStamp, type StampImage } from './stamps';

export const PROP_SAMPLES = 4;
export const PROP_W = GRID_COLS * PROP_SAMPLES;
export const PROP_H = GRID_ROWS * PROP_SAMPLES;
export const PROP_MODE_PIECE = 1;

export class PropLayer {
  readonly rgb = new Uint8Array(PROP_W * PROP_H * 4);
  readonly info = new Uint8Array(PROP_W * PROP_H * 4);
  /** tiempo de la última composición (ms), para el overlay F3 */
  lastBuildMs = 0;

  build(props: PlacedProp[], rockFills: RockFill[], images: Map<string, StampImage>): void {
    const t0 = performance.now();
    this.rgb.fill(0);
    this.info.fill(0);
    // Rocas: la foto recortada se estira a su rectángulo de tiles.
    for (const r of rockFills) {
      const img = images.get(r.def.id);
      if (!img) continue;
      const w = (r.tx1 - r.tx0 + 1) * TILE_COLS * PROP_SAMPLES;
      const h = (r.ty1 - r.ty0 + 1) * TILE_ROWS * PROP_SAMPLES;
      this.blit(resampleStamp(img, w, h), r.tx0 * TILE_COLS * PROP_SAMPLES, (HUD_ROWS + r.ty0 * TILE_ROWS) * PROP_SAMPLES, false);
    }
    for (const p of props) {
      const img = images.get(p.def.id);
      if (!img) continue;
      this.blit(img, p.tx * TILE_COLS * PROP_SAMPLES, (HUD_ROWS + p.ty * TILE_ROWS) * PROP_SAMPLES, p.flip);
    }
    this.lastBuildMs = performance.now() - t0;
  }

  /**
   * Copia los bytes de una imagen a la capa. Una pieza más al sur tapa a la
   * anterior: la muestra se reemplaza (sin mezclar colores, para conservar los
   * bytes exactos de la foto).
   */
  private blit(img: StampImage, ox: number, oy: number, flip: boolean): void {
    for (let y = 0; y < img.h; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= PROP_H) continue;
      for (let x = 0; x < img.w; x++) {
        const si = (y * img.w + (flip ? img.w - 1 - x : x)) * 4;
        if (img.data[si + 3]! === 0) continue;
        const dx = ox + x;
        if (dx < 0 || dx >= PROP_W) continue;
        const di = (dy * PROP_W + dx) * 4;
        this.rgb[di] = img.data[si]!;
        this.rgb[di + 1] = img.data[si + 1]!;
        this.rgb[di + 2] = img.data[si + 2]!;
        this.rgb[di + 3] = img.data[si + 3]!;
        this.info[di] = PROP_MODE_PIECE;
        this.info[di + 3] = 255;
      }
    }
  }
}
