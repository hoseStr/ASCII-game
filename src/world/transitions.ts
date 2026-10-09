/**
 * Transiciones entre pantallas (máquina de estados pura; el render la lee).
 *  - slide: deslizamiento al estilo Zelda clásico; los glifos se desordenan
 *    recorriendo su rampa y se reordenan en la pantalla nueva.
 *  - melt: el mundo se derrite hacia abajo (entrada a la mazmorra).
 */
import type { Dir } from './room';

export type TransitionKind = 'slide' | 'melt';

export const TRANSITION_SECONDS: Record<TransitionKind, number> = {
  slide: 0.95,
  melt: 1.6,
};

export class Transition {
  kind: TransitionKind = 'slide';
  dir: Dir = 'east';
  active = false;
  private elapsed = 0;
  private duration = 1;

  start(kind: TransitionKind, dir: Dir, duration = TRANSITION_SECONDS[kind]): void {
    this.kind = kind;
    this.dir = dir;
    this.active = true;
    this.elapsed = 0;
    this.duration = duration;
  }

  /** Avanza; devuelve true en el paso en que termina. */
  update(dt: number): boolean {
    if (!this.active) return false;
    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      this.elapsed = this.duration;
      this.active = false;
      return true;
    }
    return false;
  }

  /** Progreso lineal 0..1. */
  get t(): number {
    return Math.min(1, this.elapsed / this.duration);
  }

  /** Progreso suavizado (ease in-out) que usa el render. */
  get eased(): number {
    const t = this.t;
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}
