/**
 * Tipos de tile del mundo. Cada carácter del mapa ASCII de una sala es un tile
 * de 5×3 celdas (3×3 unidades visuales). La leyenda vive en data/legend.json.
 *
 * Reparto entre capas:
 *  - Terreno natural (suelo, roca, árboles, agua, cristales, vacío): capa
 *    pictórica, horneado en el shader de terreno e iluminado por la luz dinámica.
 *  - Estructuras construidas (puentes): capa semántica, glifos a mano.
 */
import legendJson from '../data/legend.json';

export const TILE = {
  void: 0,
  ground: 1,
  path: 2,
  flowers: 3,
  rock: 4,
  tree: 5,
  water: 6,
  crystal: 7,
  bridgeH: 8,
  bridgeV: 9,
  /** huella sólida de una pieza de escenario (se pinta como suelo bajo la pieza) */
  prop: 10,
} as const;
export type TileName = keyof typeof TILE;
export type TileId = (typeof TILE)[TileName];

export const TILE_NAMES = Object.keys(TILE) as TileName[];

export interface TileProps {
  walkable: boolean;
  /** forma parte del cuerpo de la isla (proyecta acantilado, recibe niebla de borde) */
  island: boolean;
}

export const TILE_PROPS: Record<TileId, TileProps> = {
  [TILE.void]: { walkable: false, island: false },
  [TILE.ground]: { walkable: true, island: true },
  [TILE.path]: { walkable: true, island: true },
  [TILE.flowers]: { walkable: true, island: true },
  [TILE.rock]: { walkable: false, island: true },
  [TILE.tree]: { walkable: false, island: true },
  [TILE.water]: { walkable: false, island: true },
  [TILE.crystal]: { walkable: false, island: true },
  [TILE.bridgeH]: { walkable: true, island: false },
  [TILE.bridgeV]: { walkable: true, island: false },
  [TILE.prop]: { walkable: false, island: true },
};

/** Tamaño de un tile en celdas y en unidades del mundo. */
export const TILE_COLS = 5;
export const TILE_ROWS = 3;
export const TILE_UNITS = 3;

/** Sala: 32×16 tiles = 160×48 celdas, bajo una banda de HUD de 6 filas. */
export const ROOM_TILES_W = 32;
export const ROOM_TILES_H = 16;
export const HUD_ROWS = 6;
export const ROOM_W = ROOM_TILES_W * TILE_UNITS; // 96 unidades
export const ROOM_H = ROOM_TILES_H * TILE_UNITS; // 48 unidades

/** Carácter del mapa → tipo de tile. */
export const LEGEND: ReadonlyMap<string, TileId> = new Map(
  Object.entries(legendJson.tiles as Record<string, string>).map(([ch, name]) => {
    if (!(name in TILE)) throw new Error(`Leyenda: tipo de tile desconocido '${name}'`);
    return [ch, TILE[name as TileName]];
  }),
);
