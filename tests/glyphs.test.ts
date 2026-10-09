import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MATERIALS,
  PROCEDURAL_GLYPHS,
  RAMPS,
  RESERVED_ENTITY_GLYPHS,
  STRETCHED_GLYPHS,
  atlasGlyphList,
} from '../src/render/glyphs';
import { parseTrueType } from '../src/render/ttf';

const fontPath = new URL('../src/assets/fonts/DejaVuSansMono-Bold.ttf', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const buf = readFileSync(fontPath);
const font = parseTrueType(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

describe('lector TrueType', () => {
  it('lee las métricas de DejaVu Sans Mono Bold', () => {
    expect(font.unitsPerEm).toBe(2048);
    expect(font.advanceOf('A')).toBe(1233);
    expect(font.typoAscender).toBe(1556);
    expect(font.typoDescender).toBe(-492);
  });

  it('detecta glifos ausentes', () => {
    expect(font.has('A')).toBe(true);
    expect(font.has('─')).toBe(false); // box-drawing: ausente en la Bold
    expect(font.has('⚷')).toBe(false);
    expect(font.advanceOf('⚷')).toBe(-1);
  });
});

describe('cobertura de la fuente', () => {
  const procedural = new Set(Array.from(PROCEDURAL_GLYPHS));
  const standard = font.advanceOf('M');

  it('todo glifo no procedural del atlas existe en la fuente con avance monoespaciado', () => {
    const problems: string[] = [];
    for (const ch of atlasGlyphList()) {
      if (procedural.has(ch)) continue;
      const adv = font.advanceOf(ch);
      if (adv < 0) problems.push(`${ch} U+${ch.codePointAt(0)!.toString(16)} ausente`);
      else if (adv !== standard) problems.push(`${ch} avance ${adv} ≠ ${standard}`);
    }
    expect(problems).toEqual([]);
  });

  it('los sombreados estirados existen en la fuente', () => {
    for (const ch of Array.from(STRETCHED_GLYPHS)) expect(font.has(ch)).toBe(true);
  });
});

describe('rampas', () => {
  it('cada rampa empieza en el espacio y no repite glifos', () => {
    for (const m of MATERIALS) {
      const g = Array.from(RAMPS[m].glyphs);
      expect(g[0], m).toBe(' ');
      expect(new Set(g).size, m).toBe(g.length);
    }
  });

  it('la rampa base es la del repo invertida (70 glifos)', () => {
    expect(Array.from(RAMPS.base.glyphs)).toHaveLength(70);
    expect(RAMPS.base.glyphs.at(-1)).toBe('$');
  });

  it('atlas: índice 0 = espacio y sin duplicados', () => {
    const list = atlasGlyphList();
    expect(list[0]).toBe(' ');
    expect(new Set(list).size).toBe(list.length);
    expect(list.length).toBeLessThan(512);
    for (const ch of Array.from(RESERVED_ENTITY_GLYPHS)) expect(list).toContain(ch);
  });
});
