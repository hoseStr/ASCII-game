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
5. **Compón el decorado** siguiendo [la guía de composición](docs/composicion.md):
   - una pieza héroe por sala, marcada con `"hero": true`;
   - grupos, no dispersión;
   - todo anclado al terreno;
   - caminos y salidas despejados;
   - simetría solo en lo construido.
6. **Valídala** con `npm test`. Comprueba:
   - tamaño, leyenda, simetría de bordes y alcanzabilidad;
   - las reglas medibles de la composición: nada en el vacío, sin rocas sueltas, un héroe, caminos y salidas libres, sala cruzable.

### Sprites

Los sprites son texto: `src/data/sprites/princess.txt` y `princess.json`.

- Cada fotograma tiene una capa de glifos y una capa de claves de color. La clave `.` deja la celda transparente.
- Las claves se definen en el JSON, en OKLCH, con fondo y emisión opcionales.
- La vista izquierda se genera espejando la derecha.
- Los glifos de entidades salen de un conjunto reservado que el decorado nunca usa. Un test lo verifica.

## Piezas de escenario: modelos 3D convertidos a ASCII

El repositorio original convierte fotos y video en texto, y el juego hace lo mismo con su escenario.

- **Qué son.** Rocas, helechos, plantas tropicales, flores, plantas flotantes del lago, un busto de mármol y una estatua gótica.
  - Todas son **modelos 3D fotoescaneados** de [Poly Haven](https://polyhaven.com) (CC0).
  - Se fotografían en un estudio de render propio, con la misma cámara y la misma luz que el juego. Ver [Estudio de render](#estudio-de-render).
- **Cómo se pintan.** Cada celda toma el **color real** de la imagen y un glifo de la **rampa de 70 caracteres del repo**:
  - **Zonas lisas** (celda entera dentro de la silueta, sin detalle): el glifo del repo tal cual, `min(floor(L·N/255), N−1)`.
  - **Bordes y detalles:** el glifo de la misma rampa cuya **forma** se parece más a la celda. El borde de arriba de una roca sale con `_`, el de abajo con `"`, un tallo con `|` y un brillo pequeño con `,`.
    - La forma se compara en una rejilla de 3×5 regiones: la tinta de cada región (brillo × alfa) frente a la cobertura de cada glifo.
    - La cobertura se mide en la fuente del juego con la misma disposición que el atlas (`src/data/glyphShapes.json`).
  - **Color mínimo:** el color nunca baja de un brillo mínimo (conservando el tono), así la cara en sombra no desaparece en la noche.
  - **Fondo de la silueta:** dentro de la silueta, el fondo de la celda toma un **velo tenue del propio color** de la pieza, así se lee como una forma y no como letras sueltas. Se desactiva con la tecla 8 del panel F3.
  - Sin tinte de zona, luz, niebla, respiración, contornos, bloom ni post-proceso.
- **Revelado.** Antes de convertirla, `make_stamps.py` revela la imagen como se revelaría una foto, con los mismos ajustes en todos los fotogramas:
  - niveles automáticos;
  - contraste local de la forma, a unas 1 celda;
  - sombras algo más abiertas;
  - un poco más de saturación.
- **Bordes.** El único borde de una pieza es el contorno de su imagen: no se añaden líneas, marcos ni cajas.
- **Rocas `#`.** Se descomponen en rectángulos de hasta 3×2 tiles. Cada uno muestra una roca renderizada **recortada**, estirada a su rectángulo y convertida igual.
  - Hay 14 variantes. Cada zona usa las suyas: rocas con musgo en el bosque, la niebla y el lago, y peñas cálidas en las ruinas. El umbral mezcla ambas.
  - Entre las variantes de proporción parecida se elige por hash, así que las rocas vecinas no se repiten.
  - La colisión sigue siendo por tile, pero en el render esos tiles ya no se pintan como roca procedural, sin el contorno ni el recorte por tile de las demás rocas.
- **Excepción al brief.** El brief original decía "no uses imágenes externas"; esta mejora lo cambia a propósito.
  - Solo se aceptan modelos CC0, con la licencia verificada en su página.
  - Cada modelo queda registrado en `art/manifest.json` y acreditado en THIRD_PARTY_NOTICES.

En el juego:

- **Colocación.** Las piezas se colocan desde el JSON de la sala, en la clave `props`.
- **Colisión.** Las piezas sólidas bloquean según su **huella**, que se calcula por tile a partir del alfa de la imagen.
  - Las rocas bloquean por su silueta.
  - Las plantas, el busto y la estatua solo bloquean por la base.
- **Piezas decorativas.** Los helechos, las gazanias y las plantas del lago no bloquean.
- **Sombras.** Cada objeto (piezas y rocas) deja su **sombra real**, calculada por el render con un plano *shadow catcher*.
  - La luz viene de arriba a la izquierda, como en los árboles, así que la sombra cae hacia abajo a la derecha.
  - Una pieza en espejo proyecta su silueta, porque la sombra del render caería al lado contrario.
  - La sombra oscurece el suelo (glifos y fondo de celda) y nunca la pieza.
- **Animación.** Las plantas se mecen con el viento: 12 fotogramas renderizados en bucle, con la base fija y una ráfaga que recorre la planta de izquierda a derecha.
  - Cada fotograma se convierte con el mismo algoritmo que una imagen fija.
  - Cada pieza lleva una fase según su posición, así que dos plantas iguales no se mueven al unísono.
  - Al cambiar de fotograma solo se recomponen, se reconvierten y se suben a la GPU las celdas de esa pieza, sin allocations.
  - Con "efectos reducidos" las piezas quedan quietas en el fotograma 0.
- **Profundidad.** Si la princesa está más al norte que la base de un objeto, el objeto la tapa: puede pasar por detrás de la estatua o de una planta y asomar por un lado. Cada celda de entidad lleva la fila de sus pies en los flags, y cada celda de pieza, la fila de su base. Una sombra suave bajo los pies asienta a la princesa en el suelo.
- **Comprobado.** `npm run verify:stamps` hace dos comprobaciones:
  - que la tabla de formas coincide con los glifos del atlas real;
  - que el glifo y el color que dibuja la GPU en cada celda de pieza son, al byte, los que calculó la CPU, en las 9 salas y en tres instantes por sala (así cubre también los fotogramas animados).
- **Depuración.** La página `/debug/stamps.html` muestra cada estampa:
  - la imagen revelada;
  - la pieza tal como se ve en el juego (las animadas, en bucle);
  - la conversión literal del repo, en texto, como referencia.

### Estudio de render

Un modelo fotoescaneado tiene textura de foto, pero además da control total sobre el ángulo, la luz, la escala, la sombra y el movimiento.

`tools/render_studio.py` se ejecuta **dentro de Blender** (4.x, Cycles) y fotografía el modelo como el juego mira su mundo:

- **Cámara.** Ortográfica, en 3/4 (50° sobre el horizonte), mirando al norte.
- **Luz.** Sol desde arriba a la izquierda de la pantalla, con cielo de relleno y exposición de día. Lleva además dos luces sin sombra, para que la forma se lea en ASCII sin cambiar la sombra del suelo:
  - **relleno** (`--fill`), de frente, que abre la cara en sombra;
  - **contorno** (`--rim`), desde atrás, que perfila la silueta.
- **Escala.** Real: los modelos vienen en metros, y 1 unidad del juego son 0,4 m.

Por cada variante del modelo (un conjunto de rocas trae varias; `--only 1,2` elige cuáles) genera:

- **Objeto.** El objeto con alfa limpio (en las plantas con viento, los fotogramas ocupan su lugar).
- **Sombra.** Una pasada con *shadow catcher*: el objeto invisible para la cámara pero proyectando su sombra.
- **Viento.** Con `--frames`, un bucle de viento: cada vértice se desplaza según su altura, y la base no se mueve.

### Cómo añadir un modelo al escenario

1. **Busca** un modelo en [polyhaven.com/models](https://polyhaven.com/models) y descárgalo. Todos son CC0. El script deja el glTF 1k en `.cache/models` y registra autor y licencia en `art/manifest.json`.
   ```bash
   python -P tools/polyhaven.py calathea_orbifolia_01
   ```
2. **Fotografíalo:**
   ```bash
   blender -b --factory-startup -P tools/render_studio.py -- \
       --model .cache/models/calathea_orbifolia_01/calathea_orbifolia_01_1k.gltf --out art/renders/calathea_orbifolia_01 \
       --res 300 --samples 32 --exposure 1.0 --fill 1.2 --rim 2.5 --only 0,1 --frames 12 --wind 0.18 --wave 0.5
   ```
3. **Define la estampa** en `art/stamps.json`:
   - `source`, el id del manifiesto (`ph-<modelo>`), y `variant` (`v0`, `v1`…);
   - `use`: `prop` (pieza colocada a mano) o `rockfill` (variante para las rocas `#`);
   - `sizeTiles`: `[ancho, alto]` o `"auto"`. Para una pieza, `"auto"` usa la escala real multiplicada por `scale`; para una roca, el rectángulo de hasta 3×2 tiles con la proporción más parecida;
   - `solid` y `collision` (`alpha` o `base`);
   - opcionales: `fps` (velocidad del bucle) y `zones` (zonas de una roca).
4. **Procésala:**
   ```bash
   python -m venv .cache/venv-tools && .cache/venv-tools/Scripts/python -m pip install -r tools/requirements.txt   # una vez
   .cache/venv-tools/Scripts/python -P tools/make_stamps.py
   ```
   El script genera:
   - `src/assets/stamps/<id>.png`, revelada, a 6×10 muestras por celda (una tira vertical si está animada);
   - `<id>.shadow.png`, la sombra en la rejilla de sombras (4×4 por celda);
   - `src/data/stamps/<id>.json`, con la huella, la sombra y los créditos;
   - la vista previa literal del repo;
   - la tabla de formas de glifo;
   - la sección de créditos.

   Los renders de `art/renders/` se versionan, así que regenerar las estampas no requiere Blender.
5. **Colócala** en una sala: `"props": [{ "stamp": "<id>", "tile": [x, y], "flip": false }]`, con `tile` como esquina superior izquierda. Añade `"hero": true` si es el punto focal de la sala, y sigue [la guía de composición](docs/composicion.md).
6. **Valida** con `npm test` y `npm run verify:stamps`. Los tests comprueban:
   - licencias, tamaños, huellas, fotogramas y sombras;
   - que el port de TypeScript reproduce al 100 % la vista previa literal del repo;
   - la conversión: el glifo del repo en zonas lisas, la forma en los bordes, el color real y el color mínimo;
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

- **Piezas de escenario:** se componen en CPU una vez por sala, a 6×10 muestras por celda, y se convierten a ASCII también en CPU (`stampConvert.ts`). La GPU recibe por celda el color y la posición en la rampa (`RGBA8UI`) y la fila de base y la cobertura (`RG8UI`). En la composición (P2), esas celdas saltan la capa pictórica, los contornos y la histéresis. También quedan fuera del bloom, la viñeta, la aberración y el grano.

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
- **Arranque:** unos 340–370 ms, incluida la decodificación de las 31 estampas (12 de ellas con 12 fotogramas). Los 10 programas compilan en unos 25 ms.
- **Piezas de escenario:**
  - La composición de la capa al entrar en una sala, con sombras y conversión a ASCII, tarda 1,5–3 ms en caliente; ocurre solo al cambiar de sala.
  - La primera visita a una sala tarda 2–13 ms, porque estira sus rocas a cada rectángulo. Después quedan en caché.
  - Cada cambio de fotograma de una pieza animada cuesta 0,1–0,3 ms en CPU: recomposición, conversión de sus celdas y subida de esa región a la GPU. Repartido, son menos de 0,1 ms por fotograma.
  - Con piezas, sombras y animación, la GPU sigue en 5,8–7,3 ms por fotograma a 1080p.
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
art/                     renders del estudio (modelos CC0), manifiesto de licencias y definición de estampas
docs/                    guía de composición de escenarios
tests/                   fidelidad dorada, fuente, legibilidad, núcleo, layout, mundo, colisión, sistemas, estampas, conversión, animación, composición
tools/                   make_golden.py (fixtures), polyhaven.py y render_studio.py (estudio de render), make_stamps.py (estampas), screenshot.mjs (capturas), verify_stamps.mjs
```

## Licencias

El código del juego y los recursos de terceros se detallan en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
