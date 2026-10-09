/**
 * Imágenes de las estampas: los PNG procesados por tools/make_stamps.py se
 * decodifican una sola vez al arrancar. Se conservan los bytes reales de la foto
 * (RGBA de 8 bits): en el juego se convierten a ASCII tal cual, con el algoritmo
 * del repo, sin tinte ni luz, y con aritmética entera exacta (CPU = GPU).
 */
import type { RampDirection } from './ascii';
import { REPO_RAMP_COMPLEX } from './ascii';
import type { StampDef } from '../world/props';

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

export async function loadStampImages(defs: Map<string, StampDef>): Promise<Map<string, StampImage>> {
  const out = new Map<string, StampImage>();
  await Promise.all(
    [...defs.values()].map(async (def) => {
      const url = urls[`../assets/stamps/${def.image}`];
      if (!url) throw new Error(`Estampa '${def.id}': falta la imagen ${def.image}`);
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const w = def.cells[0] * def.samples;
      const h = def.cells[1] * def.samples;
      if (bmp.width !== w || bmp.height !== h) {
        throw new Error(`Estampa '${def.id}': la imagen mide ${bmp.width}×${bmp.height}, se esperaba ${w}×${h}`);
      }
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      out.set(def.id, stampImageFromRgba(ctx.getImageData(0, 0, w, h).data, w, h));
    }),
  );
  return out;
}

export interface StampCell {
  /** glifo de la rampa del repo, o '' si la celda queda fuera de la silueta */
  char: string;
  r: number;
  g: number;
  b: number;
}

/** Resultado de convertir un bloque de S×S muestras (ver convertBlock). */
export interface BlockResult {
  /** Σ alfa (bytes); la celda es parte de la pieza si ≥ S·S·255/2 */
  sumA: number;
  r8: number;
  g8: number;
  b8: number;
  /** índice en la rampa del repo (sentido ink: 0 = más tinta) */
  idx: number;
}

/**
 * Conversión de un bloque de S×S muestras RGBA8, idéntica (bit a bit) a la que
 * hace el shader de composición (compose.frag) con las piezas:
 *  - color: promedio de las muestras ponderado por su alfa, redondeado a 8 bits;
 *  - índice: L = media de (R+G+B)/3 de los píxeles (np.mean del repo, ponderada
 *    por alfa en los bordes); idx = min(floor(L·N/255), N−1). Todo con enteros.
 */
export function convertBlock(data: Uint8Array, stride: number, x0: number, y0: number, samples: number, n: number, out: BlockResult): BlockResult {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sa = 0;
  for (let y = 0; y < samples; y++) {
    for (let x = 0; x < samples; x++) {
      const i = ((y0 + y) * stride + x0 + x) * 4;
      const a = data[i + 3]!;
      sr += data[i]! * a;
      sg += data[i + 1]! * a;
      sb += data[i + 2]! * a;
      sa += a;
    }
  }
  out.sumA = sa;
  if (sa === 0) {
    out.r8 = out.g8 = out.b8 = out.idx = 0;
    return out;
  }
  out.r8 = Math.floor((2 * sr + sa) / (2 * sa));
  out.g8 = Math.floor((2 * sg + sa) / (2 * sa));
  out.b8 = Math.floor((2 * sb + sa) / (2 * sa));
  out.idx = Math.min(Math.floor(((sr + sg + sb) * n) / (765 * sa)), n - 1);
  return out;
}

/**
 * Conversión pura de una estampa a celdas (la misma que se ve en el juego): cada
 * celda con al menos media cobertura toma el color real de la foto y el glifo de
 * la rampa de 70 del repo; el resto queda fuera de la silueta (char '').
 */
export function convertStamp(img: StampImage, samples: number, direction: RampDirection = 'light'): StampCell[][] {
  const ramp = Array.from(REPO_RAMP_COMPLEX); // de más tinta a vacío (sentido ink)
  const n = ramp.length;
  const half = (samples * samples * 255) / 2;
  const res: BlockResult = { sumA: 0, r8: 0, g8: 0, b8: 0, idx: 0 };
  const out: StampCell[][] = [];
  for (let cy = 0; cy < img.h / samples; cy++) {
    const row: StampCell[] = [];
    for (let cx = 0; cx < img.w / samples; cx++) {
      convertBlock(img.data, img.w, cx * samples, cy * samples, samples, n, res);
      if (res.sumA < half) {
        row.push({ char: '', r: 0, g: 0, b: 0 });
        continue;
      }
      row.push({ char: ramp[direction === 'ink' ? res.idx : n - 1 - res.idx]!, r: res.r8 / 255, g: res.g8 / 255, b: res.b8 / 255 });
    }
    out.push(row);
  }
  return out;
}

/**
 * Remuestrea una estampa a w×h muestras (promedio por área, ponderado por alfa,
 * con enteros): se usa para estirar una foto de roca a su rectángulo de tiles.
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
