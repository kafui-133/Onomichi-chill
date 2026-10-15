#!/usr/bin/env python3
"""tools/raw/ の実データ（OpenStreetMap＋国土地理院DEM）を、ゲーム用の js/data/onomichi.js に変換する。

座標系（ゲーム内）
  原点 = 空き家（東土堂、千光寺山の中腹。中村憲吉旧居の約60m南で、南に尾道水道が開けている場所）
  +x = 西、-x = 東、+z = 北、-z = 南（尾道水道）
  y   = 標高 − 空き家の床の標高（m）。海面は y = -H0

  python3 tools/build_town_data.py

地図データ © OpenStreetMap contributors (ODbL)
標高データ 国土地理院 基盤地図情報数値標高モデル（DEM5A）
"""
import base64
import glob
import json
import math
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
OUT = os.path.join(HERE, '..', 'js', 'data', 'onomichi.js')

# 原点（空き家）。中村憲吉旧居（34.4103194, 133.1992893）は南側に尾根があり海が見えないため、
# 標高から「南の視界が開けていて、小径に近い」地点を探して少し南へずらした
LAT0, LON0 = 34.4097587, 133.1993328
FLOOR_ABOVE_GROUND = 0.4                # 床は地面より少し高い
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
DEM_STEP = 5.0

ROAD_WIDTH = {
    'trunk': 9, 'primary': 8, 'secondary': 8, 'tertiary': 6, 'tertiary_link': 5, 'unclassified': 4.5,
    'residential': 4, 'service': 3, 'living_street': 3.5, 'pedestrian': 5, 'footway': 2, 'path': 1.6,
    'steps': 1.8, 'cycleway': 2, 'track': 2.5,
}
SKIP_HIGHWAY = {'motorway', 'motorway_link', 'corridor', 'elevator', 'platform', 'construction', 'proposed'}


def to_local(lat, lon):
    return (-(lon - LON0) * M_LON, (lat - LAT0) * M_LAT)


def r1(v):
    return round(v, 1)


# ---------- 標高 ----------
def load_dem():
    tiles = {}
    for f in glob.glob(os.path.join(RAW, 'dem5a_15_*.txt')):
        _, z, x, y = os.path.basename(f)[:-4].split('_')
        rows = [[None if v == 'e' else float(v) for v in l.split(',')] for l in open(f).read().strip().split('\n')]
        tiles[(int(x), int(y))] = rows
    return tiles


def dem_at(tiles, lat, lon, z=15):
    n = 2 ** z
    fx = (lon + 180) / 360 * n * 256
    lr = math.radians(lat)
    fy = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n * 256
    # バイリニア補間（海＝None は除いて平均）
    x0, y0 = int(fx - 0.5), int(fy - 0.5)
    tx, ty = fx - 0.5 - x0, fy - 0.5 - y0
    acc, wsum = 0.0, 0.0
    for dx, dy, w in ((0, 0, (1 - tx) * (1 - ty)), (1, 0, tx * (1 - ty)), (0, 1, (1 - tx) * ty), (1, 1, tx * ty)):
        px, py = x0 + dx, y0 + dy
        t = tiles.get((px // 256, py // 256))
        if not t:
            continue
        v = t[py % 256][px % 256]
        if v is None:
            continue
        acc += v * w
        wsum += w
    return acc / wsum if wsum > 0.25 else None


def main():
    osm = json.load(open(os.path.join(RAW, 'osm.json')))['elements']
    tiles = load_dem()
    h_ground = dem_at(tiles, LAT0, LON0)
    H0 = h_ground + FLOOR_ABOVE_GROUND
    print(f'空き家の地面の標高 {h_ground:.2f} m → 床 {H0:.2f} m')

    # ---------- 標高グリッド ----------
    S, W, N, E = 34.3985, 133.1880, 34.4150, 133.2120
    xw, zs = to_local(S, W)
    xe, zn = to_local(N, E)
    x0, x1 = min(xw, xe), max(xw, xe)
    z0, z1 = zs, zn
    nx = int((x1 - x0) / DEM_STEP) + 1
    nz = int((z1 - z0) / DEM_STEP) + 1
    vals = []
    sea_fill = -H0 - 4.0
    for j in range(nz):
        z = z0 + j * DEM_STEP
        lat = LAT0 + z / M_LAT
        for i in range(nx):
            x = x0 + i * DEM_STEP
            lon = LON0 - x / M_LON
            h = dem_at(tiles, lat, lon)
            y = sea_fill if h is None else h - H0
            vals.append(max(-32768, min(32767, int(round(y * 10)))))
    dem_b64 = base64.b64encode(struct.pack(f'<{len(vals)}h', *vals)).decode()

    # ---------- 道 ----------
    roads, rails, ropeway, coast, buildings, pois = [], [], [], [], [], []
    for e in osm:
        t = e.get('tags', {})
        g = e.get('geometry')
        if e['type'] == 'way' and g:
            pts = [to_local(p['lat'], p['lon']) for p in g]
            flat = [r1(v) for xy in pts for v in xy]
            hw = t.get('highway')
            if hw and hw not in SKIP_HIGHWAY and t.get('area') != 'yes':
                w = ROAD_WIDTH.get(hw, 3)
                if 'width' in t:
                    try:
                        w = max(1.2, min(14, float(t['width'].split()[0])))
                    except ValueError:
                        pass
                road = {'k': hw, 'w': w, 'p': flat}
                if 'name' in t:
                    road['n'] = t['name']
                if t.get('covered') == 'yes':
                    road['c'] = 1
                if t.get('bridge') == 'yes' or t.get('tunnel') == 'yes' or t.get('layer', '0') not in ('0', '-0'):
                    road['l'] = t.get('layer', '1')
                roads.append(road)
            elif t.get('railway') == 'rail':
                rails.append({'p': flat, 'n': t.get('name', ''), 't': 1 if t.get('tunnel') == 'yes' else 0})
            elif 'aerialway' in t:
                ropeway.append(flat)
            elif t.get('natural') == 'coastline':
                coast.append(flat)
            elif 'building' in t and len(pts) >= 4:
                h = None
                try:
                    if 'height' in t:
                        h = float(t['height'].replace('m', ''))
                    elif 'building:levels' in t:
                        h = float(t['building:levels']) * 3.1 + 0.6
                except ValueError:
                    h = None
                b = {'p': flat[:-2] if pts[0] == pts[-1] else flat}
                if h:
                    b['h'] = r1(h)
                if t['building'] not in ('yes',):
                    b['k'] = t['building']
                if 'name' in t:
                    b['n'] = t['name']
                buildings.append(b)
        elif e['type'] == 'relation' and 'building' in t:
            for m in e.get('members', []):
                if m.get('role') == 'outer' and m.get('geometry'):
                    pts = [to_local(p['lat'], p['lon']) for p in m['geometry']]
                    b = {'p': [r1(v) for xy in pts[:-1] for v in xy]}
                    if 'name' in t:
                        b['n'] = t['name']
                    buildings.append(b)
        # 名所
        name = t.get('name')
        kind = t.get('amenity') or t.get('tourism') or t.get('historic') or t.get('building')
        if name and kind in ('place_of_worship', 'ferry_terminal', 'museum', 'viewpoint', 'castle', 'attraction', 'train_station', 'transportation', 'pagoda'):
            if 'lat' in e:
                lat, lon = e['lat'], e['lon']
            elif g:
                lat = sum(p['lat'] for p in g) / len(g)
                lon = sum(p['lon'] for p in g) / len(g)
            elif 'bounds' in e:
                b = e['bounds']
                lat, lon = (b['minlat'] + b['maxlat']) / 2, (b['minlon'] + b['maxlon']) / 2
            else:
                continue
            x, z = to_local(lat, lon)
            pois.append({'n': name, 'k': kind, 'x': r1(x), 'z': r1(z)})

    data = {
        'meta': {
            'lat0': LAT0, 'lon0': LON0, 'h0': round(H0, 2), 'seaY': round(-H0, 2),
            'attribution': '地図データ © OpenStreetMap contributors (ODbL) ／ 標高 国土地理院 DEM5A',
        },
        'dem': {'x0': r1(x0), 'z0': r1(z0), 'step': DEM_STEP, 'nx': nx, 'nz': nz, 'b64': dem_b64},
        'roads': roads, 'rails': rails, 'ropeway': ropeway, 'coast': coast,
        'buildings': buildings, 'pois': pois,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        f.write('// 自動生成：tools/build_town_data.py（手で編集しない）\n')
        f.write('// 地図データ © OpenStreetMap contributors (ODbL)／標高 国土地理院 基盤地図情報 DEM5A\n')
        f.write('export default ')
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print(f'roads {len(roads)}, rails {len(rails)}, ropeway {len(ropeway)}, coast {len(coast)}, '
          f'buildings {len(buildings)}, pois {len(pois)}, dem {nx}x{nz}')
    print(f'→ {os.path.relpath(OUT)} ({os.path.getsize(OUT) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
