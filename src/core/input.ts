/**
 * Entrada unificada: teclado (WASD/flechas, J/Espacio, K, Esc, Enter) y mando
 * (Gamepad API, mapeo estándar) → acciones. Se muestrea una vez por paso de
 * simulación; `pressed` detecta flancos (pulsado en este paso).
 * Se usa `event.code` (posición física): funciona igual en teclados españoles.
 */

export const ACTIONS = ['up', 'down', 'left', 'right', 'attack', 'use', 'pause', 'confirm'] as const;
export type Action = (typeof ACTIONS)[number];
const ACTION_INDEX: Record<Action, number> = Object.fromEntries(ACTIONS.map((a, i) => [a, i])) as Record<Action, number>;

const KEY_MAP: Record<string, Action> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyJ: 'attack',
  Space: 'attack',
  KeyK: 'use',
  Escape: 'pause',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
};

/** Teclas de función reservadas para depuración (se bloquea su acción del navegador). */
const DEBUG_KEYS = new Set(['F3', 'F4']);

const DEADZONE = 0.3;

function btn(pad: Gamepad, i: number): boolean {
  return pad.buttons[i]?.pressed ?? false;
}

export class Input {
  private readonly keyHeld = new Uint8Array(ACTIONS.length);
  private readonly padHeld = new Uint8Array(ACTIONS.length);
  private readonly current = new Uint8Array(ACTIONS.length);
  private readonly previous = new Uint8Array(ACTIONS.length);
  /** eje analógico del mando (sin cuantizar) */
  padX = 0;
  padY = 0;
  /** callback para teclas de depuración: F3, F4 y dígitos */
  onDebugKey: ((code: string) => void) | null = null;

  /** mandos conectados: solo se sondea la Gamepad API si hay alguno */
  private gamepads = 0;

  attach(target: Window): void {
    target.addEventListener('gamepadconnected', this.onPadConnected);
    target.addEventListener('gamepaddisconnected', this.onPadDisconnected);
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(target: Window): void {
    target.removeEventListener('gamepadconnected', this.onPadConnected);
    target.removeEventListener('gamepaddisconnected', this.onPadDisconnected);
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const action = KEY_MAP[e.code];
    if (action) {
      this.keyHeld[ACTION_INDEX[action]] = 1;
      e.preventDefault();
    }
    if (DEBUG_KEYS.has(e.code) || /^Digit\d$/.test(e.code)) {
      if (DEBUG_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.onDebugKey?.(e.code);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const action = KEY_MAP[e.code];
    if (action) this.keyHeld[ACTION_INDEX[action]] = 0;
  };

  private readonly onPadConnected = (): void => {
    this.gamepads++;
  };

  private readonly onPadDisconnected = (): void => {
    this.gamepads = Math.max(0, this.gamepads - 1);
  };

  private readonly onBlur = (): void => {
    this.keyHeld.fill(0);
  };

  /** Muestrea teclado + mando; llamar al inicio de cada paso de simulación. */
  update(): void {
    this.pollGamepad();
    this.previous.set(this.current);
    for (let i = 0; i < ACTIONS.length; i++) this.current[i] = this.keyHeld[i]! | this.padHeld[i]!;
  }

  isDown(a: Action): boolean {
    return this.current[ACTION_INDEX[a]] === 1;
  }

  pressed(a: Action): boolean {
    const i = ACTION_INDEX[a];
    return this.current[i] === 1 && this.previous[i] === 0;
  }

  /** Dirección de movimiento normalizada (teclado digital o stick analógico). */
  axisX(): number {
    if (Math.abs(this.padX) > DEADZONE) return this.padX;
    return (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
  }

  axisY(): number {
    if (Math.abs(this.padY) > DEADZONE) return this.padY;
    return (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0);
  }

  private pollGamepad(): void {
    this.padHeld.fill(0);
    this.padX = 0;
    this.padY = 0;
    if (this.gamepads === 0) return; // getGamepads() crea un array nuevo en cada llamada
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
    if (!pads) return;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > Math.abs(this.padX)) this.padX = ax;
      if (Math.abs(ay) > Math.abs(this.padY)) this.padY = ay;
      if (btn(pad, 12) || ay < -0.5) this.padHeld[ACTION_INDEX.up] = 1;
      if (btn(pad, 13) || ay > 0.5) this.padHeld[ACTION_INDEX.down] = 1;
      if (btn(pad, 14) || ax < -0.5) this.padHeld[ACTION_INDEX.left] = 1;
      if (btn(pad, 15) || ax > 0.5) this.padHeld[ACTION_INDEX.right] = 1;
      if (btn(pad, 0) || btn(pad, 2)) this.padHeld[ACTION_INDEX.attack] = 1;
      if (btn(pad, 1) || btn(pad, 3)) this.padHeld[ACTION_INDEX.use] = 1;
      if (btn(pad, 9)) this.padHeld[ACTION_INDEX.pause] = 1;
      if (btn(pad, 0) || btn(pad, 9)) this.padHeld[ACTION_INDEX.confirm] = 1;
      break; // un solo mando
    }
  }
}
