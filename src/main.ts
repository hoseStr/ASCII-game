/**
 * Arranque: comprueba WebGL2, carga la fuente local (FontFace + cmap propio),
 * crea el renderer y la escena, y conecta bucle, entrada y depuración.
 */
import './style.css';
import { GRID_COLS, GRID_ROWS, QUALITY_ORDER, SIM_HZ, type Quality } from './config';
import { Input } from './core/input';
import { GameLoop } from './core/loop';
import { CellBuffer } from './render/cellBuffer';
import { Renderer, createFrameParams, type RenderSettings } from './render/renderer';
import { loadGameFont } from './render/fontLoader';
import { Game } from './game';
import { loadStampImages } from './render/stamps';
import { World } from './world/world';
import { DebugOverlay } from './ui/debugOverlay';

function showMessage(root: HTMLElement, title: string, body: string): void {
  const box = document.createElement('div');
  box.className = 'fatal';
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;
  box.append(h, p);
  root.replaceChildren(box);
}

function loadQuality(): Quality {
  try {
    const q = localStorage.getItem('adg.quality');
    if (q === 'low' || q === 'medium' || q === 'high') return q;
  } catch {
    /* almacenamiento no disponible: se usa el valor por defecto */
  }
  return 'medium';
}

function saveQuality(q: Quality): void {
  try {
    localStorage.setItem('adg.quality', q);
  } catch {
    /* el juego funciona igual sin guardar */
  }
}

let bootMs = 0;

async function boot(): Promise<void> {
  const bootStart = performance.now();
  const root = document.getElementById('app')!;
  const canvas = document.createElement('canvas');
  canvas.className = 'screen';
  root.appendChild(canvas);

  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) {
    showMessage(
      root,
      'Este sueño necesita WebGL2',
      'Tu navegador o tu tarjeta gráfica no ofrecen WebGL2. Prueba con una versión reciente de Chrome, Edge o Firefox y con la aceleración por hardware activada.',
    );
    return;
  }
  probe.getExtension('WEBGL_lose_context')?.loseContext();

  const font = await loadGameFont();
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const settings: RenderSettings = {
    direction: 'light',
    fidelity: false,
    legibility: false,
    quality: loadQuality(),
    post: true,
    reducedEffects: reducedMotionQuery.matches,
    edges: true,
  };
  reducedMotionQuery.addEventListener('change', (e) => (settings.reducedEffects = e.matches));

  const world = new World();
  const stampImages = await loadStampImages(world.stamps);
  const cells = new CellBuffer(GRID_COLS, GRID_ROWS);
  const frame = createFrameParams();
  const input = new Input();
  input.attach(window);
  const overlay = new DebugOverlay(root);

  let renderer = new Renderer(canvas, font, GRID_COLS, GRID_ROWS);
  const game = new Game(world, renderer, stampImages);

  // Tamaño exacto en píxeles de dispositivo (texto nítido).
  let pendingW = Math.round(canvas.clientWidth * devicePixelRatio);
  let pendingH = Math.round(canvas.clientHeight * devicePixelRatio);
  const ro = new ResizeObserver((entries) => {
    const e = entries[0]!;
    const box = e.devicePixelContentBoxSize?.[0];
    if (box) {
      pendingW = box.inlineSize;
      pendingH = box.blockSize;
    } else {
      pendingW = Math.round(e.contentRect.width * devicePixelRatio);
      pendingH = Math.round(e.contentRect.height * devicePixelRatio);
    }
  });
  try {
    ro.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    ro.observe(canvas);
  }

  input.onDebugKey = (code) => {
    if (code === 'F3') overlay.toggle();
    else if (code === 'F4') settings.legibility = !settings.legibility;
    else if (!overlay.visible) return;
    else if (code === 'Digit1') settings.direction = settings.direction === 'light' ? 'ink' : 'light';
    else if (code === 'Digit2') settings.fidelity = !settings.fidelity;
    else if (code === 'Digit3') {
      settings.quality = QUALITY_ORDER[(QUALITY_ORDER.indexOf(settings.quality) + 1) % QUALITY_ORDER.length]!;
      saveQuality(settings.quality);
    } else if (code === 'Digit4') settings.post = !settings.post;
    else if (code === 'Digit5') game.freezeTime = !game.freezeTime;
    else if (code === 'Digit6') game.debugMelt();
    else if (code === 'Digit7') settings.edges = !settings.edges;
    renderer.resetTemporal();
  };

  // Se evalúa solo cuando el overlay se redibuja (4 Hz), no en cada fotograma.
  const sceneInfo = (): string =>
    `sala: ${game.room.meta.id} (${game.room.meta.name}) · luces ${frame.lightCount} · partículas ${game.particles.active} · princesa (${game.princess.x.toFixed(1)}, ${game.princess.y.toFixed(1)}) · piezas ${game.room.props.length} (composición ${game.propLayer.lastBuildMs.toFixed(1)} ms)`;

  const loop = new GameLoop(
    {
      step(dt) {
        input.update();
        game.step(dt, input);
      },
      render(alpha, frameSeconds) {
        renderer.resize(pendingW, pendingH);
        if (game.snapshotRequested) {
          renderer.captureSnapshot();
          game.snapshotRequested = false;
        }
        frame.dt = frameSeconds;
        game.fill(frame, cells, alpha, settings);
        renderer.render(frame, cells, settings);
        overlay.update(performance.now(), loop, renderer, settings, sceneInfo);
      },
    },
    SIM_HZ,
  );

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    loop.stop();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    renderer = new Renderer(canvas, font, GRID_COLS, GRID_ROWS);
    game.attachRenderer(renderer);
    loop.start();
  });

  // Gancho para la herramienta de capturas y la depuración manual.
  (window as unknown as { __adg: unknown }).__adg = {
    settings,
    game,
    stats: () => ({
      fps: 1000 / loop.frameMs,
      frameMs: loop.frameMs,
      simMs: loop.simMs,
      renderMs: loop.renderMs,
      gpu: Object.fromEntries(Array.from(renderer.timer.ms, (v, i) => [i, v])),
      gpuAvailable: renderer.timer.available,
      layout: renderer.layout,
      missing: renderer.atlas?.missing ?? [],
      compile: renderer.compileReport,
      propBuildMs: game.propLayer.lastBuildMs,
      bootMs: bootMs,
    }),
    overlay,
  };

  loop.start();
  bootMs = performance.now() - bootStart;
  document.body.dataset.ready = '1';
}

boot().catch((err: unknown) => {
  console.error(err);
  const root = document.getElementById('app');
  if (root) showMessage(root, 'El sueño no pudo empezar', err instanceof Error ? err.message : String(err));
});
