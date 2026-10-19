import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_RAMP_COMPLEX, convertColor } from '../src/render/ascii';
import { COLOR_FLOOR, FILL_GLYPHS, LINE_GLYPHS } from '../src/render/stampConvert';
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

  it('PNG del tamaño declarado (tira de fotogramas) y huella coherente con sizeTiles', () => {
    for (const def of defs.values()) {
      const png = decodePng(readFileSync(file(`src/assets/stamps/${def.image}`)));
      expect(def.frames, def.id).toBeGreaterThanOrEqual(1);
      expect(def.fps > 0, def.id).toBe(def.frames > 1);
      expect(def.samples, def.id).toEqual([6, 10]);
      expect(png.width, def.id).toBe(def.cells[0] * def.samples[0]);
      expect(png.height, def.id).toBe(def.cells[1] * def.samples[1] * def.frames);
      expect(def.footprint).toHaveLength(def.sizeTiles[1]);
      for (const row of def.footprint) expect(row).toHaveLength(def.sizeTiles[0]);
      if (!def.solid) expect(def.footprint.join('')).not.toContain('#');
    }
  });

  it('todas son renders 3D con su sombra (escala de grises, del tamaño declarado)', () => {
    let rendered = 0;
    for (const def of defs.values()) {
      expect(def.shadow, def.id).toBe('render');
      expect(def.credits.sourceUrl, def.id).toMatch(/^https:[/][/]polyhaven[.]com[/]a[/]/);
      rendered++;
      expect(def.shadowImage, def.id).toBeDefined();
      const png = decodePng(readFileSync(file(`src/assets/stamps/${def.shadowImage!.image}`)));
      expect([png.width, png.height], def.id).toEqual(def.shadowImage!.size);
      let dark = 0;
      for (let i = 0; i < png.width * png.height; i++) dark = Math.max(dark, png.rgba[i * 4]!);
      expect(dark, def.id).toBeGreaterThan(64); // hay sombra de verdad
    }
    expect(rendered).toBeGreaterThan(0);
  });

  it('la forma del modelo 3D: misma tira que la imagen, tono dentro de la silueta y líneas internas', () => {
    let withLines = 0;
    for (const def of defs.values()) {
      const img = decodePng(readFileSync(file(`src/assets/stamps/${def.image}`)));
      const form = decodePng(readFileSync(file(`src/assets/stamps/${def.form}`)));
      expect([form.width, form.height], def.id).toEqual([img.width, img.height]);
      let inside = 0;
      let toned = 0;
      let lines = 0;
      let blue = 0;
      for (let i = 0; i < img.width * img.height; i++) {
        blue += form.rgba[i * 4 + 2]!;
        if (img.rgba[i * 4 + 3]! < 128) continue;
        inside++;
        if (form.rgba[i * 4]! > 0) toned++;
        if (form.rgba[i * 4 + 1]! > 127) lines++;
      }
      expect(blue, def.id).toBe(0); // B lo escribe el juego (orden de dibujo de cada pieza)
      // el tono cubre la silueta (la cara más oscura puede llegar a 0)
      expect(toned / inside, def.id).toBeGreaterThan(0.9);
      // líneas internas: trazos finos, no manchas (una mata ramificada llega a ~1/4)
      expect(lines / inside, def.id).toBeLessThan(0.35);
      if (lines > 0) withLines++;
    }
    // el modelo 3D aporta aristas de oclusión o pliegues en la mayoría de las piezas
    expect(withLines).toBeGreaterThan(defs.size / 2);
  });

  it('fotogramas: el bucle se mueve y la silueta no salta', () => {
    for (const def of defs.values()) {
      if (def.frames <= 1) continue;
      const png = decodePng(readFileSync(file(`src/assets/stamps/${def.image}`)));
      const size = png.width * (png.height / def.frames) * 4;
      const frame = (k: number): Uint8Array => png.rgba.subarray(k * size, (k + 1) * size);
      let moved = 0;
      let alpha0 = 0;
      for (let i = 3; i < size; i += 4) alpha0 += frame(0)[i]!;
      for (let k = 1; k < def.frames; k++) {
        const f = frame(k);
        let diff = 0;
        let alpha = 0;
        for (let i = 0; i < size; i++) {
          diff += Math.abs(f[i]! - frame(0)[i]!);
          if (i % 4 === 3) alpha += f[i]!;
        }
        if (diff > 0) moved++;
        // hojas anchas que se mecen y se tapan entre sí: la silueta varía, pero sin saltos
        expect(Math.abs(alpha - alpha0) / alpha0, `${def.id} f${k}`).toBeLessThan(0.2);
      }
      // en un vaivén senoidal el fotograma de medio ciclo puede coincidir con el 0
      expect(moved, def.id).toBeGreaterThanOrEqual(def.frames - 2);
    }
  });
});

describe('estampas: fidelidad al algoritmo del repo', () => {
  // La vista previa la escribe tools/make_stamps.py con el algoritmo literal de
  // img2txt (Python) sobre el PNG compuesto en blanco; el port de TypeScript
  // tiene que dar exactamente el mismo texto a partir del mismo PNG.
  for (const def of defs.values()) {
    it(`${def.id}: convertColor reproduce la vista previa del repo al 100 %`, () => {
      const strip = decodePng(readFileSync(file(`src/assets/stamps/${def.image}`)));
      // la vista previa es la del fotograma 0 (las primeras filas de la tira)
      const png = { width: strip.width, height: strip.height / def.frames, rgba: strip.rgba };
      const rgb = new Uint8Array(png.width * png.height * 3);
      for (let i = 0; i < png.width * png.height; i++) {
        const a = png.rgba[i * 4 + 3]!;
        for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round((png.rgba[i * 4 + c]! * a + 255 * (255 - a)) / 255);
      }
      const ascii = convertColor(rgb, png.width, png.height, png.width / def.samples[0], REPO_RAMP_COMPLEX).map((row) =>
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
  form: 'prueba.form.png',
  use: 'prop',
  sizeTiles: [3, 2],
  cells: [15, 6],
  samples: [6, 10],
  solid: true,
  shadow: 'cast',
  footprint: ['...', '##.'],
  frames: 1,
  fps: 0,
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

describe('rocas renderizadas', () => {
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

  it('cada zona usa sus rocas, con variedad entre rectángulos parecidos', () => {
    // muchas rocas sueltas de 1×1: todas las variantes compiten igual
    const rows = Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: 32 }, (_, x) => (x % 2 === 0 && y % 2 === 0 && y < 14 ? '#' : ',')).join(''),
    );
    const map = parseRoomMap(rows.join('\n'));
    for (const zone of ['ruins', 'forest']) {
      const fills = assignRockFills(map, defs, 99, zone);
      expect(fills.length).toBeGreaterThan(10);
      for (const f of fills) expect(!f.def.zones || f.def.zones.includes(zone), `${zone}: ${f.def.id}`).toBe(true);
      expect(new Set(fills.map((f) => f.def.id)).size, zone).toBeGreaterThan(1);
    }
  });
});

describe('conversión de las piezas reales', () => {
  const cellsOf = (id: string) => {
    const def = defs.get(id)!;
    const png = decodePng(readFileSync(file(`src/assets/stamps/${def.image}`)));
    const form = decodePng(readFileSync(file(`src/assets/stamps/${def.form}`)));
    const frameH = png.height / def.frames;
    const frame0 = (p: typeof png) => stampImageFromRgba(p.rgba.subarray(0, p.width * frameH * 4), p.width, frameH);
    return convertStamp(frame0(png), frame0(form))
      .flat()
      .filter((c) => c.char !== '');
  };

  it('cada pieza se ve: celdas con glifo, color con brillo mínimo y silueta con bordes', () => {
    for (const def of defs.values()) {
      const cells = cellsOf(def.id);
      expect(cells.length, def.id).toBeGreaterThan(def.cells[0] * def.cells[1] * 0.15);
      for (const c of cells) expect(Math.round(Math.max(c.r, c.g, c.b) * 255), def.id).toBeGreaterThanOrEqual(COLOR_FLOOR);
      // la silueta tiene celdas de borde (cobertura parcial), no solo bloques llenos
      expect(cells.some((c) => c.cov < 0.95), def.id).toBe(true);
    }
  });

  it('cada pieza tiene forma: contorno de glifos de línea y relleno isótropo por dentro', () => {
    for (const def of defs.values()) {
      const cells = cellsOf(def.id);
      for (const c of cells) expect(FILL_GLYPHS + LINE_GLYPHS, def.id).toContain(c.char);
      const lines = cells.filter((c) => LINE_GLYPHS.includes(c.char)).length;
      expect(lines, def.id).toBeGreaterThan(0);
      // las piezas con cuerpo (rocas, estatuas) también tienen interior relleno
      if (def.use === 'rockfill' || def.id.startsWith('rock') || def.id.startsWith('bust') || def.id === 'statue') {
        expect(cells.length - lines, def.id).toBeGreaterThan(0);
      }
    }
  });

  it('las piezas conservan su color: el busto es de mármol (claro y sin color) y la peña óxido', () => {
    const avg = (id: string): [number, number, number] => {
      const cells = cellsOf(id);
      const s = cells.reduce((acc, c) => [acc[0] + c.r, acc[1] + c.g, acc[2] + c.b], [0, 0, 0]);
      return [s[0] / cells.length, s[1] / cells.length, s[2] / cells.length];
    };
    const bust = avg('bust');
    expect((bust[0] + bust[1] + bust[2]) / 3).toBeGreaterThan(0.5);
    expect(Math.max(...bust) - Math.min(...bust)).toBeLessThan(0.15); // mármol algo cálido
    const [r, , b] = avg('boulder-rust');
    expect(r).toBeGreaterThan(b * 1.3);
  });
});

describe('rocas: renders recortados por rectángulo, sin bordes añadidos', () => {
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

  it('en el render, las rocas renderizadas no se pintan como roca procedural (sin contorno ni recorte)', () => {
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
