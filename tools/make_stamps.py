"""
Pipeline de estampas: fotos con licencia libre → piezas de escenario ASCII.

Por cada estampa de art/stamps.json:
  1. comprueba que su fuente (art/manifest.json) tiene licencia permitida;
  2. separa el sujeto del fondo (GrabCut de OpenCV o clave sobre fondo oscuro):
     el contorno del recorte es el único borde que tendrá la pieza en el juego;
  3. recorta, ajusta a su tamaño en tiles corrigiendo la proporción de la celda
     (3:5) y reescala a 4×4 muestras por celda (alfa premultiplicado);
  4. escribe src/assets/stamps/<id>.png (RGBA) y src/data/stamps/<id>.json
     (huella de colisión, rango de luminancia, créditos);
  5. escribe src/data/stamps/<id>.preview.txt con el algoritmo LITERAL del repo
     ASCII-generator (img2txt a color: bloques 1:2, (R+G+B)/3, rampa de 70);
  6. regenera la sección de créditos de THIRD_PARTY_NOTICES.md y una hoja de
     contacto de revisión en shots/stamps-contact.png.

Requisitos: Python 3, numpy, Pillow y opencv-python-headless (tools/requirements.txt).
Uso:
    .cache/venv-tools/Scripts/python -P tools/make_stamps.py [id ...]
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ALLOWED_LICENSES = {"CC0-1.0", "PDM-1.0"}
LICENSE_NAMES = {"CC0-1.0": "CC0 1.0 (dominio público)", "PDM-1.0": "Public Domain Mark 1.0"}
TILE_COLS, TILE_ROWS, TILE_UNITS = 5, 3, 3.0
CELL_W_UNITS, CELL_H_UNITS = 0.6, 1.0
SAMPLES = 4
REPO_RAMP = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. "
NOTICE_BEGIN = "<!-- imagenes:inicio (generado por tools/make_stamps.py) -->"
NOTICE_END = "<!-- imagenes:fin -->"


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# --- separación del sujeto ---------------------------------------------------------
def mask_grabcut(rgb, rect, fg_rects=(), bg_rects=()):
    """GrabCut con el rectángulo del sujeto; `fg_rects`/`bg_rects` marcan sujeto o fondo seguros."""
    import cv2

    h, w = rgb.shape[:2]
    x0, y0, x1, y1 = rect
    bgr = np.ascontiguousarray(rgb[..., ::-1])
    mask = np.full((h, w), cv2.GC_BGD, np.uint8)
    mask[int(y0 * h) : int(y1 * h), int(x0 * w) : int(x1 * w)] = cv2.GC_PR_FGD
    for fx0, fy0, fx1, fy1 in fg_rects:
        mask[int(fy0 * h) : int(fy1 * h), int(fx0 * w) : int(fx1 * w)] = cv2.GC_FGD
    for bx0, by0, bx1, by1 in bg_rects:
        mask[int(by0 * h) : int(by1 * h), int(bx0 * w) : int(bx1 * w)] = cv2.GC_BGD
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, mask, None, bgd, fgd, 8, cv2.GC_INIT_WITH_MASK)
    fg = ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.uint8)
    return clean_mask(fg)


def mask_key_dark(rgb, threshold):
    lum = rgb.astype(np.float64).mean(axis=2) / 255.0
    return clean_mask((lum > threshold).astype(np.uint8))


def clean_mask(fg):
    """Apertura/cierre morfológicos y solo las componentes grandes."""
    import cv2

    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, k)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, k)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n <= 1:
        return fg
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = 1 + np.where(areas >= 0.08 * areas.max())[0]
    return np.isin(labels, keep).astype(np.uint8)


# --- ajuste al tamaño de la estampa ----------------------------------------------------
def fit_stamp(rgb, alpha, size_tiles):
    """Recorta al sujeto y lo ajusta (contain, anclado abajo al centro) a la rejilla de muestras."""
    import cv2

    ys, xs = np.nonzero(alpha > 0.05)
    if len(xs) == 0:
        raise SystemExit("máscara vacía")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    rgb = rgb[y0:y1, x0:x1].astype(np.float64) / 255.0
    alpha = alpha[y0:y1, x0:x1].astype(np.float64)
    tw, th = size_tiles
    cells_w, cells_h = tw * TILE_COLS, th * TILE_ROWS
    out_w, out_h = cells_w * SAMPLES, cells_h * SAMPLES
    units_w, units_h = tw * TILE_UNITS, th * TILE_UNITS
    ih, iw = alpha.shape
    s = min(units_w / iw, units_h / ih)  # unidades del mundo por píxel de la foto
    sample_w = CELL_W_UNITS / SAMPLES
    sample_h = CELL_H_UNITS / SAMPLES
    nw = max(1, min(out_w, round(iw * s / sample_w)))
    nh = max(1, min(out_h, round(ih * s / sample_h)))
    prem = rgb * alpha[..., None]
    prem_r = cv2.resize(prem, (nw, nh), interpolation=cv2.INTER_AREA)
    a_r = cv2.resize(alpha, (nw, nh), interpolation=cv2.INTER_AREA)
    col = np.where(a_r[..., None] > 1e-4, prem_r / np.maximum(a_r[..., None], 1e-4), 0.0)
    canvas = np.zeros((out_h, out_w, 4))
    ox = (out_w - nw) // 2
    oy = out_h - nh  # anclado abajo
    canvas[oy : oy + nh, ox : ox + nw, :3] = np.clip(col, 0, 1)
    canvas[oy : oy + nh, ox : ox + nw, 3] = np.clip(a_r, 0, 1)
    return canvas


# --- metadatos ---------------------------------------------------------------------------
def footprint(alpha, size_tiles, mode):
    tw, th = size_tiles
    pw, ph = TILE_COLS * SAMPLES, TILE_ROWS * SAMPLES
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
    num_cols = w // SAMPLES
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


# --- hoja de contacto ------------------------------------------------------------------------
def contact_tile(source_rgb, rect, mask, canvas, font):
    """Fila de revisión: foto con su recorte, sujeto separado y vista ASCII en el estilo del juego."""
    W, H = 1100, 340
    tile = Image.new("RGB", (W, H), (16, 14, 30))
    d = ImageDraw.Draw(tile)
    src = Image.fromarray(source_rgb)
    src.thumbnail((300, 270))
    tile.paste(src, (5, 22))
    if rect:
        x0, y0, x1, y1 = rect
        d.rectangle([5 + x0 * src.width, 22 + y0 * src.height, 5 + x1 * src.width, 22 + y1 * src.height], outline=(255, 220, 80))
    if mask is not None:
        m = Image.fromarray((mask * 255).astype(np.uint8)).resize((src.width, src.height))
        tile.paste(Image.composite(src, Image.new("RGB", src.size, (40, 0, 60)), m), (315, 22))
    # Vista ASCII como en el juego: algoritmo del repo (rampa de 70 en sentido light),
    # color real del bloque, sin tinte, luz ni fondo pintado.
    rgb, a = canvas[..., :3], canvas[..., 3]
    h, w = a.shape
    cw, ch = 12, 20
    ox, oy = 630, 22
    paper = np.array([0.1, 0.09, 0.17])
    ramp = REPO_RAMP[::-1]
    for cy in range(h // SAMPLES):
        for cx in range(w // SAMPLES):
            sl = (slice(cy * SAMPLES, (cy + 1) * SAMPLES), slice(cx * SAMPLES, (cx + 1) * SAMPLES))
            al = a[sl].mean()
            col = (rgb[sl] * a[sl][..., None]).reshape(-1, 3).sum(0) / max(1e-4, a[sl].sum()) if al > 0 else paper
            x, y = ox + cx * cw, oy + cy * ch
            d.rectangle([x, y, x + cw - 1, y + ch - 1], fill=tuple(int(v * 255) for v in paper))
            if al < 0.5:
                continue
            L = col.mean() * 255
            g = ramp[min(int(L * len(ramp) / 255), len(ramp) - 1)]
            d.text((x, y + 1), g, fill=tuple(int(min(255, v * 255)) for v in col), font=font)
    return tile


def update_notices(manifest, used):
    path = os.path.join(ROOT, "THIRD_PARTY_NOTICES.md")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    lines = [
        NOTICE_BEGIN,
        "## Imágenes de las piezas de escenario",
        "",
        "Las piezas de escenario (estampas) parten de fotografías en dominio público o",
        "dedicadas al dominio público (CC0), convertidas a ASCII con el algoritmo del",
        "repositorio. Las licencias se verificaron en la página de origen de cada foto.",
        "No requieren atribución; se acreditan igualmente.",
        "",
        "| Estampa | Foto | Autor | Licencia |",
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
    font = ImageFont.truetype(os.path.join(ROOT, "src", "assets", "fonts", "DejaVuSansMono-Bold.ttf"), 19)
    tiles = []
    for st in defs:
        src = sources.get(st["source"])
        if src is None:
            raise SystemExit(f"{st['id']}: fuente '{st['source']}' no está en el manifiesto")
        if src["license"] not in ALLOWED_LICENSES:
            raise SystemExit(f"{st['id']}: licencia '{src['license']}' no permitida")
        if only and st["id"] not in only:
            continue
        rgb = np.asarray(Image.open(os.path.join(ROOT, "art", src["file"])).convert("RGB"))
        mode = st["mode"]
        mask = None
        if mode == "grabcut":
            mask = mask_grabcut(rgb, st["rect"], st.get("fg", []), st.get("bg", []))
        elif mode == "key-dark":
            h, w = rgb.shape[:2]
            x0, y0, x1, y1 = st["rect"]
            mask = mask_key_dark(rgb, st.get("threshold", 0.12))
            box = np.zeros_like(mask)
            box[int(y0 * h) : int(y1 * h), int(x0 * w) : int(x1 * w)] = 1
            mask = mask * box
        else:
            raise SystemExit(f"{st['id']}: modo '{mode}' desconocido (grabcut o key-dark)")
        import cv2

        soft = cv2.GaussianBlur(mask.astype(np.float64), (3, 3), 0)  # borde suavizado
        canvas = fit_stamp(rgb, soft, st["sizeTiles"])
        a = canvas[..., 3]
        fp, cov = footprint(a, st["sizeTiles"], st.get("collision", "none") if st.get("solid") else "none")
        png = (np.round(np.clip(canvas, 0, 1) * 255)).astype(np.uint8)
        Image.fromarray(png, "RGBA").save(os.path.join(out_png, f"{st['id']}.png"), optimize=True)
        meta = {
            "id": st["id"],
            "image": f"{st['id']}.png",
            "use": st["use"],
            "sizeTiles": st["sizeTiles"],
            "cells": [st["sizeTiles"][0] * TILE_COLS, st["sizeTiles"][1] * TILE_ROWS],
            "samples": SAMPLES,
            "solid": bool(st.get("solid")),
            "footprint": fp,
            "credits": {k: src[k] for k in ("title", "author", "license", "sourceUrl")},
        }
        with open(os.path.join(out_data, f"{st['id']}.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
            f.write("\n")
        with open(os.path.join(out_data, f"{st['id']}.preview.txt"), "w", encoding="ascii", newline="\n") as f:
            f.write("\n".join(repo_preview(png)) + "\n")
        tiles.append((st["id"], contact_tile(rgb, st["rect"], mask, canvas, font)))
        print(f"{st['id']:14s} {st['use']:8s} {meta['cells'][0]}×{meta['cells'][1]} celdas  huella {fp}")
    update_notices(manifest, {s["source"] for s in defs})
    if tiles:
        os.makedirs(os.path.join(ROOT, "shots"), exist_ok=True)
        sheet = Image.new("RGB", (1100, 340 * len(tiles)), (10, 9, 20))
        d = ImageDraw.Draw(sheet)
        for i, (sid, t) in enumerate(tiles):
            sheet.paste(t, (0, i * 340))
            d.text((5, i * 340 + 3), sid, fill=(255, 255, 255))
        sheet.save(os.path.join(ROOT, "shots", "stamps-contact.png"))


if __name__ == "__main__":
    main()
