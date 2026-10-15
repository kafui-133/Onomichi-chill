// 尾道の町の「地図データ」：地形の高さ、歩ける道（ポリライン＋幅）、地名。
//
// 座標系：+x が西（尾道駅側）、-x が東（長江口・尾道大橋側）、-z が南（尾道水道）。
// 実際の位置関係を簡略化して再現している：
//   海（尾道水道） ─ 海岸通り ─ 本通り商店街（駅から東へ約1.2km）─ 国道2号 ─ JR山陽本線 ─ 千光寺山の斜面
//   ・長江口にロープウェイ山麓駅、そのそばに艮神社
//   ・猫の細道は艮神社のあたりからロープウェイの下をくぐって山へ登る細い路地
//   ・坂の途中に天寧寺の三重塔
//   ・主人公の空き家は千光寺山の中腹（原点）。千光寺新道の踏切から石段を登った先

export const SEA_Y = -60;
export const FLAT_Y = -58;     // 海沿いの平地の高さ
export const QUAY_Z = -220;    // 岸壁
export const ARCADE_Z = -188;  // 本通り商店街の中心線
export const ROUTE2_Z = -170;  // 国道2号
export const RAIL_Z = -160;    // JR山陽本線
export const SLOPE_Z = -156;   // ここから北が斜面

/** 地形の高さ */
export function terrainY(x, z) {
  if (z <= SLOPE_Z) return FLAT_Y;
  const t = (z - SLOPE_Z) / (2 - SLOPE_Z);
  let y = FLAT_Y + 58 * Math.pow(t, 1.15);
  // 尾根と谷のゆるやかな起伏（平地との境目と、空き家のまわりでは消える）
  const k = Math.min(1, t * 3);
  const nearHouse = Math.min(1, Math.hypot(x, z) / 40);
  y += (Math.sin(x * 0.011 + 1.3) * 3.5 + Math.sin(x * 0.027) * 1.5 - 4.3) * k * nearHouse;
  return y;
}

// 本通り商店街の5つの通り（西から東へ）
export const ARCADE_SECTIONS = [
  { name: '芙美子通り', x0: 460, x1: 250 },
  { name: '土堂中商店街', x0: 250, x1: 60 },
  { name: '本町センター街', x0: 60, x1: -130 },
  { name: '絵のまち通り', x0: -130, x1: -340 },
  { name: '尾道通り', x0: -340, x1: -620 },
];

const CROSS_X = [455, 300, 150, 40, -120, -260, -420, -560]; // 南北の小路
export const CROSSINGS = [300, 40, -120]; // 踏切

// prettier-ignore
export const ROADS = [
  { id: 'promenade', name: '海岸通り', surface: 'tile', width: 11, pts: [[520, -213.5], [-650, -213.5]] },
  { id: 'arcade', name: '本通り商店街', surface: 'tile', width: 5, pts: [[455, ARCADE_Z], [-622, ARCADE_Z]] },
  { id: 'route2', name: '国道2号', surface: 'asphalt', width: 7, pts: [[462, ROUTE2_Z], [-650, ROUTE2_Z]] },
  ...CROSS_X.map((x) => ({ id: `cross${x}`, name: x === -120 ? '長江口' : x === 455 ? '尾道駅前' : '小路', surface: x === -120 ? 'asphalt' : 'tile', width: x === -120 ? 8 : x === 455 ? 7 : 3.6, pts: [[x, -212], [x, ROUTE2_Z]] })),
  // 踏切（国道2号から線路を渡る）
  ...CROSSINGS.map((x) => ({ id: `fumikiri${x}`, name: '踏切', surface: 'asphalt', width: x === -120 ? 6 : 3, pts: [[x, ROUTE2_Z], [x, -153]] })),
  // 千光寺新道：踏切から石段を折れながら登り、空き家へ
  { id: 'shindo', name: '千光寺新道', surface: 'stone', width: 2.4, pts: [
    [40, -153], [36, -136], [44, -118], [31, -100], [38, -82], [22, -64], [28, -46], [13, -31], [17, -17], [4, -9], [-4.5, -3], [-4.8, 1.2],
  ] },
  // 猫の細道：長江口の山麓駅・艮神社のわきから、ロープウェイの下をくぐって登る
  { id: 'nekonohosomichi', name: '猫の細道', surface: 'stone', width: 1.5, pts: [
    [-120, -153], [-116, -142], [-122, -128], [-108, -118], [-88, -114], [-68, -108], [-50, -104], [-36, -93], [-18, -84], [2, -76], [22, -64],
  ] },
  // 土堂の小路（行き止まりの坂）
  { id: 'dodo', name: '土堂の小路', surface: 'stone', width: 1.8, pts: [[300, -153], [296, -138], [306, -122], [292, -104], [298, -90]] },
  // 空き家の上の見晴らし（千光寺方面）
  { id: 'upper', name: '千光寺へ続く坂', surface: 'stone', width: 1.8, pts: [[-4.8, 1.2], [-10, 9], [-8, 20], [-20, 30], [-26, 42]] },
];

// 地図から飛べる場所・ベンチ・家の戸口
export const HOUSE_DOOR = { x: -4.4, z: 1.5 };
export const PLACES = [
  { id: 'house', name: '坂の上の空き家', x: -4.6, z: 0.2, yaw: -0.9 },
  { id: 'upper', name: '見晴らしの坂', x: -24, z: 39, yaw: 0.3 },
  { id: 'shindo', name: '千光寺新道', x: 30, z: -96, yaw: 0.4 },
  { id: 'fumikiri', name: '千光寺新道の踏切', x: 40, z: -150, yaw: 0 },
  { id: 'pagoda', name: '天寧寺 三重塔', x: -46, z: -102, yaw: 2.2 },
  { id: 'neko', name: '猫の細道', x: -88, z: -114, yaw: -1.4 },
  { id: 'ropeway', name: 'ロープウェイ山麓駅・艮神社', x: -118, z: -150, yaw: Math.PI },
  { id: 'arcade-w', name: '本通り商店街（西）', x: 380, z: ARCADE_Z, yaw: -Math.PI / 2 },
  { id: 'arcade-c', name: '本通り商店街（中）', x: 40, z: ARCADE_Z, yaw: -Math.PI / 2 },
  { id: 'arcade-e', name: '本通り商店街（東）', x: -250, z: ARCADE_Z, yaw: Math.PI / 2 },
  { id: 'station', name: '尾道駅前', x: 455, z: -200, yaw: -2.26 },
  { id: 'ferry', name: '渡船のりば', x: 40, z: -216, yaw: 0 },
  { id: 'bench', name: '海岸通りのベンチ', x: 120, z: -216, yaw: 0 },
];

export const BENCHES = [480, 330, 210, 120, -40, -200, -330, -470].map((x) => ({ x, z: -217.2 }));
export const FERRY_PIERS = [40, -170];

// ---------- 道との当たり判定 ----------
const SEGMENTS = [];
for (const road of ROADS) {
  for (let i = 0; i < road.pts.length - 1; i++) {
    const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    SEGMENTS.push({ road, ax, az, dx, dz, len, half: road.width / 2 });
  }
}

/** 点から最も近い道の線分 */
export function nearestRoad(x, z) {
  let best = null;
  for (const s of SEGMENTS) {
    let t = ((x - s.ax) * s.dx + (z - s.az) * s.dz) / (s.len * s.len);
    t = Math.max(0, Math.min(1, t));
    const px = s.ax + s.dx * t, pz = s.az + s.dz * t;
    const d = Math.hypot(x - px, z - pz);
    // 道の内側にいるかどうかは「中心線からの距離 − 半幅」で比べる
    const inside = d - s.half;
    if (!best || inside < best.inside) best = { seg: s, road: s.road, px, pz, d, inside, t };
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
  for (const s of SEGMENTS) {
    let t = ((x - s.ax) * s.dx + (z - s.az) * s.dz) / (s.len * s.len);
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(x - (s.ax + s.dx * t), z - (s.az + s.dz * t)) < s.half + margin) return s.road;
  }
  return null;
}

/** 道の線に沿って一定間隔で点を取る（石段・石垣・街灯の配置用） */
export function samplePath(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, angle: Math.atan2(bz - az, bx - ax), len: len / n });
    }
  }
  const [lx, lz] = pts[pts.length - 1];
  const [px, pz] = pts[pts.length - 2];
  out.push({ x: lx, z: lz, angle: Math.atan2(lz - pz, lx - px), len: step });
  return out;
}

/** いまいる場所の名前 */
export function placeName(x, z) {
  const n = nearestRoad(x, z);
  if (Math.hypot(x - HOUSE_DOOR.x, z - HOUSE_DOOR.z) < 6) return '坂の上の空き家';
  const id = n.road.id;
  if (id === 'arcade') {
    const sec = ARCADE_SECTIONS.find((s) => x <= s.x0 && x > s.x1);
    return `本通り商店街　${sec ? sec.name : ''}`;
  }
  if (id === 'promenade') {
    if (FERRY_PIERS.some((px) => Math.abs(px - x) < 10)) return '海岸通り　渡船のりば';
    return x > 420 ? '海岸通り　尾道駅前' : '海岸通り';
  }
  if (id.startsWith('fumikiri')) return Math.abs(x - 40) < 5 ? '千光寺新道の踏切' : x < -100 ? '長江口の踏切' : '踏切';
  if (id === 'nekonohosomichi') {
    if (Math.hypot(x + 112, z + 144) < 12) return '猫の細道　艮神社';
    if (Math.hypot(x + 122, z + 128) < 7) return '猫の細道　ロープウェイの下';
    if (Math.hypot(x + 60, z + 92) < 18) return '猫の細道　天寧寺 三重塔';
    return '猫の細道';
  }
  if (id === 'cross-120') return z > -180 ? '長江口' : '長江口の小路';
  if (id === 'cross455') return '尾道駅前';
  return n.road.name;
}

/** 足もとの素材（足音用） */
export function surfaceAt(x, z) {
  return nearestRoad(x, z).road.surface;
}

/** 音の環境：海の近さ／商店街の中／斜面 */
export function zoneWeights(x, z) {
  const sea = Math.max(0, Math.min(1, (-z - 192) / 20));
  const arcade = Math.abs(z - ARCADE_Z) < 3 && x < 468 && x > -622 ? 1 : 0;
  const slope = Math.max(0, Math.min(1, (z - SLOPE_Z) / 15));
  return { sea, arcade, slope };
}
