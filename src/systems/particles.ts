/**
 * Pool de partículas (structure of arrays, lista libre): cero allocations por
 * fotograma. Las partículas se pintan en la capa pictórica como puntos de luz y
 * pasan por el conversor ASCII (una mota brillante se convierte en ✧).
 * Coordenadas: unidades de la sala (el render suma la banda del HUD).
 */
import { MATERIAL_ID, type Material } from '../render/glyphs';
import { PARTICLE_STRIDE } from '../render/shaders';

export class Particles {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly intensity: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly mat: Float32Array;
  readonly drag: Float32Array;
  readonly gravity: Float32Array;
  private readonly alive: Uint8Array;
  private readonly free: Int32Array;
  private freeTop: number;
  active = 0;

  constructor(readonly capacity: number) {
    const f = (): Float32Array => new Float32Array(capacity);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.life = f();
    this.maxLife = f();
    this.size = f();
    this.intensity = f();
    this.r = f();
    this.g = f();
    this.b = f();
    this.mat = f();
    this.drag = f();
    this.gravity = f();
    this.alive = new Uint8Array(capacity);
    this.free = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;
    this.freeTop = capacity;
  }

  /** Crea una partícula; devuelve su índice o -1 si el pool está lleno. */
  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    intensity: number,
    r: number,
    g: number,
    b: number,
    material: Material = 'light',
    drag = 0,
    gravity = 0,
  ): number {
    if (this.freeTop === 0) return -1;
    const i = this.free[--this.freeTop]!;
    this.alive[i] = 1;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.intensity[i] = intensity;
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
    this.mat[i] = MATERIAL_ID[material];
    this.drag[i] = drag;
    this.gravity[i] = gravity;
    this.active++;
    return i;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        this.kill(i);
        continue;
      }
      const damp = Math.exp(-this.drag[i]! * dt);
      this.vx[i]! *= damp;
      this.vy[i] = this.vy[i]! * damp + this.gravity[i]! * dt;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
    }
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.free[this.freeTop++] = i;
    this.active--;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) if (this.alive[i]) this.kill(i);
  }

  /**
   * Escribe las partículas vivas en el buffer de vértices (desplazadas por
   * offY a coordenadas de pantalla). Brillo con fundido de entrada y salida.
   */
  write(out: Float32Array, offY: number, maxCount: number): number {
    let n = 0;
    for (let i = 0; i < this.capacity && n < maxCount; i++) {
      if (!this.alive[i]) continue;
      const t = this.life[i]! / this.maxLife[i]!;
      const fade = Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8);
      const o = n * PARTICLE_STRIDE;
      out[o] = this.x[i]!;
      out[o + 1] = this.y[i]! + offY;
      out[o + 2] = this.size[i]!;
      out[o + 3] = this.intensity[i]! * fade;
      out[o + 4] = this.r[i]!;
      out[o + 5] = this.g[i]!;
      out[o + 6] = this.b[i]!;
      out[o + 7] = this.mat[i]!;
      n++;
    }
    return n;
  }
}
