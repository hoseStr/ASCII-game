/** Cielo: estrellas fugaces ocasionales sobre el vacío (efecto visual). */
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from '../config';
import { Rng } from '../core/rng';
import type { FrameParams } from '../render/renderer';

const WORLD_W = GRID_COLS * CELL_ASPECT;

export class Sky {
  private readonly rng = new Rng(0x5eed);
  private age = 0;
  private life = 0;
  private x = 0;
  private y = 0;
  private dx = 0;
  private dy = 0;
  private next = 3;

  step(dt: number, time: number): void {
    const rng = this.rng;
    if (this.life > 0) {
      this.age += dt;
      this.x += this.dx * 34 * dt;
      this.y += this.dy * 34 * dt;
      if (this.age >= this.life) this.life = 0;
    } else if (time >= this.next) {
      this.age = 0;
      this.life = rng.range(0.8, 1.3);
      this.x = rng.range(WORLD_W * 0.3, WORLD_W * 0.98);
      this.y = rng.range(7, GRID_ROWS * 0.6);
      const a = rng.range(Math.PI * 0.62, Math.PI * 0.8);
      this.dx = Math.cos(a);
      this.dy = Math.sin(a) * 0.55;
      const n = Math.hypot(this.dx, this.dy);
      this.dx /= n;
      this.dy /= n;
      this.next = time + rng.range(5, 11);
    }
  }

  fill(f: FrameParams): void {
    if (this.life > 0) {
      const t = this.age / this.life;
      f.shoot[0] = this.x;
      f.shoot[1] = this.y;
      f.shoot[2] = this.dx;
      f.shoot[3] = this.dy;
      f.shootIntensity = Math.sin(Math.PI * Math.min(1, t)) * 1.2;
      f.shootLength = 9;
    } else {
      f.shootIntensity = 0;
    }
  }
}
