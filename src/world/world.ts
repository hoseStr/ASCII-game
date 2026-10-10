/**
 * Mundo: carga de todas las salas (mapas .txt + metadatos .json) y grafo de
 * vecindad. Las salidas entre salas vecinas de la cuadrícula se deducen de los
 * tiles caminables del borde (deben coincidir a ambos lados: lo verifica un test).
 */
import worldJson from '../data/world.json';
import { TILE } from './tiles';
import { applyProps, assignRockFills, loadStampDefs, resolveProps, type PlacedProp, type RockFill, type StampDef } from './props';
import { DIR_VEC, DIRS, HUD_TILE_ROWS, SCREEN_TILES_W, buildRenderData, edgeWalkable, parseRoomMap, type Dir, type RoomMeta, type RoomRenderData, type Tilemap } from './room';

const mapFiles = import.meta.glob('../data/rooms/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const metaFiles = import.meta.glob('../data/rooms/*.json', { import: 'default', eager: true }) as Record<string, RoomMeta>;

export interface Room {
  readonly meta: RoomMeta;
  /** tilemap de colisión (incluye la huella sólida de las piezas) */
  readonly map: Tilemap;
  /** piezas de escenario, ordenadas de atrás hacia delante */
  readonly props: PlacedProp[];
  /** rocas renderizadas de los grupos de rocas */
  readonly rockFills: RockFill[];
  /** posición en la cuadrícula del overworld */
  readonly gx: number;
  readonly gy: number;
  readonly exits: Partial<Record<Dir, string>>;
  readonly seed: number;
}

export interface WorldData {
  start: { room: string; tile: [number, number] };
  overworld: string[][];
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export class World {
  readonly rooms = new Map<string, Room>();
  readonly data: WorldData;
  readonly stamps: Map<string, StampDef>;
  private readonly renderCache = new Map<string, RoomRenderData>();

  constructor(data: WorldData = worldJson as unknown as WorldData) {
    this.data = data;
    this.stamps = loadStampDefs();
    const metas = new Map<string, RoomMeta>();
    for (const meta of Object.values(metaFiles)) metas.set(meta.id, meta);
    const maps = new Map<string, string>();
    for (const [path, text] of Object.entries(mapFiles)) maps.set(path.split('/').pop()!, text);

    const grid = data.overworld;
    const parsed = new Map<string, { meta: RoomMeta; map: Tilemap; gx: number; gy: number; props: PlacedProp[] }>();
    grid.forEach((row, gy) =>
      row.forEach((id, gx) => {
        const meta = metas.get(id);
        if (!meta) throw new Error(`Sala '${id}' sin metadatos JSON`);
        const text = maps.get(meta.map);
        if (text === undefined) throw new Error(`Sala '${id}': no existe el mapa '${meta.map}'`);
        const base = parseRoomMap(text, id);
        const props = resolveProps(id, meta.props, this.stamps, base);
        parsed.set(id, { meta, map: applyProps(id, base, props), gx, gy, props });
      }),
    );
    for (const [id, r] of parsed) {
      const exits: Partial<Record<Dir, string>> = {};
      for (const dir of DIRS) {
        const [dx, dy] = DIR_VEC[dir];
        const nid = grid[r.gy + dy]?.[r.gx + dx];
        if (nid && edgeWalkable(r.map, dir)) exits[dir] = nid;
      }
      const seed = hashString(id);
      this.rooms.set(id, { ...r, exits, seed, rockFills: assignRockFills(r.map, this.stamps, seed, r.meta.zone) });
    }
  }

  get(id: string): Room {
    const r = this.rooms.get(id);
    if (!r) throw new Error(`Sala desconocida: ${id}`);
    return r;
  }

  /** Datos de render (SDF, tiles, cristales); se calculan una vez por sala. */
  renderData(room: Room): RoomRenderData {
    let d = this.renderCache.get(room.meta.id);
    if (!d) {
      d = buildRenderData(room.map, room.seed);
      // Las rocas se pintan con su roca renderizada (sin contorno, sombra ni recorte
      // por tile): solo se ve la imagen, con su propio contorno.
      for (const r of room.rockFills) {
        for (let ty = r.ty0; ty <= r.ty1; ty++) {
          for (let tx = r.tx0; tx <= r.tx1; tx++) d.tileTex[(ty + HUD_TILE_ROWS) * SCREEN_TILES_W + tx] = TILE.prop;
        }
      }
      this.renderCache.set(room.meta.id, d);
    }
    return d;
  }
}
