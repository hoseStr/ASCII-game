/**
 * Capa de piezas de una sala, compuesta en CPU al entrar:
 *  - rgb:     bytes de la imagen de cada pieza (RGBA8, sin premultiplicar), a
 *             PROP_SX × PROP_SY muestras por celda (proporción de la celda, 3:5).
 *  - form:    la forma del modelo 3D en las mismas muestras (R tono, G líneas) y,
 *             en B, el orden de dibujo + 1 de la pieza que ocupa la muestra: el
 *             contorno de la pieza de delante se dibuja sobre la de detrás.
 *  - cells:   la pieza YA convertida a ASCII, por celda (ver stampConvert.ts):
 *             r, g, b del color y posición en la rampa + 1 (0 = sin pieza). Se sube
 *             tal cual a la GPU; la composición solo la dibuja.
 *  - baseCov: por celda, fila de base de la pieza (+1; 0 = ninguna), que da la
 *             profundidad frente a la princesa, y cobertura de la silueta (0..255),
 *             que da la intensidad del fondo de la silueta.
 *  - shadow:  sombra que cada objeto proyecta sobre el suelo (0 = nada, 255 =
 *             máxima), a SHADOW_S × SHADOW_S muestras por celda. Se usa la sombra
 *             renderizada de la estampa; una pieza en espejo proyecta su silueta.
 * Piezas animadas: animate() cambia de fotograma, recompone y reconvierte SOLO
 * las celdas de cada pieza que cambió (más un anillo de una celda: el contorno
 * de arriba cae en la celda de encima) y deja anotados esos rectángulos para
 * subirlos a la GPU (sin allocations).
 */
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from '../config';
import type { PlacedProp, RockFill } from '../world/props';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../world/tiles';
import { convertCell, newCellResult, PROP_SX, PROP_SY } from './stampConvert';
import { resampleStamp, type GrayImage, type StampAsset, type StampImage } from './stamps';

export { PROP_SX, PROP_SY };
export const PROP_W = GRID_COLS * PROP_SX;
export const PROP_H = GRID_ROWS * PROP_SY;
/** rejilla de sombras: muestras por celda (en x y en y) */
export const SHADOW_S = 4;
export const SHADOW_W = GRID_COLS * SHADOW_S;
export const SHADOW_H = GRID_ROWS * SHADOW_S;

/** Luz de la escena: desde arriba a la izquierda (como el sombreado de los árboles). */
export const SHADOW_DIR_X = 0.5; // unidades a la derecha por unidad de altura
export const SHADOW_DIR_Y = 0.32; // unidades hacia abajo por unidad de altura (sombra aplastada)
const SHADOW_MAX = 0.85; // opacidad junto a la base
const SHADOW_FADE = 0.5; // cuánto se aclara en la punta de la sombra
const RENDER_SHADOW_K = 0.8; // opacidad de las sombras renderizadas
const MAX_DIRTY = 16;
const SHADOW_SAMPLE_W = CELL_ASPECT / SHADOW_S; // unidades por muestra de sombra
const IMG_SAMPLE_H = 1 / PROP_SY; // unidades por fila de muestras de imagen

interface Piece {
  frames: StampImage[];
  forms: StampImage[];
  shadow: GrayImage | null;
  /** desplazamiento de la sombra renderizada, en muestras de sombra */
  shadowX: number;
  shadowY: number;
  /** origen de la pieza, en muestras de imagen (múltiplo de la celda) */
  ox: number;
  oy: number;
  flip: boolean;
  fps: number;
  phase: number;
  cur: number;
  /** orden de dibujo + 1 (canal B de la capa de forma) */
  order: number;
}

/**
 * Celdas que la silueta cubre en ALGÚN fotograma (1 = sí), por estampa: da la
 * fila de base de todas las celdas que la pieza puede ocupar al moverse. Se
 * calcula una vez por juego de fotogramas (las rocas estiradas, por sala).
 */
const unionCache = new WeakMap<StampImage[], Uint8Array>();
function unionCells(frames: StampImage[]): Uint8Array {
  let u = unionCache.get(frames);
  if (u) return u;
  const img0 = frames[0]!;
  const cw = Math.ceil(img0.w / PROP_SX);
  u = new Uint8Array(cw * Math.ceil(img0.h / PROP_SY));
  for (const img of frames) {
    for (let y = 0; y < img.h; y++) {
      const row = Math.floor(y / PROP_SY) * cw;
      for (let x = 0; x < img.w; x++) if (img.data[(y * img.w + x) * 4 + 3]! > 0) u[row + Math.floor(x / PROP_SX)] = 1;
    }
  }
  unionCache.set(frames, u);
  return u;
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
  /** forma de las piezas en las mismas muestras: R tono, G líneas, B orden de dibujo + 1 */
  readonly form = new Uint8Array(PROP_W * PROP_H * 4);
  /** por celda: r, g, b, posición en la rampa + 1 (0 = sin pieza); textura RGBA8UI */
  readonly cells = new Uint8Array(GRID_COLS * GRID_ROWS * 4);
  /** por celda: fila de base + 1 (0 = sin pieza) y cobertura 0..255; textura RG8UI */
  readonly baseCov = new Uint8Array(GRID_COLS * GRID_ROWS * 2);
  /** sombra proyectada en el suelo, 0..255 (textura R8, SHADOW_W × SHADOW_H) */
  readonly shadow = new Uint8Array(SHADOW_W * SHADOW_H);
  private readonly shadowF = new Float32Array(SHADOW_W * SHADOW_H);
  private readonly blurTmp = new Float32Array(SHADOW_W * SHADOW_H);
  private readonly res = newCellResult();
  /** celdas ya convertidas en esta composición (marca por generación, sin borrar) */
  private readonly mark = new Uint32Array(GRID_COLS * GRID_ROWS);
  private gen = 0;
  /** rocas ya estiradas a un rectángulo (id + tamaño): al volver a una sala no se recalculan */
  private readonly rockCache = new Map<string, { frames: StampImage[]; forms: StampImage[]; shadow: GrayImage | null }>();
  private sx0 = 0;
  private sx1 = -1;
  private sy0 = 0;
  private sy1 = -1;
  private pieces: Piece[] = [];
  private animated: Piece[] = [];
  /**
   * Rectángulos sucios tras animate(), EN CELDAS: uno por pieza que cambió de
   * fotograma (x0, y0, x1, y1 inclusivos). Si hay más de MAX_DIRTY, el último
   * absorbe el resto.
   */
  readonly dirtyRects = new Int32Array(MAX_DIRTY * 4);
  dirtyCount = 0;
  /** tiempo de la última composición (ms), para el overlay F3 */
  lastBuildMs = 0;

  build(props: PlacedProp[], rockFills: RockFill[], images: Map<string, StampAsset>): void {
    const t0 = performance.now();
    this.rgb.fill(0);
    this.form.fill(0);
    this.cells.fill(0);
    this.baseCov.fill(0);
    this.shadowF.fill(0);
    this.sx0 = SHADOW_W;
    this.sx1 = -1;
    this.sy0 = SHADOW_H;
    this.sy1 = -1;
    const pieces: Piece[] = [];
    // Rocas: la imagen recortada se estira a su rectángulo de tiles (y su sombra, igual).
    for (const r of rockFills) {
      const asset = images.get(r.def.id);
      if (!asset) continue;
      const src = asset.frames[0]!;
      const w = (r.tx1 - r.tx0 + 1) * TILE_COLS * PROP_SX;
      const h = (r.ty1 - r.ty0 + 1) * TILE_ROWS * PROP_SY;
      const fx = w / src.w;
      const fy = h / src.h;
      const key = `${r.def.id}:${w}x${h}`;
      let fit = this.rockCache.get(key);
      if (!fit) {
        const shadow =
          asset.shadow && r.def.shadowImage
            ? resampleGray(asset.shadow, Math.max(1, Math.round(asset.shadow.w * fx)), Math.max(1, Math.round(asset.shadow.h * fy)))
            : null;
        fit = { frames: asset.frames.map((f) => resampleStamp(f, w, h)), forms: asset.forms.map((f) => resampleStamp(f, w, h)), shadow };
        this.rockCache.set(key, fit);
      }
      pieces.push({
        frames: fit.frames,
        forms: fit.forms,
        shadow: fit.shadow,
        shadowX: Math.round((r.def.shadowImage?.offset[0] ?? 0) * fx),
        shadowY: Math.round((r.def.shadowImage?.offset[1] ?? 0) * fy),
        ox: r.tx0 * TILE_COLS * PROP_SX,
        oy: (HUD_ROWS + r.ty0 * TILE_ROWS) * PROP_SY,
        flip: r.flip,
        fps: 0,
        phase: 0,
        cur: 0,
        order: pieces.length + 1,
      });
    }
    for (const p of props) {
      const asset = images.get(p.def.id);
      if (!asset) continue;
      pieces.push({
        frames: asset.frames,
        forms: asset.forms,
        shadow: asset.shadow,
        shadowX: p.def.shadowImage?.offset[0] ?? 0,
        shadowY: p.def.shadowImage?.offset[1] ?? 0,
        ox: p.tx * TILE_COLS * PROP_SX,
        oy: (HUD_ROWS + p.ty * TILE_ROWS) * PROP_SY,
        flip: p.flip,
        fps: asset.frames.length > 1 ? p.def.fps || 8 : 0,
        // fase por posición: dos plantas iguales no se mecen al unísono
        phase: ((p.tx * 7 + p.ty * 13) % 17) / 17,
        cur: 0,
        order: pieces.length + 1,
      });
    }
    // Primero todas las sombras (caen sobre el suelo), luego las imágenes encima.
    for (const pc of pieces) {
      if (pc.shadow && !pc.flip) {
        this.blitShadow(pc.shadow, (pc.ox / PROP_SX) * SHADOW_S + pc.shadowX, (pc.oy / PROP_SY) * SHADOW_S + pc.shadowY);
      } else this.castShadow(pc.frames[0]!, pc.ox, pc.oy, pc.flip);
    }
    this.blurShadow();
    for (const pc of pieces) {
      this.markBase(pc);
      this.blit(pc, 0, 0, 0, PROP_W - 1, PROP_H - 1);
    }
    // conversión: solo las celdas de cada pieza y su anillo (una vez cada una aunque se solapen)
    const gen = ++this.gen;
    for (const pc of pieces) {
      const img = pc.frames[0]!;
      const cx0 = Math.max(0, Math.floor(pc.ox / PROP_SX) - 1);
      const cy0 = Math.max(0, Math.floor(pc.oy / PROP_SY) - 1);
      const cx1 = Math.min(GRID_COLS - 1, Math.floor((pc.ox + img.w - 1) / PROP_SX) + 1);
      const cy1 = Math.min(GRID_ROWS - 1, Math.floor((pc.oy + img.h - 1) / PROP_SY) + 1);
      this.convertCells(cx0, cy0, cx1, cy1, gen);
    }
    this.pieces = pieces;
    this.animated = pieces.filter((pc) => pc.frames.length > 1);
    this.dirtyCount = 0;
    this.lastBuildMs = performance.now() - t0;
  }

  /**
   * Avanza las piezas animadas al instante `time` (s). Cada pieza que cambia de
   * fotograma anota su rectángulo de celdas, que se recompone entero (todas las
   * piezas que lo tocan, en orden) y se vuelve a convertir. Con `enabled` = false
   * (movimiento reducido) todo queda en el fotograma 0. Devuelve si hay algo que
   * subir a la GPU.
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
      // la pieza y su anillo de una celda (contorno de arriba y vecinas de las muestras del borde)
      const x0 = Math.max(0, Math.floor(pc.ox / PROP_SX) - 1);
      const y0 = Math.max(0, Math.floor(pc.oy / PROP_SY) - 1);
      const x1 = Math.min(GRID_COLS - 1, Math.floor((pc.ox + img.w - 1) / PROP_SX) + 1);
      const y1 = Math.min(GRID_ROWS - 1, Math.floor((pc.oy + img.h - 1) / PROP_SY) + 1);
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

  /** Vacía las celdas, vuelve a pintar en orden las piezas que las tocan (fotograma actual) y las convierte. */
  private recompose(cx0: number, cy0: number, cx1: number, cy1: number): void {
    const x0 = cx0 * PROP_SX;
    const y0 = cy0 * PROP_SY;
    const x1 = (cx1 + 1) * PROP_SX - 1;
    const y1 = (cy1 + 1) * PROP_SY - 1;
    for (let y = y0; y <= y1; y++) {
      this.rgb.fill(0, (y * PROP_W + x0) * 4, (y * PROP_W + x1 + 1) * 4);
      this.form.fill(0, (y * PROP_W + x0) * 4, (y * PROP_W + x1 + 1) * 4);
    }
    for (let i = 0; i < this.pieces.length; i++) {
      const pc = this.pieces[i]!;
      const img = pc.frames[pc.cur]!;
      if (pc.ox > x1 || pc.oy > y1 || pc.ox + img.w - 1 < x0 || pc.oy + img.h - 1 < y0) continue;
      this.blit(pc, pc.cur, x0, y0, x1, y1);
    }
    this.convertCells(cx0, cy0, cx1, cy1);
  }

  /**
   * Convierte a ASCII las celdas del rectángulo (inclusivo) a partir de la capa de
   * muestras. Con `gen`, salta las celdas ya convertidas en esta composición.
   */
  private convertCells(cx0: number, cy0: number, cx1: number, cy1: number, gen = 0): void {
    const res = this.res;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * GRID_COLS + cx;
        if (gen !== 0) {
          if (this.mark[i] === gen) continue;
          this.mark[i] = gen;
        }
        convertCell(this.rgb, this.form, PROP_W, PROP_H, cx * PROP_SX, cy * PROP_SY, res);
        const o = i * 4;
        if (res.pos < 0) {
          this.cells[o] = this.cells[o + 1] = this.cells[o + 2] = this.cells[o + 3] = 0;
        } else {
          this.cells[o] = res.r;
          this.cells[o + 1] = res.g;
          this.cells[o + 2] = res.b;
          this.cells[o + 3] = res.pos + 1;
        }
        this.baseCov[i * 2 + 1] = res.cov;
      }
    }
  }

  /** Sombra renderizada en el estudio (rejilla de sombras): se copia (máximo) sobre la capa. */
  private blitShadow(img: GrayImage, ox: number, oy: number): void {
    for (let y = 0; y < img.h; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= SHADOW_H) continue;
      for (let x = 0; x < img.w; x++) {
        const dx = ox + x;
        if (dx < 0 || dx >= SHADOW_W) continue;
        const v = (img.data[y * img.w + x]! / 255) * RENDER_SHADOW_K;
        if (v <= 0) continue;
        const i = dy * SHADOW_W + dx;
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
   * Sombra proyectada (piezas sin sombra renderizada o en espejo): cada muestra
   * opaca, a una altura h sobre la base del objeto, cae en el suelo desplazada
   * h·(SHADOW_DIR_X, SHADOW_DIR_Y). Más oscura cerca de la base. Se escribe en la
   * rejilla de sombras.
   */
  private castShadow(img: StampImage, ox: number, oy: number, flip: boolean): void {
    const totalH = img.h * IMG_SAMPLE_H;
    const baseRow = Math.floor(((oy + img.h) * SHADOW_S) / PROP_SY) - 1;
    for (let y = 0; y < img.h; y++) {
      const hUnits = (img.h - 1 - y) * IMG_SAMPLE_H; // altura sobre la base
      const strength = SHADOW_MAX * (1 - SHADOW_FADE * (hUnits / Math.max(totalH, 1e-3)));
      // todas las alturas caen sobre la línea de base, desplazadas según su altura
      const dy = baseRow + Math.round(hUnits * SHADOW_DIR_Y * SHADOW_S);
      if (dy < 0 || dy >= SHADOW_H) continue;
      const dxOff = Math.round((hUnits * SHADOW_DIR_X) / SHADOW_SAMPLE_W);
      for (let x = 0; x < img.w; x++) {
        const a = img.data[(y * img.w + (flip ? img.w - 1 - x : x)) * 4 + 3]!;
        if (a === 0) continue;
        const dx = Math.floor(((ox + x) * SHADOW_S) / PROP_SX) + dxOff;
        if (dx < 0 || dx >= SHADOW_W) continue;
        const i = dy * SHADOW_W + dx;
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
    const x1 = Math.min(SHADOW_W - 1, this.sx1 + 2 * rx);
    const y0 = Math.max(0, this.sy0 - 2 * ry);
    const y1 = Math.min(SHADOW_H - 1, this.sy1 + 2 * ry);
    const nx = 2 * rx + 1;
    const ny = 2 * ry + 1;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = y0; y <= y1; y++) {
        const row = y * SHADOW_W;
        let sum = 0;
        for (let k = -rx; k <= rx; k++) sum += src[row + Math.min(x1, Math.max(x0, x0 + k))]!;
        for (let x = x0; x <= x1; x++) {
          tmp[row + x] = sum / nx;
          sum += src[row + Math.min(x1, x + rx + 1)]! - src[row + Math.max(x0, x - rx)]!;
        }
      }
      for (let x = x0; x <= x1; x++) {
        let sum = 0;
        for (let k = -ry; k <= ry; k++) sum += tmp[Math.min(y1, Math.max(y0, y0 + k)) * SHADOW_W + x]!;
        for (let y = y0; y <= y1; y++) {
          src[y * SHADOW_W + x] = sum / ny;
          sum += tmp[Math.min(y1, y + ry + 1) * SHADOW_W + x]! - tmp[Math.max(y0, y - ry) * SHADOW_W + x]!;
        }
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * SHADOW_W + x;
        this.shadow[i] = Math.round(Math.min(1, src[i]!) * 255);
      }
    }
  }

  /** Anota la fila de base en las celdas que la pieza cubre en algún fotograma. */
  private markBase(pc: Piece): void {
    const img = pc.frames[0]!;
    const u = unionCells(pc.frames);
    const cw = Math.ceil(img.w / PROP_SX);
    const ch = Math.ceil(img.h / PROP_SY);
    const c0 = Math.floor(pc.ox / PROP_SX);
    const r0 = Math.floor(pc.oy / PROP_SY);
    const baseRow = Math.floor((pc.oy + img.h - 1) / PROP_SY) + 1; // +1: 0 = sin pieza
    for (let y = 0; y < ch; y++) {
      const row = r0 + y;
      if (row < 0 || row >= GRID_ROWS) continue;
      for (let x = 0; x < cw; x++) {
        if (!u[y * cw + (pc.flip ? cw - 1 - x : x)]) continue;
        const col = c0 + x;
        if (col < 0 || col >= GRID_COLS) continue;
        this.baseCov[(row * GRID_COLS + col) * 2] = baseRow;
      }
    }
  }

  /**
   * Copia los bytes del fotograma `frame` de una pieza (imagen y forma) a la capa,
   * recortando al rectángulo [cx0..cx1]×[cy0..cy1] (muestras). Una pieza más al sur
   * tapa a la anterior: la muestra se reemplaza (sin mezclar colores, para
   * conservar los bytes de la imagen) y queda marcada con su orden de dibujo.
   */
  private blit(pc: Piece, frame: number, cx0: number, cy0: number, cx1: number, cy1: number): void {
    const img = pc.frames[frame]!;
    const form = pc.forms[frame]!.data;
    for (let y = 0; y < img.h; y++) {
      const dy = pc.oy + y;
      if (dy < cy0 || dy > cy1) continue;
      for (let x = 0; x < img.w; x++) {
        const dx = pc.ox + x;
        if (dx < cx0 || dx > cx1) continue;
        const si = (y * img.w + (pc.flip ? img.w - 1 - x : x)) * 4;
        if (img.data[si + 3]! === 0) continue;
        const di = (dy * PROP_W + dx) * 4;
        this.rgb[di] = img.data[si]!;
        this.rgb[di + 1] = img.data[si + 1]!;
        this.rgb[di + 2] = img.data[si + 2]!;
        this.rgb[di + 3] = img.data[si + 3]!;
        this.form[di] = form[si]!;
        this.form[di + 1] = form[si + 1]!;
        this.form[di + 2] = pc.order;
      }
    }
  }
}
