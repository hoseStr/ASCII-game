/**
 * Capa de piezas de una sala, compuesta en CPU una vez al entrar:
 *  - lab:  OKLab premultiplicado + alfa a 4 muestras por celda (160·4 × 54·4);
 *  - info: material de la rampa (+1), modo (1 pieza, 2 textura de roca) y si es sólida;
 *  - sdf:  distancia con signo a la silueta de las piezas sólidas, por celda
 *          (alimenta los contornos y el anillo de sombra del horneado del terreno).
 * El color de cada foto se lleva hacia la paleta de la zona (tinte), conservando
 * su luz y su forma. Los buffers se reservan una vez (sin allocations por sala,
 * salvo el cálculo del SDF).
 */
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from '../config';
import type { PlacedProp, RockFill, StampDef } from '../world/props';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../world/tiles';
import { signedDistanceField } from './field';
import { MATERIAL_ID } from './glyphs';
import type { StampImage } from './stamps';
import { PALETTE_SLOTS, type PaletteSlot, type ZonePaletteGpu } from './zonePalette';

export const PROP_SAMPLES = 4;
export const PROP_W = GRID_COLS * PROP_SAMPLES;
export const PROP_H = GRID_ROWS * PROP_SAMPLES;
export const PROP_MODE_PIECE = 1;
export const PROP_MODE_ROCK = 2;
const SDF_FAR = 50;

/**
 * Tinte de zona de una muestra OKLab. La luminancia normalizada del sujeto se
 * remapea al rango del color de la paleta (de 0,5·L a 1,12·L, con techo 0,9 para
 * que las fotos claras no se quemen con el bloom) y se mezcla según
 * `strength`; el croma original se conserva en `keepChroma` y se mezcla con el
 * del slot. Es monótono en L: la foto conserva su luz.
 */
export function tintLab(
  L: number,
  a: number,
  b: number,
  lo: number,
  hi: number,
  slotL: number,
  slotA: number,
  slotB: number,
  strength: number,
  keepChroma: number,
  out: Float32Array,
  o: number,
): void {
  const n = Math.min(1, Math.max(0, (L - lo) / Math.max(1e-3, hi - lo)));
  const tLo = slotL * 0.5;
  const tHi = Math.min(0.9, slotL * 1.12);
  const Lt = tLo + n * (tHi - tLo);
  out[o] = L + (Lt - L) * strength;
  const ka = a * keepChroma;
  const kb = b * keepChroma;
  out[o + 1] = ka + (slotA - ka) * strength;
  out[o + 2] = kb + (slotB - kb) * strength;
}

export class PropLayer {
  readonly lab = new Float32Array(PROP_W * PROP_H * 4);
  readonly info = new Uint8Array(PROP_W * PROP_H * 4);
  readonly sdf = new Float32Array(GRID_COLS * GRID_ROWS);
  private readonly cellAlpha = new Float32Array(GRID_COLS * GRID_ROWS);
  private readonly solidMask = new Uint8Array(GRID_COLS * GRID_ROWS);
  private readonly px = new Float32Array(4);
  /** tiempo de la última composición (ms), para el overlay F3 */
  lastBuildMs = 0;

  build(props: PlacedProp[], rockFills: RockFill[], palette: ZonePaletteGpu, images: Map<string, StampImage>): void {
    const t0 = performance.now();
    this.lab.fill(0);
    this.info.fill(0);
    this.cellAlpha.fill(0);
    for (const r of rockFills) this.drawRockFill(r, palette, images);
    for (const p of props) this.drawProp(p, palette, images);

    let solid = 0;
    const S2 = PROP_SAMPLES * PROP_SAMPLES;
    for (let i = 0; i < this.solidMask.length; i++) {
      this.solidMask[i] = this.cellAlpha[i]! / S2 > 0.5 ? 1 : 0;
      solid += this.solidMask[i]!;
    }
    if (solid === 0) {
      this.sdf.fill(SDF_FAR);
    } else {
      const d = signedDistanceField(this.solidMask, GRID_COLS, GRID_ROWS, CELL_ASPECT);
      for (let i = 0; i < d.length; i++) this.sdf[i] = Math.min(SDF_FAR, d[i]!);
    }
    this.lastBuildMs = performance.now() - t0;
  }

  private slot(def: StampDef): number {
    const i = PALETTE_SLOTS.indexOf(def.tint.slot as PaletteSlot);
    if (i < 0) throw new Error(`Estampa '${def.id}': slot de tinte desconocido '${def.tint.slot}'`);
    return i * 3;
  }

  private drawProp(p: PlacedProp, palette: ZonePaletteGpu, images: Map<string, StampImage>): void {
    const img = images.get(p.def.id);
    if (!img) return;
    const pal = palette.surfaceOklab;
    const s = this.slot(p.def);
    const { strength, keepChroma } = p.def.tint;
    const [lo, hi] = p.def.lum;
    const matId = MATERIAL_ID[p.def.ramp] + 1;
    const ox = p.tx * TILE_COLS * PROP_SAMPLES;
    const oy = (HUD_ROWS + p.ty * TILE_ROWS) * PROP_SAMPLES;
    const px = this.px;
    for (let y = 0; y < img.h; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= PROP_H) continue;
      for (let x = 0; x < img.w; x++) {
        const si = (y * img.w + (p.flip ? img.w - 1 - x : x)) * 4;
        const a = img.data[si + 3]!;
        if (a <= 0.004) continue;
        const dx = ox + x;
        if (dx < 0 || dx >= PROP_W) continue;
        tintLab(img.data[si]!, img.data[si + 1]!, img.data[si + 2]!, lo, hi, pal[s]!, pal[s + 1]!, pal[s + 2]!, strength, keepChroma, px, 0);
        const di = (dy * PROP_W + dx) * 4;
        const k = 1 - a;
        this.lab[di] = px[0]! * a + this.lab[di]! * k;
        this.lab[di + 1] = px[1]! * a + this.lab[di + 1]! * k;
        this.lab[di + 2] = px[2]! * a + this.lab[di + 2]! * k;
        this.lab[di + 3] = a + this.lab[di + 3]! * k;
        if (a >= 0.5) {
          this.info[di] = matId;
          this.info[di + 1] = PROP_MODE_PIECE;
          this.info[di + 2] = p.def.solid ? 255 : 0;
        }
        this.info[di + 3] = Math.round(this.lab[di + 3]! * 255);
        if (p.def.solid) {
          const c = Math.floor(dy / PROP_SAMPLES) * GRID_COLS + Math.floor(dx / PROP_SAMPLES);
          this.cellAlpha[c]! += a;
        }
      }
    }
  }

  /** Textura de roca estirada a la caja del grupo (bilineal); el shader la recorta a la forma de la roca. */
  private drawRockFill(r: RockFill, palette: ZonePaletteGpu, images: Map<string, StampImage>): void {
    const img = images.get(r.def.id);
    if (!img) return;
    const pal = palette.surfaceOklab;
    const s = this.slot(r.def);
    const { strength, keepChroma } = r.def.tint;
    const [lo, hi] = r.def.lum;
    const x0 = r.tx0 * TILE_COLS * PROP_SAMPLES;
    const y0 = (HUD_ROWS + r.ty0 * TILE_ROWS) * PROP_SAMPLES;
    const bw = (r.tx1 - r.tx0 + 1) * TILE_COLS * PROP_SAMPLES;
    const bh = (r.ty1 - r.ty0 + 1) * TILE_ROWS * PROP_SAMPLES;
    const px = this.px;
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
        for (let c = 0; c < 3; c++) {
          const p00 = img.data[(vy * img.w + ux) * 4 + c]!;
          const p10 = img.data[(vy * img.w + ux1) * 4 + c]!;
          const p01 = img.data[(vy1 * img.w + ux) * 4 + c]!;
          const p11 = img.data[(vy1 * img.w + ux1) * 4 + c]!;
          px[c] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
        }
        const di = (dy * PROP_W + dx) * 4;
        tintLab(px[0]!, px[1]!, px[2]!, lo, hi, pal[s]!, pal[s + 1]!, pal[s + 2]!, strength, keepChroma, this.lab, di);
        this.lab[di + 3] = 1;
        this.info[di] = MATERIAL_ID[r.def.ramp] + 1;
        this.info[di + 1] = PROP_MODE_ROCK;
        this.info[di + 2] = 0;
        this.info[di + 3] = 255;
      }
    }
  }
}
