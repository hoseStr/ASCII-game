"""
Busca imágenes con licencia libre (CC0 o dominio público) para el pipeline de
estampas. Fuentes: Openverse (agregador con filtro de licencia) y Wikimedia
Commons. La licencia se vuelve a comprobar en la página del archivo antes de
anotarla en art/manifest.json.

Uso:
    python -P tools/find_images.py "mushroom" [--source openverse|commons] [--png] [--limit 30] [--json salida.json]
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "AsciiDreamGame/0.1 (desarrollo local; pipeline de estampas ASCII)"
ALLOWED = re.compile(r"^(cc0|pdm|public domain|pd\b|pd-)", re.I)


def get_json(url: str) -> dict:
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or attempt == 4:
                raise
            time.sleep(2 + 3 * attempt)
    raise RuntimeError("sin respuesta")


def search_openverse(query: str, limit: int, png: bool) -> list[dict]:
    params = {"q": query, "license": "cc0,pdm", "page_size": str(min(limit, 20)), "mature": "false"}
    if png:
        params["extension"] = "png"
    else:
        params["category"] = "photograph"
    data = get_json("https://api.openverse.org/v1/images/?" + urllib.parse.urlencode(params))
    out = []
    for r in data.get("results", []):
        out.append(
            {
                "title": r.get("title") or "",
                "license": r.get("license", "") + (" " + r.get("license_version", "") if r.get("license_version") else ""),
                "allowed": r.get("license") in ("cc0", "pdm"),
                "artist": r.get("creator") or "",
                "width": r.get("width"),
                "height": r.get("height"),
                "mime": "image/" + (r.get("filetype") or "?"),
                "page": r.get("foreign_landing_url"),
                "url": r.get("url"),
                "provider": r.get("provider"),
                "id": r.get("id"),
                "thumb": r.get("thumbnail"),
            }
        )
    return out


def search_commons(query: str, limit: int, png: bool) -> list[dict]:
    if png:
        query += " filemime:image/png"
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrnamespace": "6",
        "gsrlimit": str(limit),
        "gsrsearch": query,
        "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata",
        "iiextmetadatafilter": "LicenseShortName|Artist",
    }
    data = get_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
    out = []
    for pg in sorted(data.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 0)):
        info = pg.get("imageinfo", [{}])[0]
        meta = info.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        out.append(
            {
                "title": pg["title"],
                "license": lic,
                "allowed": bool(ALLOWED.search(lic)),
                "artist": re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip(),
                "width": info.get("width"),
                "height": info.get("height"),
                "mime": info.get("mime") or "",
                "page": info.get("descriptionurl"),
                "url": info.get("url"),
                "provider": "wikimedia",
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--source", choices=["openverse", "commons"], default="openverse")
    ap.add_argument("--png", action="store_true", help="solo PNG (suelen traer transparencia)")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--json", help="guardar los resultados permitidos en este archivo")
    a = ap.parse_args()
    fn = search_openverse if a.source == "openverse" else search_commons
    ok = [r for r in fn(a.query, a.limit, a.png) if r["allowed"]]
    for i, r in enumerate(ok):
        print(f"{i:2d} {r['license'][:12]:12s} {r['width']}x{r['height']} {r['mime'][6:]:5s} {r['provider'] or '':10s} {r['title'][:70]}")
    print(f"-- {len(ok)} con licencia permitida", file=sys.stderr)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(ok, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
