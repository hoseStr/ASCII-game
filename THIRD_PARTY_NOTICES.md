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
## Imágenes de las piezas de escenario

Las piezas de escenario (estampas) parten de fotografías en dominio público o
dedicadas al dominio público (CC0), convertidas a ASCII con el algoritmo del
repositorio. Las licencias se verificaron en la página de origen de cada foto.
No requieren atribución; se acreditan igualmente.

| Estampa | Foto | Autor | Licencia |
|---|---|---|---|
| `boulder-moss` | [2021-09-14_10-58-19_South_Bohemia_holiday](https://www.flickr.com/photos/96541566@N06/51615724824) | Juhele_CZ | CC0 1.0 (dominio público) |
| `mushrooms-red` | [Fly agaric.](https://www.flickr.com/photos/88123769@N02/53451523967) | Bernard Spragg | Public Domain Mark 1.0 |
| `mushroom-gold` | [Fly Agaric (Amanita Muscaria)](https://www.flickr.com/photos/67015038@N06/51861839256) | ShenandoahNPS | Public Domain Mark 1.0 |
| `fern` | [Cinnamon fern frond](https://www.flickr.com/photos/78334038@N00/52982888787) | jeremyosborn | Public Domain Mark 1.0 |
| `stump-moss` | [tree_stump_with_moss24](https://www.flickr.com/photos/96541566@N06/51982348091) | Juhele_CZ | CC0 1.0 (dominio público) |
| `log-fallen` | [20241030-FS-SNF-SR-002](https://www.flickr.com/photos/53801642@N06/54107399549) | Superior National Forest | Public Domain Mark 1.0 |
| `lily-white` | [2014-01-18_11-13-02_NZ_Auckland](https://www.flickr.com/photos/96541566@N06/51810620610) | Juhele_CZ | CC0 1.0 (dominio público) |
| `column` | [2022-11-14_16-02-15_JO_day2-4_Madaba_JH](https://www.flickr.com/photos/96541566@N06/52593271127) | Juhele_CZ | CC0 1.0 (dominio público) |
| `bush-azalea` | [pink-azalea-bush](https://www.flickr.com/photos/192670421@N04/51143296650) | alcox585 | Public Domain Mark 1.0 |
| `rock-moss` | [tree_stump_with_moss23](https://www.flickr.com/photos/96541566@N06/51435082195) | Juhele_CZ | CC0 1.0 (dominio público) |
| `rock-granite` | [Granite Boulder and Rock Varnish](https://www.flickr.com/photos/115357548@N08/51916592018) | Joshua Tree National Park | Public Domain Mark 1.0 |
<!-- imagenes:fin -->
