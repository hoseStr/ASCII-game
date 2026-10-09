import { describe, expect, it } from 'vitest';
import { CELL_ASPECT, GRID_COLS, GRID_ROWS } from '../src/config';
import { FixedStepClock } from '../src/core/loop';
import { computeLayout } from '../src/render/layout';

describe('computeLayout', () => {
  it('1080p: celdas 12×20 que llenan la pantalla exacta', () => {
    const L = computeLayout(1920, 1080, GRID_COLS, GRID_ROWS, CELL_ASPECT);
    expect([L.cellW, L.cellH, L.viewW, L.viewH, L.offX, L.offY]).toEqual([12, 20, 1920, 1080, 0, 0]);
  });

  it('1366×768: celdas enteras con letterbox centrado', () => {
    const L = computeLayout(1366, 768, GRID_COLS, GRID_ROWS, CELL_ASPECT);
    expect(Number.isInteger(L.cellW) && Number.isInteger(L.cellH)).toBe(true);
    expect(L.viewW).toBeLessThanOrEqual(1366);
    expect(L.viewH).toBeLessThanOrEqual(768);
    expect(L.offX).toBe(Math.floor((1366 - L.viewW) / 2));
    expect(Math.abs(L.aspect - CELL_ASPECT)).toBeLessThan(0.05);
  });

  it('1440p y 4K: siempre cabe y la proporción se mantiene cerca de 3:5', () => {
    for (const [w, h] of [
      [2560, 1440],
      [3840, 2160],
      [1280, 1024],
      [800, 600],
    ] as const) {
      const L = computeLayout(w, h, GRID_COLS, GRID_ROWS, CELL_ASPECT);
      expect(L.viewW).toBeLessThanOrEqual(w);
      expect(L.viewH).toBeLessThanOrEqual(h);
      expect(Math.abs(L.aspect - CELL_ASPECT)).toBeLessThan(0.07);
    }
    expect(computeLayout(3840, 2160, GRID_COLS, GRID_ROWS, CELL_ASPECT).cellW).toBe(24);
  });
});

describe('FixedStepClock', () => {
  it('acumula tiempo y simula pasos fijos', () => {
    const c = new FixedStepClock(1 / 60);
    expect(c.advance(1 / 120)).toBe(0);
    expect(c.alpha).toBeCloseTo(0.5, 5);
    expect(c.advance(1 / 120)).toBe(1);
    expect(c.advance(3 / 60 + 1e-9)).toBe(3);
  });

  it('limita los pasos tras un parón largo (sin espiral de la muerte)', () => {
    const c = new FixedStepClock(1 / 60, 5);
    expect(c.advance(2)).toBe(5);
    expect(c.alpha).toBeLessThanOrEqual(1);
    expect(c.advance(0)).toBeLessThanOrEqual(1);
  });

  it('es determinista: misma secuencia de tiempos → mismos pasos', () => {
    const times = [0.016, 0.017, 0.033, 0.002, 0.05, 0.0167];
    const run = (): number[] => {
      const c = new FixedStepClock(1 / 60);
      return times.map((t) => c.advance(t));
    };
    expect(run()).toEqual(run());
  });
});
