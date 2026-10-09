/**
 * Overlay de depuración (F3): FPS, tiempos de CPU y de GPU por pasada,
 * geometría de la grilla y los conmutadores de render. Es HTML aparte del
 * lienzo y se actualiza 4 veces por segundo (no en cada fotograma).
 */
import type { GameLoop } from '../core/loop';
import { PASS_LABELS, type RenderSettings, type Renderer } from '../render/renderer';

export class DebugOverlay {
  readonly el: HTMLPreElement;
  visible = false;
  private lastUpdate = 0;
  private frames = 0;
  private fps = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.className = 'debug-overlay';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  /** Llamar una vez por fotograma; solo reescribe el texto cada 250 ms. */
  update(now: number, loop: GameLoop, renderer: Renderer, s: RenderSettings, extra: () => string): void {
    this.frames++;
    if (now - this.lastUpdate < 250) return;
    this.fps = (this.frames * 1000) / (now - this.lastUpdate || 1);
    this.frames = 0;
    this.lastUpdate = now;
    if (!this.visible) return;
    const t = renderer.timer;
    const L = renderer.layout;
    const gpu = t.available
      ? PASS_LABELS.map((label, i) => `${label} ${t.ms[i]!.toFixed(2)}`).join(' · ') +
        ` = ${Array.from(t.ms).reduce((a, b) => a + b, 0).toFixed(2)} ms`
      : 'no disponible (EXT_disjoint_timer_query_webgl2)';
    const on = (b: boolean): string => (b ? 'sí' : 'no');
    this.el.textContent = [
      `FPS ${this.fps.toFixed(1)}   fotograma ${loop.frameMs.toFixed(2)} ms   CPU sim ${loop.simMs.toFixed(3)} ms · render ${loop.renderMs.toFixed(3)} ms`,
      `GPU ${gpu}`,
      `grilla ${renderer.cols}×${renderer.rows} · celda ${L.cellW}×${L.cellH} px · vista ${L.viewW}×${L.viewH} · lienzo ${renderer.canvasW}×${renderer.canvasH} · DPR ${devicePixelRatio.toFixed(2)} · half-float ${on(renderer.halfFloat)}`,
      extra(),
      '',
      `[1] rampa: ${s.direction}   [2] fidelidad repo: ${on(s.fidelity)}   [3] calidad: ${s.quality}   [4] post: ${on(s.post)}   [5] congelar tiempo`,
      `F4 legibilidad: ${on(s.legibility)}   efectos reducidos: ${on(s.reducedEffects)}   [6] derretido   [7] contornos: ${on(s.edges)}`,
    ].join('\n');
  }
}
