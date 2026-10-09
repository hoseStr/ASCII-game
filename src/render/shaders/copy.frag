// Copia el estado de celda (4 adjuntos) a la instantánea de transición.
uniform highp sampler2D uA;
uniform highp sampler2D uB;
uniform highp sampler2D uC;
uniform highp sampler2D uD;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  o0 = texelFetch(uA, c, 0);
  o1 = texelFetch(uB, c, 0);
  o2 = texelFetch(uC, c, 0);
  o3 = texelFetch(uD, c, 0);
}
