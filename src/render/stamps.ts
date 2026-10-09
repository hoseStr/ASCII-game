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

/**
 * Conversión pura de una estampa a celdas, idéntica (bit a bit) a la que hace el
 * shader de composición (compose.frag) con las piezas. Por celda de S×S muestras:
 *  - cobertura: la celda es parte de la pieza si Σalfa ≥ la mitad (en bytes);
 *  - color: promedio de las muestras ponderado por su alfa, redondeado a 8 bits
 *    (el color real de la foto, como los píxeles del repo);
 *  - glifo: L = media de (R+G+B)/3 de los píxeles (np.mean del repo, ponderada
 *    por alfa en los bordes) e índice = min(floor(L·N/255), N−1) en la rampa de
 *    70 del repo. Todo con enteros: sin diferencias de redondeo entre CPU y GPU.
 */
export function convertStamp(img: StampImage, samples: number, direction: RampDirection = 'light'): StampCell[][] {
  const ramp = Array.from(REPO_RAMP_COMPLEX); // de más tinta a vacío (sentido ink)
  const n = ramp.length;
  const cols = img.w / samples;
  const rows = img.h / samples;
  const half = (samples * samples * 255) / 2;
  const out: StampCell[][] = [];
  for (let cy = 0; cy < rows; cy++) {
    const row: StampCell[] = [];
    for (let cx = 0; cx < cols; cx++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let y = 0; y < samples; y++) {
        for (let x = 0; x < samples; x++) {
          const i = ((cy * samples + y) * img.w + cx * samples + x) * 4;
          const a = img.data[i + 3]!;
          sr += img.data[i]! * a;
          sg += img.data[i + 1]! * a;
          sb += img.data[i + 2]! * a;
          sa += a;
        }
      }
      if (sa < half) {
        row.push({ char: '', r: 0, g: 0, b: 0 });
        continue;
      }
      // floor(Σc·a / Σa + 0,5) con enteros
      const r8 = Math.floor((2 * sr + sa) / (2 * sa));
      const g8 = Math.floor((2 * sg + sa) / (2 * sa));
      const b8 = Math.floor((2 * sb + sa) / (2 * sa));
      const idx = Math.min(Math.floor(((sr + sg + sb) * n) / (765 * sa)), n - 1);
      row.push({ char: ramp[direction === 'ink' ? idx : n - 1 - idx]!, r: r8 / 255, g: g8 / 255, b: b8 / 255 });
    }
    out.push(row);
  }
  return out;
}
