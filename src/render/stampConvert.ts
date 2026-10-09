/**
 * Conversión de las piezas de escenario (renders de modelos 3D) a ASCII, celda a
 * celda, en CPU. Parte del algoritmo del repo y lo afina donde la forma importa:
 *
 *  - Zonas lisas (la celda entera dentro de la silueta, sin estructura): el glifo
 *    del repo tal cual, min(floor(L·N/255), N−1) en la rampa de 70.
 *  - Bordes de la silueta y detalles (estructura dentro de la celda): el glifo de
 *    la MISMA rampa cuya forma se parece más al patrón de la celda. Se compara la
 *    tinta de cada región de una rejilla 3×5 (brillo × alfa, con la respuesta
 *    tonal de la rampa del repo) con la cobertura medida del glifo en la fuente
 *    (data/glyphShapes.json): tono (media) + estructura (patrón normalizado,
 *    pesado por el contraste de la celda). Así el contorno de la imagen sale con
 *    `_ / \ | ( ) ' .` en vez de un borde dentado de letras.
 *  - Color: el promedio real de la celda (ponderado por alfa), con un mínimo de
 *    brillo para que la cara en sombra no desaparezca en la noche.
 *
 * Determinista y sin allocations (el resultado se escribe en `out`).
 */
import shapes from '../data/glyphShapes.json';

/** muestras por celda de las imágenes de las piezas (proporción de la celda, 3:5) */
export const PROP_SX = 6;
export const PROP_SY = 10;
/** una celda es parte de la pieza si la silueta cubre al menos esta fracción */
export const COVER_MIN = 0.2;
/** fondo de la silueta: mezcla del fondo de la celda hacia el color de la pieza (× cobertura·1,5, tope 1) */
export const PROP_FILL = 0.24;
/** brillo mínimo (canal mayor, 0..255) del color de una celda de pieza */
export const COLOR_FLOOR = 102;
/** por debajo de este contraste (y con la celda cubierta) se usa el glifo del repo */
const FLAT_CONTRAST = 0.35;
const TONE_WEIGHT = 3;
const STRUCT_WEIGHT = 1.5;

const [GX, GY] = shapes.grid as [number, number];
const K = GX * GY;
const RW = PROP_SX / GX;
const RH = PROP_SY / GY;
/** rampa en sentido light (de vacío a tinta): la posición es el índice en la rampa del juego */
export const PROP_RAMP: string[] = Array.from(shapes.ramp);
const N = PROP_RAMP.length;

const env = Float64Array.from(shapes.response);
const muG = new Float64Array(N);
/** forma de cada glifo: cobertura centrada y normalizada (norma 1) */
const shapeN = new Float64Array(N * K);
let cmax = 0;
for (let g = 0; g < N; g++) {
  const cov = shapes.coverage[g]!;
  let mu = 0;
  for (let k = 0; k < K; k++) mu += cov[k]!;
  mu /= K;
  muG[g] = mu;
  let nn = 0;
  for (let k = 0; k < K; k++) nn += (cov[k]! - mu) ** 2;
  const inv = nn > 1e-12 ? 1 / Math.sqrt(nn) : 0;
  for (let k = 0; k < K; k++) shapeN[g * K + k] = (cov[k]! - mu) * inv;
}
for (let i = 0; i < N; i++) cmax = Math.max(cmax, env[i]!);
const contrastK = 0.12 * cmax * Math.sqrt(K);

export interface CellResult {
  /** posición en la rampa (sentido light), o −1 si la celda queda fuera de la silueta */
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

const ar = new Float64Array(K);
const yr = new Float64Array(K);
const tc = new Float64Array(K);

/**
 * Convierte la celda cuya esquina superior izquierda es la muestra (x0, y0) de
 * una imagen RGBA8 de `stride` muestras de ancho (PROP_SX × PROP_SY muestras).
 */
export function convertCell(data: Uint8Array, stride: number, x0: number, y0: number, out: CellResult): CellResult {
  let sa = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sy = 0;
  for (let ry = 0; ry < GY; ry++) {
    for (let rx = 0; rx < GX; rx++) {
      let ra = 0;
      let ryy = 0;
      for (let y = 0; y < RH; y++) {
        let i = ((y0 + ry * RH + y) * stride + x0 + rx * RW) * 4;
        for (let x = 0; x < RW; x++, i += 4) {
          const a = data[i + 3]! / 255;
          if (a === 0) continue;
          const r = data[i]!;
          const g = data[i + 1]!;
          const b = data[i + 2]!;
          ra += a;
          ryy += ((r + g + b) / 765) * a;
          sr += r * a;
          sg += g * a;
          sb += b * a;
        }
      }
      const k = ry * GX + rx;
      ar[k] = ra / (RW * RH);
      yr[k] = ra > 0 ? ryy / ra : 0;
      sa += ra;
      sy += ryy;
    }
  }
  const cov = sa / (PROP_SX * PROP_SY);
  out.cov = Math.round(cov * 255);
  if (cov < COVER_MIN) {
    out.pos = -1;
    out.r = out.g = out.b = 0;
    return out;
  }
  // color real de la celda, con brillo mínimo (se conserva el tono)
  let r = sr / sa;
  let g = sg / sa;
  let b = sb / sa;
  const m = Math.max(r, g, b);
  if (m < COLOR_FLOOR) {
    if (m > 0.5) {
      const k = COLOR_FLOOR / m;
      r *= k;
      g *= k;
      b *= k;
    } else r = g = b = COLOR_FLOOR;
  }
  out.r = Math.min(255, Math.round(r));
  out.g = Math.min(255, Math.round(g));
  out.b = Math.min(255, Math.round(b));

  // patrón de tinta de la celda con la respuesta tonal de la rampa del repo
  let muT = 0;
  for (let k = 0; k < K; k++) {
    const t = ar[k]! * env[Math.min(Math.floor(yr[k]! * N), N - 1)]!;
    tc[k] = t;
    muT += t;
  }
  muT /= K;
  let nt = 0;
  for (let k = 0; k < K; k++) {
    tc[k] = tc[k]! - muT;
    nt += tc[k]! * tc[k]!;
  }
  nt = Math.sqrt(nt);
  const contrast = nt / (nt + contrastK);
  if (contrast < FLAT_CONTRAST && cov >= 0.5) {
    // zona lisa: el glifo del repo, sin más
    out.pos = Math.min(Math.floor((sy / sa) * N), N - 1);
    return out;
  }
  const invNt = nt > 1e-12 ? 1 / nt : 0;
  const ws = STRUCT_WEIGHT * contrast;
  let best = 0;
  let bestCost = Infinity;
  for (let gi = 0; gi < N; gi++) {
    const dt = (muG[gi]! - muT) / cmax;
    let dot = 0;
    const o = gi * K;
    for (let k = 0; k < K; k++) dot += shapeN[o + k]! * tc[k]!;
    const cost = TONE_WEIGHT * dt * dt + ws * (1 - dot * invNt);
    if (cost < bestCost) {
      bestCost = cost;
      best = gi;
    }
  }
  out.pos = best;
  return out;
}
