"""尾道市立美術館（千光寺公園の中。打ち放しのコンクリートに、ガラスの吹き抜けと、木を組んだ深い庇）を
Blender で組み立てて、glTF（.glb）に書き出す。

  使い方: python tools/blender/museum.py [--preview a.png] → assets/models/museum.glb

  間口 46m × 奥行 34m（ゲームでは、地図の輪郭に合わせて少し伸び縮みさせる）。正面（-Y）は坂の下＝海のほう。
  奥：打ち放しの2階建ての箱（型枠の目地の横すじ、屋上の天窓）。手前左：ガラスの吹き抜け（'glass'、奥の壁は夜に灯る
  'interior_light'）。手前右：低い別棟。吹き抜けの前に、木の格子の庇と柱。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import material, box, main

W, D, H = 46.0, 34.0, 7.5


def build():
    material('conc', '#bdbab2')
    material('conc_dark', '#a8a59e')
    material('joint', '#9c9992')
    material('glass', '#7f98a4')
    material('interior_light', '#d8cdb4')
    material('wood', '#9a7448')
    material('wood_dark', '#8a6640')
    material('dark', '#3a3836')
    material('roof', '#8e8b84')
    box(W, D + 3, 3.4, 0, -1.5, -3.2, 'conc_dark')             # 基壇（坂の下の側は、前庭のテラスになる。地面の下まで）
    # ---- 奥の箱 ----
    BD = D * 0.62
    BY = D / 2 - BD / 2
    box(W, BD, H, 0, BY, 0.2, 'conc')
    for k in range(1, 5):                                      # 型枠の目地（横すじ）
        box(W + 0.04, BD + 0.04, 0.05, 0, BY, 0.2 + k * 1.5, 'joint')
    for x in range(-20, 21, 5):                                # 縦の目地
        box(0.05, BD + 0.04, H, x, BY, 0.2, 'joint')
    box(W + 0.3, BD + 0.3, 0.25, 0, BY, 0.2 + H, 'roof')       # 屋上のふち
    for x in (-13, 0, 13):                                     # 天窓
        box(5, 3, 0.9, x, BY + 1, 0.45 + H, 'conc_dark')
        box(4.4, 2.4, 0.1, x, BY + 1, 1.35 + H, 'glass')
    # 奥の箱の正面（吹き抜けの奥の壁）は、夜に灯る
    HW, HD, HH = W * 0.62, D * 0.34, H - 1.2
    HX, HY = -W * 0.12, -D / 2 + HD / 2 + D * 0.03
    box(HW - 0.6, 0.12, HH - 0.4, HX, BY - BD / 2 - 0.08, 0.3, 'interior_light')
    # ---- ガラスの吹き抜け：屋根の板と、ガラスの3面、縦の桟 ----
    box(HW + 0.6, HD + 0.8, 0.35, HX, HY, 0.2 + HH, 'conc')
    box(HW, 0.08, HH, HX, HY - HD / 2, 0.2, 'glass')
    for sx in (-1, 1):
        box(0.08, HD, HH, HX + sx * HW / 2, HY, 0.2, 'glass')
    n = int(HW / 1.6)
    for k in range(n + 1):
        box(0.09, 0.12, HH, HX - HW / 2 + k * HW / n, HY - HD / 2 - 0.02, 0.2, 'dark')
    box(HW, 0.12, 0.1, HX, HY - HD / 2 - 0.02, 0.2 + HH * 0.45, 'dark')
    box(HW, HD, 0.12, HX, HY, 0.14, 'conc_dark')               # 床
    # ---- 別棟（手前右）：細い横長の窓 ----
    WW, WH = W * 0.3, H - 2.5
    WX = W * 0.35
    box(WW, HD, WH, WX, HY, 0.2, 'conc')
    box(WW * 0.7, 0.08, 0.7, WX, HY - HD / 2 - 0.02, 0.2 + WH * 0.55, 'dark')
    box(WW + 0.3, HD + 0.3, 0.22, WX, HY, 0.2 + WH, 'roof')
    for k in range(1, 3):
        box(WW + 0.04, HD + 0.04, 0.05, WX, HY, 0.2 + k * 1.5, 'joint')
    # ---- 木の格子の庇（吹き抜けの前へ 4.5m）と、柱 ----
    LY0, LY1, LZ = HY - HD / 2, HY - HD / 2 - 4.5, 0.2 + HH - 0.3
    x = HX - HW / 2 + 0.4
    while x <= HX + HW / 2 - 0.3:
        box(0.14, LY0 - LY1, 0.24, x, (LY0 + LY1) / 2, LZ, 'wood')
        x += 0.7
    y = LY1
    while y <= LY0:
        box(HW - 0.4, 0.14, 0.14, HX, y, LZ - 0.2, 'wood_dark')
        y += 0.75
    for sx in (-1, -0.33, 0.33, 1):
        box(0.3, 0.3, LZ, HX + sx * (HW / 2 - 0.6), LY1 + 0.3, 0, 'wood')
    # 前庭のテラスの手すり（坂の下の側）
    box(W, 0.08, 0.08, 0, -D / 2 - 2.9, 1.2, 'dark')
    for k in range(-11, 12):
        box(0.07, 0.07, 1.0, k * 2, -D / 2 - 2.9, 0.2, 'dark')
    return 10.0


if __name__ == '__main__':
    main(build, 'museum', 'museum.glb', sys.argv, dist=3.2)
