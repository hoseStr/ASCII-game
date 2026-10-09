// ---------------------------------------------------------------------------
// P3 · Glifos a resolución de pantalla. Cada píxel busca su celda, lee el
// estado de la celda y la cobertura del glifo en el atlas (píxel exacto).
// Alfa de salida: 0 = excluido del bloom (piezas puras); si no, 0,5 + 0,5 · cobertura · emisividad.
// ---------------------------------------------------------------------------

uniform highp sampler2D uFg;
uniform highp sampler2D uBg;
uniform highp sampler2D uGlyph;
uniform highp sampler2D uAtlas;   // R8, cobertura
uniform ivec2 uCellPx;            // tamaño de la celda en píxeles de dispositivo
uniform ivec2 uGridI;             // columnas, filas
uniform int uAtlasCols;
uniform vec2 uShake;              // sacudida de cámara en píxeles
uniform vec3 uPaper;

out vec4 oColor;

void main() {
  ivec2 px = ivec2(floor(gl_FragCoord.xy - uShake));
  int h = uGridI.y * uCellPx.y;
  int yTop = h - 1 - px.y;
  if (px.x < 0 || yTop < 0 || px.x >= uGridI.x * uCellPx.x || yTop >= h) {
    oColor = vec4(uPaper, 0.0);
    return;
  }
  ivec2 cell = ivec2(px.x / uCellPx.x, yTop / uCellPx.y);
  ivec2 local = ivec2(px.x - cell.x * uCellPx.x, yTop - cell.y * uCellPx.y);
  vec4 fg = texelFetch(uFg, cell, 0);
  vec4 bgv = texelFetch(uBg, cell, 0);
  vec3 bg = bgv.rgb;
  vec4 g = texelFetch(uGlyph, cell, 0);
  int gi = int(g.r * 255.0 + 0.5) + 256 * int(g.g * 255.0 + 0.5);
  ivec2 slot = ivec2(gi % uAtlasCols, gi / uAtlasCols) * uCellPx;
  float a = texelFetch(uAtlas, slot + local, 0).r;
  oColor = vec4(mix(bg, fg.rgb, a), bgv.a < 0.5 ? 0.0 : 0.5 + 0.5 * a * fg.a);
}
