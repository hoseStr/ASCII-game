/**
 * Orquestador del juego (Fase 2: mundo). Mantiene la sala actual, la
 * princesa, los sistemas decorativos y las transiciones entre pantallas, y
 * rellena cada fotograma los parámetros del render y la capa semántica.
 */
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from './config';
import type { Input } from './core/input';
import { Rng } from './core/rng';
import { Princess, type Facing } from './entities/princess';
import type { CellBuffer } from './render/cellBuffer';
import { glyphIndex } from './render/glyphs';
import type { FrameParams, RenderSettings, Renderer } from './render/renderer';
import { MAX_LIGHTS, MAX_PARTICLES } from './render/shaders';
import { loadZonePalette, type ZonePaletteGpu } from './render/zonePalette';
import { Fireflies } from './systems/fireflies';
import { Particles } from './systems/particles';
import { Sky } from './systems/sky';
import { Hud } from './ui/hud';
import { CLOSED_EDGES, type EdgePolicy } from './world/collision';
import { DIR_VEC, tileAt, type Dir, type RoomRenderData } from './world/room';
import { PropLayer } from './render/propLayer';
import type { StampAsset } from './render/stamps';
import { Structures } from './world/structures';
import { HUD_ROWS, ROOM_H, ROOM_W, TILE, TILE_COLS, TILE_PROPS, TILE_ROWS, TILE_UNITS } from './world/tiles';
import { Transition, type TransitionKind } from './world/transitions';
import type { Room, World } from './world/world';

const FACING_OF: Record<Dir, Facing> = { north: 'up', south: 'down', east: 'right', west: 'left' };

export class Game {
  room!: Room;
  private renderData!: RoomRenderData;
  palette!: ZonePaletteGpu;
  readonly princess = new Princess();
  readonly particles = new Particles(MAX_PARTICLES);
  private readonly fireflies = new Fireflies();
  private readonly sky = new Sky();
  private readonly structures = new Structures();
  private readonly hud = new Hud();
  readonly transition = new Transition();
  readonly visited = new Set<string>();
  private readonly edges: EdgePolicy = { ...CLOSED_EDGES };
  /** RNG de jugabilidad (con semilla): determinista. */
  readonly rng = new Rng(20261009);
  /** RNG visual (partículas, chispas): no afecta a la simulación. */
  private readonly fxRng = new Rng(77);
  time = 0;
  /** el render debe capturar la sala vieja antes del próximo fotograma */
  snapshotRequested = false;
  freezeTime = false;
  private readonly wall = glyphIndex('▒');
  private readonly waterGlyph = glyphIndex('≈');

  readonly propLayer = new PropLayer();

  constructor(
    readonly world: World,
    private renderer: Renderer,
    private readonly stampImages: Map<string, StampAsset>,
  ) {
    const start = world.data.start;
    this.enterRoom(start.room);
    this.princess.place((start.tile[0] + 0.5) * TILE_UNITS, (start.tile[1] + 0.5) * TILE_UNITS, 'down');
  }

  /** Activa una sala: datos de render, paleta, estructuras y criaturas. */
  enterRoom(id: string): void {
    const room = this.world.get(id);
    this.room = room;
    this.renderData = this.world.renderData(room);
    this.palette = loadZonePalette(room.meta.zone);
    this.propLayer.build(room.props, room.rockFills, this.stampImages);
    this.renderer.setRoom(this.renderData, this.palette, this.propLayer);
    this.structures.build(room.map);
    this.fireflies.reset(this.renderData.field, room.meta.fireflies ?? 0, room.seed);
    this.edges.north = room.exits.north !== undefined;
    this.edges.south = room.exits.south !== undefined;
    this.edges.east = room.exits.east !== undefined;
    this.edges.west = room.exits.west !== undefined;
    this.hud.setRoom(room.meta.name, this.palette.name);
    this.visited.add(id);
  }

  /** Tras perder y recuperar el contexto WebGL: nuevo renderer, misma sala. */
  attachRenderer(renderer: Renderer): void {
    this.renderer = renderer;
    renderer.setRoom(this.renderData, this.palette, this.propLayer);
  }

  /** Inicia una transición hacia la sala vecina en `dir`. */
  private beginTransition(dir: Dir, kind: TransitionKind = 'slide'): void {
    const next = this.room.exits[dir];
    if (!next) return;
    this.snapshotRequested = true;
    const p = this.princess;
    const [dx, dy] = DIR_VEC[dir];
    // La princesa reaparece justo dentro del borde opuesto de la sala nueva.
    let x = p.x - dx * ROOM_W;
    let y = p.y - dy * ROOM_H;
    if (dx > 0) x = p.body.hw + 0.3;
    if (dx < 0) x = ROOM_W - p.body.hw - 0.3;
    if (dy > 0) y = p.body.hh + 0.3;
    if (dy < 0) y = ROOM_H - p.body.hh - 0.3;
    this.enterRoom(next);
    p.place(x, y, FACING_OF[dir]);
    this.particles.clear();
    this.transition.start(kind, dir);
  }

  /** Derretido de prueba (la entrada a la mazmorra lo usará en la Fase 4). */
  debugMelt(): void {
    if (this.transition.active) return;
    this.snapshotRequested = true;
    this.particles.clear();
    this.transition.start('melt', 'south');
  }

  step(dt: number, input: Input): void {
    if (!this.freezeTime) this.time += dt;
    this.hud.step(dt);
    const p = this.princess;
    const hx = p.x;
    const hy = p.y + HUD_ROWS;
    if (!this.freezeTime) {
      this.fireflies.step(dt, this.time, hx, hy);
      this.sky.step(dt, this.time);
      this.particles.update(dt);
    }
    if (this.transition.active) {
      this.transition.update(dt);
      if (!this.transition.active) this.renderer.resetTemporal();
      return; // la jugabilidad espera mientras la cámara se desliza
    }
    p.update(dt, input, this.room.map, this.edges, this.particles, this.fxRng);
    // ¿Cruzó un borde con salida?
    if (p.x < 0 && this.room.exits.west) this.beginTransition('west');
    else if (p.x > ROOM_W && this.room.exits.east) this.beginTransition('east');
    else if (p.y < 0 && this.room.exits.north) this.beginTransition('north');
    else if (p.y > ROOM_H && this.room.exits.south) this.beginTransition('south');
  }

  /** Rellena el fotograma (parámetros de render + capa semántica). */
  fill(f: FrameParams, cells: CellBuffer, alpha: number, settings: RenderSettings): void {
    const pal = this.palette;
    const p = this.princess;
    const px = p.lerpX(alpha);
    const py = p.lerpY(alpha) + HUD_ROWS;
    const t = this.time;
    const reduced = settings.reducedEffects;
    f.time = t;
    f.camX = (px - GRID_COLS * CELL_ASPECT * 0.5) * 0.08;
    f.camY = (py - GRID_ROWS * 0.5) * 0.08;
    f.ambient = pal.ambient;
    f.exposure = pal.exposure;
    f.fog = pal.fog;
    f.breath = reduced ? 0.025 : 0.07;

    // Luces: halo de la princesa, cristales, luciérnagas.
    let n = 0;
    const halo = pal.lights.halo!;
    n = setLight(f, n, px, py - 1.2, 13, 2.2, halo[0] * 1.35, halo[1] * 1.35, halo[2] * 1.35, 0.08);
    const crystals = this.renderData.crystals;
    const cl = pal.lights.crystal!;
    f.crystalCount = Math.min(crystals.length, f.crystals.length / 4);
    for (let i = 0; i < f.crystalCount; i++) {
      const c = crystals[i]!;
      const pulse = 0.85 + 0.15 * Math.sin(t * 0.9 + i * 2.1);
      n = setLight(f, n, c.x, c.y - 0.3, 8 * c.size, 1.1 * c.size, cl[0] * pulse, cl[1] * pulse, cl[2] * pulse, 0.35);
      f.crystals[i * 4] = c.x;
      f.crystals[i * 4 + 1] = c.y;
      f.crystals[i * 4 + 2] = c.size;
      f.crystals[i * 4 + 3] = i * 1.7;
    }
    const fly = pal.lights.firefly!;
    const ff = this.fireflies;
    const count = reduced ? Math.floor(ff.count / 2) : ff.count;
    for (let i = 0; i < count && n < MAX_LIGHTS; i++) {
      const x = ff.px[i]! + (ff.x[i]! - ff.px[i]!) * alpha;
      const y = ff.py[i]! + (ff.y[i]! - ff.py[i]!) * alpha;
      const g = ff.glow(i, t);
      n = setLight(f, n, x, y, 4.5, 0.36, fly[0] * g, fly[1] * g, fly[2] * g, 1.7 * g);
    }
    f.lightCount = n;
    this.sky.fill(f);

    // Reflejo en el agua si hay agua justo al sur de la princesa.
    const tx = Math.floor(p.x / TILE_UNITS);
    const ty = Math.floor(p.y / TILE_UNITS);
    const nearWater =
      tileAt(this.room.map, tx, ty + 1) === TILE.water ||
      tileAt(this.room.map, tx, ty + 2) === TILE.water ||
      tileAt(this.room.map, tx - 1, ty + 1) === TILE.water ||
      tileAt(this.room.map, tx + 1, ty + 1) === TILE.water;
    f.reflector[0] = px;
    f.reflector[1] = py;
    f.reflector[2] = nearWater ? 1 : 0;
    f.reflectorColor.set(p.reflectColor);
    // sombra suave bajo los pies de la princesa (la asienta en el suelo)
    f.actorShadow[0] = px + 0.25;
    f.actorShadow[1] = py + 0.45;
    f.actorShadow[2] = 1.5;
    f.actorShadow[3] = 0.55;
    f.actorShadowK = 0.6;

    f.particleCount = this.particles.write(f.particles, HUD_ROWS, MAX_PARTICLES);

    // Piezas animadas (viento): cambiar de fotograma y subir solo la región que cambió.
    if (this.propLayer.animate(this.time, !settings.reducedEffects)) {
      const L = this.propLayer;
      const r = L.dirtyRects;
      for (let k = 0; k < L.dirtyCount; k++) {
        const x0 = r[k * 4]!;
        const y0 = r[k * 4 + 1]!;
        this.renderer.updatePropCells(L, x0, y0, r[k * 4 + 2]! - x0 + 1, r[k * 4 + 3]! - y0 + 1);
      }
    }

    // Transición
    const tr = this.transition;
    if (tr.active) {
      f.transMode = tr.kind === 'slide' ? 1 : 2;
      f.transT = tr.eased;
      const [dx, dy] = DIR_VEC[tr.dir];
      f.transDirX = dx;
      f.transDirY = dy;
      f.dream = Math.sin(Math.PI * tr.t) * 0.35;
    } else {
      f.transMode = 0;
      f.dream = 0;
    }

    // Capa semántica: estructuras → (F4: colisión) → princesa → HUD.
    cells.clear();
    this.structures.draw(cells, f, pal.ambient);
    if (settings.legibility) this.drawCollision(cells);
    p.draw(cells, alpha);
    this.hud.draw(cells, pal, this.world.data.overworld, this.room.meta.id, this.visited);
  }

  /** Modo legibilidad: el tilemap de colisión como glifos semánticos. */
  private drawCollision(cells: CellBuffer): void {
    const map = this.room.map;
    const dim = this.palette.ui.textDim!;
    const paper = this.palette.paper;
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const t = tileAt(map, tx, ty);
        if (t === TILE.void || t === TILE.bridgeH || t === TILE.bridgeV) continue;
        const walk = TILE_PROPS[t].walkable;
        const g = walk ? 0 : t === TILE.water ? this.waterGlyph : this.wall;
        for (let y = 0; y < TILE_ROWS; y++) {
          for (let x = 0; x < TILE_COLS; x++) {
            const col = tx * TILE_COLS + x;
            const row = HUD_ROWS + ty * TILE_ROWS + y;
            // suelo caminable: fondo apenas más claro; obstáculos: glifo tenue
            if (walk) cells.put(col, row, 0, 0, 0, 0, 0, false, paper[0] * 1.9, paper[1] * 1.9, paper[2] * 1.9, 1);
            else cells.put(col, row, g, dim[0], dim[1], dim[2]);
          }
        }
      }
    }
  }

  /** Depuración/capturas: teletransportar a una sala (al tile caminable más cercano). */
  debugGoto(id: string, tileX = 16, tileY = 8): void {
    this.enterRoom(id);
    const map = this.room.map;
    let bx = tileX;
    let by = tileY;
    let bestD = Infinity;
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (!TILE_PROPS[tileAt(map, tx, ty)].walkable) continue;
        const d = (tx - tileX) ** 2 + (ty - tileY) ** 2;
        if (d < bestD) {
          bestD = d;
          bx = tx;
          by = ty;
        }
      }
    }
    this.princess.place((bx + 0.5) * TILE_UNITS, (by + 0.5) * TILE_UNITS, 'down');
    this.particles.clear();
    this.renderer.resetTemporal();
  }

  /** Depuración/capturas: colocar a la princesa en unidades de la sala. */
  debugPlace(x: number, y: number, facing: Facing = 'down'): void {
    this.princess.place(x, y, facing);
  }
}

function setLight(
  f: FrameParams,
  n: number,
  x: number,
  y: number,
  radius: number,
  coreSigma: number,
  r: number,
  g: number,
  b: number,
  coreIntensity: number,
): number {
  if (n >= MAX_LIGHTS) return n;
  const o = n * 4;
  f.lightPos[o] = x;
  f.lightPos[o + 1] = y;
  f.lightPos[o + 2] = radius;
  f.lightPos[o + 3] = coreSigma;
  f.lightCol[o] = r;
  f.lightCol[o + 1] = g;
  f.lightCol[o + 2] = b;
  f.lightCol[o + 3] = coreIntensity;
  return n + 1;
}
