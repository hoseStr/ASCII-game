# Avisos de terceros

## ASCII-generator (algoritmo y rampas de glifos)

`src/render/ascii.ts` y los shaders de conversión portan el algoritmo de
[vietnh1009/ASCII-generator](https://github.com/vietnh1009/ASCII-generator).
La rampa de 70 glifos es la de Paul Bourke, tal como la usa ese repositorio.
`tools/make_golden.py` ejecuta su `img2txt.py` sin modificarlo para generar los fixtures dorados.

```
MIT License

Copyright (c) 2018 Viet Nguyen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DejaVu Sans Mono Bold (fuente)

`src/assets/fonts/DejaVuSansMono-Bold.ttf` se distribuye **sin modificar**: no se ha
recortado a un subconjunto ni convertido a otro formato. Es la misma fuente que
usa ASCII-generator. Su licencia (Bitstream Vera + Arev, con los cambios de
DejaVu en dominio público) está en `public/licenses/LICENSE-DejaVu.txt` (se publica con el build).

## Dependencias de desarrollo

TypeScript, Vite, Vitest y Playwright, cada una con su licencia (ver `node_modules`).
El bundle publicado no incluye ninguna dependencia de runtime.

<!-- imagenes:inicio (generado por tools/make_stamps.py) -->
## Modelos 3D de las piezas de escenario

Las piezas de escenario (estampas) parten de modelos 3D fotoescaneados de
Poly Haven, dedicados al dominio público (CC0), renderizados con
tools/render_studio.py y convertidos a ASCII. Las licencias se verificaron en
la página de cada modelo. No requieren atribución; se acreditan igualmente.

| Fuente | Modelo | Autor | Licencia |
|---|---|---|---|
| `ph-boulder_01` | [Boulder 01](https://polyhaven.com/a/boulder_01) | Rico Cilliers | CC0 1.0 (dominio público) |
| `ph-namaqualand_boulder_02` | [Namaqualand Boulder 02](https://polyhaven.com/a/namaqualand_boulder_02) | Greg Zaal, Rico Cilliers | CC0 1.0 (dominio público) |
| `ph-namaqualand_boulder_04` | [Namaqualand Boulder 04](https://polyhaven.com/a/namaqualand_boulder_04) | Jenelle van Heerden | CC0 1.0 (dominio público) |
| `ph-namaqualand_boulder_05` | [Namaqualand Boulder 05](https://polyhaven.com/a/namaqualand_boulder_05) | Jenelle van Heerden, Dario Barresi | CC0 1.0 (dominio público) |
| `ph-rock_moss_set_02` | [Rock Moss Set 02](https://polyhaven.com/a/rock_moss_set_02) | Kless Gyzen | CC0 1.0 (dominio público) |
| `ph-fern_02` | [Fern 02](https://polyhaven.com/a/fern_02) | Rob Tuytel, Rico Cilliers | CC0 1.0 (dominio público) |
| `ph-rock_moss_set_01` | [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01) | Kless Gyzen | CC0 1.0 (dominio público) |
| `ph-gothic_statue` | [Gothic Statue](https://polyhaven.com/a/gothic_statue) | Benny Weimer | CC0 1.0 (dominio público) |
| `ph-marble_bust_01` | [Marble Bust 01](https://polyhaven.com/a/marble_bust_01) | Rico Cilliers | CC0 1.0 (dominio público) |
| `ph-calathea_orbifolia_01` | [Calathea Orbifolia 01](https://polyhaven.com/a/calathea_orbifolia_01) | Rob Tuytel, Rico Cilliers | CC0 1.0 (dominio público) |
| `ph-anthurium_botany_01` | [Anthurium Botany 01](https://polyhaven.com/a/anthurium_botany_01) | Rob Tuytel, Rico Cilliers | CC0 1.0 (dominio público) |
| `ph-flower_gazania` | [Flower Gazania](https://polyhaven.com/a/flower_gazania) | James Ray Cock, Jenelle van Heerden | CC0 1.0 (dominio público) |
| `ph-leipoldtia_schultzei` | [Leipoldtia Schultzei](https://polyhaven.com/a/leipoldtia_schultzei) | Jenelle van Heerden | CC0 1.0 (dominio público) |
<!-- imagenes:fin -->
