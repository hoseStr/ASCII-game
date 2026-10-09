/**
 * Verificación de extremo a extremo de las piezas de escenario: lee de la GPU los
 * glifos y colores que produjo el shader de composición en las celdas de cada
 * pieza y los compara con convertStamp (el algoritmo del repo en TypeScript).
 * Uso: node tools/verify_stamps.mjs
 */
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: resolve(import.meta.dirname, '..'), server: { port: 5194, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5194/');
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
const report = await page.evaluate(async () => {
  const { convertStamp } = await import('/src/render/stamps.ts');
  const { glyphIndex } = await import('/src/render/glyphs.ts');
  const adg = window.__adg;
  const g = adg.game;
  adg.settings.fidelity = false;
  adg.settings.direction = 'light';
  const out = [];
  // ow-0-0 se repite al final: la primera y la última visita deben dar lo mismo
  for (const id of ['ow-0-0', 'ow-1-0', 'ow-2-0', 'ow-0-1', 'ow-1-1', 'ow-2-1', 'ow-0-2', 'ow-1-2', 'ow-2-2', 'ow-0-0']) {
    g.debugGoto(id);
    // lejos de las piezas para que la princesa no tape celdas
    g.debugPlace(1.5 * 3, 8.5 * 3);
    // esperar a que se rendericen varios fotogramas completos de la sala nueva
    for (let f = 0; f < 12; f++) await new Promise((r) => requestAnimationFrame(() => r()));
    const cells = adg.renderer().debugReadCells();
    for (const p of g.room.props) {
      const img = adg.stampImages.get(p.def.id);
      const conv = convertStamp(img, p.def.samples, 'light');
      let total = 0, glyphOk = 0, colorErr = 0;
      const bad = [];
      conv.forEach((row, cy) =>
        row.forEach((cell, cx0) => {
          if (!cell.char) return;
          const cx = p.flip ? row.length - 1 - cx0 : cx0;
          const col = p.tx * 5 + cx;
          const rowY = 6 + p.ty * 3 + cy;
          const i = rowY * 160 + col; // en los FBO de celdas la fila 0 de la grilla es la fila 0 del framebuffer
          total++;
          if (cells.glyph[i] === glyphIndex(cell.char)) glyphOk++;
          else if (bad.length < 6) bad.push({ col, row: rowY, want: cell.char, wantRgb: [cell.r, cell.g, cell.b].map((v) => +v.toFixed(3)), got: cells.glyph[i], gotRgb: [0, 1, 2].map((k) => +(cells.fg[i * 4 + k] / 255).toFixed(3)) });
          const e = Math.max(
            Math.abs(cells.fg[i * 4] / 255 - cell.r),
            Math.abs(cells.fg[i * 4 + 1] / 255 - cell.g),
            Math.abs(cells.fg[i * 4 + 2] / 255 - cell.b),
          );
          colorErr = Math.max(colorErr, e);
        }),
      );
      out.push({ room: id, stamp: p.def.id, flip: p.flip, cells: total, glyphMatch: glyphOk, maxColorErr: +colorErr.toFixed(4), bad });
    }
  }
  return out;
});
for (const r of report) {
  console.log(`${r.room} ${r.stamp.padEnd(14)} flip=${r.flip ? 1 : 0} celdas=${r.cells} glifos ${r.glyphMatch}/${r.cells} errColor=${r.maxColorErr}`);
  for (const b of r.bad) console.log('   ', JSON.stringify(b));
}
const bad = report.filter((r) => r.glyphMatch !== r.cells || r.maxColorErr > 0.01);
console.log(bad.length ? `FALLAN ${bad.length}` : 'OK: todas las piezas coinciden con el algoritmo del repo');
await browser.close();
await server.close();
process.exit(bad.length ? 1 : 0);
