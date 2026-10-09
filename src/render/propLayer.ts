/**
 * Capa de piezas de una sala, compuesta en CPU una vez al entrar:
 *  - rgb:    bytes REALES de la foto (RGBA8, sin premultiplicar), a 4 muestras por
 *            celda (160·4 × 54·4). La composición (compose.frag) los convierte a
 *            ASCII tal cual, con el algoritmo del repo: la pieza se ve como la foto.
 *  - shadow: sombra que cada objeto proyecta sobre el suelo (0 = nada, 1 = máxima),
 *            a la misma resolución. Se hornea en el terreno: oscurece el suelo, no
 *            la foto.
 *  - base:   por celda, fila de pantalla donde el objeto toca el suelo (+1; 0 =
 *            sin pieza). Da la profundidad: si la princesa está más al norte que
 *            esa fila, el objeto la tapa.
 * Los buffers se reservan una vez.
 */
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from '../config';
import type { PlacedProp, RockFill } from '../world/props';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../world/tiles';
import { resampleStamp, type StampImage } from './stamps';

export const PROP_SAMPLES = 4;
export const PROP_W = GRID_COLS * PROP_SAMPLES;
export const PROP_H = GRID_ROWS * PROP_SAMPLES;
export const PROP_MODE_PIECE = 1;

/** Luz de la escena: desde arriba a la izquierda (como el sombreado de los árboles). */
export const SHADOW_DIR_X = 0.5; // unidades a la derecha por unidad de altura
export const SHADOW_DIR_Y = 0.32; // unidades hacia abajo por unidad de altura (sombra aplastada)
const SHADOW_MAX = 0.85; // opacidad junto a la base
const SHADOW_FADE = 0.5; // cuánto se aclara en la punta de la sombra
const SAMPLE_W_UNITS = CELL_ASPECT / PROP_SAMPLES;
const SAMPLE_H_UNITS = 1 / PROP_SAMPLES;

export class PropLayer {
  readonly rgb = new Uint8Array(PROP_W * PROP_H * 4);
  readonly info = new Uint8Array(PROP_W * PROP_H * 4);
  /** sombra proyectada en el suelo, 0..255 (subida como textura R8) */
  readonly shadow = new Uint8Array(PROP_W * PROP_H);
  /** fila de base (+1) por celda, 0 = sin pieza (subida como textura R8UI) */
  readonly base = new Uint8Array(GRID_COLS * GRID_ROWS);
  private readonly shadowF = new Float32Array(PROP_W * PROP_H);
  private readonly blurTmp = new Float32Array(PROP_W * PROP_H);
  /** caja (en muestras) que ocupan las sombras de la sala */
  private sx0 = 0;
  private sx1 = -1;
  private sy0 = 0;
  private sy1 = -1;
  /** tiempo de la última composición (ms), para el overlay F3 */
  lastBuildMs = 0;

  build(props: PlacedProp[], rockFills: RockFill[], images: Map<string, StampImage>): void {
    const t0 = performance.now();
    this.rgb.fill(0);
    this.info.fill(0);
    this.base.fill(0);
    this.shadowF.fill(0);
    this.sx0 = PROP_W;
    this.sx1 = -1;
    this.sy0 = PROP_H;
    this.sy1 = -1;
    const pieces: Array<{ img: StampImage; ox: number; oy: number; flip: boolean; flat: boolean }> = [];
    // Rocas: la foto recortada se estira a su rectángulo de tiles.
    for (const r of rockFills) {
      const img = images.get(r.def.id);
      if (!img) continue;
      const w = (r.tx1 - r.tx0 + 1) * TILE_COLS * PROP_SAMPLES;
      const h = (r.ty1 - r.ty0 + 1) * TILE_ROWS * PROP_SAMPLES;
      pieces.push({
        img: resampleStamp(img, w, h),
        ox: r.tx0 * TILE_COLS * PROP_SAMPLES,
        oy: (HUD_ROWS + r.ty0 * TILE_ROWS) * PROP_SAMPLES,
        flip: false,
        flat: r.def.shadow === 'flat',
      });
    }
    for (const p of props) {
      const img = images.get(p.def.id);
      if (!img) continue;
      pieces.push({
        img,
        ox: p.tx * TILE_COLS * PROP_SAMPLES,
        oy: (HUD_ROWS + p.ty * TILE_ROWS) * PROP_SAMPLES,
        flip: p.flip,
        flat: p.def.shadow === 'flat',
      });
    }
    // Primero todas las sombras (caen sobre el suelo), luego las fotos encima.
    for (const pc of pieces) this.castShadow(pc.img, pc.ox, pc.oy, pc.flip, pc.flat);
    this.blurShadow();
    for (const pc of pieces) this.blit(pc.img, pc.ox, pc.oy, pc.flip);
    this.lastBuildMs = performance.now() - t0;
  }

  /**
   * Sombra proyectada: cada muestra opaca de la foto, a una altura h sobre la
   * base del objeto (el borde inferior de su imagen), cae en el suelo desplazada
   * h·(SHADOW_DIR_X, SHADOW_DIR_Y). Más oscura cerca de la base. Un objeto plano
   * ('flat', p. ej. un nenúfar) solo deja una sombra corta bajo él.
   */
  private castShadow(img: StampImage, ox: number, oy: number, flip: boolean, flat: boolean): void {
    const totalH = img.h * SAMPLE_H_UNITS;
    for (let y = 0; y < img.h; y++) {
      const hUnits = (img.h - 1 - y) * SAMPLE_H_UNITS; // altura sobre la base
      const offX = flat ? 0.7 : hUnits * SHADOW_DIR_X;
      const offY = flat ? 0.5 : hUnits * SHADOW_DIR_Y;
      const strength = flat ? 0.6 : SHADOW_MAX * (1 - SHADOW_FADE * (hUnits / Math.max(totalH, 1e-3)));
      // proyectada: todas las alturas caen sobre la línea de base; plana: bajo la silueta
      const dy = flat ? oy + y + Math.round(offY / SAMPLE_H_UNITS) : oy + img.h - 1 + Math.round(offY / SAMPLE_H_UNITS);
      const dxOff = Math.round(offX / SAMPLE_W_UNITS);
      if (dy < 0 || dy >= PROP_H) continue;
      for (let x = 0; x < img.w; x++) {
        const a = img.data[(y * img.w + (flip ? img.w - 1 - x : x)) * 4 + 3]!;
        if (a === 0) continue;
        const dx = ox + x + dxOff;
        if (dx < 0 || dx >= PROP_W) continue;
        const i = dy * PROP_W + dx;
        const v = strength * (a / 255);
        if (v > this.shadowF[i]!) this.shadowF[i] = v;
        if (dx < this.sx0) this.sx0 = dx;
        if (dx > this.sx1) this.sx1 = dx;
        if (dy < this.sy0) this.sy0 = dy;
        if (dy > this.sy1) this.sy1 = dy;
      }
    }
  }

  /**
   * Penumbra: dos pasadas de desenfoque de caja separable (sumas acumuladas, O(1)
   * por muestra), solo dentro de la caja que ocupan las sombras.
   */
  private blurShadow(): void {
    const src = this.shadowF;
    const tmp = this.blurTmp;
    const rx = 3;
    const ry = 2;
    this.shadow.fill(0);
    if (this.sx1 < this.sx0) return;
    const x0 = Math.max(0, this.sx0 - 2 * rx);
    const x1 = Math.min(PROP_W - 1, this.sx1 + 2 * rx);
    const y0 = Math.max(0, this.sy0 - 2 * ry);
    const y1 = Math.min(PROP_H - 1, this.sy1 + 2 * ry);
    const nx = 2 * rx + 1;
    const ny = 2 * ry + 1;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = y0; y <= y1; y++) {
        const row = y * PROP_W;
        let sum = 0;
        for (let k = -rx; k <= rx; k++) sum += src[row + Math.min(x1, Math.max(x0, x0 + k))]!;
        for (let x = x0; x <= x1; x++) {
          tmp[row + x] = sum / nx;
          sum += src[row + Math.min(x1, x + rx + 1)]! - src[row + Math.max(x0, x - rx)]!;
        }
      }
      for (let x = x0; x <= x1; x++) {
        let sum = 0;
        for (let k = -ry; k <= ry; k++) sum += tmp[Math.min(y1, Math.max(y0, y0 + k)) * PROP_W + x]!;
        for (let y = y0; y <= y1; y++) {
          src[y * PROP_W + x] = sum / ny;
          sum += tmp[Math.min(y1, y + ry + 1) * PROP_W + x]! - tmp[Math.max(y0, y - ry) * PROP_W + x]!;
        }
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * PROP_W + x;
        this.shadow[i] = Math.round(Math.min(1, src[i]!) * 255);
      }
    }
  }

  /**
   * Copia los bytes de una imagen a la capa. Una pieza más al sur tapa a la
   * anterior: la muestra se reemplaza (sin mezclar colores, para conservar los
   * bytes exactos de la foto). Anota la fila de base en las celdas que cubre.
   */
  private blit(img: StampImage, ox: number, oy: number, flip: boolean): void {
    const baseRow = Math.floor((oy + img.h - 1) / PROP_SAMPLES) + 1; // +1: 0 = sin pieza
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
        this.base[Math.floor(dy / PROP_SAMPLES) * GRID_COLS + Math.floor(dx / PROP_SAMPLES)] = baseRow;
      }
    }
  }
}
