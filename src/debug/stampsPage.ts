/**
 * Página de depuración de las estampas (piezas de escenario hechas con fotos):
 * imagen procesada, conversión literal del repo (texto) y la pieza tal como se
 * ve en el juego (conversión pura con los colores reales), más la licencia.
 */
import { FONT_FAMILY } from '../render/atlas';
import { loadGameFont } from '../render/fontLoader';
import { convertStamp, loadStampImages, type StampImage } from '../render/stamps';
import { loadZonePalette } from '../render/zonePalette';
import { loadStampDefs } from '../world/props';

const previews = import.meta.glob('../data/stamps/*.preview.txt', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const css = `
  body { margin: 0; background: #0c0a1c; color: #d9d2ee; font: 14px/1.5 system-ui, sans-serif; }
  main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-weight: 500; font-size: 22px; margin: 0 0 4px; }
  h2 { font-weight: 500; font-size: 17px; margin: 0 0 6px; color: #f0e6ff; }
  p.note { color: #8a83a8; margin: 0 0 20px; max-width: 72ch; }
  section { border-top: 1px solid #221d40; padding: 18px 0; }
  .row { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; }
  .cap { color: #8a83a8; font-size: 12px; margin: 2px 0 6px; }
  canvas { display: block; image-rendering: pixelated; border-radius: 3px; }
  pre { margin: 0; padding: 6px 8px; background: #f4f1ea; color: #111; font: 13px/1.05 "${FONT_FAMILY}", monospace; border-radius: 3px; }
  .meta { font-size: 13px; color: #b8b0d6; }
  .meta a { color: #c9b8ff; }
`;

function pngCanvas(img: StampImage, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.w * scale;
  c.height = img.h * scale;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      const a = img.data[i + 3]!;
      if (a === 0) continue;
      ctx.fillStyle = `rgba(${img.data[i]},${img.data[i + 1]},${img.data[i + 2]},${a / 255})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return c;
}

/** La pieza como en el juego: celdas 3:5, glifo de la rampa del repo y color real del bloque. */
function gameCanvas(img: StampImage, samples: number, paper: [number, number, number]): HTMLCanvasElement {
  const cells = convertStamp(img, samples, 'light');
  const cw = 12;
  const ch = 20;
  const c = document.createElement('canvas');
  c.width = cells[0]!.length * cw;
  c.height = cells.length * ch;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `rgb(${paper.map((v) => Math.round(v * 255)).join(',')})`;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = `bold ${ch - 3}px "${FONT_FAMILY}"`;
  ctx.textBaseline = 'top';
  cells.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (!cell.char) return;
      ctx.fillStyle = `rgb(${[cell.r, cell.g, cell.b].map((v) => Math.round(v * 255)).join(',')})`;
      ctx.fillText(cell.char, x * cw, y * ch + 2);
    }),
  );
  return c;
}

async function main(): Promise<void> {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  await loadGameFont();
  const defs = loadStampDefs();
  const images = await loadStampImages(defs);
  const paper = loadZonePalette('forest').paper;
  const root = document.getElementById('stamps-root')!;
  const mainEl = document.createElement('main');
  root.appendChild(mainEl);
  mainEl.innerHTML = `
    <h1>Estampas: fotos convertidas en piezas de escenario</h1>
    <p class="note">Cada pieza parte de una foto en dominio público o CC0. tools/make_stamps.py la recorta y la reduce a 4×4 muestras por celda. En el juego se convierte a ASCII tal cual, con el algoritmo del repo y los colores reales de la foto: sin tinte, luz, niebla ni contornos.</p>`;
  for (const def of [...defs.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const img = images.get(def.id)!;
    const sec = document.createElement('section');
    const h = document.createElement('h2');
    h.textContent = def.id;
    sec.appendChild(h);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const a = document.createElement('a');
    a.href = def.credits.sourceUrl;
    a.textContent = def.credits.title || def.credits.sourceUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    meta.append(
      `${def.use === 'prop' ? 'pieza' : 'textura de roca'} · ${def.sizeTiles[0]}×${def.sizeTiles[1]} tiles (${def.cells[0]}×${def.cells[1]} celdas) · ${def.solid ? `sólida, huella ${def.footprint.join('/')}` : 'decorativa'} · foto: `,
      a,
      ` de ${def.credits.author} · ${def.credits.license}`,
    );
    sec.appendChild(meta);
    const row = document.createElement('div');
    row.className = 'row';
    const fig = (label: string, el: HTMLElement): void => {
      const d = document.createElement('div');
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = label;
      d.append(cap, el);
      row.appendChild(d);
    };
    fig('imagen procesada', pngCanvas(img, 3));
    fig('en el juego (algoritmo del repo, colores reales)', gameCanvas(img, def.samples, paper));
    const pre = document.createElement('pre');
    pre.textContent = previews[`../data/stamps/${def.id}.preview.txt`] ?? '';
    fig('algoritmo literal del repo (img2txt, fondo blanco)', pre);
    sec.appendChild(row);
    mainEl.appendChild(sec);
  }
  document.body.dataset.ready = '1';
}

main().catch((e: unknown) => {
  document.body.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
