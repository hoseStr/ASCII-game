/**
 * Capa semántica: una celda por posición de la grilla, en typed arrays que se
 * suben tal cual como texturas cada fotograma (sin allocations).
 *   glyphFlags: Uint16 ×2 (índice de glifo en el atlas, flags) → RG16UI
 *   fg, bg:     Uint8 ×4 (RGBA)                                  → RGBA8
 */
import { FLAG_CLEAR, FLAG_EMISSIVE, FLAG_OCCUPIED } from './shaders';

export class CellBuffer {
  readonly glyphFlags: Uint16Array;
  readonly fg: Uint8Array;
  readonly bg: Uint8Array;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.glyphFlags = new Uint16Array(cols * rows * 2);
    this.fg = new Uint8Array(cols * rows * 4);
    this.bg = new Uint8Array(cols * rows * 4);
  }

  clear(): void {
    this.glyphFlags.fill(0);
    this.fg.fill(0);
    this.bg.fill(0);
  }

  /**
   * Escribe una celda. Colores en sRGB 0..1; `emissive` (0..1) alimenta el bloom;
   * `clear` pide despejar la capa pictórica alrededor; `bgA` 0 deja ver el fondo
   * pictórico. Parámetros posicionales: sin objetos temporales en el bucle caliente.
   */
  put(
    col: number,
    row: number,
    glyph: number,
    r: number,
    g: number,
    b: number,
    emissive = 0,
    clear = false,
    bgR = 0,
    bgG = 0,
    bgB = 0,
    bgA = 0,
  ): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    const i = row * this.cols + col;
    let flags = FLAG_OCCUPIED;
    if (emissive > 0) flags |= FLAG_EMISSIVE;
    if (clear) flags |= FLAG_CLEAR;
    this.glyphFlags[i * 2] = glyph;
    this.glyphFlags[i * 2 + 1] = flags;
    const o = i * 4;
    this.fg[o] = to8(r);
    this.fg[o + 1] = to8(g);
    this.fg[o + 2] = to8(b);
    this.fg[o + 3] = to8(emissive);
    this.bg[o] = to8(bgR);
    this.bg[o + 1] = to8(bgG);
    this.bg[o + 2] = to8(bgB);
    this.bg[o + 3] = to8(bgA);
  }

  /**
   * Escribe una fila de glifos ya resueltos a índices del atlas. Con `bgA` > 0
   * también ocupa los espacios (texto sobre una banda de fondo legible).
   */
  putRun(
    col: number,
    row: number,
    glyphs: Uint16Array,
    r: number,
    g: number,
    b: number,
    bgR = 0,
    bgG = 0,
    bgB = 0,
    bgA = 0,
  ): void {
    for (let k = 0; k < glyphs.length; k++) {
      if (glyphs[k] !== 0 || bgA > 0) this.put(col + k, row, glyphs[k]!, r, g, b, 0, false, bgR, bgG, bgB, bgA);
    }
  }
}

function to8(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 255 : Math.round(x * 255);
}
