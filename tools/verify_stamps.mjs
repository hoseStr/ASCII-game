/**
 * Verificación de extremo a extremo de las piezas de escenario (renders 3D):
 *  1. La tabla de formas de glifo (src/data/glyphShapes.json, medida por
 *     make_stamps.py en la TTF) coincide con los glifos del atlas real del juego.
 *  2. En cada sala, lee de la GPU el glifo y el color de todas las celdas de pieza
 *     y los compara con la conversión hecha en CPU (propLayer.cells): tienen que
 *     coincidir al byte. Las piezas animadas se comprueban en varios instantes
 *     (cada fotograma que se sube a la GPU tiene que verse igual que en CPU).
 * Uso: npm run verify:stamps
 */
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: resolve(import.meta.dirname, '..'), server: { port: 5194, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5194/', { timeout: 120000 }); // el primer arranque en frío de Vite puede pasar de 30 s
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
const report = await page.evaluate(async () => {
  const { glyphIndex } = await import('/src/render/glyphs.ts');
  const { PROP_RAMP } = await import('/src/render/stampConvert.ts');
  const shapes = (await import('/src/data/glyphShapes.json')).default;
  const adg = window.__adg;
  const g = adg.game;
  const renderer = adg.renderer();

  // 1 · formas: correlación entre la tabla y la cobertura del atlas en la misma rejilla
  const atlas = renderer.atlas;
  const [gx, gy] = shapes.grid;
  let worst = 1;
  let worstChar = '';
  for (let k = 0; k < PROP_RAMP.length; k++) {
    const ch = PROP_RAMP[k];
    if (ch === ' ') continue;
    const i = atlas.index.get(ch);
    const x0 = (i % atlas.cols) * atlas.cellW;
    const y0 = Math.floor(i / atlas.cols) * atlas.cellH;
    const a = [];
    for (let ry = 0; ry < gy; ry++) {
      for (let rx = 0; rx < gx; rx++) {
        let s = 0;
        let n = 0;
        for (let y = Math.floor((ry * atlas.cellH) / gy); y < Math.floor(((ry + 1) * atlas.cellH) / gy); y++) {
          for (let x = Math.floor((rx * atlas.cellW) / gx); x < Math.floor(((rx + 1) * atlas.cellW) / gx); x++) {
            s += atlas.pixels[(y0 + y) * atlas.canvas.width + x0 + x] / 255;
            n++;
          }
        }
        a.push(s / n);
      }
    }
    const b = shapes.coverage[k];
    const ma = a.reduce((p, v) => p + v, 0) / a.length;
    const mb = b.reduce((p, v) => p + v, 0) / b.length;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let j = 0; j < a.length; j++) {
      num += (a[j] - ma) * (b[j] - mb);
      da += (a[j] - ma) ** 2;
      db += (b[j] - mb) ** 2;
    }
    const corr = da > 0 && db > 0 ? num / Math.sqrt(da * db) : 1;
    if (corr < worst) {
      worst = corr;
      worstChar = ch;
    }
  }

  // 2 · piezas: GPU = CPU en todas las salas, en tres instantes
  adg.settings.fidelity = false;
  adg.settings.direction = 'light';
  const out = [];
  // ow-0-0 se repite al final: la primera y la última visita deben dar lo mismo
  for (const id of ['ow-0-0', 'ow-1-0', 'ow-2-0', 'ow-0-1', 'ow-1-1', 'ow-2-1', 'ow-0-2', 'ow-1-2', 'ow-2-2', 'ow-0-0']) {
    g.debugGoto(id);
    g.debugPlace(1.5 * 3, 8.5 * 3); // lejos de las piezas: la princesa no tapa celdas
    let total = 0;
    let ok = 0;
    const bad = [];
    const seen = new Set();
    // tres instantes separados ~1/3 s: las piezas animadas cambian de fotograma entre medias
    for (let shot = 0; shot < 3; shot++) {
      for (let f = 0; f < (shot === 0 ? 12 : 20); f++) await new Promise((r) => requestAnimationFrame(() => r()));
      const cells = renderer.debugReadCells();
      const L = g.propLayer.cells;
      let h = 0;
      for (let i = 0; i < 160 * 54; i++) {
        const pos = L[i * 4 + 3];
        h = (Math.imul(h, 31) + pos + L[i * 4] * 7) | 0;
        if (pos === 0) continue;
        // celdas tapadas por la capa semántica (princesa, puentes, HUD) no cuentan
        if (cells.semantic[i]) continue;
        total++;
        const want = glyphIndex(PROP_RAMP[pos - 1]);
        const e = Math.max(
          Math.abs(cells.fg[i * 4] - L[i * 4]),
          Math.abs(cells.fg[i * 4 + 1] - L[i * 4 + 1]),
          Math.abs(cells.fg[i * 4 + 2] - L[i * 4 + 2]),
        );
        if (cells.glyph[i] === want && e === 0) ok++;
        else if (bad.length < 5) bad.push({ col: i % 160, row: Math.floor(i / 160), want: PROP_RAMP[pos - 1], got: cells.glyph[i], e });
      }
      seen.add(h);
    }
    const animated = g.room.props.filter((p) => p.def.frames > 1).length;
    out.push({ room: id, pieces: g.room.props.length + g.room.rockFills.length, animated, states: seen.size, cells: total, ok, bad });
  }
  return { worst, worstChar, rooms: out };
});
console.log(`formas de glifo: correlación mínima tabla/atlas = ${report.worst.toFixed(3)} ('${report.worstChar}')`);
for (const r of report.rooms) {
  console.log(
    `${r.room} piezas=${String(r.pieces).padStart(2)} animadas=${r.animated} estados=${r.states} celdas=${String(r.cells).padStart(4)} coinciden=${r.ok}/${r.cells}`,
  );
  for (const b of r.bad) console.log('   ', JSON.stringify(b));
}
// una sala con piezas animadas tiene que haber mostrado más de un estado de la capa
const frozen = report.rooms.filter((r) => r.animated > 0 && r.states < 2);
for (const r of frozen) console.log(`   ${r.room}: las piezas animadas no cambiaron de fotograma`);
const bad = report.rooms.filter((r) => r.ok !== r.cells).concat(frozen);
const shapesOk = report.worst > 0.85;
if (!shapesOk) console.log('   la tabla de formas no coincide con el atlas: regenera con tools/make_stamps.py');
const total = report.rooms.reduce((a, r) => a + r.cells, 0);
console.log(
  bad.length || !shapesOk ? `FALLAN ${bad.length} salas` : `OK: las ${total} celdas de pieza (3 instantes por sala) coinciden al byte con la conversión en CPU`,
);
await browser.close();
await server.close();
process.exit(bad.length || !shapesOk ? 1 : 0);
