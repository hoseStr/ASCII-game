/**
 * Colisión AABB contra el tilemap, en unidades del mundo (tile = 3×3 unidades).
 * Movimiento separado por ejes y, al chocar de refilón con una esquina, un
 * empujón lateral que alinea a la princesa con el hueco (como en los Zelda
 * clásicos): así nunca se queda enganchada por medio tile.
 */
import { tileAt, type Tilemap } from './room';
import { TILE_PROPS, TILE_UNITS } from './tiles';

export interface Body {
  /** centro de la caja en unidades de la sala */
  x: number;
  y: number;
  /** semiejes */
  hw: number;
  hh: number;
}

/**
 * Política fuera del mapa: las salidas de la sala dejan pasar (el tile de
 * fuera copia la caminabilidad del borde); sin salida, el exterior es sólido.
 */
export interface EdgePolicy {
  north: boolean;
  south: boolean;
  east: boolean;
  west: boolean;
}

export const CLOSED_EDGES: EdgePolicy = { north: false, south: false, east: false, west: false };

export function solidAt(map: Tilemap, tx: number, ty: number, edges: EdgePolicy): boolean {
  const out = tx < 0 || ty < 0 || tx >= map.w || ty >= map.h;
  if (out) {
    if ((tx < 0 && !edges.west) || (tx >= map.w && !edges.east) || (ty < 0 && !edges.north) || (ty >= map.h && !edges.south)) {
      return true;
    }
    tx = Math.min(map.w - 1, Math.max(0, tx));
    ty = Math.min(map.h - 1, Math.max(0, ty));
  }
  return !TILE_PROPS[tileAt(map, tx, ty)].walkable;
}

/** ¿La caja, en (x, y), toca algún tile sólido? */
export function overlapsSolid(map: Tilemap, x: number, y: number, hw: number, hh: number, edges: EdgePolicy): boolean {
  const eps = 1e-4;
  const tx0 = Math.floor((x - hw + eps) / TILE_UNITS);
  const tx1 = Math.floor((x + hw - eps) / TILE_UNITS);
  const ty0 = Math.floor((y - hh + eps) / TILE_UNITS);
  const ty1 = Math.floor((y + hh - eps) / TILE_UNITS);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (solidAt(map, tx, ty, edges)) return true;
  return false;
}

const NUDGE_REACH = 1.3; // unidades: cuánto desalineamiento se perdona en una esquina

/**
 * Mueve `b` por (dx, dy) resolviendo colisiones. Devuelve true si algo bloqueó.
 * Pasos pequeños para no atravesar tiles a gran velocidad.
 */
export function moveBody(map: Tilemap, b: Body, dx: number, dy: number, edges: EdgePolicy): boolean {
  let blocked = false;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.5));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0) {
      if (!overlapsSolid(map, b.x + sx, b.y, b.hw, b.hh, edges)) b.x += sx;
      else {
        blocked = true;
        nudge(map, b, sx, 0, edges);
      }
    }
    if (sy !== 0) {
      if (!overlapsSolid(map, b.x, b.y + sy, b.hw, b.hh, edges)) b.y += sy;
      else {
        blocked = true;
        nudge(map, b, 0, sy, edges);
      }
    }
  }
  return blocked;
}

/** Empujón perpendicular hacia el hueco libre más cercano, si está a mano. */
function nudge(map: Tilemap, b: Body, sx: number, sy: number, edges: EdgePolicy): void {
  const amount = Math.max(Math.abs(sx), Math.abs(sy));
  // El hueco más cercano gana (k por fuera); sin arrays temporales.
  for (let k = 0.25; k <= NUDGE_REACH; k += 0.25) {
    for (let sign = -1; sign <= 1; sign += 2) {
      const ox = sy !== 0 ? sign * k : 0;
      const oy = sx !== 0 ? sign * k : 0;
      if (!overlapsSolid(map, b.x + ox, b.y + oy, b.hw, b.hh, edges) && !overlapsSolid(map, b.x + ox + sx, b.y + oy + sy, b.hw, b.hh, edges)) {
        // Hay hueco a k unidades: deslizar hacia él, sin pasarse.
        const step = Math.min(amount, k);
        const nx = b.x + (sy !== 0 ? sign * step : 0);
        const ny = b.y + (sx !== 0 ? sign * step : 0);
        if (!overlapsSolid(map, nx, ny, b.hw, b.hh, edges)) {
          b.x = nx;
          b.y = ny;
        }
        return;
      }
    }
  }
}
