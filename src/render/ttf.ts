/**
 * Lector mínimo de TrueType: lo justo para verificar glifos (cmap) y anchos (hmtx).
 * Se usa en runtime (atlas: detectar glifos ausentes antes de que el navegador
 * caiga en silencio a otra fuente) y en los tests (cobertura de todas las rampas).
 */

export interface FontInfo {
  unitsPerEm: number;
  /** hhea */
  ascender: number;
  descender: number;
  /** OS/2 sTypo*: caja de diseño de 1 em usada para encajar el glifo en la celda */
  typoAscender: number;
  typoDescender: number;
  glyphIdOf(codePoint: number): number;
  has(char: string): boolean;
  /** Avance en unidades de fuente, o -1 si el glifo no existe. */
  advanceOf(char: string): number;
}

interface TableRecord {
  offset: number;
  length: number;
}

export function parseTrueType(buffer: ArrayBuffer): FontInfo {
  const view = new DataView(buffer);
  const numTables = view.getUint16(4);
  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + 16 * i;
    const tag = String.fromCharCode(
      view.getUint8(rec),
      view.getUint8(rec + 1),
      view.getUint8(rec + 2),
      view.getUint8(rec + 3),
    );
    tables.set(tag, { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }
  const table = (tag: string): TableRecord => {
    const t = tables.get(tag);
    if (!t) throw new Error(`TTF sin tabla '${tag}'`);
    return t;
  };

  const head = table('head');
  const unitsPerEm = view.getUint16(head.offset + 18);

  const hhea = table('hhea');
  const ascender = view.getInt16(hhea.offset + 4);
  const descender = view.getInt16(hhea.offset + 6);
  const numberOfHMetrics = view.getUint16(hhea.offset + 34);

  const os2 = tables.get('OS/2');
  const typoAscender = os2 ? view.getInt16(os2.offset + 68) : ascender;
  const typoDescender = os2 ? view.getInt16(os2.offset + 70) : descender;

  const hmtx = table('hmtx');
  const advanceOfGlyph = (gid: number): number =>
    view.getUint16(hmtx.offset + 4 * Math.min(gid, numberOfHMetrics - 1));

  const cmapToGlyph = parseCmap(view, table('cmap').offset);

  const glyphIdOf = (cp: number): number => cmapToGlyph.get(cp) ?? 0;
  return {
    unitsPerEm,
    ascender,
    descender,
    typoAscender,
    typoDescender,
    glyphIdOf,
    has: (ch) => glyphIdOf(ch.codePointAt(0)!) !== 0,
    advanceOf: (ch) => {
      const gid = glyphIdOf(ch.codePointAt(0)!);
      return gid === 0 ? -1 : advanceOfGlyph(gid);
    },
  };
}

function parseCmap(view: DataView, base: number): Map<number, number> {
  const numSubtables = view.getUint16(base + 2);
  let format4 = -1;
  let format12 = -1;
  for (let i = 0; i < numSubtables; i++) {
    const rec = base + 4 + 8 * i;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const offset = base + view.getUint32(rec + 4);
    const format = view.getUint16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12 && format12 < 0) format12 = offset;
    if (format === 4 && format4 < 0) format4 = offset;
  }
  const map = new Map<number, number>();
  if (format12 >= 0) {
    const nGroups = view.getUint32(format12 + 12);
    for (let g = 0; g < nGroups; g++) {
      const rec = format12 + 16 + 12 * g;
      const start = view.getUint32(rec);
      const end = view.getUint32(rec + 4);
      const startGlyph = view.getUint32(rec + 8);
      for (let cp = start; cp <= end; cp++) map.set(cp, startGlyph + (cp - start));
    }
    return map;
  }
  if (format4 < 0) throw new Error('TTF sin cmap Unicode (formato 4 o 12)');
  const segCount = view.getUint16(format4 + 6) / 2;
  const endCodes = format4 + 14;
  const startCodes = endCodes + 2 * segCount + 2;
  const idDeltas = startCodes + 2 * segCount;
  const idRangeOffsets = idDeltas + 2 * segCount;
  for (let s = 0; s < segCount; s++) {
    const end = view.getUint16(endCodes + 2 * s);
    const start = view.getUint16(startCodes + 2 * s);
    const delta = view.getInt16(idDeltas + 2 * s);
    const rangeOffsetPos = idRangeOffsets + 2 * s;
    const rangeOffset = view.getUint16(rangeOffsetPos);
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      let gid: number;
      if (rangeOffset === 0) {
        gid = (cp + delta) & 0xffff;
      } else {
        const glyphPos = rangeOffsetPos + rangeOffset + 2 * (cp - start);
        gid = view.getUint16(glyphPos);
        if (gid !== 0) gid = (gid + delta) & 0xffff;
      }
      if (gid !== 0) map.set(cp, gid);
    }
  }
  return map;
}
