"""住吉神社（尾道の海岸通り、住吉浜）の社殿を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方: python tools/blender/sumiyoshi.py [--preview a.png] → assets/models/sumiyoshi.glb

  手前（-Y）に拝殿：朱の柱に白い壁、正面は開けた格子戸、緑青の銅板の入母屋の屋根と、正面の向拝。
  奥に、一段高い本殿：流造（前へ長くのびる屋根）、棟に千木と鰹木。あいだを幣殿でつなぐ。
  原点は境内の地面で、拝殿は y=0.2、本殿は y=4.0 が中心。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import material, box, cyl, prism, ring_of_boxes, roof, beam, main


def build():
    material('shu', '#c8442e')
    material('shu_dark', '#8a3020')
    material('plaster', '#f2eee4')
    material('lattice', '#3a2a20')
    material('copper', '#4e7a6a')          # 緑青の銅板
    material('copper_dark', '#44705f')
    material('ridge', '#3e6455')
    material('under', '#a83a26')
    material('stone', '#a8a296', rough=0.95)
    material('gold', '#c8a848', rough=0.5, metal=0.4)
    # ---- 拝殿（5.4 × 3.6） ----
    Y1, W, D, H = 0.2, 5.4, 3.6, 2.8
    box(W + 1.4, D + 1.4, 0.35, 0, Y1, 0, 'stone')
    box(W + 0.9, D + 0.9, 0.25, 0, Y1, 0.35, 'stone')
    z = 0.6
    box(W - 0.15, D - 0.15, H, 0, Y1, z, 'plaster')
    for i in range(4):
        x = -W / 2 + i * W / 3
        for sy in (-1, 1):
            cyl(0.13, H, x, Y1 + sy * D / 2, z, 'shu', verts=10)
    for sx in (-1, 1):
        cyl(0.13, H, sx * W / 2, Y1, z, 'shu', verts=10)
    ring_of_boxes(W / 2, D / 2, 0.2, 0.2, z, 'shu', 0, Y1)
    ring_of_boxes(W / 2, D / 2, 0.18, 0.2, z + H * 0.66, 'shu', 0, Y1)
    ring_of_boxes(W / 2, D / 2, 0.22, 0.24, z + H - 0.24, 'shu', 0, Y1)
    for i in range(3):      # 正面の格子戸（まん中は開いている）
        x = -W / 2 + (i + 0.5) * W / 3
        if i != 1:
            box(W / 3 - 0.3, 0.07, H * 0.62, x, Y1 - D / 2 - 0.01, z + 0.05, 'lattice')
        else:
            box(W / 3 - 0.3, 0.07, H * 0.62, x, Y1 - D / 2 + 0.5, z + 0.05, 'lattice')
    zb = z + H
    ring_of_boxes(W / 2 + 0.25, D / 2 + 0.25, 0.26, 0.22, zb, 'shu_dark', 0, Y1)
    EX, EY, core = W / 2 + 1.35, D / 2 + 1.35, 0.8
    top = roof(EX, EY, zb + 0.22, 1.25, core=core, lift=0.4, n=18, thick=0.16, y0=Y1, mats=('copper', 'copper_dark', 'under'))
    gw, gd = (EX - (EY - core)) * 2 + 0.8, core * 2 + 0.3
    prism(gw, gd, 1.0, 0, Y1, top - 0.08, 'copper', axis='x')
    box(gw + 0.3, 0.26, 0.26, 0, Y1, top + 0.86, 'ridge')
    for sx in (-1, 1):
        box(0.08, gd * 0.5, 0.45, sx * (gw / 2 - 0.05), Y1, top, 'plaster')
    # 向拝（正面の庇）と階段
    for sx in (-1, 1):
        box(0.2, 0.2, H + 0.25, sx * 1.1, Y1 - D / 2 - 1.5, 0.35, 'shu')
        beam((sx * 1.1, Y1 - D / 2 - 1.5, zb - 0.1), (sx * 1.1, Y1 - D / 2, zb + 0.15), 0.16, 0.18, 'shu')
    box(2.6, 0.18, 0.2, 0, Y1 - D / 2 - 1.5, zb - 0.25, 'shu')
    for k in range(4):
        box(3.2, 0.62, 0.12, 0, Y1 - D / 2 - 2.0 + k * 0.6, zb + 0.02 + k * 0.17, 'copper' if k % 2 else 'copper_dark')
    for k in range(3):
        box(2.2, 0.36, 0.2 * (3 - k), 0, Y1 - D / 2 - 0.75 - k * 0.36, 0, 'stone')
    # ---- 幣殿（つなぎ） ----
    box(2.0, 1.4, 2.2, 0, 2.3, 0.6, 'plaster')
    prism(2.6, 1.6, 0.6, 0, 2.3, 2.8, 'copper', axis='y')
    # ---- 本殿（3.2 × 3.0、一段高い）：流造 ----
    Y2, W2, D2, H2 = 4.0, 3.2, 3.0, 2.6
    box(W2 + 1.4, D2 + 1.4, 1.2, 0, Y2, 0, 'stone')
    z2 = 1.2
    box(W2 - 0.1, D2 - 0.1, H2, 0, Y2, z2, 'plaster')
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(0.14, H2, sx * W2 / 2, Y2 + sy * D2 / 2, z2, 'shu', verts=10)
    ring_of_boxes(W2 / 2, D2 / 2, 0.18, 0.2, z2, 'shu', 0, Y2)
    ring_of_boxes(W2 / 2, D2 / 2, 0.2, 0.22, z2 + H2 - 0.22, 'shu', 0, Y2)
    box(1.3, 0.07, H2 * 0.7, 0, Y2 - D2 / 2 - 0.01, z2 + 0.05, 'lattice')
    ring_of_boxes(W2 / 2 + 0.55, D2 / 2 + 0.55, 0.08, 0.08, z2 + 0.7, 'shu', 0, Y2)   # 高欄
    zr = z2 + H2
    # 屋根：棟は左右（X）。うしろは短く、前は長くのびる
    RW = W2 + 1.8
    ridge_z = zr + 1.5
    beam((0, Y2 + D2 / 2 + 0.9, zr - 0.1), (0, Y2, ridge_z), RW, 0.16, 'copper')
    beam((0, Y2, ridge_z), (0, Y2 - D2 / 2 - 0.4, zr + 0.15), RW, 0.16, 'copper_dark')
    beam((0, Y2 - D2 / 2 - 0.4, zr + 0.15), (0, Y2 - D2 / 2 - 2.0, zr - 0.45), RW, 0.16, 'copper')
    for sx in (-1, 1):      # 妻の白壁（三角）
        prism(D2, 0.1, 1.35, sx * (W2 / 2 - 0.02), Y2, zr, 'plaster', axis='y') if False else box(0.1, D2 * 0.55, 0.7, sx * (W2 / 2 - 0.02), Y2, zr, 'plaster')
    box(RW + 0.2, 0.3, 0.26, 0, Y2, ridge_z - 0.02, 'ridge')
    for k in (-1, 0, 1):    # 鰹木
        cyl(0.11, 0.9, k * 1.1, Y2 - 0.45, ridge_z + 0.2, 'gold', verts=8).rotation_euler = (0, 0, 0)
    for sx in (-1, 1):      # 千木（棟の両端で交差する板）
        beam((sx * (RW / 2 - 0.1), Y2 - 0.7, ridge_z - 0.2), (sx * (RW / 2 - 0.1), Y2 + 0.75, ridge_z + 1.25), 0.07, 0.16, 'shu_dark')
        beam((sx * (RW / 2 - 0.1), Y2 + 0.7, ridge_z - 0.2), (sx * (RW / 2 - 0.1), Y2 - 0.75, ridge_z + 1.25), 0.07, 0.16, 'shu_dark')
    return 6.5


if __name__ == '__main__':
    main(build, 'sumiyoshi', 'sumiyoshi.glb', sys.argv, dist=1.9)
