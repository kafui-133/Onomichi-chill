// 猫：プリミティブで組んだ茶トラ。親密度に応じて4段階でふるまいが変わる。
//   Lv.1 警戒：窓辺から遠く（海）を見ている。触れると耳を伏せてそっぽを向く
//   Lv.2 関心：窓辺から降りて、少し近くに来て座る
//   Lv.3 慣れ：足もとで香箱座り。シッポをペシペシ、ゴロゴロ
//   Lv.4 信頼：となりの座布団の上で丸くなって眠る
import * as THREE from 'three';
import { canvasTexture, clamp, damp, lerp, seededRandom } from './util.js';
import { SILL_Y } from './room.js';

export const LEVEL_THRESHOLDS = [0, 4, 10, 18];
const STORAGE_KEY = 'onomichi-cat-affection';
const STRAY_KEY = 'onomichi-stray-affection';
function loadStrays() {
  try { return JSON.parse(localStorage.getItem(STRAY_KEY)) || {}; } catch { return {}; }
}

const LEVEL_TEXT = {
  2: '猫がこちらを気にしている。少しだけ近づいてきた',
  3: '足もとでシッポがぺしぺし。ゴロゴロ…',
  4: '座布団の上で丸くなった。ここで眠るらしい',
};
// 町の猫（その場から動かない）が懐いたとき
const STRAY_LEVEL_TEXT = {
  2: 'こちらを気にしている。少し、気を許したらしい',
  3: 'シッポがぴんと立った。もう逃げない',
  4: 'すっかり懐いた。地図に、この猫の居場所が記された',
};

// 各レベルの居場所（y は足もとの高さ）と向き
const SPOTS = {
  1: { pos: new THREE.Vector3(1.5, SILL_Y, -1.45), face: 'sea', pose: 'sit' },
  2: { pos: new THREE.Vector3(1.0, 0, -0.75), face: 'camera', pose: 'sit' },
  3: { pos: new THREE.Vector3(0.36, 0, -0.05), face: 'camera', pose: 'loaf' },
  4: { pos: new THREE.Vector3(0.62, 0.08, 0.38), face: 'side', pose: 'curl' },
};

// 毛色。base=地の色、stripe=縞、plain=耳・脚など、tip=シッポの先、belly=お腹の白、patches=三毛のぶち
export const COATS = {
  chatora:   { label: '茶トラ',   base: '#d98e4a', stripe: '150,75,30',  plain: 0xd38a47, tip: 0x9a5528, belly: true },
  sabatora:  { label: 'サバトラ', base: '#9c9b97', stripe: '38,38,40',   plain: 0x8e8d89, tip: 0x34343a, belly: true },
  kijitora:  { label: 'キジトラ', base: '#8c7052', stripe: '45,32,20',   plain: 0x7d6449, tip: 0x3a2a1e, belly: false },
  hachiware: { label: 'ハチワレ', base: '#2b2724', stripe: null,         plain: 0x2b2724, tip: 0x2b2724, belly: true, whiteLegs: true, blaze: 'wide' },
  mike:      { label: '三毛',     base: '#efe7da', stripe: null,         plain: 0xe9e0d2, tip: 0x2a2420, belly: true, patches: ['#d0843e', '#2e2925'] },
  shiro:     { label: '白',       base: '#eee8de', stripe: null,         plain: 0xece5da, tip: 0xe2dacd, belly: false },
  chashiro:  { label: '茶白',     base: '#dc9550', stripe: '160,85,35',  plain: 0xd8924e, tip: 0xa25c2c, belly: true, whiteLegs: true, blaze: 'narrow' },
  kuro:      { label: '黒',       base: '#23201e', stripe: null,         plain: 0x23201e, tip: 0x1c1a18, belly: false, eye: 0xc9a23a },
};

// 目の個性。毛色ごとに出やすい目の色があり、そのうえで猫ごとにばらつく
const EYE_COLORS = {
  default: [0xb8a040, 0x9fb04a, 0xc99a3a, 0x86a648, 0xc4a84a, 0xa8903a],
  kuro: [0xc9a23a, 0xd4ae3c, 0xb88a2c, 0x9fae44],
  shiro: [0x6a9cc8, 0x7aaed6, 0xb8a040, 0x9fb04a],
};
const ITOME = new Set(['bench', 'ishidan']);
function eyeTraits(coat, id) {
  const r = seededRandom('eye-' + id + coat.label);
  const key = coat.label === '黒' ? 'kuro' : coat.label === '白' ? 'shiro' : 'default';
  const pal = EYE_COLORS[key];
  const irisL = pal[Math.floor(r() * pal.length)];
  // 白猫は、ときどきオッドアイ
  const odd = key === 'shiro' && r() < 0.5;
  // 糸目の猫：ふだんは目がほとんど閉じていて、細い線のように見える
  const itome = ITOME.has(id) || r() < 0.15;
  return {
    itome,
    irisL, irisR: odd ? (irisL === 0x6a9cc8 || irisL === 0x7aaed6 ? 0xc4a84a : 0x6a9cc8) : irisL,
    size: 0.92 + r() * 0.14,        // 目の大きさ
    wide: 1.1 + r() * 0.15,         // 横長（アーモンド形）
    pupil: 0.6 + r() * 0.25,        // 瞳の太さ（まるく大きいほど、甘えた顔）
    rest: 0.18 + r() * 0.16,        // ふだんのまぶたの下がり具合
    droop: 0.05 + r() * 0.3,        // 目じりの角度（大きいほど、たれ目でやさしい顔）
    slant: (r() - 0.5) * 0.16,
  };
}

function furTexture(coat, seed) {
  const r = seededRandom('tora' + seed);
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = coat.base;
    g.fillRect(0, 0, w, h);
    // 縞
    if (coat.stripe) {
      for (let i = 0; i < 18; i++) {
        const x = (i / 18) * w + r() * 6;
        g.strokeStyle = `rgba(${coat.stripe},${0.45 + r() * 0.3})`;
        g.lineWidth = 3 + r() * 5;
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y < h * 0.7; y += 8) g.lineTo(x + Math.sin(y * 0.1 + i) * 4, y);
        g.stroke();
      }
    }
    // 三毛のぶち
    if (coat.patches) {
      for (let i = 0; i < 7; i++) {
        g.fillStyle = coat.patches[i % coat.patches.length];
        g.beginPath();
        g.ellipse(r() * w, r() * h * 0.6, 14 + r() * 26, 10 + r() * 18, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    // お腹は白
    if (coat.belly) {
      const grd = g.createLinearGradient(0, h * 0.55, 0, h);
      grd.addColorStop(0, 'rgba(244,236,224,0)');
      grd.addColorStop(0.4, 'rgba(244,236,224,1)');
      g.fillStyle = grd;
      g.fillRect(0, h * 0.55, w, h * 0.45);
    }
  });
}

// 顔の模様（頭の球の UV：u=0.25 が顔の正面、v=0 が頭のてっぺん。目は v≈0.47、鼻は v≈0.57）
function headTexture(coat, seed) {
  const r = seededRandom('face' + seed);
  return canvasTexture(512, 256, (g, w, h) => {
    const U = (u) => u * w, V = (v) => v * h;
    g.fillStyle = coat.base;
    g.fillRect(0, 0, w, h);
    if (coat.stripe) {
      // 頭の縞は、後頭部へ流れる
      for (let i = 0; i < 26; i++) {
        const x = (i / 26) * w + r() * 8;
        if (Math.abs(x / w - 0.25) < 0.06) continue;
        g.strokeStyle = `rgba(${coat.stripe},${0.4 + r() * 0.3})`;
        g.lineWidth = 4 + r() * 5;
        g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + (r() - 0.5) * 14, V(0.25), x + (r() - 0.5) * 10, V(0.42)); g.stroke();
      }
      // ひたいの「M」
      g.strokeStyle = `rgba(${coat.stripe},0.75)`;
      g.lineWidth = 4;
      for (const dx of [-0.03, -0.01, 0.01, 0.03]) {
        g.beginPath(); g.moveTo(U(0.25 + dx), V(0.18)); g.lineTo(U(0.25 + dx * 0.7), V(0.38 - Math.abs(dx) * 1.5)); g.stroke();
      }
      // 目じりから頬へのすじ
      g.lineWidth = 3;
      for (const sx of [-1, 1]) {
        g.beginPath(); g.moveTo(U(0.25 + sx * 0.075), V(0.5)); g.quadraticCurveTo(U(0.25 + sx * 0.11), V(0.53), U(0.25 + sx * 0.14), V(0.6)); g.stroke();
      }
    }
    if (coat.patches) {
      for (let i = 0; i < 4; i++) {
        g.fillStyle = coat.patches[i % coat.patches.length];
        const u = r() < 0.5 ? 0.25 + (0.08 + r() * 0.3) : 0.25 - (0.08 + r() * 0.3);
        g.beginPath(); g.ellipse(U(u), V(0.1 + r() * 0.35), 20 + r() * 30, 14 + r() * 20, r() * 3, 0, Math.PI * 2); g.fill();
      }
    }
    const white = 'rgba(244,236,224,1)';
    if (coat.belly) {
      // 口もとからあごの下は白
      const grd = g.createRadialGradient(U(0.25), V(0.72), 4, U(0.25), V(0.72), U(0.1));
      grd.addColorStop(0, white); grd.addColorStop(0.75, white); grd.addColorStop(1, 'rgba(244,236,224,0)');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(U(0.25), V(0.72), U(0.1), V(0.2), 0, 0, Math.PI * 2); g.fill();
      const chin = g.createLinearGradient(0, V(0.76), 0, V(0.9));
      chin.addColorStop(0, 'rgba(244,236,224,0)'); chin.addColorStop(1, white);
      g.fillStyle = chin;
      g.beginPath(); g.ellipse(U(0.25), V(1), U(0.17), V(0.24), 0, 0, Math.PI * 2); g.fill();
    }
    if (coat.blaze) {
      // ハチワレ：鼻すじから眉間へ、白い「八」の字
      const top = coat.blaze === 'wide' ? 0.3 : 0.4, half = coat.blaze === 'wide' ? 0.1 : 0.03;
      g.fillStyle = white;
      g.beginPath();
      g.moveTo(U(0.25 - half - 0.08), V(0.95));
      g.quadraticCurveTo(U(0.25 - 0.035), V(0.55), U(0.25 - 0.006), V(top));
      g.lineTo(U(0.25 + 0.006), V(top));
      g.quadraticCurveTo(U(0.25 + 0.035), V(0.55), U(0.25 + half + 0.08), V(0.95));
      g.closePath(); g.fill();
    }
  });
}

// ポーズ：各パーツの位置・回転・拡大
// prettier-ignore
const POSES = {
  stand: {
    body: { p: [0, 0.2, 0], r: [0.04, 0, 0], s: [0.105, 0.1, 0.185] },
    head: { p: [0, 0.285, 0.185], r: [0, 0, 0] },
    fl: { p: [0.048, 0.19, 0.11], r: [0, 0, 0], s: [1, 1, 1] },
    fr: { p: [-0.048, 0.19, 0.11], r: [0, 0, 0], s: [1, 1, 1] },
    bl: { p: [0.056, 0.2, -0.1], r: [0, 0, 0], s: [1, 1, 1], j: [-0.6, 1.35, -0.7] },
    br: { p: [-0.056, 0.2, -0.1], r: [0, 0, 0], s: [1, 1, 1], j: [-0.6, 1.35, -0.7] },
    tail: { p: [0, 0.225, -0.17], r: [-0.2, 0, 0] },
  },
  sit: {
    body: { p: [0, 0.16, -0.03], r: [-0.72, 0, 0], s: [0.105, 0.1, 0.165] },
    head: { p: [0, 0.335, 0.08], r: [0, 0, 0] },
    fl: { p: [0.035, 0.185, 0.065], r: [-0.08, 0, 0], s: [1, 0.97, 1] },
    fr: { p: [-0.035, 0.185, 0.065], r: [-0.08, 0, 0], s: [1, 0.97, 1] },
    bl: { p: [0.062, 0.06, -0.075], r: [0, 0.12, 0], s: [1, 1, 1], j: [-1.35, 2.7, -2.65] },
    br: { p: [-0.062, 0.06, -0.075], r: [0, -0.12, 0], s: [1, 1, 1], j: [-1.35, 2.7, -2.65] },
    tail: { p: [0, 0.03, -0.15], r: [0.02, 0.9, 0] },
  },
  loaf: {
    body: { p: [0, 0.1, 0], r: [0, 0, 0], s: [0.11, 0.09, 0.19] },
    head: { p: [0, 0.2, 0.17], r: [0, 0, 0] },
    fl: { p: [0.04, 0.05, 0.12], r: [1.4, 0, 0], s: [1.2, 0.5, 1.2] },
    fr: { p: [-0.04, 0.05, 0.12], r: [1.4, 0, 0], s: [1.2, 0.5, 1.2] },
    bl: { p: [0.062, 0.05, -0.08], r: [0, 0.1, 0], s: [1, 1, 1], j: [-1.4, 2.75, -2.65] },
    br: { p: [-0.062, 0.05, -0.08], r: [0, -0.1, 0], s: [1, 1, 1], j: [-1.4, 2.75, -2.65] },
    tail: { p: [0.03, 0.03, -0.17], r: [0.0, 0.5, 0] },
  },
  curl: {
    body: { p: [0, 0.075, 0], r: [0, 0, 0], s: [0.145, 0.075, 0.15] },
    head: { p: [0.08, 0.1, 0.1], r: [0.35, 1.0, 0.3] },
    fl: { p: [0.03, 0.04, 0.08], r: [1.5, 0, 0], s: [0.3, 0.3, 0.3] },
    fr: { p: [-0.03, 0.04, 0.08], r: [1.5, 0, 0], s: [0.3, 0.3, 0.3] },
    bl: { p: [0.05, 0.04, -0.06], r: [0, 0, 0], s: [0.3, 0.3, 0.3], j: [-1.4, 2.75, -2.65] },
    br: { p: [-0.05, 0.04, -0.06], r: [0, 0, 0], s: [0.3, 0.3, 0.3], j: [-1.4, 2.75, -2.65] },
    tail: { p: [-0.06, 0.035, -0.11], r: [0.0, -1.2, 0] },
  },
  // 横になって寝転ぶ（左を下に、お腹をこちらへ）
  side: {
    body: { p: [0, 0.085, 0], r: [0, 0, 1.25], s: [0.1, 0.09, 0.2] },
    head: { p: [0.0, 0.075, 0.2], r: [0.1, 0.15, 1.2] },
    fl: { p: [0.04, 0.06, 0.12], r: [0.35, 0, 1.4], s: [1, 0.95, 1] },
    fr: { p: [0.05, 0.1, 0.1], r: [0.7, 0, 1.3], s: [1, 0.9, 1] },
    bl: { p: [0.04, 0.06, -0.12], r: [-0.1, 0, 1.4], s: [1, 1, 1], j: [-0.6, 1.1, -0.35] },
    br: { p: [0.05, 0.1, -0.1], r: [-0.3, 0, 1.3], s: [1, 1, 1], j: [-0.8, 1.3, -0.4] },
    tail: { p: [0, 0.05, -0.19], r: [0.05, 0.25, 0] },
  },
  // おなかを見せてごろん（信頼のしるし）
  belly: {
    body: { p: [0, 0.095, 0], r: [0, 0, 2.85], s: [0.105, 0.09, 0.2] },
    head: { p: [0.02, 0.08, 0.2], r: [-0.25, 0.3, 2.2] },
    fl: { p: [0.02, 0.15, 0.12], r: [0.5, 0, 2.75], s: [1, 0.75, 1] },
    fr: { p: [-0.04, 0.15, 0.12], r: [0.8, 0, 2.95], s: [1, 0.7, 1] },
    bl: { p: [0.02, 0.14, -0.12], r: [-0.2, 0, 2.8], s: [1, 1, 1], j: [-0.9, 1.6, -0.5] },
    br: { p: [-0.04, 0.14, -0.12], r: [-0.4, 0, 3.0], s: [1, 1, 1], j: [-1.0, 1.7, -0.5] },
    tail: { p: [0, 0.05, -0.19], r: [0.0, 0.4, 0] },
  },
  // のび（前足をぐーっと前に、お尻を上げる）
  stretch: {
    body: { p: [0, 0.15, -0.02], r: [0.38, 0, 0], s: [0.095, 0.085, 0.21] },
    head: { p: [0, 0.16, 0.25], r: [-0.25, 0, 0] },
    fl: { p: [0.045, 0.1, 0.13], r: [-1.25, 0, 0], s: [1, 1.05, 1] },
    fr: { p: [-0.045, 0.1, 0.13], r: [-1.25, 0, 0], s: [1, 1.05, 1] },
    bl: { p: [0.055, 0.215, -0.13], r: [0, 0, 0], s: [1, 1, 1], j: [-0.35, 0.85, -0.45] },
    br: { p: [-0.055, 0.215, -0.13], r: [0, 0, 0], s: [1, 1, 1], j: [-0.35, 0.85, -0.45] },
    tail: { p: [0, 0.26, -0.19], r: [1.25, 0, 0] },
  },
};

// シッポの各節の曲がり（ポーズ別）
const TAIL_CURVES = {
  stand: [[-0.35, 0], [-0.1, 0], [0.12, 0], [0.25, 0.04], [0.3, 0.06], [0.3, 0.08]],
  sit: [[0, 0.35], [0, 0.4], [0, 0.4], [0, 0.35], [0.05, 0.3], [0.15, 0.2]],
  loaf: [[0, 0.15], [0, 0.2], [0, 0.25], [0, 0.3], [0, 0.3], [0.1, 0.3]],
  curl: [[0, -0.45], [0, -0.45], [0, -0.45], [0, -0.45], [0, -0.4], [0, -0.35]],
  side: [[0, 0.1], [0, 0.12], [0, 0.15], [0, 0.18], [0, 0.2], [0, 0.2]],
  belly: [[0, 0.2], [0, 0.2], [0, 0.15], [0, 0.1], [0, 0.1], [0, 0.1]],
  stretch: [[0.1, 0], [0.05, 0], [0, 0], [-0.15, 0], [-0.25, 0], [-0.35, 0]],
};
// 寝転んでいるポーズ（シッポで床をペシペシたたく）
const LYING = new Set(['loaf', 'side', 'belly', 'curl']);

// ---------- かたち（すべての猫で共有） ----------
let GEO = null;
const HIND = { thigh: 0.09, shin: 0.075, meta: 0.056 };
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function deform(geo, fn) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
  return geo;
}
function catGeometries() {
  if (GEO) return GEO;
  // 胴：単位球を、胸が深く、腰のくびれた、お尻の丸い猫の胴に（ポーズごとの大きさはこれに掛ける）
  const body = deform(new THREE.SphereGeometry(1, 32, 20), (v) => {
    const f = v.z;
    const waist = Math.exp(-(((f + 0.2) / 0.38) ** 2));
    v.x *= 1 - 0.12 * waist;
    if (v.y < 0) v.y *= 1 - 0.12 * waist;
    if (v.y < 0 && f > 0) v.y -= 0.14 * f * -v.y;        // 胸は深く
    if (v.y > 0 && f < 0) v.y += 0.07 * -f * v.y;          // 腰は少し高く
    if (v.y > 0) v.y *= 0.93;                              // 背中は少し平ら
    if (v.y > 0 && f > 0.45) v.y += 0.12 * (f - 0.45) * v.y; // 首のつけね
  });
  // 頭：横に広く、上は平ら、顔の前は平たく、ほおがふくらむ
  const skull = deform(new THREE.SphereGeometry(1, 28, 20), (v) => {
    const cheek = smooth(0.25, -0.35, v.y) * smooth(-0.2, 0.5, v.z);
    v.x *= 1.1 + 0.14 * cheek;
    if (v.y > 0) v.y *= 0.86;
    if (v.z > 0.55) v.z = 0.55 + (v.z - 0.55) * 0.45;       // 顔は平ら
    if (v.z < 0) v.z *= 1.06;
    v.multiplyScalar(0.075);
    v.y *= 0.96;
  });
  // 耳：前後につぶした三角。先は少し丸く、内側は桃色
  const earShape = (r, h) => deform(new THREE.ConeGeometry(r, h, 10, 3), (v) => {
    v.z *= 0.42;
    const t = (v.y + h / 2) / h;
    v.x *= 1 - 0.12 * Math.sin(t * Math.PI);
    if (v.z > 0) v.z *= 0.5;                                // 前はくぼみ
    v.y += h / 2;
  });
  const leg = deform(new THREE.CylinderGeometry(0.028, 0.019, 0.19, 12, 4), (v) => {
    const t = (0.095 - v.y) / 0.19;                          // 0 = つけね, 1 = 足先
    const thigh = 1 + 0.25 * (1 - smooth(0, 0.45, t));
    v.x *= thigh; v.z *= thigh;
    v.y -= 0.095;
  });
  // 後ろ足：太もも（横から見ると大きなしずく形）→すね→かかと（後ろ向きの関節）→足先。ピボットはそれぞれ上端
  const limb = (len, r0, r1, bulge = 0) => {
    const pts = [];
    for (let i = 0; i <= 5; i++) { const a = (i / 5) * Math.PI / 2; pts.push(new THREE.Vector2(r1 * Math.sin(a) + 1e-4, -len - r1 * Math.cos(a))); }
    for (let i = 1; i < 8; i++) { const t = 1 - i / 8; pts.push(new THREE.Vector2(lerp(r0, r1, t) * (1 + bulge * Math.sin(t * Math.PI)), -len * t)); }
    for (let i = 0; i <= 5; i++) { const a = (i / 5) * Math.PI / 2; pts.push(new THREE.Vector2(r0 * Math.cos(a) + 1e-4, r0 * Math.sin(a) * 0.8)); }
    return new THREE.LatheGeometry(pts, 12);
  };
  const thigh = limb(HIND.thigh, 0.05, 0.023, 0.15).scale(0.72, 1, 1);
  const shin = limb(HIND.shin, 0.021, 0.014);
  const meta = limb(HIND.meta, 0.0135, 0.0125);
  const segLen = 0.045;
  const tail = Array.from({ length: 6 }, (_, i) => {
    const g = new THREE.CylinderGeometry(0.0175 - i * 0.0011, 0.0195 - i * 0.0011, segLen + 0.01, 10);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, -segLen / 2);
    return g;
  });
  // 先は丸く
  const tailJoint = Array.from({ length: 6 }, (_, i) => new THREE.SphereGeometry(0.0195 - i * 0.0011, 10, 6));
  const tipCap = new THREE.SphereGeometry(0.0175 - 5 * 0.0011, 10, 6);
  tipCap.translate(0, 0, -segLen);
  GEO = {
    body, skull, tail, tailJoint, tipCap, leg, thigh, shin, meta,
    pad: new THREE.SphereGeometry(0.019, 14, 10),
    nose: deform(new THREE.ConeGeometry(0.0085, 0.009, 3), (v) => { v.z *= 0.6; }).rotateZ(Math.PI).rotateY(Math.PI),
    eye: new THREE.SphereGeometry(0.0135, 14, 10),
    itome: new THREE.TorusGeometry(0.0125, 0.0014, 6, 18, Math.PI * 0.7).rotateZ(Math.PI * 0.15),
    lid: new THREE.SphereGeometry(0.0148, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    pupil: new THREE.SphereGeometry(0.0085, 16, 12),
    glint: new THREE.SphereGeometry(0.0023, 6, 4),
    ear: earShape(0.038, 0.06),
    earInner: earShape(0.024, 0.042),
    paw: new THREE.SphereGeometry(0.026, 10, 8),
  };
  return GEO;
}

export class Cat {
  /**
   * @param opts.fixed 町の野良猫用。{ pos, pose: 'sit'|'loaf'|'curl', heading, level } で、
   *                   その場所から動かず、親密度も保存しない。
   */
  constructor(scene, opts = {}) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.listeners = {};
    this.fixed = opts.fixed || null;
    this.id = opts.id || 'home';
    this.coat = COATS[opts.coat] || COATS.chatora;
    this.affection = this._load();
    this.level = this.levelFor(this.affection);

    this._build();
    this.parts = { body: this.body, head: this.head, fl: this.legs.fl, fr: this.legs.fr, bl: this.legs.bl, br: this.legs.br, tail: this.tail };
    const spot = this._spot();
    this.cur = JSON.parse(JSON.stringify(POSES[spot.pose]));
    this.tailCur = TAIL_CURVES[spot.pose].map((a) => a.slice());
    this.poseName = spot.pose;
    this.root.position.copy(spot.pos);
    this.heading = this.fixed ? this.fixed.heading : Math.PI;
    this.path = [];
    this.walkPhase = 0;
    this.moving = false;
    this.hop = null;

    // 表情・反応
    this.lookTarget = new THREE.Vector3();
    this.lookWeight = 0;      // 0=前/遠く 1=カメラを見る
    this.glance = 0;          // 振り向く残り時間
    this.earsBack = 0;
    this.blink = 0;
    this.nextBlink = 2;
    this.slowBlink = 0;
    this.clickCooldown = 0;
    this.holdTime = 0;
    this.purr = 0;            // 0..1 ゴロゴロの強さ
    this.slapTimer = 1.5;
    this.slap = 0;
    this.bunt = 0;
    this.idleThought = 8;
    this.pendingLevel = null;
    // ひとりあそび：近づいてくる・寝転ぶ・ごろんとおなかを見せる・のびをする
    this.act = null;
    this.actTimer = 12 + Math.random() * 15;
    this.home = null;          // 近づいてきたあと、戻る場所
  }

  // ---------- ひとりあそび ----------
  /** 何をするか決める。player: 町の猫のときの、こちらの位置 */
  _chooseAct(camera, player) {
    const lv = this.level;
    const r = Math.random();
    if (this.fixed) {
      // 町の猫：そばでしゃがんでいると、懐いた猫は寄ってきて、寝転んだり、おなかを見せたりする
      if (!player || lv < 2) return null;
      const d = Math.hypot(player.x - this.root.position.x, player.z - this.root.position.z);
      if (d > 0.8 && d < 3.2 && r < 0.6) return { kind: 'approach', to: player };
      if (lv >= 3 && d < 1.4) return r < 0.5 ? { kind: 'side', dur: 7 + Math.random() * 6 } : { kind: 'belly', dur: 5 + Math.random() * 4 };
      return lv >= 3 && r < 0.8 ? { kind: 'stretch', dur: 2.4 } : null;
    }
    // 家の猫
    if (lv === 1) return null;
    if (lv === 4) return r < 0.25 ? { kind: 'stretch', dur: 2.6 } : null;   // ときどき起きてのび、また眠る
    if (r < (lv === 2 ? 0.55 : 0.35)) {
      const c = camera.position;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const to = new THREE.Vector3(clamp(c.x + fwd.x * 0.75, -1.2, 1.5), 0, clamp(c.z + fwd.z * 0.75, -1.0, 0.45));
      return { kind: 'approach', to };
    }
    if (lv >= 3) return r < 0.6 ? { kind: 'side', dur: 10 + Math.random() * 10 } : r < 0.85 ? { kind: 'belly', dur: 6 + Math.random() * 4 } : { kind: 'stretch', dur: 2.6 };
    return { kind: 'stretch', dur: 2.4 };
  }

  _startAct(act) {
    this.act = { ...act, t: 0 };
    if (act.kind === 'approach') {
      if (!this.home) this.home = this.root.position.clone();
      const p = this.root.position, to = act.to;
      // 相手の手前（40〜50cm）で止まる
      const dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz) || 1;
      const stop = this.fixed ? 0.5 : 0.08;
      const k = Math.max(0, d - stop) / d;
      this.path = [{ pos: new THREE.Vector3(p.x + dx * k, this.fixed ? p.y : 0, p.z + dz * k), mode: 'walk' }];
      this.act.dur = 6 + Math.random() * 6;   // 着いてから、そばにいる時間
      if (Math.random() < 0.6) this.emit('meow', this.level);
    }
    if (act.kind === 'belly' || act.kind === 'side') this.purr = Math.max(this.purr, 0.5);
  }

  /** あそびの最中のポーズ（null なら定位置のポーズ） */
  _actPose(dt, camera) {
    const a = this.act;
    if (!a) return null;
    if (a.kind === 'approach') {
      if (this.moving) return null;   // 歩いているあいだは stand
      a.t += dt;
      this.glance = Math.max(this.glance, 0.5);
      if (a.t < 1.2) this.bunt = Math.min(1, this.bunt + dt);   // 着いたら、すりすり
      if (a.t > a.dur) this._endAct();
      return this.level >= 3 && a.t > 3 ? 'loaf' : 'sit';
    }
    a.t += dt;
    if (a.t > a.dur) { this._endAct(); return null; }
    return a.kind;
  }

  _endAct() {
    const a = this.act;
    this.act = null;
    this.actTimer = (this.fixed ? 6 : 25) + Math.random() * (this.fixed ? 8 : 30);
    // 寄ってきた猫は、しばらくしたら元の場所へ（町の猫は、こちらが離れたら戻る）
    if (a?.kind === 'approach' && this.home && !this.fixed) {
      this.path = [{ pos: this.home.clone(), mode: 'walk' }];
      this.home = null;
    }
  }

  /** 町の猫：こちらが離れたら、元の場所へもどる */
  _returnHome() {
    if (!this.home || this.moving) return;
    this.act = null;
    this.path = [{ pos: this.home.clone(), mode: 'walk' }];
    this.home = null;
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, ...a) { (this.listeners[name] || []).forEach((fn) => fn(...a)); }

  _spot() {
    if (this.fixed) return { pos: this.fixed.pos, face: 'fixed', pose: this.fixed.pose };
    return SPOTS[this.level];
  }

  levelFor(a) {
    let lv = 1;
    LEVEL_THRESHOLDS.forEach((t, i) => { if (a >= t) lv = i + 1; });
    return lv;
  }

  _load() {
    // 町の猫は猫ごとに、はじめは出会ったときの懐き具合（fixed.level）から
    if (this.fixed) {
      const v = loadStrays()[this.id];
      return typeof v === 'number' ? v : LEVEL_THRESHOLDS[(this.fixed.level || 1) - 1];
    }
    try { return parseFloat(localStorage.getItem(STORAGE_KEY)) || 0; } catch { return 0; }
  }
  _save() {
    if (this.fixed) {
      const all = loadStrays();
      all[this.id] = +this.affection.toFixed(2);
      try { localStorage.setItem(STRAY_KEY, JSON.stringify(all)); } catch { /* ignore */ }
      return;
    }
    try { localStorage.setItem(STORAGE_KEY, this.affection.toFixed(2)); } catch { /* ignore */ }
  }
  reset() {
    this.affection = 0;
    this._save();
    this.level = 1;
    this.path = [];
    this.root.position.copy(SPOTS[1].pos);
    this.heading = Math.PI;
    this.poseName = 'sit';
  }

  /** 開発用：移動を省略して目的地へ */
  skipPath() {
    if (!this.path.length) return;
    this.root.position.copy(this.path[this.path.length - 1].pos);
    this.path = [];
    this.hop = null;
  }

  _build() {
    const coat = this.coat;
    const fur = new THREE.MeshStandardMaterial({ map: furTexture(coat, this.id), roughness: 0.95 });
    const furPlain = new THREE.MeshStandardMaterial({ color: coat.plain, roughness: 0.95 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2ebe0, roughness: 0.95 });
    const muzzleMat = coat.belly || coat.label === '白' ? white : furPlain;
    const dark = new THREE.MeshStandardMaterial({ color: coat.eye || 0x1a1410, roughness: 0.3 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xd88a8a, roughness: 0.6 });

    const G = catGeometries();
    this.body = new THREE.Mesh(G.body, fur);
    this.body.castShadow = true;
    this.root.add(this.body);

    // 頭：ほおの張った丸い頭に、ひげ袋（ω の形の口もと）、逆三角の鼻、大きめの目
    this.head = new THREE.Group();
    const face = new THREE.MeshStandardMaterial({ map: headTexture(coat, this.id), roughness: 0.95 });
    const skull = new THREE.Mesh(G.skull, face);
    skull.castShadow = true;
    const pads = [-1, 1].map((sx) => {
      const pad = new THREE.Mesh(G.pad, muzzleMat);
      pad.position.set(sx * 0.0135, -0.025, 0.051);
      pad.scale.set(0.88, 0.72, 0.7);
      return pad;
    });
    const chin = new THREE.Mesh(G.pad, muzzleMat);
    chin.position.set(0, -0.041, 0.043);
    chin.scale.set(0.65, 0.5, 0.6);
    const nose = new THREE.Mesh(G.nose, pink);
    nose.position.set(0, -0.0125, 0.0685);
    nose.rotation.x = -0.35;
    // 目は猫ごとに少しずつちがう（色・大きさ・瞳の太さ・まぶたの重さ・目じりの角度）
    const T = this.eyeTraits = eyeTraits(coat, this.id);
    const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lidMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(coat.patches ? coat.base : coat.base).multiplyScalar(coat.label === '黒' ? 1 : 0.88), roughness: 0.95 });
    const linerMat = new THREE.MeshStandardMaterial({ color: coat.label === '白' ? 0x8a6a5a : 0x2a1e18, roughness: 0.7 });
    this.eyes = [];
    this.lids = [];
    for (const sx of [-1, 1]) {
      // 目：色のついた虹彩に、瞳と、小さな光。ふちどりと、上まぶた
      const eye = new THREE.Group();
      eye.position.set(sx * 0.03, 0.005, 0.05);
      eye.rotation.set(0.08, sx * 0.32, sx * T.slant);
      eye.scale.set(T.size * T.wide, T.size, T.size * 0.4);
      const iris = new THREE.Mesh(G.eye, new THREE.MeshStandardMaterial({ color: sx < 0 ? T.irisL : T.irisR, roughness: 0.25 }));
      const liner = new THREE.Mesh(G.eye, linerMat);
      liner.scale.setScalar(1.07);
      liner.position.z = -0.0012;
      const pupil = new THREE.Mesh(G.pupil, dark);
      pupil.position.z = 0.0107;
      pupil.scale.set(T.pupil, 0.92, 0.42);
      const glint = new THREE.Mesh(G.glint, shine);
      glint.position.set(sx * -0.0035, 0.0045, 0.0118);
      glint.scale.setScalar(1.25);
      const glint2 = new THREE.Mesh(G.glint, shine);
      glint2.position.set(sx * 0.0035, -0.004, 0.012);
      glint2.scale.setScalar(0.55);
      if (T.itome) {
        // 糸目：目のかわりに、ゆるい弧の細い線
        const arc = new THREE.Mesh(G.itome, linerMat);
        arc.position.set(0, -0.0075, 0.0128);
        arc.scale.set(1, 0.55, 1);
        arc.rotation.z = -sx * T.droop * 0.5;
        eye.add(arc);
      } else {
        const lid = new THREE.Mesh(G.lid, lidMat);
        lid.rotation.z = -sx * T.droop;
        eye.add(liner, iris, pupil, glint, glint2, lid);
        this.lids.push(lid);
      }
      this.eyes.push(eye);
      const ear = new THREE.Mesh(G.ear, furPlain);
      ear.position.set(sx * 0.042, 0.052, -0.012);
      ear.rotation.set(-0.15, sx * 0.3, sx * -0.3);
      ear.userData.side = sx;
      this.head.add(ear);
      (this.ears ||= []).push(ear);
      const inner = new THREE.Mesh(G.earInner, pink);
      inner.position.set(0, 0.002, 0.004);
      ear.add(inner);
    }
    this.head.add(skull, ...pads, chin, nose, ...this.eyes);
    this.head.scale.setScalar(1.1);   // 頭は少し大きめに（そのほうが猫らしく、かわいい）
    this.root.add(this.head);

    // 脚（ピボットは上端）
    const legGeo = G.leg, pawGeo = G.paw;
    this.legs = {};
    this.hind = {};
    const pawMat = coat.belly || coat.label === '白' ? white : furPlain;
    for (const k of ['fl', 'fr', 'bl', 'br']) {
      const g = new THREE.Group();
      const paw = new THREE.Mesh(pawGeo, pawMat);
      paw.scale.set(1, 0.6, 1.3);
      if (k[0] === 'f') {
        const leg = new THREE.Mesh(legGeo, coat.belly ? white : furPlain);
        leg.castShadow = true;
        paw.position.y = -0.19;
        g.add(leg, paw);
      } else {
        // 後ろ足は関節つき：太もも → ひざ → すね → かかと → 足の甲 → 足先
        const lower = coat.whiteLegs && coat.belly ? white : furPlain;
        const thigh = new THREE.Group(), knee = new THREE.Group(), hock = new THREE.Group();
        const tm = new THREE.Mesh(G.thigh, fur), sm = new THREE.Mesh(G.shin, furPlain), mm = new THREE.Mesh(G.meta, lower);
        for (const m of [tm, sm, mm]) m.castShadow = true;
        knee.position.y = -HIND.thigh;
        hock.position.y = -HIND.shin;
        paw.position.set(0, -HIND.meta - 0.004, 0.012);
        thigh.add(tm, knee); knee.add(sm, hock); hock.add(mm, paw);
        g.add(thigh);
        this.hind[k] = { thigh, knee, hock, paw };
      }
      this.root.add(g);
      this.legs[k] = g;
    }

    // シッポ（6節のチェーン。各節は -z 方向に伸びる）
    this.tail = new THREE.Group();
    this.tailSegs = [];
    let parent = this.tail;
    const segLen = 0.045;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      const geo = G.tail[i];
      const m = new THREE.Mesh(geo, i === 5 ? new THREE.MeshStandardMaterial({ color: coat.tip }) : furPlain);
      m.castShadow = true;
      seg.add(m);
      if (i === 5) seg.add(new THREE.Mesh(G.tipCap, m.material));
      // 節のつなぎめを丸く
      if (i > 0) seg.add(new THREE.Mesh(G.tailJoint[i], m.material));
      if (i > 0) seg.position.z = -segLen;
      parent.add(seg);
      this.tailSegs.push(seg);
      parent = seg;
    }
    this.root.add(this.tail);

    // クリック判定用の見えない当たり
    this.hitbox = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 0.18;
    this.root.add(this.hitbox);
  }

  // ---------- 親密度 ----------
  addAffection(v) {
    this.affection = Math.max(0, this.affection + v);
    this._saveSoon();
    const lv = this.levelFor(this.affection);
    if (lv <= this.level) return;
    if (this.fixed) {
      this.level = lv;
      this.emit('levelup', lv, STRAY_LEVEL_TEXT[lv]);
      if (lv >= 2) this.emit('meow', lv);
    } else this._levelUp(lv);
  }
  // なでているあいだ毎フレーム保存しないよう、まとめて書く
  _saveSoon() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this._save(); }, 800);
  }

  _levelUp(lv) {
    const prev = this.level;
    this.level = lv;
    const target = SPOTS[lv];
    this.path = [];
    const p = this.root.position;
    if (prev === 1) {
      // 窓辺の内側の縁まで歩いて、ひょいと降りる
      this.path.push({ pos: new THREE.Vector3(p.x - 0.05, SILL_Y, -1.32), mode: 'walk' });
      this.path.push({ pos: new THREE.Vector3(p.x - 0.15, 0, -0.95), mode: 'hop' });
    }
    if (lv === 4) {
      this.path.push({ pos: new THREE.Vector3(target.pos.x, 0, target.pos.z - 0.32), mode: 'walk' });
      this.path.push({ pos: target.pos.clone(), mode: 'hop' });
    } else {
      this.path.push({ pos: target.pos.clone(), mode: 'walk' });
    }
    this.emit('levelup', lv, LEVEL_TEXT[lv]);
    if (lv >= 2) this.emit('meow', lv);
  }

  /** クリック（短く触れる） */
  poke() {
    this.idleThought = 10;
    if (this.clickCooldown > 0) {
      // 構いすぎ。警戒中は少し引かれる
      if (this.level === 1) {
        this.addAffection(-0.3);
        this.earsBack = 1.5;
        this.glance = 0;
        this.emit('flinch');
      }
      return;
    }
    this.clickCooldown = 1.1;
    this.addAffection(1);
    if (this.level === 1) {
      this.glance = 1.4;
      this.earsBack = 0.8;
      this.emit('notice', '……（ちらりと見て、また海を見ている）');
    } else if (this.level === 2) {
      this.glance = 3;
      this.emit('meow', 2);
    } else {
      this.slowBlink = 1.2;
      this.purr = Math.max(this.purr, 0.7);
      this.bunt = 1;
      if (Math.random() < 0.4) this.emit('meow', this.level);
    }
  }

  /** 長押し（なでる）。dt ごとに呼ばれる */
  stroke(dt) {
    this.idleThought = 10;
    this.holdTime += dt;
    if (this.moving) return;
    if (this.level === 1) {
      if (this.holdTime < 1.2) this.addAffection(dt * 0.35);
      else this.earsBack = Math.max(this.earsBack, 0.5);
      this.glance = Math.max(this.glance, 0.3);
    } else {
      this.addAffection(dt * 0.75);
      this.glance = Math.max(this.glance, 0.5);
      if (this.level >= 3) this.purr = Math.min(1, this.purr + dt * 0.8);
      if (this.level >= 2) this.bunt = Math.min(1, this.bunt + dt);
      // 長くなでていると、ごろんとおなかを見せる
      if (this.level >= 3 && this.holdTime > 2.5 && !this.act && !this.moving && this.level < 4) this._startAct({ kind: 'belly', dur: 5 + Math.random() * 3 });
    }
  }
  release() { this.holdTime = 0; }

  /** 町で、すぐそばにしゃがんでいるとき（idle: 操作していない秒数） */
  crouchedNear(dt, idle, player) {
    this.player = player;
    this.playerSeen = 0;
    this.glance = Math.max(this.glance, 0.4);          // こちらを見る
    this.addAffection(dt * (idle > 3 ? 0.18 : 0.08));  // 目線を合わせて待つと、少しずつ懐く
    if (idle > 3) {
      this.bunt = Math.min(0.6, this.bunt + dt * 0.3); // 鼻先を寄せる
      if (this.level >= 3) this.purr = Math.min(0.6, this.purr + dt * 0.2);
      if (this.slowBlink <= 0 && Math.random() < dt * 0.15) this.slowBlink = 1.2;
    }
  }

  /** 何もしないで、ただ眺めている時間も親密度になる */
  patience(dt, inView) {
    if (inView && !this.moving) this.addAffection(dt * 0.12);
  }

  // ---------- 毎フレーム ----------
  update(dt, elapsed, camera) {
    this.clickCooldown = Math.max(0, this.clickCooldown - dt);
    this.glance = Math.max(0, this.glance - dt);
    this.earsBack = Math.max(0, this.earsBack - dt);
    this.slowBlink = Math.max(0, this.slowBlink - dt);
    this.bunt = Math.max(0, this.bunt - dt * 0.6);

    // ひとりあそび
    if (this.fixed) {
      this.playerSeen = (this.playerSeen ?? 99) + dt;
      if (this.playerSeen > 2.5) { this.player = null; if (this.home) this._returnHome(); }
    }
    this.actTimer -= dt;
    if (!this.act && !this.path.length && this.actTimer <= 0 && this.holdTime === 0) {
      const act = this._chooseAct(camera, this.player);
      if (act) this._startAct(act);
      else this.actTimer = (this.fixed ? 3 : 15) + Math.random() * 10;
    }

    // 移動
    this.moving = this.path.length > 0;
    let poseName = this._spot().pose;
    const actPose = this._actPose(dt, camera);
    if (actPose) poseName = actPose;
    if (this.moving) {
      poseName = 'stand';
      this._followPath(dt);
    } else {
      // 定位置での向き
      const spot = this._spot();
      let targetHeading = this.heading;
      if (this.act?.kind === 'approach' || this.home) targetHeading = Math.atan2(camera.position.x - this.root.position.x, camera.position.z - this.root.position.z);
      else if (spot.face === 'fixed') targetHeading = this.fixed.heading;
      else if (spot.face === 'sea') targetHeading = Math.PI + 0.25;
      else if (spot.face === 'camera') targetHeading = Math.atan2(camera.position.x - this.root.position.x, camera.position.z - this.root.position.z);
      else targetHeading = -2.3;
      this.heading = this._dampAngle(this.heading, targetHeading, 2, dt);
    }
    this.root.rotation.y = this.heading;
    this.poseName = poseName;

    // ポーズのブレンド
    const target = POSES[poseName];
    const k = this.moving ? 8 : 3;
    for (const name in this.parts) {
      const c = this.cur[name], t = target[name];
      for (const key of ['p', 'r', 's', 'j']) {
        if (!t[key]) continue;
        for (let i = 0; i < 3; i++) c[key][i] = damp(c[key][i], t[key][i], k, dt);
      }
    }
    const tc = TAIL_CURVES[poseName];
    this.tailCur.forEach((seg, i) => { seg[0] = damp(seg[0], tc[i][0], 3, dt); seg[1] = damp(seg[1], tc[i][1], 3, dt); });

    this._applyPose();
    this._animate(dt, elapsed, camera);

    // ゴロゴロは時間とともにおさまる。Lv4 は寝息のような小さいゴロゴロ
    const basePurr = this.level === 4 && !this.moving ? 0.35 : 0;
    this.purr = Math.max(basePurr, this.purr - dt * 0.15);
    this.emit('purr', this.purr);

    // ときどき、ひとりごと
    this.idleThought -= dt;
    if (this.idleThought <= 0) {
      this.idleThought = 25 + Math.random() * 30;
      if (!this.moving && this.level >= 2 && this.level < 4 && Math.random() < 0.5) this.emit('meow', this.level);
    }
  }

  _dampAngle(a, b, lambda, dt) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * (1 - Math.exp(-lambda * dt));
  }

  _followPath(dt) {
    const wp = this.path[0];
    const p = this.root.position;
    if (wp.mode === 'hop') {
      if (!this.hop) this.hop = { from: p.clone(), t: 0 };
      this.hop.t += dt / 0.55;
      const t = clamp(this.hop.t, 0, 1);
      p.lerpVectors(this.hop.from, wp.pos, t);
      p.y = lerp(this.hop.from.y, wp.pos.y, t) + Math.sin(t * Math.PI) * 0.25;
      const dir = new THREE.Vector3().subVectors(wp.pos, this.hop.from);
      this.heading = this._dampAngle(this.heading, Math.atan2(dir.x, dir.z), 10, dt);
      if (t >= 1) { this.hop = null; this.path.shift(); this.emit('land'); }
      return;
    }
    const to = new THREE.Vector3().subVectors(wp.pos, p);
    to.y = 0;
    const dist = to.length();
    const speed = 0.4;
    if (dist < 0.02) {
      p.x = wp.pos.x; p.z = wp.pos.z;
      this.path.shift();
      return;
    }
    this.heading = this._dampAngle(this.heading, Math.atan2(to.x, to.z), 6, dt);
    const step = Math.min(dist, speed * dt);
    p.addScaledVector(to.normalize(), step);
    p.y = damp(p.y, wp.pos.y, 8, dt);
    this.walkPhase += dt * 9;
  }

  _applyPose() {
    const c = this.cur;
    for (const name in this.parts) {
      const obj = this.parts[name];
      const s = c[name];
      obj.position.set(s.p[0], s.p[1], s.p[2]);
      obj.rotation.set(s.r[0], s.r[1], s.r[2]);
      if (s.s) obj.scale.set(s.s[0], s.s[1], s.s[2]);
    }
    this.tailSegs.forEach((seg, i) => { seg.rotation.set(this.tailCur[i][0], this.tailCur[i][1], 0); });
    for (const k in this.hind) this._bendHind(k, 0);
  }

  /** 後ろ足の関節を曲げる。flex: 歩くときの、ひざ・かかとの追加の曲がり */
  _bendHind(k, flex) {
    const h = this.hind[k], j = this.cur[k].j;
    h.thigh.rotation.x = j[0] - flex * 0.35;
    h.knee.rotation.x = j[1] + flex * 0.7;
    h.hock.rotation.x = j[2] - flex * 0.35;
    // 足先は、いつも地面と平らに
    h.paw.rotation.x = -(this.legs[k].rotation.x + j[0] + j[1] + j[2]);
  }

  _animate(dt, elapsed, camera) {
    const breathe = Math.sin(elapsed * (this.level === 4 ? 1.6 : 2.4)) * 0.5 + 0.5;
    this.body.scale.y *= 1 + breathe * 0.04;
    this.body.scale.x *= 1 + breathe * 0.025;

    // 歩行
    if (this.moving && !this.hop) {
      const a = Math.sin(this.walkPhase) * 0.5;
      this.legs.fl.rotation.x = a; this.legs.br.rotation.x = a;
      this.legs.fr.rotation.x = -a; this.legs.bl.rotation.x = -a;
      // 後ろ足は、前へ振り出すときに、ひざとかかとを曲げる
      this._bendHind('bl', Math.max(0, Math.cos(this.walkPhase)));
      this._bendHind('br', Math.max(0, -Math.cos(this.walkPhase)));
      this.body.position.y += Math.abs(Math.cos(this.walkPhase)) * 0.008;
      this.head.position.y += Math.abs(Math.cos(this.walkPhase)) * 0.006;
    }

    // おなかを見せているときは、前足をくいくい
    if (this.poseName === 'belly') {
      this.legs.fl.rotation.x += Math.sin(elapsed * 3.1) * 0.25;
      this.legs.fr.rotation.x += Math.sin(elapsed * 2.7 + 1) * 0.25;
    }
    // 視線：Lv1 は基本的に遠くを見る。振り向き(glance)のときだけカメラを見る
    const wantsCamera = this.level === 4 ? 0 : (this.level === 1 ? (this.glance > 0 ? 1 : 0) : (this.moving ? 0.2 : 0.85));
    this.lookWeight = damp(this.lookWeight, wantsCamera, this.level === 1 ? 6 : 2.5, dt);
    if (this.poseName !== 'curl') {
      const local = this.root.worldToLocal(camera.position.clone());
      const headPos = this.head.position;
      const dx = local.x - headPos.x, dy = local.y - headPos.y, dz = local.z - headPos.z;
      let yaw = Math.atan2(dx, dz);
      yaw = clamp(yaw, -1.3, 1.3);
      const pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.6, 0.4);
      // 遠くを見るときのぼんやりした首振り
      const idleYaw = Math.sin(elapsed * 0.23) * 0.35;
      const idlePitch = -0.1 + Math.sin(elapsed * 0.17) * 0.05;
      this.head.rotation.y = lerp(idleYaw, yaw, this.lookWeight);
      this.head.rotation.x = lerp(idlePitch, pitch, this.lookWeight);
      // 首をかしげる・すりすり
      this.head.rotation.z = Math.sin(elapsed * 0.5) * 0.08 * (this.level >= 2 ? 1 : 0) + this.bunt * Math.sin(elapsed * 3) * 0.25;
      if (this.bunt > 0) this.head.position.z += this.bunt * 0.02;
    } else {
      this.head.rotation.x += Math.sin(elapsed * 1.6) * 0.03;
    }

    // 耳
    this.ears.forEach((ear) => {
      const side = ear.userData.side;
      const back = Math.min(1, this.earsBack);
      ear.rotation.z = side * (-0.3 - back * 0.9);
      ear.rotation.x = -0.15 - back * 0.5 + (Math.sin(elapsed * 7 + side) > 0.995 ? 0.3 : 0);
    });

    // まばたき（Lv3 以上はゆっくりまばたき＝信頼のサイン、Lv4 は眠っている）
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 0.15; this.nextBlink = 2 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt);
    let eyeOpen = this.blink > 0 ? 0.1 : 1;
    if (this.slowBlink > 0) eyeOpen = 0.15 + 0.85 * Math.abs(Math.cos((1 - this.slowBlink / 1.2) * Math.PI));
    if (this.level === 3 && this.purr > 0.5) eyeOpen = Math.min(eyeOpen, 0.45);
    if (this.poseName === 'curl') eyeOpen = 0.08;
    // ふだんは少しまぶたが下りている（猫ごとの重さ）。懐くほど、とろんとする
    const T = this.eyeTraits;
    const rest = T.itome ? 0.86 - (this.earsBack > 0 ? 0.25 : 0)
      : clamp(T.rest + (this.level - 2) * 0.05 - (this.earsBack > 0 ? 0.15 : 0), 0.08, 0.55);
    const closed = 1 - eyeOpen * (1 - rest);
    this.lidClose = damp(this.lidClose ?? closed, closed, 25, dt);
    // まぶたの縁の高さ（目の中心から上を +1）から、まぶたの回転へ
    const phi = -Math.asin(clamp(1 - 2 * this.lidClose, -1, 1));
    this.lids.forEach((l) => { l.rotation.x = phi; });

    // シッポ
    if (this.moving) {
      this.tailSegs.forEach((seg, i) => { seg.rotation.y += Math.sin(elapsed * 2 - i * 0.5) * 0.08; });
    } else if (this.level === 1) {
      // 警戒中：先っぽだけピクッ
      const flick = Math.max(0, Math.sin(elapsed * 1.3)) ** 8;
      this.tailSegs[4].rotation.x += flick * 0.6;
      this.tailSegs[5].rotation.x += flick * 0.8;
      if (this.earsBack > 0) this.tailSegs.forEach((seg, i) => { seg.rotation.y += Math.sin(elapsed * 14) * 0.1 * (i / 5); });
    } else if (LYING.has(this.poseName) && this.poseName !== 'curl' && this.level >= 2) {
      // 寝転んで、シッポで床をペシペシ（ためて、ぱしっ）
      this.slapTimer -= dt;
      if (this.slapTimer <= 0) {
        this.slap = 1;
        this.slapTimer = 0.6 + Math.random() * 1.4;
        this.emit('slap', this.root.position);
      }
      this.slap = Math.max(0, this.slap - dt * 4);
      const swing = Math.sin(this.slap * Math.PI);
      this.tailSegs.forEach((seg, i) => {
        seg.rotation.y += swing * (0.16 + i * 0.07);
        seg.rotation.x += swing * 0.14 * (i > 1 ? 1 : 0.3);
      });
    } else if (this.level === 2) {
      this.tailSegs.forEach((seg, i) => { seg.rotation.y += Math.sin(elapsed * 1.5 - i * 0.6) * 0.1; });
    } else if (this.level === 3) {
      // ペシペシ：ためて、ぱしっ
      this.slapTimer -= dt;
      if (this.slapTimer <= 0) {
        this.slap = 1;
        this.slapTimer = 0.9 + Math.random() * 1.8;
        this.emit('slap', this.root.position);
      }
      this.slap = Math.max(0, this.slap - dt * 3.5);
      const swing = Math.sin(this.slap * Math.PI) * 1.0;
      this.tailSegs.forEach((seg, i) => {
        seg.rotation.y += swing * (0.12 + i * 0.05) - 0.05;
        seg.rotation.x += swing * 0.08 * (i > 2 ? 1 : 0);
      });
    } else {
      const tip = Math.max(0, Math.sin(elapsed * 0.6)) ** 12;
      this.tailSegs[5].rotation.y += tip * 0.5;
    }
  }

  /** カメラから見えているか（「眺めている」判定用） */
  inView(camera) {
    const v = this.root.position.clone();
    v.y += 0.15;
    v.project(camera);
    return Math.abs(v.x) < 0.6 && Math.abs(v.y) < 0.7 && v.z < 1;
  }
}
