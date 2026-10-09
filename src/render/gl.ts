/** Utilidades mínimas de WebGL2: shaders, programas, texturas y render targets. */

export type GL = WebGL2RenderingContext;

export class ShaderError extends Error {}

function numbered(src: string): string {
  return src
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(4)}: ${l}`)
    .join('\n');
}

function compile(gl: GL, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new ShaderError(`Shader '${label}' no compila:\n${log}\n${numbered(src)}`);
  }
  return sh;
}

/** Programa enlazado con las ubicaciones de uniforms resueltas una sola vez. */
export class Program {
  readonly handle: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation>();

  constructor(
    private readonly gl: GL,
    vs: string,
    fs: string,
    readonly label: string,
  ) {
    const p = gl.createProgram()!;
    const v = compile(gl, gl.VERTEX_SHADER, vs, `${label}.vert`);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs, `${label}.frag`);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new ShaderError(`Programa '${label}' no enlaza:\n${gl.getProgramInfoLog(p)}`);
    }
    this.handle = p;
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(p, info.name);
      if (loc) this.locations.set(name, loc);
    }
  }

  use(): void {
    this.gl.useProgram(this.handle);
  }

  /** Ubicación de un uniform; null si el compilador lo eliminó por no usarse. */
  u(name: string): WebGLUniformLocation | null {
    return this.locations.get(name) ?? null;
  }

  dispose(): void {
    this.gl.deleteProgram(this.handle);
  }
}

export interface TexFormat {
  internalFormat: number;
  format: number;
  type: number;
  filter: number;
}

export function formats(gl: GL, halfFloat: boolean) {
  const rgba16f: TexFormat = halfFloat
    ? { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR }
    : { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
  return {
    rgba8: { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST } as TexFormat,
    rgba8Linear: { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR } as TexFormat,
    rgba16f,
    rgba16fNearest: { ...rgba16f, filter: gl.NEAREST } as TexFormat,
  };
}

export function createTexture(gl: GL, w: number, h: number, f: TexFormat, data: ArrayBufferView | null = null): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, f.internalFormat, w, h, 0, f.format, f.type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Framebuffer con uno o varios adjuntos de color (MRT). */
export class RenderTarget {
  readonly fbo: WebGLFramebuffer;
  readonly textures: WebGLTexture[];

  constructor(
    private readonly gl: GL,
    readonly width: number,
    readonly height: number,
    attachments: TexFormat[],
    readonly label: string,
  ) {
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    this.textures = attachments.map((f, i) => {
      const t = createTexture(gl, width, height, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      return t;
    });
    gl.drawBuffers(attachments.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
      throw new Error(`Framebuffer '${label}' incompleto (0x${status.toString(16)})`);
    }
  }

  bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
    this.gl.viewport(0, 0, this.width, this.height);
  }

  dispose(): void {
    for (const t of this.textures) this.gl.deleteTexture(t);
    this.gl.deleteFramebuffer(this.fbo);
  }
}

/** Activa una textura en una unidad y la asigna al sampler `name` del programa. */
export function bindTex(gl: GL, prog: Program, name: string, unit: number, tex: WebGLTexture): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const loc = prog.u(name);
  if (loc) gl.uniform1i(loc, unit);
}
