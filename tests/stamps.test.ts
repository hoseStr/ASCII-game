import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_RAMP_COMPLEX, convertColor } from '../src/render/ascii';
import { tintLab } from '../src/render/propLayer';
import {
  PropError,
  applyProps,
  assignRockFills,
  footprintSolid,
  loadStampDefs,
  resolveProps,
  rockClusters,
  type StampDef,
} from '../src/world/props';
import { parseRoomMap, tileAt } from '../src/world/room';
import { TILE } from '../src/world/tiles';
import { World } from '../src/world/world';
import { decodePng } from './helpers/png';

const file = (rel: string): string => new URL(`../${rel}`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const defs = loadStampDefs();
const manifest = JSON.parse(readFileSync(file('art/manifest.json'), 'utf8')) as {
  sources: Array<{ id: string; license: string; sourceUrl: string; author: string }>;
};
const stampSrc = JSON.parse(readFileSync(file('art/stamps.json'), 'utf8')) as { stamps: Array<{ id: string; source: string }> };

describe('estampas: licencias y archivos', () => {
  it('cada estampa definida en art/stamps.json está generada', () => {
    expect([...defs.keys()].sort()).toEqual(stampSrc.stamps.map((s) => s.id).sort());
  });

  it('solo CC0 o dominio público, y los créditos coinciden con el manifiesto', () => {
    for (const s of stampSrc.stamps) {
      const src = manifest.sources.find((m) => m.id === s.source);
      expect(src, s.id).toBeDefined();
      expect(['CC0-1.0', 'PDM-1.0']).toContain(src!.license);
      const def = defs.get(s.id)!;
      expect(def.credits.license).toBe(src!.license);
      expect(def.credits.sourceUrl).toBe(src!.sourceUrl);
      expect(def.credits.author).toBe(src!.author);
    }
  });

  it('PNG del tamaño declarado y huella coherente con sizeTiles', () => {
    for (const def of defs.values()) {
      const png = decodePng(readFileSync(file(`src/assets/stamps/${def.image}`)));
      expect(png.width, def.id).toBe(def.cells[0] * def.samples);
      expect(png.height, def.id).toBe(def.cells[1] * def.samples);
      expect(def.footprint).toHaveLength(def.sizeTiles[1]);
      for (const row of def.footprint) expect(row).toHaveLength(def.sizeTiles[0]);
      if (!def.solid) expect(def.footprint.join('')).not.toContain('#');
    }
  });
});

describe('estampas: fidelidad al algoritmo del repo', () => {
  // La vista previa la escribe tools/make_stamps.py con el algoritmo literal de
  // img2txt (Python) sobre el PNG compuesto en blanco; el port de TypeScript
  // tiene que dar exactamente el mismo texto a partir del mismo PNG.
  for (const def of defs.values()) {
    it(`${def.id}: convertColor reproduce la vista previa del repo al 100 %`, () => {
      const png = decodePng(readFileSync(file(`src/assets/stamps/${def.image}`)));
      const rgb = new Uint8Array(png.width * png.height * 3);
      for (let i = 0; i < png.width * png.height; i++) {
        const a = png.rgba[i * 4 + 3]!;
        for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round((png.rgba[i * 4 + c]! * a + 255 * (255 - a)) / 255);
      }
      const ascii = convertColor(rgb, png.width, png.height, png.width / def.samples, REPO_RAMP_COMPLEX).map((row) =>
        row.map((c) => c.char).join(''),
      );
      const expected = readFileSync(file(`src/data/stamps/${def.id}.preview.txt`), 'ascii').replace(/\r/g, '').split('\n');
      expected.pop(); // salto de línea final
      expect(ascii).toEqual(expected);
    });
  }
});

const testDef = (over: Partial<StampDef> = {}): StampDef => ({
  id: 'prueba',
  image: 'prueba.png',
  use: 'prop',
  sizeTiles: [3, 2],
  cells: [15, 6],
  samples: 4,
  ramp: 'base',
  solid: true,
  footprint: ['...', '##.'],
  tint: { slot: 'rock', strength: 0.5, keepChroma: 0.5 },
  lum: [0.2, 0.8],
  credits: { title: '', author: '', license: 'CC0-1.0', sourceUrl: '' },
  ...over,
});

describe('piezas: colocación y colisión', () => {
  const rows = Array.from({ length: 16 }, () => ','.repeat(32));
  rows[0] = '.'.repeat(32);
  const map = parseRoomMap(rows.join('\n'), 'prueba');

  it('la huella sólida bloquea; el resto de la caja sigue caminable', () => {
    const defsMap = new Map([['prueba', testDef()]]);
    const props = resolveProps('prueba', [{ stamp: 'prueba', tile: [4, 5] }], defsMap, map);
    const out = applyProps('prueba', map, props);
    expect(tileAt(out, 4, 6)).toBe(TILE.prop);
    expect(tileAt(out, 5, 6)).toBe(TILE.prop);
    expect(tileAt(out, 6, 6)).toBe(TILE.ground);
    expect(tileAt(out, 4, 5)).toBe(TILE.ground);
    expect(tileAt(map, 4, 6)).toBe(TILE.ground); // el mapa original no se modifica
  });

  it('el espejo horizontal invierte la huella', () => {
    const defsMap = new Map([['prueba', testDef()]]);
    const [p] = resolveProps('prueba', [{ stamp: 'prueba', tile: [4, 5], flip: true }], defsMap, map);
    expect(footprintSolid(p!, 0, 1)).toBe(false);
    expect(footprintSolid(p!, 1, 1)).toBe(true);
    expect(footprintSolid(p!, 2, 1)).toBe(true);
  });

  it('las piezas decorativas no bloquean', () => {
    const defsMap = new Map([['prueba', testDef({ solid: false, footprint: ['...', '...'] })]]);
    const props = resolveProps('prueba', [{ stamp: 'prueba', tile: [4, 5] }], defsMap, map);
    expect(applyProps('prueba', map, props).tiles).toEqual(map.tiles);
  });

  it('rechaza estampas desconocidas, fuera de la sala o huellas sobre el vacío', () => {
    const defsMap = new Map([['prueba', testDef()]]);
    expect(() => resolveProps('x', [{ stamp: 'nada', tile: [1, 1] }], defsMap, map)).toThrow(PropError);
    expect(() => resolveProps('x', [{ stamp: 'prueba', tile: [30, 1] }], defsMap, map)).toThrow(/se sale/);
    const onVoid = resolveProps('x', [{ stamp: 'prueba', tile: [2, 0] }], new Map([['prueba', testDef({ footprint: ['##.', '...'] })]]), map);
    expect(() => applyProps('x', map, onVoid)).toThrow(/no caminable/);
  });
});

describe('rocas con textura fotográfica', () => {
  it('agrupa rocas contiguas y asigna variantes de forma determinista', () => {
    const rows = Array.from({ length: 16 }, () => ','.repeat(32).split(''));
    rows[2]![2] = '#';
    rows[2]![3] = '#';
    rows[3]![3] = '#';
    rows[10]![20] = '#';
    const map = parseRoomMap(rows.map((r) => r.join('')).join('\n'), 'rocas');
    const clusters = rockClusters(map);
    expect(clusters).toEqual([
      { tx0: 2, ty0: 2, tx1: 3, ty1: 3 },
      { tx0: 20, ty0: 10, tx1: 20, ty1: 10 },
    ]);
    const a = assignRockFills(map, defs, 1234);
    const b = assignRockFills(map, defs, 1234);
    expect(a.map((f) => f.def.id)).toEqual(b.map((f) => f.def.id));
    for (const f of a) expect(f.def.use).toBe('rockfill');
  });
});

describe('tinte de zona', () => {
  it('sin fuerza conserva la luz de la foto', () => {
    const out = new Float32Array(3);
    tintLab(0.6, 0.1, -0.05, 0.2, 0.9, 0.7, 0.02, 0.03, 0, 1, out, 0);
    expect(out[0]).toBeCloseTo(0.6, 6);
    expect(out[1]).toBeCloseTo(0.1, 6);
    expect(out[2]).toBeCloseTo(-0.05, 6);
  });

  it('es monótono en la luminancia (la foto conserva su luz y su forma)', () => {
    const out = new Float32Array(3);
    let prev = -Infinity;
    for (let L = 0; L <= 1.0001; L += 0.05) {
      tintLab(L, 0.05, 0.05, 0.25, 0.85, 0.7, 0.03, -0.02, 0.8, 0.4, out, 0);
      expect(out[0]).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = out[0]!;
    }
  });

  it('lleva el croma hacia el color de la paleta', () => {
    const out = new Float32Array(3);
    tintLab(0.5, 0.2, 0.2, 0, 1, 0.5, -0.1, 0.0, 1, 0.5, out, 0);
    expect(out[1]).toBeCloseTo(-0.1, 6);
    expect(out[2]).toBeCloseTo(0, 6);
  });
});

describe('contenido', () => {
  it('cada sala del overworld tiene al menos una pieza de escenario', () => {
    const world = new World();
    for (const [id, room] of world.rooms) expect(room.props.length, id).toBeGreaterThan(0);
    expect(world.get('ow-1-0').rockFills.length).toBeGreaterThan(0);
  });
});
