/**
 * HUD (6 filas superiores). Fase 2: nombre de la sala y de la zona, y un
 * minimapa del overworld 3×3 con las salas visitadas. Los corazones, motas,
 * llaves, objeto equipado y fragmentos llegan en la Fase 4.
 */
import { GRID_COLS } from '../config';
import type { CellBuffer } from '../render/cellBuffer';
import { glyphIndex, glyphRun } from '../render/glyphs';
import type { ZonePaletteGpu } from '../render/zonePalette';
import { HUD_ROWS } from '../world/tiles';

const MAP_COL = GRID_COLS - 14;
const MAP_ROW = 1;

export class Hud {
  private nameRun: Uint16Array = new Uint16Array(0);
  private zoneRun: Uint16Array = new Uint16Array(0);
  private nameAge = 0;
  private readonly line = glyphIndex('─');
  private readonly dot = glyphIndex('·');
  private readonly full = glyphIndex('■');
  private readonly hollow = glyphIndex('□');

  setRoom(name: string, zone: string): void {
    this.nameRun = glyphRun(name);
    // la zona solo se muestra si aporta algo (no repite el nombre de la sala)
    this.zoneRun = glyphRun(zone === name ? '' : zone);
    this.nameAge = 0;
  }

  step(dt: number): void {
    this.nameAge += dt;
  }

  draw(
    cells: CellBuffer,
    pal: ZonePaletteGpu,
    grid: string[][],
    currentId: string,
    visited: ReadonlySet<string>,
  ): void {
    const p = pal.paper;
    const bgR = p[0] * 0.8;
    const bgG = p[1] * 0.8;
    const bgB = p[2] * 0.8;
    for (let row = 0; row < HUD_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) cells.put(col, row, 0, 0, 0, 0, 0, false, bgR, bgG, bgB, 1);
    }
    const dim = pal.ui.textDim!;
    const text = pal.ui.text!;
    const accent = pal.ui.accent!;
    // filete inferior
    for (let col = 2; col < GRID_COLS - 2; col++) {
      cells.put(col, HUD_ROWS - 1, this.line, dim[0] * 0.55, dim[1] * 0.55, dim[2] * 0.55, 0, false, bgR, bgG, bgB, 1);
    }
    // nombre de la sala: aparece con un fundido al entrar
    const fade = Math.min(1, this.nameAge / 0.8);
    for (let k = 0; k < this.nameRun.length; k++) {
      const appear = Math.min(1, Math.max(0, fade * (this.nameRun.length + 8) - k) / 8);
      if (appear <= 0) continue;
      cells.put(4 + k, 2, this.nameRun[k]!, text[0] * appear, text[1] * appear, text[2] * appear, 0, false, bgR, bgG, bgB, 1);
    }
    for (let k = 0; k < this.zoneRun.length; k++) {
      cells.put(4 + k, 3, this.zoneRun[k]!, dim[0] * fade, dim[1] * fade, dim[2] * fade, 0, false, bgR, bgG, bgB, 1);
    }
    // minimapa
    for (let gy = 0; gy < grid.length; gy++) {
      const line = grid[gy]!;
      for (let gx = 0; gx < line.length; gx++) {
        const id = line[gx]!;
        const col = MAP_COL + gx * 4;
        const row = MAP_ROW + gy;
        let glyph = this.dot;
        let c = dim;
        let k = 0.6;
        if (id === currentId) {
          glyph = this.full;
          c = accent;
          k = 1;
        } else if (visited.has(id)) {
          glyph = this.hollow;
          c = text;
          k = 0.8;
        }
        for (let w = 0; w < 2; w++) {
          cells.put(col + w, row, glyph, c[0] * k, c[1] * k, c[2] * k, id === currentId ? 0.5 : 0, false, bgR, bgG, bgB, 1);
        }
      }
    }
  }
}
