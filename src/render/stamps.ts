/**
 * Imágenes de las estampas: los PNG procesados por tools/make_stamps.py (renders
 * de modelos 3D, revelados para ASCII, y su forma: tono y líneas del modelo) se
 * decodifican una sola vez al arrancar. Se conservan sus bytes (RGBA de 8 bits);
 * la conversión a ASCII de cada celda está en stampConvert.ts.
 */
import type { StampDef } from '../world/props';
import { convertCell, newCellResult, PROP_RAMP, PROP_SX, PROP_SY } from './stampConvert';

const urls = import.meta.glob('../assets/stamps/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface StampImage {
  w: number;
  h: number;
  /** RGBA de 8 bits por muestra (sRGB, sin premultiplicar) */
  data: Uint8Array;
}

export function stampImageFromRgba(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): StampImage {
  return { w, h, data: Uint8Array.from(rgba) };
}

/** Mapa de grises de 8 bits (sombras renderizadas). */
export interface GrayImage {
  w: number;
  h: number;
  data: Uint8Array;
}

/**
 * Una estampa lista para usar: sus fotogramas, la forma de cada uno (RGBA: R tono
 * de la forma, G líneas del modelo, B 0) y, si la tiene, su sombra renderizada.
 */
export interface StampAsset {
  frames: StampImage[];
  forms: StampImage[];
  shadow: GrayImage | null;
}

/** Separa una tira vertical de fotogramas en imágenes (vistas sobre los mismos bytes). */
export function splitFrames(strip: StampImage, frames: number): StampImage[] {
  const fh = strip.h / frames;
  const size = strip.w * fh * 4;
  return Array.from({ length: frames }, (_, k) => ({ w: strip.w, h: fh, data: strip.data.subarray(k * size, (k + 1) * size) }));
}

async function decodeImage(url: string): Promise<{ w: number; h: number; rgba: Uint8ClampedArray }> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const out = { w: bmp.width, h: bmp.height, rgba: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
  bmp.close();
  return out;
}

export async function loadStampImages(defs: Map<string, StampDef>): Promise<Map<string, StampAsset>> {
  const out = new Map<string, StampAsset>();
  await Promise.all(
    [...defs.values()].map(async (def) => {
      const url = urls[`../assets/stamps/${def.image}`];
      if (!url) throw new Error(`Estampa '${def.id}': falta la imagen ${def.image}`);
      const furl = urls[`../assets/stamps/${def.form}`];
      if (!furl) throw new Error(`Estampa '${def.id}': falta la forma ${def.form}`);
      const [img, form] = await Promise.all([decodeImage(url), decodeImage(furl)]);
      const frames = Math.max(1, def.frames || 1);
      const w = def.cells[0] * def.samples[0];
      const h = def.cells[1] * def.samples[1] * frames;
      for (const [name, im] of [['imagen', img], ['forma', form]] as const) {
        if (im.w !== w || im.h !== h) throw new Error(`Estampa '${def.id}': la ${name} mide ${im.w}×${im.h}, se esperaba ${w}×${h}`);
      }
      let shadow: GrayImage | null = null;
      if (def.shadowImage) {
        const surl = urls[`../assets/stamps/${def.shadowImage.image}`];
        if (!surl) throw new Error(`Estampa '${def.id}': falta la sombra ${def.shadowImage.image}`);
        const sh = await decodeImage(surl);
        const data = new Uint8Array(sh.w * sh.h);
        for (let i = 0; i < data.length; i++) data[i] = sh.rgba[i * 4]!;
        shadow = { w: sh.w, h: sh.h, data };
      }
      out.set(def.id, {
        frames: splitFrames(stampImageFromRgba(img.rgba, img.w, img.h), frames),
        forms: splitFrames(stampImageFromRgba(form.rgba, form.w, form.h), frames),
        shadow,
      });
    }),
  );
  return out;
}

export interface StampCell {
  /** glifo de la rampa del repo, o '' si la celda queda fuera de la silueta */
  char: string;
  /** posición en la rampa (sentido light), −1 fuera de la silueta */
  pos: number;
  r: number;
  g: number;
  b: number;
  /** cobertura de la silueta, 0..1 */
  cov: number;
}

/**
 * Una estampa (PROP_SX × PROP_SY muestras por celda) y su forma convertidas a
 * celdas con la misma conversión que el juego (stampConvert.ts). Para la página
 * de depuración y los tests; el juego convierte sobre la capa de la sala.
 */
export function convertStamp(img: StampImage, form: StampImage): StampCell[][] {
  const res = newCellResult();
  const out: StampCell[][] = [];
  for (let cy = 0; cy < img.h / PROP_SY; cy++) {
    const row: StampCell[] = [];
    for (let cx = 0; cx < img.w / PROP_SX; cx++) {
      convertCell(img.data, form.data, img.w, img.h, cx * PROP_SX, cy * PROP_SY, res);
      row.push({
        char: res.pos < 0 ? '' : PROP_RAMP[res.pos]!,
        pos: res.pos,
        r: res.r / 255,
        g: res.g / 255,
        b: res.b / 255,
        cov: res.cov / 255,
      });
    }
    out.push(row);
  }
  return out;
}

/**
 * Remuestrea una estampa a w×h muestras (promedio por área, ponderado por alfa,
 * con enteros): se usa para estirar una roca a su rectángulo de tiles. Con la
 * imagen de forma (alfa 255 en todas las muestras) es el promedio por área.
 */
export function resampleStamp(img: StampImage, w: number, h: number): StampImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * img.h) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.h) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * img.w) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.w) / w));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let count = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const i = (yy * img.w + xx) * 4;
          const a = img.data[i + 3]!;
          sr += img.data[i]! * a;
          sg += img.data[i + 1]! * a;
          sb += img.data[i + 2]! * a;
          sa += a;
          count++;
        }
      }
      const o = (y * w + x) * 4;
      data[o + 3] = Math.floor((2 * sa + count) / (2 * count));
      if (sa > 0) {
        data[o] = Math.floor((2 * sr + sa) / (2 * sa));
        data[o + 1] = Math.floor((2 * sg + sa) / (2 * sa));
        data[o + 2] = Math.floor((2 * sb + sa) / (2 * sa));
      }
    }
  }
  return { w, h, data };
}
