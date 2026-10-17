"""千光寺（尾道・千光寺山）の本堂「赤堂」と鐘楼「驚音楼」を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方（画面なしの Blender。pip の bpy でも、blender --background --python でも動く）:
    python tools/blender/senkoji.py                 → assets/models/senkoji.glb
    python tools/blender/senkoji.py --preview a.png → 書き出しに加えて、確認用の絵を描く

  寸法はおおよそ実物どおり。1m = 1。上は +Z（glTF では +Y になる）。
  原点は本堂の床の中心の、山側の地面の高さ。本堂の正面（海側）は -Y（glTF では +Z）。
  崖に張り出した懸造りなので、海側の束柱は z = -6 くらいまで下へのびる（町では地面に埋めて置く）。
  鐘楼は +X 側に約11m、大きな岩（玉の岩など）は本堂のうしろ（+Y）。
"""
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'models', 'senkoji.glb')

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
    M['vermilion'] = material('vermilion', srgb('#b03a28'))      # 朱塗りの柱・梁
    M['vermilion_wall'] = material('vermilion_wall', srgb('#8c2e22'))  # 朱の板壁（少し暗く）
    M['under'] = material('under', srgb('#9a3a28'))              # 軒裏（朱の垂木）
    M['wood_dark'] = material('wood_dark', srgb('#3a2a22'))      # 格子戸・束柱の古い木
    M['deck'] = material('deck', srgb('#6e5848'))                # 舞台の床板
    M['plaster'] = material('plaster', srgb('#e8e0d0'))          # 白い小壁
    M['tile'] = material('tile', srgb('#3a3f46'))                # 瓦
    M['tile_dark'] = material('tile_dark', srgb('#30343a'))      # 瓦の筋
    M['ridge'] = material('ridge', srgb('#4c5258'))              # 棟
    M['stone'] = material('stone', srgb('#9a958a'), rough=0.95)  # 石の基壇
    M['rock'] = material('rock', srgb('#8a857a'), rough=0.95)    # 大岩
    M['bronze'] = material('bronze', srgb('#55634f'), rough=0.6, metal=0.4)  # 梵鐘

# ---------- かたち ----------
parts = []

def add(obj, mat):
    obj.data.materials.append(M[mat])
    parts.append(obj)
    return obj

def box(sx, sy, sz, x=0, y=0, z=0, mat='vermilion', rz=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + sz / 2))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    o.rotation_euler[2] = rz
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return add(o, mat)

def cyl(r, h, x=0, y=0, z=0, mat='vermilion', verts=10, r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h, location=(x, y, z + h / 2))
    return add(bpy.context.active_object, mat)

def beam(a, b, w, h, mat):
    """2点のあいだに渡す角材"""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cube_add(size=1, location=(a + b) / 2)
    o = bpy.context.active_object
    o.scale = (d.length, w, h)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(d.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return add(o, mat)

def mesh_obj(name, verts, faces, mat_names, mat_index=None, thickness=0.0, under=None):
    """頂点と面から物体を作る。thickness があれば厚み（裏の素材は under）"""
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    for n in mat_names:
        o.data.materials.append(M[n])
    if under:
        o.data.materials.append(M[under])
    if mat_index:
        for p, k in zip(o.data.polygons, mat_index):
            p.material_index = k
    if thickness:
        # 屋根はなめらかな陰影に（頂点を共有できるので、ファイルも軽くなる）
        for p in o.data.polygons:
            p.use_smooth = True
        sol = o.modifiers.new('solid', 'SOLIDIFY')
        sol.thickness = thickness
        sol.offset = -1
        if under:
            sol.material_offset = len(mat_names)
            sol.material_offset_rim = len(mat_names)
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier='solid')
        o.select_set(False)
    parts.append(o)
    return o

# ---------- 入母屋の屋根 ----------
def irimoya(ex, ey, ze, gx, gy, zm, zr, lift=0.55, ns=10, nt=5, thick=0.28, gable_over=0.45):
    """入母屋屋根。
      下の寄棟部分：軒先の長方形（半幅 ex, ey、高さ ze）から、上の長方形（gx, gy、高さ zm）へ。反りと隅の反り上がりつき
      上の切妻部分：y = ±gy から棟（y = 0、高さ zr）へ。妻（x = ±gx）は白壁と木の三角
    """
    outer = [(-ex, -ey), (ex, -ey), (ex, ey), (-ex, ey)]
    inner = [(-gx, -gy), (gx, -gy), (gx, gy), (-gx, gy)]
    verts, faces, mi = [], [], []
    for k in range(4):
        oa, ob = outer[k], outer[(k + 1) % 4]
        ia, ib = inner[k], inner[(k + 1) % 4]
        base = len(verts)
        for j in range(nt + 1):
            t = j / nt
            for i in range(ns + 1):
                s = i / ns
                ox, oy = oa[0] + (ob[0] - oa[0]) * s, oa[1] + (ob[1] - oa[1]) * s
                ix, iy = ia[0] + (ib[0] - ia[0]) * s, ia[1] + (ib[1] - ia[1]) * s
                x, y = ox + (ix - ox) * t, oy + (iy - oy) * t
                c = abs(2 * s - 1) ** 6
                # 軒先はゆるく、上へいくほど急に（反り）。隅は少し反り上がって外へのびる
                z = ze + (zm - ze) * (t ** 1.7) + lift * ((1 - t) ** 2) * c
                grow = 1 + 0.05 * ((1 - t) ** 2) * c
                verts.append((x * grow, y * grow, z))
        for j in range(nt):
            for i in range(ns):
                a = base + j * (ns + 1) + i
                faces.append((a, a + 1, a + ns + 2, a + ns + 1))
                mi.append(0)
    # 切妻の2面（瓦の筋は棟に向かう）
    for sy in (-1, 1):
        base = len(verts)
        ng = 6
        for j in range(3):
            t = j / 2
            for i in range(ng + 1):
                x = -gx - gable_over + (2 * (gx + gable_over)) * i / ng
                y = sy * gy * (1 - t)
                z = zm + (zr - zm) * (t ** 1.2) + 0.02
                verts.append((x, y, z))
        for j in range(2):
            for i in range(ng):
                a = base + j * (ng + 1) + i
                f = (a, a + 1, a + ng + 2, a + ng + 1)
                faces.append(f if sy < 0 else f[::-1])
                mi.append(0)
    mesh_obj('roof', verts, faces, ['tile', 'tile_dark'], mi, thickness=thick, under='under')
    # 妻壁（白い三角と、木の格子）
    for sx in (-1, 1):
        x = sx * gx
        tri = [(x, -gy, zm), (x, gy, zm), (x, 0, zr - 0.15)]
        mesh_obj('tsuma', tri, [(0, 1, 2) if sx > 0 else (2, 1, 0)], ['plaster'])
        beam((x + sx * 0.05, -gy, zm + 0.1), (x + sx * 0.05, gy, zm + 0.1), 0.16, 0.18, 'vermilion')
        beam((x + sx * 0.05, 0, zm + 0.1), (x + sx * 0.05, 0, zr - 0.2), 0.14, 0.14, 'vermilion')
        # 破風板（妻のふち）
        for sy in (-1, 1):
            beam((x + sx * 0.5, sy * (gy + 0.15), zm - 0.05), (x + sx * 0.5, 0, zr + 0.05), 0.12, 0.34, 'wood_dark')
    # 大棟と鬼瓦
    box(2 * gx + 2 * gable_over + 0.4, 0.42, 0.45, 0, 0, zr - 0.05, 'ridge')
    for sx in (-1, 1):
        box(0.3, 0.6, 0.85, sx * (gx + gable_over + 0.25), 0, zr - 0.1, 'ridge')
    # 隅棟（軒の四隅から、上の長方形の角へ）
    for (ox, oy), (ix, iy) in zip(outer, inner):
        prev = None
        for s in range(4):
            t = s / 3
            c = 1.0
            z = ze + (zm - ze) * (t ** 1.7) + lift * ((1 - t) ** 2) * c + 0.15
            grow = 1 + 0.05 * ((1 - t) ** 2)
            p = Vector(((ox + (ix - ox) * t) * grow, (oy + (iy - oy) * t) * grow, z))
            if prev is not None:
                beam(prev, p, 0.26, 0.24, 'ridge')
            prev = p
    # 降棟（切妻のふち）
    for sx in (-1, 1):
        for sy in (-1, 1):
            beam((sx * (gx + gable_over), sy * gy, zm + 0.12), (sx * (gx + gable_over), 0, zr + 0.05), 0.22, 0.22, 'ridge')

def kohai(w, y0, z0, y1, z1, n=6, nt=4):
    """向拝（正面に張り出した屋根）。軒先の中ほどがわずかに反り上がる"""
    verts, faces, mi = [], [], []
    for j in range(nt + 1):
        t = j / nt
        for i in range(n + 1):
            s = i / n
            x = (s * 2 - 1) * w / 2
            y = y0 + (y1 - y0) * t
            z = z0 + (z1 - z0) * (1 - (1 - t) ** 1.4) + 0.25 * (t ** 3) * (abs(2 * s - 1) ** 4)
            verts.append((x, y, z))
    for j in range(nt):
        for i in range(n):
            a = j * (n + 1) + i
            faces.append((a, a + n + 1, a + n + 2, a + 1))
            mi.append(0)
    mesh_obj('kohai', verts, faces, ['tile', 'tile_dark'], mi, thickness=0.24, under='under')

# ---------- 本堂 ----------
FLOOR = 0.6          # 床の高さ（山側の地面から）
HW, HD = 4.5, 4.0     # 本堂の身舎の半幅・半奥行き
STAGE_Y = -8.4        # 舞台の先（海側）
STAGE_X = 6.4         # 縁の外側

def ground(y):
    """懸造りの下の地面（海側へ下る崖）"""
    return 0.0 if y >= 0 else -6.0 * min(1.0, -y / 8.2) ** 0.9

def stilts():
    """舞台を支える束柱と、縦横の貫"""
    xs = [-6.2, -3.1, 0.0, 3.1, 6.2]
    ys = [-8.2, -6.0, -3.8, -1.6, 0.6]
    for y in ys:
        g = ground(y)
        for x in xs:
            cyl(0.22, FLOOR - (g - 1.0), x, y, g - 1.0, 'wood_dark', verts=6)
    for z in (-1.2, -3.2, -5.0):
        for y in ys:
            if ground(y) < z - 0.3:
                beam((xs[0], y, z), (xs[-1], y, z), 0.14, 0.22, 'wood_dark')
        for x in xs:
            for ya, yb in zip(ys, ys[1:]):
                if ground(yb) < z - 0.3:
                    beam((x, ya, z), (x, yb, z), 0.14, 0.22, 'wood_dark')
    # 床下の大引
    for y in ys:
        box(2 * STAGE_X, 0.3, 0.3, 0, y, FLOOR - 0.55, 'wood_dark')

def stage():
    """舞台（床板）と高欄"""
    box(2 * STAGE_X + 0.2, 4.0 - STAGE_Y + 0.6, 0.25, 0, (4.0 + STAGE_Y) / 2, FLOOR - 0.25, 'deck')
    # 高欄：正面と両わき（うしろは山）
    rail_h = 1.0
    corners = [(-STAGE_X, 4.0), (-STAGE_X, STAGE_Y), (STAGE_X, STAGE_Y), (STAGE_X, 4.0)]
    for a, b in zip(corners, corners[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, round(L / 2.4))
        for k in range(n + 1):
            t = k / n
            box(0.14, 0.14, rail_h + 0.1, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, FLOOR, 'vermilion')
        for zz, w in ((rail_h, 0.12), (rail_h * 0.5, 0.08)):
            beam((a[0], a[1], FLOOR + zz), (b[0], b[1], FLOOR + zz), w, w, 'vermilion')
        beam((a[0], a[1], FLOOR + 0.06), (b[0], b[1], FLOOR + 0.06), 0.1, 0.14, 'vermilion')

def hall():
    z0, H = FLOOR, 4.2
    box(2 * HW - 0.1, 2 * HD - 0.1, H, 0, 0, z0, 'vermilion_wall')
    # 柱：正面7本（6間）、側面5本
    for x in [-HW + 1.5 * k for k in range(7)]:
        for y in (-HD, HD):
            box(0.34, 0.34, H, x, y, z0, 'vermilion')
    for y in [-HD + 2 * k for k in range(1, 4)]:
        for x in (-HW, HW):
            box(0.34, 0.34, H, x, y, z0, 'vermilion')
    # 正面の中央3間は格子戸（黒い木の縦格子）
    for bay in (-1, 0, 1):
        cx = bay * 1.5
        box(1.2, 0.06, 2.6, cx, -HD - 0.03, z0 + 0.3, 'wood_dark')
        for k in range(5):
            box(0.05, 0.08, 2.6, cx - 0.48 + k * 0.24, -HD - 0.09, z0 + 0.3, 'vermilion')
        for zz in (0.3, 1.6, 2.9):
            box(1.2, 0.09, 0.06, cx, -HD - 0.1, z0 + zz, 'vermilion')
    # 長押と、上の白い小壁
    for zz, hh in ((0.0, 0.2), (2.9, 0.22), (H - 0.35, 0.35)):
        box(2 * HW + 0.2, 2 * HD + 0.2, hh, 0, 0, z0 + zz, 'vermilion')
    for y in (-HD - 0.06, HD + 0.06):
        box(2 * HW - 0.2, 0.04, 0.7, 0, y, z0 + 3.12, 'plaster')
    for x in (-HW - 0.06, HW + 0.06):
        box(0.04, 2 * HD - 0.2, 0.7, x, 0, z0 + 3.12, 'plaster')
    # 組物（出組）：柱の上で外へ張り出す、2段の角材
    zt = z0 + H
    for i in range(2):
        d = 0.35 + i * 0.4
        box(2 * HW + 2 * d, 2 * HD + 2 * d, 0.26, 0, 0, zt + i * 0.26, 'vermilion')
    return zt + 0.52

def bell_tower(cx, cy):
    """鐘楼「驚音楼」：石の基壇に朱の柱4本、小さな入母屋屋根、梵鐘"""
    box(4.2, 4.2, 0.7, cx, cy, -0.3, 'stone')
    z0 = 0.4
    H = 3.3
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(0.17, H, cx + sx * 1.45, cy + sy * 1.45, z0, 'vermilion', verts=10, r2=0.15)
    for zz in (1.2, H - 0.3):
        for sy in (-1, 1):
            box(3.2, 0.16, 0.24, cx, cy + sy * 1.45, z0 + zz, 'vermilion')
            box(0.16, 3.2, 0.24, cx + sy * 1.45, cy, z0 + zz, 'vermilion')
    box(3.6, 3.6, 0.22, cx, cy, z0 + H, 'vermilion')
    # 梵鐘
    zb = z0 + H - 0.45
    cyl(0.62, 1.35, cx, cy, zb - 1.35, 'bronze', verts=10, r2=0.48)
    cyl(0.68, 0.14, cx, cy, zb - 1.35, 'bronze', verts=10)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=5, radius=0.48, location=(cx, cy, zb))
    o = bpy.context.active_object
    o.scale[2] = 0.45
    bpy.ops.object.transform_apply(scale=True)
    add(o, 'bronze')
    box(0.16, 0.16, 0.4, cx, cy, zb + 0.1, 'bronze')
    # 屋根（基準の位置で作ってずらす）
    n0 = len(parts)
    irimoya(ex=2.75, ey=2.75, ze=z0 + H + 0.2, gx=1.0, gy=1.0, zm=z0 + H + 1.25, zr=z0 + H + 2.05, lift=0.45, ns=10, nt=5, thick=0.2, gable_over=0.3)
    for o in parts[n0:]:
        o.location.x += cx
        o.location.y += cy
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.transform_apply(location=True)
        o.select_set(False)

def rock(x, y, z, r, sx=1.0, sy=1.0, sz=1.0, seed=0):
    """ごつごつした大岩（荒い多面体）"""
    rnd = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=(x, y, z))
    o = bpy.context.active_object
    for v in o.data.vertices:
        v.co *= 0.82 + rnd.random() * 0.3
    o.scale = (sx, sy, sz)
    o.rotation_euler = (rnd.random() * 0.5, rnd.random() * 0.5, rnd.random() * 6.28)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return add(o, 'rock')

def build():
    mats()
    stilts()
    stage()
    z_top = hall()
    # 入母屋の大屋根。尾根は床から約9m
    irimoya(ex=HW + 2.0, ey=HD + 1.9, ze=z_top + 0.1, gx=2.8, gy=1.8, zm=z_top + 2.3, zr=FLOOR + 9.2)
    # 向拝と、それを支える朱の柱2本
    ky0, kz0, ky1, kz1 = -HD - 0.6, z_top + 0.2, -HD - 4.0, z_top - 0.95
    kohai(5.0, ky0, kz0, ky1, kz1)
    for sx in (-1, 1):
        box(0.3, 0.3, kz1 - FLOOR - 0.2, sx * 2.0, ky1 + 0.45, FLOOR, 'vermilion')
        beam((sx * 2.0, ky1 + 0.45, kz1 - 0.35), (sx * 2.0, -HD, kz1 - 0.35), 0.2, 0.24, 'vermilion')   # 海老虹梁の代わり
    box(4.6, 0.26, 0.32, 0, ky1 + 0.45, kz1 - 0.42, 'vermilion')
    # 正面の石段（山側からではなく、舞台の脇から上がる、小さな段）
    for k in range(3):
        box(1.6, 0.4, 0.2, STAGE_X + 0.9, 3.0 - k * 0.4, k * 0.2, 'stone')
    # 鐘楼
    bell_tower(11.0, 1.0)
    # 本堂のうしろの大岩（玉の岩など）
    rock(-3.5, 9.0, 1.4, 3.0, 1.4, 1.0, 0.8, seed=1)
    rock(3.5, 10.5, 2.2, 3.8, 1.2, 1.1, 0.9, seed=2)
    rock(3.0, 10.0, 6.6, 1.9, 1.0, 1.0, 0.95, seed=3)   # 上に載った丸い岩（玉の岩）
    rock(-8.5, 6.5, 0.6, 2.2, 1.3, 1.0, 0.7, seed=4)
    rock(8.0, 8.0, 0.8, 2.4, 1.1, 1.3, 0.7, seed=5)
    return FLOOR + 9.6

def join_all():
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = 'senkoji_hondo'
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
    sc.render.resolution_x, sc.render.resolution_y = 900, 700
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.68, 0.85, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    sc.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    bpy.context.collection.objects.link(sun)
    # 確認用の地面：山側は平ら、海側は崖
    bm = bmesh.new()
    ys = [20 - k * 2 for k in range(21)]
    rows = []
    for y in ys:
        rows.append([bm.verts.new((x, y, ground(y) if y > -9 else ground(-8.2) - (-9 - y) * 0.5)) for x in range(-24, 26, 4)])
    for ra, rb in zip(rows, rows[1:]):
        for i in range(len(ra) - 1):
            bm.faces.new((ra[i], ra[i + 1], rb[i + 1], rb[i]))
    me = bpy.data.meshes.new('g')
    bm.to_mesh(me)
    bm.free()
    ground_o = bpy.data.objects.new('ground', me)
    ground_o.data.materials.append(material('grass', srgb('#7a8a5a')))
    bpy.context.collection.objects.link(ground_o)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 28
    cam.location = (-17, -28, 0.5)
    target = Vector((1.5, 0, 2.5))
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
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    print('bounds x', round(min(v.x for v in bb), 2), round(max(v.x for v in bb), 2),
          'y', round(min(v.y for v in bb), 2), round(max(v.y for v in bb), 2),
          'z', round(min(v.z for v in bb), 2), round(max(v.z for v in bb), 2))
    export(o)
    if '--preview' in sys.argv:
        preview(os.path.abspath(sys.argv[sys.argv.index('--preview') + 1]), h)
