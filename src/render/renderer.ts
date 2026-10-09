/**
 * Orquestador del render. Pasadas por fotograma:
 *   P0 terreno     → (cols·S)×(rows·S)  horneado de lo estático (solo al cambiar sala/paleta/calidad)
 *   P1 pictórica   → (cols·S)×(rows·S)  color + material (+ partículas)
 *   P2 conversión  → cols×rows          glifo, fg, bg, estado (ping-pong) + transiciones
 *   P3 glifos      → viewW×viewH        escena con alfa emisivo
 *   P4 bloom       → ½, ¼, ⅛… (filtro dual)
 *   P5 final       → lienzo (letterbox): bloom, viñeta, aberración, grano
 */
import { CELL_ASPECT, QUALITY_PRESETS, type Quality } from '../config';
import { HUD_ROWS } from '../world/tiles';
import { SCREEN_TILES_H, SCREEN_TILES_W } from '../world/room';
import type { RampDirection } from './ascii';
import { buildAtlas, type GlyphAtlas } from './atlas';
import type { CellBuffer } from './cellBuffer';
import { Program, RenderTarget, bindTex, createTexture, formats, type GL, type TexFormat } from './gl';
import { MATERIALS } from './glyphs';
import { GpuTimer } from './gpuTimer';
import { computeLayout, type GridLayout } from './layout';
import { FULLSCREEN_VERT, MAX_CRYSTALS, MAX_LIGHTS, MAX_PARTICLES, PARTICLE_STRIDE, shaderSources } from './shaders';
import type { FontInfo } from './ttf';
import type { ZonePaletteGpu } from './zonePalette';

export interface RenderSettings {
  direction: RampDirection;
  /** conversión literal del repo: sin suavizado, histéresis, realce ni fondo pintado */
  fidelity: boolean;
  /** F4: oculta la capa pictórica para comprobar la jugabilidad */
  legibility: boolean;
  quality: Quality;
  post: boolean;
  /** accesibilidad: sin aberración cromática (la sacudida la anula el juego) */
  reducedEffects: boolean;
}

/** Datos de un fotograma; los arrays se reutilizan (cero allocations). */
export interface FrameParams {
  time: number;
  /** segundos desde el render anterior (para el suavizado temporal) */
  dt: number;
  camX: number;
  camY: number;
  lightCount: number;
  lightPos: Float32Array;
  lightCol: Float32Array;
  crystalCount: number;
  crystals: Float32Array;
  shoot: Float32Array;
  shootIntensity: number;
  shootLength: number;
  /** princesa reflejada en el agua: pies (x, y), intensidad (0 = no) y color sRGB lineal */
  reflector: Float32Array;
  reflectorColor: Float32Array;
  particleCount: number;
  particles: Float32Array;
  ambient: number;
  exposure: number;
  fog: number;
  breath: number;
  /** sacudida de cámara en píxeles de dispositivo */
  shakeX: number;
  shakeY: number;
  dream: number;
  /** transición: 0 ninguna, 1 deslizamiento, 2 derretido */
  transMode: number;
  transT: number;
  transDirX: number;
  transDirY: number;
}

export function createFrameParams(): FrameParams {
  return {
    time: 0,
    dt: 1 / 60,
    camX: 0,
    camY: 0,
    lightCount: 0,
    lightPos: new Float32Array(MAX_LIGHTS * 4),
    lightCol: new Float32Array(MAX_LIGHTS * 4),
    crystalCount: 0,
    crystals: new Float32Array(MAX_CRYSTALS * 4),
    shoot: new Float32Array(4),
    shootIntensity: 0,
    shootLength: 0,
    reflector: new Float32Array(4),
    reflectorColor: new Float32Array(3),
    particleCount: 0,
    particles: new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE),
    ambient: 0.9,
    exposure: 1,
    fog: 1,
    breath: 0.06,
    shakeX: 0,
    shakeY: 0,
    dream: 0,
    transMode: 0,
    transT: 0,
    transDirX: 0,
    transDirY: 0,
  };
}

/** Lo que el render necesita de una sala. */
export interface RoomRender {
  field: Float32Array;
  tileTex: Uint8Array;
}

export const PASS_LABELS = ['pictórica', 'conversión', 'glifos', 'bloom', 'final'] as const;

const TEMPORAL_TAU = 0.05; // s: constante del suavizado de luminancia por celda
const HYSTERESIS = 0.3; // escalones de rampa

export class Renderer {
  readonly gl: GL;
  readonly timer: GpuTimer;
  readonly halfFloat: boolean;
  layout: GridLayout = { cellW: 0, cellH: 0, viewW: 0, viewH: 0, offX: 0, offY: 0, aspect: CELL_ASPECT };
  atlas: GlyphAtlas | null = null;
  /** tiempos de compilación por programa (overlay F3 y capturas) */
  readonly compileReport: string[];
  canvasW = 0;
  canvasH = 0;

  private readonly fmt: ReturnType<typeof formats>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly particleVao: WebGLVertexArrayObject;
  private readonly particleVbo: WebGLBuffer;
  private readonly progTerrain: Program;
  private readonly progPict: Program;
  private readonly progParticles: Program;
  private readonly progCompose: Program;
  private readonly progCopy: Program;
  private readonly progRaster: Program;
  private readonly progPrefilter: Program;
  private readonly progDown: Program;
  private readonly progUp: Program;
  private readonly progFinal: Program;
  private readonly fieldTex: WebGLTexture;
  private readonly tilesTex: WebGLTexture;
  private readonly noiseTex: WebGLTexture;
  private readonly semGlyphTex: WebGLTexture;
  private readonly semFgTex: WebGLTexture;
  private readonly semBgTex: WebGLTexture;
  private readonly compose: [RenderTarget, RenderTarget];
  private readonly snapshot: RenderTarget;
  private atlasTex: WebGLTexture | null = null;
  private rampsTex: WebGLTexture | null = null;
  private readonly rampLen = new Int32Array(MATERIALS.length);
  private pict: RenderTarget | null = null;
  private terrain: RenderTarget | null = null;
  private terrainDirty = true;
  private pictSamples = 0;
  private scene: RenderTarget | null = null;
  private bloomDown: RenderTarget[] = [];
  private bloomUp: RenderTarget[] = [];
  private bloomLevels = 0;
  private palette: ZonePaletteGpu | null = null;
  private frameIndex = 0;
  private resetState = true;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly font: FontInfo,
    readonly cols: number,
    readonly rows: number,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;
    this.halfFloat = gl.getExtension('EXT_color_buffer_float') !== null;
    this.fmt = formats(gl, this.halfFloat);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.vao = gl.createVertexArray()!;

    const v = FULLSCREEN_VERT;
    this.progTerrain = new Program(gl, v, shaderSources.terrain(), 'terrain');
    this.progPict = new Program(gl, v, shaderSources.pictorial(), 'pictorial');
    this.progParticles = new Program(gl, shaderSources.particlesVert(), shaderSources.particles(), 'particles');
    this.progCompose = new Program(gl, v, shaderSources.compose(), 'compose');
    this.progCopy = new Program(gl, v, shaderSources.copy(), 'copy');
    this.progRaster = new Program(gl, v, shaderSources.raster(), 'raster');
    this.progPrefilter = new Program(gl, v, shaderSources.bloom(0), 'bloom-prefilter');
    this.progDown = new Program(gl, v, shaderSources.bloom(1), 'bloom-down');
    this.progUp = new Program(gl, v, shaderSources.bloom(2), 'bloom-up');
    this.progFinal = new Program(gl, v, shaderSources.final(), 'final');
    this.compileReport = [
      this.progTerrain,
      this.progPict,
      this.progParticles,
      this.progCompose,
      this.progCopy,
      this.progRaster,
      this.progPrefilter,
      this.progDown,
      this.progUp,
      this.progFinal,
    ].map((prog) => `${prog.label} ${prog.compileMs.toFixed(0)} ms`);

    // Partículas: un VBO dinámico reutilizado (bufferSubData), sin allocations.
    this.particleVao = gl.createVertexArray()!;
    this.particleVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * PARTICLE_STRIDE * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, PARTICLE_STRIDE * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, PARTICLE_STRIDE * 4, 16);
    gl.bindVertexArray(null);

    const r16f: TexFormat = { internalFormat: gl.R16F, format: gl.RED, type: gl.FLOAT, filter: gl.LINEAR };
    this.fieldTex = createTexture(gl, cols, rows, r16f, new Float32Array(cols * rows).fill(50));
    const r8ui: TexFormat = { internalFormat: gl.R8UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST };
    this.tilesTex = createTexture(gl, SCREEN_TILES_W, SCREEN_TILES_H, r8ui, new Uint8Array(SCREEN_TILES_W * SCREEN_TILES_H));
    this.noiseTex = createNoiseTexture(gl);
    const rg16ui: TexFormat = { internalFormat: gl.RG16UI, format: gl.RG_INTEGER, type: gl.UNSIGNED_SHORT, filter: gl.NEAREST };
    this.semGlyphTex = createTexture(gl, cols, rows, rg16ui);
    this.semFgTex = createTexture(gl, cols, rows, this.fmt.rgba8);
    this.semBgTex = createTexture(gl, cols, rows, this.fmt.rgba8);

    const cellTargets = (label: string): RenderTarget =>
      new RenderTarget(gl, cols, rows, [this.fmt.rgba8, this.fmt.rgba8, this.fmt.rgba8, this.fmt.rgba16fNearest], label);
    this.compose = [cellTargets('compose-a'), cellTargets('compose-b')];
    this.snapshot = cellTargets('snapshot');
    this.timer = new GpuTimer(gl, PASS_LABELS);
  }

  /** Cambia de sala: SDF de islas, tiles para el horneado y paleta de zona. */
  setRoom(room: RoomRender, palette: ZonePaletteGpu): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RED, gl.FLOAT, room.field);
    gl.bindTexture(gl.TEXTURE_2D, this.tilesTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCREEN_TILES_W, SCREEN_TILES_H, gl.RED_INTEGER, gl.UNSIGNED_BYTE, room.tileTex);
    this.palette = palette;
    this.terrainDirty = true;
    this.resetState = true;
  }

  /** Guarda el estado de celda actual como "sala vieja" de una transición. */
  captureSnapshot(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const last = this.compose[(this.frameIndex + 1) & 1];
    this.snapshot.bind();
    gl.bindVertexArray(this.vao);
    const p = this.progCopy;
    p.use();
    bindTex(gl, p, 'uA', 0, last.textures[0]!);
    bindTex(gl, p, 'uB', 1, last.textures[1]!);
    bindTex(gl, p, 'uC', 2, last.textures[2]!);
    bindTex(gl, p, 'uD', 3, last.textures[3]!);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Tamaño del lienzo en píxeles de dispositivo. */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.canvasW && h === this.canvasH && this.atlas) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvasW = w;
    this.canvasH = h;
    const next = computeLayout(w, h, this.cols, this.rows, CELL_ASPECT);
    const prev = this.layout;
    if (!this.atlas || next.cellW !== prev.cellW || next.cellH !== prev.cellH) this.rebuildAtlas(next.cellW, next.cellH);
    if (next.viewW !== prev.viewW || next.viewH !== prev.viewH || !this.scene) {
      this.scene?.dispose();
      // RGBA8 basta: los colores de glifo ya están en [0,1] (el HDR vive en la capa pictórica y el bloom).
      this.scene = new RenderTarget(this.gl, next.viewW, next.viewH, [this.fmt.rgba8Linear], 'scene');
      this.bloomLevels = 0; // se recrea en el próximo render
    }
    this.layout = next;
    this.resetState = true;
  }

  private rebuildAtlas(cellW: number, cellH: number): void {
    const gl = this.gl;
    const atlas = buildAtlas(this.font, cellW, cellH);
    if (atlas.missing.length > 0) {
      console.warn(`[atlas] glifos ausentes en la fuente (se dibujan como '?'): ${atlas.missing.join(' ')}`);
    }
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
    this.atlasTex = createTexture(
      gl,
      atlas.canvas.width,
      atlas.canvas.height,
      { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST },
      atlas.pixels,
    );
    // Rampas finales (orden medido) → textura R16UI: fila = material.
    const maxLen = Math.max(...MATERIALS.map((m) => atlas.ramps[m].length));
    const data = new Uint16Array(maxLen * MATERIALS.length);
    MATERIALS.forEach((m, row) => {
      const ramp = atlas.ramps[m];
      this.rampLen[row] = ramp.length;
      ramp.forEach((g, i) => (data[row * maxLen + i] = g));
    });
    if (this.rampsTex) gl.deleteTexture(this.rampsTex);
    this.rampsTex = createTexture(
      gl,
      maxLen,
      MATERIALS.length,
      { internalFormat: gl.R16UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_SHORT, filter: gl.NEAREST },
      data,
    );
    this.atlas = atlas;
  }

  private ensurePict(samples: number): RenderTarget {
    if (!this.pict || this.pictSamples !== samples) {
      this.pict?.dispose();
      this.terrain?.dispose();
      const w = this.cols * samples;
      const h = this.rows * samples;
      this.pict = new RenderTarget(this.gl, w, h, [this.fmt.rgba16fNearest, this.fmt.rgba8], 'pictorial');
      const t = this.fmt.rgba16fNearest;
      this.terrain = new RenderTarget(this.gl, w, h, [t, t, t], 'terrain');
      this.pictSamples = samples;
      this.resetState = true;
      this.terrainDirty = true;
    }
    return this.pict;
  }

  /** P0: hornea lo estático de la capa pictórica (costa, acantilados, suelo, rocas, árboles). */
  private bakeTerrain(samples: number, octaves: number): void {
    const gl = this.gl;
    const pal = this.palette!;
    const t = this.terrain!;
    t.bind();
    const p = this.progTerrain;
    p.use();
    gl.uniform2f(p.u('uGrid'), this.cols, this.rows);
    gl.uniform1f(p.u('uSamples'), samples);
    gl.uniform1f(p.u('uAspect'), CELL_ASPECT);
    bindTex(gl, p, 'uField', 0, this.fieldTex);
    bindTex(gl, p, 'uTiles', 1, this.tilesTex);
    bindTex(gl, p, 'uNoise', 2, this.noiseTex);
    gl.uniform3fv(p.u('uPal'), pal.surfaceOklab);
    gl.uniform1i(p.u('uOctaves'), octaves);
    gl.uniform1i(p.u('uCliffSteps'), 48);
    gl.uniform1i(p.u('uOne'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.terrainDirty = false;
  }

  private ensureBloom(levels: number): void {
    if (this.bloomLevels === levels && this.bloomDown.length > 0) return;
    for (const t of this.bloomDown) t.dispose();
    for (const t of this.bloomUp) t.dispose();
    this.bloomDown = [];
    this.bloomUp = [];
    let w = this.layout.viewW;
    let h = this.layout.viewH;
    for (let i = 0; i < levels; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      this.bloomDown.push(new RenderTarget(this.gl, w, h, [this.fmt.rgba16f], `bloom-down-${i}`));
      if (i < levels - 1) this.bloomUp.push(new RenderTarget(this.gl, w, h, [this.fmt.rgba16f], `bloom-up-${i}`));
    }
    this.bloomLevels = levels;
  }

  /** Invalida el estado temporal (cambio de sala, de calidad, transición…). */
  resetTemporal(): void {
    this.resetState = true;
  }

  render(f: FrameParams, cells: CellBuffer, s: RenderSettings): void {
    const gl = this.gl;
    const atlas = this.atlas;
    const pal = this.palette;
    if (!atlas || !pal || !this.scene || !this.atlasTex || !this.rampsTex || gl.isContextLost()) return;
    const q = QUALITY_PRESETS[s.quality];
    const pict = this.ensurePict(q.samples);
    this.ensureBloom(q.bloomLevels);
    const L = this.layout;
    const timer = this.timer;
    timer.poll();
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    if (this.terrainDirty) this.bakeTerrain(q.samples, q.octaves);
    const terrain = this.terrain!;

    // Capa semántica → GPU
    gl.bindTexture(gl.TEXTURE_2D, this.semGlyphTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RG_INTEGER, gl.UNSIGNED_SHORT, cells.glyphFlags);
    gl.bindTexture(gl.TEXTURE_2D, this.semFgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, cells.fg);
    gl.bindTexture(gl.TEXTURE_2D, this.semBgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, cells.bg);

    // P1 · pictórica
    timer.begin(0);
    pict.bind();
    let p = this.progPict;
    p.use();
    gl.uniform2f(p.u('uGrid'), this.cols, this.rows);
    gl.uniform1f(p.u('uSamples'), q.samples);
    gl.uniform1f(p.u('uAspect'), CELL_ASPECT); // mapeo mundo↔celda fijo (consistente con la jugabilidad)
    gl.uniform1f(p.u('uTime'), f.time);
    gl.uniform2f(p.u('uCam'), f.camX, f.camY);
    bindTex(gl, p, 'uTerrain', 0, terrain.textures[0]!);
    bindTex(gl, p, 'uSurface', 1, terrain.textures[1]!);
    bindTex(gl, p, 'uExtra', 2, terrain.textures[2]!);
    bindTex(gl, p, 'uNoise', 3, this.noiseTex);
    gl.uniform3fv(p.u('uPal'), pal.surfaceOklab);
    gl.uniform1i(p.u('uLightCount'), f.lightCount);
    if (f.lightCount > 0) {
      gl.uniform4fv(p.u('uLightPos'), f.lightPos, 0, f.lightCount * 4);
      gl.uniform4fv(p.u('uLightCol'), f.lightCol, 0, f.lightCount * 4);
    }
    gl.uniform1i(p.u('uCrystalCount'), f.crystalCount);
    if (f.crystalCount > 0) gl.uniform4fv(p.u('uCrystals'), f.crystals, 0, f.crystalCount * 4);
    gl.uniform4fv(p.u('uShoot'), f.shoot);
    gl.uniform2f(p.u('uShootT'), f.shootIntensity, f.shootLength);
    gl.uniform4fv(p.u('uReflector'), f.reflector);
    gl.uniform3fv(p.u('uReflectorColor'), f.reflectorColor);
    gl.uniform1f(p.u('uAmbient'), f.ambient);
    gl.uniform1f(p.u('uExposure'), f.exposure);
    gl.uniform1f(p.u('uFog'), f.fog);
    gl.uniform1f(p.u('uBreath'), f.breath);
    gl.uniform1i(p.u('uOctaves'), q.octaves);
    gl.uniform1i(p.u('uStarLayers'), 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (f.particleCount > 0) this.drawParticles(f, pict, q.samples);
    timer.end(0);

    // P2 · conversión + composición (ping-pong del estado temporal)
    timer.begin(1);
    const cur = this.compose[this.frameIndex & 1];
    const prev = this.compose[(this.frameIndex + 1) & 1];
    cur.bind();
    p = this.progCompose;
    p.use();
    bindTex(gl, p, 'uPict', 0, pict.textures[0]!);
    bindTex(gl, p, 'uMat', 1, pict.textures[1]!);
    bindTex(gl, p, 'uPrev', 2, prev.textures[3]!);
    bindTex(gl, p, 'uSem', 3, this.semGlyphTex);
    bindTex(gl, p, 'uSemFg', 4, this.semFgTex);
    bindTex(gl, p, 'uSemBg', 5, this.semBgTex);
    bindTex(gl, p, 'uRamps', 6, this.rampsTex);
    bindTex(gl, p, 'uSnapFg', 7, this.snapshot.textures[0]!);
    bindTex(gl, p, 'uSnapBg', 8, this.snapshot.textures[1]!);
    bindTex(gl, p, 'uSnapGlyph', 9, this.snapshot.textures[2]!);
    bindTex(gl, p, 'uSnapState', 10, this.snapshot.textures[3]!);
    gl.uniform1iv(p.u('uRampLen'), this.rampLen);
    gl.uniform1i(p.u('uS'), q.samples);
    gl.uniform1i(p.u('uInk'), s.direction === 'ink' ? 1 : 0);
    const k = s.fidelity ? 1 : 1 - Math.exp(-Math.max(f.dt, 1e-4) / TEMPORAL_TAU);
    gl.uniform1f(p.u('uTemporalK'), k);
    gl.uniform1f(p.u('uHyst'), s.fidelity ? 0 : HYSTERESIS);
    gl.uniform1i(p.u('uReset'), this.resetState ? 1 : 0);
    gl.uniform1i(p.u('uLegibility'), s.legibility ? 1 : 0);
    gl.uniform1f(p.u('uInkGain'), s.fidelity ? 1 : 1.55);
    gl.uniform1f(p.u('uBgFill'), s.fidelity ? 0 : 0.16);
    if (s.fidelity) gl.uniform3f(p.u('uPaper'), 0, 0, 0);
    else gl.uniform3f(p.u('uPaper'), pal.paper[0], pal.paper[1], pal.paper[2]);
    gl.uniform1f(p.u('uClearance'), 0.65);
    gl.uniform1i(p.u('uTransMode'), f.transMode);
    gl.uniform1f(p.u('uTransT'), f.transT);
    gl.uniform2i(p.u('uTransDir'), f.transDirX, f.transDirY);
    gl.uniform1i(p.u('uPlayTop'), HUD_ROWS);
    gl.uniform1i(p.u('uFrame'), this.frameIndex % 100000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    timer.end(1);

    // P3 · glifos a resolución de pantalla
    timer.begin(2);
    this.scene.bind();
    p = this.progRaster;
    p.use();
    bindTex(gl, p, 'uFg', 0, cur.textures[0]!);
    bindTex(gl, p, 'uBg', 1, cur.textures[1]!);
    bindTex(gl, p, 'uGlyph', 2, cur.textures[2]!);
    bindTex(gl, p, 'uAtlas', 3, this.atlasTex);
    gl.uniform2i(p.u('uCellPx'), L.cellW, L.cellH);
    gl.uniform2i(p.u('uGridI'), this.cols, this.rows);
    gl.uniform1i(p.u('uAtlasCols'), atlas.cols);
    gl.uniform2f(p.u('uShake'), f.shakeX, -f.shakeY);
    gl.uniform3f(p.u('uPaper'), pal.paper[0], pal.paper[1], pal.paper[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    timer.end(2);

    // P4 · bloom (filtro dual)
    const bloomTex = this.runBloom(s.post);

    // P5 · final al lienzo
    timer.begin(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvasW, this.canvasH);
    gl.clearColor(pal.paper[0] * 0.6, pal.paper[1] * 0.6, pal.paper[2] * 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const glOffY = this.canvasH - L.offY - L.viewH;
    gl.viewport(L.offX, glOffY, L.viewW, L.viewH);
    p = this.progFinal;
    p.use();
    bindTex(gl, p, 'uScene', 0, this.scene.textures[0]!);
    bindTex(gl, p, 'uBloom', 1, bloomTex);
    gl.uniform2f(p.u('uViewOrigin'), L.offX, glOffY);
    gl.uniform2f(p.u('uViewSize'), L.viewW, L.viewH);
    const scale = L.viewH / 1080;
    gl.uniform1f(p.u('uBloomStrength'), s.post ? 0.9 : 0);
    gl.uniform1f(p.u('uDream'), s.post ? f.dream : 0);
    gl.uniform1f(p.u('uCA'), s.post && !s.reducedEffects ? 1.4 * scale : 0);
    gl.uniform1f(p.u('uVignette'), s.post ? 0.6 : 0);
    gl.uniform3f(p.u('uVignetteTint'), 0.42, 0.38, 0.62);
    gl.uniform1f(p.u('uGrain'), s.post ? 0.04 : 0);
    gl.uniform1f(p.u('uFrame'), this.frameIndex % 4096);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    timer.end(4);

    this.frameIndex++;
    this.resetState = false;
  }

  /** Partículas sobre la capa pictórica: color aditivo y luego material. */
  private drawParticles(f: FrameParams, pict: RenderTarget, samples: number): void {
    const gl = this.gl;
    const p = this.progParticles;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.particles, 0, f.particleCount * PARTICLE_STRIDE);
    gl.bindVertexArray(this.particleVao);
    p.use();
    gl.uniform2f(p.u('uPictSize'), pict.width, pict.height);
    gl.uniform1f(p.u('uSamples'), samples);
    gl.uniform1f(p.u('uAspect'), CELL_ASPECT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawBuffers(DRAW_COLOR_ONLY);
    gl.uniform1i(p.u('uPass'), 0);
    gl.drawArrays(gl.POINTS, 0, f.particleCount);
    gl.disable(gl.BLEND);
    gl.drawBuffers(DRAW_MAT_ONLY);
    gl.uniform1i(p.u('uPass'), 1);
    gl.drawArrays(gl.POINTS, 0, f.particleCount);
    gl.drawBuffers(DRAW_BOTH);
    gl.bindVertexArray(this.vao);
  }

  private runBloom(enabled: boolean): WebGLTexture {
    const gl = this.gl;
    const down = this.bloomDown;
    const up = this.bloomUp;
    if (!enabled) return down[0]!.textures[0]!;
    this.timer.begin(3);
    let p = this.progPrefilter;
    p.use();
    down[0]!.bind();
    bindTex(gl, p, 'uSrc', 0, this.scene!.textures[0]!);
    gl.uniform2f(p.u('uSrcTexel'), 1 / this.layout.viewW, 1 / this.layout.viewH);
    gl.uniform2f(p.u('uDstSize'), down[0]!.width, down[0]!.height);
    gl.uniform1f(p.u('uThreshold'), 0.62);
    gl.uniform1f(p.u('uKnee'), 0.2);
    gl.uniform1f(p.u('uEmissiveBoost'), 1.6);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    p = this.progDown;
    p.use();
    for (let i = 1; i < down.length; i++) {
      const src = down[i - 1]!;
      down[i]!.bind();
      bindTex(gl, p, 'uSrc', 0, src.textures[0]!);
      gl.uniform2f(p.u('uSrcTexel'), 1 / src.width, 1 / src.height);
      gl.uniform2f(p.u('uDstSize'), down[i]!.width, down[i]!.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    p = this.progUp;
    p.use();
    let result = down[down.length - 1]!;
    for (let i = down.length - 2; i >= 0; i--) {
      const dst = up[i]!;
      dst.bind();
      bindTex(gl, p, 'uSrc', 0, result.textures[0]!);
      bindTex(gl, p, 'uAdd', 1, down[i]!.textures[0]!);
      gl.uniform2f(p.u('uSrcTexel'), 1 / result.width, 1 / result.height);
      gl.uniform2f(p.u('uDstSize'), dst.width, dst.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      result = dst;
    }
    this.timer.end(3);
    return result.textures[0]!;
  }

  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    for (const prog of [
      this.progTerrain,
      this.progPict,
      this.progParticles,
      this.progCompose,
      this.progCopy,
      this.progRaster,
      this.progPrefilter,
      this.progDown,
      this.progUp,
      this.progFinal,
    ])
      prog.dispose();
    for (const t of [this.fieldTex, this.tilesTex, this.noiseTex, this.semGlyphTex, this.semFgTex, this.semBgTex, this.atlasTex, this.rampsTex]) {
      if (t) gl.deleteTexture(t);
    }
    for (const rt of [...this.compose, this.snapshot, this.pict, this.terrain, this.scene, ...this.bloomDown, ...this.bloomUp]) {
      rt?.dispose();
    }
    gl.deleteBuffer(this.particleVbo);
    gl.deleteVertexArray(this.particleVao);
    gl.deleteVertexArray(this.vao);
    this.timer.dispose();
  }
}

/**
 * Textura de ruido 256×256 (RGBA8, REPEAT, LINEAR) para gnoise(): R aleatorio y
 * G = R desplazado (−37, −17), de modo que una lectura da dos capas z vecinas.
 */
function createNoiseTexture(gl: GL): WebGLTexture {
  const size = 256;
  const r = new Uint8Array(size * size);
  let h = 0x9e3779b9;
  for (let i = 0; i < r.length; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    r[i] = (h >>> 0) & 255;
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      data[o] = r[y * size + x]!;
      data[o + 1] = r[((y - 17) & 255) * size + ((x - 37) & 255)]!;
      data[o + 3] = 255;
    }
  }
  const tex = createTexture(gl, size, size, { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR }, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

/** Arrays constantes para drawBuffers (evita crear arrays por fotograma). */
const GL_NONE = 0;
const GL_COLOR_ATTACHMENT0 = 0x8ce0;
const GL_COLOR_ATTACHMENT1 = 0x8ce1;
const DRAW_BOTH = [GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1];
const DRAW_COLOR_ONLY = [GL_COLOR_ATTACHMENT0, GL_NONE];
const DRAW_MAT_ONLY = [GL_NONE, GL_COLOR_ATTACHMENT1];
