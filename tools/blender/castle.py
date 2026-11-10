"""尾道城（千光寺山の上に建っていた、三層の天守閣風の建物）を Blender で組み立てて、glTF（.glb）に書き出す。

  使い方: python tools/blender/castle.py [--preview a.png] → assets/models/castle.glb

  すぼまった石垣の上に、白いしっくいの三層。各層に反りのある瓦屋根、一層目の正面に千鳥破風（三角の小屋根）、
  最上階は高欄のまわる望楼で、入母屋の屋根に金のしゃちほこ。高さ約26m。正面は -Y。
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import material, box, frustum, prism, ring_of_boxes, roof, beam, reset, join_all, export, preview


def mats():
    material('plaster', '#efede6')        # 白いしっくい
    material('wood_dark', '#2e2a28')      # 窓の格子・下見板
    material('tile', '#4a505a')
    material('tile_dark', '#3c424c')
    material('ridge', '#5a606a')
    material('under', '#e4e0d6')          # 軒裏も白く塗りこめる
    material('stone', '#8f897d', rough=0.95)
    material('stone_dark', '#7c766c', rough=0.95)
    material('gold', '#b89a4a', rough=0.5, metal=0.4)
    material('rail', '#6a3a2a')           # 望楼の高欄（朱がかった木）


def windows(hx, hy, z, h, n_x, n_y, w=0.9):
    """各面に、縦格子の窓（黒い枠）を並べる"""
    for i in range(n_x):
        x = (i + 0.5) / n_x * hx * 2 - hx
        for sy in (-1, 1):
            box(w, 0.08, h, x, sy * (hy + 0.01), z, 'wood_dark')
    for j in range(n_y):
        y = (j + 0.5) / n_y * hy * 2 - hy
        for sx in (-1, 1):
            box(0.08, w, h, sx * (hx + 0.01), y, z, 'wood_dark')


def build():
    mats()
    # ---- 石垣：すぼまった台。石の段のすじを、少しずつ色を変えた帯で ----
    SH = 6.0
    bx, by, tx, ty = 17.0, 14.5, 13.6, 11.2
    bands = 6
    for k in range(bands):
        t0, t1 = k / bands, (k + 1) / bands
        frustum(bx + (tx - bx) * t0, by + (ty - by) * t0, bx + (tx - bx) * t1, by + (ty - by) * t1, SH / bands, 0, 0, SH * t0, 'stone' if k % 2 else 'stone_dark')
    z = SH
    # ---- 一層目 ----
    hx, hy, h = 6.3, 5.1, 4.4
    box(hx * 2, hy * 2, h, 0, 0, z, 'plaster')
    box(hx * 2 + 0.06, hy * 2 + 0.06, 1.3, 0, 0, z, 'wood_dark')      # 腰の下見板（黒い板張り）
    windows(hx, hy, z + 2.2, 1.1, 5, 4)
    top1 = roof(hx + 1.6, hy + 1.6, z + h, 1.7, core=hy - 0.6, lift=0.5, n=22)
    # 千鳥破風（正面と背面の、三角の小屋根）
    for sy in (-1, 1):
        prism(4.2, 3.0, 1.5, 0, sy * (hy + 0.4), z + h + 0.45, 'tile', axis='y')
        box(2.2, 0.1, 0.9, 0, sy * (hy + 1.86), z + h + 0.5, 'plaster')
        beam((-2.1, sy * (hy + 1.92), z + h + 0.45), (0, sy * (hy + 1.92), z + h + 1.95), 0.12, 0.24, 'ridge')
        beam((2.1, sy * (hy + 1.92), z + h + 0.45), (0, sy * (hy + 1.92), z + h + 1.95), 0.12, 0.24, 'ridge')
    # ---- 二層目 ----
    z = top1 - 0.5
    hx, hy, h = 4.9, 3.8, 3.9
    box(hx * 2, hy * 2, h, 0, 0, z, 'plaster')
    windows(hx, hy, z + 1.9, 1.0, 4, 3)
    top2 = roof(hx + 1.45, hy + 1.45, z + h, 1.5, core=hy - 0.7, lift=0.5, n=22)
    # 左右に小さな切妻（比翼の破風のかわり）
    for sx in (-1, 1):
        prism(2.6, 3.0, 1.2, sx * (hx + 0.3), 0, z + h + 0.4, 'tile', axis='x')
    # ---- 三層目（望楼）：まわりに高欄 ----
    z = top2 - 0.45
    hx, hy, h = 3.4, 2.7, 3.5
    box(hx * 2, hy * 2, h, 0, 0, z, 'plaster')
    windows(hx, hy, z + 1.4, 1.5, 3, 2, w=1.3)
    ring_of_boxes(hx + 0.55, hy + 0.55, 1.1, 0.14, z + 0.5, 'rail')
    ring_of_boxes(hx + 1.0, hy + 1.0, 0.09, 0.09, z + 1.35, 'rail')
    for i in range(-3, 4):
        for sy in (-1, 1):
            box(0.09, 0.09, 0.8, i * (hx + 1.0) / 3, sy * (hy + 1.0), z + 0.6, 'rail')
    for j in range(-2, 3):
        for sx in (-1, 1):
            box(0.09, 0.09, 0.8, sx * (hx + 1.0), j * (hy + 1.0) / 2, z + 0.6, 'rail')
    # 入母屋の屋根：四方へ流れる屋根の上に、切妻（妻は左右）
    EX, EY = hx + 1.7, hy + 1.7
    core = 1.5
    top3 = roof(EX, EY, z + h, 1.6, core=core, lift=0.6, n=22)
    gw, gd = (EX - (EY - core)) * 2 + 1.0, core * 2 + 0.4
    prism(gw, gd, 1.7, 0, 0, top3 - 0.1, 'tile', axis='x')
    for sx in (-1, 1):
        box(0.1, gd * 0.5, 0.75, sx * (gw / 2 - 0.06), 0, top3, 'plaster')
        beam((sx * (gw / 2 + 0.04), -gd / 2, top3 - 0.05), (sx * (gw / 2 + 0.04), 0, top3 + 1.62), 0.12, 0.24, 'ridge')
        beam((sx * (gw / 2 + 0.04), gd / 2, top3 - 0.05), (sx * (gw / 2 + 0.04), 0, top3 + 1.62), 0.12, 0.24, 'ridge')
    box(gw + 0.3, 0.4, 0.4, 0, 0, top3 + 1.5, 'ridge')
    # しゃちほこ（金）：棟の両端に、尾を上げた魚のかたち
    for sx in (-1, 1):
        box(0.3, 0.26, 0.5, sx * (gw / 2 - 0.1), 0, top3 + 1.9, 'gold')
        beam((sx * (gw / 2 - 0.1), 0, top3 + 2.3), (sx * (gw / 2 - 0.55), 0, top3 + 2.95), 0.2, 0.2, 'gold')
    return top3 + 3.0


if __name__ == '__main__':
    reset()
    h = build()
    o = join_all('onomichi_castle')
    print('height', round(h, 2))
    export(o, 'castle.glb')
    if '--preview' in sys.argv:
        preview(os.path.abspath(sys.argv[sys.argv.index('--preview') + 1]), h, dist=1.25)
