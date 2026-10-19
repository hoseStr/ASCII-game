/**
 * Estructuras construidas de la sala (capa semántica): puentes de tablas y
 * cuerda tendidos sobre el vacío. Cada puente se compone entero al entrar en la
 * sala (no tile a tile) y cada fotograma se copia al buffer de celdas, iluminado
 * por la luz de CPU como el resto del mundo:
 *  - tablones: la madera es el fondo de la celda, cada tablón con su tono, y la
 *    junta entre dos tablones es un trazo oscuro (│ en un puente este-oeste, un
 *    tablón por columna; ─ en uno norte-sur, uno por fila); alguno con una veta
 *    (¦) o roto, que deja ver el vacío;
 *  - pasamanos de cuerda: en un puente este-oeste se comban entre poste y poste
 *    (┬-.___.-┬); en uno norte-sur se ven desde arriba (│ con postes ┼);
 *  - en cada cabecera de tierra, dos faroles (¤) que dan luz de verdad: Game.fill
 *    añade una luz por cabecera, que ilumina la madera y la orilla;
 *  - bajo un puente que cruza el vacío, las cuerdas cuelgan de los postes.
 * Un puente que llega al borde de la pantalla sigue en la sala vecina: ahí no
 * hay poste ni farol.
 */
import { CELL_ASPECT } from '../config';
import type { CellBuffer } from '../render/cellBuffer';
import { glyphIndex } from '../render/glyphs';
import { oklchToSrgb } from '../render/palette';
import type { FrameParams } from '../render/renderer';
import { lightLevel } from '../systems/lighting';
import { tileAt, type Tilemap } from './room';
import { HUD_ROWS, TILE, TILE_COLS, TILE_PROPS, TILE_ROWS, type TileId } from './tiles';

const ROPE = oklchToSrgb([0.8, 0.05, 75]);
const PLANK = oklchToSrgb([0.62, 0.07, 55]);
const POST = oklchToSrgb([0.5, 0.06, 50]);
const LANTERN = oklchToSrgb([0.94, 0.13, 82]);
const UNDER = oklchToSrgb([0.2, 0.03, 40]);
/** la cara del tablón: mezcla hacia la madera (fondo de la celda) y la junta, más oscura */
const WOOD_FACE = 0.5;
const WOOD_SEAM = 0.3;

/** celdas entre dos postes del pasamanos (puente este-oeste) */
const POST_STEP = 8;
/** filas entre dos postes (puente norte-sur) */
const POST_STEP_V = 4;
/** como mucho, una luz por cabecera de tierra */
export const MAX_BRIDGE_LIGHTS = 8;

/** Glifos (índices del atlas). */
const G = {
  seamV: glyphIndex('│'),
  seamH: glyphIndex('─'),
  grain: glyphIndex('¦'),
  worn: glyphIndex('='),
  ropeV: glyphIndex('│'),
  ropeMid: glyphIndex('-'),
  ropeLow: glyphIndex('.'),
  ropeBottom: glyphIndex('_'),
  postTop: glyphIndex('┬'),
  post: glyphIndex('┼'),
  lantern: glyphIndex('¤'),
  hang: glyphIndex('¦'),
  hangEnd: glyphIndex("'"),
};

/** Hash entero → [0, 1) (determinista: el mismo puente se ve siempre igual). */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** ¿Es tierra caminable (no puente) el tile (tx, ty)? */
function isLand(map: Tilemap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  const t = tileAt(map, tx, ty);
  return t !== TILE.bridgeH && t !== TILE.bridgeV && TILE_PROPS[t].walkable;
}

/**
 * Postes a lo largo de [a, b] (celdas o filas): en las cabeceras de tierra y cada
 * `step` desde ellas; con tierra en los dos extremos, repartidos a partes iguales.
 */
function postsAlong(a: number, b: number, landA: boolean, landB: boolean, step: number): number[] {
  const out: number[] = [];
  if (landA && landB) {
    const n = Math.max(1, Math.round((b - a) / step));
    for (let i = 0; i <= n; i++) out.push(a + Math.round((i * (b - a)) / n));
  } else if (landA) {
    for (let p = a; p <= b - 2; p += step) out.push(p);
  } else if (landB) {
    for (let p = b; p >= a + 2; p -= step) out.unshift(p);
  } else {
    for (let p = a + (step >> 1); p <= b; p += step) out.push(p);
  }
  return out;
}

/** Combado de la cuerda entre dos postes: 0 junto al poste, 1 en el centro del tramo. */
function sag(c: number, posts: number[], step: number): number {
  let prev = -Infinity;
  let next = Infinity;
  for (const p of posts) {
    if (p <= c) prev = p;
    if (p >= c && next === Infinity) next = p;
  }
  // más allá del último poste (borde de la pantalla) el tramo sigue con el mismo paso
  if (prev === -Infinity) prev = next - step;
  if (next === Infinity) next = prev + step;
  if (next === prev) return 0;
  const t = (c - prev) / (next - prev);
  return 4 * t * (1 - t);
}

export class Structures {
  count = 0;
  /** luces de los faroles (x, y en unidades de pantalla), una por cabecera de tierra */
  readonly lights = new Float32Array(MAX_BRIDGE_LIGHTS * 2);
  lightCount = 0;
  private readonly col: Int16Array;
  private readonly row: Int16Array;
  private readonly glyph: Uint16Array;
  private readonly rgb: Float32Array;
  private readonly bg: Float32Array;
  private readonly bgA: Float32Array;
  private readonly emissive: Float32Array;

  constructor(capacity = 160 * 54) {
    this.col = new Int16Array(capacity);
    this.row = new Int16Array(capacity);
    this.glyph = new Uint16Array(capacity);
    this.rgb = new Float32Array(capacity * 3);
    this.bg = new Float32Array(capacity * 3);
    this.bgA = new Float32Array(capacity);
    this.emissive = new Float32Array(capacity);
  }

  build(map: Tilemap): void {
    this.count = 0;
    this.lightCount = 0;
    const seen = new Uint8Array(map.w * map.h);
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const t = tileAt(map, tx, ty);
        if ((t !== TILE.bridgeH && t !== TILE.bridgeV) || seen[ty * map.w + tx]) continue;
        // rectángulo del puente: se extiende mientras las filas sigan siendo del mismo tipo
        let tx1 = tx;
        while (tileAt(map, tx1 + 1, ty) === t) tx1++;
        let ty1 = ty;
        while (ty1 + 1 < map.h && this.rowIs(map, t, tx, tx1, ty1 + 1)) ty1++;
        for (let y = ty; y <= ty1; y++) for (let x = tx; x <= tx1; x++) seen[y * map.w + x] = 1;
        if (t === TILE.bridgeH) this.bridgeEastWest(map, tx, ty, tx1, ty1);
        else this.bridgeNorthSouth(map, tx, ty, tx1, ty1);
      }
    }
  }

  private rowIs(map: Tilemap, t: TileId, tx0: number, tx1: number, ty: number): boolean {
    for (let x = tx0; x <= tx1; x++) if (tileAt(map, x, ty) !== t) return false;
    return true;
  }

  private landAcross(map: Tilemap, tx: number, ty0: number, ty1: number): boolean {
    for (let y = ty0; y <= ty1; y++) if (isLand(map, tx, y)) return true;
    return false;
  }

  private landAlong(map: Tilemap, tx0: number, tx1: number, ty: number): boolean {
    for (let x = tx0; x <= tx1; x++) if (isLand(map, x, ty)) return true;
    return false;
  }

  /** Puente este-oeste: tablones verticales, pasamanos combados arriba y abajo. */
  private bridgeEastWest(map: Tilemap, tx0: number, ty0: number, tx1: number, ty1: number): void {
    const c0 = tx0 * TILE_COLS;
    const c1 = (tx1 + 1) * TILE_COLS - 1;
    const r0 = HUD_ROWS + ty0 * TILE_ROWS;
    const r1 = HUD_ROWS + (ty1 + 1) * TILE_ROWS - 1;
    const west = this.landAcross(map, tx0 - 1, ty0, ty1);
    const east = this.landAcross(map, tx1 + 1, ty0, ty1);
    const posts = postsAlong(c0, c1, west, east, POST_STEP);
    const lanternAt = (c: number): boolean => (west && c === c0) || (east && c === c1);
    const seed = tx0 * 131 + ty0 * 17;
    for (let c = c0; c <= c1; c++) {
      // pasamanos (el de detrás arriba, el de delante abajo)
      const isPost = posts.includes(c);
      for (const r of [r0, r1]) {
        if (lanternAt(c)) this.put(c, r, G.lantern, LANTERN, 1, 0.3, 0.85);
        else if (isPost) this.put(c, r, r === r0 ? G.postTop : G.post, POST, 1, 0.5, 0);
        else {
          const s = sag(c, posts, POST_STEP);
          this.put(c, r, s < 0.5 ? G.ropeMid : s < 0.8 ? G.ropeLow : G.ropeBottom, ROPE, 1, 0.35, 0);
        }
      }
      // tablero: un tablón por columna, cada uno con su tono; alguno con veta o roto
      const h = hash(c, seed, 1);
      const tone = 0.78 + 0.4 * hash(c, seed, 2) + (c % 2 === 0 ? 0.05 : -0.05);
      const nearEnd = c - c0 < 3 || c1 - c < 3;
      const missing = !nearEnd && h > 0.95;
      const grainRow = r0 + 1 + Math.floor(hash(c, seed, 3) * (r1 - r0 - 1));
      for (let r = r0 + 1; r < r1; r++) {
        if (missing) this.put(c, r, 0, PLANK, 0, 0.35, 0);
        else this.plank(c, r, h < 0.14 && r === grainRow ? G.grain : G.seamV, tone);
      }
      // cuerdas que cuelgan de los postes bajo el puente, si debajo está el vacío
      if (isPost && !lanternAt(c) && r1 + 2 < HUD_ROWS + map.h * TILE_ROWS) {
        const tBelow = tileAt(map, Math.floor(c / TILE_COLS), ty1 + 1);
        if (tBelow === TILE.void) {
          this.put(c, r1 + 1, G.hang, ROPE, 0.55, 0, 0);
          this.put(c, r1 + 2, G.hangEnd, ROPE, 0.4, 0, 0);
        }
      }
    }
    if (west) this.addLight(c0, (r0 + r1) / 2);
    if (east) this.addLight(c1, (r0 + r1) / 2);
  }

  /** Puente norte-sur: tablones horizontales, cuerdas a los lados vistas desde arriba. */
  private bridgeNorthSouth(map: Tilemap, tx0: number, ty0: number, tx1: number, ty1: number): void {
    const c0 = tx0 * TILE_COLS;
    const c1 = (tx1 + 1) * TILE_COLS - 1;
    const r0 = HUD_ROWS + ty0 * TILE_ROWS;
    const r1 = HUD_ROWS + (ty1 + 1) * TILE_ROWS - 1;
    const north = this.landAlong(map, tx0, tx1, ty0 - 1);
    const south = this.landAlong(map, tx0, tx1, ty1 + 1);
    const posts = postsAlong(r0, r1, north, south, POST_STEP_V);
    const lanternAt = (r: number): boolean => (north && r === r0) || (south && r === r1);
    const seed = tx0 * 71 + ty0 * 29;
    for (let r = r0; r <= r1; r++) {
      for (const c of [c0, c1]) {
        if (lanternAt(r)) this.put(c, r, G.lantern, LANTERN, 1, 0.3, 0.85);
        else if (posts.includes(r)) this.put(c, r, G.post, POST, 1, 0.5, 0);
        else this.put(c, r, G.ropeV, ROPE, 1, 0.35, 0);
      }
      // tablero: un tablón por fila; alguno gastado en un tramo, o roto
      const h = hash(r, seed, 1);
      const tone = 0.78 + 0.4 * hash(r, seed, 2) + (r % 2 === 0 ? 0.05 : -0.05);
      const nearEnd = r - r0 < 2 || r1 - r < 2;
      const missing = !nearEnd && h > 0.95;
      const wornCol = c0 + 1 + Math.floor(hash(r, seed, 3) * (c1 - c0 - 1));
      for (let c = c0 + 1; c < c1; c++) {
        if (missing) this.put(c, r, 0, PLANK, 0, 0.35, 0);
        else this.plank(c, r, h < 0.14 && c === wornCol ? G.worn : G.seamH, tone);
      }
    }
    if (north) this.addLight((c0 + c1) / 2, r0);
    if (south) this.addLight((c0 + c1) / 2, r1);
  }

  /** Celda de tablón: la madera de fondo y la junta (o la veta) en trazo oscuro. */
  private plank(col: number, row: number, glyph: number, tone: number): void {
    this.put(col, row, glyph, PLANK, tone * WOOD_SEAM, 1, 0);
    const o = (this.count - 1) * 3;
    for (let k = 0; k < 3; k++) this.bg[o + k] = UNDER[k]! + (PLANK[k]! * tone - UNDER[k]!) * WOOD_FACE;
  }

  private put(col: number, row: number, glyph: number, color: readonly number[], k: number, bgA: number, emissive: number): void {
    if (this.count >= this.col.length) return;
    const i = this.count++;
    this.col[i] = col;
    this.row[i] = row;
    this.glyph[i] = glyph;
    this.rgb[i * 3] = color[0]! * k;
    this.rgb[i * 3 + 1] = color[1]! * k;
    this.rgb[i * 3 + 2] = color[2]! * k;
    this.bg.set(UNDER, i * 3);
    this.bgA[i] = bgA;
    this.emissive[i] = emissive;
  }

  private addLight(col: number, row: number): void {
    if (this.lightCount >= MAX_BRIDGE_LIGHTS) return;
    this.lights[this.lightCount * 2] = (col + 0.5) * CELL_ASPECT;
    this.lights[this.lightCount * 2 + 1] = row + 0.5;
    this.lightCount++;
  }

  /** Copia las estructuras al buffer, coloreadas por la luz local (como el resto del mundo). */
  draw(cells: CellBuffer, f: FrameParams, ambient: number): void {
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      const em = this.emissive[i]!;
      // los faroles son la luz: no se apagan con la noche
      const light = em > 0 ? 1 : Math.min(1.6, 0.35 + 0.55 * lightLevel(f, (this.col[i]! + 0.5) * CELL_ASPECT, this.row[i]! + 0.5, ambient));
      cells.put(
        this.col[i]!,
        this.row[i]!,
        this.glyph[i]!,
        this.rgb[o]! * light,
        this.rgb[o + 1]! * light,
        this.rgb[o + 2]! * light,
        em,
        false,
        this.bg[o]! * light,
        this.bg[o + 1]! * light,
        this.bg[o + 2]! * light,
        this.bgA[i]!,
      );
    }
  }
}
