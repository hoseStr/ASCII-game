import { describe, expect, it } from 'vitest';
import { MATERIALS, RAMPS, RESERVED_ENTITY_GLYPHS } from '../src/render/glyphs';

describe('reglas de legibilidad', () => {
  it('el decorado nunca usa glifos reservados para entidades', () => {
    const reserved = new Set(Array.from(RESERVED_ENTITY_GLYPHS));
    const clashes: string[] = [];
    for (const m of MATERIALS) {
      for (const ch of Array.from(RAMPS[m].glyphs)) if (reserved.has(ch)) clashes.push(`${m}:${ch}`);
    }
    expect(clashes).toEqual([]);
  });
});
