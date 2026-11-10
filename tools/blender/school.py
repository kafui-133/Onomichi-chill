"""土堂小学校の校舎（坂の途中の、白い鉄筋コンクリート3階建て）を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方: python tools/blender/school.py [--preview a.png] → assets/models/school.glb

  長さ 50m × 奥行 9m × 高さ 11.2m。正面（-Y）は校庭の側。原点は校庭の高さ。
  4m ごとの柱と各階のひさし、教室の大きな窓（白い桟）、まん中に玄関（庇と段）、その上に時計。
  裏は廊下の小さな窓。屋上にフェンス、階段室、給水タンク。坂に建つので、基礎は 6m 下まである。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import material, box, cyl, disc, main

L, D, FH, NF = 50.0, 9.0, 3.6, 3
H = FH * NF + 0.4
BAY = 4.0


def build():
    material('wall', '#ecebe4')
    material('frame', '#dcdad2')
    material('pane', '#4a5a66')
    material('sash', '#f4f4f0')
    material('roof', '#b8b6ae')
    material('conc', '#a8a49a')
    material('fence', '#7a8a80')
    material('door', '#5a4a3c')
    material('clock', '#f8f6ee')
    material('dark', '#2a2e30')
    material('tank', '#c8ccd0')
    box(L, D, 6.0, 0, 0, -6.0, 'conc')
    box(L, D, H, 0, 0, 0, 'wall')
    n = int(L / BAY)            # 12 スパン（両端は 1m の壁）
    x0 = -n * BAY / 2
    for k in range(n + 1):
        box(0.45, 0.28, H, x0 + k * BAY, -(D / 2 + 0.1), 0, 'frame')         # 柱
        box(0.45, 0.2, H, x0 + k * BAY, D / 2 + 0.06, 0, 'frame')
    for f in range(NF + 1):
        box(L + 0.2, 0.75, 0.22, 0, -(D / 2 + 0.3), f * FH if f else 0.0, 'frame')   # 各階のひさし
    for f in range(NF):
        z = f * FH + 1.05
        for k in range(n):
            x = x0 + (k + 0.5) * BAY
            entrance = f == 0 and k in (n // 2 - 1, n // 2)
            if entrance:
                continue
            # 教室の窓（正面）
            box(BAY - 0.7, 0.08, 1.9, x, -(D / 2 + 0.02), z, 'pane')
            for q in (-1, 0, 1):
                box(0.07, 0.1, 1.9, x + q * (BAY - 0.7) / 3.2, -(D / 2 + 0.04), z, 'sash')
            box(BAY - 0.7, 0.1, 0.07, x, -(D / 2 + 0.04), z + 1.25, 'sash')
            # 廊下の窓（裏）
            box(1.9, 0.08, 1.0, x, D / 2 + 0.02, z + 0.55, 'pane')
            box(0.06, 0.1, 1.0, x, D / 2 + 0.04, z + 0.55, 'sash')
    # 玄関（まん中の2スパン）：戸、庇、柱、段
    box(BAY * 2 - 1.2, 0.1, 2.5, 0, -(D / 2 + 0.02), 0.2, 'door')
    for q in (-1.5, -0.5, 0.5, 1.5):
        box(1.2, 0.12, 1.5, q * 1.6, -(D / 2 + 0.04), 0.9, 'pane')
    box(BAY * 2 + 0.6, 2.6, 0.22, 0, -(D / 2 + 1.3), 2.9, 'frame')
    for sx in (-1, 1):
        box(0.3, 0.3, 2.9, sx * (BAY - 0.2), -(D / 2 + 2.3), 0, 'frame')
    for k in range(2):
        box(BAY * 2, 0.4, 0.1 * (2 - k), 0, -(D / 2 + 2.9 + k * 0.4), 0, 'conc')
    # 時計（玄関の上、3階の窓の上）
    disc(0.85, 0.1, 0, -(D / 2 + 0.46), H - 0.75, 'dark')
    disc(0.75, 0.12, 0, -(D / 2 + 0.48), H - 0.75, 'clock')
    box(0.07, 0.04, 0.55, 0, -(D / 2 + 0.56), H - 0.75, 'dark')
    box(0.42, 0.04, 0.06, 0.18, -(D / 2 + 0.56), H - 0.78, 'dark')
    box(2.4, 0.5, 1.9, 0, -(D / 2 + 0.2), H - 1.7, 'wall')                 # 時計の台（壁から少し出る）
    # 両端：階段室の縦長の窓
    for sx in (-1, 1):
        for f in range(NF):
            box(0.08, 1.4, 2.0, sx * (L / 2 + 0.02), 0, f * FH + 1.0, 'pane')
    # 屋上：ふち、フェンス、階段室、給水タンク
    box(L + 0.3, D + 0.3, 0.3, 0, 0, H, 'roof')
    for sy in (-1, 1):
        box(L - 0.4, 0.05, 0.05, 0, sy * (D / 2 - 0.2), H + 1.5, 'fence')
        box(L - 0.4, 0.04, 0.04, 0, sy * (D / 2 - 0.2), H + 0.9, 'fence')
        for k in range(0, 26):
            box(0.05, 0.05, 1.25, -L / 2 + 0.4 + k * (L - 0.8) / 25, sy * (D / 2 - 0.2), H + 0.3, 'fence')
    box(6, 5.2, 3.0, L / 2 - 4, 0.5, H + 0.3, 'wall')
    box(6.3, 5.5, 0.2, L / 2 - 4, 0.5, H + 3.3, 'roof')
    box(0.08, 1.4, 2.0, L / 2 - 7.02, 0.5, H + 0.4, 'door')
    cyl(1.3, 2.2, -L / 2 + 6, 0.5, H + 1.1, 'tank', verts=16)
    for sx in (-0.8, 0.8):
        for sy in (-0.8, 0.8):
            box(0.12, 0.12, 0.8, -L / 2 + 6 + sx, 0.5 + sy, H + 0.3, 'fence')
    return 15.5


if __name__ == '__main__':
    main(build, 'school', 'school.glb', sys.argv, dist=2.6)
