# Hilo de Sueño *(título provisional)*

Aventura de acción top-down onírica para el navegador, renderizada como un **video ASCII generado en tiempo real**. Hereda el algoritmo de conversión de [ASCII-generator](https://github.com/vietnh1009/ASCII-generator), portado fielmente a TypeScript y GLSL.

> **Estado: Fase 1 (motor de render).** De momento el juego es una demo: una isla flotante con niebla, luciérnagas, cristales, vacío estelar y un halo de luz que se mueve con las flechas. La jugabilidad llega en las fases 2 a 4.

## Cómo ejecutarlo

```bash
npm install
npm run dev        # servidor de desarrollo (http://localhost:5173)
npm run build      # bundle estático en dist/ (sirve en cualquier subruta, p. ej. GitHub Pages)
npm test           # tests unitarios (Vitest)
npm run shots      # capturas de revisión + métricas en shots/ (Playwright + Edge instalado)
```

Requisitos: Node 22.12 o superior y un navegador con WebGL2. El repo incluye un `.npmrc` con `legacy-peer-deps=true`, que esquiva un fallo de npm 10 al resolver los peers opcionales de Vitest.

## Controles (demo de la Fase 1)

| Tecla | Acción |
|---|---|
| Flechas / WASD (o stick / cruceta del mando) | Mover el halo de luz |
| F3 | Overlay de rendimiento (FPS, tiempos de CPU y GPU por pasada) |
| F4 | Modo legibilidad: oculta la capa pictórica |

Con el overlay F3 abierto se activan estas teclas:

| Tecla | Acción |
|---|---|
| 1 | Sentido de la rampa: `light` (por defecto) o `ink` (literal del repo) |
| 2 | Modo fidelidad: conversión idéntica al repo, sin suavizado ni realces |
| 3 | Calidad: baja, media o alta (se guarda en `localStorage`) |
| 4 | Post-proceso sí/no |
| 5 | Congelar el tiempo |

La página de depuración del atlas está en `/debug/atlas.html`. Muestra todos los glifos, su tinta medida, los encajes y las rampas por material.

## El algoritmo heredado del repo

Este algoritmo está verificado con tests dorados contra la salida real de `img2txt.py`. Los fixtures se generan con `tools/make_golden.py`, que ejecuta el script original sin modificarlo.

- **Celda de muestreo:** `ancho = W / columnas` y `alto = 2 · ancho`. Se promedian **todos** los píxeles del bloque.
- **Luminancia:** `(R + G + B) / 3` sin pesos sobre sRGB, en la versión a color. La versión en gris usa la BT.601 de OpenCV, que en OpenCV 4 trabaja en punto fijo de 15 bits.
- **Índice:** `min(floor(L · N / 255), N − 1)`.
- **Rampa:** la de Paul Bourke, con 70 glifos, de más tinta a vacío.
- **Color:** el glifo toma el promedio del bloque.

### Lo que el juego añade

Todos estos añadidos se desactivan con el modo fidelidad, salvo el sentido de rampa, que tiene su propio toggle:

- **Sentido de rampa `light`:** con fondo oscuro, más luz da glifos más densos. En el repo, el blanco puro era un espacio.
- **Rampas por material:** luz, niebla, agua, vegetación y cristal. Las de textura se ordenan por tinta medida, con un port corregido de `sort_chars`.
- **Estabilidad temporal:** cada celda suaviza su luminancia (EMA) y aplica histéresis contra el fotograma anterior, para que los glifos no parpadeen en los umbrales.
- **Corrección de aspecto:** el repo muestreaba celdas 1:2 pero dibujaba celdas 3:5, así que su salida salía estirada un 20–26 %. Aquí los círculos son círculos.

## Arquitectura del render

```
 Input ─► Simulación 60 Hz fija (seed) ─► estado del mundo
                                              │ (interpolado al render)
            ┌─────────────────────────────────┴───────────────────────┐
            ▼                                                         ▼
  Capa semántica (CPU, typed arrays)          Uniforms: cámara, luces (≤48), cristales,
  glyph u16 · flags · fg rgba8 · bg rgba8       estrella fugaz · SDF de islas (por sala)
            │                                                         │
            │      P0 TERRENO (solo al cambiar sala/paleta/calidad): costa deshilachada,
            │         acantilados en cono, albedo del suelo → texturas estáticas
            │                                                         ▼
            │      P1 PICTÓRICA a S×S muestras/celda: vacío estelar + parallax, luz,
            │         luciérnagas, cristales, niebla fbm, respiración → color + material
            ▼                                                         ▼  promedio de bloque (= repo)
  P2 CONVERSIÓN + COMPOSICIÓN @160×54: luma (R+G+B)/3 → EMA + histéresis (estado t−1)
     → rampa[material] → glifo · capa semántica encima · despeje alrededor de entidades
            ▼  estado de celda (glifo, fg, bg, emisivo)
  P3 GLIFOS a resolución de pantalla (atlas a píxel exacto, celdas de tamaño entero)
            ▼
  P4 BLOOM filtro dual (½ · ¼ · ⅛ · 1/16)  →  P5 FINAL: viñeta índigo, aberración radial
                                                 sutil, grano fino, desenfoque onírico
```

### Decisiones clave

- **Grilla:** fija de 160×54 celdas con proporción 3:5. A 1080p cada celda mide 12×20 px; a 1366×768, 8×14 px con letterbox.
- **Atlas:** se re-rasteriza al tamaño exacto de la celda en píxeles de dispositivo, para que el texto quede nítido.
- **Glifos especiales:** bloques y líneas de caja se dibujan a mano. Los glifos que se salen de la celda se escalan para caber.
- **Glifos ausentes:** el atlas consulta el `cmap` de la fuente con un parser propio, así que el navegador nunca sustituye la fuente en silencio.
- **Movimiento:** los glifos se ajustan a la celda, mientras luces, halos y estelas se mueven de forma continua en la capa pictórica.
- **Mundo:** se mide en unidades visuales isótropas (1 unidad = alto de fila; una columna = 0,6 unidades).

## Rendimiento medido

Mediciones en una **Intel UHD Graphics integrada** (Alder Lake, D3D11) con Microsoft Edge, con tiempos de GPU de `EXT_disjoint_timer_query_webgl2`:

| Resolución · calidad | Pictórica | Conversión | Glifos | Bloom | Final | **Total GPU** | FPS |
|---|---|---|---|---|---|---|---|
| 1920×1080 · media (S=2) | 0,9–1,4 | 0,05 | 0,5–1,0 | 1,0–1,25 | 1,6–1,85 | **4,1–5,5 ms** | 60 |
| 1920×1080 · alta (S=4) | 2,3 | 0,10 | 0,54 | 1,03 | 1,59 | **5,6 ms** | 60 |
| 1366×768 · media | 1,7 | 0,10 | 0,74 | 0,74 | 1,11 | **4,4 ms** | 60 |

- **CPU:** la simulación tarda unos 0,05 ms por paso y la preparación del render, unos 0,3 ms por fotograma.
- **Cero allocations en el bucle caliente:** el heap JS crece 0 bytes/s en reposo (lo mide `npm run shots`).

## Estructura

```
src/
  config.ts              grilla, presets de calidad
  core/                  bucle de paso fijo, entrada (teclado + mando), RNG con semilla
  render/
    ascii.ts             port fiel del conversor del repo (puro, testeado)
    ttf.ts               lector de cmap/hmtx (verificación de glifos)
    glyphs.ts            rampas por material, glifos reservados, registro del atlas
    atlas.ts             rasterizado del atlas + tinta medida + encaje
    palette.ts           OKLab / OKLCH ↔ sRGB con mapeo de gamut
    zonePalette.ts       paletas de zona (datos) → uniforms
    field.ts             SDF anisótropo exacto + suavizado
    renderer.ts          orquesta las pasadas, FBOs, tiempos de GPU
    shaders/*.glsl       terreno, pictórica, composición, glifos, bloom, final
  scenes/islandDemo.ts   demo de la Fase 1
  ui/debugOverlay.ts     overlay F3
  debug/atlasPage.ts     página /debug/atlas.html
  data/palettes.json     paletas por zona en OKLCH
tests/                   Vitest: fidelidad dorada, fuente, legibilidad, núcleo, layout
tools/                   make_golden.py (fixtures), screenshot.mjs (capturas + métricas)
```

## Licencias

El código del juego y los recursos de terceros se detallan en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
