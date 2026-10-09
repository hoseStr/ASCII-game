/**
 * Capa de piezas de una sala, compuesta en CPU una vez al entrar:
 *  - rgb:    bytes REALES de la imagen (RGBA8, sin premultiplicar), a 4 muestras por
 *            celda (160·4 × 54·4). La composición (compose.frag) los convierte a
 *            ASCII tal cual, con el algoritmo del repo: la pieza se ve como la imagen.
 *  - shadow: sombra que cada objeto proyecta sobre el suelo (0 = nada, 255 = máxima).
 *            Si la estampa trae su sombra renderizada (estudio de render), se usa
 *            esa; si no, se proyecta la silueta. Se hornea en el terreno.
 *  - base:   por celda, fila de pantalla donde el objeto toca el suelo (+1; 0 =
 *            sin pieza). Da la profundidad frente a la princesa.
 * Piezas animadas: animate() cambia de fotograma, recompone SOLO la región de cada
 * pieza que cambió y deja anotados esos rectángulos para subirlos a la GPU (sin
 * allocations).
 */
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from '../config';
import type { PlacedProp, RockFill } from '../world/props';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../world/tiles';
import { resampleStamp, type GrayImage, type StampAsset, type StampImage } from './stamps';

export const PROP_SAMPLES = 4;
export const PROP_W = GRID_COLS * PROP_SAMPLES;
export const PROP_H = GRID_ROWS * PROP_SAMPLES;
export const PROP_MODE_PIECE = 1;

/** Luz de la escena: desde arriba a la izquierda (como el sombreado de los árboles). */
export const SHADOW_DIR_X = 0.5; // unidades a la derecha por unidad de altura
export const SHADOW_DIR_Y = 0.32; // unidades hacia abajo por unidad de altura (sombra aplastada)
const SHADOW_MAX = 0.85; // opacidad junto a la base
const SHADOW_FADE = 0.5; // cuánto se aclara en la punta de la sombra
const RENDER_SHADOW_K = 0.8; // opacidad de las sombras renderizadas
const MAX_DIRTY = 16;
const SAMPLE_W_UNITS = CELL_ASPECT / PROP_SAMPLES;
const SAMPLE_H_UNITS = 1 / PROP_SAMPLES;

interface Piece {
  frames: StampImage[];
  shadow: GrayImage | null;
  shadowX: number;
  shadowY: number;
  ox: number;
  oy: number;
  flip: boolean;
  flat: boolean;
  fps: number;
  phase: number;
  cur: number;
}

/** Remuestrea una imagen en grises (promedio por área). */
function resampleGray(img: GrayImage, w: number, h: number): GrayImage {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * img.h) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.h) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * img.w) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.w) / w));
      let s = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) s += img.data[yy * img.w + xx]!;
      data[y * w + x] = Math.round(s / ((sy1 - sy0) * (sx1 - sx0)));
    }
  }
  return { w, h, data };
}

export class PropLayer {
  readonly rgb = new Uint8Array(PROP_W * PROP_H * 4);
  readonly info = new Uint8Array(PROP_W * PROP_H * 4);
  /** sombra proyectada en el suelo, 0..255 (subida como textura R8) */
  readonly shadow = new Uint8Array(PROP_W * PROP_H);
  /** fila de base (+1) por celda, 0 = sin pieza (subida como textura R8UI) */
  readonly base = new Uint8Array(GRID_COLS * GRID_ROWS);
  private readonly shadowF = new Float32Array(PROP_W * PROP_H);
  private readonly blurTmp = new Float32Array(PROP_W * PROP_H);
  private sx0 = 0;
  private sx1 = -1;
  private sy0 = 0;
  private sy1 = -1;
  private pieces: Piece[] = [];
  private animated: Piece[] = [];
  /**
   * Rectángulos sucios tras animate(): uno por pieza que cambió de fotograma
   * (muestras; x0, y0, x1, y1 inclusivos). Si hay más de MAX_DIRTY, el último
   * absorbe el resto.
   */
  readonly dirtyRects = new Int32Array(MAX_DIRTY * 4);
  dirtyCount = 0;
  /** tiempo de la última composición (ms), para el overlay F3 */
  lastBuildMs = 0;

  build(props: PlacedProp[], rockFills: RockFill[], images: Map<string, StampAsset>): void {
    const t0 = performance.now();
    this.rgb.fill(0);
    this.info.fill(0);
    this.base.fill(0);
    this.shadowF.fill(0);
    this.sx0 = PROP_W;
    this.sx1 = -1;
    this.sy0 = PROP_H;
    this.sy1 = -1;
    const pieces: Piece[] = [];
    // Rocas: la imagen recortada se estira a su rectángulo de tiles (y su sombra, igual).
    for (const r of rockFills) {
      const asset = images.get(r.def.id);
      if (!asset) continue;
      const src = asset.frames[0]!;
      const w = (r.tx1 - r.tx0 + 1) * TILE_COLS * PROP_SAMPLES;
      const h = (r.ty1 - r.ty0 + 1) * TILE_ROWS * PROP_SAMPLES;
      const fx = w / src.w;
      const fy = h / src.h;
      let shadow: GrayImage | null = null;
      if (asset.shadow && r.def.shadowImage) {
        shadow = resampleGray(asset.shadow, Math.max(1, Math.round(asset.shadow.w * fx)), Math.max(1, Math.round(asset.shadow.h * fy)));
      }
      pieces.push({
        frames: asset.frames.map((f) => resampleStamp(f, w, h)),
        shadow,
        shadowX: Math.round((r.def.shadowImage?.offset[0] ?? 0) * fx),
        shadowY: Math.round((r.def.shadowImage?.offset[1] ?? 0) * fy),
        ox: r.tx0 * TILE_COLS * PROP_SAMPLES,
        oy: (HUD_ROWS + r.ty0 * TILE_ROWS) * PROP_SAMPLES,
        flip: false,
        flat: r.def.shadow === 'flat',
        fps: 0,
        phase: 0,
        cur: 0,
      });
    }
    for (const p of props) {
      const asset = images.get(p.def.id);
      if (!asset) continue;
      pieces.push({
        frames: asset.frames,
        shadow: asset.shadow,
        shadowX: p.def.shadowImage?.offset[0] ?? 0,
        shadowY: p.def.shadowImage?.offset[1] ?? 0,
        ox: p.tx * TILE_COLS * PROP_SAMPLES,
        oy: (HUD_ROWS + p.ty * TILE_ROWS) * PROP_SAMPLES,
        flip: p.flip,
        flat: p.def.shadow === 'flat',
        fps: asset.frames.length > 1 ? p.def.fps || 8 : 0,
        // fase por posición: dos helechos iguales no se mecen al unísono
        phase: ((p.tx * 7 + p.ty * 13) % 17) / 17,
        cur: 0,
      });
    }
    // Primero todas las sombras (caen sobre el suelo), luego las imágenes encima.
    for (const pc of pieces) {
      if (pc.shadow && !pc.flip) this.blitShadow(pc.shadow, pc.ox + pc.shadowX, pc.oy + pc.shadowY);
      else this.castShadow(pc.frames[0]!, pc.ox, pc.oy, pc.flip, pc.flat);
    }
    this.blurShadow();
    for (const pc of pieces) {
      for (const f of pc.frames) this.markBase(f, pc.ox, pc.oy, pc.flip);
      this.blit(pc.frames[0]!, pc.ox, pc.oy, pc.flip, 0, 0, PROP_W - 1, PROP_H - 1);
    }
    this.pieces = pieces;
    this.animated = pieces.filter((pc) => pc.frames.length > 1);
    this.dirtyCount = 0;
    this.lastBuildMs = performance.now() - t0;
  }

  /**
   * Avanza las piezas animadas al instante `time` (s). Cada pieza que cambia de
   * fotograma anota su rectángulo, que se recompone entero (todas las piezas que
   * lo tocan, en orden). Con `enabled` = false (movimiento reducido) todo queda en
   * el fotograma 0. Devuelve si hay algo que subir a la GPU.
   */
  animate(time: number, enabled: boolean): boolean {
    const r = this.dirtyRects;
    let count = 0;
    for (let i = 0; i < this.animated.length; i++) {
      const pc = this.animated[i]!;
      const n = pc.frames.length;
      const f = enabled ? Math.floor(time * pc.fps + pc.phase * n) % n : 0;
      if (f === pc.cur) continue;
      pc.cur = f;
      const img = pc.frames[f]!;
      const x0 = Math.max(0, pc.ox);
      const y0 = Math.max(0, pc.oy);
      const x1 = Math.min(PROP_W - 1, pc.ox + img.w - 1);
      const y1 = Math.min(PROP_H - 1, pc.oy + img.h - 1);
      if (count < MAX_DIRTY) {
        r[count * 4] = x0;
        r[count * 4 + 1] = y0;
        r[count * 4 + 2] = x1;
        r[count * 4 + 3] = y1;
        count++;
      } else {
        const k = (MAX_DIRTY - 1) * 4;
        r[k] = Math.min(r[k]!, x0);
        r[k + 1] = Math.min(r[k + 1]!, y0);
        r[k + 2] = Math.max(r[k + 2]!, x1);
        r[k + 3] = Math.max(r[k + 3]!, y1);
      }
    }
    this.dirtyCount = count;
    for (let k = 0; k < count; k++) this.recompose(r[k * 4]!, r[k * 4 + 1]!, r[k * 4 + 2]!, r[k * 4 + 3]!);
    return count > 0;
  }

  /** Vacía la región y vuelve a pintar, en orden, las piezas que la tocan (con su fotograma actual). */
  private recompose(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y <= y1; y++) {
      this.rgb.fill(0, (y * PROP_W + x0) * 4, (y * PROP_W + x1 + 1) * 4);
      this.info.fill(0, (y * PROP_W + x0) * 4, (y * PROP_W + x1 + 1) * 4);
    }
    for (let i = 0; i < this.pieces.length; i++) {
      const pc = this.pieces[i]!;
      const img = pc.frames[pc.cur]!;
      if (pc.ox > x1 || pc.oy > y1 || pc.ox + img.w - 1 < x0 || pc.oy + img.h - 1 < y0) continue;
      this.blit(img, pc.ox, pc.oy, pc.flip, x0, y0, x1, y1);
    }
  }

  /** Sombra renderizada en el estudio: se copia (máximo) sobre la capa de sombras. */
  private blitShadow(img: GrayImage, ox: number, oy: number): void {
    for (let y = 0; y < img.h; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= PROP_H) continue;
      for (let x = 0; x < img.w; x++) {
        const dx = ox + x;
        if (dx < 0 || dx >= PROP_W) continue;
        const v = (img.data[y * img.w + x]! / 255) * RENDER_SHADOW_K;
        if (v <= 0) continue;
        const i = dy * PROP_W + dx;
        if (v > this.shadowF[i]!) this.shadowF[i] = v;
        this.growShadowBox(dx, dy);
      }
    }
  }

  private growShadowBox(dx: number, dy: number): void {
    if (dx < this.sx0) this.sx0 = dx;
    if (dx > this.sx1) this.sx1 = dx;
    if (dy < this.sy0) this.sy0 = dy;
    if (dy > this.sy1) this.sy1 = dy;
  }

  /**
   * Sombra proyectada (estampas sin sombra renderizada): cada muestra opaca, a una
   * altura h sobre la base del objeto, cae en el suelo desplazada
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
        this.growShadowBox(dx, dy);
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

  /** Anota la fila de base en las celdas que cubre la imagen. */
  private markBase(img: StampImage, ox: number, oy: number, flip: boolean): void {
    const baseRow = Math.floor((oy + img.h - 1) / PROP_SAMPLES) + 1; // +1: 0 = sin pieza
    for (let y = 0; y < img.h; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= PROP_H) continue;
      for (let x = 0; x < img.w; x++) {
        if (img.data[(y * img.w + (flip ? img.w - 1 - x : x)) * 4 + 3]! === 0) continue;
        const dx = ox + x;
        if (dx < 0 || dx >= PROP_W) continue;
        this.base[Math.floor(dy / PROP_SAMPLES) * GRID_COLS + Math.floor(dx / PROP_SAMPLES)] = baseRow;
      }
    }
  }

  /**
   * Copia los bytes de una imagen a la capa, recortando al rectángulo
   * [cx0..cx1]×[cy0..cy1]. Una pieza más al sur tapa a la anterior: la muestra se
   * reemplaza (sin mezclar colores, para conservar los bytes exactos de la imagen).
   */
  private blit(img: StampImage, ox: number, oy: number, flip: boolean, cx0: number, cy0: number, cx1: number, cy1: number): void {
    for (let y = 0; y < img.h; y++) {
      const dy = oy + y;
      if (dy < cy0 || dy > cy1) continue;
      for (let x = 0; x < img.w; x++) {
        const dx = ox + x;
        if (dx < cx0 || dx > cx1) continue;
        const si = (y * img.w + (flip ? img.w - 1 - x : x)) * 4;
        if (img.data[si + 3]! === 0) continue;
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
