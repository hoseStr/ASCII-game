"""
Genera los fixtures dorados del test de fidelidad (tests/ascii.test.ts).

1. Crea una imagen sintética determinista (sin contenido de terceros).
2. Ejecuta el img2txt.py ORIGINAL de ASCII-generator sobre ella, sin modificarlo.
3. Guarda los píxeles RGB crudos (gzip) y los .txt producidos en tests/fixtures/.

Requisitos: Python 3 con numpy y opencv-python-headless (los del repo original).
Uso:
    python tools/make_golden.py <ruta a ASCII-generator>
"""
import gzip
import os
import subprocess
import sys
import tempfile

import cv2
import numpy as np

W, H = 400, 240
CASES = [("complex", 150), ("complex", 97), ("simple", 100), ("complex", 450)]


def synthetic_image() -> np.ndarray:
    rng = np.random.default_rng(20261009)
    y, x = np.mgrid[0:H, 0:W].astype(np.float64)
    r = 255 * x / (W - 1)
    g = 255 * y / (H - 1)
    d = np.hypot(x - W * 0.62, y - H * 0.45)
    b = 255 * np.clip(1 - d / 170, 0, 1)
    img = np.stack([r, g, b], axis=-1)
    # discos de brillo variado (bordes duros: cruzan umbrales de la rampa)
    for k, (cx, cy, rad) in enumerate([(75, 60, 32), (190, 165, 45), (325, 80, 26), (350, 200, 35)]):
        mask = np.hypot(x - cx, y - cy) < rad
        img[mask] = [(60 * k + 40) % 256, (200 - 45 * k) % 256, (90 * k + 10) % 256]
    # ondas y ruido: cubren todo el rango de la rampa
    img += 40 * np.sin(x / 6.0)[..., None] * np.cos(y / 9.0)[..., None]
    img += rng.normal(0, 10, size=img.shape)
    return np.clip(np.round(img), 0, 255).astype(np.uint8)


def main() -> None:
    repo = os.path.abspath(sys.argv[1])
    out_dir = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures")
    os.makedirs(out_dir, exist_ok=True)
    rgb = synthetic_image()
    with gzip.open(os.path.join(out_dir, f"synthetic_{W}x{H}.rgb.gz"), "wb", compresslevel=9) as f:
        f.write(rgb.tobytes())
    with tempfile.TemporaryDirectory() as tmp:
        png = os.path.join(tmp, "synthetic.png")
        cv2.imwrite(png, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))  # PNG: sin pérdida
        for mode, cols in CASES:
            txt = os.path.join(tmp, f"{mode}_{cols}.txt")
            subprocess.run(
                [sys.executable, "img2txt.py", "--input", png, "--output", txt, "--mode", mode, "--num_cols", str(cols)],
                cwd=repo,
                check=True,
            )
            with open(txt, "r", encoding="ascii") as src:
                lines = src.read().splitlines()
            with open(os.path.join(out_dir, f"golden_{mode}_{cols}.txt"), "w", encoding="ascii", newline="\n") as dst:
                dst.write("\n".join(lines) + "\n")
            print(f"{mode} {cols}: {len(lines[0])}x{len(lines)}")


if __name__ == "__main__":
    main()
