/**
 * Encaje de la grilla en el lienzo: celdas de tamaño ENTERO en píxeles de
 * dispositivo (texto nítido, sin filtrado) lo más cerca posible de la
 * proporción ideal, centradas con letterbox.
 */
export interface GridLayout {
  cellW: number;
  cellH: number;
  viewW: number;
  viewH: number;
  /** esquina superior izquierda del letterbox, en píxeles del lienzo */
  offX: number;
  offY: number;
  /** proporción real de la celda (la reciben los shaders) */
  aspect: number;
}

export function computeLayout(width: number, height: number, cols: number, rows: number, aspect: number): GridLayout {
  // Candidato limitado por el ancho, reducido hasta caber en alto.
  let cellW = Math.max(2, Math.floor(width / cols));
  let cellH = Math.max(3, Math.round(cellW / aspect));
  while (cellW > 2 && rows * cellH > height) {
    cellW--;
    cellH = Math.max(3, Math.round(cellW / aspect));
  }
  // Candidato limitado por el alto: a veces llena mejor la pantalla.
  const altH = Math.max(3, Math.floor(height / rows));
  const altW = Math.max(2, Math.round(altH * aspect));
  if (cols * altW <= width && altH * altW > cellH * cellW) {
    cellW = altW;
    cellH = altH;
  }
  const viewW = cols * cellW;
  const viewH = rows * cellH;
  return {
    cellW,
    cellH,
    viewW,
    viewH,
    offX: Math.max(0, Math.floor((width - viewW) / 2)),
    offY: Math.max(0, Math.floor((height - viewH) / 2)),
    aspect: cellW / cellH,
  };
}
