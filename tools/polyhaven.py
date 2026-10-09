"""
Descarga modelos 3D de Poly Haven (todos CC0, fotoescaneados) para el estudio de
render: glTF a 1k con sus texturas, en .cache/models/<id>/ (no se versionan; se
pueden volver a descargar). Registra cada modelo en art/manifest.json con su
autor, URL y licencia, para los créditos.

Uso:
    python -P tools/polyhaven.py boulder_01 fern_02 tree_stump_01 ...
"""
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
API = "https://api.polyhaven.com"
UA = "AsciiDreamGame/0.1 (desarrollo local; estudio de render)"


def get(url: str) -> bytes:
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 + 2 * attempt)
    raise RuntimeError("sin respuesta")


def download(asset_id: str) -> str:
    info = json.loads(get(f"{API}/info/{asset_id}"))
    files = json.loads(get(f"{API}/files/{asset_id}"))
    gltf = files["gltf"]["1k"]["gltf"]
    out_dir = os.path.join(ROOT, ".cache", "models", asset_id)
    os.makedirs(out_dir, exist_ok=True)
    main_path = os.path.join(out_dir, os.path.basename(gltf["url"]))
    if not os.path.exists(main_path):
        with open(main_path, "wb") as f:
            f.write(get(gltf["url"]))
    for rel, inc in gltf.get("include", {}).items():
        path = os.path.join(out_dir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(get(inc["url"]))
    # créditos
    man_path = os.path.join(ROOT, "art", "manifest.json")
    man = json.load(open(man_path, encoding="utf-8"))
    sid = f"ph-{asset_id}"
    entry = {
        "id": sid,
        "file": f"renders/{asset_id}",
        "title": info["name"],
        "author": ", ".join(info.get("authors", {}).keys()),
        "sourceUrl": f"https://polyhaven.com/a/{asset_id}",
        "license": "CC0-1.0",
        "via": "Poly Haven (modelo 3D fotoescaneado, render propio)",
    }
    man["sources"] = [s for s in man["sources"] if s["id"] != sid] + [entry]
    with open(man_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(man, f, ensure_ascii=False, indent=2)
        f.write("\n")
    size = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(out_dir) for fn in fns)
    print(f"{asset_id:28s} {info['name']:28s} {size / 1e6:6.1f} MB  autor: {entry['author']}")
    return main_path


if __name__ == "__main__":
    for a in sys.argv[1:]:
        download(a)
