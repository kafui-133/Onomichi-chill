"""Blender で建物を組み立てるための、共通の部品（素材・箱・円柱・反りのある屋根・書き出し・確認用の絵）。

  castle.py / jodoji_hondo.py / jodoji_tahoto.py から使う。1m = 1。上は +Z（glTF では +Y）。
  建物の正面は -Y を向ける（glTF では +Z）。原点は地面の高さで、建物の中心。
  色はゲームの絵に合わせて、ベタ塗りの素材を少しだけ使う（テクスチャは使わない）。
"""
import math
import os

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

M = {}
parts = []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M.clear()
    parts.clear()


def srgb(h):
    """'#rrggbb' を Blender のリニア色に"""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


def material(name, hexcolor, rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*srgb(hexcolor), 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    M[name] = m
    return m


def add(obj, mat):
    obj.data.materials.append(M[mat])
    parts.append(obj)
    return obj


def box(sx, sy, sz, x=0, y=0, z=0, mat='wood', rz=0.0):
    """底面の中心が (x, y, z) の箱"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + sz / 2))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    o.rotation_euler[2] = rz
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return add(o, mat)


def cyl(r, h, x=0, y=0, z=0, mat='wood', verts=16, r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h, location=(x, y, z + h / 2))
    return add(bpy.context.active_object, mat)


def sphere(r, x=0, y=0, z=0, mat='wood', seg=12, sz=1.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=max(4, seg // 2), radius=r, location=(x, y, z))
    o = bpy.context.active_object
    o.scale[2] = sz
    bpy.ops.object.transform_apply(scale=True)
    return add(o, mat)


def torus(R, r, z, mat='bronze', x=0, y=0):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=14, minor_segments=5, location=(x, y, z))
    return add(bpy.context.active_object, mat)


def mesh_object(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return add(o, mat)


def frustum(bx, by, tx, ty, h, x=0, y=0, z=0, mat='stone'):
    """下が bx×by、上が tx×ty の、すぼまった台（石垣）"""
    v = [(-bx / 2, -by / 2, 0), (bx / 2, -by / 2, 0), (bx / 2, by / 2, 0), (-bx / 2, by / 2, 0),
         (-tx / 2, -ty / 2, h), (tx / 2, -ty / 2, h), (tx / 2, ty / 2, h), (-tx / 2, ty / 2, h)]
    v = [(a + x, b + y, c + z) for a, b, c in v]
    f = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return mesh_object('frustum', v, f, mat)


def prism(w, d, h, x=0, y=0, z=0, mat='tile', axis='x'):
    """切妻の屋根（三角柱）。axis='x' なら棟が X の向き。妻（三角の面）は Y の両端ではなく X の両端"""
    if axis == 'x':
        v = [(-w / 2, -d / 2, 0), (w / 2, -d / 2, 0), (w / 2, d / 2, 0), (-w / 2, d / 2, 0), (-w / 2, 0, h), (w / 2, 0, h)]
        f = [(3, 2, 1, 0), (0, 1, 5, 4), (2, 3, 4, 5), (1, 2, 5), (3, 0, 4)]
    else:
        v = [(-w / 2, -d / 2, 0), (w / 2, -d / 2, 0), (w / 2, d / 2, 0), (-w / 2, d / 2, 0), (0, -d / 2, h), (0, d / 2, h)]
        f = [(3, 2, 1, 0), (1, 2, 5, 4), (3, 0, 4, 5), (0, 1, 4), (2, 3, 5)]
    v = [(a + x, b + y, c + z) for a, b, c in v]
    return mesh_object('prism', v, f, mat)


def ring_of_boxes(hx, hy, w, h, z, mat, x=0, y=0):
    """長方形（半分の大きさ hx×hy）のふちに沿った、四辺の角材"""
    box(w, hy * 2 + w, h, x + hx, y, z, mat)
    box(w, hy * 2 + w, h, x - hx, y, z, mat)
    box(hx * 2 + w, w, h, x, y + hy, z, mat)
    box(hx * 2 + w, w, h, x, y - hy, z, mat)


def roof(ex, ey, z_eave, rise, core=0.0, lift=0.45, n=24, thick=0.3, x0=0, y0=0, mats=('tile', 'tile_dark', 'under'), ridge='ridge'):
    """反りのある寄棟の屋根。軒は ex×ey（半分の大きさ）、軒の高さ z_eave から rise だけ上がる。

    上ほど急で、軒先へ向かってゆるやかになり、四隅が反り上がる。ex ≠ ey なら、長い向きに棟ができる。
    core > 0 なら、てっぺんを core の幅で平らに切る（上に切妻をのせて入母屋にするとき）。
    瓦の筋は、面ごとに2色を交互に。裏（軒裏）は暗い色。戻り値は、てっぺんの高さ
    """
    dmax = min(ex, ey) - core
    bm = bmesh.new()
    verts = {}

    for i in range(n + 1):
        for j in range(n + 1):
            x = (i / n * 2 - 1) * ex
            y = (j / n * 2 - 1) * ey
            dx, dy = ex - abs(x), ey - abs(y)
            d = min(dx, dy)
            u = max(0.0, min(1.0, d / dmax))
            t = 1 - u
            c = (min(dx, dy) / max(dx, dy)) if max(dx, dy) > 1e-6 else 1.0
            zz = z_eave + rise * (u ** 1.55) + lift * (t ** 2.5) * (c ** 2.2)
            grow = 1 + 0.035 * (t ** 2) * (c ** 3)      # 隅は平面でも少し外へ伸びる
            verts[(i, j)] = bm.verts.new((x0 + x * grow, y0 + y * grow, zz))
    for i in range(n):
        for j in range(n):
            f = bm.faces.new((verts[(i, j)], verts[(i + 1, j)], verts[(i + 1, j + 1)], verts[(i, j + 1)]))
            cx = ((i + 0.5) / n * 2 - 1) * ex
            cy = ((j + 0.5) / n * 2 - 1) * ey
            # その面が、X の軒に落ちるか、Y の軒に落ちるか。筋は軒先に沿って並ぶ
            along = cy if (ex - abs(cx)) < (ey - abs(cy)) else cx
            f.material_index = 1 if int(math.floor(along / 0.42)) % 2 else 0
    me = bpy.data.meshes.new('roof')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('roof', me)
    bpy.context.collection.objects.link(o)
    for m in mats:
        o.data.materials.append(M[m])
    sol = o.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = thick
    sol.offset = -1
    sol.material_offset = 2
    sol.material_offset_rim = 2
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='solid')
    parts.append(o)
    # 隅棟（四隅の稜線）
    if ridge:
        for sx in (-1, 1):
            for sy in (-1, 1):
                prev = None
                steps = 7
                for s in range(steps + 1):
                    u = s / steps
                    t = 1 - u
                    d = u * dmax
                    grow = 1 + 0.035 * (t ** 2)
                    p = Vector((x0 + sx * (ex - d) * grow, y0 + sy * (ey - d) * grow, z_eave + rise * (u ** 1.55) + lift * (t ** 2.5) + 0.1))
                    if prev is not None:
                        beam(prev, p, 0.26, 0.22, ridge)
                    prev = p
    top = z_eave + rise
    # 棟（長い向きのてっぺん）
    if ridge and core == 0 and abs(ex - ey) > 0.3:
        if ex > ey:
            box((ex - ey) * 2 + 0.6, 0.34, 0.34, x0, y0, top - 0.05, ridge)
        else:
            box(0.34, (ey - ex) * 2 + 0.6, 0.34, x0, y0, top - 0.05, ridge)
    return top


def beam(a, b, w, h, mat):
    """点 a から b への角材"""
    a, b = Vector(a), Vector(b)
    dv = b - a
    bpy.ops.mesh.primitive_cube_add(size=1, location=(a + b) / 2)
    o = bpy.context.active_object
    o.scale = (dv.length + 0.04, w, h)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(dv.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return add(o, mat)


def join_all(name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.object.mode_set(mode='OBJECT')
    return o


def export(o, filename):
    out = os.path.join(ROOT, 'assets', 'models', filename)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_texcoords=False)
    print('wrote', out, os.path.getsize(out), 'bytes', 'faces', len(o.data.polygons))


def preview(path, height, dist=1.0, ground='#7a8a5a'):
    """確認用の絵（斜め前から）"""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 16
    sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 1000, 800
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.68, 0.85, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sc.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(52), 0, math.radians(30))
    bpy.context.collection.objects.link(sun)
    g = bpy.data.objects.new('ground', bpy.data.meshes.new('g'))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=80)
    bm.to_mesh(g.data)
    bm.free()
    g.data.materials.append(material('preview_ground', ground))
    bpy.context.collection.objects.link(g)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 32
    cam.location = (height * 0.95 * dist, -height * 1.35 * dist, height * 0.5)
    target = Vector((0, 0, height * 0.45))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('preview', path)


def disc(r, depth, x, y, z, mat, verts=24):
    """正面（-Y）を向いた円盤（時計の文字盤など）。中心が (x, y, z)"""
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=(x, y, z), rotation=(math.pi / 2, 0, 0))
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return add(o, mat)


def main(build, name, filename, argv, dist=1.3):
    """組み立て → まとめる → 書き出し（--preview a.png があれば、確認用の絵も）"""
    reset()
    h = build()
    o = join_all(name)
    export(o, filename)
    if '--preview' in argv:
        preview(os.path.abspath(argv[argv.index('--preview') + 1]), h, dist=dist)
