/**
 * Página de depuración de las estampas (piezas de escenario hechas con fotos):
 * imagen procesada, conversión literal del repo (texto) y vista en el estilo del
 * juego con el tinte de cada zona, más la fuente y la licencia de la foto.
 */
import { REPO_RAMP_COMPLEX } from '../render/ascii';
import { FONT_FAMILY } from '../render/atlas';
import { loadGameFont } from '../render/fontLoader';
import { linearToSrgb, oklabToLinearRgb } from '../render/palette';
import { tintLab } from '../render/propLayer';
import { loadStampImages, type StampImage } from '../render/stamps';
import { PALETTE_SLOTS, loadZonePalette, zoneNames, type PaletteSlot } from '../render/zonePalette';
import { loadStampDefs, type StampDef } from '../world/props';

const previews = import.meta.glob('../data/stamps/*.preview.txt', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const css = `
  body { margin: 0; background: #0c0a1c; color: #d9d2ee; font: 14px/1.5 system-ui, sans-serif; }
  main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-weight: 500; font-size: 22px; margin: 0 0 4px; }
  h2 { font-weight: 500; font-size: 17px; margin: 0 0 6px; color: #f0e6ff; }
  p.note { color: #8a83a8; margin: 0 0 20px; max-width: 70ch; }
  section { border-top: 1px solid #221d40; padding: 18px 0; }
  .row { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-start; }
  .cap { color: #8a83a8; font-size: 12px; margin: 2px 0 6px; }
  canvas { display: block; image-rendering: pixelated; background: #14112a; border-radius: 3px; }
  pre { margin: 0; padding: 6px 8px; background: #f4f1ea; color: #111; font: 13px/1.05 "${FONT_FAMILY}", monospace; border-radius: 3px; }
  .zones { display: flex; gap: 10px; flex-wrap: wrap; }
  .meta { font-size: 13px; color: #b8b0d6; }
  .meta a { color: #c9b8ff; }
`;

const RAMP_LIGHT = Array.from(REPO_RAMP_COMPLEX).reverse();

function pngCanvas(img: StampImage, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.w * scale;
  c.height = img.h * scale;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      const a = img.data[i + 3]!;
      if (a <= 0) continue;
      const rgb = oklabToLinearRgb([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]);
      ctx.fillStyle = `rgba(${rgb.map((v) => Math.round(linearToSrgb(Math.max(0, v)) * 255)).join(',')},${a})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return c;
}

/** Vista en el estilo del juego: tinte de zona, rampa del repo en sentido light, fondo pintado. */
function zoneCanvas(def: StampDef, img: StampImage, zone: string): HTMLCanvasElement {
  const pal = loadZonePalette(zone);
  const si = PALETTE_SLOTS.indexOf(def.tint.slot as PaletteSlot) * 3;
  const sl = pal.surfaceOklab;
  const cw = 9;
  const ch = 15;
  const cols = def.cells[0];
  const rows = def.cells[1];
  const S = def.samples;
  const c = document.createElement('canvas');
  c.width = cols * cw;
  c.height = rows * ch;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `rgb(${pal.paper.map((v) => Math.round(v * 255)).join(',')})`;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = `bold ${ch - 2}px "${FONT_FAMILY}"`;
  ctx.textBaseline = 'top';
  const px = new Float32Array(3);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let wsum = 0;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const i = ((cy * S + y) * img.w + cx * S + x) * 4;
          const a = img.data[i + 3]!;
          if (a <= 0) continue;
          tintLab(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, def.lum[0], def.lum[1], sl[si]!, sl[si + 1]!, sl[si + 2]!, def.tint.strength, def.tint.keepChroma, px, 0);
          const lin = oklabToLinearRgb([px[0]!, px[1]!, px[2]!]);
          r += linearToSrgb(Math.max(0, lin[0])) * a;
          g += linearToSrgb(Math.max(0, lin[1])) * a;
          b += linearToSrgb(Math.max(0, lin[2])) * a;
          wsum += a;
        }
      }
      const cover = wsum / (S * S);
      if (cover < 0.5) continue;
      r /= wsum;
      g /= wsum;
      b /= wsum;
      const p = pal.paper;
      ctx.fillStyle = `rgb(${[p[0] + r * 0.3, p[1] + g * 0.3, p[2] + b * 0.3].map((v) => Math.round(Math.min(1, v) * 255)).join(',')})`;
      ctx.fillRect(cx * cw, cy * ch, cw, ch);
      const L = ((r + g + b) / 3) * 255;
      const glyph = RAMP_LIGHT[Math.min(RAMP_LIGHT.length - 1, Math.floor((L * RAMP_LIGHT.length) / 255))]!;
      ctx.fillStyle = `rgb(${[r, g, b].map((v) => Math.round(Math.min(1, v * 1.5) * 255)).join(',')})`;
      ctx.fillText(glyph, cx * cw, cy * ch + 1);
    }
  }
  return c;
}

async function main(): Promise<void> {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  await loadGameFont();
  const defs = loadStampDefs();
  const images = await loadStampImages(defs);
  const root = document.getElementById('stamps-root')!;
  const mainEl = document.createElement('main');
  root.appendChild(mainEl);
  mainEl.innerHTML = `
    <h1>Estampas: fotos convertidas en piezas de escenario</h1>
    <p class="note">Cada pieza parte de una foto en dominio público o CC0. tools/make_stamps.py la recorta y la reduce a 4×4 muestras por celda; en el juego pasa por la capa pictórica y se convierte a ASCII en vivo con el algoritmo del repo, con el tinte de cada zona.</p>`;
  const zones = zoneNames();
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
      `${def.use === 'prop' ? 'pieza' : 'textura de roca'} · ${def.sizeTiles[0]}×${def.sizeTiles[1]} tiles (${def.cells[0]}×${def.cells[1]} celdas) · ${def.solid ? `sólida, huella ${def.footprint.join('/')}` : 'decorativa'} · tinte ${def.tint.slot} ${def.tint.strength} · foto: `,
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
    const pre = document.createElement('pre');
    pre.textContent = previews[`../data/stamps/${def.id}.preview.txt`] ?? '';
    fig('algoritmo literal del repo (img2txt)', pre);
    const zonesEl = document.createElement('div');
    zonesEl.className = 'zones';
    for (const z of zones) {
      const d = document.createElement('div');
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = z;
      d.append(cap, zoneCanvas(def, img, z));
      zonesEl.appendChild(d);
    }
    fig('en el juego, por zona', zonesEl);
    sec.appendChild(row);
    mainEl.appendChild(sec);
  }
  document.body.dataset.ready = '1';
}

main().catch((e: unknown) => {
  document.body.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
