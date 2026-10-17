"""艮神社（尾道・長江）を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方（画面なしの Blender。pip の bpy でも、blender --background --python でも動く）:
    python tools/blender/ushitora.py                 → assets/models/ushitora.glb
    python tools/blender/ushitora.py --preview a.png → 書き出しに加えて、確認用の絵を描く

  中身：拝殿（入母屋の屋根・千鳥破風・唐破風の向拝・注連縄・賽銭箱）、本殿、
        石畳の参道、狛犬と石灯籠ひと組ずつ、朱の明神鳥居、境内の大楠。地面はふくまない。
  寸法はおおよそ実物の見た目どおり。1m = 1。上は +Z（glTF では +Y になる）。
  原点は拝殿の足もと（地面の高さ）の中心。正面（参道・鳥居）は -Y（glTF では +Z）。
"""
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'models', 'ushitora.glb')
rnd = random.Random(7)

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
    M['wood'] = material('wood', srgb('#4a3324'))          # 古びた素木（柱・壁）
    M['wood_dark'] = material('wood_dark', srgb('#2e2018'))  # 格子・扉・妻の陰
    M['under'] = material('under', srgb('#5a3e2c'))        # 軒裏（垂木）
    M['tile'] = material('tile', srgb('#3c4148'))          # 瓦
    M['tile_dark'] = material('tile_dark', srgb('#2f333a'))  # 瓦の筋
    M['ridge'] = material('ridge', srgb('#4e545c'))        # 棟・鬼瓦
    M['stone'] = material('stone', srgb('#8f8a80'), rough=0.95)    # 基壇の石積み
    M['stone2'] = material('stone2', srgb('#a8a397'), rough=0.95)  # 石畳・灯籠・狛犬
    M['vermilion'] = material('vermilion', srgb('#c8442e'), rough=0.7)  # 鳥居の朱
    M['black'] = material('black', srgb('#24201e'), rough=0.7)     # 鳥居の笠木・根巻
    M['rope'] = material('rope', srgb('#cdb98a'))          # 注連縄（藁）
    M['paper'] = material('paper', srgb('#f4f1ea'))        # 紙垂
    M['bark'] = material('bark', srgb('#4a3f34'))          # 楠の幹
    M['leaf'] = material('leaf', srgb('#2f4a28'))          # 楠の葉
    M['leaf2'] = material('leaf2', srgb('#3b5a2f'))        # 楠の葉（明るいところ）
    M['gold'] = material('gold', srgb('#b08a3a'), rough=0.5, metal=0.6)  # 飾り金具

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

def cyl(r, h, x=0, y=0, z=0, mat='stone2', verts=12, r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h, location=(x, y, z + h / 2))
    return add(bpy.context.active_object, mat)

def sphere(r, x=0, y=0, z=0, mat='stone2', seg=6, sx=1.0, sy=1.0, sz=1.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=max(4, seg // 2), radius=r, location=(x, y, z))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    return add(o, mat)

def beam(p, q, w, h, mat, round_=False, r2=None):
    """p から q へ向かう角材（round_ なら丸太。r2 で先を細く）"""
    p, q = Vector(p), Vector(q)
    dv = q - p
    if round_:
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=w, radius2=w if r2 is None else r2, depth=dv.length, location=(p + q) / 2)
        o = bpy.context.active_object
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(dv.normalized())
    else:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(p + q) / 2)
        o = bpy.context.active_object
        o.scale = (dv.length + 0.02, w, h)
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(dv.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return add(o, mat)

def chain(pts, w, h, mat, round_=False):
    for a, b in zip(pts, pts[1:]):
        beam(a, b, w, h, mat, round_)

def rect_ring(hx, hy, w, h, z, mat, cy=0.0):
    """長方形のふちに沿った四辺の角材（長押・頭貫・縁の板）"""
    box(hx * 2 + w, w, h, 0, cy - hy, z, mat)
    box(hx * 2 + w, w, h, 0, cy + hy, z, mat)
    box(w, hy * 2, h, -hx, cy, z, mat)
    box(w, hy * 2, h, hx, cy, z, mat)

def mesh_obj(name, bm, mat_names, thickness=0.26):
    """bmesh を屋根の板にする（厚みは下へ。裏は軒裏の色）"""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    for n in mat_names:
        o.data.materials.append(M[n])
    if thickness:
        sol = o.modifiers.new('solid', 'SOLIDIFY')
        sol.thickness = thickness
        sol.offset = -1
        sol.material_offset = len(mat_names) - 1
        sol.material_offset_rim = len(mat_names) - 1
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier='solid')
    parts.append(o)
    return o

def grid_faces(bm, rows, stripe_axis=None, flip=False):
    """頂点の行の並び（同じ長さ）を四角い面でつなぐ。瓦の筋は stripe_axis の座標で色を交互に"""
    vs = [[bm.verts.new(p) for p in row] for row in rows]
    for i in range(len(vs) - 1):
        for j in range(len(vs[i]) - 1):
            quad = (vs[i][j], vs[i][j + 1], vs[i + 1][j + 1], vs[i + 1][j])
            f = bm.faces.new(quad[::-1] if flip else quad)
            if stripe_axis is not None:
                c = sum(v.co[stripe_axis] for v in quad) / 4
                f.material_index = 1 if int(math.floor(c / 0.32)) % 2 else 0
    return vs

# ---------- 屋根 ----------
def prof(t, z_e, R):
    """軒先 (t=0) から棟 (t=1) への高さ。上ほど急な反り"""
    return z_e + R * (0.3 * t + 0.7 * t * t)

def irimoya(ex, ey, z_e, R, tm_i=6, N=10, Mx=6, lift=0.45, cy=0.0):
    """入母屋の屋根：下は四方へ流れる寄棟、上は前後へ流れる切妻。妻（側面の三角）は板張り"""
    tm = tm_i / N
    ix = ex - ey * tm
    bm = bmesh.new()

    def lift_at(t, w):
        return lift * max(0.0, 1 - t / tm) ** 2 * w ** 6

    for sy in (-1, 1):  # 前と後ろの面
        rows = []
        for i in range(N + 1):
            t = i / N
            hw = ex - ey * t if t < tm else ix
            row = []
            for j in range(Mx + 1):
                u = j / Mx * 2 - 1
                x = u * hw
                row.append((x, cy + sy * ey * (1 - t), prof(t, z_e, R) + lift_at(t, abs(u))))
            rows.append(row)
        grid_faces(bm, rows, stripe_axis=0, flip=(sy > 0))
    for sx in (-1, 1):  # 左右の寄棟の面
        rows = []
        for i in range(tm_i + 1):
            t = i / N
            hy = ey * (1 - t)
            row = []
            for j in range(Mx + 1):
                u = j / Mx * 2 - 1
                row.append((sx * (ex - ey * t), cy + u * hy, prof(t, z_e, R) + lift_at(t, abs(u))))
            rows.append(row)
        grid_faces(bm, rows, stripe_axis=1, flip=(sx < 0))
    mesh_obj('irimoya', bm, ['tile', 'tile_dark', 'under'])

    # 妻：側面の三角の板壁と、ふちの破風板、頂の懸魚
    for sx in (-1, 1):
        bm = bmesh.new()
        pts = []
        for i in range(tm_i, N + 1):
            t = i / N
            pts.append((sx * (ix - 0.12), cy - ey * (1 - t), prof(t, z_e, R) - 0.12))
        back = [(p[0], 2 * cy - p[1], p[2]) for p in reversed(pts[:-1])]
        poly = pts + back
        vs = [bm.verts.new(p) for p in poly]
        bm.faces.new(vs if sx > 0 else vs[::-1])
        mesh_obj('tsuma', bm, ['wood_dark'], thickness=0)
        for side in (-1, 1):
            line = []
            for i in range(tm_i, N + 1):
                t = i / N
                line.append((sx * (ix + 0.02), cy + side * ey * (1 - t), prof(t, z_e, R) + 0.06))
            chain(line[::2] + ([line[-1]] if len(line) % 2 == 0 else []), 0.12, 0.34, 'wood')
        box(0.1, 0.5, 0.6, sx * (ix + 0.05), cy, prof(1, z_e, R) - 0.75, 'gold')
    # 大棟と鬼瓦
    zr = prof(1, z_e, R)
    box(ix * 2 + 0.3, 0.42, 0.4, 0, cy, zr - 0.05, 'ridge')
    for sx in (-1, 1):
        box(0.3, 0.55, 0.75, sx * (ix + 0.1), cy, zr - 0.1, 'ridge')
    # 隅棟（四隅）
    for sx in (-1, 1):
        for sy in (-1, 1):
            line = []
            for i in range(tm_i + 1):
                t = i / N
                line.append((sx * (ex - ey * t), cy + sy * ey * (1 - t), prof(t, z_e, R) + lift_at(t, 1) + 0.1))
            chain(line[::2] + ([line[-1]] if len(line) % 2 == 0 else []), 0.24, 0.22, 'ridge')
    return ix

def gable(hx, hy, z_e, R, cy=0.0, N=6, Mx=4, katsuogi=0):
    """切妻の屋根（本殿）。棟は x 方向。千木・鰹木つき"""
    bm = bmesh.new()
    for sy in (-1, 1):
        rows = []
        for i in range(N + 1):
            t = i / N
            rows.append([(u * hx, cy + sy * hy * (1 - t), prof(t, z_e, R)) for u in (j / Mx * 2 - 1 for j in range(Mx + 1))])
        grid_faces(bm, rows, stripe_axis=0, flip=(sy > 0))
    mesh_obj('gable', bm, ['tile', 'tile_dark', 'under'], thickness=0.2)
    zr = prof(1, z_e, R)
    box(hx * 2 + 0.2, 0.32, 0.28, 0, cy, zr - 0.05, 'ridge')
    for sx in (-1, 1):
        # 妻の三角（少し内側）と破風板
        bm = bmesh.new()
        pts = [(sx * (hx - 0.5), cy + s * hy * (1 - i / N), prof(i / N, z_e, R) - 0.1) for s in (-1,) for i in range(2, N + 1)]
        pts += [(p[0], 2 * cy - p[1], p[2]) for p in reversed(pts[:-1])]
        vs = [bm.verts.new(p) for p in pts]
        bm.faces.new(vs if sx > 0 else vs[::-1])
        mesh_obj('tsuma2', bm, ['wood_dark'], thickness=0)
        for side in (-1, 1):
            chain([(sx * (hx + 0.02), cy + side * hy * (1 - i / N), prof(i / N, z_e, R) + 0.05) for i in range(0, N + 1, 3)], 0.08, 0.26, 'wood')
        # 千木（棟の両端で交差する板）
        for side in (-1, 1):
            beam((sx * (hx - 0.1), cy, zr), (sx * (hx - 0.1), cy + side * 0.7, zr + 1.0), 0.07, 0.16, 'wood_dark')
    for k in range(katsuogi):
        x = (k - (katsuogi - 1) / 2) * (hx * 2 - 0.8) / max(1, katsuogi - 1)
        box(0.6, 0.2, 0.2, x, cy, zr + 0.12, 'wood_dark')

def chidori(width, depth, y_front, z_base, rise):
    """千鳥破風：表の屋根の斜面にのる三角の小さな破風"""
    N, Mx = 4, 3
    bm = bmesh.new()
    hw = width / 2
    for sx in (-1, 1):
        rows = []
        for i in range(N + 1):
            t = i / N
            x = sx * hw * (1 - t)
            rows.append([(x, y_front + v * depth, z_base + rise * (0.3 * t + 0.7 * t * t)) for v in (j / Mx for j in range(Mx + 1))])
        grid_faces(bm, rows, stripe_axis=1, flip=(sx > 0))
    mesh_obj('chidori', bm, ['tile', 'tile_dark', 'under'], thickness=0.2)
    # 妻の三角板と破風板・懸魚
    bm = bmesh.new()
    pts = [(-hw * (1 - i / N) + 0.25, y_front + 0.25, z_base + rise * (0.3 * (i / N) + 0.7 * (i / N) ** 2) - 0.12) for i in range(1, N + 1)]
    pts += [(-p[0], p[1], p[2]) for p in reversed(pts[:-1])]
    vs = [bm.verts.new(p) for p in pts]
    bm.faces.new(vs)
    mesh_obj('chidori_tsuma', bm, ['wood_dark'], thickness=0)
    for sx in (-1, 1):
        chain([(sx * hw * (1 - i / N), y_front - 0.03, z_base + rise * (0.3 * (i / N) + 0.7 * (i / N) ** 2) + 0.05) for i in range(0, N + 1, 2)], 0.1, 0.28, 'wood')
    box(0.4, 0.08, 0.5, 0, y_front - 0.05, z_base + rise - 0.62, 'gold')
    beam((0, y_front - 0.1, z_base + rise + 0.05), (0, y_front + depth, z_base + rise + 0.05), 0.3, 0.3, 'ridge')

def karahafu(hw, y0, y1, z_base, H, N=10, Ny=2):
    """唐破風：中ほどがむくり上がり、両端が反り返る、向拝の屋根"""
    def curve(x):
        u = abs(x) / hw
        return z_base + H * (math.cos(u * math.pi / 2) ** 1.4) - 0.1 * u + 0.28 * u ** 8
    bm = bmesh.new()
    rows = []
    for i in range(Ny + 1):
        y = y0 + (y1 - y0) * i / Ny
        rows.append([(x, y, curve(x)) for x in (j / N * 2 * hw - hw for j in range(N + 1))])
    grid_faces(bm, rows, stripe_axis=0)
    mesh_obj('karahafu', bm, ['tile', 'tile_dark', 'under'], thickness=0.22)
    # 正面の破風板（曲線）と兎毛通
    chain([(x, y0 - 0.04, curve(x) - 0.08) for x in (j / N * 2 * hw - hw for j in range(0, N + 1, 2))], 0.12, 0.34, 'wood')
    box(0.6, 0.08, 0.45, 0, y0 - 0.1, curve(0) - 0.7, 'gold')
    beam((0, y0, curve(0) + 0.08), (0, y1, curve(0) + 0.08), 0.26, 0.24, 'ridge')
    return curve

# ---------- 建物 ----------
def haiden():
    W, D, F = 6.4, 4.4, 0.6   # 壁の幅・奥行・床の高さ
    hx, hy = W / 2, D / 2
    box(9.0, 6.0, 2.6, 0, 0, -2.0, 'stone')        # 基壇（坂に建つので地中まで）
    box(W + 1.2, D + 1.2, 0.12, 0, 0, F, 'wood')   # 縁（えん）
    box(W, D, 3.0, 0, 0, F, 'wood')                # 壁
    # 柱
    xs = [-hx, -hx / 3, hx / 3, hx]
    for x in xs:
        for y in (-hy, hy):
            box(0.32, 0.32, 3.2, x, y, F, 'wood')
    for y in (0.0,):
        for x in (-hx, hx):
            box(0.32, 0.32, 3.2, x, y, F, 'wood')
    # 正面の格子戸（3間）
    for k in range(3):
        cx = -hx + (k + 0.5) * W / 3
        box(W / 3 - 0.5, 0.06, 2.3, cx, -hy - 0.03, F + 0.25, 'wood_dark')
        for s in range(3):
            box(0.06, 0.08, 2.3, cx - (W / 3 - 0.6) / 2 + s * (W / 3 - 0.6) / 2, -hy - 0.07, F + 0.25, 'wood')
        box(W / 3 - 0.5, 0.09, 0.06, cx, -hy - 0.07, F + 1.4, 'wood')
    # 長押・頭貫・組物
    rect_ring(hx + 0.08, hy + 0.08, 0.26, 0.3, F + 2.95, 'wood')
    rect_ring(hx + 0.35, hy + 0.35, 0.3, 0.26, F + 3.25, 'wood')
    # 屋根（入母屋）
    z_e = F + 3.45
    irimoya(ex=hx + 1.6, ey=hy + 1.6, z_e=z_e, R=3.0)
    # 千鳥破風（表の屋根の斜面に）
    chidori(width=3.4, depth=1.6, y_front=-(hy + 1.6) * (1 - 0.3), z_base=prof(0.3, z_e, 3.0) - 0.05, rise=1.2)
    # 向拝：柱2本と唐破風、石段の上の木の階段
    py = -hy - 2.3
    for sx in (-1, 1):
        box(0.28, 0.28, 3.05, sx * 1.7, py, 0.0, 'wood')
        box(0.5, 0.5, 0.2, sx * 1.7, py, -0.05, 'stone2')
        beam((sx * 1.7, py, 2.85), (sx * 1.7, -hy - 0.1, 3.35), 0.18, 0.22, 'wood')   # 海老虹梁
    box(3.8, 0.24, 0.3, 0, py, 2.85, 'wood')         # 虹梁
    karahafu(hw=2.3, y0=py - 0.75, y1=-hy - 0.2, z_base=3.05, H=0.85)
    for k in range(3):   # 木の階段（縁から地面へ）
        box(2.6, 0.35, F - k * 0.2, 0, -hy - 0.75 - k * 0.35, 0, 'wood')
    # 賽銭箱
    box(1.3, 0.6, 0.62, 0, -hy - 0.35, F + 0.12, 'wood_dark')
    # 注連縄と紙垂（向拝の柱のあいだ）
    pts = []
    for i in range(7):
        u = i / 6 * 2 - 1
        pts.append((u * 1.62, py - 0.05, 2.65 - 0.4 * (1 - u * u)))
    for a, b, i in zip(pts, pts[1:], range(6)):
        u = (i + 0.5) / 6 * 2 - 1
        beam(a, b, 0.06 + 0.1 * (1 - u * u), None, 'rope', round_=True)
    for u in (-0.55, 0.0, 0.55):
        x = u * 1.62
        z = 2.65 - 0.4 * (1 - u * u) - 0.12
        box(0.16, 0.02, 0.42, x, py - 0.08, z - 0.45, 'paper')   # 紙垂（遠目には白い短冊）

def honden():
    cy = 7.0
    box(5.0, 4.2, 3.4, 0, cy, -2.0, 'stone')     # 石の基壇（拝殿より一段高い）
    F = 1.4
    box(3.6, 3.0, 0.1, 0, cy, F, 'wood')
    box(3.0, 2.4, 2.2, 0, cy, F + 0.1, 'wood')
    for x in (-1.5, 1.5):
        for y in (-1.2, 1.2):
            box(0.24, 0.24, 2.4, x, cy + y, F + 0.1, 'wood')
    box(1.2, 0.06, 1.7, 0, cy - 1.23, F + 0.2, 'wood_dark')   # 扉
    rect_ring(1.55, 1.25, 0.2, 0.22, F + 2.1, 'wood')
    gable(hx=2.3, hy=2.2, z_e=F + 2.35, R=1.7, cy=cy, katsuogi=3)
    # 拝殿の裏から本殿へ、石段
    for k in range(3):
        box(1.6, 0.4, 0.6 + k * 0.27, 0, 3.2 + k * 0.4, 0.0, 'stone2')

def approach():
    """石畳の参道（拝殿の前から鳥居まで）。遠目に読める程度に、大きな板石を数枚"""
    y = -4.0
    k = 0
    while y > -13.0:
        box(2.3, 1.7, 0.08, 0, y - 0.85, -0.02, 'stone2' if k % 2 else 'stone')
        y -= 1.8
        k += 1

def komainu(x, y, side):
    """狛犬：台座の上に座る、すこし大づかみの形。参道のほうへ少し向く"""
    box(0.9, 0.9, 0.2, x, y, 0, 'stone')
    box(0.75, 0.75, 0.85, x, y, 0.2, 'stone2')
    box(0.85, 0.85, 0.1, x, y, 1.05, 'stone')
    z = 1.15
    sphere(0.3, x, y, z + 0.4, sx=0.9, sy=1.3, sz=1.3)                       # 胴
    sphere(0.3, x, y - 0.12, z + 1.0, sx=1.15, sy=0.9, sz=1.0)              # たてがみ
    sphere(0.22, x, y - 0.3, z + 0.98, sx=1.0, sy=1.0, sz=0.95)             # 顔
    for e in (-1, 1):
        box(0.12, 0.14, 0.62, x + e * 0.13, y - 0.28, z, 'stone2')           # 前脚
    sphere(0.14, x + side * 0.05, y + 0.38, z + 0.75, sx=0.8, sz=1.4)        # 尾（巻き毛）

def lantern(x, y):
    """石灯籠（春日形を簡単に）"""
    cyl(0.48, 0.22, x, y, 0, 'stone', verts=6)
    cyl(0.32, 0.16, x, y, 0.22, 'stone2', verts=6, r2=0.18)
    cyl(0.15, 1.1, x, y, 0.38, 'stone2', verts=10)
    cyl(0.25, 0.18, x, y, 1.48, 'stone2', verts=6, r2=0.4)
    box(0.5, 0.5, 0.5, x, y, 1.66, 'stone2')
    for d in (-1, 1):
        box(0.26, 0.04, 0.26, x, y + d * 0.25, 1.78, 'wood_dark')   # 火袋の窓
    cyl(0.62, 0.35, x, y, 2.16, 'stone2', verts=6, r2=0.08)          # 笠
    sphere(0.12, x, y, 2.6, seg=8, sz=1.3)                           # 宝珠

def torii(y):
    """朱の明神鳥居：反り上がる黒い笠木、島木、貫、額束"""
    span, H = 3.4, 4.5
    for sx in (-1, 1):
        cyl(0.2, H - 0.45, sx * span / 2, y, 0.0, 'vermilion', verts=8, r2=0.17)
        cyl(0.24, 0.5, sx * span / 2, y, 0.0, 'black', verts=8)   # 根巻
    box(span + 1.0, 0.36, 0.32, 0, y, H - 1.25, 'vermilion')       # 貫
    # 笠木（両端が反り上がる）と島木
    pts_k = []
    pts_s = []
    for i in range(7):
        u = i / 6 * 2 - 1
        x = u * (span / 2 + 1.1)
        pts_k.append((x, y, H - 0.1 + 0.3 * abs(u) ** 2.4))
        pts_s.append((x * 0.93, y, H - 0.42 + 0.22 * abs(u) ** 2.4))
    chain(pts_k, 0.5, 0.3, 'black')
    chain(pts_s, 0.4, 0.26, 'vermilion')
    box(0.32, 0.2, 0.9, 0, y, H - 1.25 + 0.32, 'vermilion')       # 額束
    box(0.6, 0.08, 0.8, 0, y - 0.13, H - 1.15, 'black')            # 額

def camphor(cx, cy):
    """境内の大楠：太くうねる幹が何本もの枝に分かれ、葉はこんもりした塊"""
    base = Vector((cx, cy, 0))
    # 幹（根元は張り出す）
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=1.6, radius2=0.95, depth=4.6, location=(cx, cy, 2.3 - 0.3))
    t = bpy.context.active_object
    for v in t.data.vertices:
        v.co.x += rnd.uniform(-0.18, 0.18)
        v.co.y += rnd.uniform(-0.18, 0.18)
    add(t, 'bark')
    for k in range(4):   # 根張り
        a = k / 4 * math.tau + rnd.uniform(-0.3, 0.3)
        beam(base + Vector((math.cos(a) * 0.6, math.sin(a) * 0.6, 1.2)), base + Vector((math.cos(a) * 2.3, math.sin(a) * 2.3, -0.2)), 0.45, None, 'bark', round_=True, r2=0.15)
    top = base + Vector((0, 0, 4.0))
    tips = []
    for k in range(5):
        a = k / 5 * math.tau + rnd.uniform(-0.4, 0.4)
        lean = rnd.uniform(0.55, 0.9)
        mid = top + Vector((math.cos(a) * 2.6 * lean, math.sin(a) * 2.6 * lean, 3.0 + rnd.uniform(0, 1.2)))
        tip = mid + Vector((math.cos(a + 0.3) * 3.2 * lean, math.sin(a + 0.3) * 3.2 * lean, 2.6 + rnd.uniform(0, 1.5)))
        beam(top, mid, 0.62, None, 'bark', round_=True, r2=0.42)
        beam(mid, tip, 0.42, None, 'bark', round_=True, r2=0.2)
        tips.append(tip)
        # 小枝
        side = mid + Vector((math.cos(a - 0.9) * 2.4, math.sin(a - 0.9) * 2.4, 1.6))
        beam(mid, side, 0.25, None, 'bark', round_=True, r2=0.1)
        tips.append(side)
    # 葉の塊（ひらたく、低ポリでフラットな面）
    blobs = []
    for p in tips:
        blobs.append((p + Vector((0, 0, 1.0)), rnd.uniform(3.0, 3.8)))
    for k in range(3):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(1.0, 4.5)
        blobs.append((base + Vector((math.cos(a) * d, math.sin(a) * d, rnd.uniform(11.5, 14.5))), rnd.uniform(3.2, 4.2)))
    blobs.append((base + Vector((0.3, -0.2, 15.0)), 3.2))
    for p, r in blobs:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=p)
        o = bpy.context.active_object
        o.scale = (1.0, 1.0, 0.72)
        for v in o.data.vertices:
            v.co *= rnd.uniform(0.86, 1.1)
        bpy.ops.object.transform_apply(scale=True)
        add(o, 'leaf' if rnd.random() < 0.6 else 'leaf2')
    return max(p.z + r * 0.72 for p, r in blobs)

def build():
    mats()
    haiden()
    honden()
    approach()
    for sx in (-1, 1):
        komainu(sx * 2.4, -6.2, sx)
        lantern(sx * 2.4, -9.4)
    torii(-12.0)
    return camphor(9.0, 2.0)

def join_all():
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = 'ushitora_jinja'
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.object.mode_set(mode='OBJECT')
    # 曲面（屋根の反り・幹）はなめらかに、角（箱の稜・葉の塊）はくっきり。
    # なめらかな面は頂点を共有できるので、書き出すファイルも軽くなる
    bm = bmesh.new()
    bm.from_mesh(o.data)
    leaf = {i for i, m in enumerate(o.data.materials) if m.name.startswith('leaf')}
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        fs = e.link_faces
        sharp = len(fs) != 2 or any(f.material_index in leaf for f in fs) or fs[0].material_index != fs[1].material_index
        if not sharp:
            sharp = fs[0].normal.angle(fs[1].normal, 0) > math.radians(32)
        e.smooth = not sharp
    bm.to_mesh(o.data)
    bm.free()
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
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    bpy.context.collection.objects.link(sun)
    ground = bpy.data.objects.new('ground', bpy.data.meshes.new('g'))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    bm.to_mesh(ground.data)
    bm.free()
    ground.data.materials.append(material('grass', srgb('#7a8a5a')))
    bpy.context.collection.objects.link(ground)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 28
    cam.location = (-17, -27, 9)
    target = Vector((2, -2, 4.5))
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
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    xs = [v.co.x for v in o.data.vertices]; ys = [v.co.y for v in o.data.vertices]; zs = [v.co.z for v in o.data.vertices]
    print('height', round(h, 2), 'tris', tris, 'extent x', round(min(xs), 1), round(max(xs), 1), 'y', round(min(ys), 1), round(max(ys), 1), 'z', round(min(zs), 1), round(max(zs), 1))
    export(o)
    if '--preview' in sys.argv:
        preview(os.path.abspath(sys.argv[sys.argv.index('--preview') + 1]), h)
