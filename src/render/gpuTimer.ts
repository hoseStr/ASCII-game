/**
 * Tiempos de GPU por pasada con EXT_disjoint_timer_query_webgl2.
 * Las consultas son asíncronas: cada pasada tiene un anillo de consultas y el
 * resultado llega unos fotogramas después. Firefox normalmente no expone la
 * extensión: en ese caso `available` es false y el overlay muestra solo CPU.
 */
import type { GL } from './gl';

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

const RING = 4;

export class GpuTimer {
  readonly available: boolean;
  /** media exponencial en ms por pasada */
  readonly ms: Float64Array;
  private readonly ext: TimerExt | null;
  private readonly queries: (WebGLQuery | null)[];
  private readonly pending: Uint8Array;
  private readonly cursor: Uint8Array;
  private active = -1;

  constructor(
    private readonly gl: GL,
    readonly labels: readonly string[],
  ) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    this.available = this.ext !== null;
    const n = labels.length;
    this.ms = new Float64Array(n);
    this.queries = new Array(n * RING).fill(null);
    this.pending = new Uint8Array(n * RING);
    this.cursor = new Uint8Array(n);
    if (this.available) for (let i = 0; i < n * RING; i++) this.queries[i] = gl.createQuery();
  }

  begin(pass: number): void {
    if (!this.ext || this.active >= 0) return;
    const slot = pass * RING + this.cursor[pass]!;
    if (this.pending[slot]) return; // anillo lleno: se salta esta medición
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.queries[slot]!);
    this.active = slot;
  }

  end(pass: number): void {
    if (!this.ext || this.active < 0) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending[this.active] = 1;
    this.cursor[pass] = (this.cursor[pass]! + 1) % RING;
    this.active = -1;
  }

  /** Recoge resultados disponibles; llamar una vez por fotograma. */
  poll(): void {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    for (let i = 0; i < this.queries.length; i++) {
      if (!this.pending[i]) continue;
      const q = this.queries[i]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      this.pending[i] = 0;
      if (disjoint) continue;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      const pass = Math.floor(i / RING);
      this.ms[pass] = this.ms[pass]! * 0.9 + (ns / 1e6) * 0.1;
    }
  }

  dispose(): void {
    for (const q of this.queries) if (q) this.gl.deleteQuery(q);
  }
}
