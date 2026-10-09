// Partículas → capa pictórica: un punto por partícula, en píxeles pictóricos.
layout(location = 0) in vec4 aPosSize;  // x, y (unidades de pantalla), tamaño (unidades), intensidad
layout(location = 1) in vec4 aColMat;   // color sRGB, id de material
uniform vec2 uPictSize;
uniform float uSamples;
uniform float uAspect;
out vec4 vCol;
flat out float vMat;
void main() {
  vec2 px = vec2(aPosSize.x / uAspect, aPosSize.y) * uSamples;
  gl_Position = vec4(px / uPictSize * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = max(1.0, aPosSize.z * uSamples);
  vCol = vec4(aColMat.rgb, aPosSize.w);
  vMat = aColMat.a;
}
