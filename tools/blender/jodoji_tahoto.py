"""浄土寺の多宝塔（国宝・尾道）を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方: python tools/blender/jodoji_tahoto.py [--preview a.png] → assets/models/jodoji_tahoto.glb

  下の重は方形（三間）で朱塗り、その屋根の上に白い亀腹（まんじゅう形）、上の重は円い塔身、
  深い組物の上に方形の屋根、てっぺんに相輪。高さ約20m。正面は -Y。
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import M, material, box, cyl, sphere, torus, ring_of_boxes, roof, reset, join_all, export, preview


def mats():
    material('shu', '#a8442c')            # 朱塗りの柱・貫
    material('shu_dark', '#7a2e20')       # 組物の陰・扉
    material('plaster', '#ece6da')        # 白い壁・亀腹
    material('lattice', '#3a4a3a')        # 連子窓（緑青）
    material('tile', '#55585b')
    material('tile_dark', '#45484b')
    material('ridge', '#64676a')
    material('under', '#8a3a26')          # 軒裏（朱の垂木）
    material('stone', '#b3ab9c', rough=0.95)
    material('bronze', '#6f7066', rough=0.6, metal=0.3)
    material('gold', '#9a8a56', rough=0.6, metal=0.3)


def build():
    mats()
    # 基壇と石段
    box(8.4, 8.4, 0.9, 0, 0, 0, 'stone')
    box(8.8, 8.8, 0.18, 0, 0, 0.9, 'stone')
    for k in range(3):
        box(2.6, 0.5, 0.3 * (3 - k), 0, -4.45 - k * 0.5, 0, 'stone')
    z = 1.08
    # ---- 下の重：三間四方。柱（各辺4本）、中の間は板扉、脇の間は連子窓、上に白い小壁 ----
    w, h = 5.4, 3.5
    half = w / 2
    box(w - 0.1, w - 0.1, h, 0, 0, z, 'plaster')
    for k in range(4):
        a = k * math.pi / 2
        nx, ny = math.cos(a), math.sin(a)
        tx, ty = -ny, nx
        for t in (-1.5, -0.5, 0.5, 1.5):
            off = t * w / 3
            cyl(0.17, h, nx * half + tx * off, ny * half + ty * off, z, 'shu', verts=10)
        # 中の間の扉
        dw = w / 3 - 0.36
        sx, sy = (0.08, dw) if k % 2 == 0 else (dw, 0.08)
        box(sx, sy, h * 0.7, nx * (half + 0.02), ny * (half + 0.02), z + 0.2, 'shu_dark')
        # 脇の間の連子窓
        for side in (-1, 1):
            sx, sy = (0.08, dw) if k % 2 == 0 else (dw, 0.08)
            box(sx, sy, h * 0.34, nx * (half + 0.02) + tx * side * w / 3, ny * (half + 0.02) + ty * side * w / 3, z + h * 0.36, 'lattice')
    ring_of_boxes(half, half, 0.24, 0.26, z, 'shu')                # 地覆
    ring_of_boxes(half, half, 0.22, 0.24, z + h * 0.3, 'shu')      # 腰貫
    ring_of_boxes(half, half, 0.22, 0.24, z + h * 0.74, 'shu')     # 内法貫
    ring_of_boxes(half, half, 0.26, 0.3, z + h - 0.3, 'shu')       # 頭貫
    # 縁（まわりの板敷き）と高欄
    ring_of_boxes(half + 0.6, half + 0.6, 1.1, 0.14, z - 0.05, 'shu_dark')
    ring_of_boxes(half + 1.1, half + 1.1, 0.08, 0.08, z + 0.7, 'shu')
    for k in range(4):
        a = k * math.pi / 2
        nx, ny = math.cos(a), math.sin(a)
        tx, ty = -ny, nx
        for t in range(-3, 4):
            if k == 3 and abs(t) < 1:     # 正面（-Y）のまん中は、あけておく
                continue
            box(0.09, 0.09, 0.78, nx * (half + 1.1) + tx * t * (half + 1.1) / 3, ny * (half + 1.1) + ty * t * (half + 1.1) / 3, z, 'shu')
    # 組物（二手先）
    zb = z + h
    for i in range(2):
        ring_of_boxes(half + 0.3 + i * 0.45, half + 0.3 + i * 0.45, 0.34, 0.3, zb + i * 0.32, 'shu_dark')
    zb += 0.64
    # 下の屋根
    top1 = roof(half + 2.7, half + 2.7, zb, 1.5, core=1.9, lift=0.55, n=22)
    # ---- 亀腹：白いまんじゅう形 ----
    sphere(2.25, 0, 0, top1 - 0.55, 'plaster', seg=20, sz=0.62)
    # ---- 上の重：円い塔身。まわりに細い柱（12本）と、扉 ----
    z2 = top1 + 0.55
    r2, h2 = 1.75, 2.3
    cyl(r2, h2, 0, 0, z2, 'plaster', verts=24)
    for k in range(12):
        a = k * math.pi / 6 + math.pi / 12
        cyl(0.11, h2, math.cos(a) * (r2 + 0.02), math.sin(a) * (r2 + 0.02), z2, 'shu', verts=8)
    cyl(r2 + 0.14, 0.2, 0, 0, z2, 'shu', verts=24)
    cyl(r2 + 0.14, 0.24, 0, 0, z2 + h2 - 0.24, 'shu', verts=24)
    # 高欄（円い縁）
    cyl(r2 + 0.75, 0.12, 0, 0, z2 - 0.06, 'shu_dark', verts=24)
    torus(r2 + 0.72, 0.045, z2 + 0.62, 'shu')
    for k in range(16):
        a = k * math.pi / 8
        box(0.07, 0.07, 0.62, math.cos(a) * (r2 + 0.72), math.sin(a) * (r2 + 0.72), z2, 'shu')
    # 組物（四手先：円から方形へ、大きく張り出す）
    zb2 = z2 + h2
    for i in range(4):
        s2 = 1.5 + i * 0.5
        ring_of_boxes(s2, s2, 0.32, 0.28, zb2 + i * 0.3, 'shu_dark' if i % 2 else 'shu')
    zb2 += 1.2
    # 上の屋根
    top2 = roof(4.6, 4.6, zb2, 2.0, core=0.0, lift=0.6, n=22)
    # ---- 相輪：露盤、伏鉢、九輪、水煙、宝珠。四隅へ、宝鎖 ----
    zs = top2 - 0.15
    box(1.3, 1.3, 0.4, 0, 0, zs, 'bronze')
    sphere(0.55, 0, 0, zs + 0.42, 'bronze', sz=0.7)
    cyl(0.07, 5.0, 0, 0, zs + 0.6, 'bronze', verts=8)
    for k in range(9):
        torus(0.42 - k * 0.012, 0.085, zs + 1.2 + k * 0.33, 'bronze')
    zz = zs + 1.2 + 9 * 0.33
    box(1.0, 0.05, 0.9, 0, 0, zz, 'bronze')
    box(0.05, 1.0, 0.9, 0, 0, zz, 'bronze')
    sphere(0.2, 0, 0, zz + 1.2, 'gold')
    cyl(0.03, 0.3, 0, 0, zz + 1.35, 'gold', verts=8, r2=0.0)
    return zz + 1.65


if __name__ == '__main__':
    reset()
    h = build()
    o = join_all('jodoji_tahoto')
    print('height', round(h, 2))
    export(o, 'jodoji_tahoto.glb')
    if '--preview' in sys.argv:
        preview(os.path.abspath(sys.argv[sys.argv.index('--preview') + 1]), h)
