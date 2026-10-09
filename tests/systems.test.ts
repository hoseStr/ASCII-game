import { describe, expect, it } from 'vitest';
import { buildSpriteSheet, mirrorGlyph, parseSpriteText, type SpriteDef } from '../src/render/sprites';
import { PARTICLE_STRIDE } from '../src/render/shaders';
import { Particles } from '../src/systems/particles';
import { Transition } from '../src/world/transitions';

describe('pool de partículas', () => {
  it('reutiliza huecos sin crecer y respeta la capacidad', () => {
    const p = new Particles(4);
    for (let i = 0; i < 4; i++) expect(p.spawn(0, 0, 0, 0, 1, 0.5, 1, 1, 1, 1)).toBeGreaterThanOrEqual(0);
    expect(p.spawn(0, 0, 0, 0, 1, 0.5, 1, 1, 1, 1)).toBe(-1);
    p.update(1.5); // todas mueren
    expect(p.active).toBe(0);
    expect(p.spawn(0, 0, 0, 0, 1, 0.5, 1, 1, 1, 1)).toBeGreaterThanOrEqual(0);
    expect(p.active).toBe(1);
  });

  it('integra velocidad y gravedad y escribe el buffer de vértices', () => {
    const p = new Particles(2);
    p.spawn(10, 10, 2, 0, 1, 0.5, 1, 0.1, 0.2, 0.3, 'light', 0, 4);
    p.update(0.5);
    const out = new Float32Array(2 * PARTICLE_STRIDE);
    expect(p.write(out, 6, 2)).toBe(1);
    expect(out[0]).toBeCloseTo(11, 5);
    // vy = 4·0,5 = 2 → y += 2·0,5 = 1; más la banda del HUD (6)
    expect(out[1]).toBeCloseTo(10 + 1 + 6, 5);
    expect(out[4]).toBeCloseTo(0.1, 5);
  });
});

describe('transiciones', () => {
  it('avanzan, se suavizan y terminan exactamente una vez', () => {
    const t = new Transition();
    t.start('slide', 'east', 1);
    expect(t.active).toBe(true);
    expect(t.update(0.5)).toBe(false);
    expect(t.eased).toBeCloseTo(0.5, 5);
    expect(t.update(0.6)).toBe(true);
    expect(t.active).toBe(false);
    expect(t.update(0.1)).toBe(false);
    expect(t.t).toBe(1);
  });
});

describe('sprites', () => {
  const text = ['@frame right.idle.0', '◜♛▙ ', '▐█• ', ':colors', 'hCh.', 'hhs.'].join('\n');
  const def: SpriteDef = {
    width: 4,
    height: 2,
    anchor: [1, 1],
    colors: {
      h: { fg: [0.8, 0.05, 290] },
      C: { fg: [0.9, 0.15, 85], emissive: 0.5 },
      s: { fg: [0.3, 0.1, 280], bg: [0.86, 0.04, 50] },
    },
  };

  it('lee fotogramas con capa de color y rellena filas cortas', () => {
    const frames = parseSpriteText(text, 4, 2);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.glyphs[0]).toEqual(['◜', '♛', '▙', ' ']);
  });

  it('genera la vista izquierda espejando la derecha', () => {
    const sheet = buildSpriteSheet(text, def);
    const right = sheet.anims.get('right.idle')![0]!;
    const left = sheet.anims.get('left.idle')![0]!;
    expect(left.keys[0]).toBe(0); // la celda transparente pasa a la izquierda
    expect(left.keys[3]).toBe(right.keys[0]);
    expect(mirrorGlyph('◜')).toBe('◝');
    expect(mirrorGlyph('▙')).toBe('▟');
    expect(mirrorGlyph('♛')).toBe('♛');
    expect(sheet.hasBg[right.keys[6]!]).toBe(1); // la clave 's' lleva fondo (piel)
  });
});
