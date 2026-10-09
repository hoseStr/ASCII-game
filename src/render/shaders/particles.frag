// Pase 0: color aditivo. Pase 1: material (solo donde la partícula domina).
uniform int uPass;
in vec4 vCol;
flat in float vMat;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oMat;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float a = exp(-dot(pc, pc) * 9.0) * vCol.a;
  if (uPass == 0) {
    oColor = vec4(vCol.rgb * a, 1.0);
    oMat = vec4(0.0);
  } else {
    if (a < 0.3) discard;
    oColor = vec4(0.0);
    oMat = vec4(vMat / 255.0, 0.95, 0.0, 1.0);
  }
}
