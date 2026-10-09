/**
 * Bucle principal: simulación a paso fijo (60 Hz, determinista) y render
 * desacoplado con interpolación (alpha = fracción del siguiente paso).
 */

export class FixedStepClock {
  private accumulator = 0;

  constructor(
    readonly stepSeconds: number,
    /** tope de pasos por fotograma: evita la "espiral de la muerte" tras un parón */
    readonly maxSteps = 5,
  ) {}

  /** Añade tiempo real transcurrido y devuelve cuántos pasos simular. */
  advance(elapsedSeconds: number): number {
    this.accumulator += Math.min(Math.max(elapsedSeconds, 0), this.stepSeconds * this.maxSteps);
    let steps = 0;
    while (this.accumulator >= this.stepSeconds && steps < this.maxSteps) {
      this.accumulator -= this.stepSeconds;
      steps++;
    }
    if (steps === this.maxSteps) this.accumulator = Math.min(this.accumulator, this.stepSeconds);
    return steps;
  }

  /** Fracción [0,1) hacia el siguiente paso, para interpolar el render. */
  get alpha(): number {
    return this.accumulator / this.stepSeconds;
  }
}

export interface LoopCallbacks {
  /** un paso de simulación de `dt` segundos fijos */
  step(dt: number): void;
  /** render con interpolación `alpha` y tiempo real del fotograma */
  render(alpha: number, frameSeconds: number): void;
}

export class GameLoop {
  readonly clock: FixedStepClock;
  private rafId = 0;
  private last = -1;
  private running = false;
  /** métricas de CPU en ms (media exponencial) */
  simMs = 0;
  renderMs = 0;
  frameMs = 16.7;

  constructor(
    private readonly cb: LoopCallbacks,
    hz: number,
  ) {
    this.clock = new FixedStepClock(1 / hz);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);
    const elapsed = this.last < 0 ? this.clock.stepSeconds : (now - this.last) / 1000;
    this.last = now;
    const t0 = performance.now();
    const steps = this.clock.advance(elapsed);
    const dt = this.clock.stepSeconds;
    for (let i = 0; i < steps; i++) this.cb.step(dt);
    const t1 = performance.now();
    this.cb.render(this.clock.alpha, elapsed);
    const t2 = performance.now();
    this.simMs = this.simMs * 0.9 + (t1 - t0) * 0.1;
    this.renderMs = this.renderMs * 0.9 + (t2 - t1) * 0.1;
    this.frameMs = this.frameMs * 0.9 + elapsed * 1000 * 0.1;
  };
}
