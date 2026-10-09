/**
 * Luciérnagas: luces decorativas que deambulan sobre la isla, sienten
 * curiosidad por el halo de la princesa y laten con pulsos suaves.
 * Usan su propio Rng (visual) para no alterar la simulación de juego.
 */
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from '../config';
import { Rng } from '../core/rng';

const MAX_FIREFLIES = 40;

export class Fireflies {
  readonly x = new Float32Array(MAX_FIREFLIES);
  readonly y = new Float32Array(MAX_FIREFLIES);
  readonly px = new Float32Array(MAX_FIREFLIES);
  readonly py = new Float32Array(MAX_FIREFLIES);
  private readonly heading = new Float32Array(MAX_FIREFLIES);
  private readonly speed = new Float32Array(MAX_FIREFLIES);
  readonly phase = new Float32Array(MAX_FIREFLIES);
  readonly freq = new Float32Array(MAX_FIREFLIES);
  count = 0;
  private field: Float32Array | null = null;
  private homeX = 48;
  private homeY = 30;
  private rng = new Rng(1);

  /** Reparte `count` luciérnagas sobre la isla (SDF en celdas de pantalla). */
  reset(field: Float32Array, count: number, seed: number): void {
    this.field = field;
    this.rng = new Rng(seed);
    const rng = this.rng;
    this.count = Math.min(MAX_FIREFLIES, count);
    // centro de masa de la isla: hacia allí vuelven si se alejan
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (field[r * GRID_COLS + c]! < -2) {
          sx += (c + 0.5) * CELL_ASPECT;
          sy += r + 0.5;
          n++;
        }
      }
    }
    this.homeX = n ? sx / n : 48;
    this.homeY = n ? sy / n : 30;
    for (let i = 0; i < this.count; i++) {
      let x = this.homeX;
      let y = this.homeY;
      for (let tries = 0; tries < 60; tries++) {
        x = rng.range(3, GRID_COLS * CELL_ASPECT - 3);
        y = rng.range(8, GRID_ROWS - 3);
        if (this.sdfAt(x, y) < -1.5) break;
      }
      this.x[i] = this.px[i] = x;
      this.y[i] = this.py[i] = y;
      this.heading[i] = rng.range(0, Math.PI * 2);
      this.speed[i] = rng.range(0.7, 1.7);
      this.phase[i] = rng.range(0, Math.PI * 2);
      this.freq[i] = rng.range(0.5, 1.4);
    }
  }

  sdfAt(x: number, y: number): number {
    if (!this.field) return 99;
    const c = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(x / CELL_ASPECT)));
    const r = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(y)));
    return this.field[r * GRID_COLS + c]!;
  }

  /** Avanza; (hx, hy) es el halo de la princesa en unidades de pantalla. */
  step(dt: number, time: number, hx: number, hy: number): void {
    const rng = this.rng;
    for (let i = 0; i < this.count; i++) {
      this.px[i] = this.x[i]!;
      this.py[i] = this.y[i]!;
      let h = this.heading[i]! + (rng.next() - 0.5) * 5.0 * dt;
      const x = this.x[i]!;
      const y = this.y[i]!;
      if (this.sdfAt(x, y) > -1.5) h += angleDelta(h, Math.atan2(this.homeY - y, this.homeX - x)) * Math.min(1, 2.5 * dt);
      const dx = hx - x;
      const dy = hy - y;
      const d = Math.hypot(dx, dy);
      if (d < 12 && d > 3.5) h += angleDelta(h, Math.atan2(dy, dx)) * Math.min(1, 0.8 * dt);
      else if (d <= 3.5) h += angleDelta(h, Math.atan2(-dy, -dx)) * Math.min(1, 1.5 * dt);
      this.heading[i] = h;
      const s = this.speed[i]! * (0.75 + 0.25 * Math.sin(time * 0.7 + this.phase[i]!));
      this.x[i] = x + Math.cos(h) * s * dt;
      this.y[i] = y + Math.sin(h) * s * dt * 0.8;
    }
  }

  /** Brillo del pulso (0..1) de la luciérnaga i en el instante t. */
  glow(i: number, t: number): number {
    const s = Math.sin(t * this.freq[i]! * 2.2 + this.phase[i]!);
    return 0.12 + 0.88 * Math.pow(Math.max(0, s), 3);
  }
}

function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
