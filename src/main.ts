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
import { loadZonePalette } from './render/zonePalette';
import { IslandDemo } from './scenes/islandDemo';
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

async function boot(): Promise<void> {
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
  };
  reducedMotionQuery.addEventListener('change', (e) => (settings.reducedEffects = e.matches));

  const palette = loadZonePalette('forest');
  const scene = new IslandDemo();
  const cells = new CellBuffer(GRID_COLS, GRID_ROWS);
  const frame = createFrameParams();
  const input = new Input();
  input.attach(window);
  const overlay = new DebugOverlay(root);

  let renderer = createRenderer();
  function createRenderer(): Renderer {
    const r = new Renderer(canvas, font, GRID_COLS, GRID_ROWS);
    r.setPalette(palette);
    r.setField(scene.field);
    return r;
  }

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
    else if (code === 'Digit5') scene.freezeTime = !scene.freezeTime;
    renderer.resetTemporal();
  };

  // Se evalúa solo cuando el overlay se redibuja (4 Hz), no en cada fotograma.
  const sceneInfo = (): string => `escena: isla de prueba · luces ${frame.lightCount} · luciérnagas ${scene.activeFireflies}`;

  const loop = new GameLoop(
    {
      step(dt) {
        input.update();
        scene.step(dt, input);
      },
      render(alpha, frameSeconds) {
        renderer.resize(pendingW, pendingH);
        frame.dt = frameSeconds;
        scene.fill(frame, cells, palette, alpha, settings.reducedEffects);
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
    renderer = createRenderer();
    loop.start();
  });

  // Gancho para la herramienta de capturas y la depuración manual.
  (window as unknown as { __adg: unknown }).__adg = {
    settings,
    scene,
    stats: () => ({
      fps: 1000 / loop.frameMs,
      frameMs: loop.frameMs,
      simMs: loop.simMs,
      renderMs: loop.renderMs,
      gpu: Object.fromEntries(Array.from(renderer.timer.ms, (v, i) => [i, v])),
      gpuAvailable: renderer.timer.available,
      layout: renderer.layout,
      missing: renderer.atlas?.missing ?? [],
    }),
    overlay,
  };

  loop.start();
  document.body.dataset.ready = '1';
}

boot().catch((err: unknown) => {
  console.error(err);
  const root = document.getElementById('app');
  if (root) showMessage(root, 'El sueño no pudo empezar', err instanceof Error ? err.message : String(err));
});
