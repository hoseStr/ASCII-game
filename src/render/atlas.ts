/**
 * Atlas de glifos: rasteriza cada glifo en una ranura del tamaño exacto de la
 * celda (en píxeles de dispositivo) y lo sube como textura R8 (cobertura).
 *
 * - Los glifos de la fuente se centran por su avance y se apoyan en una línea
 *   base calculada con las métricas tipográficas (OS/2) de la propia fuente.
 * - Bloques y líneas de caja se dibujan a mano (encajan sin juntas).
 * - Los sombreados ░▒▓ se estiran al alto de la celda.
 * - Cada ranura se recorta a la celda: nada se desborda a la vecina.
 * - Mide la cobertura (tinta) de cada glifo: sirve para ordenar rampas
 *   (port de sort_chars) y para la página de depuración.
 */
import { sortByCoverage } from './ascii';
import { MATERIALS, PROCEDURAL_GLYPHS, RAMPS, STRETCHED_GLYPHS, atlasGlyphList, type Material } from './glyphs';
import type { FontInfo } from './ttf';

export const FONT_FAMILY = 'DreamMono';

export interface GlyphReport {
  char: string;
  index: number;
  source: 'font' | 'fitted' | 'procedural' | 'stretched' | 'missing';
  coverage: number;
  /** píxeles que el glifo invadiría fuera de su celda sin encaje ni recorte */
  overflowPx: number;
}

export interface GlyphAtlas {
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  canvas: HTMLCanvasElement;
  /** cobertura por píxel (un byte), lista para texImage2D R8 */
  pixels: Uint8Array;
  index: Map<string, number>;
  glyphs: string[];
  reports: GlyphReport[];
  missing: string[];
  /** rampas finales (sentido light, índices del atlas) por material */
  ramps: Record<Material, number[]>;
  rampChars: Record<Material, string[]>;
  fontSizePx: number;
}

export function glyphIndexOrSpace(atlas: GlyphAtlas, ch: string): number {
  return atlas.index.get(ch) ?? 0;
}

const PROCEDURAL = new Set(Array.from(PROCEDURAL_GLYPHS));
/** desborde tolerado (px) antes de encajar el glifo escalándolo */
const FIT_TOLERANCE_PX = 0.75;
const STRETCHED = new Set(Array.from(STRETCHED_GLYPHS));

export function buildAtlas(font: FontInfo, cellW: number, cellH: number): GlyphAtlas {
  const glyphs = atlasGlyphList();
  const cols = 32;
  const rows = Math.ceil(glyphs.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // Tamaño de fuente: el avance llena el ancho de la celda y la caja tipográfica
  // de 1 em cabe en el alto. La línea base se centra verticalmente.
  const advEm = font.advanceOf('M') / font.unitsPerEm;
  const typoEm = (font.typoAscender - font.typoDescender) / font.unitsPerEm;
  const fontSizePx = Math.min(cellW / advEm, cellH / typoEm);
  const boxH = typoEm * fontSizePx;
  const baseline = Math.round((cellH - boxH) / 2 + (font.typoAscender / font.unitsPerEm) * fontSizePx);
  const advPx = advEm * fontSizePx;
  const penX = Math.round((cellW - advPx) / 2);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.font = `${fontSizePx}px "${FONT_FAMILY}"`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const reports: GlyphReport[] = [];
  const missing: string[] = [];
  const index = new Map<string, number>();

  glyphs.forEach((ch, i) => {
    index.set(ch, i);
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    let source: GlyphReport['source'] = 'font';
    let overflowPx = 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellW, cellH);
    ctx.clip();
    if (PROCEDURAL.has(ch)) {
      source = 'procedural';
      drawProcedural(ctx, ch, x, y, cellW, cellH);
    } else if (ch !== ' ' && !font.has(ch)) {
      // Nunca dejamos que el navegador sustituya la fuente: se marca y se dibuja '?'.
      source = 'missing';
      missing.push(ch);
      ctx.globalAlpha = 0.5;
      ctx.fillText('?', x + penX, y + baseline);
    } else if (STRETCHED.has(ch)) {
      source = 'stretched';
      const m = ctx.measureText(ch);
      const top = m.actualBoundingBoxAscent;
      const total = top + m.actualBoundingBoxDescent;
      const sy = cellH / total;
      ctx.translate(x + penX, y);
      ctx.scale(1, sy);
      ctx.fillText(ch, 0, top);
    } else if (ch !== ' ') {
      const m = ctx.measureText(ch);
      const left = penX - m.actualBoundingBoxLeft;
      const right = penX + m.actualBoundingBoxRight;
      const top = baseline - m.actualBoundingBoxAscent;
      const bottom = baseline + m.actualBoundingBoxDescent;
      overflowPx = Math.max(0, -left, right - cellW, -top, bottom - cellH);
      if (overflowPx > FIT_TOLERANCE_PX) {
        // Encaje: se escala el glifo (respecto a su línea base y centro) hasta que
        // la tinta quepa en la celda. Así un acento o un '$' alto no se pierden.
        source = 'fitted';
        const sy = Math.min(1, baseline / Math.max(1e-3, m.actualBoundingBoxAscent), (cellH - baseline) / Math.max(1e-3, m.actualBoundingBoxDescent));
        const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
        const sx = Math.min(1, cellW / Math.max(1e-3, inkW));
        // Origen en el centro de la celda: si hay que estrechar, se centra la tinta;
        // si no, se conserva la posición normal del lápiz.
        const inkMid = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
        ctx.translate(x + cellW / 2, y + baseline);
        ctx.scale(sx, sy);
        ctx.fillText(ch, sx < 1 ? -inkMid : penX - cellW / 2, 0);
      } else {
        ctx.fillText(ch, x + penX, y + baseline);
      }
    }
    ctx.restore();
    reports.push({ char: ch, index: i, source, coverage: 0, overflowPx });
  });

  // Cobertura (alfa) → R8 y tinta por glifo.
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = rgba[i * 4 + 3]!;
  for (const r of reports) {
    const x0 = (r.index % cols) * cellW;
    const y0 = Math.floor(r.index / cols) * cellH;
    let sum = 0;
    for (let y = 0; y < cellH; y++) {
      const row = (y0 + y) * canvas.width + x0;
      for (let x = 0; x < cellW; x++) sum += pixels[row + x]!;
    }
    r.coverage = sum / (255 * cellW * cellH);
  }

  const coverageOf = (ch: string): number => reports[index.get(ch)!]!.coverage;
  const ramps = {} as Record<Material, number[]>;
  const rampChars = {} as Record<Material, string[]>;
  for (const m of MATERIALS) {
    const def = RAMPS[m];
    const chars = Array.from(def.glyphs);
    // el espacio queda siempre primero; el resto se ordena por tinta medida si procede
    const ordered = def.order === 'measured' ? [' ', ...sortByCoverage(chars.slice(1), coverageOf)] : chars;
    rampChars[m] = ordered;
    ramps[m] = ordered.map((c) => index.get(c)!);
  }

  return { cellW, cellH, cols, rows, canvas, pixels, index, glyphs, reports, missing, ramps, rampChars, fontSizePx };
}

/** Bloques y líneas de caja a píxel exacto. */
function drawProcedural(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number): void {
  const hw = Math.round(w / 2);
  const hh = Math.round(h / 2);
  const rect = (rx: number, ry: number, rw: number, rh: number): void => ctx.fillRect(x + rx, y + ry, rw, rh);
  const quads: Record<string, [number, number, number, number]> = {
    // [arriba-izq, arriba-der, abajo-izq, abajo-der]
    '▖': [0, 0, 1, 0],
    '▗': [0, 0, 0, 1],
    '▘': [1, 0, 0, 0],
    '▝': [0, 1, 0, 0],
    '▞': [0, 1, 1, 0],
    '▚': [1, 0, 0, 1],
    '▙': [1, 0, 1, 1],
    '▛': [1, 1, 1, 0],
    '▜': [1, 1, 0, 1],
    '▟': [0, 1, 1, 1],
  };
  const q = quads[ch];
  if (q) {
    if (q[0]) rect(0, 0, hw, hh);
    if (q[1]) rect(hw, 0, w - hw, hh);
    if (q[2]) rect(0, hh, hw, h - hh);
    if (q[3]) rect(hw, hh, w - hw, h - hh);
    return;
  }
  const lowerEighths = '▁▂▃▄▅▆▇█';
  const li = lowerEighths.indexOf(ch);
  if (li >= 0) {
    const fh = Math.round((h * (li + 1)) / 8);
    rect(0, h - fh, w, fh);
    return;
  }
  const leftEighths = '▏▎▍▌▋▊▉';
  const le = leftEighths.indexOf(ch);
  if (le >= 0) {
    rect(0, 0, Math.round((w * (le + 1)) / 8), h);
    return;
  }
  if (ch === '▀') return rect(0, 0, w, hh);
  if (ch === '▐') return rect(hw, 0, w - hw, h);

  // Líneas de caja: segmentos desde el centro hacia cada lado.
  const t = Math.max(1, Math.round(w / 7));
  const cx = Math.round((w - t) / 2);
  const cy = Math.round((h - t) / 2);
  const seg = (side: 'n' | 's' | 'e' | 'w', off = 0): void => {
    if (side === 'n') rect(cx + off, 0, t, cy + t);
    if (side === 's') rect(cx + off, cy, t, h - cy);
    if (side === 'w') rect(0, cy + off, cx + t, t);
    if (side === 'e') rect(cx, cy + off, w - cx, t);
  };
  const light: Record<string, string> = {
    '─': 'we',
    '│': 'ns',
    '┌': 'se',
    '┐': 'sw',
    '└': 'ne',
    '┘': 'nw',
    '├': 'nse',
    '┤': 'nsw',
    '┬': 'swe',
    '┴': 'nwe',
    '┼': 'nswe',
  };
  const sides = light[ch];
  if (sides) {
    for (const s of sides) seg(s as 'n');
    return;
  }
  const round: Record<string, [number, number]> = { '╭': [1, 1], '╮': [-1, 1], '╯': [-1, -1], '╰': [1, -1] };
  const r = round[ch];
  if (r) {
    ctx.lineWidth = t;
    ctx.beginPath();
    const ox = x + cx + t / 2;
    const oy = y + cy + t / 2;
    const ex = r[0] > 0 ? x + w : x;
    const ey = r[1] > 0 ? y + h : y;
    ctx.moveTo(ex, oy);
    ctx.quadraticCurveTo(ox, oy, ox, ey);
    ctx.stroke();
    return;
  }
  const gap = Math.max(1, t);
  const dbl: Record<string, string> = { '═': 'we', '║': 'ns', '╔': 'se', '╗': 'sw', '╚': 'ne', '╝': 'nw' };
  const ds = dbl[ch];
  if (ds) {
    for (const s of ds) {
      seg(s as 'n', -gap);
      seg(s as 'n', gap);
    }
  }
}
