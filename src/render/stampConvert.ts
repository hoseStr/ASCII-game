/**
 * Conversión de las piezas de escenario (renders de modelos 3D) a ASCII, celda a
 * celda, en CPU. La forma sale del modelo 3D, no de la textura de la foto: el
 * estudio (tools/render_studio.py) fotografía también la luz sin textura, las
 * aristas de oclusión y los pliegues, y tools/make_stamps.py los deja en la
 * imagen de forma de cada estampa (R tono, G líneas).
 *
 *  - Líneas: el contorno de la silueta y las líneas internas del modelo se dibujan
 *    con glifos de línea orientados según el trazo dentro de la celda
 *    (_ - | / \ ( ) ' .). El borde de arriba de una silueta se dibuja en la celda
 *    de encima, como el `_` del ASCII clásico; el resto, por dentro. Es el
 *    contorno de la propia imagen: no se añaden marcos ni cajas.
 *  - Relleno: el tono de la forma (la luz sobre el modelo) en una rampa isótropa
 *    (. : ; * + % # & @). Las líneas son direccionales y el relleno no: así la
 *    forma se lee como un volumen con su contorno y no como letras sueltas.
 *  - Color: el promedio real de la celda (ponderado por alfa), con un mínimo de
 *    brillo para que la cara en sombra no desaparezca en la noche.
 *
 * Todos los glifos son de la rampa de 70 del repo; la celda guarda su posición en
 * ella (sentido light). Entre piezas que se solapan, el contorno de la de delante
 * se dibuja sobre la de detrás (canal B de la capa de forma: orden de dibujo + 1).
 * Determinista y sin allocations (el resultado se escribe en `out`).
 */
import { CELL_ASPECT } from '../config';
import { REPO_RAMP_COMPLEX } from './ascii';

/** muestras por celda de las imágenes de las piezas (proporción de la celda, 3:5) */
export const PROP_SX = 6;
export const PROP_SY = 10;
/** una celda de relleno es parte de la pieza si la silueta cubre al menos esta fracción */
export const COVER_MIN = 0.2;
/** fondo de la silueta: mezcla del fondo de la celda hacia el color de la pieza (× cobertura·1,5, tope 1) */
export const PROP_FILL = 0.24;
/** brillo mínimo (canal mayor, 0..255) del color de una celda de pieza */
export const COLOR_FLOOR = 102;
/** tinta mínima (en muestras de línea plena) para que una celda sea de línea */
export const LINE_MIN = 4;
/** las líneas, algo más claras que el relleno (como los contornos de tinta del terreno) */
const LINE_GAIN = 1.15;
/**
 * Por debajo de este alargamiento (medido en la celda normalizada, isótropa) la
 * tinta no es un trazo recto: una esquina, una curva o un detalle denso.
 */
const ELONG_MIN = 0.5;
/** una celda así, bien cubierta y con más líneas internas que contorno, es relleno */
const BUSY_COV = 0.5;
/** ángulos (grados) que separan horizontal, diagonal y vertical */
const HORIZONTAL_DEG = 25;
const VERTICAL_DEG = 65;
/** un trazo horizontal por debajo de esta altura de la celda (0 arriba, 1 abajo) es `_` */
const LOW_LINE = 0.62;

/** rampa del repo en sentido light (de vacío a tinta): la posición es el índice en la rampa del juego */
export const PROP_RAMP: string[] = Array.from(REPO_RAMP_COMPLEX).reverse();
const posOf = (ch: string): number => {
  const i = PROP_RAMP.indexOf(ch);
  if (i < 0) throw new Error(`'${ch}' no está en la rampa del repo`);
  return i;
};

/** relleno: glifos isótropos de la rampa del repo, de vacío a tinta (ordenados por tinta medida en la fuente) */
export const FILL_GLYPHS = ' .:;*+%#&@';
const FILL = Uint8Array.from(Array.from(FILL_GLYPHS), posOf);
/** glifos de línea */
export const LINE_GLYPHS = "_-|/\\()'.";
const [L_LOW, L_MID, L_VERT, L_SLASH, L_BACK, L_OPEN, L_CLOSE, L_TOP, L_BOTTOM] = Array.from(LINE_GLYPHS, posOf) as [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface CellResult {
  /** posición en la rampa (sentido light), o −1 si la celda queda fuera de la pieza */
  pos: number;
  r: number;
  g: number;
  b: number;
  /** cobertura de la silueta en la celda, 0..255 */
  cov: number;
}

export function newCellResult(): CellResult {
  return { pos: -1, r: 0, g: 0, b: 0, cov: 0 };
}

/** ¿La muestra (x, y) está dentro de una pieza? Devuelve su pieza + 1 (0 = fuera). */
function pieceAt(rgb: Uint8Array, form: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  const i = (y * w + x) * 4;
  return rgb[i + 3]! >= 128 ? form[i + 2]! + 1 : 0;
}

/**
 * Convierte la celda cuya esquina superior izquierda es la muestra (x0, y0).
 * `rgb` es la imagen (RGBA8) y `form` su forma (R tono, G línea, B pieza), ambas
 * de `w` × `h` muestras. Lee también el anillo de muestras vecinas de la celda.
 */
export function convertCell(rgb: Uint8Array, form: Uint8Array, w: number, h: number, x0: number, y0: number, out: CellResult): CellResult {
  let sa = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let st = 0;
  // momentos de la tinta (celda normalizada) y lado del cuerpo en el contorno
  let iw = 0;
  let ix = 0;
  let iy = 0;
  let ixx = 0;
  let iyy = 0;
  let ixy = 0;
  let silW = 0;
  let side = 0;
  let sideN = 0;
  for (let y = y0; y < y0 + PROP_SY; y++) {
    const v = (y - y0 + 0.5) / PROP_SY;
    for (let x = x0; x < x0 + PROP_SX; x++) {
      const i = (y * w + x) * 4;
      const a = rgb[i + 3]!;
      if (a > 0) {
        sa += a;
        sr += rgb[i]! * a;
        sg += rgb[i + 1]! * a;
        sb += rgb[i + 2]! * a;
        st += form[i]! * a;
      }
      const p = pieceAt(rgb, form, w, h, x, y);
      let ink = 0;
      if (p > 0) {
        // contorno por dentro: a los lados y abajo hay vacío o una pieza de detrás;
        // o justo debajo empieza una pieza de delante (su borde de arriba)
        const l = pieceAt(rgb, form, w, h, x - 1, y);
        const r = pieceAt(rgb, form, w, h, x + 1, y);
        const d = pieceAt(rgb, form, w, h, x, y + 1);
        if (l < p || r < p || d < p || d > p) {
          ink = 1;
          silW++;
          const dx = (r >= p ? 1 : 0) - (l >= p ? 1 : 0);
          if (dx !== 0) {
            side += dx;
            sideN++;
          }
        } else ink = form[i + 1]! / 255;
      } else if (pieceAt(rgb, form, w, h, x, y + 1) > 0) {
        ink = 1; // borde de arriba: en la muestra vacía de encima
        silW++;
      }
      if (ink > 0) {
        const u = (x - x0 + 0.5) / PROP_SX;
        iw += ink;
        ix += ink * u;
        iy += ink * v;
        ixx += ink * u * u;
        iyy += ink * v * v;
        ixy += ink * u * v;
      }
    }
  }
  const cov = sa / (255 * PROP_SX * PROP_SY);
  out.cov = Math.round(cov * 255);
  const line = iw >= LINE_MIN;
  if (!line && cov < COVER_MIN) {
    out.pos = -1;
    out.r = out.g = out.b = 0;
    return out;
  }

  // color real de la celda; una celda de línea sin cobertura (borde de arriba) toma el de debajo
  let r = 0;
  let g = 0;
  let b = 0;
  if (sa > 0) {
    r = sr / sa;
    g = sg / sa;
    b = sb / sa;
  } else if (y0 + PROP_SY < h) {
    let s = 0;
    const row = (y0 + PROP_SY) * w;
    for (let x = x0; x < x0 + PROP_SX; x++) {
      const i = (row + x) * 4;
      const a = rgb[i + 3]!;
      s += a;
      r += rgb[i]! * a;
      g += rgb[i + 1]! * a;
      b += rgb[i + 2]! * a;
    }
    if (s > 0) {
      r /= s;
      g /= s;
      b /= s;
    }
  }
  const m = Math.max(r, g, b);
  if (m < COLOR_FLOOR) {
    if (m > 0.5) {
      const k = COLOR_FLOOR / m;
      r *= k;
      g *= k;
      b *= k;
    } else r = g = b = COLOR_FLOOR;
  }
  const gain = line ? LINE_GAIN : 1;
  out.r = Math.min(255, Math.round(r * gain));
  out.g = Math.min(255, Math.round(g * gain));
  out.b = Math.min(255, Math.round(b * gain));

  // relleno: el tono de la forma en la rampa isótropa (nunca vacío dentro de la silueta)
  const n = FILL.length;
  const fill = sa > 0 ? FILL[1 + Math.min(Math.floor((st / sa / 255) * (n - 1)), n - 2)]! : FILL[1]!;
  if (!line) {
    out.pos = fill;
    return out;
  }

  // línea: eje mayor de la tinta (momentos), su alargamiento y su altura en la celda
  const mx = ix / iw;
  const my = iy / iw;
  let sxx = ixx / iw - mx * mx;
  const syy = iyy / iw - my * my;
  let sxy = ixy / iw - mx * my;
  const half = Math.sqrt(Math.max(0, ((sxx - syy) * (sxx - syy)) / 4 + sxy * sxy));
  const tr = sxx + syy;
  const elong = tr > 1e-12 ? (2 * half) / tr : 0;
  if (elong < ELONG_MIN) {
    // no es un trazo recto: detalle denso (relleno), curva de un lado ( ( ) ) o esquina (' .)
    if (cov >= BUSY_COV && silW < 0.5 * iw) out.pos = fill;
    else if (sideN > 0 && sideN >= 0.5 * silW && Math.abs(side) >= 0.6 * sideN) out.pos = side > 0 ? L_OPEN : L_CLOSE;
    else out.pos = my < 0.45 ? L_TOP : L_BOTTOM;
    return out;
  }
  // la orientación, en unidades visuales (la celda mide 3:5)
  sxx *= CELL_ASPECT * CELL_ASPECT;
  sxy *= CELL_ASPECT;
  const deg = Math.abs((Math.atan2(2 * sxy, sxx - syy) * 90) / Math.PI);
  if (deg <= HORIZONTAL_DEG) out.pos = my >= LOW_LINE ? L_LOW : L_MID;
  else if (deg >= VERTICAL_DEG) out.pos = L_VERT;
  else out.pos = sxy > 0 ? L_BACK : L_SLASH;
  return out;
}
