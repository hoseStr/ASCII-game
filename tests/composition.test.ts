/**
 * Reglas medibles de la guía de composición (docs/composicion.md). No juzgan la
 * belleza de una sala, pero impiden los fallos que la hacían parecer "regada a la
 * loca": rocas sueltas, cosas flotando en el vacío, piezas sobre los caminos o
 * tapando salidas, salas sin punto focal y salas que no se pueden cruzar.
 */
import { describe, expect, it } from 'vitest';
import { tileAt } from '../src/world/room';
import { ROOM_TILES_H, ROOM_TILES_W, TILE, TILE_PROPS, type TileId } from '../src/world/tiles';
import { World } from '../src/world/world';

const world = new World();
const W = ROOM_TILES_W;
const H = ROOM_TILES_H;
const N4: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Componentes 4-conexas de los tiles que cumplen `pred`. */
function components(pred: (x: number, y: number) => boolean): Array<Array<[number, number]>> {
  const seen = new Uint8Array(W * H);
  const out: Array<Array<[number, number]>> = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (seen[y * W + x] || !pred(x, y)) continue;
      const comp: Array<[number, number]> = [];
      const stack: Array<[number, number]> = [[x, y]];
      seen[y * W + x] = 1;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        comp.push([cx, cy]);
        for (const [dx, dy] of N4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx] || !pred(nx, ny)) continue;
          seen[ny * W + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      out.push(comp);
    }
  }
  return out;
}

/** Tiles de la caja de cada pieza colocada. */
function propBoxes(id: string): Array<{ stamp: string; tiles: Array<[number, number]> }> {
  return world.get(id).props.map((p) => {
    const tiles: Array<[number, number]> = [];
    for (let y = p.ty; y < p.ty + p.def.sizeTiles[1]; y++) for (let x = p.tx; x < p.tx + p.def.sizeTiles[0]; x++) tiles.push([x, y]);
    return { stamp: p.def.id, tiles };
  });
}

const DECOR: TileId[] = [TILE.rock, TILE.tree, TILE.crystal];
const GROUND: TileId[] = [TILE.ground, TILE.path, TILE.flowers, TILE.prop];

describe('composición de las salas (docs/composicion.md)', () => {
  for (const [id, room] of world.rooms) {
    const t = (x: number, y: number): TileId => tileAt(room.map, x, y);

    it(`${id}: nada flota en el vacío (cada grupo de rocas, árboles o cristales toca suelo)`, () => {
      for (const comp of components((x, y) => DECOR.includes(t(x, y)))) {
        const touches = comp.some(([x, y]) => N4.some(([dx, dy]) => GROUND.includes(t(x + dx, y + dy))));
        expect(touches, `${id}: grupo en ${JSON.stringify(comp[0])}`).toBe(true);
      }
    });

    it(`${id}: las rocas van en grupos, nunca sueltas de una en una`, () => {
      for (const comp of components((x, y) => t(x, y) === TILE.rock)) {
        expect(comp.length, `${id}: roca suelta en ${JSON.stringify(comp[0])}`).toBeGreaterThanOrEqual(2);
      }
    });

    it(`${id}: una sola pieza héroe (el punto focal)`, () => {
      expect((room.meta.props ?? []).filter((p) => p.hero).length).toBe(1);
    });

    it(`${id}: las piezas no tapan caminos ni puentes, y se apoyan en la isla`, () => {
      for (const p of room.props) {
        for (let x = p.tx; x < p.tx + p.def.sizeTiles[0]; x++) {
          for (let y = p.ty; y < p.ty + p.def.sizeTiles[1]; y++) {
            const k = t(x, y);
            expect(k === TILE.path || k === TILE.bridgeH || k === TILE.bridgeV, `${id}: ${p.def.id} sobre camino en (${x}, ${y})`).toBe(false);
          }
        }
        // la fila de la base (donde la pieza toca el suelo) está sobre la isla
        const by = p.ty + p.def.sizeTiles[1] - 1;
        for (let x = p.tx; x < p.tx + p.def.sizeTiles[0]; x++) {
          expect(TILE_PROPS[t(x, by)].island, `${id}: ${p.def.id} con la base sobre el vacío en (${x}, ${by})`).toBe(true);
        }
      }
    });

    it(`${id}: las salidas quedan libres (ninguna pieza a menos de 2 tiles del borde de una salida)`, () => {
      const exitTiles: Array<[number, number]> = [];
      for (let x = 0; x < W; x++) for (const y of [0, H - 1]) if (TILE_PROPS[t(x, y)].walkable) exitTiles.push([x, y]);
      for (let y = 0; y < H; y++) for (const x of [0, W - 1]) if (TILE_PROPS[t(x, y)].walkable) exitTiles.push([x, y]);
      for (const box of propBoxes(id)) {
        for (const [px, py] of box.tiles) {
          for (const [ex, ey] of exitTiles) {
            expect(Math.max(Math.abs(px - ex), Math.abs(py - ey)) > 2, `${id}: ${box.stamp} junto a la salida (${ex}, ${ey})`).toBe(true);
          }
        }
      }
    });

    it(`${id}: se cruza entera (todas las salidas en la misma zona caminable, con las piezas puestas)`, () => {
      const walkable = components((x, y) => TILE_PROPS[t(x, y)].walkable);
      const onEdge = (x: number, y: number): boolean => x === 0 || y === 0 || x === W - 1 || y === H - 1;
      const withExit = walkable.filter((c) => c.some(([x, y]) => onEdge(x, y)));
      expect(withExit.length, id).toBe(1);
    });
  }
});
