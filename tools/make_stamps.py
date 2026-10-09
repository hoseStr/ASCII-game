"""
Pipeline de estampas: renders de modelos 3D (CC0) → piezas de escenario ASCII.

Las piezas parten SOLO de modelos 3D fotoescaneados, fotografiados con
tools/render_studio.py (alfa limpio, escala real, sombra renderizada, viento).
Por cada estampa de art/stamps.json:
  1. comprueba que su fuente (art/manifest.json) tiene licencia permitida;
  2. encaja los fotogramas del render a su tamaño en tiles corrigiendo la
     proporción de la celda (3:5), a 6×10 muestras por celda (alfa premultiplicado);
  3. "revela" la imagen como se revelaría una foto, para que la forma se lea en
     ASCII: niveles automáticos, contraste local (≈1 celda), sombras algo más
     abiertas y un poco más de saturación (los mismos ajustes en todos los
     fotogramas, sin parpadeo);
  4. escribe src/assets/stamps/<id>.png (tira vertical de fotogramas RGBA),
     <id>.shadow.png (sombra en la rejilla de sombras, 4×4 por celda) y
     src/data/stamps/<id>.json (huella de colisión, sombra, créditos);
  5. escribe src/data/stamps/<id>.preview.txt con el algoritmo LITERAL del repo
     ASCII-generator (img2txt a color: bloques 1:2, (R+G+B)/3, rampa de 70);
  6. regenera src/data/glyphShapes.json (forma de cada glifo de la rampa, medida
     en la fuente del juego con la misma disposición que el atlas) y la sección
     de créditos de THIRD_PARTY_NOTICES.md.

Requisitos: Python 3, numpy, Pillow y opencv-python-headless (tools/requirements.txt).
Uso:
    .cache/venv-tools/Scripts/python -P tools/make_stamps.py [id ...]
"""
import json
import os
import struct
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ALLOWED_LICENSES = {"CC0-1.0", "PDM-1.0"}
LICENSE_NAMES = {"CC0-1.0": "CC0 1.0 (dominio público)", "PDM-1.0": "Public Domain Mark 1.0"}
TILE_COLS, TILE_ROWS, TILE_UNITS = 5, 3, 3.0
CELL_W_UNITS, CELL_H_UNITS = 0.6, 1.0
SX, SY = 6, 10  # muestras por celda de la imagen (proporción de la celda, 3:5)
SHADOW_S = 4  # muestras por celda (en x y en y) de la rejilla de sombras
REPO_RAMP = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. "
LIGHT_RAMP = REPO_RAMP[::-1]  # de vacío a tinta (sentido light del juego)
FONT = os.path.join(ROOT, "src", "assets", "fonts", "DejaVuSansMono-Bold.ttf")
SHAPE_GRID = (3, 5)  # rejilla (x, y) en la que se compara la forma de la celda con la del glifo
NOTICE_BEGIN = "<!-- imagenes:inicio (generado por tools/make_stamps.py) -->"
NOTICE_END = "<!-- imagenes:fin -->"
METERS_PER_UNIT = 0.4  # la princesa mide 4 filas ≈ 1,6 m
ROCK_SHAPES = [[3, 2], [2, 2], [3, 1], [2, 1], [1, 1], [1, 2]]  # rectángulos de rocas posibles

# revelado (ver enhance)
LEVELS = (2, 98)  # percentiles de luma que pasan a negro y blanco
LOCAL_CONTRAST = 0.6  # realce de la forma: Y + k·(Y − Y desenfocada a ≈1 celda)
SHADOW_GAMMA = 0.9  # < 1 abre las sombras
SATURATION = 1.2


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# --- encaje al tamaño de la estampa ----------------------------------------------------
def alpha_bbox(alpha):
    ys, xs = np.nonzero(alpha > 0.05)
    if len(xs) == 0:
        raise SystemExit("máscara vacía")
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def auto_size_tiles(bbox, meters_per_px, scale=1.0):
    """Tamaño en tiles a partir del tamaño real del objeto (render a escala)."""
    x0, y0, x1, y1 = bbox
    wu = (x1 - x0) * meters_per_px / METERS_PER_UNIT * scale
    hu = (y1 - y0) * meters_per_px / METERS_PER_UNIT * scale
    return [max(1, int(np.ceil(wu / TILE_UNITS - 0.15))), max(1, int(np.ceil(hu / TILE_UNITS - 0.15)))]


def auto_rock_tiles(bbox):
    """Relleno de rocas: el rectángulo (≤3×2 tiles) de proporción más parecida al objeto."""
    x0, y0, x1, y1 = bbox
    aspect = (x1 - x0) / (y1 - y0)  # render ortográfico: píxeles cuadrados, como las unidades del juego
    return min(ROCK_SHAPES, key=lambda t: (round(abs(np.log(t[0] / t[1] / aspect)), 3), -t[0] * t[1]))


def compute_fit(bbox, size_tiles):
    """Transformación render → lienzo de la estampa (contain, anclado abajo al centro)."""
    x0, y0, x1, y1 = bbox
    iw, ih = x1 - x0, y1 - y0
    tw, th = size_tiles
    out_w, out_h = tw * TILE_COLS * SX, th * TILE_ROWS * SY
    s = min(tw * TILE_UNITS / iw, th * TILE_UNITS / ih)  # unidades del mundo por píxel del render
    nw = max(1, min(out_w, round(iw * s / (CELL_W_UNITS / SX))))
    nh = max(1, min(out_h, round(ih * s / (CELL_H_UNITS / SY))))
    return {"bbox": bbox, "out": (out_w, out_h), "n": (nw, nh), "o": ((out_w - nw) // 2, out_h - nh)}


def apply_fit(rgb, alpha, fit):
    """Recorta, reescala (alfa premultiplicado) y coloca en el lienzo."""
    x0, y0, x1, y1 = fit["bbox"]
    out_w, out_h = fit["out"]
    nw, nh = fit["n"]
    ox, oy = fit["o"]
    rgb = rgb[y0:y1, x0:x1].astype(np.float64) / 255.0
    alpha = alpha[y0:y1, x0:x1].astype(np.float64)
    prem_r = cv2.resize(rgb * alpha[..., None], (nw, nh), interpolation=cv2.INTER_AREA)
    a_r = cv2.resize(alpha, (nw, nh), interpolation=cv2.INTER_AREA)
    col = np.where(a_r[..., None] > 1e-4, prem_r / np.maximum(a_r[..., None], 1e-4), 0.0)
    canvas = np.zeros((out_h, out_w, 4))
    canvas[oy : oy + nh, ox : ox + nw, :3] = np.clip(col, 0, 1)
    canvas[oy : oy + nh, ox : ox + nw, 3] = np.clip(a_r, 0, 1)
    return canvas


def fit_shadow(shadow, fit):
    """
    Lleva la sombra renderizada (mismo encuadre que el objeto) a la rejilla de
    sombras (SHADOW_S×SHADOW_S por celda) con la MISMA transformación que la
    imagen. Devuelve (imagen 0..1, desplazamiento en muestras de sombra respecto al
    origen de la estampa); puede salirse del lienzo.
    """
    sx0, sy0, sx1, sy1 = alpha_bbox(shadow)
    x0, y0, x1, y1 = fit["bbox"]
    nw, nh = fit["n"]
    ox, oy = fit["o"]
    fx, fy = SHADOW_S / SX, SHADOW_S / SY  # muestras de imagen → muestras de sombra
    kx = nw / (x1 - x0) * fx
    ky = nh / (y1 - y0) * fy
    cx0 = int(np.floor(ox * fx + (sx0 - x0) * kx))
    cy0 = int(np.floor(oy * fy + (sy0 - y0) * ky))
    cw = max(1, int(np.ceil((sx1 - sx0) * kx)))
    ch = max(1, int(np.ceil((sy1 - sy0) * ky)))
    img = cv2.resize(shadow[sy0:sy1, sx0:sx1].astype(np.float64), (cw, ch), interpolation=cv2.INTER_AREA)
    return np.clip(img, 0, 1), [cx0, cy0]


# --- revelado -----------------------------------------------------------------------------
def enhance(frames):
    """
    Revelado para ASCII, igual en todos los fotogramas (niveles medidos en el 0):
    niveles automáticos, contraste local de la forma (desenfoque con alfa, no mezcla
    el vacío), sombras algo más abiertas y saturación. Solo cambia colores: el
    contorno de la imagen queda igual.
    """
    a0 = frames[0][..., 3]
    m = a0 > 0.5
    Y0 = frames[0][..., :3].mean(-1)
    lo, hi = (np.percentile(Y0[m], LEVELS[0]), np.percentile(Y0[m], LEVELS[1])) if m.any() else (0.0, 1.0)
    out = []
    for fr in frames:
        rgb, a = fr[..., :3], fr[..., 3]
        rgb = np.clip((rgb - lo) / max(hi - lo, 1e-3), 0, 1)
        Y = rgb.mean(-1)
        sig = float(SX)
        bw = cv2.GaussianBlur(Y * a, (0, 0), sig)
        ba = cv2.GaussianBlur(a, (0, 0), sig)
        base = np.where(ba > 1e-3, bw / np.maximum(ba, 1e-3), Y)
        Yn = np.clip(Y + LOCAL_CONTRAST * (Y - base), 0, 1) ** SHADOW_GAMMA
        rgb = np.clip(rgb * (Yn / np.maximum(Y, 1e-3))[..., None], 0, 1)
        g = rgb.mean(-1, keepdims=True)
        rgb = np.clip(g + (rgb - g) * SATURATION, 0, 1)
        out.append(np.dstack([rgb, a]))
    return out


# --- forma de los glifos (misma disposición que src/render/atlas.ts) ------------------------
def ttf_tables(path):
    b = open(path, "rb").read()
    n = struct.unpack(">H", b[4:6])[0]
    t = {}
    for i in range(n):
        tag, _, off, ln = struct.unpack(">4sIII", b[12 + 16 * i : 28 + 16 * i])
        t[tag.decode("latin-1")] = b[off : off + ln]
    return t


def font_layout(cw, ch):
    """Tamaño de fuente, línea base y lápiz como buildAtlas: avance = ancho, caja tipográfica en el alto."""
    t = ttf_tables(FONT)
    upem = struct.unpack(">H", t["head"][18:20])[0]
    asc, desc = struct.unpack(">hh", t["OS/2"][68:72])
    adv_em = ImageFont.truetype(FONT, upem).getlength("M") / upem
    typo_em = (asc - desc) / upem
    size = min(cw / adv_em, ch / typo_em)
    baseline = round((ch - typo_em * size) / 2 + asc / upem * size)
    return size, baseline, round((cw - adv_em * size) / 2)


def glyph_bitmap(ch_, cw, ch):
    """Cobertura del glifo en su celda; si la tinta se sale, se encaja escalando (como el atlas)."""
    size, baseline, pen_x = font_layout(cw, ch)
    font = ImageFont.truetype(FONT, round(size))
    big = Image.new("L", (cw * 3, ch * 3), 0)
    ImageDraw.Draw(big).text((cw + pen_x, ch + baseline), ch_, font=font, fill=255, anchor="ls")
    a = np.asarray(big).astype(np.float64) / 255.0
    ys, xs = np.nonzero(a > 0.02)
    if len(xs):
        x0, x1, y0, y1 = xs.min() - cw, xs.max() + 1 - cw, ys.min() - ch, ys.max() + 1 - ch
        if max(0, -x0, x1 - cw, -y0, y1 - ch) > 0.75 * cw / 12:
            sy = min(1.0, baseline / max(1e-3, baseline - y0), (ch - baseline) / max(1e-3, y1 - baseline))
            sx = min(1.0, cw / max(1e-3, x1 - x0))
            tx = cw * 1.5 - sx * (cw + (x0 + x1) / 2) if sx < 1 else (1 - sx) * cw * 1.5
            M = np.array([[sx, 0, tx], [0, sy, (1 - sy) * (ch + baseline)]])
            a = cv2.warpAffine(a, M, (cw * 3, ch * 3), flags=cv2.INTER_AREA)
    return a[ch : 2 * ch, cw : 2 * cw]


def write_glyph_shapes():
    """Cobertura de cada glifo de la rampa en la rejilla SHAPE_GRID y respuesta tonal del repo."""
    gx, gy = SHAPE_GRID
    cw, ch = 48, 80  # celda de referencia (3:5), 4× la de 1080p
    cov = []
    for c in LIGHT_RAMP:
        bm = glyph_bitmap(c, cw, ch)
        cov.append(bm.reshape(gy, ch // gy, gx, cw // gx).mean(axis=(1, 3)).reshape(-1))
    cov = np.array(cov)
    mu = cov.mean(1)
    # respuesta tonal del repo: cobertura del glifo que el repo elige en cada posición de
    # la rampa, suavizada y monótona (la rampa del repo no está ordenada por tinta)
    env = np.maximum.accumulate(np.convolve(np.pad(mu, 2, mode="edge"), np.ones(5) / 5, mode="valid"))
    data = {
        "description": "Generado por tools/make_stamps.py: forma de cada glifo de la rampa del repo (sentido light, de vacío a tinta) medida en DejaVu Sans Mono Bold con la disposición del atlas. coverage[i] = tinta media de cada región de la rejilla (filas de arriba abajo); response[i] = respuesta tonal de la rampa (cobertura suavizada y monótona).",
        "ramp": LIGHT_RAMP,
        "grid": list(SHAPE_GRID),
        "coverage": [[round(float(v), 4) for v in row] for row in cov],
        "response": [round(float(v), 4) for v in env],
    }
    with open(os.path.join(ROOT, "src", "data", "glyphShapes.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")


# --- metadatos ---------------------------------------------------------------------------
def footprint(alpha, size_tiles, mode):
    tw, th = size_tiles
    pw, ph = TILE_COLS * SX, TILE_ROWS * SY
    cov = np.zeros((th, tw))
    for ty in range(th):
        for tx in range(tw):
            cov[ty, tx] = alpha[ty * ph : (ty + 1) * ph, tx * pw : (tx + 1) * pw].mean()
    solid = np.zeros((th, tw), bool)
    if mode == "alpha":
        solid = cov >= 0.4
    elif mode == "base":
        solid[th - 1] = cov[th - 1] >= 0.2
    return ["".join("#" if solid[y, x] else "." for x in range(tw)) for y in range(th)], cov


def repo_preview(png):
    """
    Algoritmo literal de img2txt/img2img_color del repo sobre la estampa YA
    cuantizada a 8 bits y compuesta sobre blanco, como el modo de fondo blanco del
    repo: el fondo queda en espacios y el sujeto en letras. El test de TypeScript
    lee el mismo PNG y exige coincidencia exacta.
    """
    rgb = png[..., :3].astype(np.float64)
    a = png[..., 3:4].astype(np.float64)
    img = np.round((rgb * a + 255.0 * (255.0 - a)) / 255.0)
    h, w = img.shape[:2]
    num_cols = w // SX
    cell_w = w / num_cols
    cell_h = 2 * cell_w
    num_rows = int(h / cell_h)
    n = len(REPO_RAMP)
    lines = []
    for i in range(num_rows):
        line = ""
        for j in range(num_cols):
            blk = img[int(i * cell_h) : min(int((i + 1) * cell_h), h), int(j * cell_w) : min(int((j + 1) * cell_w), w)]
            line += REPO_RAMP[min(int(np.mean(blk) * n / 255), n - 1)]
        lines.append(line)
    return lines


def update_notices(manifest, used):
    path = os.path.join(ROOT, "THIRD_PARTY_NOTICES.md")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    lines = [
        NOTICE_BEGIN,
        "## Modelos 3D de las piezas de escenario",
        "",
        "Las piezas de escenario (estampas) parten de modelos 3D fotoescaneados de",
        "Poly Haven, dedicados al dominio público (CC0), renderizados con",
        "tools/render_studio.py y convertidos a ASCII. Las licencias se verificaron en",
        "la página de cada modelo. No requieren atribución; se acreditan igualmente.",
        "",
        "| Fuente | Modelo | Autor | Licencia |",
        "|---|---|---|---|",
    ]
    for src in manifest["sources"]:
        if src["id"] not in used:
            continue
        lines.append(f"| `{src['id']}` | [{src['title']}]({src['sourceUrl']}) | {src['author']} | {LICENSE_NAMES[src['license']]} |")
    lines.append(NOTICE_END)
    block = "\n".join(lines)
    if NOTICE_BEGIN in text:
        pre = text.split(NOTICE_BEGIN)[0]
        post = text.split(NOTICE_END)[1]
        text = pre + block + post
    else:
        text = text.rstrip() + "\n\n" + block + "\n"
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def main():
    only = set(sys.argv[1:])
    manifest = load_json(os.path.join(ROOT, "art", "manifest.json"))
    defs = load_json(os.path.join(ROOT, "art", "stamps.json"))["stamps"]
    sources = {s["id"]: s for s in manifest["sources"]}
    out_png = os.path.join(ROOT, "src", "assets", "stamps")
    out_data = os.path.join(ROOT, "src", "data", "stamps")
    os.makedirs(out_png, exist_ok=True)
    os.makedirs(out_data, exist_ok=True)
    write_glyph_shapes()
    for st in defs:
        src = sources.get(st["source"])
        if src is None:
            raise SystemExit(f"{st['id']}: fuente '{st['source']}' no está en el manifiesto")
        if src["license"] not in ALLOWED_LICENSES:
            raise SystemExit(f"{st['id']}: licencia '{src['license']}' no permitida")
        if only and st["id"] not in only:
            continue
        # render del estudio: alfa limpio, escala real, sombra propia y, si hay viento, fotogramas
        rdir = os.path.join(ROOT, "art", src["file"])
        var = st.get("variant", "v0")
        rmeta = load_json(os.path.join(rdir, f"{var}.json"))
        nfr = int(rmeta.get("frames") or 0)
        names = [f"{var}_f{k:02d}.png" for k in range(nfr)] if nfr > 1 else [f"{var}.png"]
        rgba_frames = [np.asarray(Image.open(os.path.join(rdir, nm)).convert("RGBA")) for nm in names]
        union = np.max(np.stack([f[..., 3] for f in rgba_frames]), axis=0).astype(np.float64) / 255.0
        bbox = alpha_bbox(union)
        size = st.get("sizeTiles", "auto")
        if size == "auto":
            size = auto_rock_tiles(bbox) if st["use"] == "rockfill" else auto_size_tiles(bbox, rmeta["metersPerPixel"], st.get("scale", 1.0))
        fit = compute_fit(bbox, size)
        frames = enhance([apply_fit(f[..., :3], f[..., 3].astype(np.float64) / 255.0, fit) for f in rgba_frames])
        sh = np.asarray(Image.open(os.path.join(rdir, f"{var}.shadow.png")).convert("RGBA"))[..., 3].astype(np.float64) / 255.0
        shadow_img, shadow_off = fit_shadow(sh, fit)
        fp, _ = footprint(frames[0][..., 3], size, st.get("collision", "none") if st.get("solid") else "none")
        pngs = [(np.round(np.clip(fr, 0, 1) * 255)).astype(np.uint8) for fr in frames]
        # varios fotogramas: tira vertical (fotograma k en las filas k·alto…)
        Image.fromarray(np.concatenate(pngs, axis=0), "RGBA").save(os.path.join(out_png, f"{st['id']}.png"), optimize=True)
        Image.fromarray((np.round(shadow_img * 255)).astype(np.uint8), "L").save(os.path.join(out_png, f"{st['id']}.shadow.png"), optimize=True)
        meta = {
            "id": st["id"],
            "image": f"{st['id']}.png",
            "use": st["use"],
            "sizeTiles": size,
            "cells": [size[0] * TILE_COLS, size[1] * TILE_ROWS],
            "samples": [SX, SY],
            "solid": bool(st.get("solid")),
            "shadow": "render",
            "footprint": fp,
            "frames": len(frames),
            "fps": st.get("fps", 8) if len(frames) > 1 else 0,
            "shadowImage": {"image": f"{st['id']}.shadow.png", "offset": shadow_off, "size": [int(shadow_img.shape[1]), int(shadow_img.shape[0])]},
            "credits": {k: src[k] for k in ("title", "author", "license", "sourceUrl")},
        }
        if st.get("zones"):
            meta["zones"] = st["zones"]
        with open(os.path.join(out_data, f"{st['id']}.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
            f.write("\n")
        with open(os.path.join(out_data, f"{st['id']}.preview.txt"), "w", encoding="ascii", newline="\n") as f:
            f.write("\n".join(repo_preview(pngs[0])) + "\n")
        print(f"{st['id']:16s} {st['use']:8s} {meta['cells'][0]}×{meta['cells'][1]} celdas  fotogramas {len(frames)}  huella {fp}")
    update_notices(manifest, {s["source"] for s in defs})


if __name__ == "__main__":
    main()
