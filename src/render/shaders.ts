/**
 * Ensamblado de shaders: versión, precisión, constantes compartidas con TS y
 * el código común (ruido, OKLab), antepuestos a cada fragment shader.
 */
import bloomSrc from './shaders/bloom.frag?raw';
import commonSrc from './shaders/common.glsl?raw';
import composeSrc from './shaders/compose.frag?raw';
import finalSrc from './shaders/final.frag?raw';
import pictorialSrc from './shaders/pictorial.frag?raw';
import rasterSrc from './shaders/raster.frag?raw';
import terrainSrc from './shaders/terrain.frag?raw';
import { MATERIALS } from './glyphs';
import { PALETTE_SLOTS } from './zonePalette';

export const MAX_LIGHTS = 48;
export const MAX_CRYSTALS = 8;

/** Flags de la capa semántica (canal G de la textura RG16UI). */
export const FLAG_OCCUPIED = 1;
export const FLAG_EMISSIVE = 2;
/** La celda pide despejar la capa pictórica a su alrededor. */
export const FLAG_CLEAR = 4;

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
  ];
  MATERIALS.forEach((m, i) => lines.push(`#define MAT_${m.toUpperCase()} ${i}`));
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
  terrain: () => fragment(terrainSrc),
  pictorial: () => fragment(pictorialSrc),
  compose: () => fragment(composeSrc),
  raster: () => fragment(rasterSrc),
  bloom: (mode: 0 | 1 | 2) => fragment(bloomSrc, { MODE: mode }),
  final: () => fragment(finalSrc),
};
