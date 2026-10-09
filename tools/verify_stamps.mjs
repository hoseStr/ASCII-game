/**
 * Verificación de extremo a extremo de las piezas de escenario (fotos y rocas):
 * en cada sala, lee de la GPU el glifo y el color que produjo el shader de
 * composición en todas las celdas cubiertas por una pieza y los compara con la
 * conversión en CPU (convertBlock: el algoritmo del repo sobre los mismos bytes).
 * Comprueba además que la capa contiene exactamente los bytes de cada imagen.
 * Las piezas animadas se comprueban en varios instantes (cada fotograma que se
 * sube a la GPU tiene que convertirse igual que en CPU).
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
  const { convertBlock } = await import('/src/render/stamps.ts');
  const { glyphIndex } = await import('/src/render/glyphs.ts');
  const { REPO_RAMP_COMPLEX } = await import('/src/render/ascii.ts');
  const { PROP_W, PROP_SAMPLES } = await import('/src/render/propLayer.ts');
  const ramp = Array.from(REPO_RAMP_COMPLEX);
  const n = ramp.length;
  const adg = window.__adg;
  const g = adg.game;
  adg.settings.fidelity = false;
  adg.settings.direction = 'light';
  const res = { sumA: 0, r8: 0, g8: 0, b8: 0, idx: 0 };
  const half = (PROP_SAMPLES * PROP_SAMPLES * 255) / 2;
  const out = [];
  // ow-0-0 se repite al final: la primera y la última visita deben dar lo mismo
  for (const id of ['ow-0-0', 'ow-1-0', 'ow-2-0', 'ow-0-1', 'ow-1-1', 'ow-2-1', 'ow-0-2', 'ow-1-2', 'ow-2-2', 'ow-0-0']) {
    g.debugGoto(id);
    g.debugPlace(1.5 * 3, 8.5 * 3); // lejos de las piezas: la princesa no tapa celdas
    let total = 0;
    let ok = 0;
    let maxErr = 0;
    const bad = [];
    const seen = new Set();
    // tres instantes separados ~1/3 s: las piezas animadas cambian de fotograma entre medias
    for (let shot = 0; shot < 3; shot++) {
      for (let f = 0; f < (shot === 0 ? 12 : 20); f++) await new Promise((r) => requestAnimationFrame(() => r()));
      const cells = adg.renderer().debugReadCells();
      const layer = g.propLayer.rgb;
      for (let row = 0; row < 54; row++) {
        for (let col = 0; col < 160; col++) {
          convertBlock(layer, PROP_W, col * PROP_SAMPLES, row * PROP_SAMPLES, PROP_SAMPLES, n, res);
          if (res.sumA < half) continue;
          const i = row * 160 + col;
          // celdas tapadas por la capa semántica (princesa, puentes, HUD) no cuentan
          if (cells.semantic[i]) continue;
          total++;
          const want = glyphIndex(ramp[n - 1 - res.idx]);
          const e = Math.max(
            Math.abs(cells.fg[i * 4] - res.r8),
            Math.abs(cells.fg[i * 4 + 1] - res.g8),
            Math.abs(cells.fg[i * 4 + 2] - res.b8),
          );
          maxErr = Math.max(maxErr, e);
          if (cells.glyph[i] === want && e === 0) ok++;
          else if (bad.length < 5) bad.push({ col, row, want: ramp[n - 1 - res.idx], got: cells.glyph[i], e });
        }
      }
      let h = 0;
      for (let k = 0; k < layer.length; k += 7) h = (Math.imul(h, 31) + layer[k]) | 0;
      seen.add(h);
    }
    const animated = g.room.props.filter((p) => p.def.frames > 1).length;
    out.push({ room: id, pieces: g.room.props.length + g.room.rockFills.length, animated, states: seen.size, cells: total, ok, maxErr, bad });
  }
  return out;
});
for (const r of report) {
  console.log(
    `${r.room} piezas=${String(r.pieces).padStart(2)} animadas=${r.animated} estados=${r.states} celdas=${String(r.cells).padStart(4)} coinciden=${r.ok}/${r.cells} errColor=${r.maxErr}`,
  );
  for (const b of r.bad) console.log('   ', JSON.stringify(b));
}
// una sala con piezas animadas tiene que haber mostrado más de un estado de la capa
const frozen = report.filter((r) => r.animated > 0 && r.states < 2);
for (const r of frozen) console.log(`   ${r.room}: las piezas animadas no cambiaron de fotograma`);
const bad = report.filter((r) => r.ok !== r.cells).concat(frozen);
const total = report.reduce((a, r) => a + r.cells, 0);
console.log(bad.length ? `FALLAN ${bad.length} salas` : `OK: las ${total} celdas de pieza (3 instantes por sala) coinciden al byte con el algoritmo del repo`);
await browser.close();
await server.close();
process.exit(bad.length ? 1 : 0);
