/**
 * Capturas de revisión: levanta el servidor de Vite, abre el juego con
 * Playwright y guarda varias capturas en shots/, junto con los errores de
 * consola y las métricas de rendimiento (stats.json).
 *
 * Uso: npm run shots [-- --headed] [-- --browser=chromium]
 * Por defecto usa Microsoft Edge instalado (channel msedge), con GPU.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = new Set(process.argv.slice(2));
const headed = args.has('--headed');
const browserArg = [...args].find((a) => a.startsWith('--browser='))?.split('=')[1] ?? 'msedge';
const outDir = resolve(import.meta.dirname, '..', 'shots');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root: resolve(import.meta.dirname, '..'), server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = 'http://localhost:5199/';

const browser = await chromium.launch({
  headless: !headed,
  channel: browserArg === 'chromium' ? undefined : browserArg,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-unsafe-swiftshader'],
});

const report = { browser: browserArg, pages: {} };

async function shootGame(name, viewport, actions) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 20000 });
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const dbg = c?.getExtension('WEBGL_debug_renderer_info');
    return dbg ? c.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'desconocido';
  });
  const shots = [];
  for (const [label, fn, waitMs] of actions) {
    if (fn) await fn(page);
    await page.waitForTimeout(waitMs ?? 1500);
    const file = `${name}-${label}.png`;
    await page.screenshot({ path: resolve(outDir, file) });
    const stats = await page.evaluate(() => window.__adg.stats());
    shots.push({ file, quality: await page.evaluate(() => window.__adg.settings.quality), gpuMs: stats.gpu, fps: stats.fps });
  }
  // Indicador de allocations en el bucle: crecimiento del heap JS en reposo (Chromium).
  const heap = await page.evaluate(async () => {
    const mem = performance.memory;
    if (!mem) return null;
    const samples = [];
    for (let i = 0; i < 30; i++) {
      samples.push(mem.usedJSHeapSize);
      await new Promise((r) => setTimeout(r, 100));
    }
    let growth = 0;
    for (let i = 1; i < samples.length; i++) growth += Math.max(0, samples[i] - samples[i - 1]);
    return { bytesPerSecond: Math.round(growth / 3), start: samples[0], end: samples.at(-1) };
  });
  const stats = await page.evaluate(() => window.__adg.stats());
  report.pages[name] = { viewport, gl, stats, heap, errors, shots };
  await page.close();
}

const holdKeys = (keys, ms) => async (page) => {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
};

await shootGame('1080p', { width: 1920, height: 1080 }, [
  ['00-inicio', null, 3500],
  ['01-halo-izquierda', holdKeys(['ArrowLeft', 'ArrowUp'], 900), 1200],
  ['02-halo-vacio', holdKeys(['ArrowRight'], 1900), 1500],
  ['03-legibilidad-F4', (p) => p.keyboard.press('F4'), 600],
  ['04-fidelidad-repo', async (p) => {
    await p.keyboard.press('F4');
    await p.keyboard.press('F3');
    await p.keyboard.press('Digit1');
    await p.keyboard.press('Digit2');
    await p.keyboard.press('F3');
  }, 800],
  ['05-calidad-alta', async (p) => {
    await p.keyboard.press('F3');
    await p.keyboard.press('Digit1');
    await p.keyboard.press('Digit2');
    await p.keyboard.press('Digit3');
  }, 2500],
]);

await shootGame('768p', { width: 1366, height: 768 }, [['00-inicio', null, 3500]]);

// Página del atlas
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}debug/atlas.html`);
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  await page.screenshot({ path: resolve(outDir, 'atlas.png'), fullPage: false });
  const summary = await page.$eval('.summary', (el) => el.textContent?.replace(/\s+/g, ' ').trim());
  report.pages.atlas = { errors, summary };
  await page.close();
}

writeFileSync(resolve(outDir, 'stats.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
await server.close();
