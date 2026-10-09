/**
 * Demo de la Fase 1: una isla flotante con niebla, luciérnagas, cristales,
 * vacío estelar con estrellas fugaces y un halo de luz que se mueve con las
 * flechas/WASD. Sirve para validar el motor de render antes de la jugabilidad.
 *
 * Coordenadas del mundo en unidades visuales: 1 unidad = alto de una fila;
 * una columna mide CELL_ASPECT (0,6) unidades. La pantalla mide 96 × 54.
 */
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from '../config';
import type { Input } from '../core/input';
import { Rng } from '../core/rng';
import type { CellBuffer } from '../render/cellBuffer';
import { blurField, signedDistanceField } from '../render/field';
import { glyphIndex, glyphRun } from '../render/glyphs';
import type { FrameParams } from '../render/renderer';
import { MAX_LIGHTS } from '../render/shaders';
import type { ZonePaletteGpu } from '../render/zonePalette';

/** Isla de prueba en tiles de 5×3 celdas (32×18 tiles = 160×54 celdas). */
const ISLAND_TILES = [
  '................................',
  '................................',
  '..........######................',
  '.......############.........##..',
  '.....################......####.',
  '....##################.....###..',
  '...####################.........',
  '...#####################........',
  '..######################........',
  '..#######################.......',
  '...######################.......',
  '...#####################........',
  '....###################.........',
  '......###############...........',
  '........##########..............',
  '................................',
  '................................',
  '................................',
];
const TILE_W = 5;
const TILE_H = 3;

const WORLD_W = GRID_COLS * CELL_ASPECT;
const WORLD_H = GRID_ROWS;

const FIREFLY_COUNT = 30;
const HALO_SPEED = 16; // unidades/s
const HALO_RESPONSE = 22; // 1/s: aceleración casi inmediata, sin sensación resbalosa

const CRYSTALS: Array<[number, number, number]> = [
  [17, 15.5, 1.15],
  [52, 34.5, 1.4],
  [31, 10.5, 0.9],
];

export class IslandDemo {
  readonly field: Float32Array;
  private readonly mask: Uint8Array;
  private readonly visualRng = new Rng(0x5eed);
  private time = 0;

  // Halo de la princesa (estado actual y anterior para interpolar)
  haloX = 41;
  haloY = 26;
  private prevHaloX = 41;
  private prevHaloY = 26;
  private haloVX = 0;
  private haloVY = 0;

  // Luciérnagas (structure of arrays, sin allocations por paso)
  private readonly fx = new Float32Array(FIREFLY_COUNT);
  private readonly fy = new Float32Array(FIREFLY_COUNT);
  private readonly pfx = new Float32Array(FIREFLY_COUNT);
  private readonly pfy = new Float32Array(FIREFLY_COUNT);
  private readonly heading = new Float32Array(FIREFLY_COUNT);
  private readonly speed = new Float32Array(FIREFLY_COUNT);
  private readonly phase = new Float32Array(FIREFLY_COUNT);
  private readonly freq = new Float32Array(FIREFLY_COUNT);
  activeFireflies = FIREFLY_COUNT;

  // Estrella fugaz
  private shootAge = 0;
  private shootLife = 0;
  private shootX = 0;
  private shootY = 0;
  private shootDX = 0;
  private shootDY = 0;
  private nextShoot = 3;

  private readonly caption = glyphRun('←↑→↓ / WASD  mover la luz      F3  rendimiento      F4  legibilidad');
  private readonly marker = glyphIndex('✶');
  freezeTime = false;

  constructor() {
    this.mask = new Uint8Array(GRID_COLS * GRID_ROWS);
    ISLAND_TILES.forEach((line, ty) => {
      for (let tx = 0; tx < line.length; tx++) {
        if (line[tx] !== '#') continue;
        for (let y = 0; y < TILE_H; y++) {
          for (let x = 0; x < TILE_W; x++) this.mask[(ty * TILE_H + y) * GRID_COLS + tx * TILE_W + x] = 1;
        }
      }
    });
    // SDF del tilemap, suavizado para redondear la escalera de tiles.
    this.field = blurField(signedDistanceField(this.mask, GRID_COLS, GRID_ROWS, CELL_ASPECT), GRID_COLS, GRID_ROWS, 6, 3, 2);
    const rng = this.visualRng;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      let x = 0;
      let y = 0;
      do {
        x = rng.range(4, WORLD_W - 4);
        y = rng.range(4, WORLD_H - 4);
      } while (this.sdfAt(x, y) > -2);
      this.fx[i] = this.pfx[i] = x;
      this.fy[i] = this.pfy[i] = y;
      this.heading[i] = rng.range(0, Math.PI * 2);
      this.speed[i] = rng.range(0.7, 1.7);
      this.phase[i] = rng.range(0, Math.PI * 2);
      this.freq[i] = rng.range(0.5, 1.4);
    }
  }

  /** SDF de la isla en un punto del mundo (vecino más cercano). */
  sdfAt(x: number, y: number): number {
    const c = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(x / CELL_ASPECT)));
    const r = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(y)));
    return this.field[r * GRID_COLS + c]!;
  }

  step(dt: number, input: Input): void {
    if (!this.freezeTime) this.time += dt;

    // Halo: dirección normalizada (diagonales a la misma velocidad).
    let ax = input.axisX();
    let ay = input.axisY();
    const len = Math.hypot(ax, ay);
    if (len > 1) {
      ax /= len;
      ay /= len;
    }
    const k = 1 - Math.exp(-HALO_RESPONSE * dt);
    this.haloVX += (ax * HALO_SPEED - this.haloVX) * k;
    this.haloVY += (ay * HALO_SPEED - this.haloVY) * k;
    this.prevHaloX = this.haloX;
    this.prevHaloY = this.haloY;
    this.haloX = Math.min(WORLD_W - 1, Math.max(1, this.haloX + this.haloVX * dt));
    this.haloY = Math.min(WORLD_H - 1, Math.max(1, this.haloY + this.haloVY * dt));

    if (this.freezeTime) return;
    this.stepFireflies(dt);
    this.stepShootingStar(dt);
  }

  private stepFireflies(dt: number): void {
    const rng = this.visualRng;
    for (let i = 0; i < this.activeFireflies; i++) {
      this.pfx[i] = this.fx[i]!;
      this.pfy[i] = this.fy[i]!;
      let h = this.heading[i]! + (rng.next() - 0.5) * 5.0 * dt;
      const x = this.fx[i]!;
      const y = this.fy[i]!;
      // Vuelven hacia el interior si se acercan al borde de la isla.
      if (this.sdfAt(x, y) > -1.5) {
        const toward = Math.atan2(26 - y, 40 - x);
        h += angleDelta(h, toward) * Math.min(1, 2.5 * dt);
      }
      // Curiosidad por el halo, sin pegarse a él.
      const dx = this.haloX - x;
      const dy = this.haloY - y;
      const d = Math.hypot(dx, dy);
      if (d < 12 && d > 3) h += angleDelta(h, Math.atan2(dy, dx)) * Math.min(1, 0.8 * dt);
      else if (d <= 3) h += angleDelta(h, Math.atan2(-dy, -dx)) * Math.min(1, 1.5 * dt);
      this.heading[i] = h;
      const s = this.speed[i]! * (0.75 + 0.25 * Math.sin(this.time * 0.7 + this.phase[i]!));
      this.fx[i] = x + Math.cos(h) * s * dt;
      this.fy[i] = y + Math.sin(h) * s * dt * 0.8;
    }
  }

  private stepShootingStar(dt: number): void {
    const rng = this.visualRng;
    if (this.shootLife > 0) {
      this.shootAge += dt;
      this.shootX += this.shootDX * 34 * dt;
      this.shootY += this.shootDY * 34 * dt;
      if (this.shootAge >= this.shootLife) this.shootLife = 0;
    } else if (this.time >= this.nextShoot) {
      this.shootAge = 0;
      this.shootLife = rng.range(0.8, 1.3);
      this.shootX = rng.range(WORLD_W * 0.55, WORLD_W * 0.98);
      this.shootY = rng.range(2, WORLD_H * 0.55);
      const a = rng.range(Math.PI * 0.62, Math.PI * 0.8); // hacia abajo-izquierda, rasante
      this.shootDX = Math.cos(a);
      this.shootDY = Math.sin(a) * 0.55;
      const n = Math.hypot(this.shootDX, this.shootDY);
      this.shootDX /= n;
      this.shootDY /= n;
      this.nextShoot = this.time + rng.range(5, 11);
    }
  }

  /** Rellena los parámetros del fotograma y la capa semántica (interpolando). */
  fill(f: FrameParams, cells: CellBuffer, pal: ZonePaletteGpu, alpha: number, reducedMotion: boolean): void {
    const t = this.time;
    const hx = this.prevHaloX + (this.haloX - this.prevHaloX) * alpha;
    const hy = this.prevHaloY + (this.haloY - this.prevHaloY) * alpha;
    f.time = t;
    f.camX = (hx - WORLD_W * 0.5) * 0.08;
    f.camY = (hy - WORLD_H * 0.5) * 0.08;
    f.ambient = pal.ambient;
    f.exposure = pal.exposure;
    f.fog = pal.fog;
    f.breath = reducedMotion ? 0.025 : 0.07;

    let n = 0;
    const halo = pal.lights.halo!;
    n = setLight(f, n, hx, hy, 15, 2.4, halo[0] * 1.9, halo[1] * 1.9, halo[2] * 1.9, 0.18);
    const crystal = pal.lights.crystal!;
    f.crystalCount = CRYSTALS.length;
    for (let i = 0; i < CRYSTALS.length; i++) {
      const c = CRYSTALS[i]!;
      const cx = c[0];
      const cy = c[1];
      const size = c[2];
      const pulse = 0.85 + 0.15 * Math.sin(t * 0.9 + i * 2.1);
      n = setLight(f, n, cx, cy - 0.3, 8 * size, 1.1 * size, crystal[0] * pulse, crystal[1] * pulse, crystal[2] * pulse, 0.35);
      f.crystals[i * 4] = cx;
      f.crystals[i * 4 + 1] = cy;
      f.crystals[i * 4 + 2] = size;
      f.crystals[i * 4 + 3] = i * 1.7;
    }
    const fly = pal.lights.firefly!;
    const count = reducedMotion ? Math.floor(this.activeFireflies / 2) : this.activeFireflies;
    for (let i = 0; i < count && n < MAX_LIGHTS; i++) {
      const x = this.pfx[i]! + (this.fx[i]! - this.pfx[i]!) * alpha;
      const y = this.pfy[i]! + (this.fy[i]! - this.pfy[i]!) * alpha;
      // parpadeo de luciérnaga: pulsos suaves con pausas
      const s = Math.sin(t * this.freq[i]! * 2.2 + this.phase[i]!);
      const pulse = Math.pow(Math.max(0, s), 3);
      const glow = 0.12 + 0.88 * pulse;
      n = setLight(f, n, x, y, 4.5, 0.36, fly[0] * glow, fly[1] * glow, fly[2] * glow, 1.7 * glow);
    }
    f.lightCount = n;

    if (this.shootLife > 0) {
      const life = this.shootAge / this.shootLife;
      f.shoot[0] = this.shootX;
      f.shoot[1] = this.shootY;
      f.shoot[2] = this.shootDX;
      f.shoot[3] = this.shootDY;
      f.shootIntensity = Math.sin(Math.PI * Math.min(1, life)) * 1.2;
      f.shootLength = 9;
    } else {
      f.shootIntensity = 0;
    }

    // Capa semántica: marcador de la luz y leyenda (se desvanece).
    cells.clear();
    const mc = Math.floor(hx / CELL_ASPECT);
    const mr = Math.floor(hy);
    const m = pal.ui.marker!;
    cells.put(mc, mr, this.marker, m[0], m[1], m[2], 0.9, true);
    const fade = 1 - smoothstep(12, 16, t);
    if (fade > 0.01) {
      const c = pal.ui.textDim!;
      const bg = pal.paper;
      cells.putRun(3, GRID_ROWS - 2, this.caption, c[0] * fade, c[1] * fade, c[2] * fade, bg[0], bg[1], bg[2], 0.8 * fade);
    }
  }

  /** Para la herramienta de capturas: colocar el halo y fijar el tiempo. */
  setHalo(x: number, y: number): void {
    this.haloX = this.prevHaloX = x;
    this.haloY = this.prevHaloY = y;
    this.haloVX = this.haloVY = 0;
  }

  setTime(t: number): void {
    this.time = t;
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

function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
