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
