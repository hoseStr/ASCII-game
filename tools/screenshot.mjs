/**
 * Capturas de revisión: levanta el servidor de Vite, abre el juego con
 * Playwright y guarda capturas en shots/, junto con los errores de consola y
 * las métricas de rendimiento (stats.json).
 *
 * Uso: npm run shots [-- --headed] [-- --browser=chromium] [-- --only=salas,transicion,princesa,768p,atlas]
 * Por defecto usa Microsoft Edge instalado (channel msedge), con GPU.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const browserArg = args.find((a) => a.startsWith('--browser='))?.split('=')[1] ?? 'msedge';
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',') ?? null;
const want = (name) => !only || only.includes(name);
const outDir = resolve(import.meta.dirname, '..', 'shots');
mkdirSync(outDir, { recursive: true });

const server = await createServer({
  root: resolve(import.meta.dirname, '..'),
  server: { port: 5199, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = 'http://localhost:5199/';
const browser = await chromium.launch({
  headless: !headed,
  channel: browserArg === 'chromium' ? undefined : browserArg,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-unsafe-swiftshader'],
});
const report = { browser: browserArg, pages: {} };

async function openGame(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(base);
  try {
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 20000 });
  } catch (e) {
    console.error('El juego no arrancó:', errors.join('\n'));
    throw e;
  }
  return { page, errors };
}

async function shot(page, file) {
  await page.screenshot({ path: resolve(outDir, file) });
  const stats = await page.evaluate(() => window.__adg.stats());
  const quality = await page.evaluate(() => window.__adg.settings.quality);
  return { file, quality, gpuMs: stats.gpu, fps: stats.fps };
}

async function heapGrowth(page) {
  return page.evaluate(async () => {
    const mem = performance.memory;
    if (!mem) return null;
    const samples = [];
    for (let i = 0; i < 30; i++) {
      samples.push(mem.usedJSHeapSize);
      await new Promise((r) => setTimeout(r, 100));
    }
    let growth = 0;
    for (let i = 1; i < samples.length; i++) growth += Math.max(0, samples[i] - samples[i - 1]);
    return { bytesPerSecond: Math.round(growth / 3) };
  });
}

const ROOMS = ['ow-0-0', 'ow-1-0', 'ow-2-0', 'ow-0-1', 'ow-1-1', 'ow-2-1', 'ow-0-2', 'ow-1-2', 'ow-2-2'];

if (want('salas')) {
  const { page, errors } = await openGame({ width: 1920, height: 1080 });
  const shots = [];
  await page.waitForTimeout(2500);
  for (const id of ROOMS) {
    await page.evaluate((rid) => window.__adg.game.debugGoto(rid), id);
    await page.waitForTimeout(1400);
    shots.push(await shot(page, `sala-${id}.png`));
  }
  report.pages.salas = { errors, shots, heap: await heapGrowth(page) };
  await page.close();
}

if (want('transicion')) {
  const { page, errors } = await openGame({ width: 1920, height: 1080 });
  const shots = [];
  await page.waitForTimeout(2000);
  // hacia el este desde el claro central: a mitad del deslizamiento
  await page.evaluate(() => window.__adg.game.debugPlace(93.5, 25.5, 'right'));
  await page.waitForTimeout(300);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => window.__adg.game.transition.active, null, { timeout: 5000 });
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(380);
  shots.push(await shot(page, 'transicion-este-mitad.png'));
  await page.waitForTimeout(1500);
  shots.push(await shot(page, 'transicion-este-final.png'));
  // hacia el norte
  await page.evaluate(() => window.__adg.game.debugGoto('ow-1-1'));
  await page.evaluate(() => window.__adg.game.debugPlace(48, 1.2, 'up'));
  await page.waitForTimeout(400);
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__adg.game.transition.active, null, { timeout: 5000 });
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(330);
  shots.push(await shot(page, 'transicion-norte-mitad.png'));
  // derretido (lo usará la entrada a la mazmorra en la Fase 4)
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__adg.game.debugMelt());
  await page.waitForTimeout(700);
  shots.push(await shot(page, 'transicion-derretido.png'));
  report.pages.transicion = { errors, shots };
  await page.close();
}

if (want('princesa')) {
  const { page, errors } = await openGame({ width: 1920, height: 1080 });
  const shots = [];
  await page.waitForTimeout(2000);
  const dirs = [
    ['ArrowDown', 'abajo'],
    ['ArrowLeft', 'izquierda'],
    ['ArrowUp', 'arriba'],
    ['ArrowRight', 'derecha'],
  ];
  for (const [key, label] of dirs) {
    await page.evaluate(() => window.__adg.game.debugPlace(48, 24, 'down'));
    await page.keyboard.down(key);
    await page.waitForTimeout(300);
    // recorte centrado en la princesa (celda de 12×20 px a 1080p)
    const pos = await page.evaluate(() => [window.__adg.game.princess.x, window.__adg.game.princess.y]);
    const cx = (pos[0] / 0.6) * 12;
    const cy = (pos[1] + 6) * 20;
    await page.screenshot({ path: resolve(outDir, `princesa-${label}.png`), clip: { x: cx - 120, y: cy - 130, width: 240, height: 200 } });
    shots.push({ file: `princesa-${label}.png` });
    await page.keyboard.up(key);
  }
  await page.keyboard.press('F4');
  await page.waitForTimeout(500);
  shots.push(await shot(page, 'legibilidad-F4.png'));
  report.pages.princesa = { errors, shots };
  await page.close();
}

if (want('768p')) {
  const { page, errors } = await openGame({ width: 1366, height: 768 });
  await page.waitForTimeout(3000);
  const shots = [await shot(page, '768p-inicio.png')];
  report.pages['768p'] = { errors, shots, heap: await heapGrowth(page), stats: await page.evaluate(() => window.__adg.stats()) };
  await page.close();
}

if (want('atlas')) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}debug/atlas.html`);
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  await page.screenshot({ path: resolve(outDir, 'atlas.png') });
  const summary = await page.$eval('.summary', (el) => el.textContent?.replace(/\s+/g, ' ').trim());
  report.pages.atlas = { errors, summary };
  await page.close();
}

if (want('stamps')) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${base}debug/stamps.html`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
  await page.screenshot({ path: resolve(outDir, 'stamps-page.png'), fullPage: true });
  report.pages.stamps = { errors };
  await page.close();
}

writeFileSync(resolve(outDir, 'stats.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
await server.close();
