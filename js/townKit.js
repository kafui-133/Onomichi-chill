// 町づくりの小道具：看板の文字テクスチャ、四角形のまとめ描き、箱の InstancedMesh
import * as THREE from 'three';
import { canvasTexture } from './util.js';

export const lam = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

// 架空の屋号（実在の店名は使わない）
const SHOP_NAMES = [
  '中華そば 坂の上', '尾道ラーメン 汐', 'パン 潮風', 'ベーカリー こむぎ', '珈琲 汽笛', '喫茶 渡し舟',
  '帆布 いかり', '古本 坂道書房', '和菓子 ふね屋', '干物 浜田', '雑貨 しまなみ', '八百屋 みかん',
  '鮮魚 大漁', '酒店 灘', '茶舗 一服', '金物 かなめ', '時計店', '洋品店', '写真館 灯', '銭湯 波の湯',
  '甘味処 猫の手', '手ぬぐい 凪', 'レコード 灯台', '文具 とんぼ', '尾道ラーメン 坂', 'パン屋 あさなぎ',
  '喫茶 ロープウェイ', '帆布かばん', '練り物 ちくわ', 'たこ焼き', '薬局', '花屋 はっさく',
];
const SIGN_STYLES = [
  ['#2b2420', '#f2e6cc'], ['#f4efe4', '#2a2a2a'], ['#1f3b5a', '#f4efe4'], ['#7a2a22', '#f6ead8'],
  ['#e8dcc0', '#5a2a1a'], ['#2f4a3a', '#efe6cf'], ['#c9a050', '#2a1a10'], ['#ffffff', '#b02a20'],
];

/** 看板の文字を1枚のテクスチャにまとめる（1回の描画で全部の看板を描ける） */
export function buildSignAtlas() {
  const cols = 4, rows = 16, cw = 256, ch = 64;
  const tex = canvasTexture(cols * cw, rows * ch, (g) => {
    for (let i = 0; i < cols * rows; i++) {
      const name = SHOP_NAMES[i % SHOP_NAMES.length];
      const [bg, fg] = SIGN_STYLES[(i * 7 + Math.floor(i / SHOP_NAMES.length)) % SIGN_STYLES.length];
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      g.fillStyle = bg;
      g.fillRect(x, y, cw, ch);
      g.strokeStyle = fg;
      g.globalAlpha = 0.35;
      g.strokeRect(x + 4, y + 4, cw - 8, ch - 8);
      g.globalAlpha = 1;
      g.fillStyle = fg;
      g.font = '600 30px "Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(name, x + cw / 2, y + ch / 2 + 2, cw - 20);
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return {
    tex,
    uv: (i) => {
      const c = i % (cols * rows);
      const u0 = (c % cols) / cols, v1 = 1 - Math.floor(c / cols) / rows;
      return [u0 + 0.002, v1 - 1 / rows + 0.004, u0 + 1 / cols - 0.002, v1 - 0.004];
    },
  };
}

// 昭和の商店街の看板（架空の屋号）。横長の吊り看板と、縦長の電飾看板・のぼり
const RETRO_PLATES = [
  '婦人服 みなと洋品店', '坂井時計店', '人形専門店 マルミ玩具', 'ふじ屋呉服店', '中村電器商会', '肉の大和',
  'かもめ理容', '松屋寝具店', '潮風薬局', 'たちばな履物店', '汐見食堂', '岡田金物店', 'まるやま茶舗',
  '二葉写真館', 'はっさく文具', '浜田鮮魚店',
];
const PLATE_STYLES = [
  ['#f2cf2a', '#1e1a16', '#1e1a16'], ['#2f7a48', '#f6f2e6', '#f6f2e6'], ['#f6f2e8', '#c8262a', '#c8262a'],
  ['#b8282a', '#f6f0e2', '#f6f0e2'], ['#efe6c8', '#2a5a3a', '#2a5a3a'], ['#1f3f6a', '#f4efe4', '#f4efe4'],
];
const RETRO_VERTICAL = ['ヤマト靴', '麻雀', '電器', '理容', 'たばこ', 'くすり', '時計', 'サロン', '囲碁', '洋品', 'パーマ', '呉服', '甘味', '金物', '模型', '茶'];
const VERTICAL_STYLES = [['#efe0aa', '#c8202a'], ['#f6f4ee', '#2a7a42'], ['#f2cf2a', '#c8202a'], ['#f6f4ee', '#1f3f6a'], ['#e8a8b0', '#7a1a2a'], ['#2a5a8a', '#f6f2e6']];

/** 横長の吊り看板（16種）と縦長の看板（16種）を1枚にまとめる。上半分が横長、下半分が縦長 */
export function buildRetroSignAtlas() {
  const W = 1024, H = 1024;
  const tex = canvasTexture(W, H, (g) => {
    const font = (px) => `700 ${px}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`;
    // 横長：4列×8段（256×64）
    RETRO_PLATES.forEach((name, i) => {
      const x = (i % 4) * 256, y = Math.floor(i / 4) * 64;
      const [bg, fg, edge] = PLATE_STYLES[i % PLATE_STYLES.length];
      g.fillStyle = bg; g.fillRect(x, y, 256, 64);
      g.strokeStyle = edge; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, 248, 56);
      const [small, big] = name.includes(' ') ? name.split(' ') : ['', name];
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (small) { g.font = font(13); g.fillText(small, x + 128, y + 17, 230); }
      g.font = font(small ? 28 : 32); g.fillText(big, x + 128, y + (small ? 40 : 33), 232);
      // 古びた汚れ
      g.fillStyle = 'rgba(90,60,30,0.12)'; g.fillRect(x, y + 50, 256, 14);
    });
    // 縦長：16列（64×512）を下半分に
    RETRO_VERTICAL.forEach((name, i) => {
      const x = i * 64, y = 512;
      const [bg, fg] = VERTICAL_STYLES[i % VERTICAL_STYLES.length];
      g.fillStyle = bg; g.fillRect(x, y, 64, 512);
      g.strokeStyle = 'rgba(40,30,20,0.6)'; g.lineWidth = 3; g.strokeRect(x + 3, y + 3, 58, 506);
      const n = [...name].length;
      const size = Math.min(52, 440 / n);
      g.font = font(size); g.textAlign = 'center'; g.textBaseline = 'middle';
      [...name].forEach((ch, k) => {
        const cy = y + 256 + (k - (n - 1) / 2) * size * 1.12;
        g.lineWidth = 4; g.strokeStyle = '#1e1a16'; g.strokeText(ch, x + 32, cy);
        g.fillStyle = fg; g.fillText(ch, x + 32, cy);
      });
    });
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return {
    tex,
    plate: (i) => { const c = i % 16; const u0 = (c % 4) / 4, v1 = 1 - Math.floor(c / 4) * 64 / 1024; return [u0 + 0.002, v1 - 64 / 1024 + 0.002, u0 + 0.25 - 0.002, v1 - 0.002]; },
    vertical: (i) => { const c = i % 16; const u0 = c / 16; return [u0 + 0.002, 0.002, u0 + 1 / 16 - 0.002, 0.5 - 0.002]; },
  };
}

/** 1枚の看板・掲示用テクスチャ（大きな文字） */
export function labelTexture(text, { w = 512, h = 128, bg = '#2a2420', fg = '#f2e8d2', size = 64, vertical = false } = {}) {
  const tex = canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = `600 ${size}px "Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (vertical) {
      [...text].forEach((ch, i, arr) => g.fillText(ch, w / 2, h / 2 + (i - (arr.length - 1) / 2) * size * 1.05));
    } else {
      g.fillText(text, w / 2, h / 2 + size * 0.05, w - 24);
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** たくさんの四角形を1つのジオメトリにまとめる */
export class QuadBatch {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; }
  /** 法線が ±z または ±x を向く縦の四角形 */
  add(cx, cy, cz, w, h, facing, uv = [0, 0, 1, 1], color = [1, 1, 1]) {
    const n = this.pos.length / 3;
    const hw = w / 2, hh = h / 2;
    let corners;
    if (facing === 'z+') corners = [[cx - hw, cy - hh, cz], [cx + hw, cy - hh, cz], [cx + hw, cy + hh, cz], [cx - hw, cy + hh, cz]];
    else if (facing === 'z-') corners = [[cx + hw, cy - hh, cz], [cx - hw, cy - hh, cz], [cx - hw, cy + hh, cz], [cx + hw, cy + hh, cz]];
    else if (facing === 'x+') corners = [[cx, cy - hh, cz + hw], [cx, cy - hh, cz - hw], [cx, cy + hh, cz - hw], [cx, cy + hh, cz + hw]];
    else corners = [[cx, cy - hh, cz - hw], [cx, cy - hh, cz + hw], [cx, cy + hh, cz + hw], [cx, cy + hh, cz - hw]];
    corners.forEach((p) => { this.pos.push(...p); this.col.push(...color); });
    const [u0, v0, u1, v1] = uv;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  /** 任意の向きの縦の四角形。r=(rx,rz) は横方向の単位ベクトル（法線は r×上） */
  addOriented(cx, cy, cz, rx, rz, w, h, uv = [0, 0, 1, 1], color = [1, 1, 1]) {
    const n = this.pos.length / 3;
    const hw = w / 2, hh = h / 2;
    [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(([a, b]) => {
      this.pos.push(cx + rx * a, cy + b, cz + rz * a);
      this.col.push(...color);
    });
    const [u0, v0, u1, v1] = uv;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** 箱をまとめて InstancedMesh にする */
export function instancedBoxes(list, mat, { cast = true, receive = true, geo } = {}) {
  const mesh = new THREE.InstancedMesh(geo || new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  list.forEach((b, i) => {
    e.set(b.rx || 0, b.ry || 0, b.rz || 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.sx, b.sy, b.sz));
    mesh.setMatrixAt(i, m);
    if (b.color !== undefined) mesh.setColorAt(i, c.set(b.color));
  });
  mesh.count = list.length;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}


/**
 * 箱を 160m 四方のタイルごとの InstancedMesh に分けて並べる。
 * タイルごとに視野外を描かずに済むので、町全体に散らばるもの（石段・石垣・木・家）に使う。
 */
export function instancedChunks(list, mat, opts = {}, tile = 160) {
  const group = new THREE.Group();
  const bins = new Map();
  for (const b of list) {
    const k = Math.floor(b.x / tile) * 100003 + Math.floor(b.z / tile);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(b);
  }
  for (const items of bins.values()) group.add(instancedBoxes(items, mat, opts));
  return group;
}
