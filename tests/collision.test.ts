import { describe, expect, it } from 'vitest';
import { CLOSED_EDGES, moveBody, overlapsSolid, type Body } from '../src/world/collision';
import { parseRoomMap } from '../src/world/room';

// Sala de prueba: suelo con una roca en (10, 5) y una pared vertical en x = 20
// con un hueco en la fila 8 (y de 24 a 27 unidades).
const rows = Array.from({ length: 16 }, () => ','.repeat(32).split(''));
rows[5]![10] = '#';
for (let y = 0; y < 16; y++) if (y !== 8) rows[y]![20] = '#';
const map = parseRoomMap(rows.map((r) => r.join('')).join('\n'), 'prueba');

const body = (x: number, y: number): Body => ({ x, y, hw: 0.85, hh: 0.55 });

describe('colisión AABB contra el tilemap', () => {
  it('detecta tiles sólidos bajo la caja', () => {
    expect(overlapsSolid(map, 31.5, 16.5, 0.85, 0.55, CLOSED_EDGES)).toBe(true);
    expect(overlapsSolid(map, 5, 5, 0.85, 0.55, CLOSED_EDGES)).toBe(false);
  });

  it('se detiene contra una pared sin atravesarla, incluso a gran velocidad', () => {
    const b = body(55, 30);
    moveBody(map, b, 20, 0, CLOSED_EDGES);
    expect(b.x + b.hw).toBeLessThanOrEqual(60 + 1e-6);
    expect(b.x).toBeGreaterThan(58);
  });

  it('desliza por la esquina hacia el hueco cercano (empujón de alineación)', () => {
    const b = body(58.5, 24.3); // llega un poco desalineada respecto al hueco
    for (let i = 0; i < 30; i++) moveBody(map, b, 0.3, 0, CLOSED_EDGES);
    expect(b.x).toBeGreaterThan(61); // cruzó el hueco
    expect(b.y - b.hh).toBeGreaterThanOrEqual(24 - 1e-6);
  });

  it('sin salida, el borde de la sala es sólido', () => {
    const b = body(1, 30);
    moveBody(map, b, -5, 0, CLOSED_EDGES);
    expect(b.x - b.hw).toBeGreaterThanOrEqual(-1e-6);
  });

  it('con salida abierta, el borde deja pasar donde el tile del borde es caminable', () => {
    const b = body(1, 30);
    moveBody(map, b, -5, 0, { ...CLOSED_EDGES, west: true });
    expect(b.x).toBeLessThan(0);
  });
});
