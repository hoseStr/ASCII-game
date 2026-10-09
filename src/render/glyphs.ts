/**
 * Registro central de glifos: rampas por material, glifos reservados para
 * entidades, texto de interfaz y glifos procedurales. Todo glifo que el juego
 * dibuje debe salir de aquí (el atlas se construye con esta lista y un test
 * verifica que cada uno existe en la fuente con el avance monoespaciado).
 */
import { REPO_RAMP_COMPLEX } from './ascii';

/** Materiales de la capa pictórica. El id es el índice (se codifica en el shader). */
export const MATERIALS = ['base', 'light', 'mist', 'water', 'veg', 'crystal', 'flower', 'path', 'foliage'] as const;
export type Material = (typeof MATERIALS)[number];
export const MATERIAL_ID: Record<Material, number> = {
  base: 0,
  light: 1,
  mist: 2,
  water: 3,
  veg: 4,
  crystal: 5,
  flower: 6,
  path: 7,
  foliage: 8,
};

export interface RampDef {
  /** Glifos de oscuro a brillante (sentido `light`), con el espacio primero. */
  glyphs: string;
  /**
   * `authored`: se respeta el orden escrito (la rampa del repo y la de luz).
   * `measured`: se reordena por tinta medida al construir el atlas (port de sort_chars).
   */
  order: 'authored' | 'measured';
}

const reverse = (s: string): string => Array.from(s).reverse().join('');

export const RAMPS: Record<Material, RampDef> = {
  // La rampa del repo, invertida para quedar de vacío a tinta, sin reordenar:
  // su "sopa de letras" no monótona es parte de la firma visual de los videos.
  base: { glyphs: reverse(REPO_RAMP_COMPLEX), order: 'authored' },
  // Sin ○ ◌: en movimiento y al titilar se leían como letras 'o'. La luz es destello puro.
  light: { glyphs: ' ˙·∘✧✦', order: 'authored' },
  mist: { glyphs: ' .·∴░▒▓', order: 'measured' },
  // Agua: olas, nunca comas (eran iguales al pasto y el lago se confundía con el suelo).
  water: { glyphs: ' .~∽≈', order: 'measured' },
  // Pasto del suelo: marcas finas. Nunca glifos que parezcan árboles (eso es follaje).
  veg: { glyphs: ` .,';ʎγ`, order: 'measured' },
  crystal: { glyphs: ' ·◦△◊◇♦◈◆▲', order: 'measured' },
  flower: { glyphs: ' .·⚘✾✿❀', order: 'measured' },
  // caminos y arena: puntos, polvo y grava (nunca letras ni bloques)
  path: { glyphs: ' .·∶:∴∷', order: 'measured' },
  // Copas de los árboles (obstáculos): follaje denso, distinto del pasto.
  foliage: { glyphs: ' ·τ↟♠♣ψΨ', order: 'measured' },
};

/**
 * Glifos de la fuente reservados para entidades interactivas (princesa,
 * enemigos, objetos, proyectiles). Junto con los bloques procedurales forman el
 * conjunto reservado: el decorado nunca puede usarlos (tests/legibility.test.ts).
 */
export const ENTITY_GLYPHS = '✶♛♔•ᴗ◢◣◤◥▼▾▸◂◀▶';

/** Bloques (procedurales): reservados para entidades y la interfaz. */
export const BLOCK_GLYPHS = '█▀▄▌▐▖▗▘▝▞▚▙▛▜▟▁▂▃▅▆▇▏▎▍▋▊▉';

export const RESERVED_ENTITY_GLYPHS = ENTITY_GLYPHS + BLOCK_GLYPHS;

/** Texto de interfaz (HUD, menús, depuración): ASCII imprimible + acentos del español. */
export const UI_GLYPHS =
  Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') + 'áéíóúñÁÉÍÓÚÑüÜ¿¡·…—♥♡←↑→↓■□';

/**
 * Glifos que se dibujan a mano en el atlas en lugar de usar la fuente:
 * bloques (la fuente los hace más altos que la celda) y líneas de caja
 * (DejaVu Sans Mono Bold no las incluye). Así encajan sin juntas.
 */
export const PROCEDURAL_GLYPHS = BLOCK_GLYPHS + '─│┌┐└┘├┤┬┴┼╭╮╯╰═║╔╗╚╝';

/** Contornos de obstáculos y costa (capa pictórica): horizontal, vertical, / y \\. */
export const EDGE_GLYPHS = ['─', '│', '/', '\\'] as const;

/** Glifos de la fuente que se estiran al alto de la celda (sombreados). */
export const STRETCHED_GLYPHS = '░▒▓';

/** Lista única de glifos del atlas; el índice 0 es siempre el espacio. */
export function atlasGlyphList(): string[] {
  const seen = new Set<string>([' ']);
  const list: string[] = [' '];
  const add = (s: string): void => {
    for (const ch of Array.from(s)) {
      if (!seen.has(ch)) {
        seen.add(ch);
        list.push(ch);
      }
    }
  };
  for (const m of MATERIALS) add(RAMPS[m].glyphs);
  add(RESERVED_ENTITY_GLYPHS);
  add(UI_GLYPHS);
  add(PROCEDURAL_GLYPHS);
  return list;
}

let staticIndex: Map<string, number> | null = null;

/**
 * Índice de un glifo en el atlas. El orden del atlas no depende del tamaño de
 * celda, así que la lógica puede resolver glifos sin tener el atlas construido.
 * Devuelve 0 (espacio) si el glifo no está registrado.
 */
export function glyphIndex(ch: string): number {
  if (!staticIndex) staticIndex = new Map(atlasGlyphList().map((g, i) => [g, i]));
  return staticIndex.get(ch) ?? 0;
}

/** Texto → índices del atlas (resolver una vez, fuera del bucle caliente). */
export function glyphRun(text: string): Uint16Array {
  return Uint16Array.from(Array.from(text), glyphIndex);
}
