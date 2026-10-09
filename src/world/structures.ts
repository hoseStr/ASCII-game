/**
 * Estructuras construidas de la sala (capa semántica): puentes de tablas y
 * cuerda tendidos sobre el vacío. Se precalculan al entrar en la sala y cada
 * fotograma se copian al buffer de celdas iluminadas por la luz de CPU.
 */
import { CELL_ASPECT } from '../config';
import type { CellBuffer } from '../render/cellBuffer';
import { glyphIndex } from '../render/glyphs';
import { oklchToSrgb } from '../render/palette';
import type { FrameParams } from '../render/renderer';
import { lightLevel } from '../systems/lighting';
import { tileAt, type Tilemap } from './room';
import { HUD_ROWS, TILE, TILE_COLS, TILE_ROWS } from './tiles';

const ROPE = oklchToSrgb([0.8, 0.05, 75]);
const PLANK = oklchToSrgb([0.62, 0.07, 55]);
const UNDER = oklchToSrgb([0.2, 0.03, 40]);

/** Patrones de 5×3 celdas: H = puente este-oeste, V = puente norte-sur. 'r' cuerda, 'p' tabla. */
const BRIDGE_H = { glyphs: ['─────', '║║║║║', '─────'], keys: ['rrrrr', 'ppppp', 'rrrrr'] };
const BRIDGE_V = { glyphs: ['│═══│', '│═══│', '│═══│'], keys: ['rpppr', 'rpppr', 'rpppr'] };

export class Structures {
  count = 0;
  private readonly col: Int16Array;
  private readonly row: Int16Array;
  private readonly glyph: Uint16Array;
  private readonly rgb: Float32Array;

  constructor(capacity = 160 * 48) {
    this.col = new Int16Array(capacity);
    this.row = new Int16Array(capacity);
    this.glyph = new Uint16Array(capacity);
    this.rgb = new Float32Array(capacity * 3);
  }

  build(map: Tilemap): void {
    this.count = 0;
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const t = tileAt(map, tx, ty);
        const pattern = t === TILE.bridgeH ? BRIDGE_H : t === TILE.bridgeV ? BRIDGE_V : null;
        if (!pattern) continue;
        for (let y = 0; y < TILE_ROWS; y++) {
          const glyphs = Array.from(pattern.glyphs[y]!);
          for (let x = 0; x < TILE_COLS; x++) {
            const i = this.count++;
            this.col[i] = tx * TILE_COLS + x;
            this.row[i] = HUD_ROWS + ty * TILE_ROWS + y;
            this.glyph[i] = glyphIndex(glyphs[x]!);
            const c = pattern.keys[y]![x] === 'r' ? ROPE : PLANK;
            this.rgb.set(c, i * 3);
          }
        }
      }
    }
  }

  /** Copia las estructuras al buffer, coloreadas por la luz local (como el resto del mundo). */
  draw(cells: CellBuffer, f: FrameParams, ambient: number): void {
    for (let i = 0; i < this.count; i++) {
      const x = (this.col[i]! + 0.5) * CELL_ASPECT;
      const y = this.row[i]! + 0.5;
      const light = Math.min(1.6, 0.35 + 0.55 * lightLevel(f, x, y, ambient));
      const o = i * 3;
      cells.put(
        this.col[i]!,
        this.row[i]!,
        this.glyph[i]!,
        this.rgb[o]! * light,
        this.rgb[o + 1]! * light,
        this.rgb[o + 2]! * light,
        0,
        false,
        UNDER[0] * light,
        UNDER[1] * light,
        UNDER[2] * light,
        0.92,
      );
    }
  }
}
