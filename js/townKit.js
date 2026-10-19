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
export function instancedChunks(list, mat, opts = {}, tile = opts.detail ? 100 : 320) {
  const group = new THREE.Group();
  const bins = new Map();
  for (const b of list) {
    const k = Math.floor(b.x / tile) * 100003 + Math.floor(b.z / tile);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(b);
  }
  for (const items of bins.values()) {
    const mesh = instancedBoxes(items, mat, opts);
    // 小物（opts.detail = 見える距離 m）：まとまりの中心と半径を覚えておき、遠いときは描かない
    if (opts.detail) {
      let cx = 0, cz = 0;
      for (const b of items) { cx += b.x; cz += b.z; }
      cx /= items.length; cz /= items.length;
      let rad = 0;
      for (const b of items) rad = Math.max(rad, Math.hypot(b.x - cx, b.z - cz));
      mesh.userData.detail = { x: cx, z: cz, r: rad, d: opts.detail };
    }
    group.add(mesh);
  }
  return group;
}

// 商店街の店の中（ガラス戸ごしに見える奥）：棚と品物、帳場、吊りの電灯。8種類（4列×2段、各256×192）
// 0 八百屋 1 雑貨 2 本屋 3 洋品店 4 お茶・乾物 5 帆布 6 駄菓子 7 金物
export const SHOP_INTERIOR_KINDS = 8;
export function buildShopInteriorAtlas() {
  const cols = 4, rows = 2, cw = 256, ch = 192;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const tex = canvasTexture(cols * cw, rows * ch, (g) => {
    for (let i = 0; i < cols * rows; i++) {
      const x0 = (i % cols) * cw, y0 = Math.floor(i / cols) * ch;
      g.save();
      g.beginPath(); g.rect(x0, y0, cw, ch); g.clip();
      // 奥の壁（あたたかい電灯の色）と床
      const wall = ['#d9c39a', '#cdb894', '#e0cfae', '#c9b08a', '#d4c4a4', '#cbb796', '#e2c99c', '#bfb5a2'][i];
      const grd = g.createLinearGradient(0, y0, 0, y0 + ch);
      grd.addColorStop(0, wall); grd.addColorStop(0.75, '#8a7458'); grd.addColorStop(1, '#5a4a3a');
      g.fillStyle = grd; g.fillRect(x0, y0, cw, ch);
      g.fillStyle = '#4a3c30'; g.fillRect(x0, y0 + ch * 0.86, cw, ch * 0.14);
      // 吊りの電灯
      for (const lx of [0.3, 0.72]) {
        g.fillStyle = '#fff4d8'; g.beginPath(); g.ellipse(x0 + cw * lx, y0 + 14, 16, 5, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,240,200,0.18)'; g.beginPath(); g.arc(x0 + cw * lx, y0 + 18, 46, 0, Math.PI * 2); g.fill();
      }
      const shelf = (y, colors, w, h, gap = 2) => {
        g.fillStyle = '#6a5038'; g.fillRect(x0 + 8, y + h, cw - 16, 5);
        for (let x = x0 + 12; x < x0 + cw - 12 - w; x += w + gap) { g.fillStyle = pick(colors); g.fillRect(x, y + (rnd() * 3), w, h - (rnd() * 3)); }
      };
      if (i === 0) {
        // 八百屋：ひな壇にざる、色とりどりの野菜と果物
        for (let r = 0; r < 3; r++) {
          const y = y0 + 70 + r * 36;
          g.fillStyle = '#7a5a36'; g.fillRect(x0 + 6, y + 18, cw - 12, 14);
          for (let x = x0 + 18; x < x0 + cw - 18; x += 30) {
            g.fillStyle = '#c8a46a'; g.beginPath(); g.ellipse(x, y + 18, 14, 6, 0, 0, Math.PI * 2); g.fill();
            const c = pick(['#e0662a', '#3a8a3a', '#c8302a', '#f0b020', '#6a3a7a', '#88b040', '#f08a1c']);
            g.fillStyle = c;
            for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x - 7 + k * 5, y + 12 - (k % 2) * 4, 5, 0, Math.PI * 2); g.fill(); }
          }
        }
      } else if (i === 2) {
        // 本屋：背表紙がならぶ本棚
        for (let r = 0; r < 4; r++) {
          const y = y0 + 34 + r * 34;
          g.fillStyle = '#5a4030'; g.fillRect(x0 + 8, y + 28, cw - 16, 4);
          for (let x = x0 + 10; x < x0 + cw - 12;) {
            const w = 4 + Math.floor(rnd() * 5);
            g.fillStyle = pick(['#a83a2a', '#2a4a7a', '#e8e0c8', '#3a6a4a', '#c8a050', '#6a4a7a', '#d8d0b8', '#1e2a3a']);
            g.fillRect(x, y + 4 + rnd() * 6, w, 24 - rnd() * 6);
            x += w + 1;
          }
        }
        g.fillStyle = '#6a4a30'; g.fillRect(x0 + 60, y0 + 140, 140, 30);
      } else if (i === 3) {
        // 洋品店：ハンガーにかかった服
        for (const ry of [40, 104]) {
          g.fillStyle = '#5a5a5a'; g.fillRect(x0 + 10, y0 + ry, cw - 20, 3);
          for (let x = x0 + 18; x < x0 + cw - 20; x += 15) {
            g.fillStyle = pick(['#c84a5a', '#3a5a8a', '#e8e4d8', '#6a8a5a', '#d8a050', '#4a4a5a', '#b8a0c8']);
            g.beginPath(); g.moveTo(x, y0 + ry + 4); g.lineTo(x + 13, y0 + ry + 4); g.lineTo(x + 15, y0 + ry + 52); g.lineTo(x - 2, y0 + ry + 52); g.closePath(); g.fill();
          }
        }
      } else if (i === 5) {
        // 帆布：つり下がったかばん（生成り・紺・からし・オリーブ）
        for (const ry of [36, 100]) {
          for (let x = x0 + 16; x < x0 + cw - 30; x += 36) {
            const c = pick(['#e8dcc0', '#2e3a5a', '#c89a3a', '#6a6a3a', '#a83a2a', '#d8ccb0']);
            g.strokeStyle = '#4a3a2a'; g.lineWidth = 2;
            g.beginPath(); g.arc(x + 14, y0 + ry + 8, 9, Math.PI, 0); g.stroke();
            g.fillStyle = c; g.fillRect(x, y0 + ry + 8, 28, 40);
            g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y0 + ry + 40, 28, 8);
          }
        }
      } else if (i === 6) {
        // 駄菓子：ガラスの瓶と、色とりどりの小袋
        for (let x = x0 + 14; x < x0 + cw - 30; x += 34) {
          g.fillStyle = 'rgba(220,235,240,0.6)'; g.fillRect(x, y0 + 110, 26, 34);
          g.fillStyle = pick(['#e04a6a', '#f0c020', '#5ab0e0', '#70c050', '#f08a30']);
          g.fillRect(x + 3, y0 + 122, 20, 20);
          g.fillStyle = '#d0302a'; g.fillRect(x + 2, y0 + 106, 22, 5);
        }
        shelf(y0 + 40, ['#e04a6a', '#f0c020', '#5ab0e0', '#70c050', '#f08a30', '#ffffff'], 12, 22);
        shelf(y0 + 72, ['#e04a6a', '#f0c020', '#5ab0e0', '#70c050', '#f08a30', '#ffffff'], 12, 22);
      } else if (i === 7) {
        // 金物：つり下がった鍋・やかん・道具
        for (const ry of [30, 92]) {
          g.fillStyle = '#4a4a4a'; g.fillRect(x0 + 10, y0 + ry, cw - 20, 3);
          for (let x = x0 + 22; x < x0 + cw - 20; x += 30) {
            g.fillStyle = pick(['#a8acb0', '#8a8e92', '#c8ccd0', '#6a6e72', '#b07a4a']);
            if (rnd() < 0.5) { g.beginPath(); g.arc(x, y0 + ry + 26, 12, 0, Math.PI * 2); g.fill(); }
            else g.fillRect(x - 4, y0 + ry + 4, 8, 40);
          }
        }
        g.fillStyle = '#7a6a5a'; g.fillRect(x0 + 10, y0 + 150, cw - 20, 18);
      } else {
        // 雑貨・お茶と乾物：棚にびっしりの箱・缶・袋
        const pal = i === 4 ? ['#2e5a3a', '#6a8a4a', '#c8b07a', '#3a3a30', '#b84a2a', '#e8dcc0'] : ['#c84a3a', '#e8c050', '#4a7ab0', '#e8e0d0', '#7aa04a', '#a07ac0', '#f09060'];
        for (let r = 0; r < 4; r++) shelf(y0 + 30 + r * 32, pal, i === 4 ? 16 : 11, 24, i === 4 ? 4 : 2);
      }
      // 帳場（手前の低い台）と、店の人の影
      g.fillStyle = 'rgba(70,52,38,0.85)'; g.fillRect(x0 + cw * 0.62, y0 + ch * 0.66, cw * 0.32, ch * 0.2);
      if (i % 3 === 1) { g.fillStyle = 'rgba(40,34,30,0.55)'; g.beginPath(); g.arc(x0 + cw * 0.78, y0 + ch * 0.5, 10, 0, Math.PI * 2); g.fill(); g.fillRect(x0 + cw * 0.78 - 13, y0 + ch * 0.55, 26, 24); }
      g.restore();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return {
    tex,
    uv: (k) => {
      const c = k % (cols * rows);
      const u0 = (c % cols) / cols, v1 = 1 - Math.floor(c / cols) / rows;
      return [u0 + 0.003, v1 - 1 / rows + 0.005, u0 + 1 / cols - 0.003, v1 - 0.005];
    },
  };
}
