#!/usr/bin/env python3
"""尾道の実データを取得する（1回だけ実行すればよい）。

  - OpenStreetMap（Overpass API）：道・階段・線路・ロープウェイ・海岸線・建物・寺社など
  - 国土地理院 標高タイル（DEM5A、なければ DEM10B）：地面の高さ

取得したものは tools/raw/ に保存され、tools/build_town_data.py が
ゲーム用の js/data/onomichi.js に変換する。

  python3 tools/fetch_data.py
"""
import json
import math
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
UA = 'onomichi-chill-prototype/0.1 (game prototype; github.com/kafui-133/Onomichi-chill)'

# 尾道駅〜長江口〜浄土寺の手前、尾道水道の対岸（向島の岸）まで
BBOX = (34.3985, 133.1880, 34.4150, 133.2120)  # 南, 西, 北, 東


def curl(args, out):
    for attempt in range(5):
        r = subprocess.run(['curl', '-sS', '-m', '180', '-A', UA, '-o', out, '-w', '%{http_code}'] + args,
                           capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip() in ('200', '404'):
            return r.stdout.strip()
        print(f'  retry {attempt + 1}: {r.stderr.strip() or r.stdout}', file=sys.stderr)
        time.sleep(2 ** attempt * 2)
    raise SystemExit(f'failed: {args[-1]}')


def fetch_osm():
    s, w, n, e = BBOX
    b = f'{s},{w},{n},{e}'
    q = f"""[out:json][timeout:150];
(
  way["highway"]({b});
  way["railway"~"^(rail|narrow_gauge|platform)$"]({b});
  way["aerialway"]({b});
  way["natural"="coastline"](34.385,133.170,34.425,133.230);
  way["building"]({b});
  relation["building"]({b});
  way["man_made"~"^(pier|breakwater|quay)$"]({b});
  nwr["amenity"~"^(place_of_worship|ferry_terminal)$"]({b});
  nwr["historic"]({b});
  nwr["tourism"]({b});
);
out geom tags;"""
    out = os.path.join(RAW, 'osm.json')
    print('Overpass ...')
    curl(['--data-urlencode', f'data={q}', 'https://overpass-api.de/api/interpreter'], out)
    d = json.load(open(out))
    print(f'  {len(d["elements"])} elements')


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    lr = math.radians(lat)
    y = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n
    return x, y


def fetch_dem():
    s, w, n, e = BBOX
    for kind, z in (('dem5a', 15), ('dem10b', 14)):
        x0, y0 = tile_xy(n, w, z)
        x1, y1 = tile_xy(s, e, z)
        for tx in range(int(x0), int(x1) + 1):
            for ty in range(int(y0), int(y1) + 1):
                out = os.path.join(RAW, f'{kind}_{z}_{tx}_{ty}.txt')
                if os.path.exists(out):
                    continue
                code = curl([f'https://cyberjapandata.gsi.go.jp/xyz/{kind}/{z}/{tx}/{ty}.txt'], out)
                print(f'  {kind} {z}/{tx}/{ty}: {code}')
                if code == '404':
                    os.remove(out)


if __name__ == '__main__':
    os.makedirs(RAW, exist_ok=True)
    fetch_dem()
    fetch_osm()
