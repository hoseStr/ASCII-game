import { describe, expect, it } from 'vitest';
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from '../src/config';
import { CellBuffer } from '../src/render/cellBuffer';
import { atlasGlyphList } from '../src/render/glyphs';
import { createFrameParams } from '../src/render/renderer';
import { parseRoomMap } from '../src/world/room';
import { Structures } from '../src/world/structures';
import { HUD_ROWS, TILE_COLS, TILE_ROWS } from '../src/world/tiles';

// Sala de prueba: isla en las columnas 8..23 (filas 4..11); puente este-oeste de la
// isla al borde oeste (filas 7-8) y puente norte-sur de la isla al vacío del sur que
// llega a otra isla (columnas 15-16, filas 12..13; tierra en la fila 14).
const rows = Array.from({ length: 16 }, (_, y) =>
  Array.from({ length: 32 }, (_, x) => {
    if (x >= 8 && x <= 23 && y >= 4 && y <= 11) return ',';
    if ((y === 7 || y === 8) && x < 8) return '=';
    if ((x === 15 || x === 16) && (y === 12 || y === 13)) return 'H';
    if (y === 14 && x >= 13 && x <= 18) return ',';
    return '.';
  }).join(''),
);
const map = parseRoomMap(rows.join('\n'), 'puentes');
const st = new Structures();
st.build(map);
const cells = new CellBuffer(GRID_COLS, GRID_ROWS);
st.draw(cells, createFrameParams(), 0.9);
const glyphs = atlasGlyphList();
const at = (col: number, row: number): string => {
  const i = row * GRID_COLS + col;
  return cells.glyphFlags[i * 2 + 1] ? glyphs[cells.glyphFlags[i * 2]!]! : '';
};

describe('puentes compuestos enteros', () => {
  // puente este-oeste: celdas 0..39, filas de pantalla HUD + 21..26
  const r0 = HUD_ROWS + 7 * TILE_ROWS;
  const r1 = HUD_ROWS + 9 * TILE_ROWS - 1;
  const c1 = 8 * TILE_COLS - 1;

  it('un farol en cada esquina de la cabecera de tierra, ninguno en el borde de la pantalla', () => {
    expect(at(c1, r0)).toBe('¤');
    expect(at(c1, r1)).toBe('¤');
    expect(at(0, r0)).not.toBe('¤');
    expect(at(0, r1)).not.toBe('¤');
  });

  it('una luz por cabecera de tierra, entre sus dos faroles', () => {
    // este-oeste (una cabecera) + norte-sur (tierra a los dos lados)
    expect(st.lightCount).toBe(3);
    expect(st.lights[0]).toBeCloseTo((c1 + 0.5) * CELL_ASPECT);
    expect(st.lights[1]).toBeCloseTo((r0 + r1) / 2 + 0.5);
  });

  it('el pasamanos se comba entre postes: - junto al poste, _ en el centro del tramo', () => {
    const rail = Array.from({ length: c1 + 1 }, (_, c) => at(c, r0)).join('');
    expect(rail).toContain('┬');
    expect(rail).toMatch(/[┬¤]-\.?_+\.?-[┬¤]/);
  });

  it('el tablero: un tablón por columna con su junta, y la madera de fondo', () => {
    let seams = 0;
    for (let c = 0; c <= c1; c++) for (let r = r0 + 1; r < r1; r++) if (at(c, r) === '│' || at(c, r) === '¦') seams++;
    expect(seams).toBeGreaterThan(0.9 * (c1 + 1) * (r1 - r0 - 1));
    const i = (r0 + 2) * GRID_COLS + 10;
    expect(cells.bg[i * 4 + 3]).toBe(255); // tablón opaco: la madera tapa el vacío
  });

  it('bajo el puente, las cuerdas cuelgan de los postes sobre el vacío', () => {
    const hanging = Array.from({ length: c1 + 1 }, (_, c) => at(c, r1 + 1)).filter((g) => g === '¦').length;
    expect(hanging).toBeGreaterThan(0);
  });

  it('puente norte-sur: cuerdas a los lados, tablones por fila y faroles en las dos cabeceras', () => {
    const c0 = 15 * TILE_COLS;
    const cR = 17 * TILE_COLS - 1;
    const top = HUD_ROWS + 12 * TILE_ROWS;
    const bottom = HUD_ROWS + 14 * TILE_ROWS - 1;
    for (const c of [c0, cR]) {
      expect(at(c, top)).toBe('¤');
      expect(at(c, bottom)).toBe('¤');
      expect(at(c, top + 2)).toMatch(/[│┼]/);
    }
    expect(at(c0 + 3, top + 2)).toMatch(/[─=]/);
  });

  it('es determinista', () => {
    const again = new Structures();
    again.build(map);
    const other = new CellBuffer(GRID_COLS, GRID_ROWS);
    again.draw(other, createFrameParams(), 0.9);
    expect(other.glyphFlags).toEqual(cells.glyphFlags);
    expect(other.fg).toEqual(cells.fg);
  });
});
