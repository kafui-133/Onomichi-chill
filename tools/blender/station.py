"""JR尾道駅（2019年に建てかえた駅舎）を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方（画面なしの Blender。pip の bpy でも、blender --background --python でも動く）:
    python tools/blender/station.py                 → assets/models/station.glb
    python tools/blender/station.py --preview a.png → 書き出しに加えて、確認用の絵を描く

  寸法はおおよそ（間口48m × 奥行20m、軒の高さ約8m、棟の高さ約9.5m）。1m = 1。上は +Z。
  原点は1階の床の高さで、建物の中心。駅前広場（海側）の入口は -Y を向く（glTF では +Z）。
  ガラスの素材は 'glass'、夜に灯る室内は 'interior_light'（ゲーム側で光らせる）。
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'models', 'station.glb')

W, D = 48.0, 20.0          # 間口（X）と奥行（Y）
F1 = 4.2                   # 1階の高さ
EAVE, RIDGE = 8.0, 9.5     # 軒と棟の高さ
TERRACE = 3.2              # 2階の海側は、この奥行だけ下がってテラスになる

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
    M['wall'] = material('wall', srgb('#ecebe6'))              # 白い外壁
    M['wall_grey'] = material('wall_grey', srgb('#c9c8c2'))    # 腰壁・目地
    M['roof'] = material('roof', srgb('#4a4f55'), rough=0.6, metal=0.3)   # 濃い灰色の金属屋根
    M['seam'] = material('seam', srgb('#5a6066'), rough=0.5, metal=0.3)   # 屋根のはぜ
    M['frame'] = material('frame', srgb('#3a3d40'), rough=0.5, metal=0.4) # サッシ・柱・手すり
    M['glass'] = material('glass', srgb('#7f95a0'), rough=0.15)
    M['interior_light'] = material('interior_light', srgb('#e8cfa0'))     # 夜に灯る室内
    M['cedar'] = material('cedar', srgb('#b07a4a'))            # 杉のルーバー
    M['deck'] = material('deck', srgb('#8a6a4c'))              # テラスの床
    M['soffit'] = material('soffit', srgb('#c89a6a'))          # 軒裏（木）
    M['concrete'] = material('concrete', srgb('#a8a59e'), rough=0.95)
    M['sign'] = material('sign', srgb('#2e3236'))              # 駅名の看板（文字はゲームで）
    M['unit'] = material('unit', srgb('#d6d6d0'))              # 室外機

# ---------- かたち ----------
parts = []

def add(obj, mat):
    obj.data.materials.append(M[mat])
    parts.append(obj)
    return obj

def box(sx, sy, sz, x=0, y=0, z=0, mat='wall'):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + sz / 2))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return add(o, mat)

def cyl(r, h, x=0, y=0, z=0, mat='frame', verts=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=(x, y, z + h / 2))
    return add(bpy.context.active_object, mat)

def slab(pts, thick, mat):
    """四隅の点（上面）を指定した板。厚みは下へ"""
    bm = bmesh.new()
    top = [bm.verts.new(p) for p in pts]
    bot = [bm.verts.new((p[0], p[1], p[2] - thick)) for p in pts]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    me = bpy.data.meshes.new('slab')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('slab', me)
    bpy.context.collection.objects.link(o)
    return add(o, mat)

def glass_wall(x0, x1, y, z0, z1, pitch=1.6, axis='x'):
    """ガラス面と、縦横のサッシ（方立て・無目）"""
    L = x1 - x0
    n = max(1, round(L / pitch))
    if axis == 'x':
        box(L, 0.06, z1 - z0, (x0 + x1) / 2, y, z0, 'glass')
        for i in range(n + 1):
            box(0.08, 0.14, z1 - z0, x0 + L * i / n, y, z0, 'frame')
        for zz in (z0, z0 + (z1 - z0) * 0.72, z1 - 0.08):
            box(L, 0.14, 0.08, (x0 + x1) / 2, y, zz, 'frame')
    else:
        box(0.06, L, z1 - z0, y, (x0 + x1) / 2, z0, 'glass')
        for i in range(n + 1):
            box(0.14, 0.08, z1 - z0, y, x0 + L * i / n, z0, 'frame')
        for zz in (z0, z0 + (z1 - z0) * 0.72, z1 - 0.08):
            box(0.14, L, 0.08, y, (x0 + x1) / 2, zz, 'frame')

def roof_z(y):
    """切妻屋根の上面の高さ（棟は y=0、ゆるい勾配）"""
    return RIDGE - (RIDGE - EAVE) * abs(y) / (D / 2)

def build():
    mats()
    hx, hy = W / 2, D / 2
    # 基礎と、ぐるりの犬走り
    box(W + 1.2, D + 1.2, 0.2, 0, 0, -0.2, 'concrete')

    # ---- 1階：海側はほぼ全面ガラスの店先。両端は白い壁 ----
    box(W, D, 0.3, 0, 0, F1 - 0.3, 'wall')            # 2階の床（1階の天井）
    # 室内（ガラスの奥に見える、灯りの入る床と奥の壁）
    box(W - 1, D - 1, 0.05, 0, 0, 0, 'interior_light')
    box(W - 1, 0.2, F1 - 0.4, 0, hy - 3.5, 0, 'interior_light')
    # 海側のガラス面（入口の両わき）。両端の 4m は壁
    glass_wall(-hx + 4, hx - 4, -hy, 0.1, F1 - 0.35)
    for sx in (-1, 1):
        box(4, 0.4, F1 - 0.3, sx * (hx - 2), -hy + 0.2, 0, 'wall')
        box(0.4, D, F1 - 0.3, sx * (hx - 0.2), 0, 0, 'wall')
        # 妻側にも少しガラス
        glass_wall(-hy + 3, -hy + 9, sx * (hx + 0.01), 0.1, F1 - 0.35, axis='y')
    # 山側（線路側）：壁と、ホームへの出入口のガラス
    box(W, 0.4, F1 - 0.3, 0, hy - 0.2, 0, 'wall')
    glass_wall(-6, 6, hy + 0.01, 0.1, 3.2)
    # 腰の灰色の帯
    box(W + 0.02, D + 0.02, 0.35, 0, 0, F1 - 0.65, 'wall_grey')

    # ---- 2階：海側を下げてテラスに。白い壁に横長の窓と、杉のルーバー ----
    y2 = -hy + TERRACE                 # 2階の海側の壁
    d2 = hy - y2
    yc2 = (y2 + hy) / 2
    box(W - 0.6, d2, EAVE - F1 - 0.2, 0, yc2, F1, 'wall')
    # 窓（海側）：横長に2列
    glass_wall(-hx + 2, -3, y2 - 0.01, F1 + 0.9, EAVE - 0.9, pitch=2.0)
    glass_wall(3, hx - 2, y2 - 0.01, F1 + 0.9, EAVE - 0.9, pitch=2.0)
    # 杉の縦ルーバー（窓の前に、等間隔で）
    for x0, x1 in ((-hx + 2, -3), (3, hx - 2)):
        n = int((x1 - x0) / 0.55)
        for i in range(n + 1):
            box(0.12, 0.16, EAVE - F1 - 0.9, x0 + (x1 - x0) * i / n, y2 - 0.35, F1 + 0.55, 'cedar')
        box(x1 - x0, 0.2, 0.12, (x0 + x1) / 2, y2 - 0.35, F1 + 0.45, 'frame')
        box(x1 - x0, 0.2, 0.12, (x0 + x1) / 2, y2 - 0.35, EAVE - 0.4, 'frame')
    # 中央は大きなガラス（2階の待合・カフェ）
    glass_wall(-3, 3, y2 - 0.01, F1 + 0.1, EAVE - 0.3, pitch=1.5)
    box(6, 0.1, EAVE - F1 - 0.5, 0, y2 + 0.4, F1 + 0.1, 'interior_light')
    # 山側の窓
    for x in range(-20, 21, 5):
        box(2.6, 0.06, 1.4, x, hy + 0.01, F1 + 1.4, 'glass')
        box(2.8, 0.12, 0.1, x, hy + 0.02, F1 + 1.35, 'frame')

    # ---- テラス：床、ガラスの手すり、軒を支える細い柱 ----
    box(W - 0.6, TERRACE, 0.12, 0, -hy + TERRACE / 2, F1, 'deck')
    rail_y = -hy + 0.1
    box(W - 0.6, 0.05, 1.0, 0, rail_y, F1 + 0.12, 'glass')
    box(W - 0.6, 0.1, 0.06, 0, rail_y, F1 + 1.12, 'frame')
    for sx in (-1, 1):
        box(0.05, TERRACE, 1.0, sx * (hx - 0.32), -hy + TERRACE / 2, F1 + 0.12, 'glass')
    for i in range(9):
        x = -hx + 1 + (W - 2) * i / 8
        cyl(0.09, EAVE - F1 + 0.2, x, -hy - 0.4, F1, 'frame', verts=6)
        box(0.06, 0.06, 1.0, x, rail_y, F1 + 0.12, 'frame')

    # ---- 切妻屋根：ゆるい勾配の金属屋根、深い軒（海側を深く） ----
    ov_f, ov_b, ov_s = 1.8, 1.0, 1.0
    yf, yb = -hy - ov_f, hy + ov_b
    xl, xr = -hx - ov_s, hx + ov_s
    t = 0.35
    slab([(xl, yf, roof_z(yf)), (xr, yf, roof_z(yf)), (xr, 0, RIDGE), (xl, 0, RIDGE)], t, 'roof')
    slab([(xl, 0, RIDGE), (xr, 0, RIDGE), (xr, yb, roof_z(yb)), (xl, yb, roof_z(yb))], t, 'roof')
    # 軒裏（木）
    slab([(xl, yf, roof_z(yf) - t), (xr, yf, roof_z(yf) - t), (xr, -hy + TERRACE, roof_z(-hy + TERRACE) - t), (xl, -hy + TERRACE, roof_z(-hy + TERRACE) - t)], 0.04, 'soffit')
    # はぜ（立平葺きの筋）
    n = 20
    for i in range(n + 1):
        x = xl + 0.3 + (xr - xl - 0.6) * i / n
        for (ya, yb_) in ((yf, 0), (0, yb)):
            za, zb = roof_z(ya), roof_z(yb_)
            slab([(x - 0.03, ya, za + 0.05), (x + 0.03, ya, za + 0.05), (x + 0.03, yb_, zb + 0.05), (x - 0.03, yb_, zb + 0.05)], 0.06, 'seam')
    # 棟と、軒先の鼻隠し
    box(xr - xl, 0.5, 0.18, 0, 0, RIDGE - 0.02, 'seam')
    box(xr - xl, 0.12, 0.4, 0, yf, roof_z(yf) - t - 0.05, 'frame')
    box(xr - xl, 0.12, 0.4, 0, yb, roof_z(yb) - t - 0.05, 'frame')
    # 妻壁（屋根と2階の壁のあいだの三角）
    for sx in (-1, 1):
        bm = bmesh.new()
        x = sx * (hx - 0.3)
        v = [bm.verts.new(p) for p in ((x, y2, EAVE - 0.2), (x, hy, EAVE - 0.2), (x, hy, roof_z(hy) - t), (x, 0, RIDGE - t), (x, y2, roof_z(y2) - t))]
        bm.faces.new(v if sx > 0 else list(reversed(v)))
        me = bpy.data.meshes.new('gable')
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new('gable', me)
        bpy.context.collection.objects.link(o)
        add(o, 'wall')

    # ---- 中央の入口：張り出した庇と、看板 ----
    cw, cd = 12.0, 4.5
    box(cw, cd, 0.3, 0, -hy - cd / 2, 3.5, 'wall')
    box(cw, cd - 0.3, 0.04, 0, -hy - cd / 2, 3.48, 'soffit')
    for sx in (-1, 1):
        cyl(0.12, 3.5, sx * (cw / 2 - 0.4), -hy - cd + 0.4, 0, 'frame', verts=8)
    box(8, 0.12, 1.0, 0, -hy - cd - 0.02, 3.6, 'sign')
    # 入口の自動ドア（ガラスの奥の明るい風除室）
    box(6, 0.1, 2.6, 0, -hy + 0.3, 0.1, 'interior_light')

    # ---- 室外機（山側）。スマホでも軽いよう、遠くで見えない細部は省く ----
    for i in range(4):
        box(0.9, 0.35, 0.7, -12 + i * 8, hy + 0.6, 0, 'unit')
    return RIDGE

def join_all():
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)  # 原点を (0,0,0) に
    o.name = 'jr_onomichi_station'
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
    sc.render.resolution_x, sc.render.resolution_y = 1000, 600
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.68, 0.85, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    sc.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    bpy.context.collection.objects.link(sun)
    ground = bpy.data.objects.new('ground', bpy.data.meshes.new('g'))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    bm.to_mesh(ground.data)
    bm.free()
    ground.data.materials.append(material('plaza', srgb('#9a968e')))
    bpy.context.collection.objects.link(ground)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 28
    cam.location = (-30, -42, 9)
    target = Vector((0, 0, height * 0.4))
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
