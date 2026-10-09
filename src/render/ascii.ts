/**
 * Port fiel del conversor de ASCII-generator (vietnh1009, licencia MIT).
 *
 * Este módulo replica exactamente el algoritmo de los scripts originales:
 *   - celda de muestreo: ancho = W / numCols, alto = 2 · ancho (cell_height = 2 * cell_width);
 *   - muestreo: promedio del bloque completo de píxeles de la celda (cortes con int());
 *   - luminancia: media sin pesos de R, G y B (versión a color) o BT.601 de OpenCV (versión gris);
 *   - índice: min(floor(L · N / 255), N − 1) sobre una rampa de "más tinta → vacío";
 *   - color: promedio del bloque dividido por el área nominal de la celda.
 *
 * El shader de composición (shaders/compose.frag) implementa la misma fórmula en GLSL.
 * Los tests dorados comparan este módulo con la salida real de img2txt.py.
 */

/** Rampa `complex` del repo (70 glifos, de más tinta a vacío). */
export const REPO_RAMP_COMPLEX =
  "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ";

/** Rampa `simple` del repo (10 glifos). */
export const REPO_RAMP_SIMPLE = '@%#*+=-:. ';

/**
 * Sentido de la rampa.
 * - `ink`: literal del repo ("tinta sobre papel"): más luz → glifo más ralo; el blanco es un espacio.
 * - `light`: rampa invertida para fondo oscuro: más luz → glifo más denso (decisión aprobada en Fase 0).
 */
export type RampDirection = 'light' | 'ink';

/** Luminancia de la versión a color del repo: np.mean sobre los 3 canales (sin pesos). */
export function lumaMean(r: number, g: number, b: number): number {
  return (r + g + b) / 3;
}

/**
 * Luminancia de la versión en gris: cv2.COLOR_BGR2GRAY (BT.601 en punto fijo).
 * OpenCV 4 usa coeficientes de 15 bits (verificado de forma exhaustiva sobre los
 * 16,7 M colores RGB contra cv2 4.11). OpenCV 3, con el que se generó la demo de
 * 2018, usaba 14 bits (4899, 9617, 1868); difieren en ±1 en ~0,3 % de los píxeles.
 */
export function lumaBT601Cv(r: number, g: number, b: number): number {
  return (r * 9798 + g * 19235 + b * 3735 + 16384) >> 15;
}

/** Índice en la rampa: min(int(L · N / 255), N − 1), con L en 0..255. */
export function rampIndex(luma: number, rampLength: number): number {
  const i = Math.floor((luma * rampLength) / 255);
  return i < rampLength - 1 ? (i < 0 ? 0 : i) : rampLength - 1;
}

/**
 * Glifo para una luminancia. `ramp` va ordenada como en el repo (más tinta primero).
 * En sentido `light` se recorre al revés, de modo que la luz máxima cae en el glifo más denso.
 */
export function glyphForLuma(luma: number, ramp: string, direction: RampDirection = 'ink'): string {
  const chars = Array.from(ramp);
  const i = rampIndex(luma, chars.length);
  return chars[direction === 'ink' ? i : chars.length - 1 - i]!;
}

export interface SamplingGrid {
  cellWidth: number;
  cellHeight: number;
  numCols: number;
  numRows: number;
}

/**
 * Geometría de muestreo del repo, incluido su ajuste de seguridad
 * ("Too many columns or rows. Use default setting").
 */
export function samplingGrid(width: number, height: number, numCols: number, scale = 2): SamplingGrid {
  let cellWidth = width / numCols;
  let cellHeight = scale * cellWidth;
  let numRows = Math.trunc(height / cellHeight);
  if (numCols > width || numRows > height) {
    cellWidth = 6;
    cellHeight = 12;
    numCols = Math.trunc(width / cellWidth);
    numRows = Math.trunc(height / cellHeight);
  }
  return { cellWidth, cellHeight, numCols, numRows };
}

/** Límites enteros del bloque (i, j), con la misma truncación que el slicing de NumPy del repo. */
function blockBounds(grid: SamplingGrid, width: number, height: number, i: number, j: number) {
  const y0 = Math.trunc(i * grid.cellHeight);
  const y1 = Math.min(Math.trunc((i + 1) * grid.cellHeight), height);
  const x0 = Math.trunc(j * grid.cellWidth);
  const x1 = Math.min(Math.trunc((j + 1) * grid.cellWidth), width);
  return { x0, x1, y0, y1 };
}

/**
 * img2txt.py: imagen en gris (un byte por píxel) → líneas de texto.
 */
export function convertGray(
  gray: Uint8Array,
  width: number,
  height: number,
  numCols: number,
  ramp: string = REPO_RAMP_COMPLEX,
): string[] {
  const chars = Array.from(ramp);
  const n = chars.length;
  const grid = samplingGrid(width, height, numCols);
  const lines: string[] = [];
  for (let i = 0; i < grid.numRows; i++) {
    let line = '';
    for (let j = 0; j < grid.numCols; j++) {
      const { x0, x1, y0, y1 } = blockBounds(grid, width, height, i, j);
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) sum += gray[row + x]!;
      }
      const mean = sum / ((x1 - x0) * (y1 - y0));
      line += chars[Math.min(Math.trunc((mean * n) / 255), n - 1)];
    }
    lines.push(line);
  }
  return lines;
}

export interface ColorCell {
  char: string;
  r: number;
  g: number;
  b: number;
}

/**
 * img2img_color.py / video2video_color.py: imagen RGB intercalada → celdas (glifo + color).
 * El color se divide por el área nominal cell_w · cell_h, como en el original.
 */
export function convertColor(
  rgb: Uint8Array,
  width: number,
  height: number,
  numCols: number,
  ramp: string = REPO_RAMP_COMPLEX,
): ColorCell[][] {
  const chars = Array.from(ramp);
  const n = chars.length;
  const grid = samplingGrid(width, height, numCols);
  const nominalArea = grid.cellHeight * grid.cellWidth;
  const rows: ColorCell[][] = [];
  for (let i = 0; i < grid.numRows; i++) {
    const row: ColorCell[] = [];
    for (let j = 0; j < grid.numCols; j++) {
      const { x0, x1, y0, y1 } = blockBounds(grid, width, height, i, j);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const k = (y * width + x) * 3;
          sr += rgb[k]!;
          sg += rgb[k + 1]!;
          sb += rgb[k + 2]!;
        }
      }
      const count = (x1 - x0) * (y1 - y0);
      // np.mean(partial_image) sobre los 3 canales = (ΣR + ΣG + ΣB) / (3 · count)
      const mean = (sr + sg + sb) / (3 * count);
      row.push({
        char: chars[Math.min(Math.trunc((mean * n) / 255), n - 1)]!,
        r: Math.trunc(sr / nominalArea),
        g: Math.trunc(sg / nominalArea),
        b: Math.trunc(sb / nominalArea),
      });
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Port corregido de utils.sort_chars: ordena glifos por tinta medida (de menos a más),
 * de forma estable ante empates. El original medía franjas de 10 px con glifos de 12 px de avance; aquí la cobertura
 * se mide por celda exacta en el atlas (render/atlas.ts) y se pasa ya calculada.
 */
export function sortByCoverage(glyphs: readonly string[], coverage: (g: string) => number): string[] {
  return [...glyphs]
    .map((g, i) => ({ g, c: coverage(g), i }))
    .sort((a, b) => a.c - b.c || a.i - b.i)
    .map((e) => e.g);
}
