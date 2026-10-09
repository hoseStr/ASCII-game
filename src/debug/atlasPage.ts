/**
 * Página de depuración del atlas: todos los glifos rasterizados con la fuente
 * del juego, su origen (fuente, procedural o estirado), la tinta medida, los
 * desbordes de celda y las rampas por material en su orden final.
 */
import { FONT_FAMILY, buildAtlas, type GlyphAtlas } from '../render/atlas';
import { MATERIALS, RAMPS, RESERVED_ENTITY_GLYPHS } from '../render/glyphs';
import { loadGameFont } from '../render/fontLoader';

const css = `
  body { margin: 0; background: #0c0a1c; color: #d9d2ee; font: 14px/1.5 system-ui, sans-serif; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-weight: 500; font-size: 22px; margin: 0 0 4px; }
  h2 { font-weight: 500; font-size: 17px; margin: 32px 0 8px; color: #f0e6ff; }
  p.note { color: #8a83a8; margin: 0 0 16px; }
  .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
  select { background: #1c1838; color: inherit; border: 1px solid #3a335e; border-radius: 4px; padding: 4px 8px; }
  .atlas-wrap { overflow-x: auto; border: 1px solid #2c2650; border-radius: 6px; background: #14112a; }
  canvas { display: block; image-rendering: pixelated; }
  .summary span { display: inline-block; margin-right: 18px; }
  .bad { color: #ff8fa8; }
  .ok { color: #9be2c4; }
  .ramp { display: flex; flex-wrap: wrap; gap: 2px; margin: 4px 0 12px; }
  .ramp div { display: flex; flex-direction: column; align-items: center; width: 34px; }
  .ramp canvas { background: #14112a; border-radius: 2px; }
  .ramp i { display: block; width: 100%; height: 4px; background: #2c2650; margin-top: 2px; position: relative; }
  .ramp i b { position: absolute; left: 0; top: 0; bottom: 0; background: #c9b8ff; }
  .ramp small { color: #8a83a8; font-size: 10px; }
  table { border-collapse: collapse; font-size: 13px; width: 100%; }
  th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid #221d40; }
  th { color: #8a83a8; font-weight: 500; }
  td.g { font-family: "${FONT_FAMILY}", monospace; font-size: 18px; }
`;

async function main(): Promise<void> {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const font = await loadGameFont();

  const root = document.getElementById('atlas-root')!;
  const mainEl = document.createElement('main');
  root.appendChild(mainEl);
  mainEl.innerHTML = `
    <h1>Atlas de glifos</h1>
    <p class="note">DejaVu Sans Mono Bold · cada ranura mide exactamente una celda (proporción 3:5) y recorta lo que se salga.</p>
    <div class="controls">
      <label>Celda <select id="size">
        <option value="6x10">6×10 (los videos del repo)</option>
        <option value="8x13">8×13 (1366×768)</option>
        <option value="12x20">12×20 (1080p)</option>
        <option value="24x40" selected>24×40 (zoom)</option>
      </select></label>
    </div>
    <div id="out"></div>`;
  const out = mainEl.querySelector<HTMLDivElement>('#out')!;
  const select = mainEl.querySelector<HTMLSelectElement>('#size')!;
  const render = (): void => {
    const [w, h] = select.value.split('x').map(Number) as [number, number];
    out.replaceChildren(renderAtlas(buildAtlas(font, w, h)));
  };
  select.addEventListener('change', render);
  render();
}

function glyphCanvas(atlas: GlyphAtlas, index: number, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = atlas.cellW * scale;
  c.height = atlas.cellH * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#14112a';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(
    atlas.canvas,
    (index % atlas.cols) * atlas.cellW,
    Math.floor(index / atlas.cols) * atlas.cellH,
    atlas.cellW,
    atlas.cellH,
    0,
    0,
    c.width,
    c.height,
  );
  return c;
}

function renderAtlas(atlas: GlyphAtlas): HTMLElement {
  const wrap = document.createElement('div');
  const overflow = atlas.reports.filter((r) => r.source === 'fitted');
  const clipped = atlas.reports.filter((r) => r.source === 'font' && r.overflowPx > 0.25);
  const summary = document.createElement('p');
  summary.className = 'summary';
  summary.innerHTML = `
    <span>${atlas.glyphs.length} glifos</span>
    <span>fuente ${atlas.fontSizePx.toFixed(2)} px</span>
    <span class="${atlas.missing.length ? 'bad' : 'ok'}">ausentes: ${atlas.missing.length ? atlas.missing.join(' ') : 'ninguno'}</span>
    <span>encajados (escalados para caber): ${overflow.length ? overflow.map((r) => r.char).join(' ') : 'ninguno'}</span>
    <span class="${clipped.length ? 'bad' : 'ok'}">recortados &gt; 0,25 px: ${clipped.length ? clipped.map((r) => `${r.char} (${r.overflowPx.toFixed(1)})`).join(' ') : 'ninguno'}</span>`;
  wrap.appendChild(summary);

  // Atlas completo con rejilla.
  const scale = atlas.cellW <= 12 ? 3 : 1;
  const big = document.createElement('canvas');
  big.width = atlas.canvas.width * scale;
  big.height = atlas.canvas.height * scale;
  const ctx = big.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#14112a';
  ctx.fillRect(0, 0, big.width, big.height);
  ctx.drawImage(atlas.canvas, 0, 0, big.width, big.height);
  ctx.strokeStyle = 'rgba(140,130,190,0.25)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= atlas.cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * atlas.cellW * scale + 0.5, 0);
    ctx.lineTo(x * atlas.cellW * scale + 0.5, big.height);
    ctx.stroke();
  }
  for (let y = 0; y <= atlas.rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * atlas.cellH * scale + 0.5);
    ctx.lineTo(big.width, y * atlas.cellH * scale + 0.5);
    ctx.stroke();
  }
  const atlasWrap = document.createElement('div');
  atlasWrap.className = 'atlas-wrap';
  atlasWrap.appendChild(big);
  wrap.appendChild(atlasWrap);

  // Rampas por material.
  const h2 = document.createElement('h2');
  h2.textContent = 'Rampas por material (de oscuro a brillante; barra = tinta medida)';
  wrap.appendChild(h2);
  const maxCov = Math.max(...atlas.reports.map((r) => r.coverage));
  for (const m of MATERIALS) {
    const title = document.createElement('div');
    title.textContent = `${m} · ${atlas.rampChars[m].length} glifos · orden ${RAMPS[m].order === 'measured' ? 'medido' : 'de autor'}`;
    wrap.appendChild(title);
    const row = document.createElement('div');
    row.className = 'ramp';
    for (const idx of atlas.ramps[m]) {
      const r = atlas.reports[idx]!;
      const cell = document.createElement('div');
      const gc = glyphCanvas(atlas, idx, Math.max(1, Math.round(30 / atlas.cellW)));
      gc.style.width = '30px';
      cell.appendChild(gc);
      const bar = document.createElement('i');
      const fill = document.createElement('b');
      fill.style.width = `${(100 * r.coverage) / maxCov}%`;
      bar.appendChild(fill);
      cell.appendChild(bar);
      const pct = document.createElement('small');
      pct.textContent = `${(100 * r.coverage).toFixed(0)}%`;
      cell.appendChild(pct);
      row.appendChild(cell);
    }
    wrap.appendChild(row);
  }

  // Tabla detallada.
  const h3 = document.createElement('h2');
  h3.textContent = 'Detalle por glifo';
  wrap.appendChild(h3);
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>#</th><th>glifo</th><th>código</th><th>origen</th><th>tinta</th><th>desborde</th><th>uso</th></tr></thead>';
  const tbody = document.createElement('tbody');
  const reserved = new Set(Array.from(RESERVED_ENTITY_GLYPHS));
  const uses = new Map<string, string[]>();
  for (const m of MATERIALS) for (const ch of atlas.rampChars[m]) uses.set(ch, [...(uses.get(ch) ?? []), m]);
  for (const r of atlas.reports) {
    const tr = document.createElement('tr');
    const use = reserved.has(r.char) ? 'entidad (reservado)' : (uses.get(r.char) ?? ['interfaz']).join(', ');
    const cells = [
      String(r.index),
      r.char === ' ' ? '␠' : r.char,
      `U+${r.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
      r.source,
      `${(100 * r.coverage).toFixed(1)}%`,
      r.overflowPx > 0.25 ? `${r.overflowPx.toFixed(1)} px${r.source === 'fitted' ? ' → encajado' : ''}` : '—',
      use,
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 1) td.className = 'g';
      if ((i === 3 && r.source === 'missing') || (i === 5 && r.source === 'font' && r.overflowPx > 0.25)) td.classList.add('bad');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

main().catch((e: unknown) => {
  document.body.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
