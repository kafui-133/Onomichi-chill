"""天寧寺の三重塔（尾道・海雲塔）を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方（画面なしの Blender。pip の bpy でも、blender --background --python でも動く）:
    python tools/blender/pagoda.py                 → assets/models/pagoda.glb
    python tools/blender/pagoda.py --preview a.png → 書き出しに加えて、確認用の絵を描く

  寸法はおおよそ実物どおり（高さ約24m）。1m = 1。上は +Z（glTF では +Y になる）。
  色はトゥーン調の絵に合わせて、ベタ塗りの素材を少しだけ使う。
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'models', 'pagoda.glb')

# ---------- 素材 ----------
def material(name, rgb, rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m

def srgb(h):
    """'#rrggbb' を Blender のリニア色に"""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

M = {}

def mats():
    M['wood'] = material('wood', srgb('#5b3a28'))        # 古びた木（柱・組物）
    M['wood_dark'] = material('wood_dark', srgb('#3c261b'))  # 扉・軒裏の陰
    M['plaster'] = material('plaster', srgb('#e6dfd0'))   # 白い壁
    M['tile'] = material('tile', srgb('#41464e'))         # 瓦
    M['tile_dark'] = material('tile_dark', srgb('#33373e'))  # 瓦の筋
    M['ridge'] = material('ridge', srgb('#585e66'))       # 隅棟
    M['under'] = material('under', srgb('#6a4630'))       # 軒裏（垂木）
    M['stone'] = material('stone', srgb('#9a958a'), rough=0.95)
    M['bronze'] = material('bronze', srgb('#55634f'), rough=0.6, metal=0.4)  # 相輪（青銅）
    M['gold'] = material('gold', srgb('#b08a3a'), rough=0.5, metal=0.6)

# ---------- かたち ----------
parts = []

def add(obj, mat):
    obj.data.materials.append(M[mat])
    parts.append(obj)
    return obj

def box(sx, sy, sz, x=0, y=0, z=0, mat='wood', rz=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + sz / 2))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    o.rotation_euler[2] = rz
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return add(o, mat)

def cyl(r, h, x=0, y=0, z=0, mat='bronze', verts=16, r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h, location=(x, y, z + h / 2))
    return add(bpy.context.active_object, mat)

def sphere(r, x=0, y=0, z=0, mat='bronze', seg=16, sz=1.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=(x, y, z))
    o = bpy.context.active_object
    o.scale[2] = sz
    bpy.ops.object.transform_apply(scale=True)
    return add(o, mat)

def torus(R, r, z, mat='bronze'):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=20, minor_segments=6, location=(0, 0, z))
    return add(bpy.context.active_object, mat)

def ring_of_boxes(half, w, h, z, mat):
    """正方形のふちに沿った、四辺の角材（組物や梁）"""
    for k in range(4):
        a = k * math.pi / 2
        cx, cy = math.cos(a) * half, math.sin(a) * half
        sx, sy = (w, half * 2 + w) if k % 2 == 0 else (half * 2 + w, w)
        box(sx, sy, h, cx, cy, z, mat)

def story(width, height, z, doors=True):
    """塔身：白い壁に、柱（各辺4本、3間）と頭貫、中の間に板扉"""
    box(width, width, height, 0, 0, z, 'plaster')
    half = width / 2
    for k in range(4):
        a = k * math.pi / 2
        nx, ny = math.cos(a), math.sin(a)
        tx, ty = -ny, nx
        for t in (-1.5, -0.5, 0.5, 1.5):
            off = t * width / 3
            px, py = nx * (half + 0.02) + tx * off, ny * (half + 0.02) + ty * off
            box(0.32, 0.32, height, px, py, z, 'wood')
        if doors:
            # 中の間の板扉（観音開き、2枚）
            dw = width / 3 - 0.4
            for s in (-0.25, 0.25):
                box(0.06 if k % 2 == 0 else dw / 2, dw / 2 if k % 2 == 0 else 0.06, height * 0.72,
                    nx * (half + 0.05) + tx * s * dw, ny * (half + 0.05) + ty * s * dw, z + 0.15, 'wood_dark')
        # 腰の長押（地覆）
    ring_of_boxes(half + 0.06, 0.24, 0.3, z + height - 0.32, 'wood')   # 頭貫
    ring_of_boxes(half + 0.06, 0.2, 0.18, z, 'wood')                   # 地覆

def brackets(width, z):
    """組物：外へ張り出していく角材を3段（三手先）。上に丸桁"""
    half = width / 2
    for i in range(3):
        ring_of_boxes(half + 0.25 + i * 0.42, 0.34, 0.3, z + i * 0.32, 'wood')
        # 段ごとの斗（小さな角）
        for k in range(4):
            a = k * math.pi / 2
            nx, ny = math.cos(a), math.sin(a)
            tx, ty = -ny, nx
            for t in (-1.5, -0.5, 0.5, 1.5):
                off = t * width / 3
                d = half + 0.25 + i * 0.42
                box(0.36, 0.36, 0.22, nx * d + tx * off, ny * d + ty * off, z + i * 0.32 - 0.2, 'wood')
    return z + 3 * 0.32

def roof(core, eave, z_top, rise, lift=0.75, n=24):
    """反りのある方形の屋根。軒は深く、四隅が反り上がる。瓦の筋は面ごとに色を分ける"""
    bm = bmesh.new()
    verts = {}
    for i in range(n + 1):
        for j in range(n + 1):
            x = (i / n * 2 - 1) * eave
            y = (j / n * 2 - 1) * eave
            m = max(abs(x), abs(y))
            r0 = core / eave
            t = max(0.0, (m / eave - r0) / (1 - r0))
            d = (min(abs(x), abs(y)) / m) if m > 1e-6 else 0.0
            # 上は急で、軒先にいくほどゆるやか（反り）。四隅はさらに反り上がる
            zz = z_top - rise * (1 - (1 - t) ** 2.1) + lift * (t ** 3) * (d ** 6)
            grow = 1 + 0.07 * (t ** 2) * (d ** 4)  # 隅は平面でも少し外へ伸びる
            verts[(i, j)] = bm.verts.new((x * grow, y * grow, zz))
    for i in range(n):
        for j in range(n):
            f = bm.faces.new((verts[(i, j)], verts[(i + 1, j)], verts[(i + 1, j + 1)], verts[(i, j + 1)]))
            cx = ((i + 0.5) / n * 2 - 1)
            cy = ((j + 0.5) / n * 2 - 1)
            along = cy if abs(cx) > abs(cy) else cx   # 軒先に沿う向き
            f.material_index = 1 if int((along + 1) * n / 2) % 2 else 0
    me = bpy.data.meshes.new('roof')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('roof', me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(M['tile'])
    o.data.materials.append(M['tile_dark'])
    o.data.materials.append(M['under'])
    # 厚み（軒先の厚い瓦と、裏の垂木）
    sol = o.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = 0.32
    sol.offset = -1
    sol.material_offset = 2
    sol.material_offset_rim = 2
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='solid')
    parts.append(o)
    # 隅棟（四隅の稜線）
    for k in range(4):
        sx, sy = (1 if k in (0, 3) else -1), (1 if k in (0, 1) else -1)
        prev = None
        steps = 10
        for s in range(steps + 1):
            t = s / steps
            m = core + (eave - core) * t
            zz = z_top - rise * (1 - (1 - t) ** 2.1) + lift * (t ** 3)
            grow = 1 + 0.07 * (t ** 2)
            p = Vector((sx * m * grow, sy * m * grow, zz + 0.12))
            if prev is not None:
                mid = (p + prev) / 2
                dv = p - prev
                bpy.ops.mesh.primitive_cube_add(size=1, location=mid)
                b = bpy.context.active_object
                b.scale = (dv.length + 0.05, 0.26, 0.24)
                b.rotation_mode = 'QUATERNION'
                b.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(dv.normalized())
                bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
                add(b, 'ridge')
            prev = p

def balcony(width, z):
    """2・3層目の縁と高欄"""
    half = width / 2 + 0.75
    ring_of_boxes(half - 0.35, 0.9, 0.12, z - 0.12, 'wood')     # 縁の板
    ring_of_boxes(half, 0.08, 0.08, z + 0.72, 'wood')           # 架木（手すり）
    ring_of_boxes(half, 0.06, 0.06, z + 0.35, 'wood')           # 平桁
    for k in range(4):
        a = k * math.pi / 2
        nx, ny = math.cos(a), math.sin(a)
        tx, ty = -ny, nx
        for t in range(-4, 5):
            off = t * half / 4
            box(0.09, 0.09, 0.78, nx * half + tx * off, ny * half + ty * off, z, 'wood')

def build():
    mats()
    # 基壇（石）と、正面の石段
    box(8.2, 8.2, 0.9, 0, 0, 0, 'stone')
    box(2.6, 1.4, 0.45, 0, -4.8, 0, 'stone')
    box(2.6, 0.7, 0.45, 0, -4.45, 0.45, 'stone')
    z = 0.9
    stories = [(5.4, 3.5), (4.6, 2.9), (3.9, 2.7)]
    for i, (w, h) in enumerate(stories):
        if i > 0:
            balcony(w, z)
        story(w, h, z, doors=True)
        z_b = brackets(w, z + h)
        eave = w / 2 + 2.55 - i * 0.25
        rise = 1.75 - i * 0.1
        roof(core=w / 2 + 0.2, eave=eave, z_top=z_b + rise, rise=rise)
        z = z_b + rise - 0.1  # 次の層は、屋根の上から
    # 相輪：露盤、伏鉢、請花、九輪、水煙、竜車、宝珠
    box(1.5, 1.5, 0.45, 0, 0, z, 'bronze')
    sphere(0.62, 0, 0, z + 0.45, 'bronze', sz=0.7)
    cyl(0.5, 0.25, 0, 0, z + 0.8, 'bronze', r2=0.6)
    cyl(0.07, 6.4, 0, 0, z + 0.9, 'bronze', verts=10)   # 心柱
    for k in range(9):
        torus(0.58 - k * 0.012, 0.07, z + 1.35 + k * 0.38, 'bronze')
    zz = z + 1.35 + 9 * 0.38
    for a in (0, math.pi / 2):
        box(1.25 if a == 0 else 0.05, 0.05 if a == 0 else 1.25, 1.2, 0, 0, zz, 'bronze', rz=0)
    sphere(0.2, 0, 0, zz + 1.45, 'gold')
    sphere(0.17, 0, 0, zz + 1.8, 'gold', sz=1.25)
    cyl(0.03, 0.3, 0, 0, zz + 1.95, 'gold', verts=8, r2=0.0)
    return zz + 2.25

def join_all():
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = 'tenneiji_pagoda'
    # 同じ素材をまとめる
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.object.mode_set(mode='OBJECT')
    return o

def export(o):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_texcoords=False)
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')

def preview(path, height):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 24
    sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 900, 1200
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.68, 0.85, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    sc.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    bpy.context.collection.objects.link(sun)
    ground = bpy.data.objects.new('ground', bpy.data.meshes.new('g'))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40)
    bm.to_mesh(ground.data)
    bm.free()
    ground.data.materials.append(material('grass', srgb('#7a8a5a')))
    bpy.context.collection.objects.link(ground)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 32
    cam.location = (19, -23, 7)
    target = Vector((0, 0, height * 0.45))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('preview', path)

if __name__ == '__main__':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    h = build()
    o = join_all()
    print('height', round(h, 2), 'faces', len(o.data.polygons))
    export(o)
    if '--preview' in sys.argv:
        preview(os.path.abspath(sys.argv[sys.argv.index('--preview') + 1]), h)
