import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  REPO_RAMP_COMPLEX,
  REPO_RAMP_SIMPLE,
  convertColor,
  convertGray,
  glyphForLuma,
  lumaBT601Cv,
  lumaMean,
  rampIndex,
  samplingGrid,
  sortByCoverage,
} from '../src/render/ascii';

const fixture = (name: string): string => new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

/** Imagen sintética (tools/make_golden.py) convertida a gris igual que cv2.COLOR_BGR2GRAY. */
function loadSyntheticGray(): { gray: Uint8Array; rgb: Uint8Array; w: number; h: number } {
  const w = 400;
  const h = 240;
  const rgb = new Uint8Array(gunzipSync(readFileSync(fixture('synthetic_400x240.rgb.gz'))));
  expect(rgb.length).toBe(w * h * 3);
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = lumaBT601Cv(rgb[3 * i]!, rgb[3 * i + 1]!, rgb[3 * i + 2]!);
  return { gray, rgb, w, h };
}

function loadGolden(name: string): string[] {
  return readFileSync(fixture(name), 'ascii').split(/\r?\n/).filter((l) => l.length > 0);
}

describe('rampas del repo', () => {
  it('conserva longitud y extremos', () => {
    expect(Array.from(REPO_RAMP_COMPLEX)).toHaveLength(70);
    expect(REPO_RAMP_COMPLEX[0]).toBe('$');
    expect(REPO_RAMP_COMPLEX.at(-1)).toBe(' ');
    expect(REPO_RAMP_COMPLEX).toContain('\\|');
    expect(REPO_RAMP_SIMPLE).toBe('@%#*+=-:. ');
  });
});

describe('fórmulas', () => {
  it('rampIndex = min(floor(L·N/255), N−1)', () => {
    expect(rampIndex(0, 70)).toBe(0);
    expect(rampIndex(255, 70)).toBe(69);
    expect(rampIndex(254.99, 70)).toBe(69);
    expect(rampIndex(3.65, 70)).toBe(1);
    expect(rampIndex(3.64, 70)).toBe(0);
    expect(rampIndex(-5, 10)).toBe(0);
  });

  it('luminancia a color = media sin pesos; gris = BT.601 de OpenCV', () => {
    expect(lumaMean(255, 0, 0)).toBe(85);
    expect(lumaMean(30, 60, 90)).toBe(60);
    expect(lumaBT601Cv(255, 255, 255)).toBe(255);
    expect(lumaBT601Cv(255, 0, 0)).toBe(76);
    expect(lumaBT601Cv(0, 255, 0)).toBe(150);
    expect(lumaBT601Cv(0, 0, 255)).toBe(29);
  });

  it('sentido ink = repo literal; sentido light = invertido', () => {
    expect(glyphForLuma(0, REPO_RAMP_COMPLEX, 'ink')).toBe('$');
    expect(glyphForLuma(255, REPO_RAMP_COMPLEX, 'ink')).toBe(' ');
    expect(glyphForLuma(0, REPO_RAMP_COMPLEX, 'light')).toBe(' ');
    expect(glyphForLuma(255, REPO_RAMP_COMPLEX, 'light')).toBe('$');
  });

  it('geometría de muestreo con celdas 1:2 y el ajuste de seguridad del repo', () => {
    const g = samplingGrid(976, 538, 150);
    expect(g.numRows).toBe(41);
    expect(g.cellHeight).toBeCloseTo((2 * 976) / 150);
    const fallback = samplingGrid(400, 240, 450);
    expect(fallback).toEqual({ cellWidth: 6, cellHeight: 12, numCols: 66, numRows: 20 });
  });
});

describe('fidelidad dorada contra img2txt.py original', () => {
  const cases: Array<[string, number, string]> = [
    ['golden_complex_150.txt', 150, REPO_RAMP_COMPLEX],
    ['golden_complex_97.txt', 97, REPO_RAMP_COMPLEX],
    ['golden_simple_100.txt', 100, REPO_RAMP_SIMPLE],
    ['golden_complex_450.txt', 450, REPO_RAMP_COMPLEX],
  ];
  const { gray, w, h } = loadSyntheticGray();
  for (const [file, cols, ramp] of cases) {
    it(`${file}: 100 % de celdas idénticas`, () => {
      const expected = loadGolden(file);
      const actual = convertGray(gray, w, h, cols, ramp);
      expect(actual.length).toBe(expected.length);
      let mismatches = 0;
      for (let r = 0; r < expected.length; r++) {
        for (let c = 0; c < expected[r]!.length; c++) if (expected[r]![c] !== actual[r]![c]) mismatches++;
      }
      expect(mismatches).toBe(0);
      expect(actual).toEqual(expected);
    });
  }
});

describe('versión a color', () => {
  it('usa la media sin pesos para el glifo y el área nominal para el color', () => {
    // Imagen 4×2 de un solo color: con 2 columnas, celda 2×4 nominal pero solo 2 filas reales.
    const w = 4;
    const h = 8;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) rgb.set([200, 100, 0], 3 * i);
    const cells = convertColor(rgb, w, h, 2);
    expect(cells).toHaveLength(2);
    const cell = cells[0]![0]!;
    // media = (200+100+0)/3 = 100 → índice floor(100·70/255) = 27
    expect(cell.char).toBe(REPO_RAMP_COMPLEX[27]);
    expect([cell.r, cell.g, cell.b]).toEqual([200, 100, 0]);
  });
});

describe('sortByCoverage (port corregido de sort_chars)', () => {
  it('ordena de menos a más tinta, estable ante empates', () => {
    const cov: Record<string, number> = { a: 0.3, b: 0.1, c: 0.1, d: 0.0 };
    expect(sortByCoverage(['a', 'b', 'c', 'd'], (g) => cov[g]!)).toEqual(['d', 'b', 'c', 'a']);
  });
});
