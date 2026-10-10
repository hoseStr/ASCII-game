/**
 * Piezas de escenario hechas con renders de modelos 3D (estampas). Lógica pura,
 * sin render: definiciones (generadas por tools/make_stamps.py en
 * src/data/stamps), colocación desde el JSON de la sala, huella de colisión y
 * agrupación de las rocas `#` para pintarlas con rocas renderizadas.
 */
import { tileAt, type Tilemap } from './room';
import { TILE, TILE_PROPS } from './tiles';

export type StampUse = 'prop' | 'rockfill';

export interface StampDef {
  id: string;
  image: string;
  use: StampUse;
  /** tamaño de la caja de la estampa en tiles */
  sizeTiles: [number, number];
  cells: [number, number];
  /** muestras por celda de la imagen [x, y] */
  samples: [number, number];
  solid: boolean;
  /**
   * sombra sobre el suelo: 'cast' proyecta la silueta, 'flat' es una sombra corta
   * (objetos planos) y 'render' usa la sombra real renderizada en el estudio
   */
  shadow: 'cast' | 'flat' | 'render';
  /** huella por tile, de arriba abajo: '#' sólido, '.' libre */
  footprint: string[];
  /** fotogramas de animación (tira vertical en la imagen); 1 = estática */
  frames: number;
  fps: number;
  /** sombra renderizada: imagen en grises (rejilla de sombras, 4×4 muestras por celda) y su desplazamiento respecto a la estampa */
  shadowImage?: { image: string; offset: [number, number]; size: [number, number] };
  /** relleno de rocas: zonas donde se usa (sin lista = en todas) */
  zones?: string[];
  credits: { title: string; author: string; license: string; sourceUrl: string };
}

/** Colocación en el JSON de la sala: `tile` es el tile superior izquierdo de la caja. */
export interface PropPlacement {
  stamp: string;
  tile: [number, number];
  flip?: boolean;
  /** pieza héroe de la sala: el punto focal (una por sala, ver docs/composicion.md) */
  hero?: boolean;
}

export interface PlacedProp {
  def: StampDef;
  tx: number;
  ty: number;
  flip: boolean;
}

/** Grupo de rocas `#` contiguas (caja inclusiva en tiles) con su textura. */
export interface RockFill {
  def: StampDef;
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
}

const defFiles = import.meta.glob('../data/stamps/*.json', { import: 'default', eager: true }) as Record<string, StampDef>;

export function loadStampDefs(): Map<string, StampDef> {
  const map = new Map<string, StampDef>();
  for (const def of Object.values(defFiles)) map.set(def.id, def);
  return map;
}

export class PropError extends Error {}

/** Resuelve las colocaciones de una sala contra las definiciones (valida ids y límites). */
export function resolveProps(roomId: string, placements: PropPlacement[] | undefined, defs: Map<string, StampDef>, map: Tilemap): PlacedProp[] {
  const out: PlacedProp[] = [];
  for (const p of placements ?? []) {
    const def = defs.get(p.stamp);
    if (!def) throw new PropError(`${roomId}: estampa desconocida '${p.stamp}'`);
    if (def.use !== 'prop') throw new PropError(`${roomId}: '${p.stamp}' es una textura de roca, no una pieza`);
    const [tx, ty] = p.tile;
    const [w, h] = def.sizeTiles;
    if (tx < 0 || ty < 0 || tx + w > map.w || ty + h > map.h) {
      throw new PropError(`${roomId}: '${p.stamp}' en (${tx}, ${ty}) se sale de la sala`);
    }
    out.push({ def, tx, ty, flip: p.flip ?? false });
  }
  // de atrás hacia delante: la pieza más al sur se dibuja encima
  out.sort((a, b) => a.ty + a.def.sizeTiles[1] - (b.ty + b.def.sizeTiles[1]));
  return out;
}

/** ¿El tile (dx, dy) de la caja de la pieza es sólido? (con espejo horizontal) */
export function footprintSolid(prop: PlacedProp, dx: number, dy: number): boolean {
  const row = prop.def.footprint[dy] ?? '';
  const x = prop.flip ? prop.def.sizeTiles[0] - 1 - dx : dx;
  return prop.def.solid && row[x] === '#';
}

/**
 * Devuelve un tilemap nuevo con la huella sólida de las piezas marcada como
 * TILE.prop. Una huella sólida solo puede caer sobre suelo caminable de la isla.
 */
export function applyProps(roomId: string, map: Tilemap, props: PlacedProp[]): Tilemap {
  const tiles = Uint8Array.from(map.tiles);
  for (const p of props) {
    const [w, h] = p.def.sizeTiles;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (!footprintSolid(p, dx, dy)) continue;
        const tx = p.tx + dx;
        const ty = p.ty + dy;
        const t = tileAt(map, tx, ty);
        if (!TILE_PROPS[t].walkable || !TILE_PROPS[t].island) {
          throw new PropError(`${roomId}: la huella de '${p.def.id}' cae sobre un tile no caminable en (${tx}, ${ty})`);
        }
        tiles[ty * map.w + tx] = TILE.prop;
      }
    }
  }
  return { w: map.w, h: map.h, tiles };
}

/** Componentes 4-conexas de rocas `#`, como cajas inclusivas. */
export function rockClusters(map: Tilemap): Array<{ tx0: number; ty0: number; tx1: number; ty1: number }> {
  const seen = new Uint8Array(map.w * map.h);
  const out: Array<{ tx0: number; ty0: number; tx1: number; ty1: number }> = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (seen[y * map.w + x] || tileAt(map, x, y) !== TILE.rock) continue;
      const box = { tx0: x, ty0: y, tx1: x, ty1: y };
      const stack = [x, y];
      seen[y * map.w + x] = 1;
      while (stack.length > 0) {
        const cy = stack.pop()!;
        const cx = stack.pop()!;
        box.tx0 = Math.min(box.tx0, cx);
        box.tx1 = Math.max(box.tx1, cx);
        box.ty0 = Math.min(box.ty0, cy);
        box.ty1 = Math.max(box.ty1, cy);
        for (const [nx, ny] of [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
          const i = ny * map.w + nx;
          if (seen[i] || tileAt(map, nx, ny) !== TILE.rock) continue;
          seen[i] = 1;
          stack.push(nx, ny);
        }
      }
      out.push(box);
    }
  }
  return out;
}

/** Tamaño máximo (en tiles) de una roca fotográfica: más grande se deformaría. */
export const ROCK_RECT_MAX_W = 3;
export const ROCK_RECT_MAX_H = 2;

/**
 * Descompone las rocas `#` en rectángulos (como mucho 3×2 tiles) que las cubren
 * exactamente, sin solaparse: barrido por filas, cada rectángulo crece primero en
 * ancho y luego en alto mientras la fila entera siga siendo roca libre.
 */
export function rockRects(map: Tilemap): Array<{ tx0: number; ty0: number; tx1: number; ty1: number }> {
  const used = new Uint8Array(map.w * map.h);
  const free = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < map.w && y < map.h && !used[y * map.w + x] && tileAt(map, x, y) === TILE.rock;
  const out: Array<{ tx0: number; ty0: number; tx1: number; ty1: number }> = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (!free(x, y)) continue;
      let w = 1;
      while (w < ROCK_RECT_MAX_W && free(x + w, y)) w++;
      let h = 1;
      while (h < ROCK_RECT_MAX_H) {
        let rowOk = true;
        for (let k = 0; k < w; k++) if (!free(x + k, y + h)) rowOk = false;
        if (!rowOk) break;
        h++;
      }
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[yy * map.w + xx] = 1;
      out.push({ tx0: x, ty0: y, tx1: x + w - 1, ty1: y + h - 1 });
    }
  }
  return out;
}

/** Tolerancia de proporción (log) para considerar dos variantes igual de buenas. */
const ROCK_ASPECT_TOLERANCE = 0.35;

/**
 * Cada rectángulo de roca toma una roca recortada (foto o render) de las
 * permitidas en la zona: entre las variantes cuya proporción se parece a la del
 * rectángulo, una elegida por hash (determinista), para que no se repitan.
 * La imagen se estira al rectángulo; su contorno es el de la propia imagen.
 */
export function assignRockFills(map: Tilemap, defs: Map<string, StampDef>, seed: number, zone?: string): RockFill[] {
  const all = [...defs.values()].filter((d) => d.use === 'rockfill').sort((a, b) => a.id.localeCompare(b.id));
  const inZone = all.filter((d) => !d.zones || zone === undefined || d.zones.includes(zone));
  const fills = inZone.length > 0 ? inZone : all;
  if (fills.length === 0) return [];
  return rockRects(map).map((r, i) => {
    const aspect = (r.tx1 - r.tx0 + 1) / (r.ty1 - r.ty0 + 1);
    let h = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(r.tx0 * 31 + r.ty0, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    const score = (d: StampDef): number => Math.abs(Math.log(d.sizeTiles[0] / d.sizeTiles[1] / aspect));
    const best = Math.min(...fills.map(score));
    const candidates = fills.filter((d) => score(d) <= best + ROCK_ASPECT_TOLERANCE);
    return { def: candidates[h % candidates.length]!, ...r };
  });
}
