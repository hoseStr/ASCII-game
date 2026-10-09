# Hilo de Sueño *(título provisional)*

Aventura de acción top-down onírica para el navegador, renderizada como un **video ASCII generado en tiempo real**. Hereda el algoritmo de conversión de [ASCII-generator](https://github.com/vietnh1009/ASCII-generator), portado fielmente a TypeScript y GLSL.

> **Estado: Fase 2 (mundo).** Ya puedes recorrer el overworld de 3×3 islas flotantes con la princesa.
> - Cada sala tiene su paleta de zona y se carga desde mapas ASCII.
> - Hay colisiones y transiciones entre pantallas.
> - El combate llega en la Fase 3, y los objetos, la mazmorra y el HUD completo en la Fase 4.

## Cómo ejecutarlo

```bash
npm install
npm run dev        # servidor de desarrollo (http://localhost:5173)
npm run build      # bundle estático en dist/ (sirve en cualquier subruta, p. ej. GitHub Pages)
npm test           # tests unitarios (Vitest)
npm run shots      # capturas de revisión + métricas en shots/ (Playwright + Edge instalado)
```

- **Requisitos:** Node 22.12 o superior y un navegador con WebGL2.
- **`.npmrc`:** el repo incluye `legacy-peer-deps=true`, que esquiva un fallo de npm 10 al resolver los peers opcionales de Vitest.

## Controles

| Tecla | Acción |
|---|---|
| Flechas / WASD (o stick / cruceta del mando) | Mover a la princesa. Son 4 direcciones y manda la última pulsada, como en los Zelda clásicos |
| F3 | Overlay de rendimiento (FPS, tiempos de CPU y de GPU por pasada) |
| F4 | Modo legibilidad: oculta la capa pictórica y muestra la colisión |

Con el overlay F3 abierto se activan estas teclas:

| Tecla | Acción |
|---|---|
| 1 | Sentido de la rampa: `light` o `ink` (el literal del repo) |
| 2 | Modo fidelidad: conversión idéntica al repo |
| 3 | Calidad: baja, media o alta |
| 4 | Post-proceso |
| 5 | Congelar el tiempo |
| 6 | Probar la transición de derretido |
| 7 | Contornos de tinta sí/no |

La página de depuración del atlas está en `/debug/atlas.html`.

## El mundo

El overworld tiene 9 salas en una cuadrícula de 3×3, cada una con su paleta de zona:

| | Oeste | Centro | Este |
|---|---|---|---|
| **Norte** | Jardín de Cristal · *jardín* | Escalinata Lunar · *ruinas* | Umbral del Santuario · *umbral* |
| **Centro** | Bosque Hondo · *bosque hondo* | **Claro de las Luciérnagas** (inicio) · *bosque* | Orilla de los Espejos · *lago* |
| **Sur** | Raíces Colgantes · *bosque hondo* | Puente de Niebla · *niebla* | Lago de los Espejos · *lago* |

Los tests garantizan tres propiedades del mundo:

- Las salidas entre salas vecinas son simétricas y coinciden tile a tile, así que nunca se aparece dentro de un muro.
- El borde exterior del mundo es cerrado.
- Todas las salas se alcanzan caminando desde el inicio.

### Cómo crear una sala nueva

1. **Dibuja el mapa** en `src/data/rooms/<id>.txt`: 16 líneas de 32 caracteres. Cada carácter es un tile de 5×3 celdas, visualmente cuadrado.

   | Carácter | Tile | ¿Caminable? | Se pinta en |
   |---|---|---|---|
   | `.` | vacío (abismo con estrellas) | no | capa pictórica |
   | `,` | suelo | sí | capa pictórica |
   | `:` | camino | sí | capa pictórica |
   | `"` | flores | sí | capa pictórica |
   | `#` | roca (bloque en vista 3/4) | no | capa pictórica |
   | `T` | árbol (copa, tronco y sombra) | no | capa pictórica |
   | `~` | agua (refleja el cielo y las luces) | no | capa pictórica |
   | `*` | cristal (emite luz) | no | capa pictórica |
   | `=` | puente este-oeste | sí | capa semántica |
   | `H` | puente norte-sur | sí | capa semántica |

   La leyenda está en `src/data/legend.json`.

2. **Escribe los metadatos** en `src/data/rooms/<id>.json`:
   ```json
   { "id": "ow-1-1", "name": "Claro de las Luciérnagas", "zone": "forest", "map": "ow-1-1.txt", "fireflies": 26 }
   ```
   `zone` es una paleta de `src/data/palettes.json`, definida en OKLCH.

3. **Colócala** en la cuadrícula de `src/data/world.json`.
4. **Conéctala.** Las salidas se deducen solas: si dos salas son vecinas y sus bordes tienen tiles caminables en las mismas posiciones, hay paso. Usa `=` o `H` para tender un puente sobre el vacío hasta el borde.
5. **Valídala** con `npm test`, que comprueba tamaño, leyenda, simetría de bordes y alcanzabilidad.

### Sprites

Los sprites son texto: `src/data/sprites/princess.txt` y `princess.json`.

- Cada fotograma tiene una capa de glifos y una capa de claves de color. La clave `.` deja la celda transparente.
- Las claves se definen en el JSON, en OKLCH, con fondo y emisión opcionales.
- La vista izquierda se genera espejando la derecha.
- Los glifos de entidades salen de un conjunto reservado que el decorado nunca usa. Un test lo verifica.

## Piezas de escenario: fotos convertidas a ASCII

El repositorio original convierte fotos y video en texto, y el juego hace lo mismo con su escenario.

- **Qué son.** Rocas con musgo, amanitas, helechos, tocones, troncos, nenúfares, columnas antiguas y azaleas parten de **fotos reales en dominio público o CC0**.
- **Cómo se pintan.** Se convierten a ASCII **tal cual**, exactamente como hacía el repo con sus imágenes. Cada celda toma el color real de la foto (el promedio de su bloque de píxeles) y el glifo sale de `min(floor(media·N/255), N−1)` en la rampa de 70 caracteres. No llevan tinte de zona, luz, niebla, respiración, contornos, bloom ni post-proceso: la pieza se ve como la foto.
- **Bordes.** El único borde de una pieza es el contorno de su imagen recortada. No se añaden líneas, marcos, sombras ni cajas de fondo: detrás de los glifos de la pieza se ve el mismo fondo que en el resto de la sala.
- **Rocas `#`.** Se descomponen en rectángulos de hasta 3×2 tiles. Cada uno muestra una foto de roca **recortada** (roca con musgo, granito o peña), estirada a su rectángulo y convertida igual. La colisión sigue siendo por tile, pero en el render esos tiles ya no se pintan como roca procedural, sin el contorno ni el recorte por tile de las demás rocas.
- **Excepción al brief.** El brief original decía "no uses imágenes externas"; esta mejora lo cambia a propósito.
  - Solo se aceptan fotos CC0 o de dominio público, con la licencia verificada en la página de origen.
  - Cada foto queda registrada en `art/manifest.json` y acreditada en THIRD_PARTY_NOTICES.

En el juego:

- **Colocación.** Las piezas se colocan desde el JSON de la sala, en la clave `props`.
- **Colisión.** Las piezas sólidas bloquean según su **huella**, que se calcula por tile a partir del alfa de la foto. Las que se ven altas (columna, setas, tocón) solo bloquean por la base.
- **Piezas decorativas.** El helecho y los nenúfares no bloquean.
- **Fidelidad comprobada.** `npm run verify:stamps` lee de la GPU el glifo y el color de todas las celdas cubiertas por piezas (fotos y rocas) en las 9 salas y los compara con el algoritmo del repo calculado en CPU. Tienen que coincidir al byte, y coinciden. Todo el cálculo es entero (bytes de la foto), así que no hay diferencias de redondeo entre CPU y GPU.
- **Depuración.** La página `/debug/stamps.html` muestra cada estampa: la imagen procesada, la pieza tal como se ve en el juego y la conversión literal del repo en texto.

### Cómo añadir una imagen al escenario

1. **Busca** una foto CC0 o de dominio público. Lo más fácil es un sujeto que se separe bien del fondo.
   ```bash
   python -P tools/find_images.py "mossy boulder"            # Openverse, solo cc0/pdm
   python -P tools/find_images.py "fern" --source commons    # Wikimedia Commons
   ```
2. **Verifica la licencia** en la página de la foto. Guárdala en `art/sources/<id>.jpg` (1024 px como máximo) y añádela a `art/manifest.json` con su título, autor, URL y licencia (`CC0-1.0` o `PDM-1.0`).
3. **Define la estampa** en `art/stamps.json`:
   - `rect`: el sujeto, en coordenadas de 0 a 1;
   - `mode`: `grabcut` o `key-dark` para fondo negro;
   - `use`: `prop` (pieza colocada a mano) o `rockfill` (variante de foto para las rocas `#`);
   - `sizeTiles`, `solid`, `collision` (`alpha` o `base`);
   - opcionales: `fg` y `bg`, rectángulos de sujeto o fondo seguros que guían a GrabCut.
4. **Procésala:**
   ```bash
   python -m venv .cache/venv-tools && .cache/venv-tools/Scripts/python -m pip install -r tools/requirements.txt   # una vez
   .cache/venv-tools/Scripts/python -P tools/make_stamps.py
   ```
   El script genera:
   - `src/assets/stamps/<id>.png`;
   - `src/data/stamps/<id>.json`, con la huella y los créditos;
   - la vista previa literal del repo;
   - la sección de créditos;
   - una hoja de revisión en `shots/stamps-contact.png`.
5. **Colócala** en una sala: `"props": [{ "stamp": "<id>", "tile": [x, y], "flip": false }]`, con `tile` como esquina superior izquierda.
6. **Valida** con `npm test` y `npm run verify:stamps`. Los tests comprueban:
   - licencias, tamaños y huellas;
   - que el port de TypeScript reproduce al 100 % la vista previa literal del repo;
   - que cada celda opaca usa exactamente la fórmula del repo (media del bloque) y el color real;
   - que la huella cae sobre suelo;
   - que ninguna sala queda bloqueada.

## Arquitectura del render

```
 Input ─► Simulación 60 Hz fija (seed) ─► sala actual, princesa, partículas, transición
                                              │ (interpolado al render)
            ┌─────────────────────────────────┴──────────────────────────────┐
            ▼                                                                ▼
  Capa semántica (CPU, typed arrays)                 Uniforms: luces (≤48), cristales, cámara,
  puentes · princesa · HUD (y colisión en F4)        estrella fugaz, reflejo; partículas (VBO)
            │                                                                │
            │   P0 TERRENO (solo al cambiar de sala, paleta o calidad): desde el tilemap
            │      → costa deshilachada, acantilados en cono, caminos, flores, orillas,
            │        rocas 3/4, árboles con sombra → texturas estáticas
            │                                                                ▼
            │   P1 PICTÓRICA a S×S muestras/celda: cielo con parallax, luz, agua animada
            │      (refleja estrellas, luces y a la princesa), niebla fbm, respiración
            │      + partículas pintadas como luz (estela de polvo de estrellas)
            ▼                                                                ▼  promedio de bloque (= repo)
  P2 CONVERSIÓN + COMPOSICIÓN @160×54: luma (R+G+B)/3 → EMA + histéresis → rampa[material]
     → glifo · semántica encima · despeje alrededor de entidades
     · transiciones: deslizamiento con glifos que se desordenan / derretido (instantánea t−1)
            ▼
  P3 GLIFOS (atlas a píxel exacto) → P4 BLOOM filtro dual → P5 FINAL (viñeta, aberración, grano)
```

### Reparto entre capas

- **Piezas de escenario:** sus bytes reales se componen en CPU una vez por sala, en una capa de 4 muestras por celda (textura `RGBA8UI`). En la conversión (P2), esas celdas aplican el algoritmo del repo directamente sobre la foto y saltan la capa pictórica, los contornos y la histéresis. También quedan fuera del bloom, la viñeta, la aberración y el grano.

- **Capa pictórica:** todo el terreno natural, incluidos los obstáculos (rocas, árboles, agua, vacío). Así recibe la luz dinámica, y la Linterna Lunar de la Fase 4 podrá revelar zonas oscuras.
- **Capa semántica:** estructuras construidas (puentes), entidades y HUD.
- **Modo F4:** dibuja el tilemap de colisión, para comprobar la jugabilidad sin la capa pictórica.

### Legibilidad: contornos de tinta

- **Obstáculos con contorno.** Rocas, árboles, agua y cristales llevan un contorno de una celda de grosor (`─ │ / \`), orientado según el borde y más brillante que su relleno.
  - Las formas se calculan con un SDF por región de tiles, así que el contorno coincide con la colisión.
  - Los tiles contiguos del mismo tipo forman una sola masa (un bosque, un lago), sin costuras internas.
- **Costa con línea suave.** La costa de cada isla lleva una línea más tenue, que se interrumpe en la entrada de los puentes.
- **Caminos.** Tienen color cálido y claro, borde limpio y un margen oscuro en el suelo vecino.
- **Pasto distinto del follaje.** El pasto usa marcas finas (`. , ' ;`) y las copas de los árboles, follaje denso (`τ ↟ ♠ ♣ ψ`), así que el suelo nunca parece bosque.

### Rampas por material

Se ordenan por tinta medida, salvo la del repo y la de luz, que conservan el orden de autor.

| Material | Rampa |
|---|---|
| roca y acantilado | la del repo, letras |
| luz | `˙ · ∘ ✧ ✦` |
| niebla | `. · ∴ ░ ▒ ▓` |
| agua | `. ~ ∽ ≈` |
| pasto (suelo) | `. , ' ; ʎ γ` |
| follaje (copas, obstáculo) | `· τ ↟ ♠ ♣ ψ Ψ` |
| cristal | `· ◦ △ ◊ ◇ ♦ ◈ ◆ ▲` |
| flores | `. · ⚘ ✾ ✿ ❀` |
| caminos | `. · ∶ : ∴ ∷` |

### Ruido por textura

El ruido es de valor, leído de una textura de 256×256 (el truco de iq para 3D): una lectura por octava. El ruido de gradiente original tardaba **7 s en compilar** en D3D11 (ANGLE); este tarda 5 ms.

## Rendimiento medido

Mediciones en una **Intel UHD Graphics integrada** (Alder Lake, D3D11) con Microsoft Edge, a 1920×1080 en calidad media, con tiempos de GPU de `EXT_disjoint_timer_query_webgl2`:

| Pasada | ms |
|---|---|
| Pictórica | 0,9–1,2 |
| Conversión (con contornos) | 0,12–0,2 |
| Glifos | 0,6–1,8 |
| Bloom | 1,1–2,0 |
| Final | 1,7–2,7 |
| **Total GPU** | **6,6–7,2** |

- **Fotogramas:** 60 fps estables en las 9 salas y durante las transiciones. La variación del total sigue a la frecuencia dinámica de la GPU integrada.
- **1366×768:** unos 4,1 ms de GPU.
- **Arranque:** unos 80–230 ms, incluida la decodificación de las 12 estampas. Los 10 programas compilan en unos 25 ms.
- **Piezas de escenario:** la composición de la capa al entrar en una sala tarda 0,6–3 ms en caliente; ocurre solo al cambiar de sala. Con piezas, la GPU sigue en 5,7–7,1 ms por fotograma a 1080p.
- **CPU:** 0,05 ms de simulación y 0,3–0,6 ms de preparación del render por fotograma.
- **Cero allocations en el bucle caliente:** el heap JS crece 0 bytes/s, medido por `npm run shots`.

## Estructura

```
src/
  config.ts              grilla, presets de calidad
  game.ts                orquestador: sala actual, princesa, transiciones, relleno del fotograma
  core/                  bucle de paso fijo, entrada (teclado + mando, 4 direcciones), RNG con semilla
  render/                port del conversor, atlas, paletas OKLab, sprites, renderer y shaders
  world/                 tiles y leyenda, salas, mundo, colisión AABB, transiciones, puentes
  entities/princess.ts   la princesa
  systems/               partículas (pool), luciérnagas, cielo, luz en CPU
  ui/                    HUD, overlay F3
  data/                  salas (.txt + .json), mundo, leyenda, paletas, sprites, estampas (generadas)
  assets/stamps/         estampas procesadas (PNG de 4 muestras por celda)
art/                     fotos originales (CC0 / dominio público), manifiesto de licencias y definición de estampas
tests/                   fidelidad dorada, fuente, legibilidad, núcleo, layout, mundo, colisión, sistemas, estampas
tools/                   make_golden.py (fixtures), make_stamps.py y find_images.py (estampas), screenshot.mjs (capturas)
```

## Licencias

El código del juego y los recursos de terceros se detallan en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
