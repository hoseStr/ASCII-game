/**
 * Salas: mapa ASCII (32×16) + metadatos JSON → datos listos para jugar y pintar.
 * La función de parseo es pura (testeable); la carga de los archivos de
 * src/data/rooms la hace world.ts con import.meta.glob.
 */
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from '../config';
import { blurField, signedDistanceField } from '../render/field';
import type { PropPlacement } from './props';
import {
  HUD_ROWS,
  LEGEND,
  ROOM_TILES_H,
  ROOM_TILES_W,
  TILE,
  TILE_COLS,
  TILE_PROPS,
  TILE_ROWS,
  TILE_UNITS,
  type TileId,
} from './tiles';

export interface RoomMeta {
  id: string;
  name: string;
  /** id de la paleta de zona (data/palettes.json) */
  zone: string;
  map: string;
  fireflies?: number;
  /** piezas de escenario (estampas fotográficas); ver src/world/props.ts */
  props?: PropPlacement[];
}

export interface Tilemap {
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
}

export function tileAt(map: Tilemap, tx: number, ty: number): TileId {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return TILE.void;
  return map.tiles[ty * map.w + tx] as TileId;
}

export class MapParseError extends Error {}

/** Mapa ASCII → tilemap. Valida tamaño y leyenda. */
export function parseRoomMap(text: string, id = '?'): Tilemap {
  const rows = text.replace(/\r/g, '').split('\n');
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  if (rows.length !== ROOM_TILES_H) throw new MapParseError(`${id}: ${rows.length} filas (se esperan ${ROOM_TILES_H})`);
  const tiles = new Uint8Array(ROOM_TILES_W * ROOM_TILES_H);
  rows.forEach((row, y) => {
    const chars = Array.from(row);
    if (chars.length !== ROOM_TILES_W) {
      throw new MapParseError(`${id}: la fila ${y} tiene ${chars.length} caracteres (se esperan ${ROOM_TILES_W})`);
    }
    chars.forEach((ch, x) => {
      const t = LEGEND.get(ch);
      if (t === undefined) throw new MapParseError(`${id}: carácter '${ch}' desconocido en (${x}, ${y})`);
      tiles[y * ROOM_TILES_W + x] = t;
    });
  });
  return { w: ROOM_TILES_W, h: ROOM_TILES_H, tiles };
}

export type Dir = 'north' | 'south' | 'east' | 'west';
export const DIRS: Dir[] = ['north', 'south', 'east', 'west'];
export const DIR_VEC: Record<Dir, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
export const OPPOSITE: Record<Dir, Dir> = { north: 'south', south: 'north', east: 'west', west: 'east' };

/** ¿Hay algún tile caminable en el borde `dir` del mapa? */
export function edgeWalkable(map: Tilemap, dir: Dir): boolean {
  for (let i = 0; i < (dir === 'north' || dir === 'south' ? map.w : map.h); i++) {
    const [tx, ty] =
      dir === 'north' ? [i, 0] : dir === 'south' ? [i, map.h - 1] : dir === 'west' ? [0, i] : [map.w - 1, i];
    if (TILE_PROPS[tileAt(map, tx, ty)].walkable) return true;
  }
  return false;
}

export interface CrystalSpot {
  /** centro en unidades del mundo (pantalla completa, incluida la banda del HUD) */
  x: number;
  y: number;
  size: number;
}

/** Datos de render de una sala, en coordenadas de pantalla completa (160×54 celdas). */
export interface RoomRenderData {
  field: Float32Array;
  /** id de tile por tile de pantalla (32×18: 2 filas de HUD + 16 de sala) */
  tileTex: Uint8Array;
  crystals: CrystalSpot[];
}

export const SCREEN_TILES_W = GRID_COLS / TILE_COLS; // 32
export const SCREEN_TILES_H = GRID_ROWS / TILE_ROWS; // 18
export const HUD_TILE_ROWS = HUD_ROWS / TILE_ROWS; // 2

export function buildRenderData(map: Tilemap, seed: number): RoomRenderData {
  const mask = new Uint8Array(GRID_COLS * GRID_ROWS);
  const tileTex = new Uint8Array(SCREEN_TILES_W * SCREEN_TILES_H);
  const crystals: CrystalSpot[] = [];
  let h = seed >>> 0;
  const rand = (): number => {
    h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return (h >>> 8) / 16777216;
  };
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const t = tileAt(map, tx, ty);
      tileTex[(ty + HUD_TILE_ROWS) * SCREEN_TILES_W + tx] = t;
      if (TILE_PROPS[t].island) {
        for (let y = 0; y < TILE_ROWS; y++) {
          for (let x = 0; x < TILE_COLS; x++) {
            mask[(HUD_ROWS + ty * TILE_ROWS + y) * GRID_COLS + tx * TILE_COLS + x] = 1;
          }
        }
      }
      if (t === TILE.crystal) {
        crystals.push({
          x: (tx + 0.5) * TILE_UNITS + (rand() - 0.5) * 0.8,
          y: HUD_ROWS + (ty + 0.5) * TILE_UNITS + 0.3,
          size: 0.95 + rand() * 0.45,
        });
      }
    }
  }
  const field = blurField(signedDistanceField(mask, GRID_COLS, GRID_ROWS, CELL_ASPECT), GRID_COLS, GRID_ROWS, 5, 2, 2);
  return { field, tileTex, crystals };
}
