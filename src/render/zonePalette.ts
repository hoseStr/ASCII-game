/**
 * Paletas de zona: datos en OKLCH (src/data/palettes.json) → uniforms.
 * Los colores de superficie viajan en OKLab (los shaders mezclan en OKLab);
 * las luces, en RGB lineal.
 */
import palettesJson from '../data/palettes.json';
import { oklchToLinear, oklchToOklabInGamut, oklchToSrgb, type Oklch, type Vec3 } from './palette';

/** Ranuras de color que entiende la capa pictórica (el orden define el índice en GLSL). */
export const PALETTE_SLOTS = [
  'voidTop',
  'voidBottom',
  'ground',
  'groundDeep',
  'moss',
  'rim',
  'cliff',
  'cliffDeep',
  'fog',
  'starA',
  'starB',
  'starC',
  'crystal',
  'ambient',
  'water',
  'waterDeep',
  'canopy',
  'canopyDark',
  'trunk',
  'path',
  'flower',
  'flowerB',
  'shore',
] as const;
export type PaletteSlot = (typeof PALETTE_SLOTS)[number];

export interface ZoneData {
  name: string;
  surface: Record<PaletteSlot, Oklch>;
  lights: Record<string, Oklch>;
  ui: Record<string, Oklch>;
  paper: Oklch;
  ambient: number;
  exposure: number;
  fog: number;
}

export interface ZonePaletteGpu {
  /** nombre visible de la zona */
  name: string;
  /** OKLab de cada ranura, plano (3 floats por ranura) para uniform3fv. */
  surfaceOklab: Float32Array;
  lights: Record<string, Vec3>;
  ui: Record<string, Vec3>;
  paper: Vec3;
  ambient: number;
  exposure: number;
  fog: number;
}

const zones = palettesJson as unknown as Record<string, ZoneData>;

export function loadZonePalette(id: string): ZonePaletteGpu {
  const z = zones[id];
  if (!z) throw new Error(`Paleta de zona desconocida: ${id}`);
  const surfaceOklab = new Float32Array(PALETTE_SLOTS.length * 3);
  PALETTE_SLOTS.forEach((slot, i) => {
    const c = z.surface[slot];
    if (!c) throw new Error(`La paleta '${id}' no define '${slot}'`);
    surfaceOklab.set(oklchToOklabInGamut(c), i * 3);
  });
  const mapValues = (rec: Record<string, Oklch>, f: (c: Oklch) => Vec3): Record<string, Vec3> =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, f(v)]));
  return {
    name: z.name,
    surfaceOklab,
    lights: mapValues(z.lights, oklchToLinear),
    ui: mapValues(z.ui, oklchToSrgb),
    paper: oklchToSrgb(z.paper),
    ambient: z.ambient,
    exposure: z.exposure,
    fog: z.fog,
  };
}
