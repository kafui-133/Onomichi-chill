"""浄土寺の本堂（国宝・尾道）を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方: python tools/blender/jodoji_hondo.py [--preview a.png] → assets/models/jodoji_hondo.glb

  五間四方、朱塗りの柱に白い壁、正面は蔀戸（格子）。大きな入母屋の屋根（本瓦）に、正面の向拝（一間の庇）と石段。
  間口約15m、棟の高さ約13m。正面は -Y。
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import material, box, cyl, prism, ring_of_boxes, roof, beam, reset, join_all, export, preview

W, D, H = 14.0, 12.0, 4.6     # 間口・奥行・柱の高さ
BASE = 1.0                    # 基壇の高さ


def mats():
    material('shu', '#a8442c')
    material('shu_dark', '#74301f')
    material('plaster', '#ece6da')
    material('lattice', '#2e2620')        # 蔀戸の格子（黒っぽい木）
    material('tile', '#55585b')
    material('tile_dark', '#45484b')
    material('ridge', '#64676a')
    material('under', '#8a3a26')
    material('stone', '#b3ab9c', rough=0.95)
    material('wood', '#6a4a36')           # 縁の板
    material('gold', '#9a8a56', rough=0.6, metal=0.3)


def build():
    mats()
    # 基壇（亀腹風に二段）と、正面の石段
    box(W + 4.4, D + 4.4, BASE * 0.55, 0, 0, 0, 'stone')
    box(W + 3.6, D + 3.6, BASE * 0.45, 0, 0, BASE * 0.55, 'stone')
    for k in range(5):
        box(5.0, 0.42, BASE + 0.5 - k * 0.3 if k < 5 else 0.3, 0, -D / 2 - 3.1 - k * 0.42, 0, 'stone')
    z = BASE
    hx, hy = W / 2, D / 2
    # 縁（まわりの板敷き、床は少し高い）と高欄
    FL = 0.5
    ring_of_boxes(hx + 0.75, hy + 0.75, 1.5, 0.16, z + FL - 0.16, 'wood')
    box(W, D, FL, 0, 0, z, 'shu_dark')
    for sx in (-1, 1):
        for t in range(-4, 5):
            box(0.1, 0.1, 0.8, sx * (hx + 1.4), t * (hy + 1.4) / 4, z + FL, 'shu')
        box(0.09, (hy + 1.4) * 2, 0.09, sx * (hx + 1.4), 0, z + FL + 0.75, 'shu')
    for t in range(-4, 5):
        box(0.1, 0.1, 0.8, t * (hx + 1.4) / 4, hy + 1.4, z + FL, 'shu')
    box((hx + 1.4) * 2, 0.09, 0.09, 0, hy + 1.4, z + FL + 0.75, 'shu')
    for sx in (-1, 1):      # 正面は、まん中（向拝）をあける
        for t in (1.6, 2.6, 3.6, 4):
            box(0.1, 0.1, 0.8, sx * t * (hx + 1.4) / 4, -(hy + 1.4), z + FL, 'shu')
        box((hx + 1.4) * 0.6, 0.09, 0.09, sx * (hx + 1.4) * 0.7, -(hy + 1.4), z + FL + 0.75, 'shu')
    zf = z + FL
    # 壁（白）と、柱（各面6本＝五間）
    box(W - 0.2, D - 0.2, H, 0, 0, zf, 'plaster')
    for i in range(6):
        x = -hx + i * W / 5
        for sy in (-1, 1):
            cyl(0.2, H, x, sy * hy, zf, 'shu', verts=10)
    for j in range(1, 5):
        y = -hy + j * D / 5
        for sx in (-1, 1):
            cyl(0.2, H, sx * hx, y, zf, 'shu', verts=10)
    ring_of_boxes(hx, hy, 0.26, 0.28, zf, 'shu')                 # 地覆
    ring_of_boxes(hx, hy, 0.24, 0.26, zf + H * 0.62, 'shu')      # 内法長押
    ring_of_boxes(hx, hy, 0.3, 0.32, zf + H - 0.32, 'shu')       # 頭貫
    # 正面の五間は蔀戸（黒い格子）。横は手前の二間が格子、奥は白壁に連子窓
    bay = W / 5
    for i in range(5):
        x = -hx + (i + 0.5) * bay
        box(bay - 0.5, 0.08, H * 0.6, x, -hy - 0.02, zf + 0.1, 'lattice')
        for q in (-1, 0, 1):
            box(0.05, 0.1, H * 0.6, x + q * (bay - 0.5) / 3.2, -hy - 0.04, zf + 0.1, 'shu_dark')
    bd = D / 5
    for sx in (-1, 1):
        for j in range(2):
            box(0.08, bd - 0.5, H * 0.6, sx * (hx + 0.02), -hy + (j + 0.5) * bd, zf + 0.1, 'lattice')
        for j in range(2, 5):
            box(0.08, bd - 1.0, H * 0.22, sx * (hx + 0.02), -hy + (j + 0.5) * bd, zf + H * 0.34, 'lattice')
    # 組物（二手先）と、軒
    zb = zf + H
    for i in range(2):
        ring_of_boxes(hx + 0.3 + i * 0.5, hy + 0.3 + i * 0.5, 0.36, 0.3, zb + i * 0.32, 'shu_dark')
    zb += 0.64
    # 入母屋の屋根：下は四方へ流れる屋根（てっぺんを平らに切る）、その上に切妻（妻は左右＝X の両端）
    EX, EY = hx + 3.3, hy + 3.3
    core = 3.0
    top = roof(EX, EY, zb, 3.0, core=core, lift=0.7, n=26)
    gw, gd = (EX - (EY - core)) * 2 + 1.6, core * 2 + 0.5
    prism(gw, gd, 2.5, 0, 0, top - 0.12, 'tile', axis='x')
    # 妻（三角の壁）：白壁に、朱の懸魚と破風板
    for sx in (-1, 1):
        beam((sx * (gw / 2 + 0.05), -gd / 2, top - 0.1), (sx * (gw / 2 + 0.05), 0, top + 2.42), 0.14, 0.3, 'shu')
        beam((sx * (gw / 2 + 0.05), gd / 2, top - 0.1), (sx * (gw / 2 + 0.05), 0, top + 2.42), 0.14, 0.3, 'shu')
        box(0.1, gd * 0.55, 1.1, sx * (gw / 2 - 0.08), 0, top + 0.05, 'plaster')
        box(0.12, 0.36, 0.7, sx * (gw / 2 + 0.06), 0, top + 1.5, 'shu_dark')
    # 大棟と、両端の鬼瓦
    box(gw + 0.5, 0.5, 0.5, 0, 0, top + 2.3, 'ridge')
    for sx in (-1, 1):
        box(0.4, 0.7, 0.8, sx * (gw / 2 + 0.2), 0, top + 2.3, 'ridge')
    # 向拝：正面の一間の庇（柱2本、ゆるい片流れの屋根）
    for sx in (-1, 1):
        box(0.34, 0.34, H + 0.6, sx * 2.5, -hy - 3.4, BASE * 0.55, 'shu')
        beam((sx * 2.5, -hy - 3.4, zf + H - 0.3), (sx * 2.5, -hy, zf + H + 0.2), 0.24, 0.26, 'shu')
    box(5.4, 0.3, 0.34, 0, -hy - 3.4, zf + H - 0.45, 'shu')
    # 庇の屋根（板を何枚かずらして、ゆるい曲がりに）
    for k in range(6):
        t = k / 5
        box(6.6, 0.95, 0.2, 0, -hy - 4.3 + k * 0.85, zb - 0.9 + t * 1.25 - 0.25 * (1 - t) ** 2 * 0, 'tile' if k % 2 else 'tile_dark')
    box(6.2, 4.6, 0.12, 0, -hy - 2.2, zb - 1.05 + 0.5, 'under')
    return top + 2.9


if __name__ == '__main__':
    reset()
    h = build()
    o = join_all('jodoji_hondo')
    print('height', round(h, 2))
    export(o, 'jodoji_hondo.glb')
    if '--preview' in sys.argv:
        preview(os.path.abspath(sys.argv[sys.argv.index('--preview') + 1]), h, dist=1.5)
