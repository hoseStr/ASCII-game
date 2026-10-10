"""
Estudio de render para las piezas de escenario (se ejecuta DENTRO de Blender):

    blender -b --factory-startup -P tools/render_studio.py -- \
        --model .cache/models/<id>/<id>_1k.gltf --out art/renders/<id> \
        [--res 480] [--samples 48] [--exposure 1.0] [--frames 12 --wind 0.25 --wave 0.5]

Importa un modelo fotoescaneado y lo fotografía igual que el juego mira su mundo:
  - cámara ortográfica en 3/4 (elevación 50°), mirando al norte;
  - sol desde arriba a la izquierda de la pantalla (las sombras caen hacia abajo
    a la derecha, como las de los árboles y las demás piezas), con cielo de relleno;
  - escala real: el modelo de Poly Haven viene en metros.
Si el archivo trae varias variantes (conjuntos de rocas, matas…), renderiza cada
objeto raíz por separado.

Por cada variante escribe en --out:
  <n>.png          el objeto con alfa (fondo transparente); sin viento
  <n>.shadow.png   su sombra sobre el suelo (pasada con shadow catcher, el objeto
                   invisible para la cámara pero proyectando sombra), mismo encuadre
  <n>_f00.png…     con --frames: bucle de viento (la planta se mece, la base fija;
                   la ráfaga recorre la planta de izquierda a derecha)
  <n>.json         metros por píxel, tamaño y número de fotogramas
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

ELEVATION_DEG = 50.0  # cámara: grados sobre el horizonte
SUN_ELEVATION_DEG = 48.0
SUN_SCREEN_DIR = Vector((-1.0, 1.0))  # el sol viene de arriba a la izquierda de la pantalla


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--res", type=int, default=480)
    ap.add_argument("--samples", type=int, default=48)
    ap.add_argument("--frames", type=int, default=0)
    ap.add_argument("--wind", type=float, default=0.1, help="amplitud del vaivén (fracción de la altura)")
    ap.add_argument("--wave", type=float, default=0.5, help="desfase de la ráfaga a lo ancho (vueltas): las hojas no se mueven al unísono")
    ap.add_argument("--only", default="", help="renderizar solo estas variantes (índices separados por comas, p. ej. 1,2)")
    ap.add_argument("--exposure", type=float, default=1.0, help="exposición de la cámara (EV), como al fotografiar a pleno día")
    ap.add_argument("--fill", type=float, default=0.0, help="luz de relleno frontal sin sombra (energía): aclara la cara en sombra")
    ap.add_argument("--rim", type=float, default=0.0, help="luz de contorno desde atrás sin sombra (energía): perfila la silueta")
    ap.add_argument("--clip", type=float, default=0.0, help="quitar las caras por debajo de esta altura (m): suelo escaneado")
    return ap.parse_args(argv)


def reset_scene(exposure):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"  # colores de textura fieles
    scene.view_settings.look = "None"
    scene.view_settings.exposure = exposure  # sujeto bien expuesto, como en una foto de día
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    # cielo de relleno (las sombras no quedan negras puras)
    world = bpy.data.worlds.new("cielo")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.62, 0.68, 0.8, 1.0)
    bg.inputs[1].default_value = 0.55
    scene.world = world
    return scene


def mesh_roots():
    """Objetos raíz que contienen mallas (cada uno es una variante del conjunto)."""
    roots = []
    for o in bpy.context.scene.objects:
        if o.parent is None and (o.type == "MESH" or any(c.type == "MESH" for c in o.children_recursive)):
            roots.append(o)
    return sorted(roots, key=lambda o: o.name)


def meshes_of(root):
    return [o for o in [root, *root.children_recursive] if o.type == "MESH"]


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def add_shadowless_sun(scene, name, direction_to_light, energy):
    """Luz auxiliar sin sombra: solo ilumina, la sombra del suelo sigue siendo la del sol."""
    data = bpy.data.lights.new(name, type="SUN")
    data.energy = energy
    data.angle = math.radians(20.0)
    data.use_shadow = False
    obj = bpy.data.objects.new(name, data)
    obj.rotation_euler = (-direction_to_light.normalized()).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(obj)
    return obj


def setup_camera_and_sun(scene, lo, hi, fill=0.0, rim=0.0):
    # cámara: al sur del objeto, mirando al norte y hacia abajo
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    e = math.radians(ELEVATION_DEG)
    cam.rotation_euler = (math.pi / 2 - e, 0.0, 0.0)
    center = (lo + hi) / 2
    dist = 50.0
    cam.location = center + Vector((0.0, -math.cos(e) * dist, math.sin(e) * dist))
    scene.camera = cam

    # sol: arriba a la izquierda de la pantalla → en el mundo, hacia -X y +Y (norte), alto
    se = math.radians(SUN_ELEVATION_DEG)
    d2 = SUN_SCREEN_DIR.normalized()
    to_sun = Vector((d2.x * math.cos(se), d2.y * math.cos(se), math.sin(se))).normalized()
    sun_data = bpy.data.lights.new("sol", type="SUN")
    sun_data.energy = 4.2
    sun_data.angle = math.radians(4.0)  # penumbra suave
    sun = bpy.data.objects.new("sol", sun_data)
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(sun)
    # relleno: desde la cámara (de frente), para que la cara en sombra no se pierda en la noche
    if fill > 0:
        add_shadowless_sun(scene, "relleno", Vector((0.25, -math.cos(e), math.sin(e))), fill)
    # contorno: desde atrás y arriba (norte), ilumina los bordes superiores de la silueta
    if rim > 0:
        add_shadowless_sun(scene, "contorno", Vector((0.0, 1.0, 0.55)), rim)

    # encuadre: el objeto y su sombra en el suelo (proyección de las esquinas a lo largo del sol)
    pts = []
    for x in (lo.x, hi.x):
        for y in (lo.y, hi.y):
            for z in (lo.z, hi.z):
                p = Vector((x, y, z))
                pts.append(p)
                t = (p.z - lo.z) / max(to_sun.z, 1e-3)
                pts.append(p - to_sun * t)  # punto de sombra en el suelo
    inv = cam.matrix_world.inverted()
    cs = [inv @ p for p in pts]
    xs = [c.x for c in cs]
    ys = [c.y for c in cs]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    margin = 1.06
    size = max(w, h) * margin
    cam_data.ortho_scale = size
    cam_data.shift_x = ((max(xs) + min(xs)) / 2) / size
    cam_data.shift_y = ((max(ys) + min(ys)) / 2) / size
    return cam, sun, w * margin, h * margin, size


def add_shadow_catcher(scene, lo, hi):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    plane = bpy.context.active_object
    plane.scale = (max(hi.x - lo.x, hi.y - lo.y) * 8, max(hi.x - lo.x, hi.y - lo.y) * 8, 1)
    plane.is_shadow_catcher = True
    return plane


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    args = parse_args()
    # rutas absolutas: Blender resuelve las relativas de salida desde la raíz del disco
    args.out = os.path.abspath(args.out)
    os.makedirs(args.out, exist_ok=True)
    scene = reset_scene(args.exposure)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.model))
    roots = mesh_roots()
    print(f"[estudio] {len(roots)} variante(s): {[r.name for r in roots]}")
    summary = []
    only = {int(v) for v in args.only.split(",") if v.strip()}
    for vi, root in enumerate(roots):
        if only and vi not in only:
            continue
        # solo esta variante visible
        for r in roots:
            for o in [r, *r.children_recursive]:
                o.hide_render = r is not root
        objs = meshes_of(root)
        bpy.context.view_layer.update()
        lo, hi = world_bbox(objs)
        if args.clip > 0:
            # algunos escaneos traen un disco de tierra: se quitan las caras cuyo
            # vértice más alto queda por debajo de lo.z + clip
            import bmesh

            for o in objs:
                bm = bmesh.new()
                bm.from_mesh(o.data)
                mw = o.matrix_world
                kill = [f for f in bm.faces if max((mw @ v.co).z for v in f.verts) < lo.z + args.clip]
                bmesh.ops.delete(bm, geom=kill, context="FACES")
                bm.to_mesh(o.data)
                bm.free()
            bpy.context.view_layer.update()
            lo, hi = world_bbox(objs)
        # al origen, apoyada en el suelo
        offset = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
        root.location += offset
        bpy.context.view_layer.update()
        lo, hi = world_bbox(objs)

        for o in list(scene.objects):
            if o.type in ("CAMERA", "LIGHT") or o.name.startswith("Plane"):
                bpy.data.objects.remove(o, do_unlink=True)
        cam, sun, w, h, size = setup_camera_and_sun(scene, lo, hi, args.fill, args.rim)
        aspect = w / h
        res_x = args.res if aspect >= 1 else max(8, round(args.res * aspect))
        res_y = args.res if aspect < 1 else max(8, round(args.res / aspect))
        scene.render.resolution_x = res_x
        scene.render.resolution_y = res_y
        scene.render.resolution_percentage = 100
        scene.cycles.samples = args.samples
        mpp = size / max(res_x, res_y)  # metros por píxel (ortográfica)
        name = f"v{vi}"

        frames = max(0, args.frames)
        # pasada 1: objeto con alfa (con viento no hace falta: los fotogramas lo sustituyen)
        if frames <= 1:
            render_to(os.path.join(args.out, f"{name}.png"))

        # pasada 2: sombra (plano shadow catcher; el objeto invisible para la cámara)
        plane = add_shadow_catcher(scene, lo, hi)
        for o in objs:
            o.visible_camera = False
        render_to(os.path.join(args.out, f"{name}.shadow.png"))
        for o in objs:
            o.visible_camera = True
        bpy.data.objects.remove(plane, do_unlink=True)

        # pasada 3 (opcional): bucle de viento. Cada vértice se desplaza en
        # horizontal según su altura (la base no se mueve, la punta sí).
        if frames > 1:
            height = max(hi.z - lo.z, 1e-3)
            width = max(hi.x - lo.x, 1e-3)
            originals = []
            for o in objs:
                co = [0.0] * (len(o.data.vertices) * 3)
                o.data.vertices.foreach_get("co", co)
                originals.append(co)
            for k in range(frames):
                ph = 2 * math.pi * k / frames
                for o, co in zip(objs, originals):
                    mw = o.matrix_world
                    inv3 = mw.to_3x3().inverted()
                    new = list(co)
                    for i in range(0, len(co), 3):
                        wp = mw @ Vector((co[i], co[i + 1], co[i + 2]))
                        t = max(0.0, (wp.z - lo.z) / height)
                        sway = args.wind * height * (t ** 1.6)
                        # la ráfaga llega antes a la izquierda: fase según la posición en x
                        pv = ph - 2 * math.pi * args.wave * (wp.x - lo.x) / width
                        d = Vector((sway * math.sin(pv), 0.35 * sway * math.sin(pv * 2 + 0.7), 0.0))
                        local = inv3 @ d
                        new[i] += local.x
                        new[i + 1] += local.y
                        new[i + 2] += local.z
                    o.data.vertices.foreach_set("co", new)
                    o.data.update()
                render_to(os.path.join(args.out, f"{name}_f{k:02d}.png"))
            for o, co in zip(objs, originals):
                o.data.vertices.foreach_set("co", co)
                o.data.update()

        meta = {
            "variant": name,
            "object": root.name,
            "metersPerPixel": mpp,
            "size": [res_x, res_y],
            "bboxMeters": [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z],
            "frames": frames if frames > 1 else 0,
            "elevationDeg": ELEVATION_DEG,
            "exposure": args.exposure,
            "fill": args.fill,
            "rim": args.rim,
        }
        with open(os.path.join(args.out, f"{name}.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(meta, f, indent=2)
        summary.append(meta)
        root.location -= offset
    print("[estudio] listo:", json.dumps(summary))


main()
