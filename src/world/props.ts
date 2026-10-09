/**
 * Piezas de escenario hechas con fotos (estampas). Lógica pura, sin render:
 * definiciones (generadas por tools/make_stamps.py en src/data/stamps), colocación
 * desde el JSON de la sala, huella de colisión y agrupación de las rocas `#`
 * para pintarlas con texturas fotográficas.
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
  samples: number;
  solid: boolean;
  /** huella por tile, de arriba abajo: '#' sólido, '.' libre */
  footprint: string[];
  credits: { title: string; author: string; license: string; sourceUrl: string };
}

/** Colocación en el JSON de la sala: `tile` es el tile superior izquierdo de la caja. */
export interface PropPlacement {
  stamp: string;
  tile: [number, number];
  flip?: boolean;
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

/** Asigna a cada grupo de rocas una textura (variante elegida por hash, determinista). */
export function assignRockFills(map: Tilemap, defs: Map<string, StampDef>, seed: number): RockFill[] {
  const fills = [...defs.values()].filter((d) => d.use === 'rockfill').sort((a, b) => a.id.localeCompare(b.id));
  if (fills.length === 0) return [];
  return rockClusters(map).map((c, i) => {
    let h = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(c.tx0 * 31 + c.ty0, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    return { def: fills[h % fills.length]!, ...c };
  });
}
