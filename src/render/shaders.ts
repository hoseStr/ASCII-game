/**
 * Ensamblado de shaders: versión, precisión, constantes compartidas con TS y
 * el código común (ruido, OKLab), antepuestos a cada fragment shader.
 */
import bloomSrc from './shaders/bloom.frag?raw';
import commonSrc from './shaders/common.glsl?raw';
import composeSrc from './shaders/compose.frag?raw';
import copySrc from './shaders/copy.frag?raw';
import finalSrc from './shaders/final.frag?raw';
import particlesFragSrc from './shaders/particles.frag?raw';
import particlesVertSrc from './shaders/particles.vert?raw';
import pictorialSrc from './shaders/pictorial.frag?raw';
import rasterSrc from './shaders/raster.frag?raw';
import terrainSrc from './shaders/terrain.frag?raw';
import { CELL_ASPECT } from '../config';
import { MATERIALS } from './glyphs';
import { PALETTE_SLOTS } from './zonePalette';
import { TILE, TILE_UNITS } from '../world/tiles';
import { SCREEN_TILES_H, SCREEN_TILES_W } from '../world/room';

export const MAX_LIGHTS = 48;
export const MAX_CRYSTALS = 8;
export const MAX_PARTICLES = 512;
/** floats por partícula en el buffer de vértices: x, y, tamaño, intensidad, r, g, b, material */
export const PARTICLE_STRIDE = 8;

/** Tipos de superficie que el horneado del terreno deja para la pasada pictórica. */
export const SURFACE_KINDS = ['ground', 'path', 'flower', 'rock', 'rockFront', 'canopy', 'trunk', 'water', 'shore', 'void'] as const;

/** Flags de la capa semántica (canal G de la textura RG16UI). */
export const FLAG_OCCUPIED = 1;
export const FLAG_EMISSIVE = 2;
/** La celda pide despejar la capa pictórica a su alrededor. */
export const FLAG_CLEAR = 4;
/**
 * Profundidad de una entidad (bits 8..13 de los flags): fila de pantalla de sus
 * pies + 1 (0 = sin profundidad: siempre encima). Una pieza de escenario cuya base
 * está más al sur que los pies de la entidad la tapa.
 */
export const DEPTH_SHIFT = 8;
export const DEPTH_MASK = 63;

export const FULLSCREEN_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function defines(extra: Record<string, string | number> = {}): string {
  const lines: string[] = [
    `#define MAX_LIGHTS ${MAX_LIGHTS}`,
    `#define MAX_CRYSTALS ${MAX_CRYSTALS}`,
    `#define MAT_COUNT ${MATERIALS.length}`,
    `#define PAL_SIZE ${PALETTE_SLOTS.length}`,
    `#define FLAG_OCCUPIED ${FLAG_OCCUPIED}u`,
    `#define FLAG_EMISSIVE ${FLAG_EMISSIVE}u`,
    `#define FLAG_CLEAR ${FLAG_CLEAR}u`,
    `#define DEPTH_SHIFT ${DEPTH_SHIFT}u`,
    `#define DEPTH_MASK ${DEPTH_MASK}u`,
    `#define CELL_W_UNITS ${CELL_ASPECT.toFixed(3)}`,
  ];
  MATERIALS.forEach((m, i) => lines.push(`#define MAT_${m.toUpperCase()} ${i}`));
  SURFACE_KINDS.forEach((k, i) => lines.push(`#define K_${k.replace(/([A-Z])/g, '_$1').toUpperCase()} ${i}`));
  for (const [name, id] of Object.entries(TILE)) lines.push(`#define T_${name.replace(/([A-Z])/g, '_$1').toUpperCase()} ${id}u`);
  lines.push(`#define TILES_W ${SCREEN_TILES_W}`, `#define TILES_H ${SCREEN_TILES_H}`, `#define TILE_U ${TILE_UNITS.toFixed(1)}`);
  PALETTE_SLOTS.forEach((s, i) => lines.push(`#define P_${s.replace(/([A-Z])/g, '_$1').toUpperCase()} ${i}`));
  for (const [k, v] of Object.entries(extra)) lines.push(`#define ${k} ${v}`);
  return lines.join('\n');
}

function fragment(body: string, extra?: Record<string, string | number>): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
${defines(extra)}
${commonSrc}
${body}`;
}

export const shaderSources = {
  particlesVert: () => `#version 300 es
precision highp float;
${particlesVertSrc}`,
  particles: () => fragment(particlesFragSrc),
  copy: () => fragment(copySrc),
  terrain: () => fragment(terrainSrc),
  pictorial: () => fragment(pictorialSrc),
  compose: () => fragment(composeSrc),
  raster: () => fragment(rasterSrc),
  bloom: (mode: 0 | 1 | 2) => fragment(bloomSrc, { MODE: mode }),
  final: () => fragment(finalSrc),
};
