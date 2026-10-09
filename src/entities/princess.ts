/**
 * La princesa: movimiento en 4 direcciones (responsivo, sin inercia
 * resbalosa), colisión AABB contra el tilemap, animación de caminar ligada a
 * la distancia recorrida, cabello que respira en reposo y estela de polvo de
 * estrellas al moverse.
 */
import { CELL_ASPECT } from '../config';
import type { Input } from '../core/input';
import type { Rng } from '../core/rng';
import type { CellBuffer } from '../render/cellBuffer';
import { oklchToSrgb } from '../render/palette';
import { buildSpriteSheet, drawSprite, type SpriteDef, type SpriteFrame, type SpriteSheet } from '../render/sprites';
import princessDef from '../data/sprites/princess.json';
import princessText from '../data/sprites/princess.txt?raw';
import type { Particles } from '../systems/particles';
import { moveBody, type Body, type EdgePolicy } from '../world/collision';
import type { Tilemap } from '../world/room';
import { HUD_ROWS } from '../world/tiles';

export type Facing = 'down' | 'up' | 'left' | 'right';

const SPEED = 18; // unidades/s (≈ 6 tiles/s)
const RESPONSE = 30; // 1/s: alcanza la velocidad en ~0,1 s y frena igual de rápido
const STRIDE = 1.15; // unidades recorridas por fotograma de la animación de caminar
const TRAIL_EVERY = 0.045; // s entre motas de la estela

const DIR_FACING: Facing[] = ['down', 'up', 'down', 'left', 'right'];
const DIR_VX = [0, 0, 0, -1, 1];
const DIR_VY = [0, -1, 1, 0, 0];

// Colores de la estela (sRGB): oro tenue y lavanda.
const TRAIL_A = oklchToSrgb([0.92, 0.1, 85]);
const TRAIL_B = oklchToSrgb([0.88, 0.07, 300]);

export class Princess {
  readonly body: Body = { x: 0, y: 0, hw: 0.85, hh: 0.55 };
  prevX = 0;
  prevY = 0;
  vx = 0;
  vy = 0;
  facing: Facing = 'down';
  moving = false;
  private walkDist = 0;
  private idleTime = 0;
  private trailTimer = 0;
  readonly sheet: SpriteSheet;
  private readonly walk: Record<Facing, SpriteFrame[]>;
  private readonly idle: Record<Facing, SpriteFrame[]>;
  /** color del vestido en RGB lineal aproximado (reflejo en el agua) */
  readonly reflectColor: [number, number, number];

  constructor() {
    this.sheet = buildSpriteSheet(princessText, princessDef as unknown as SpriteDef);
    const get = (key: string): SpriteFrame[] => {
      const frames = this.sheet.anims.get(key);
      if (!frames || frames.length === 0) throw new Error(`Sprite de la princesa sin animación '${key}'`);
      return frames;
    };
    const facings: Facing[] = ['down', 'up', 'left', 'right'];
    this.walk = Object.fromEntries(facings.map((f) => [f, get(`${f}.walk`)])) as Record<Facing, SpriteFrame[]>;
    this.idle = Object.fromEntries(facings.map((f) => [f, get(`${f}.idle`)])) as Record<Facing, SpriteFrame[]>;
    const d = oklchToSrgb([0.9, 0.06, 340]);
    this.reflectColor = [d[0] ** 2.2, d[1] ** 2.2, d[2] ** 2.2];
  }

  get x(): number {
    return this.body.x;
  }

  get y(): number {
    return this.body.y;
  }

  place(x: number, y: number, facing?: Facing): void {
    this.body.x = this.prevX = x;
    this.body.y = this.prevY = y;
    this.vx = this.vy = 0;
    if (facing) this.facing = facing;
  }

  update(dt: number, input: Input, map: Tilemap, edges: EdgePolicy, particles: Particles, rng: Rng): void {
    this.prevX = this.body.x;
    this.prevY = this.body.y;
    const dir = input.moveDir();
    const tx = DIR_VX[dir]! * SPEED;
    const ty = DIR_VY[dir]! * SPEED;
    // Respuesta casi inmediata; al cambiar de eje, la velocidad perpendicular se corta.
    const k = 1 - Math.exp(-RESPONSE * dt);
    this.vx = tx === 0 && ty !== 0 ? 0 : this.vx + (tx - this.vx) * k;
    this.vy = ty === 0 && tx !== 0 ? 0 : this.vy + (ty - this.vy) * k;
    if (dir === 0) {
      if (Math.abs(this.vx) < 0.05) this.vx = 0;
      if (Math.abs(this.vy) < 0.05) this.vy = 0;
    }
    if (dir !== 0) this.facing = DIR_FACING[dir]!;
    moveBody(map, this.body, this.vx * dt, this.vy * dt, edges);
    const moved = Math.hypot(this.body.x - this.prevX, this.body.y - this.prevY);
    this.moving = dir !== 0 && moved > 1e-3;
    if (this.moving) {
      this.walkDist += moved;
      this.idleTime = 0;
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer += TRAIL_EVERY;
        this.emitTrail(particles, rng);
      }
    } else {
      this.idleTime += dt;
      this.walkDist = 0;
    }
  }

  /** Mota de polvo de estrellas a los pies, que sube y se apaga. */
  private emitTrail(particles: Particles, rng: Rng): void {
    const c = rng.chance(0.5) ? TRAIL_A : TRAIL_B;
    particles.spawn(
      this.body.x + rng.range(-0.7, 0.7) - this.vx * 0.02,
      this.body.y + rng.range(-0.2, 0.5),
      rng.range(-0.5, 0.5) - this.vx * 0.04,
      rng.range(-1.6, -0.6) - this.vy * 0.04,
      rng.range(0.7, 1.3),
      rng.range(0.45, 0.75),
      rng.range(0.9, 1.5),
      c[0],
      c[1],
      c[2],
      'light',
      1.2,
      0,
    );
  }

  currentFrame(): SpriteFrame {
    if (this.moving) {
      const frames = this.walk[this.facing];
      return frames[Math.floor(this.walkDist / STRIDE) % frames.length]!;
    }
    const frames = this.idle[this.facing];
    return frames[Math.floor(this.idleTime / 0.7) % frames.length]!;
  }

  /** Posición interpolada (unidades de sala). */
  lerpX(alpha: number): number {
    return this.prevX + (this.body.x - this.prevX) * alpha;
  }

  lerpY(alpha: number): number {
    return this.prevY + (this.body.y - this.prevY) * alpha;
  }

  /**
   * Dibuja con la celda ancla (pies) en la celda que contiene la posición
   * interpolada: los glifos se ajustan a la grilla; halo y estela son continuos.
   */
  draw(cells: CellBuffer, alpha: number, bright = 1, flash = 0): void {
    const col = Math.floor(this.lerpX(alpha) / CELL_ASPECT);
    const row = Math.floor(this.lerpY(alpha) + 0.45) + HUD_ROWS;
    drawSprite(cells, this.sheet, this.currentFrame(), col, row, bright, flash, true);
  }
}

