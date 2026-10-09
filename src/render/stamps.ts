/**
 * Imágenes de las estampas: los PNG procesados por tools/make_stamps.py se
 * decodifican una sola vez al arrancar y se pasan a OKLab (L, a, b, alfa).
 */
import type { StampDef } from '../world/props';
import { linearRgbToOklab, srgbToLinear } from './palette';

const urls = import.meta.glob('../assets/stamps/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface StampImage {
  w: number;
  h: number;
  /** OKLab + alfa por muestra, sin premultiplicar */
  data: Float32Array;
}

/** RGBA de 8 bits (sRGB) → OKLab + alfa. */
export function rgbaToOklab(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): StampImage {
  const data = new Float32Array(w * h * 4);
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    rgb[0] = srgbToLinear(rgba[i * 4]! / 255);
    rgb[1] = srgbToLinear(rgba[i * 4 + 1]! / 255);
    rgb[2] = srgbToLinear(rgba[i * 4 + 2]! / 255);
    const lab = linearRgbToOklab(rgb);
    data[i * 4] = lab[0];
    data[i * 4 + 1] = lab[1];
    data[i * 4 + 2] = lab[2];
    data[i * 4 + 3] = rgba[i * 4 + 3]! / 255;
  }
  return { w, h, data };
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
      out.set(def.id, rgbaToOklab(ctx.getImageData(0, 0, w, h).data, w, h));
    }),
  );
  return out;
}
