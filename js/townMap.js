// 尾道の町の「地図」：実データ（OpenStreetMap＋国土地理院DEM）から、地形の高さ・歩ける道・地名を作る。
//
// 座標系：原点＝空き家（東土堂、中村憲吉旧居のあたり）、+x＝西、-x＝東、+z＝北、-z＝南。
// y は標高から空き家の床の標高（約59.6m）を引いたもの。海面は SEA_Y。
// データの作り方は tools/fetch_data.py と tools/build_town_data.py を参照。
import DATA from './data/onomichi.js';

export { DATA };
export const SEA_Y = DATA.meta.seaY;
// 出典（OpenStreetMap は ODbL、標高は国土地理院の標高タイルを加工して使用）
export const ATTRIBUTION = '地図データ © OpenStreetMap contributors (ODbL) ／ 標高：国土地理院 標高タイル（DEM5A）を加工して作成';
const ARCADE_NAMES = ['駅前商店街', '一番街', '中商店街', '本町センター街'];

// ---------- 地形 ----------
const DEM = DATA.dem;
const QUAY = new Float32Array(DEM.nx * DEM.nz);
const HEIGHTS = (() => {
  const bin = atob(DEM.b64);
  const buf = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dv = new DataView(buf);
  const out = new Float32Array(DEM.nx * DEM.nz);
  for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(i * 2, true) / 10;
  return smoothLowland(out);
})();

/**
 * 海沿い・町なかの平地の凸凹をならす。標高データ（5m）は細かいでこぼこを拾うので、
 * 海面から低いところ（〜9m）だけ、まわり約15mの陸地の平均に寄せる。山あいはそのまま。
 */
function smoothLowland(h) {
  const nx = DEM.nx, nz = DEM.nz, R = 3;
  const sea = DATA.meta.seaY;
  const land = (v) => v > sea + 0.3;
  let cur = h;
  for (let pass = 0; pass < 2; pass++) {
    // 陸の低いところだけを重み 1 にした、ならし（たて・よこに分けた箱型の平均）
    const w = new Float32Array(nx * nz), vw = new Float32Array(nx * nz);
    for (let k = 0; k < cur.length; k++) {
      const v = cur[k];
      if (land(v) && v - sea < 14) { w[k] = 1; vw[k] = v; }
    }
    const blur = (src) => {
      const tmp = new Float32Array(nx * nz), dst = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) {
        let acc = 0;
        for (let i = -R; i <= R; i++) if (i >= 0 && i < nx) acc += src[j * nx + i];
        for (let i = 0; i < nx; i++) {
          tmp[j * nx + i] = acc;
          const out = i - R, inn = i + R + 1;
          if (out >= 0) acc -= src[j * nx + out];
          if (inn < nx) acc += src[j * nx + inn];
        }
      }
      for (let i = 0; i < nx; i++) {
        let acc = 0;
        for (let j = -R; j <= R; j++) if (j >= 0 && j < nz) acc += tmp[j * nx + i];
        for (let j = 0; j < nz; j++) {
          dst[j * nx + i] = acc;
          const out = j - R, inn = j + R + 1;
          if (out >= 0) acc -= tmp[out * nx + i];
          if (inn < nz) acc += tmp[inn * nx + i];
        }
      }
      return dst;
    };
    const sw = blur(w), svw = blur(vw);
    const next = new Float32Array(cur);
    for (let k = 0; k < cur.length; k++) {
      const v = cur[k];
      if (!land(v) || sw[k] < 1) continue;
      const above = v - sea;
      const t = Math.min(1, Math.max(0, (above - 5) / 4));
      const keep = t * t * (3 - 2 * t);           // 5m までは完全にならし、9m で元の高さへ
      next[k] = v * keep + (svw[k] / sw[k]) * (1 - keep);
    }
    cur = next;
  }
  // 岸壁の高さ：岸の近くの、陸の低いところの平均（海のマスにも、となりの陸の高さを持たせる）
  const w = new Float32Array(nx * nz), vw = new Float32Array(nx * nz);
  for (let k = 0; k < cur.length; k++) if (land(cur[k]) && cur[k] - sea < 9) { w[k] = 1; vw[k] = cur[k]; }
  const r = 4;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let a = 0, b = 0;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const k = jj * nx + ii;
      a += w[k]; b += vw[k];
    }
    QUAY[j * nx + i] = a >= 2 ? b / a : NaN;
  }
  return cur;
}
export const BOUNDS = { x0: DEM.x0, x1: DEM.x0 + (DEM.nx - 1) * DEM.step, z0: DEM.z0, z1: DEM.z0 + (DEM.nz - 1) * DEM.step };

export function demAt(x, z) {
  const fx = (x - DEM.x0) / DEM.step, fz = (z - DEM.z0) / DEM.step;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= DEM.nx - 1 || j >= DEM.nz - 1) return SEA_Y - 4;
  const tx = fx - i, tz = fz - j;
  const n = DEM.nx;
  const a = HEIGHTS[j * n + i], b = HEIGHTS[j * n + i + 1], c = HEIGHTS[(j + 1) * n + i], d = HEIGHTS[(j + 1) * n + i + 1];
  // 地面メッシュと同じ三角形分割（a-c-b と b-c-d）で補間する。道や石段が地面に埋もれないように
  if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
  return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}

/** 地形の高さ。空き家のまわりだけ、家が建つように平らにならしてある */
export function terrainY(x, z) {
  const y = demAt(x, z);
  const d = Math.hypot(x, z - 0.5);
  if (d > 9) return y;
  const flat = -0.4;
  if (d < 4.5) return flat;
  const t = (d - 4.5) / 4.5;
  return flat + (y - flat) * t * t * (3 - 2 * t);
}

/**
 * 岸壁ぎわの高さ。標高のマス目が陸と海にまたがるところでは、補間すると地面が海へ向かって
 * 下がってしまうので、まわりの陸の高さ（岸壁の上）を返す。それ以外は -Infinity
 */
export function quayY(x, z) {
  const fx = (x - DEM.x0) / DEM.step, fz = (z - DEM.z0) / DEM.step;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= DEM.nx - 1 || j >= DEM.nz - 1) return -Infinity;
  const n = DEM.nx;
  const ks = [j * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1];
  if (!ks.some((k) => HEIGHTS[k] <= SEA_Y + 0.3)) return -Infinity;
  let a = 0, c = 0;
  for (const k of ks) if (!Number.isNaN(QUAY[k])) { a += QUAY[k]; c++; }
  return c ? a / c : -Infinity;
}

/** 歩く高さ・道の高さ：岸壁ぎわでは岸壁の上の高さ、そのほかも海面より少し上を下限にする */
export function groundY(x, z) {
  return Math.max(terrainY(x, z), quayY(x, z), SEA_Y + 1.1);
}

// ---------- 道 ----------
const SURFACE = { steps: 'stone', footway: 'stone', path: 'stone', pedestrian: 'tile', track: 'stone' };
const KIND_LABEL = { steps: '石段', footway: '小径', path: '小径', pedestrian: '通り', residential: '路地', service: '路地', living_street: '路地' };

// 戸口（家の東側）から、いちばん近い実際の小径の点へ石段でつなぐ
export const HOUSE_DOOR = { x: -4.4, z: 1.5 };
const DOOR_PATH = (() => {
  let best = null;
  for (const r of DATA.roads) {
    if (!['footway', 'steps', 'path', 'residential', 'service', 'pedestrian', 'living_street'].includes(r.k) || r.l) continue;
    for (let k = 0; k < r.p.length; k += 2) {
      const d = Math.hypot(r.p[k] - HOUSE_DOOR.x, r.p[k + 1] - HOUSE_DOOR.z);
      if (!best || d < best.d) best = { d, x: r.p[k], z: r.p[k + 1] };
    }
  }
  const sx = -4.6, sz = 1.4;
  // 家の東へいったん出てから、小径へ
  const mx = Math.min(sx - 3, (sx + best.x) / 2), mz = (sz + best.z) / 2;
  return { k: 'steps', w: 1.8, p: [sx, sz, sx - 2.5, sz, mx, mz, best.x, best.z], n: '空き家への石段' };
})();

const ALL_ROADS_RAW = [...DATA.roads, DOOR_PATH].map((r, id) => {
  const pts = [];
  for (let k = 0; k < r.p.length; k += 2) pts.push([r.p[k], r.p[k + 1]]);
  return {
    id, name: r.n || '', label: r.n || KIND_LABEL[r.k] || '道', kind: r.k, width: ARCADE_NAMES.includes(r.n) ? Math.max(r.w, 5) : r.w, pts,  // 商店街は店が両側に並ぶ幅に
    // 商店街のアーケードは名前のある4つの通りだけ。ほかの「屋根つき」（桟橋の通路、駅の階段など）は roofed
    surface: SURFACE[r.k] || 'asphalt', covered: ARCADE_NAMES.includes(r.n), roofed: !!r.c,
    layered: !!r.l,
  };
});

// 駅前の大きな歩道橋（2階の高さのデッキ）：地図で「上の階」にある長い歩行者道。地面の道からは外し、別に作る
const polyLen = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
export const DECKS = ALL_ROADS_RAW.filter((r) => r.layered && ['pedestrian', 'footway'].includes(r.kind) && polyLen(r.pts) > 60);
const nearDeck = (r) => r.layered && DECKS.some((d) => r.pts.every(([x, z]) => d.pts.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < 14)));
const ALL_ROADS = ALL_ROADS_RAW.filter((r) => !DECKS.includes(r) && !nearDeck(r));

// 空き家から歩いて行ける道だけを残す（同じ座標の点を共有する道どうしはつながっている）
function connectedFrom(roads, start) {
  const key = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const byPoint = new Map();
  roads.forEach((r) => r.pts.forEach((p) => {
    const k = key(p);
    if (!byPoint.has(k)) byPoint.set(k, []);
    byPoint.get(k).push(r);
  }));
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const r = stack.pop();
    for (const p of r.pts) {
      for (const o of byPoint.get(key(p))) {
        if (!seen.has(o)) { seen.add(o); stack.push(o); }
      }
    }
  }
  return seen;
}
const reachable = connectedFrom(ALL_ROADS, ALL_ROADS[ALL_ROADS.length - 1]);
export const ROADS = ALL_ROADS.filter((r) => reachable.has(r));          // 歩ける道
export const OTHER_ROADS = ALL_ROADS.filter((r) => !reachable.has(r));   // 見えるだけの道（向島側など）
export const ARCADE_ROADS = ROADS.filter((r) => r.covered);

// ---------- 当たり判定（空間グリッドで速く引く） ----------
const CELL = 16;
const grid = new Map();
const SEGMENTS = [];
for (const road of ROADS) addToGrid(road);

function addToGrid(road) {
  for (let i = 0; i < road.pts.length - 1; i++) {
    const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const s = { road, ax, az, dx, dz, len, half: road.width / 2 };
    SEGMENTS.push(s);
    const m = s.half + 6;
    for (let cx = Math.floor((Math.min(ax, bx) - m) / CELL); cx <= Math.floor((Math.max(ax, bx) + m) / CELL); cx++) {
      for (let cz = Math.floor((Math.min(az, bz) - m) / CELL); cz <= Math.floor((Math.max(az, bz) + m) / CELL); cz++) {
        const k = cx * 100003 + cz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  }
}

function project(s, x, z) {
  let t = ((x - s.ax) * s.dx + (z - s.az) * s.dz) / (s.len * s.len);
  t = Math.max(0, Math.min(1, t));
  const px = s.ax + s.dx * t, pz = s.az + s.dz * t;
  return { px, pz, d: Math.hypot(x - px, z - pz), t };
}

function candidates(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let r = 0; r <= 6; r++) {
    const out = [];
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cz - r; j <= cz + r; j++) {
        if (r > 0 && Math.abs(i - cx) < r && Math.abs(j - cz) < r) continue;
        const list = grid.get(i * 100003 + j);
        if (list) out.push(...list);
      }
    }
    if (out.length) return r === 0 ? out.concat(candidatesRing(cx, cz)) : out;
  }
  return SEGMENTS;
}
function candidatesRing(cx, cz) {
  const out = [];
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
    if (i === cx && j === cz) continue;
    const list = grid.get(i * 100003 + j);
    if (list) out.push(...list);
  }
  return out;
}

/** 点から最も近い（歩ける）道の線分 */
export function nearestRoad(x, z) {
  let best = null;
  for (const s of candidates(x, z)) {
    const p = project(s, x, z);
    const inside = p.d - s.half;
    if (!best || inside < best.inside) best = { seg: s, road: s.road, px: p.px, pz: p.pz, d: p.d, inside, t: p.t };
  }
  return best;
}

/** 歩ける範囲（道の内側）に押し戻す */
export function clampToRoads(x, z) {
  const n = nearestRoad(x, z);
  if (n.inside <= 0) return { x, z, road: n.road };
  const k = n.seg.half / (n.d || 1);
  return { x: n.px + (x - n.px) * k, z: n.pz + (z - n.pz) * k, road: n.road };
}

/** 道の上（内側＋余白）かどうか。建物を置かない場所の判定に使う */
export function nearAnyRoad(x, z, margin = 0) {
  for (const s of candidates(x, z)) {
    if (project(s, x, z).d < s.half + margin) return s.road;
  }
  return null;
}

// ---------- 商店街の路地 ----------
// 本通りのアーケードから、海側にも坂側にも抜けられる細い路地を、およそ30mごとに通す。
// 実際の本通りも、店と店のあいだに細い小路が何本も海側・山側へのびている。
export const ALLEYS = [];
(function makeAlleys() {
  const arcades = ROADS.filter((r) => r.covered && r.name);
  let n = 0;
  for (const road of arcades) {
    const hw = road.width / 2;
    for (const p of samplePath(road.pts, 30).slice(1, -1)) {
      for (const side of [-1, 1]) {
        const nx = -Math.sin(p.angle) * side, nz = Math.cos(p.angle) * side;
        // すぐ近くに横道があれば、それで抜けられるので足さない
        let exists = false;
        for (const t of [-10, -5, 0, 5, 10]) {
          const qx = p.x + Math.cos(p.angle) * t + nx * (hw + 4), qz = p.z + Math.sin(p.angle) * t + nz * (hw + 4);
          const r = nearAnyRoad(qx, qz, 0.5);
          if (r && !r.covered) { exists = true; break; }
        }
        if (exists) continue;
        // 横へまっすぐ進んで、最初に出会う道まで
        let hit = null;
        for (let d = hw + 2; d < 70; d += 0.5) {
          const qx = p.x + nx * d, qz = p.z + nz * d;
          if (demAt(qx, qz) < SEA_Y + 0.4) break;          // 海に出てしまう
          const r = nearAnyRoad(qx, qz, 0);
          if (r && !r.covered) { hit = [qx + nx * 0.5, qz + nz * 0.5]; break; }
        }
        if (!hit) continue;
        const alley = {
          id: 100000 + n++, name: '小路', label: '小路', kind: 'alley', width: 1.7, surface: 'stone',
          pts: [[p.x, p.z], hit], covered: false, layered: false, alley: true,
        };
        ALLEYS.push(alley);
        ROADS.push(alley);
        addToGrid(alley);
      }
    }
  }
})();

/** 道の線に沿って一定間隔で点を取る */
export function samplePath(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, angle: Math.atan2(bz - az, bx - ax), len: len / n });
    }
  }
  const [lx, lz] = pts[pts.length - 1];
  const prev = out[out.length - 1];
  out.push({ x: lx, z: lz, angle: prev ? prev.angle : 0, len: step });
  return out;
}

export function roadLength(pts) {
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return L;
}

/** 道の途中（0〜1）の点と向き */
export function pointAlong(pts, f) {
  const total = roadLength(pts);
  let target = total * f;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (target <= len || i === pts.length - 2) {
      const t = len > 0 ? Math.min(1, target / len) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, angle: Math.atan2(bz - az, bx - ax) };
    }
    target -= len;
  }
  return { x: pts[0][0], z: pts[0][1], angle: 0 };
}

// ---------- 海岸線と水道 ----------
export const COAST = DATA.coast.map((p) => { const a = []; for (let k = 0; k < p.length; k += 2) a.push([p[k], p[k + 1]]); return a; });
const COAST_CELL = 25;
const coastGrid = new Map();
COAST.forEach((line) => samplePath(line, 5).forEach((s) => {
  const k = Math.floor(s.x / COAST_CELL) * 100003 + Math.floor(s.z / COAST_CELL);
  if (!coastGrid.has(k)) coastGrid.set(k, []);
  coastGrid.get(k).push(s);
}));
/** 海岸線までの距離（遠ければ 999） */
export function distToCoast(x, z) {
  const cx = Math.floor(x / COAST_CELL), cz = Math.floor(z / COAST_CELL);
  let best = 999;
  for (let i = cx - 3; i <= cx + 3; i++) for (let j = cz - 3; j <= cz + 3; j++) {
    const list = coastGrid.get(i * 100003 + j);
    if (list) for (const s of list) best = Math.min(best, Math.hypot(x - s.x, z - s.z));
  }
  return best;
}

/**
 * 海岸線のどちら側か（細い突堤・桟橋は標高のマス目より細く、マス目では海になってしまうので、線で見る）。
 * 地図の海岸線は、進む向きの左側が陸。陸側なら正の、海側なら負の、岸からの距離を返す。近くに海岸線がなければ null
 */
export function landByCoast(x, z) {
  const cx = Math.floor(x / COAST_CELL), cz = Math.floor(z / COAST_CELL);
  let best = null, bd = 6;
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
    const list = coastGrid.get(i * 100003 + j);
    if (list) for (const p of list) { const d = Math.hypot(x - p.x, z - p.z); if (d < bd) { bd = d; best = p; } }
  }
  if (!best) return null;
  const cross = Math.cos(best.angle) * (z - best.z) - Math.sin(best.angle) * (x - best.x);
  return cross * LAND_SIDE;   // 陸側なら正（岸からの距離）、海側なら負
}
const LAND_SIDE = -1;

/** 尾道水道の中心線（東西方向に、水面のいちばん広い区間の真ん中をたどる） */
export const STRAIT = (() => {
  const out = [];
  let prev = null;
  for (let x = BOUNDS.x0 + 20; x <= BOUNDS.x1 - 20; x += 40) {
    const runs = [];
    let start = null;
    for (let z = BOUNDS.z0; z <= BOUNDS.z1; z += 5) {
      const water = demAt(x, z) < SEA_Y + 0.3;
      if (water && start === null) start = z;
      if ((!water || z + 5 > BOUNDS.z1) && start !== null) { runs.push([start, z]); start = null; }
    }
    const wide = runs.filter(([a, b]) => b - a > 80);
    if (!wide.length) continue;
    // 前の点に近い水面を選ぶ（はじめは原点の南）
    const ref = prev ? prev[1] : -500;
    wide.sort((a, b) => Math.abs((a[0] + a[1]) / 2 - ref) - Math.abs((b[0] + b[1]) / 2 - ref));
    const [a, b] = wide[0];
    // 南端が範囲外で切れているときは、北岸から 110m 沖を中心とみなす
    const center = a <= BOUNDS.z0 + 5 ? b - 110 : (a + b) / 2;
    prev = [x, center];
    out.push(prev);
  }
  return out;
})();
/** 水道の中心線上の点（x から） */
export function straitAt(x) {
  const s = STRAIT;
  if (x <= s[0][0]) return { x, z: s[0][1], angle: Math.atan2(s[1][1] - s[0][1], s[1][0] - s[0][0]) };
  for (let i = 0; i < s.length - 1; i++) {
    if (x <= s[i + 1][0]) {
      const t = (x - s[i][0]) / (s[i + 1][0] - s[i][0]);
      return { x, z: s[i][1] + (s[i + 1][1] - s[i][1]) * t, angle: Math.atan2(s[i + 1][1] - s[i][1], s[i + 1][0] - s[i][0]) };
    }
  }
  const n = s.length - 1;
  return { x, z: s[n][1], angle: Math.atan2(s[n][1] - s[n - 1][1], s[n][0] - s[n - 1][0]) };
}
/** 尾道側（北岸）かどうか */
export const onOnomichiSide = (x, z) => z > straitAt(x).z;

// ---------- 名所 ----------
export const POIS = DATA.pois;
const poi = (name) => POIS.find((p) => p.n === name);

// 渡船：実際の3航路（尾道渡船・福本渡船・向島運航）
const FERRY_PAIRS = [
  ['土堂桟橋(尾道渡船)', '兼吉桟橋(尾道渡船)', '尾道渡船'],
  ['土堂桟橋(福本渡船)', '小歌島桟橋(福本渡船)', '福本渡船'],
  ['駅前桟橋(向島運航)', '富浜桟橋(向島運航)', '駅前渡船'],
];
/** 桟橋の位置を、岸から少し沖へ出した船着き場の点にする */
function berth(p) {
  const s = straitAt(p.x);
  const dir = p.z > s.z ? -1 : 1;
  return { x: p.x, z: p.z + dir * 6, name: p.n };
}
export const FERRY_ROUTES = FERRY_PAIRS.map(([a, b, name]) => ({ a: berth(poi(a)), b: berth(poi(b)), name })).filter((r) => r.a && r.b);
export const FERRY_PIERS = FERRY_ROUTES.map((r) => r.a);

// 踏切：歩ける道と線路が交わるところ
export const RAILS = DATA.rails.filter((r) => !r.t).map((r) => { const a = []; for (let k = 0; k < r.p.length; k += 2) a.push([r.p[k], r.p[k + 1]]); return { pts: a, name: r.n }; });
function segIntersect(a, b, c, d) {
  const r1 = [b[0] - a[0], b[1] - a[1]], r2 = [d[0] - c[0], d[1] - c[1]];
  const den = r1[0] * r2[1] - r1[1] * r2[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * r2[1] - (c[1] - a[1]) * r2[0]) / den;
  const u = ((c[0] - a[0]) * r1[1] - (c[1] - a[1]) * r1[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + r1[0] * t, a[1] + r1[1] * t] : null;
}
export const CROSSINGS = (() => {
  const out = [];
  for (const road of ROADS) {
    if (road.layered) continue;
    for (let i = 0; i < road.pts.length - 1; i++) {
      for (const rail of RAILS) {
        for (let k = 0; k < rail.pts.length - 1; k++) {
          const p = segIntersect(road.pts[i], road.pts[i + 1], rail.pts[k], rail.pts[k + 1]);
          if (!p) continue;
          if (out.some((c) => Math.hypot(c.x - p[0], c.z - p[1]) < 14)) continue;
          const [ax, az] = rail.pts[k], [bx, bz] = rail.pts[k + 1];
          out.push({ x: p[0], z: p[1], railAngle: Math.atan2(bz - az, bx - ax), width: road.width, road });
        }
      }
    }
  }
  return out;
})();

/** 電車が走る線路（つながった区間を長くつないだもの、上り線と下り線） */
export const TRAIN_TRACKS = (() => {
  const ways = RAILS.filter((r) => r.name === 'JR山陽本線').map((r) => r.pts);
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1;
  const chains = [];
  const used = new Set();
  for (let s = 0; s < ways.length; s++) {
    if (used.has(s)) continue;
    used.add(s);
    let chain = ways[s].slice();
    let grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < ways.length; i++) {
        if (used.has(i)) continue;
        const w = ways[i];
        if (near(chain[chain.length - 1], w[0])) chain = chain.concat(w.slice(1));
        else if (near(chain[chain.length - 1], w[w.length - 1])) chain = chain.concat(w.slice(0, -1).reverse());
        else if (near(chain[0], w[w.length - 1])) chain = w.slice(0, -1).concat(chain);
        else if (near(chain[0], w[0])) chain = w.slice(1).reverse().concat(chain);
        else continue;
        used.add(i);
        grown = true;
      }
    }
    chains.push(chain);
  }
  return chains.sort((a, b) => roadLength(b) - roadLength(a)).slice(0, 2);
})();

// ロープウェイ（低いほうが山麓駅）
export const ROPEWAY = (() => {
  const p = DATA.ropeway[0];
  const a = { x: p[0], z: p[1] }, b = { x: p[p.length - 2], z: p[p.length - 1] };
  return terrainY(a.x, a.z) < terrainY(b.x, b.z) ? { base: a, top: b } : { base: b, top: a };
})();

// ---------- 建物の中かどうか（グリッドで引く） ----------
const BCELL = 40;
const bgrid = new Map();
// 屋根だけの建物（駅の西の屋根つき歩道、桟橋の上屋など）：壁はなく、下を歩ける
export const ROOFS = DATA.buildings.filter((b) => b.k === 'roof').map((b) => { const a = []; for (let k = 0; k < b.p.length; k += 2) a.push([b.p[k], b.p[k + 1]]); return a; });
const BUILDINGS = DATA.buildings.filter((b) => b.k !== 'roof').map((b) => { const a = []; for (let k = 0; k < b.p.length; k += 2) a.push([b.p[k], b.p[k + 1]]); return a; });
BUILDINGS.forEach((poly) => {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  for (let i = Math.floor(Math.min(...xs) / BCELL); i <= Math.floor(Math.max(...xs) / BCELL); i++) {
    for (let j = Math.floor(Math.min(...zs) / BCELL); j <= Math.floor(Math.max(...zs) / BCELL); j++) {
      const k = i * 100003 + j;
      if (!bgrid.has(k)) bgrid.set(k, []);
      bgrid.get(k).push(poly);
    }
  }
});
export function inBuilding(x, z) {
  const list = bgrid.get(Math.floor(x / BCELL) * 100003 + Math.floor(z / BCELL));
  if (!list) return false;
  return list.some((poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  });
}

// ---------- 途切れた道をつなぐ ----------
// 地図データでは、行き止まりの道の端が、すぐ先の道（線路の向こう、石段の上下など）と
// 数メートル離れたままのところがある。15m 以内なら、短い小径・石段でつないで歩けるようにする。
export const CONNECTORS = [];
(function connectDangling() {
  const key = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const count = new Map();
  [...ROADS, ...OTHER_ROADS].forEach((r) => r.pts.forEach((p) => count.set(key(p), (count.get(key(p)) || 0) + 1)));
  const base = ROADS.filter((r) => !r.alley);
  let n = 0;
  for (const r of base) {
    for (const end of [0, r.pts.length - 1]) {
      const p = r.pts[end];
      if (count.get(key(p)) > 1) continue;
      // いちばん近い、ほかの道の線分（自分の道は除く）
      let best = null;
      for (const s of candidates(p[0], p[1])) {
        if (s.road === r) continue;
        const q = project(s, p[0], p[1]);
        const gap = q.d - s.half - r.width / 2;
        if (!best || gap < best.gap) best = { gap, q, s };
      }
      if (!best || best.gap <= 0.05 || best.gap > 15) continue;
      // 道の端から、相手の道の中ほどまで
      const { px, pz, d } = best.q;
      const ux = (px - p[0]) / d, uz = (pz - p[1]) / d;
      const tx = px - ux * Math.min(best.s.half * 0.5, d * 0.2), tz = pz - uz * Math.min(best.s.half * 0.5, d * 0.2);
      // 海の上や建物の中を通るなら、つながない
      let ok = true;
      for (let t = 0.1; t < 1; t += 0.1) {
        const x = p[0] + (tx - p[0]) * t, z = p[1] + (tz - p[1]) * t;
        if (demAt(x, z) < SEA_Y + 0.4 || inBuilding(x, z)) { ok = false; break; }
      }
      if (!ok) continue;
      const len = Math.hypot(tx - p[0], tz - p[1]);
      const grade = Math.abs(terrainY(tx, tz) - terrainY(p[0], p[1])) / Math.max(1, len);
      const kind = grade > 0.25 ? 'steps' : 'footway';
      const road = {
        id: 200000 + n++, name: '', label: KIND_LABEL[kind], kind, width: Math.min(1.8, Math.max(1.4, r.width)), surface: 'stone',
        pts: [[p[0], p[1]], [tx, tz]], covered: false, layered: false, connector: true,
      };
      CONNECTORS.push(road);
      ROADS.push(road);
      addToGrid(road);
      count.set(key(p), 2);
    }
  }
})();

// ---------- 足もとの高さ（石段の踏み面を含む） ----------
// town.js が石段の踏み面を置いたら登録する。猫・自販機・灯籠・歩く人の目線は、この高さに立つ。
const TREAD_CELL = 4;
const treads = new Map();
/** 踏み面：中心 (x, z)、長さ len（道の向き a）、幅 wid、上面の高さ top */
export function addTread(x, z, len, wid, a, top) {
  const t = { x, z, hl: len / 2, hw: wid / 2, c: Math.cos(a), s: Math.sin(a), top };
  const R = Math.hypot(t.hl, t.hw);
  for (let i = Math.floor((x - R) / TREAD_CELL); i <= Math.floor((x + R) / TREAD_CELL); i++) {
    for (let j = Math.floor((z - R) / TREAD_CELL); j <= Math.floor((z + R) / TREAD_CELL); j++) {
      const k = i * 100003 + j;
      if (!treads.has(k)) treads.set(k, []);
      treads.get(k).push(t);
    }
  }
}
/** その場所の、ものが立つ高さ（地面・道の舗装・石段の踏み面のいちばん上） */
export function surfaceY(x, z) {
  let y = groundY(x, z) + (nearAnyRoad(x, z) ? 0.09 : 0);
  const list = treads.get(Math.floor(x / TREAD_CELL) * 100003 + Math.floor(z / TREAD_CELL));
  if (list) {
    for (const t of list) {
      const dx = x - t.x, dz = z - t.z;
      if (Math.abs(dx * t.c + dz * t.s) <= t.hl && Math.abs(-dx * t.s + dz * t.c) <= t.hw) y = Math.max(y, t.top);
    }
  }
  return y;
}

// ---------- 2階の高さの通路（駅前の歩道橋・駅のテラス） ----------
// 地面とは別の階。帯（中心・長さ・幅・向き）ごとに高さを持ち、階段の帯は端から端へ高さが変わる。
const UPPER_CELL = 8;
const uppers = new Map();
/** 上の階の帯：中心 (x, z)、長さ len（向き a）、幅 wid。高さは -len/2 の端で y0、+len/2 の端で y1 */
export function addUpper(x, z, len, wid, a, y0, y1 = y0) {
  const t = { x, z, hl: len / 2, hw: wid / 2, c: Math.cos(a), s: Math.sin(a), y0, y1 };
  const R = Math.hypot(t.hl, t.hw);
  for (let i = Math.floor((x - R) / UPPER_CELL); i <= Math.floor((x + R) / UPPER_CELL); i++) {
    for (let j = Math.floor((z - R) / UPPER_CELL); j <= Math.floor((z + R) / UPPER_CELL); j++) {
      const k = i * 100003 + j;
      if (!uppers.has(k)) uppers.set(k, []);
      uppers.get(k).push(t);
    }
  }
}
/** その場所の上の階の高さ（near の高さにいちばん近いもの）。なければ null */
export function upperAt(x, z, near = Infinity) {
  const list = uppers.get(Math.floor(x / UPPER_CELL) * 100003 + Math.floor(z / UPPER_CELL));
  if (!list) return null;
  let best = null;
  for (const t of list) {
    const dx = x - t.x, dz = z - t.z;
    const u = dx * t.c + dz * t.s;
    if (Math.abs(u) > t.hl || Math.abs(-dx * t.s + dz * t.c) > t.hw) continue;
    const y = t.y0 + (t.y1 - t.y0) * (u + t.hl) / (2 * t.hl);
    const d = Math.abs(y - near);
    if (!best || d < best.d) best = { y, d, stair: t.y0 !== t.y1 };
  }
  return best;
}

// ---------- 道の外でも歩けるところ ----------
// 海沿い・町なかの平地は、道の帯の外（広場、駅前、歩道、岸壁ぞい）も歩ける。
// ただし建物の中、海、アーケードの店の裏へは入れない。
const SOLID_CELL = 8;
const solids = new Map();
/** town.js が置いた建物（地図データにない家など）を、歩けない場所として登録する */
export function addSolid(x, z, w, d, rot = 0) {
  const s = { x, z, hw: w / 2 + 0.3, hd: d / 2 + 0.3, c: Math.cos(rot), sn: Math.sin(rot) };
  const R = Math.hypot(s.hw, s.hd);
  for (let i = Math.floor((x - R) / SOLID_CELL); i <= Math.floor((x + R) / SOLID_CELL); i++) {
    for (let j = Math.floor((z - R) / SOLID_CELL); j <= Math.floor((z + R) / SOLID_CELL); j++) {
      const k = i * 100003 + j;
      if (!solids.has(k)) solids.set(k, []);
      solids.get(k).push(s);
    }
  }
}
export function inSolid(x, z) {
  const list = solids.get(Math.floor(x / SOLID_CELL) * 100003 + Math.floor(z / SOLID_CELL));
  if (!list) return false;
  return list.some((s) => {
    const dx = x - s.x, dz = z - s.z;
    const u = dx * s.c - dz * s.sn, v = dx * s.sn + dz * s.c;
    return Math.abs(u) < s.hw && Math.abs(v) < s.hd;
  });
}
const FREE_HEIGHT = 7;  // 海面からこの高さまでの平地
const FREE_REACH = 14;  // 道からこの距離まで
/** その場所に立てるか（道の上、または道の近くの平地で、建物や海でないところ） */
export function walkable(x, z) {
  const n = nearestRoad(x, z);
  if (n.inside <= 0) return true;
  if (n.road.covered) return false;
  // 道から離れていても、岸壁ぞい（突堤・桟橋の先まで）は歩ける
  if (n.inside > FREE_REACH && distToCoast(x, z) > 12) return false;
  if (terrainY(x, z) - SEA_Y > FREE_HEIGHT) return false;
  // 海の上は歩けない。ただし細い突堤・桟橋（海岸線の陸側）は先まで歩ける
  if (demAt(x, z) < SEA_Y + 0.8 && !(landByCoast(x, z) > 0.35)) return false;
  return !inBuilding(x, z) && !inSolid(x, z);
}

/** まわりの地形を見て、いちばん海らしい方角を返す（見つからなければ null） */
function seaDirection(x, z) {
  let best = null;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
    const dx = Math.cos(a), dz = Math.sin(a);
    const h = (demAt(x + dx * 10, z + dz * 10) + demAt(x + dx * 20, z + dz * 20)) / 2;
    if (!best || h < best.h) best = { a, dx, dz, h };
  }
  return best && best.h < SEA_Y ? best : null;
}

// ---------- 通りに面した小さなお店（アーケードの外） ----------
// 道の端の外側に、間口 4.6m・奥行き 4m ほどの店を建てる場所を探す。
// stone: true なら石段・小径ぞい（坂の途中）、false なら舗装された道ぞい。
function shopSpot(cx, cz, { stone, maxR = 50 }) {
  for (let r = 0; r <= maxR; r += 2) {
    for (let k = 0; k < (r ? 12 : 1); k++) {
      const a = (k / 12) * Math.PI * 2;
      const n = nearestRoad(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      if (!n || n.road.covered || n.road.alley || n.road.connector || (n.road.surface === 'stone') !== stone || n.inside > 30) continue;
      const s = n.seg;
      const ang = Math.atan2(s.dz, s.dx);
      const tx = Math.cos(ang), tz = Math.sin(ang);
      for (const side of [1, -1]) {
        const nx = -Math.sin(ang) * side, nz = Math.cos(ang) * side;
        const fx = n.px + nx * (s.half + 0.25), fz = n.pz + nz * (s.half + 0.25);   // 店先
        const x = fx + nx * 2.1, z = fz + nz * 2.1;                                   // 店の中心
        let ok = true;
        for (const u of [-2.4, 0, 2.4]) {
          for (const v of [0.1, 2.1, 4.1]) {
            const qx = fx + tx * u + nx * v, qz = fz + tz * u + nz * v;
            if (inBuilding(qx, qz) || demAt(qx, qz) < SEA_Y + 0.8 || inSolid(qx, qz)) ok = false;
            if (v > 0.5 && nearAnyRoad(qx, qz, 0.2)) ok = false;
          }
        }
        if (!ok) continue;
        return { x, z, fx, fz, nx, nz, ang, standX: n.px + nx * Math.max(0, s.half - 0.7), standZ: n.pz + nz * Math.max(0, s.half - 0.7) };
      }
    }
  }
  return null;
}
export const STREET_SHOPS = (() => {
  const out = [];
  const add = (spec, at, opts) => {
    if (!at) return;
    const spot = shopSpot(at.x, at.z, opts);
    if (!spot) return;
    out.push({ ...spec, ...spot });
    addSolid(spot.x, spot.z, 4.6, 4, -spot.ang);
  };
  // 坂の途中の小さなパン屋（猫の細道の、中ほど）
  const neko = ROADS.find((r) => r.name === '猫の細道');
  if (neko) add({ type: 'bakery', menu: 'hillBakery', name: 'そのてパン', style: 'hillBakery' }, pointAlong(neko.pts, 0.45), { stone: true, maxR: 30 });
  return out;
})();

// ロープウェイの乗り場（駅前の道の上）と、山頂の展望台
export const ROPEWAY_STOPS = (() => {
  const stand = (p) => { const c = clampToRoads(p.x, p.z); return { x: c.x, z: c.z }; };
  return { base: stand(ROPEWAY.base), top: stand(ROPEWAY.top) };
})();
export const SUMMIT = (() => {
  // 千光寺山のいちばん高いところ（展望台のあたり）の、歩ける道の上
  const vp = POIS.find((p) => p.n === '展望台' && p.k === 'viewpoint');
  let best = null;
  for (let x = ROPEWAY.top.x - 40; x < ROPEWAY.top.x + 160; x += 4) {
    for (let z = ROPEWAY.top.z - 60; z < ROPEWAY.top.z + 100; z += 4) {
      const y = terrainY(x, z);
      if (!best || y > best.y) best = { x, z, y };
    }
  }
  const c = clampToRoads(vp ? vp.x : best.x, vp ? vp.z : best.z);
  return { x: c.x, z: c.z, deck: vp ? { x: vp.x, z: vp.z } : { x: best.x, z: best.z } };
})();

// 海沿いのベンチ：歩ける道が岸に近いところに、海を向けて置く
export const BENCHES = (() => {
  // 尾道の海沿いは、尾道水道を向いたベンチがあちこちにある。岸壁から少し陸に入ったところに、
  // 20m あまりおきに置く。向きは、尾道水道のまん中のいちばん近いところへ向ける。
  const out = [];
  const piers = FERRY_ROUTES.map((r) => r.a);
  const solid = (x, z) => demAt(x, z) > SEA_Y + 1.0 && quayY(x, z) === -Infinity; // 標高のマスがぜんぶ陸
  const water = (x, z) => demAt(x, z) < SEA_Y;
  const toStrait = (x, z) => {
    let best = null;
    for (let dx = -240; dx <= 240; dx += 10) {
      const c = straitAt(x + dx);
      const d = Math.hypot(c.x - x, c.z - z);
      if (!best || d < best.d) best = { d, dx: (c.x - x) / d, dz: (c.z - z) / d };
    }
    return best;
  };
  for (const line of COAST) {
    for (const s of samplePath(line, 6)) {
      if (s.x < -650 || s.x > 620 || !onOnomichiSide(s.x, s.z + 30)) continue;
      const f = toStrait(s.x, s.z);
      if (!f || f.d > 420) continue;
      // 岸壁から陸へ 2〜6m 入ったところで、座面の四隅と足もとがしっかり陸のところ
      let spot = null;
      for (let back = 2; back <= 6 && !spot; back += 0.5) {
        const x = s.x - f.dx * back, z = s.z - f.dz * back;
        const ax = -f.dz, az = f.dx; // ベンチの長手方向
        const corners = [[-1.2, -0.6], [1.2, -0.6], [-1.2, 1.4], [1.2, 1.4], [0, 0]];
        if (!corners.every(([u, v]) => solid(x + ax * u - f.dx * v, z + az * u - f.dz * v))) continue;
        spot = { x, z };
      }
      if (!spot) continue;
      const { x, z } = spot;
      // 前（尾道水道のほう）が開けた海で、建物にさえぎられないこと（正面と、左右 20° ずつ）
      const open = [-0.35, 0, 0.35].every((a) => {
        const c = Math.cos(a), sn = Math.sin(a);
        const dx = f.dx * c - f.dz * sn, dz = f.dx * sn + f.dz * c;
        for (let k = 3; k <= 60; k += 3) {
          const qx = x + dx * k, qz = z + dz * k;
          if (inBuilding(qx, qz)) return false;
          if (k >= 9 && !water(qx, qz)) return false;
        }
        return true;
      });
      if (!open) continue;
      if (terrainY(x, z) - SEA_Y > FREE_HEIGHT || !walkable(x - f.dx * 1.2, z - f.dz * 1.2)) continue;
      if (inBuilding(x, z) || inSolid(x, z)) continue;
      if (piers.some((p) => Math.hypot(p.x - x, p.z - z) < 12)) continue;
      if (out.some((b) => Math.hypot(b.x - x, b.z - z) < 22)) continue;
      out.push({ x, z, y: groundY(x, z), yaw: Math.atan2(-f.dx, -f.dz) });
    }
  }
  // 尾道渡船のりばに近い順
  const pier = FERRY_ROUTES[0] ? FERRY_ROUTES[0].a : { x: 0, z: -400 };
  return out.sort((p, q) => Math.hypot(p.x - pier.x, p.z - pier.z) - Math.hypot(q.x - pier.x, q.z - pier.z))
    .slice(0, 70).map((b, i) => ({ ...b, style: i % 3 === 1 ? 'deck' : 'classic' }));
})();

// 地図から飛べる場所
function placeAt(name, x, z, lookX, lookZ) {
  const p = clampToRoads(x, z);
  const yaw = lookX === undefined ? 0 : Math.atan2(-(lookX - p.x), -(lookZ - p.z));
  return { id: name, name, x: p.x, z: p.z, yaw };
}
function placeOnRoad(label, roadName, f, look) {
  const r = ROADS.find((rr) => rr.name === roadName);
  if (!r) return null;
  const q = pointAlong(r.pts, f);
  return placeAt(label, q.x, q.z, look ? look[0] : q.x - Math.cos(q.angle), look ? look[1] : q.z - Math.sin(q.angle));
}
/** 名所から少し離れた（約 dist m）道の上に立って、名所のほうを向く */
function placeNear(label, poiName, dist = 15) {
  const p = poi(poiName);
  if (!p) return null;
  let best = null;
  for (const s of SEGMENTS) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const x = s.ax + s.dx * t, z = s.az + s.dz * t;
      const d = Math.hypot(x - p.x, z - p.z);
      if (inBuilding(x, z)) continue;
      const score = Math.abs(d - dist) + (terrainY(x, z) > terrainY(p.x, p.z) + 3 ? 0 : 2); // 少し高いところから見下ろせると良い
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  return placeAt(label, best.x, best.z, p.x, p.z);
}
export const PLACES = [
  { ...placeAt('坂の上の空き家', -6.5, -0.6, -60, -300), id: 'house' },
  placeNear('千光寺', '千光寺'),
  placeAt('ロープウェイ山頂駅', ROPEWAY_STOPS.top.x, ROPEWAY_STOPS.top.z, ROPEWAY.top.x, ROPEWAY.top.z),
  { ...placeAt('千光寺山 頂上（展望台）', SUMMIT.x, SUMMIT.z, 0, -600), id: 'summit' },
  placeNear('天寧寺 三重塔', '天寧寺三重塔'),
  placeOnRoad('猫の細道', '猫の細道', 0.5),
  placeNear('艮神社', '艮神社'),
  placeAt('ロープウェイ山麓駅', ROPEWAY_STOPS.base.x, ROPEWAY_STOPS.base.z, ROPEWAY.base.x, ROPEWAY.base.z),
  placeOnRoad('本町センター街', '本町センター街', 0.5),
  placeOnRoad('尾道ラーメン 汐', '本町センター街', 0.52),
  placeOnRoad('パン 潮風', '中商店街', 0.44),
  placeOnRoad('かまぼこ 潮見', '本町センター街', 0.3),
  placeOnRoad('おやつのウミネコ', '本町センター街', 0.4),
  placeOnRoad('尾道マロン珈琲', '一番街', 0.3),
  ...STREET_SHOPS.map((sh) => ({ id: sh.name, name: sh.name, x: sh.standX, z: sh.standZ, yaw: Math.atan2(sh.nx, sh.nz) })),
  placeOnRoad('中商店街', '中商店街', 0.5),
  placeOnRoad('一番街', '一番街', 0.5),
  placeNear('尾道駅前', 'JR尾道駅', 40),
  placeNear('渡船のりば（尾道渡船）', '土堂桟橋(尾道渡船)'),
  BENCHES[0] ? { id: '海沿いのベンチ', name: '海沿いのベンチ', x: BENCHES[0].x + Math.sin(BENCHES[0].yaw) * 1.2, z: BENCHES[0].z + Math.cos(BENCHES[0].yaw) * 1.2, yaw: BENCHES[0].yaw } : null,
].filter(Boolean);

// ---------- 場所の名前・足もと・音 ----------
export function placeName(x, z) {
  if (Math.hypot(x - HOUSE_DOOR.x, z - HOUSE_DOOR.z) < 7) return '坂の上の空き家';
  const n = nearestRoad(x, z);
  if (n.road.covered) return `本通り商店街　${n.road.name}`;
  if (FERRY_PIERS.some((p) => Math.hypot(p.x - x, p.z - z) < 25)) return '渡船のりば';
  if (CROSSINGS.some((c) => Math.hypot(c.x - x, c.z - z) < 8)) return '踏切';
  let label = n.road.name;
  // 名前のない道は、近くの名所で呼ぶ
  let best = null;
  for (const p of POIS) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < 45 && (!best || d < best.d)) best = { n: p.n.replace(/\(.*\)|（.*）/g, ''), d };
  }
  if (!label) label = best ? `${best.n}のあたり` : distToCoast(x, z) < 30 ? '海沿いの道' : n.road.label;
  else if (best && best.d < 20) label = `${label}　${best.n}`;
  return label;
}

export function surfaceAt(x, z) {
  return nearestRoad(x, z).road.surface;
}

export function zoneWeights(x, z) {
  const sea = Math.max(0, Math.min(1, 1 - distToCoast(x, z) / 60));
  const n = nearestRoad(x, z);
  const arcade = n.road.covered && n.inside < 1 ? 1 : 0;
  const slope = Math.max(0, Math.min(1, (terrainY(x, z) - SEA_Y - 8) / 12));
  return { sea, arcade, slope };
}
