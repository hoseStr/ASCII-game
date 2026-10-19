/**
 * Verificación de extremo a extremo de las piezas de escenario (renders 3D):
 *  1. Los glifos de línea y de relleno de las piezas son de la rampa del repo y
 *     están en el atlas real del juego (sin sustitutos).
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
  const { FILL_GLYPHS, LINE_GLYPHS, PROP_RAMP } = await import('/src/render/stampConvert.ts');
  const adg = window.__adg;
  const g = adg.game;
  const renderer = adg.renderer();

  // 1 · glifos: los de línea y de relleno son de la rampa del repo y están en el atlas
  const atlas = renderer.atlas;
  const missing = [...(FILL_GLYPHS + LINE_GLYPHS)].filter((ch) => !PROP_RAMP.includes(ch) || atlas.missing.includes(ch) || !atlas.index.has(ch));

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
  return { missing, rooms: out };
});
console.log(`glifos de las piezas: ${report.missing.length ? `faltan ${report.missing.join(' ')}` : 'todos en la rampa del repo y en el atlas'}`);
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
const glyphsOk = report.missing.length === 0;
const total = report.rooms.reduce((a, r) => a + r.cells, 0);
console.log(
  bad.length || !glyphsOk ? `FALLAN ${bad.length} salas` : `OK: las ${total} celdas de pieza (3 instantes por sala) coinciden al byte con la conversión en CPU`,
);
await browser.close();
await server.close();
process.exit(bad.length || !glyphsOk ? 1 : 0);
