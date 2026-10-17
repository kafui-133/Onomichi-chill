"""千光寺山ロープウェイのゴンドラを Blender で組み立てて、glTF（.glb）に書き出す。

  使い方:
    python tools/blender/gondola.py                 → assets/models/gondola.glb
    python tools/blender/gondola.py --preview a.png → 書き出しに加えて、確認用の絵を描く

  寸法：客室は長さ約2.6m（X）× 幅2.0m × 高さ2.1m。1m = 1。上は +Z。
  原点は吊り手のいちばん上（ケーブルをつかむところ）。客室はその下に吊られ、床は z = -3.3 あたり。
  スマホでも軽いよう、角を少し丸めた箱と大きな窓で、形の印象だけを出す。
  ガラスの素材は 'glass'（ゲーム側で差しかえる）。
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'models', 'gondola.glb')

L, Wd, H = 2.6, 2.0, 2.1    # 客室の長さ・幅・高さ
Z0 = -3.3                   # 客室の床の高さ

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
    M['body'] = material('body', srgb('#ece6d6'))                 # クリーム色の車体
    M['band'] = material('band', srgb('#b03a2e'))                 # 赤い帯
    M['glass'] = material('glass', srgb('#5a6a74'), rough=0.15)
    M['frame'] = material('frame', srgb('#2e3236'), rough=0.5, metal=0.4)  # 窓枠
    M['hanger'] = material('hanger', srgb('#4a4e52'), rough=0.5, metal=0.5)  # 吊り手・握索機

parts = []

def add(obj, mat):
    obj.data.materials.append(M[mat])
    parts.append(obj)
    return obj

def box(sx, sy, sz, x=0, y=0, z=0, mat='body', bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + sz / 2))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = 2
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='bevel')
    return add(o, mat)

def cyl(r, h, x=0, y=0, z=0, mat='hanger', verts=10, axis='z'):
    rot = (math.pi / 2, 0, 0) if axis == 'y' else (0, 0, 0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=(x, y, z), rotation=rot)
    return add(bpy.context.active_object, mat)

def build():
    mats()
    # 客室：下の車体（帯の下まで）、赤い帯、窓の段、丸みのある屋根
    zb = Z0
    box(L, Wd, 0.75, 0, 0, zb, 'body', bevel=0.18)
    box(L + 0.02, Wd + 0.02, 0.18, 0, 0, zb + 0.72, 'band')
    zw = zb + 0.9
    hw = 1.0                         # 窓の高さ
    box(L - 0.06, Wd - 0.06, hw, 0, 0, zw, 'glass')
    # 窓枠：四隅の柱と、各面の中の方立て
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(0.12, 0.12, hw, sx * (L / 2 - 0.08), sy * (Wd / 2 - 0.08), zw, 'frame')
    for sy in (-1, 1):
        box(0.06, 0.08, hw, 0, sy * (Wd / 2 - 0.02), zw, 'frame')
    box(L, Wd, 0.08, 0, 0, zw, 'frame')
    box(L, Wd, 0.08, 0, 0, zw + hw - 0.04, 'frame')
    # 屋根（少し丸く）
    box(L, Wd, 0.32, 0, 0, zw + hw + 0.02, 'body', bevel=0.14)
    top = zw + hw + 0.34
    # 吊り手：屋根の中心から、ゆるく曲がった腕でケーブルへ
    box(0.5, 0.5, 0.12, 0, 0, top - 0.04, 'hanger')
    cyl(0.07, -0.3 - top, 0, 0, (top - 0.3) / 2, 'hanger', verts=8)
    # 握索機と、ケーブルにのる2つの車輪（車軸は Y）
    box(1.0, 0.24, 0.26, 0, 0, -0.42, 'hanger')
    for x in (-0.35, 0.35):
        cyl(0.16, 0.08, x, 0, -0.12, 'hanger', verts=12, axis='y')
    return Z0

def join_all():
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)  # 原点を (0,0,0) に
    o.name = 'senkoji_gondola'
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
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=12)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, -5))
    bm.to_mesh(ground.data)
    bm.free()
    ground.data.materials.append(material('plaza', srgb('#9a968e')))
    bpy.context.collection.objects.link(ground)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 50
    cam.location = (5, -7, -0.8)
    target = Vector((0, 0, -1.7))
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
