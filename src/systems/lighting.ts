/**
 * Luz en CPU: la misma atenuación que el shader pictórico (pictorial.frag),
 * para que lo que decide la jugabilidad o colorea la capa semántica coincida
 * con lo que se ve. Coordenadas en unidades de pantalla.
 */
import type { FrameParams } from '../render/renderer';

/** atten(d, r) idéntica a la del shader. */
export function atten(d: number, r: number): number {
  const x = d / r;
  const win = Math.max(0, 1 - x * x);
  return (win * win) / (1 + 9 * x * x);
}

/** Nivel de luz (luminancia aproximada) en (x, y): ambiente + luces dinámicas. */
export function lightLevel(f: FrameParams, x: number, y: number, ambient: number): number {
  let sum = ambient;
  for (let i = 0; i < f.lightCount; i++) {
    const o = i * 4;
    const dx = x - f.lightPos[o]!;
    const dy = y - f.lightPos[o + 1]!;
    const r = f.lightPos[o + 2]!;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    const lum = (f.lightCol[o]! + f.lightCol[o + 1]! + f.lightCol[o + 2]!) / 3;
    sum += lum * atten(Math.sqrt(d2), r);
  }
  return sum;
}
