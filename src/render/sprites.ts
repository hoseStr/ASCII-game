/**
 * Sprites ASCII multicelda definidos como texto (src/data/sprites/*.txt) con una
 * capa de glifos y otra de claves de color, más un JSON con la paleta de claves.
 *
 * Formato del .txt:
 *   @frame <dirección>.<animación>.<índice>
 *   <h filas de glifos, w columnas>
 *   :colors
 *   <h filas de claves de color; '.' = celda transparente>
 * Las direcciones son down, up, right y left; si falta `left`, se genera
 * espejando `right` con la tabla MIRROR.
 */
import { oklchToSrgb, type Oklch } from './palette';
import type { CellBuffer } from './cellBuffer';
import { glyphIndex } from './glyphs';

export interface SpriteColorDef {
  fg: Oklch;
  bg?: Oklch;
  /** 0..1: brillo propio (bloom) */
  emissive?: number;
}

export interface SpriteDef {
  width: number;
  height: number;
  /** celda del sprite que coincide con la posición de la entidad (pies) */
  anchor: [number, number];
  colors: Record<string, SpriteColorDef>;
}

export interface SpriteFrame {
  glyphs: Uint16Array;
  /** índice de color por celda (0 = transparente) */
  keys: Uint8Array;
}

export interface SpriteSheet {
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** animaciones: "down.walk" → fotogramas */
  anims: Map<string, SpriteFrame[]>;
  /** colores por índice (el 0 no se usa): sRGB */
  fg: Float32Array;
  bg: Float32Array;
  hasBg: Uint8Array;
  emissive: Float32Array;
  /** glifos del sprite (para verificar la fuente y la regla de legibilidad) */
  glyphSet: Set<string>;
}

/** Pares de glifos que se intercambian al espejar en horizontal. */
const MIRROR_PAIRS = [
  '◜◝', '◞◟', '⎛⎞', '⎝⎠', '◢◣', '◤◥', '▖▗', '▘▝', '▌▐', '▙▟', '▛▜', '◸◹', '◺◿', '()', '❨❩', '⟨⟩',
  '⊂⊃', '◂▸', '◀▶', '/\\', '╭╮', '╰╯', '┌┐', '└┘', '├┤', '╔╗', '╚╝', '[]', '{}', '<>', '▞▚',
];
export const MIRROR: ReadonlyMap<string, string> = new Map(
  MIRROR_PAIRS.flatMap((p) => {
    const [a, b] = Array.from(p) as [string, string];
    return [
      [a, b],
      [b, a],
    ];
  }),
);

export function mirrorGlyph(ch: string): string {
  return MIRROR.get(ch) ?? ch;
}

interface RawFrame {
  name: string;
  glyphs: string[][];
  keys: string[][];
}

export function parseSpriteText(text: string, w: number, h: number): RawFrame[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const frames: RawFrame[] = [];
  let i = 0;
  const readBlock = (label: string): string[][] => {
    const rows: string[][] = [];
    for (let r = 0; r < h; r++, i++) {
      const line = lines[i];
      if (line === undefined) throw new Error(`Sprite: faltan filas en ${label}`);
      const chars = Array.from(line);
      if (chars.length > w) throw new Error(`Sprite: fila demasiado larga en ${label}: '${line}'`);
      while (chars.length < w) chars.push(' ');
      rows.push(chars);
    }
    return rows;
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('@frame ')) {
      const name = line.slice(7).trim();
      i++;
      const glyphs = readBlock(name);
      if (lines[i]?.trim() !== ':colors') throw new Error(`Sprite: se esperaba ':colors' tras ${name}`);
      i++;
      const keys = readBlock(`${name}:colors`);
      frames.push({ name, glyphs, keys });
    } else {
      i++; // comentarios y líneas en blanco
    }
  }
  return frames;
}

export function buildSpriteSheet(text: string, def: SpriteDef): SpriteSheet {
  const { width: w, height: h } = def;
  const raw = parseSpriteText(text, w, h);
  const keyNames = Object.keys(def.colors);
  const keyIndex = new Map(keyNames.map((k, i) => [k, i + 1]));
  const n = keyNames.length + 1;
  const fg = new Float32Array(n * 3);
  const bg = new Float32Array(n * 3);
  const hasBg = new Uint8Array(n);
  const emissive = new Float32Array(n);
  keyNames.forEach((k, idx) => {
    const c = def.colors[k]!;
    const i = idx + 1;
    fg.set(oklchToSrgb(c.fg), i * 3);
    if (c.bg) {
      bg.set(oklchToSrgb(c.bg), i * 3);
      hasBg[i] = 1;
    }
    emissive[i] = c.emissive ?? 0;
  });

  const glyphSet = new Set<string>();
  const toFrame = (glyphs: string[][], keys: string[][], mirror: boolean): SpriteFrame => {
    const f: SpriteFrame = { glyphs: new Uint16Array(w * h), keys: new Uint8Array(w * h) };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = mirror ? w - 1 - x : x;
        const key = keys[y]![sx]!;
        if (key === '.' || key === ' ') continue;
        const ki = keyIndex.get(key);
        if (ki === undefined) throw new Error(`Sprite: clave de color '${key}' sin definir`);
        let ch = glyphs[y]![sx]!;
        if (mirror) ch = mirrorGlyph(ch);
        glyphSet.add(ch);
        f.glyphs[y * w + x] = glyphIndex(ch);
        f.keys[y * w + x] = ki;
      }
    }
    return f;
  };

  const anims = new Map<string, SpriteFrame[]>();
  const push = (dir: string, anim: string, index: number, frame: SpriteFrame): void => {
    const key = `${dir}.${anim}`;
    const list = anims.get(key) ?? [];
    list[index] = frame;
    anims.set(key, list);
  };
  for (const f of raw) {
    const [dir, anim, idx] = f.name.split('.');
    if (!dir || !anim || idx === undefined) throw new Error(`Sprite: nombre de fotograma inválido '${f.name}'`);
    push(dir, anim, Number(idx), toFrame(f.glyphs, f.keys, false));
    if (dir === 'right' && !raw.some((o) => o.name === `left.${anim}.${idx}`)) {
      push('left', anim, Number(idx), toFrame(f.glyphs, f.keys, true));
    }
  }
  return { w, h, ax: def.anchor[0], ay: def.anchor[1], anims, fg, bg, hasBg, emissive, glyphSet };
}

/**
 * Dibuja un fotograma con su celda ancla en (col, row). `bright` multiplica el
 * color (destellos), `flash` lo lleva a blanco (golpe), `clear` pide despejar
 * la capa pictórica alrededor y `depthRow` (fila de los pies) permite que las
 * piezas de escenario más al sur la tapen.
 */
export function drawSprite(
  cells: CellBuffer,
  sheet: SpriteSheet,
  frame: SpriteFrame,
  col: number,
  row: number,
  bright = 1,
  flash = 0,
  clear = true,
  depthRow = -1,
): void {
  const x0 = col - sheet.ax;
  const y0 = row - sheet.ay;
  for (let y = 0; y < sheet.h; y++) {
    for (let x = 0; x < sheet.w; x++) {
      const i = y * sheet.w + x;
      const k = frame.keys[i]!;
      if (k === 0) continue;
      const o = k * 3;
      const r = sheet.fg[o]! * bright;
      const g = sheet.fg[o + 1]! * bright;
      const b = sheet.fg[o + 2]! * bright;
      const em = Math.max(sheet.emissive[k]!, flash);
      if (sheet.hasBg[k]) {
        cells.put(
          x0 + x,
          y0 + y,
          frame.glyphs[i]!,
          r + (1 - r) * flash,
          g + (1 - g) * flash,
          b + (1 - b) * flash,
          em,
          clear,
          sheet.bg[o]! * bright,
          sheet.bg[o + 1]! * bright,
          sheet.bg[o + 2]! * bright,
          1,
          depthRow,
        );
      } else {
        cells.put(x0 + x, y0 + y, frame.glyphs[i]!, r + (1 - r) * flash, g + (1 - g) * flash, b + (1 - b) * flash, em, clear, 0, 0, 0, 0, depthRow);
      }
    }
  }
}
