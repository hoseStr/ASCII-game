import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { DIR_VEC, DIRS, OPPOSITE, parseRoomMap, tileAt } from '../src/world/room';
import { ROOM_TILES_H, ROOM_TILES_W, TILE, TILE_PROPS } from '../src/world/tiles';

const world = new World();
const walk = (id: string, x: number, y: number): boolean => TILE_PROPS[tileAt(world.get(id).map, x, y)].walkable;

describe('carga de salas', () => {
  it('carga las 9 salas del overworld con su paleta y su mapa', () => {
    expect(world.rooms.size).toBe(9);
    for (const room of world.rooms.values()) {
      expect(room.map.w).toBe(ROOM_TILES_W);
      expect(room.map.h).toBe(ROOM_TILES_H);
      expect(room.meta.name.length).toBeGreaterThan(0);
    }
  });

  it('rechaza mapas mal formados con un mensaje útil', () => {
    expect(() => parseRoomMap('...', 'x')).toThrow(/filas/);
    const bad = Array.from({ length: 16 }, () => '.'.repeat(32));
    bad[3] = '.'.repeat(31) + 'Q';
    expect(() => parseRoomMap(bad.join('\n'), 'x')).toThrow(/'Q' desconocido en \(31, 3\)/);
    bad[3] = '.'.repeat(30);
    expect(() => parseRoomMap(bad.join('\n'), 'x')).toThrow(/30 caracteres/);
  });

  it('la sala inicial y el tile de inicio son caminables', () => {
    const { room, tile } = world.data.start;
    expect(walk(room, tile[0], tile[1])).toBe(true);
  });
});

describe('salidas entre salas', () => {
  it('son simétricas: si A sale al este hacia B, B sale al oeste hacia A', () => {
    for (const [id, room] of world.rooms) {
      for (const dir of DIRS) {
        const next = room.exits[dir];
        if (next) expect(world.get(next).exits[OPPOSITE[dir]], `${id} ${dir}`).toBe(id);
      }
    }
  });

  it('los tiles caminables del borde coinciden a ambos lados (nunca se aparece dentro de un muro)', () => {
    for (const [id, room] of world.rooms) {
      for (const dir of DIRS) {
        const next = room.exits[dir];
        if (!next) continue;
        const horizontal = dir === 'east' || dir === 'west';
        const n = horizontal ? ROOM_TILES_H : ROOM_TILES_W;
        for (let i = 0; i < n; i++) {
          let a: [number, number];
          let b: [number, number];
          if (dir === 'east') [a, b] = [[ROOM_TILES_W - 1, i], [0, i]];
          else if (dir === 'west') [a, b] = [[0, i], [ROOM_TILES_W - 1, i]];
          else if (dir === 'south') [a, b] = [[i, ROOM_TILES_H - 1], [i, 0]];
          else [a, b] = [[i, 0], [i, ROOM_TILES_H - 1]];
          expect(walk(id, a[0], a[1]), `${id} -> ${next} (${dir}, ${i})`).toBe(walk(next, b[0], b[1]));
        }
      }
    }
  });

  it('el borde exterior del mundo no tiene salidas', () => {
    const grid = world.data.overworld;
    for (const [id, room] of world.rooms) {
      for (const dir of DIRS) {
        const [dx, dy] = DIR_VEC[dir];
        if (grid[room.gy + dy]?.[room.gx + dx]) continue;
        expect(room.exits[dir], `${id} ${dir}`).toBeUndefined();
      }
    }
  });
});

describe('alcanzabilidad (sin bloqueos)', () => {
  it('todas las salas se alcanzan caminando desde el inicio', () => {
    const W = ROOM_TILES_W;
    const H = ROOM_TILES_H;
    const key = (id: string, x: number, y: number): string => `${id}:${x}:${y}`;
    const start = world.data.start;
    const seen = new Set<string>([key(start.room, start.tile[0], start.tile[1])]);
    const queue: Array<[string, number, number]> = [[start.room, start.tile[0], start.tile[1]]];
    const rooms = new Set<string>();
    while (queue.length > 0) {
      const [id, x, y] = queue.shift()!;
      rooms.add(id);
      for (const dir of DIRS) {
        const [dx, dy] = DIR_VEC[dir];
        let nid = id;
        let nx = x + dx;
        let ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
          const next = world.get(id).exits[dir];
          if (!next) continue;
          nid = next;
          nx = (nx + W) % W;
          ny = (ny + H) % H;
        }
        const k = key(nid, nx, ny);
        if (!seen.has(k) && walk(nid, nx, ny)) {
          seen.add(k);
          queue.push([nid, nx, ny]);
        }
      }
    }
    expect([...rooms].sort()).toEqual([...world.rooms.keys()].sort());
  });

  it('ninguna sala está vacía: todas tienen árboles, rocas, agua, cristales o flores', () => {
    for (const [id, room] of world.rooms) {
      const features = new Set<number>(Array.from(room.map.tiles));
      const decorated = [TILE.tree, TILE.rock, TILE.water, TILE.crystal, TILE.flowers].some((t) => features.has(t));
      expect(decorated, id).toBe(true);
    }
  });
});
