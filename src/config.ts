/** Constantes globales (decisiones aprobadas en la Fase 0). */

/** Grilla lógica fija. */
export const GRID_COLS = 160;
export const GRID_ROWS = 54;

/** Proporción ancho/alto ideal de la celda: 3:5, como los videos del repo (6×10 px). */
export const CELL_ASPECT = 3 / 5;

/** Frecuencia fija de la simulación. */
export const SIM_HZ = 60;

export type Quality = 'low' | 'medium' | 'high';

export interface QualityPreset {
  /** muestras por lado de celda en la capa pictórica (S×S se promedian) */
  samples: number;
  bloomLevels: number;
  octaves: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { samples: 1, bloomLevels: 2, octaves: 3 },
  medium: { samples: 2, bloomLevels: 3, octaves: 4 },
  high: { samples: 4, bloomLevels: 4, octaves: 5 },
};

export const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high'];
