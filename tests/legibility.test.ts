import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MATERIALS, PROCEDURAL_GLYPHS, RAMPS, RESERVED_ENTITY_GLYPHS, atlasGlyphList } from '../src/render/glyphs';
import { buildSpriteSheet, type SpriteDef } from '../src/render/sprites';

const spriteFile = (name: string): string =>
  readFileSync(new URL(`../src/data/sprites/${name}`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), 'utf8');

describe('reglas de legibilidad', () => {
  it('el decorado nunca usa glifos reservados para entidades', () => {
    const reserved = new Set(Array.from(RESERVED_ENTITY_GLYPHS));
    const clashes: string[] = [];
    for (const m of MATERIALS) {
      for (const ch of Array.from(RAMPS[m].glyphs)) if (reserved.has(ch)) clashes.push(`${m}:${ch}`);
    }
    expect(clashes).toEqual([]);
  });

  it('los sprites de entidades solo usan glifos reservados y registrados en el atlas', () => {
    const reserved = new Set(Array.from(RESERVED_ENTITY_GLYPHS));
    const atlas = new Set(atlasGlyphList());
    const def = JSON.parse(spriteFile('princess.json')) as SpriteDef;
    const sheet = buildSpriteSheet(spriteFile('princess.txt'), def);
    const notReserved = [...sheet.glyphSet].filter((g) => g !== ' ' && !reserved.has(g));
    const notInAtlas = [...sheet.glyphSet].filter((g) => !atlas.has(g));
    expect(notReserved).toEqual([]);
    expect(notInAtlas).toEqual([]);
    expect(PROCEDURAL_GLYPHS.length).toBeGreaterThan(0);
  });
});
