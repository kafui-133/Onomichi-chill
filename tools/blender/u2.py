"""ONOMICHI U2（海ぞいの古い倉庫「県営上屋2号」を直した、ホテルと店の建物）を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方: python tools/blender/u2.py [--preview a.png] → assets/models/u2.glb

  長さ 100m × 幅 26m（ゲームでは、地図の輪郭に合わせて少し伸び縮みさせる）。正面（-Y）は海。
  濃い灰色のコンクリートの長い倉庫。6.25m ごとの柱、高い位置の横長の窓、海側の1階は大きなガラスの開口
  （夜は灯る 'interior_light'）と鉄の庇。ゆるい切妻の屋根に、棟の越屋根。両端の妻に、大きな引き戸。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import material, box, prism, main

L, W, H = 100.0, 26.0, 7.5
BAY = 6.25


def build():
    material('wall', '#5a6068')
    material('wall_dark', '#4c5158')
    material('roof', '#6e7278')
    material('roof_dark', '#5e6268')
    material('interior_light', '#d8c8a4')
    material('pane', '#39424c')
    material('door', '#3a3e44')
    material('steel', '#2e3236')
    material('conc', '#8a8a86')
    box(L, W, H, 0, 0, 0, 'wall')
    box(L + 0.2, W + 0.2, 0.5, 0, 0, -0.3, 'conc')                   # 足もとの基礎
    prism(L + 0.8, W + 1.0, 3.0, 0, 0, H, 'roof', axis='x')          # 切妻（棟は長い向き）
    box(L * 0.82, 2.6, 0.9, 0, 0, H + 2.6, 'roof_dark')              # 越屋根
    box(L * 0.82 + 0.4, 3.2, 0.14, 0, 0, H + 3.5, 'roof')
    n = int(L / BAY)
    for k in range(n + 1):
        x = -L / 2 + k * BAY
        for sy in (-1, 1):
            box(0.55, 0.3, H, x, sy * (W / 2 + 0.1), 0, 'wall_dark')  # 柱
    for sy in (-1, 1):
        box(L, 0.34, 0.5, 0, sy * (W / 2 + 0.1), H - 0.5, 'wall_dark')  # 軒の梁
    for k in range(n):
        x = -L / 2 + (k + 0.5) * BAY
        # 高い位置の横長の窓（海側は灯る、陸側は暗いガラス）
        box(BAY - 1.5, 0.08, 1.1, x, -(W / 2 + 0.02), 5.2, 'interior_light')
        box(BAY - 1.5, 0.08, 1.1, x, W / 2 + 0.02, 5.2, 'pane')
        for q in (-1, 0, 1):
            box(0.07, 0.1, 1.1, x + q * (BAY - 1.5) / 3, -(W / 2 + 0.04), 5.2, 'steel')
        # 海側の1階：1つおきに、大きなガラスの開口
        if k % 2 == 1:
            box(BAY - 1.3, 0.08, 3.1, x, -(W / 2 + 0.03), 0.25, 'interior_light')
            box(BAY - 1.2, 0.12, 0.12, x, -(W / 2 + 0.05), 3.3, 'steel')
            for q in (-1, 0, 1):
                box(0.08, 0.12, 3.1, x + q * (BAY - 1.3) / 2, -(W / 2 + 0.05), 0.25, 'steel')
        elif k % 4 == 0:
            box(2.8, 0.1, 3.4, x, W / 2 + 0.03, 0.1, 'door')            # 陸側の搬入口
    # 海側の鉄の庇（まん中の 60m）
    box(60, 2.4, 0.12, 0, -(W / 2 + 1.3), 3.7, 'steel')
    for k in range(-5, 6):
        box(0.1, 0.1, 3.7, k * 6, -(W / 2 + 2.4), 0, 'steel')
    # 妻（両端）：大きな引き戸と、上の丸窓のかわりの小窓
    for sx in (-1, 1):
        box(0.12, 7.0, 5.2, sx * (L / 2 + 0.02), 0, 0.1, 'door')
        box(0.14, 0.12, 5.2, sx * (L / 2 + 0.04), 0, 0.1, 'steel')
        box(0.1, 3.0, 1.0, sx * (L / 2 + 0.02), 0, 7.6, 'pane')
        box(0.3, W + 0.6, 0.3, sx * (L / 2 + 0.25), 0, H - 0.3, 'wall_dark')
    return 11.0


if __name__ == '__main__':
    main(build, 'u2', 'u2.glb', sys.argv, dist=4.0)
