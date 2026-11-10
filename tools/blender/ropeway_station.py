"""千光寺山ロープウェイの駅（山麓駅・山頂駅で同じ形を使う）を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方: python tools/blender/ropeway_station.py [--preview a.png] → assets/models/ropeway_station.glb

  原点はゴンドラの着くところ（乗り場のまん中、床の高さ 0.3m）。ケーブルは -X のほうから来る。
  乗り場（x -3.5〜3.5）：コンクリートの土台、4本の柱に赤い屋根、屋根の下にケーブルをまわす大きな車輪、両わきの手すり。
  駅舎（x 3.5〜13.5）：白い2階建て。ガラスの帯（夜は灯る 'interior_light'）、赤い帯、屋上の機械、奥の入口と庇。
  坂に建つので、土台は地面の下まで（乗り場 5m、駅舎 3m）のばしてある。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import material, box, cyl, torus, main


def build():
    material('wall', '#e8e6e0')
    material('red', '#7a2a22')
    material('interior_light', '#d8ccb0')
    material('steel', '#8a8e90')
    material('conc', '#b8b4aa')
    material('dark', '#2a2e33')
    material('roof', '#9a9c9e')
    F = 0.3
    # ---- 乗り場 ----
    box(7, 7.6, 5.3, 0, 0, -5.0, 'conc')
    for sx in (-3.2, 3.2):
        for sy in (-3.5, 3.5):
            box(0.32, 0.32, 5.7, sx, sy, F, 'steel')
    box(7.8, 8.4, 0.3, 0, 0, 6.2, 'red')            # 屋根
    box(7.6, 8.2, 0.55, 0, 0, 5.7, 'red')           # 屋根のふち（鼻隠し）
    box(7.2, 7.8, 0.12, 0, 0, 5.6, 'roof')          # 天井
    for sy in (-3.6, 3.6):                          # 手すり
        box(6.6, 0.07, 0.07, 0, sy, F + 1.0, 'steel')
        box(6.6, 0.05, 0.05, 0, sy, F + 0.55, 'steel')
        for k in range(-3, 4):
            box(0.06, 0.06, 1.0, k * 1.08, sy, F, 'steel')
    torus(2.6, 0.13, 5.25, 'dark')                  # ケーブルをまわす車輪
    cyl(0.3, 0.7, 0, 0, 5.0, 'dark', verts=12)
    for a in range(4):
        box(5.0 if a % 2 == 0 else 0.1, 0.1 if a % 2 == 0 else 5.0, 0.1, 0, 0, 5.2, 'dark')
    # 乗り場の床のふちの黄色い線のかわりに、濃い帯
    box(0.25, 7.2, 0.03, -3.3, 0, F, 'dark')
    # ---- 駅舎 ----
    X0, W, D, H = 8.5, 10.0, 9.0, 6.9
    box(W, D, 3.3, X0, 0, -3.0, 'conc')
    box(W, D, H, X0, 0, F, 'wall')
    # ガラスの帯（2階）。縦の桟
    box(W + 0.06, D + 0.06, 1.5, X0, 0, F + 3.6, 'interior_light')
    for k in range(-4, 5):
        for sy in (-1, 1):
            box(0.09, 0.09, 1.5, X0 + k * 1.2, sy * (D / 2 + 0.04), F + 3.6, 'steel')
    for k in range(-3, 4):
        box(0.09, 0.09, 1.5, X0 + W / 2 + 0.04, k * 1.25, F + 3.6, 'steel')
    for sy in (-1, 1):
        box(0.12, 0.12, 1.5, X0 + W / 2 + 0.02, sy * (D / 2 + 0.02), F + 3.6, 'wall')
    box(W + 0.1, D + 0.1, 0.35, X0, 0, F + 5.6, 'red')          # 赤い帯
    box(W + 0.4, D + 0.4, 0.3, X0, 0, F + H, 'roof')            # 屋上のふち
    box(2.4, 1.8, 1.0, X0 + 2, 1.5, F + H + 0.3, 'steel')        # 屋上の機械
    box(1.2, 1.2, 0.7, X0 - 2.5, -2, F + H + 0.3, 'steel')
    # 1階の窓（両わき）と、奥（+X）の入口・庇
    for sy in (-1, 1):
        for k in (-1, 1):
            box(2.6, 0.08, 1.3, X0 + k * 2.4, sy * (D / 2 + 0.02), F + 1.0, 'interior_light')
            box(2.7, 0.1, 0.08, X0 + k * 2.4, sy * (D / 2 + 0.03), F + 0.95, 'steel')
    box(0.1, 2.6, 2.3, X0 + W / 2 + 0.02, 0, F, 'dark')
    box(0.12, 1.2, 2.1, X0 + W / 2 + 0.05, 0, F + 0.05, 'interior_light')
    box(1.9, 3.6, 0.16, X0 + W / 2 + 0.95, 0, F + 2.5, 'red')
    for sy in (-1.6, 1.6):
        box(0.1, 0.1, 2.5, X0 + W / 2 + 1.75, sy, F, 'steel')
    box(2.4, 4.2, 0.3, X0 + W / 2 + 1.2, 0, 0, 'conc')
    # 乗り場との境の壁：改札の開口
    box(0.2, D, H, 3.6, 0, F, 'wall')
    box(0.24, 3.0, 2.4, 3.6, 0, F, 'dark')
    return 8.5


if __name__ == '__main__':
    main(build, 'ropeway_station', 'ropeway_station.glb', sys.argv, dist=1.6)
