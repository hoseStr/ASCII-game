import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_RAMP_COMPLEX, convertColor } from '../src/render/ascii';
import { convertStamp, resampleStamp, stampImageFromRgba } from '../src/render/stamps';
import {
  PropError,
  applyProps,
  assignRockFills,
  footprintSolid,
  loadStampDefs,
  resolveProps,
  ROCK_RECT_MAX_H,
  ROCK_RECT_MAX_W,
  rockClusters,
  rockRects,
  type StampDef,
} from '../src/world/props';
import { HUD_TILE_ROWS, SCREEN_TILES_W, parseRoomMap, tileAt } from '../src/world/room';
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
  solid: true,
  footprint: ['...', '##.'],
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

describe('conversión pura de las piezas (la misma que hace compose.frag)', () => {
  it('cada celda toma el color real de la foto y el glifo de la rampa del repo según (R+G+B)/3', () => {
    // 2×1 celdas de 4×4 muestras: izquierda blanca opaca, derecha transparente
    const w = 8;
    const h = 4;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < 4; x++) rgba.set([255, 255, 255, 255], (y * w + x) * 4);
    const cells = convertStamp(stampImageFromRgba(rgba, w, h), 4, 'light');
    expect(cells[0]![0]!.char).toBe('$'); // luz máxima → glifo más denso (sentido light)
    expect([cells[0]![0]!.r, cells[0]![0]!.g, cells[0]![0]!.b]).toEqual([1, 1, 1]);
    expect(cells[0]![1]!.char).toBe(''); // fuera de la silueta
    expect(convertStamp(stampImageFromRgba(rgba, w, h), 4, 'ink')[0]![0]!.char).toBe(' '); // literal del repo
  });

  it('celdas opacas: glifo = fórmula literal del repo (np.mean del bloque · N / 255) y color = promedio real', () => {
    let checked = 0;
    for (const def of defs.values()) {
      const png = decodePng(readFileSync(file(`src/assets/stamps/${def.image}`)));
      const S = def.samples;
      const cells = convertStamp(stampImageFromRgba(png.rgba, png.width, png.height), S, 'ink');
      cells.forEach((row, cy) =>
        row.forEach((cell, cx) => {
          let sum = 0;
          let opaque = true;
          const rgb = [0, 0, 0];
          for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
              const i = ((cy * S + y) * png.width + cx * S + x) * 4;
              if (png.rgba[i + 3] !== 255) opaque = false;
              for (let c = 0; c < 3; c++) {
                sum += png.rgba[i + c]!;
                rgb[c]! += png.rgba[i + c]!;
              }
            }
          }
          if (!opaque) return;
          // como el repo: CHAR_LIST[min(int(np.mean(bloque) * N / 255), N - 1)]
          const mean = sum / (S * S * 3);
          const n = REPO_RAMP_COMPLEX.length;
          expect(cell.char, `${def.id} (${cx}, ${cy})`).toBe(REPO_RAMP_COMPLEX[Math.min(Math.trunc((mean * n) / 255), n - 1)]);
          expect(Math.round(cell.r * 255)).toBe(Math.round(rgb[0]! / (S * S)));
          checked++;
        }),
      );
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('las piezas reales conservan su color: la amanita es roja y el nenúfar blanco', () => {
    const avg = (id: string): [number, number, number] => {
      const def = defs.get(id)!;
      const png = decodePng(readFileSync(file(`src/assets/stamps/${def.image}`)));
      const cells = convertStamp(stampImageFromRgba(png.rgba, png.width, png.height), def.samples).flat().filter((c) => c.char);
      const s = cells.reduce((acc, c) => [acc[0] + c.r, acc[1] + c.g, acc[2] + c.b], [0, 0, 0]);
      return [s[0] / cells.length, s[1] / cells.length, s[2] / cells.length];
    };
    const [r, g, b] = avg('mushrooms-red');
    expect(r).toBeGreaterThan(g * 1.3);
    expect(r).toBeGreaterThan(b * 1.3);
    const lily = avg('lily-white');
    expect(Math.min(...lily)).toBeGreaterThan(0.55);
  });
});

describe('rocas: fotos recortadas por rectángulo, sin bordes añadidos', () => {
  it('los rectángulos cubren cada roca exactamente una vez y no superan 3×2 tiles', () => {
    const world = new World();
    for (const [id, room] of world.rooms) {
      const covered = new Uint8Array(room.map.w * room.map.h);
      for (const r of rockRects(room.map)) {
        expect(r.tx1 - r.tx0 + 1).toBeLessThanOrEqual(ROCK_RECT_MAX_W);
        expect(r.ty1 - r.ty0 + 1).toBeLessThanOrEqual(ROCK_RECT_MAX_H);
        for (let y = r.ty0; y <= r.ty1; y++) {
          for (let x = r.tx0; x <= r.tx1; x++) {
            expect(tileAt(room.map, x, y), `${id} (${x}, ${y})`).toBe(TILE.rock);
            covered[y * room.map.w + x]!++;
          }
        }
      }
      for (let i = 0; i < covered.length; i++) {
        if (room.map.tiles[i] === TILE.rock) expect(covered[i], `${id} tile ${i}`).toBe(1);
      }
    }
  });

  it('en el render, las rocas con foto no se pintan como roca procedural (sin contorno ni recorte)', () => {
    const world = new World();
    const room = world.get('ow-1-0');
    expect(room.rockFills.length).toBeGreaterThan(0);
    const data = world.renderData(room);
    for (const r of room.rockFills) {
      expect(data.tileTex[(r.ty0 + HUD_TILE_ROWS) * SCREEN_TILES_W + r.tx0]).toBe(TILE.prop);
      expect(tileAt(room.map, r.tx0, r.ty0)).toBe(TILE.rock); // la colisión no cambia
    }
  });

  it('el remuestreo conserva el color de una imagen uniforme y el alfa de su silueta', () => {
    const w = 8;
    const h = 4;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set(i % w < 4 ? [200, 100, 50, 255] : [0, 0, 0, 0], i * 4);
    const out = resampleStamp(stampImageFromRgba(rgba, w, h), 4, 2);
    expect(Array.from(out.data.subarray(0, 4))).toEqual([200, 100, 50, 255]);
    expect(out.data[(1 * 4 + 3) * 4 + 3]).toBe(0);
  });
});

describe('contenido', () => {
  it('cada sala del overworld tiene al menos una pieza de escenario', () => {
    const world = new World();
    for (const [id, room] of world.rooms) expect(room.props.length, id).toBeGreaterThan(0);
    expect(world.get('ow-1-0').rockFills.length).toBeGreaterThan(0);
  });
});
