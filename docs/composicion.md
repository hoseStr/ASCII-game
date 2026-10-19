# Composición de escenarios

Cómo se reparten los elementos de una sala: árboles, rocas, flores, cristales y piezas 3D. Parte de lo que dicen el diseño de niveles, el arte de entornos y el paisajismo, adaptado a nuestras salas de 32×16 tiles vistas en 3/4.

## Qué fallaba

Las salas se veían "regadas a la loca" porque los elementos estaban repartidos sin relación entre sí ni con el terreno:

- **Dispersión uniforme.**
  - En las ruinas había 12 rocas sueltas, de una en una, a distancias casi iguales: parecían confeti.
  - El jardín tenía 7 cristales salpicados.
  - Lo uniforme se lee como artificial y como ruido. Agrupar es lo que hace que el ojo vea un patrón.
- **Simetría copiada en la naturaleza.** El claro tenía 4 bosquecillos y 4 macizos de flores idénticos, en espejo. La simetría es propia de lo construido; en lo natural, delata la mano del diseñador.
- **Sin punto focal.** Todas las piezas pesaban lo mismo y ninguna sala tenía un protagonista.
- **Piezas sin anclaje.**
  - Plantas pegadas al cruce de caminos.
  - Rocas flotando en el vacío, lejos de cualquier isla.
  - Piezas encima de los caminos.

## Principios

### 1. Jerarquía: un héroe, apoyos y relleno

- **Cada sala tiene una sola pieza héroe:** el punto focal, única en la sala y con espacio libre alrededor. Se marca con `"hero": true` en el JSON de la sala.
- **El héroe es grande.** En ASCII, una forma necesita celdas para leerse: una estatua o un busto a 10×9 celdas son una mancha. Por eso la estatua mide 5×5 tiles (25×15 celdas) y el busto héroe 4×4 (20×12). Un busto de apoyo usa `bust-small` (2×3), que no compite con el héroe.
- **Alrededor, uno o dos grupos de apoyo y algo de relleno.**
- **Con mesura.** Demasiados focos confunden: el ojo no sabe dónde posarse. Un héroe que se repite deja de serlo.

> "Dominant is the focal point of the composition, it can't merge with the rest of the scene's objects" ([Composition in level design](https://www.gamedeveloper.com/design/composition-in-level-design)).

### 2. Grupos, no dispersión

Las cosas de la misma familia van juntas:

- **Cómo se forma un grupo:** una roca grande, otra mediana y una pequeña, desplazadas y algo giradas, casi tocándose. Es el truco de "duplicar, escalar, rotar y desplazar" del *Level Design Book*.
- **Asimetría:** grupos asimétricos, con una estructura que se repite a varias escalas.
- **Números impares:** grupos de 3 o 5, como en paisajismo. Se ven más naturales que los pares.
- **Separación:** los grupos distintos no se tocan entre sí. Si se tocan, se funden en una mancha irregular, que es ruido.

> "Proximity, similarity, and implied connectedness helps us see objects as groups and patterns" ([The Level Design Book](https://book.leveldesignbook.com/process/env-art)).

### 3. Anclaje al terreno

Cada grupo se apoya en algo:

- **Rocas:** contra el borde de la isla, en la curva de un camino o al pie del bosque.
- **Plantas:** en la transición del bosque al claro, al pie de los árboles.
- **Plantas flotantes:** cerca de la orilla y en las ensenadas, no en medio del lago.
- **Ruinas:** alineadas con los ejes, porque son obra humana.
- **Nada flota en el vacío.**

### 4. Espacio negativo

- **Zonas despejadas:** los caminos, los cruces y la zona central de juego quedan libres. El vacío deja descansar la vista y hace resaltar lo que está cerca.
- **Densidad:** crece hacia los bordes, que hacen de marco, y baja hacia el centro, que hace de escenario.
- **Mesura:** un nivel "cargado" se vuelve ilegible.

### 5. Marco de las salidas

- **Flanquear, no tapar:** las salidas y los puentes se enmarcan con elementos a los lados, nunca encima.
- **Pareja asimétrica en lo natural:** una roca grande a un lado y una planta al otro.
- **Pareja simétrica en lo formal:** dos faroles, dos leipoldtias.
- **Remate del eje:** en lo formal, el eje del camino termina en el héroe, como el busto del jardín o la estatua de las ruinas.

### 6. Capas en 3/4

- **Lo alto, al norte:** árboles y estatuas van al fondo (norte); lo bajo, delante (sur).
- **Profundidad:** el bosque más denso al norte da fondo y profundidad.
- **Paso libre:** las piezas altas no se ponen donde taparían el paso.

### 7. Repetición y unidad

- **Paleta corta por zona:** cada zona usa dos o tres familias de piezas y las repite. Así la sala tiene unidad.
- **Lo único, una vez:** lo excepcional aparece una sola vez, y es el héroe.
- **Sin exceso de variedad:** demasiadas especies, colores o texturas distintas en poco espacio confunden.

### 8. Simetría solo en lo construido

- **Simetría:** jardín formal, ruinas, santuario.
- **Asimetría equilibrada:** bosque, lago, niebla. Un elemento pesado a un lado se compensa con dos ligeros al otro.

## Cómo se comprueba

`tests/composition.test.ts` convierte en tests las reglas que se pueden medir:

- nada flota en el vacío;
- no hay rocas sueltas de una en una;
- hay una sola pieza héroe por sala;
- ninguna pieza tapa caminos ni puentes, y todas apoyan la base en la isla;
- ninguna pieza está a menos de 2 tiles de una salida;
- toda sala se puede cruzar de salida a salida con las piezas puestas.

Lo demás (equilibrio, ritmo, belleza) se revisa con capturas.

- **Prueba de entornar los ojos:** si al entornarlos no se ve el punto focal, la composición falla.
- **Prueba de desenfoque:** si al desenfocar no se ve por dónde ir, tampoco.

## Las salas

Cada sala conserva su isla, sus caminos, su agua, sus puentes y sus salidas. Solo se recompuso el decorado.

| Sala | Intención | Héroe | Apoyos |
|---|---|---|---|
| Jardín de Cristal (`ow-0-0`) | Jardín formal: el eje norte-sur termina en el busto. | Busto (4×4), flanqueado por dos gazanias | Parterres simétricos alrededor de la plazuela; cuatro faroles en las diagonales; dos leipoldtias enmarcando la avenida del este. |
| Escalinata Lunar (`ow-1-0`) | Patio de un templo en ruinas: la estatua remata el eje desde la escalinata. | Estatua (5×5), centrada en el eje | Escombros en dos grupos en diagonal (NE grande, SO pequeño); faroles en la puerta sur; busto pequeño al este. El patio queda vacío. |
| Umbral del Santuario (`ow-2-0`) | Anfiteatro de roca (más grueso al oeste) como fondo del santuario. | Estatua (5×5), entre los dos faroles y delante del anfiteatro | Salida sur enmarcada por la pila de rocas y un grupo pequeño. La entrada oeste, despejada. |
| Bosque Hondo (`ow-0-1`) | El bosque enmarca el borde (más denso al norte y al oeste); el claro del este, abierto. | Roca grande | Anthurium y helecho pegados a la roca (un solo grupo); un helecho al pie del bosque del NO. |
| Claro de las Luciérnagas (`ow-1-1`, inicio) | Anillo de árboles asimétrico, pesado al norte; el cruce, despejado. | Anthurium en el tercio NE, con su farol | Helechos al pie de los árboles del NO; calathea y helecho al SO; una franja de flores al SE. |
| Orilla de los Espejos (`ow-2-1`) | Orilla oeste con peso; el agua del SE, libre. | Roca alta junto a la salida oeste | Hojas flotantes agrupadas cerca de esa orilla; franja de flores que se afina hacia el SO. |
| Raíces Colgantes (`ow-0-2`) | Bosque al NO como fondo; el puente lleva a un farol en la otra isla. | Roca redonda | Helecho a su pie, que enmarca la entrada norte; helecho grande al pie del bosque; flores al sur. |
| Puente de Niebla (`ow-1-2`) | Isla serena con poco: la niebla es el vacío. | Roca alta al NE | Planta y árbol al NO; el farol al sur, en el eje, con su franja de flores; dos islotes de roca a los lados de los puentes. |
| Lago de los Espejos (`ow-2-2`) | La isla central es un santuario sobre el agua. | Busto (4×4), con farol y flores | Hojas flotantes en dos grupos en diagonal: dos al SO y una al NE. |

## Fuentes

- [The Level Design Book: Environment art](https://book.leveldesignbook.com/process/env-art). Agrupación, legibilidad, color y valor, piezas héroe.
- [The Level Design Book: Composition](https://book.leveldesignbook.com/process/blockout/massing/composition). Jerarquía por contraste, hitos, líneas de visión.
- [The Level Design Book: Wayfinding](https://book.leveldesignbook.com/process/blockout/wayfinding). Caminos, bordes, distritos, nodos e hitos (Lynch).
- [Composition in level design (Game Developer)](https://www.gamedeveloper.com/design/composition-in-level-design). Dominante, equilibrio, capas, margen alrededor del foco.
- [Pixelblog 21: Top Down Objects (Slynyrd)](https://www.slynyrd.com/blog/2019/9/18/pixelblog-21-top-down-objects). Lo asimétrico y único, con mesura; rocas con los tonos del suelo.
- [Pixelblog 43: Top Down Tiles 2 (Slynyrd)](https://slynyrd.com/blog/2023/3/26/pixelblog-43-top-down-tiles-part-2). Grupos que no se tocan, equilibrio.
- [Overworld overload: A Link to the Past (Game Developer)](https://www.gamedeveloper.com/disciplines/overworld-overload-an-analysis-of-link-to-the-past-s-light-world-part-2). Barreras naturales (bosque, riscos, orillas) que encauzan el recorrido.
- Paisajismo: plantación en grupos impares y en "drifts", capas de alto a bajo y repetición para dar unidad ([Garden Design](https://www.gardendesign.com/landscape-design/planting-techniques.html), [Cornell CCE](https://blogs.cornell.edu/cceherkimer/files/2023/03/2023_CCE_Residential-Landscape-Design-Simplified.pdf), [Fine Gardening](https://www.finegardening.com/article/impress-from-a-distance)).
