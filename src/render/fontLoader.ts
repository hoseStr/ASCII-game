/**
 * Carga de la fuente del juego (local, sin CDN): se lee el TTF una vez, se
 * analiza su cmap (glifos disponibles) y se registra como FontFace para el atlas.
 */
import fontUrl from '../assets/fonts/DejaVuSansMono-Bold.ttf?url';
import { FONT_FAMILY } from './atlas';
import { parseTrueType, type FontInfo } from './ttf';

export async function loadGameFont(): Promise<FontInfo> {
  const res = await fetch(fontUrl);
  if (!res.ok) throw new Error(`No se pudo cargar la fuente (${res.status})`);
  const buffer = await res.arrayBuffer();
  const info = parseTrueType(buffer);
  const face = new FontFace(FONT_FAMILY, buffer);
  await face.load();
  document.fonts.add(face);
  await document.fonts.load(`20px "${FONT_FAMILY}"`, '$✦░');
  if (!document.fonts.check(`20px "${FONT_FAMILY}"`)) throw new Error('La fuente no quedó disponible');
  return info;
}
