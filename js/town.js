// 歩ける尾道の町（実データ版）：地形・道・建物・線路・海岸線を OpenStreetMap と国土地理院の標高から組み立てる。
// 道は地形に沿う帯、急な小径は石段と石垣、商店街（本通り）はアーケードと店先、
// 線路と踏切、電車、千光寺山ロープウェイ、天寧寺の三重塔、艮神社、渡船のりば。
import * as THREE from 'three';
import { canvasTexture, glowTexture, seededRandom, speckle } from './util.js';
import { quality } from './quality.js';
import { lam, buildSignAtlas, buildRetroSignAtlas, labelTexture, QuadBatch, instancedBoxes, instancedChunks } from './townKit.js';
import {
  DATA, SEA_Y, BOUNDS, terrainY, groundY, surfaceY, addTread, addSolid, inSolid, walkable, ROADS, OTHER_ROADS, ARCADE_ROADS, nearAnyRoad, samplePath, roadLength, pointAlong,
  STREET_SHOPS, demAt, ALLEYS, COAST, RAILS, CROSSINGS, TRAIN_TRACKS, ROPEWAY, SUMMIT, BENCHES, FERRY_ROUTES, POIS, onOnomichiSide, nearestRoad, inBuilding,
} from './townMap.js';

const SURFACE_LIFT = { asphalt: 0.05, tile: 0.07, stone: 0.09 };

// Blender で作った3Dモデル（assets/models/*.glb。作り方は tools/blender/）。
// 読めないとき、または ?models=simple のときは、プログラムで組んだ簡単な形のまま
const USE_MODELS = typeof location === 'undefined' || new URLSearchParams(location.search).get('models') !== 'simple';
let gltfLoader = null;
async function loadModel(name) {
  if (!gltfLoader) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    gltfLoader = new GLTFLoader();
  }
  return (await gltfLoader.loadAsync(`assets/models/${name}.glb`)).scene;
}
/** 坂の下る向き（モデルの正面 +Z をこちらへ向けるための rotation.y） */
function downhillYaw(x, z, d = 4) {
  const gx = terrainY(x + d, z) - terrainY(x - d, z), gz = terrainY(x, z + d) - terrainY(x, z - d);
  return Math.atan2(-gx, -gz);
}

// 千光寺・艮神社の模型の中の長方形 [x0, x1, z0, z1]（正面 +Z）。道にかからないように置き、歩けない場所にする
const MODEL_RECTS = {
  senkoji: [[-5.8, 5.8, -4.8, 8.9], [8.8, 13.2, -2.4, 2.4], [-9, 6, -14, -6]],   // 本堂と舞台、鐘楼、裏の大岩
  ushitora: [[-4.2, 4.2, -3.2, 3.4], [-3.2, 3.2, -9.3, -3.2], [7.6, 10.4, -3.4, -0.6]], // 拝殿、本殿、楠の幹
};
/**
 * 模型の置き場所さがし：rects（模型の中の長方形 [x0, x1, z0, z1]、正面 +Z）が道にかからない位置と向き。
 * 向きは坂の下る向きを基本に、少しだけ振る。approach の点は道の上にあるほどよい
 */
function fitPlacement(x0, z0, rects, { maxShift = 20, approach = [] } = {}) {
  let best = null;
  for (let dx = -maxShift; dx <= maxShift; dx += 2) {
    for (let dz = -maxShift; dz <= maxShift; dz += 2) {
      const shift = Math.hypot(dx, dz);
      if (shift > maxShift) continue;
      const x = x0 + dx, z = z0 + dz;
      const down = downhillYaw(x, z, 6);
      for (const dy of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const yaw = down + dy, c = Math.cos(yaw), sn = Math.sin(yaw);
        const at = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
        let hits = 0;
        for (const [a, b, e, f] of rects) {
          for (let lx = a; lx <= b + 0.01; lx += 1.6) for (let lz = e; lz <= f + 0.01; lz += 1.6) if (nearAnyRoad(...at(lx, lz), 0.5)) hits++;
        }
        let onPath = 0;
        for (const [lx, lz] of approach) if (nearAnyRoad(...at(lx, lz), 0)) onPath++;
        const cost = hits * 10 - onPath * 6 + shift * 0.4 + Math.abs(dy) * 6;
        if (!best || cost < best.cost) best = { x, z, yaw, cost, hits };
      }
    }
  }
  return best;
}

const MODEL_FITS = (() => {
  const poi = (n) => POIS.find((q) => q.n === n);
  const out = {};
  const sk = poi('千光寺'), us = poi('艮神社');
  if (sk) out.senkoji = fitPlacement(sk.x, sk.z, MODEL_RECTS.senkoji, { maxShift: 24 });
  // 艮神社は、参道（鳥居から拝殿まで）が道の上にくるほどよい
  if (us) out.ushitora = fitPlacement(us.x, us.z, MODEL_RECTS.ushitora, { maxShift: 16, approach: [[0, 6], [0, 9], [0, 12]] });
  return out;
})();

// 名所の境内：まわりを埋める家や木を置かず、OpenStreetMap の小さな建物（境内のお堂など）も模型にまかせる
const PRECINCTS = [
  MODEL_FITS.senkoji && { ...MODEL_FITS.senkoji, r: 19 },
  MODEL_FITS.ushitora && { ...MODEL_FITS.ushitora, r: 18 },
  ...[['天寧寺三重塔', 9]].map(([n, r]) => { const p = POIS.find((q) => q.n === n); return p && { x: p.x, z: p.z, r }; }),
].filter(Boolean);
const inPrecinct = (x, z, m = 0) => PRECINCTS.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + m);

// 線路のまわり（4mのマスごとに線路の点をおぼえておく）。埋める家や木が線路の上に建たないように
const RAIL_CELL = 4;
const RAIL_GRID = (() => {
  const grid = new Map();
  for (const rail of RAILS) for (const p of samplePath(rail.pts, 2)) {
    const k = Math.floor(p.x / RAIL_CELL) * 100003 + Math.floor(p.z / RAIL_CELL);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  return grid;
})();
/** 線路の中心から m より近いか（m は 8m まで） */
function nearRail(x, z, m) {
  const r = Math.ceil(m / RAIL_CELL);
  const cx = Math.floor(x / RAIL_CELL), cz = Math.floor(z / RAIL_CELL);
  for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
    const list = RAIL_GRID.get(i * 100003 + j);
    if (list && list.some((p) => Math.hypot(p.x - x, p.z - z) < m)) return true;
  }
  return false;
}


// 本通り商店街の、食べられるお店（店名は架空）。f は通りの中での位置（0〜1）、side は通りのどちら側か
const SPECIAL_SHOPS = {
  '本町センター街': [{ f: 0.5, side: 1, type: 'ramen', name: '尾道ラーメン 汐' }, { f: 0.3, side: -1, type: 'kamaboko', name: 'かまぼこ 潮見' }],
  '中商店街': [{ f: 0.42, side: -1, type: 'bakery', name: 'パン 潮風' }, { f: 0.15, side: 1, type: 'ramen', name: '中華そば 坂の上' }],
  '一番街': [{ f: 0.55, side: 1, type: 'bakery', name: 'パン屋 あさなぎ' }, { f: 0.3, side: -1, type: 'cafe', name: '尾道マロン珈琲' }],
};
const VENDING_COLORS = [0xc8302a, 0x2a5aa8, 0xf2f0ea, 0x3a8a4a];

/**
 * 空き家の窓から見下ろす視界（南へ開いた扇形）に入るものの、許される高さの上限。
 * 窓辺の下端より上に出ると海が隠れてしまうので、近くの建物や木はそれより低く抑える。
 */
function viewCap(x, z) {
  if (z > -1 || z < -140) return Infinity;
  const ahead = -z;
  if (Math.abs(x) > ahead * 0.95 + 6) return Infinity;
  const dist = Math.hypot(x, z);
  return 1.08 - 0.28 * dist - 0.4;
}

/** 多角形の面積（符号つき） */
function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 三角形をためて1つのジオメトリにする（頂点色つき） */
/** 商店街のトタン：縦の波板に、さびと汚れ */
function arcadeTinTexture() {
  const r = seededRandom('tin');
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#c9c1ae';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(x, 0, 3, h);
      g.fillStyle = 'rgba(40,30,20,0.16)'; g.fillRect(x + 5, 0, 2, h);
    }
    for (let k = 0; k < 40; k++) {
      const x = r() * w, y = r() * h, rr = 2 + r() * 6;
      const grd = g.createRadialGradient(x, y, 0, x, y, rr);
      grd.addColorStop(0, `rgba(${Math.round(120 + r() * 40)},${Math.round(60 + r() * 20)},30,${(0.2 + r() * 0.2).toFixed(2)})`);
      grd.addColorStop(1, 'rgba(120,60,30,0)');
      g.fillStyle = grd; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    // さびの垂れ
    for (let k = 0; k < 22; k++) { g.fillStyle = `rgba(110,60,30,${(0.1 + r() * 0.15).toFixed(2)})`; g.fillRect(Math.floor(r() * 16) * 8 + 5, r() * h, 2, 20 + r() * 60); }
    g.fillStyle = 'rgba(60,50,40,0.18)'; g.fillRect(0, h - 10, w, 10);
  });
}

/** シャッター：細かい横のひだと、下の取っ手 */
function shutterTexture() {
  return canvasTexture(64, 128, (g, w, h) => {
    g.fillStyle = '#c8ccc6';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 5) {
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, y, w, 1);
      g.fillStyle = 'rgba(30,30,30,0.28)'; g.fillRect(0, y + 3, w, 1);
    }
    g.fillStyle = '#5a5e58'; g.fillRect(0, h - 7, w, 7);
    g.fillStyle = 'rgba(80,60,40,0.18)'; g.fillRect(0, h - 30, w, 23);
  });
}

class TriBatch {
  constructor() { this.pos = []; this.col = []; this.uv = []; }
  tri(a, b, c, color, uv) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
    if (uv) this.uv.push(...uv); else this.uv.push(0, 0, 0, 0, 0, 0);
  }
  quad(a, b, c, d, color, uv) {
    this.tri(a, b, c, color, uv ? [uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]] : null);
    this.tri(a, c, d, color, uv ? [uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]] : null);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

export class Town {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.r = seededRandom('onomichi-real');
    this.lampPositions = [];
    this.stationLanterns = [];
    this.nightMats = [];
    this.glowMats = [];   // 夜に灯るモデルの素材 { mat, base, add }
    this.occupied = new Set(); // 建物のある 4m マス
    this.interactables = [];   // 立ち寄れる場所（パン屋・ラーメン屋・自販機）
    this.specialSignMats = [];
    this.vendingMats = [];

    this._terrain();
    this._coastWalls();
    this._roads();
    this._steps();
    this._buildings();
    this._infill();
    this._trees();
    this._house();
    this._arcade();
    this._streetShops();
    this._rails();
    this._ropeway();
    this._landmarks();
    this._piersAndBenches();
    this._nekoStones();
    this._pine();
    this._vendingMachines();
    this._summitDeck();
    this._stationFront();
    this._lamps();
    this._train();
  }

  // ---------- 地形（5m メッシュ） ----------
  /**
   * 地形メッシュ。32×32 マスのタイルに分け、町なか（尾道側）は 5m、遠く（向島・山の奥）は 10m の細かさで作る。
   */
  _terrain() {
    const { x0, z0, step, nx, nz } = DATA.dem;
    const T = 32;
    const r = this.r;
    const c = new THREE.Color();
    const mat = lam(0xffffff, { vertexColors: true });
    const colorAt = (x, z, y) => {
      const above = y - SEA_Y;
      const slope = Math.abs(terrainY(x + 2.5, z) - terrainY(x - 2.5, z)) / 5 + Math.abs(terrainY(x, z + 2.5) - terrainY(x, z - 2.5)) / 5;
      if (above < -0.5) return c.setRGB(0.32, 0.36, 0.34);           // 海の底
      if (above < 7) return c.setRGB(0.5, 0.49, 0.46);                // 海沿いの平地（町なか）
      if (slope > 1.2) return c.setRGB(0.36, 0.33, 0.27);             // 崖・岩
      return c.setHSL(0.23 + r() * 0.05, 0.28, 0.2 + r() * 0.06 + Math.min(0.06, above / 2500));
    };
    for (let tj = 0; tj < nz - 1; tj += T) {
      for (let ti = 0; ti < nx - 1; ti += T) {
        const cx = x0 + (ti + T / 2) * step, cz = z0 + (tj + T / 2) * step;
        const near = Math.abs(cx) < 760 && cz > -760 && onOnomichiSide(cx, cz + 60);
        const m = near ? 1 : 2;
        const ci = Math.min(T, nx - 1 - ti), cj = Math.min(T, nz - 1 - tj);
        const vx = Math.floor(ci / m) + 1, vz = Math.floor(cj / m) + 1;
        const pos = new Float32Array(vx * vz * 3), col = new Float32Array(vx * vz * 3);
        for (let j = 0; j < vz; j++) {
          for (let i = 0; i < vx; i++) {
            const k = j * vx + i;
            const x = x0 + (ti + Math.min(ci, i * m)) * step, z = z0 + (tj + Math.min(cj, j * m)) * step;
            const y = terrainY(x, z);
            pos[k * 3] = x; pos[k * 3 + 1] = y - 0.15; pos[k * 3 + 2] = z;
            colorAt(x, z, y);
            col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
          }
        }
        const idx = [];
        for (let j = 0; j < vz - 1; j++) {
          for (let i = 0; i < vx - 1; i++) {
            const a = j * vx + i, b = a + 1, cc = a + vx, d = cc + 1;
            idx.push(a, cc, b, b, cc, d);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
  }

  /** 海岸線にそって、岸壁（コンクリートの垂直な壁）を立てる */
  _coastWalls() {
    const tb = new TriBatch(), deck = new TriBatch();
    const c = new THREE.Color(0x8e8a80), deckC = new THREE.Color(0.52, 0.51, 0.48), capC = new THREE.Color(0xb4b0a6);
    // 水ぎわの、消波ブロックを並べたような模様の帯（長さに沿って模様をくり返す）
    const blockPos = [], blockUv = [];
    let run = 0;
    for (const line of COAST) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1];
        if (ax < BOUNDS.x0 || ax > BOUNDS.x1 || az < BOUNDS.z0 || az > BOUNDS.z1) continue;
        const ta = Math.max(SEA_Y + 1.6, groundY(ax, az)), tbb = Math.max(SEA_Y + 1.6, groundY(bx, bz));
        tb.quad([ax, SEA_Y - 3, az], [bx, SEA_Y - 3, bz], [bx, tbb, bz], [ax, ta, az], c);
        // 岸壁の上の、明るいコンクリートの笠石（低い胸壁）
        if (ta - SEA_Y < 9) tb.quad([ax, ta - 0.05, az], [bx, tbb - 0.05, bz], [bx, tbb + 0.45, bz], [ax, ta + 0.45, az], capC);
        const segL = Math.hypot(bx - ax, bz - az);
        if (segL > 0.01 && ta - SEA_Y < 9) {
          // 海側へ少し出した帯（両面）
          const sx = (bz - az) / segL * 0.12, sz = -(bx - ax) / segL * 0.12;
          const u0 = run / 2.4, u1 = (run + segL) / 2.4;
          const y0 = SEA_Y - 0.6, y1 = SEA_Y + 1.25;
          blockPos.push(ax + sx, y0, az + sz, bx + sx, y0, bz + sz, bx + sx, y1, bz + sz, ax + sx, y0, az + sz, bx + sx, y1, bz + sz, ax + sx, y1, az + sz);
          blockUv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
          run += segL;
        }
        // 岸壁の上の、平らなコンクリートの帯（標高のマス目で海へ下がって見えるところを覆う）
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01 || ta - SEA_Y > 9) continue;
        let nx = -(bz - az) / len, nz = (bx - ax) / len;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (terrainY(mx + nx * 6, mz + nz * 6) < terrainY(mx - nx * 6, mz - nz * 6)) { nx = -nx; nz = -nz; } // 陸のほうへ
        const W = 5;
        const ia = [ax + nx * W, groundY(ax + nx * W, az + nz * W) + 0.03, az + nz * W];
        const ib = [bx + nx * W, groundY(bx + nx * W, bz + nz * W) + 0.03, bz + nz * W];
        deck.quad([ax, ta + 0.03, az], ia, ib, [bx, tbb + 0.03, bz], deckC);
      }
    }
    const m = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    this.group.add(m);
    if (blockPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(blockPos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(blockUv, 2));
      g.computeVertexNormals();
      const tex = canvasTexture(128, 64, (g2, w, h) => {
        g2.fillStyle = '#6f6c66';
        g2.fillRect(0, 0, w, h);
        // 互い違いに並んだ、くぼみのあるブロック
        for (let row = 0; row < 3; row++) {
          for (let col = -1; col < 5; col++) {
            const x = col * 32 + (row % 2) * 16, y = row * 22 + 2;
            g2.fillStyle = row === 0 ? '#5a5853' : '#8a867e';
            g2.beginPath(); g2.moveTo(x + 4, y); g2.lineTo(x + 28, y); g2.lineTo(x + 30, y + 18); g2.lineTo(x + 2, y + 18); g2.closePath(); g2.fill();
            g2.fillStyle = '#4a4844';
            g2.fillRect(x + 12, y + 6, 8, 7);
          }
        }
        // 水につかる下のほうは、暗く濡れた色
        const grd = g2.createLinearGradient(0, h, 0, h * 0.55);
        grd.addColorStop(0, 'rgba(40,46,44,0.85)');
        grd.addColorStop(1, 'rgba(40,46,44,0)');
        g2.fillStyle = grd;
        g2.fillRect(0, 0, w, h);
      });
      tex.wrapT = THREE.ClampToEdgeWrapping;
      const bm = new THREE.Mesh(g, lam(0xffffff, { map: tex, side: THREE.DoubleSide }));
      bm.receiveShadow = true;
      this.group.add(bm);
    }
    const dm = new THREE.Mesh(deck.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -1 }));
    dm.receiveShadow = true;
    this.group.add(dm);
  }

  // ---------- 道（地形に沿う帯） ----------
  _texture(kind) {
    const r = seededRandom('tex' + kind);
    return canvasTexture(256, 256, (g, w, h) => {
      if (kind === 'asphalt') {
        // アスファルト：細かい粒と、両端の白線（u=0..1 が道の幅）
        g.fillStyle = '#56575b';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 3000, 0.12, r);
        g.fillStyle = 'rgba(236,232,220,0.85)';
        g.fillRect(6, 0, 5, h);
        g.fillRect(w - 11, 0, 5, h);
        g.fillStyle = 'rgba(40,40,44,0.5)';
        g.fillRect(0, 0, 4, h);
        g.fillRect(w - 4, 0, 4, h);
      } else if (kind === 'tile') {
        // 商店街・広場のタイル（1マス＝0.5m）
        g.fillStyle = '#bcb19c';
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          const v = 175 + r() * 25;
          g.fillStyle = `rgb(${v},${v - 9},${v - 28})`;
          g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
        }
        speckle(g, w, h, 900, 0.06, r);
      } else {
        // 石畳・石段の小径：割り石と目地（u=0..1 が道の幅、両端に縁石）
        g.fillStyle = '#6d675e';
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 26) {
          let x = 22 + ((y / 26) % 2) * 18;
          while (x < w - 22) {
            const sw = 28 + r() * 30;
            const v = 135 + r() * 40;
            g.fillStyle = `rgb(${v},${v - 4},${v - 14})`;
            g.fillRect(x + 1.5, y + 1.5, Math.min(sw, w - 22 - x) - 3, 23);
            x += sw;
          }
        }
        g.fillStyle = '#8e887c';
        g.fillRect(0, 0, 20, h);
        g.fillRect(w - 20, 0, 20, h);
        speckle(g, w, h, 1500, 0.08, r);
      }
    });
  }

  /** 道：地面メッシュと同じ高さ（三角形補間）に、細かく分けた帯を少し浮かせて敷く */
  _roads() {
    const mk = (kind, f) => new THREE.MeshLambertMaterial({ map: this._texture(kind), polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f * 2 });
    const mats = { asphalt: mk('asphalt', -1), tile: mk('tile', -2), stone: mk('stone', -3) };
    const batches = { asphalt: new TriBatch(), tile: new TriBatch(), stone: new TriBatch() };
    const white = new THREE.Color(1, 1, 1);
    // v 方向（道の長さ）の模様の大きさ
    const vScale = { asphalt: 8, tile: 2, stone: 1.6 };
    for (const road of [...ROADS, ...OTHER_ROADS]) {
      const tb = batches[road.surface];
      const lift = SURFACE_LIFT[road.surface];
      const hw = road.width / 2;
      const across = Math.max(1, Math.ceil(road.width / 2.2));
      const s = samplePath(road.pts, 1.25);
      const uMax = road.surface === 'tile' ? road.width / 2 : 1;
      let v = 0;
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        const v1 = v + L / vScale[road.surface];
        const na = { x: -Math.sin(a.angle), z: Math.cos(a.angle) }, nb = { x: -Math.sin(b.angle), z: Math.cos(b.angle) };
        for (let k = 0; k < across; k++) {
          const o0 = -hw + (road.width * k) / across, o1 = -hw + (road.width * (k + 1)) / across;
          const P = (p, n, o) => { const x = p.x + n.x * o, z = p.z + n.z * o; return [x, groundY(x, z) + lift, z]; };
          const u0 = (k / across) * uMax, u1 = ((k + 1) / across) * uMax;
          // 上を向く面になる順番（左→右→右先→左先）
          tb.quad(P(a, na, o0), P(a, na, o1), P(b, nb, o1), P(b, nb, o0), white, [u0, v, u1, v, u1, v1, u0, v1]);
        }
        v = v1;
      }
    }
    for (const k of Object.keys(batches)) {
      const m = new THREE.Mesh(batches[k].build(), mats[k]);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /**
   * 石段：蹴上げ約17cm ごとに水平な踏み面を置く本物の階段にする。
   * 階段（steps）は全部、ふつうの小径でも勾配がしばらく急なところ（約1/6より急が3m以上）だけ段にする。
   * 曲がり角では段を切って、踏み面が道からはみ出さないようにする。
   * 道の両わきは、斜面の高いほうに石垣、低いほうが崖なら低い塀。高さはなめらかにつなぐ。
   */
  _steps() {
    const RISE = 0.17;
    const STEP = 0.1;
    const treads = [], rails = [], lanterns = [];
    const walls = new TriBatch();
    this.stepLanterns = lanterns;
    const r = this.r;
    for (const road of ROADS) {
      if (road.surface !== 'stone') continue;
      const s = samplePath(road.pts, STEP);
      if (s.length < 4) continue;
      const H = s.map((p) => groundY(p.x, p.z));
      // 横に傾いた道でも踏み面が埋もれないよう、両端の高さも見る
      const hw = road.width / 2 - 0.05;
      const Hx = s.map((p, i) => Math.max(H[i], groundY(p.x - Math.sin(p.angle) * hw, p.z + Math.cos(p.angle) * hw), groundY(p.x + Math.sin(p.angle) * hw, p.z - Math.cos(p.angle) * hw)));
      // 急かどうか（前後 2m の平均勾配）。ふつうの小径は 3m 以上続くところだけ
      const W = 20;
      const grade = s.map((_, i) => {
        const j = Math.min(s.length - 1, i + W), k = Math.max(0, i - W);
        return Math.abs(H[j] - H[k]) / Math.max(0.5, (j - k) * STEP);
      });
      const steep = s.map((_, i) => road.kind === 'steps' || grade[i] > 0.16);
      if (road.kind !== 'steps') {
        let i = 0;
        while (i < s.length) {
          if (!steep[i]) { i++; continue; }
          let j = i;
          while (j < s.length && steep[j]) j++;
          if ((j - i) * STEP < 3) for (let k = i; k < j; k++) steep[k] = false;
          i = j;
        }
      }
      let start = -1, base = 0, flights = 0;
      const flush = (i0, i1) => {
        if (i1 - i0 < 2) return;
        const a = s[i0], b = s[i1];
        let top = -Infinity;
        for (let k = i0; k <= i1; k++) top = Math.max(top, Hx[k]);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const v = 0.43 + r() * 0.05;
        const ang = Math.atan2(b.z - a.z, b.x - a.x);
        treads.push({ x: (a.x + b.x) / 2, y: top + 0.03 - 0.3, z: (a.z + b.z) / 2, sx: len + 0.02, sy: 0.6, sz: road.width - 0.1, ry: -ang,
          color: new THREE.Color(v, v * 0.97, v * 0.9) });
        addTread((a.x + b.x) / 2, (a.z + b.z) / 2, len + 0.02, road.width - 0.1, ang, top + 0.03);
        flights++;
      };
      const turn = (i, j) => Math.abs(((s[j].angle - s[i].angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      for (let i = 0; i < s.length; i++) {
        if (!steep[i]) {
          if (start >= 0) { flush(start, i - 1); start = -1; }
          continue;
        }
        if (start < 0) { start = i; base = H[i]; continue; }
        if (Math.abs(H[i] - base) >= RISE || turn(start, i) > 0.2 || (i - start) * STEP > 3) { flush(start, i); start = i; base = H[i]; }
      }
      if (start >= 0) flush(start, s.length - 1);

      // 石段の端の小さな石灯籠（間隔をあけて、片側ずつ交互に）
      if (flights && (road.kind === 'steps' || flights > 12)) {
        const spots = samplePath(road.pts, 14 + r() * 6);
        spots.forEach((p, i) => {
          if (i === 0) return;
          const k = Math.min(s.length - 1, Math.round((i / spots.length) * s.length));
          if (!steep[k]) return;
          const side = i % 2 ? 1 : -1;
          const off = road.width / 2 - 0.18;
          const x = p.x - Math.sin(p.angle) * side * off, z = p.z + Math.cos(p.angle) * side * off;
          lanterns.push({ x, z, ry: -p.angle });
        });
      }

      // 両わきの石垣・塀：1m おきに高さを決め、ならしてから、ひと続きの壁にする
      const c = samplePath(road.pts, 1);
      const len = roadLength(road.pts);
      for (const side of [-1, 1]) {
        const off = road.width / 2 + 0.05;
        const pts = c.map((p, i) => {
          const nx = -Math.sin(p.angle) * side, nz = Math.cos(p.angle) * side;
          const x = p.x + nx * off, z = p.z + nz * off;
          const y = groundY(p.x, p.z);
          const beside = terrainY(p.x + nx * (off + 1.2), p.z + nz * (off + 1.2));
          const along = Math.min(i, c.length - 1 - i); // 道の端からの距離（m）
          // 交差点・道の端の近くには建てない
          const other = nearAnyRoad(x + nx * 0.4, z + nz * 0.4, 0.6);
          const shopFront = STREET_SHOPS.some((sh) => Math.hypot(sh.fx - x, sh.fz - z) < 3.4);
          const free = along > 1.5 && !(other && other !== road) && !shopFront;
          let top = null;
          if (free && beside - y > 0.35) top = Math.min(beside, y + 2.6) + 0.15; // 石垣（山側）
          else if (free && y - beside > 1.0 && road.kind === 'steps') top = y + 0.55; // 低い塀（谷側）
          return { x, z, y, nx, nz, top };
        });
        // 高さを前後でならす（ギザギザにしない）
        const tops = pts.map((p, i) => {
          if (p.top === null) return null;
          let sum = 0, n = 0;
          for (let k = i - 2; k <= i + 2; k++) if (pts[k] && pts[k].top !== null) { sum += pts[k].top; n++; }
          return Math.max(p.y + 0.4, sum / n);
        });
        const g = 0.42 + r() * 0.06;
        const face = new THREE.Color(g * 1.03, g, g * 0.88), cap = new THREE.Color(g * 1.15, g * 1.12, g);
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          if (tops[i] === null || tops[i + 1] === null) continue;
          const T = 0.35;
          const A0 = [a.x, a.y - 0.3, a.z], B0 = [b.x, b.y - 0.3, b.z];
          const A1 = [a.x, tops[i], a.z], B1 = [b.x, tops[i + 1], b.z];
          const A2 = [a.x + a.nx * T, tops[i], a.z + a.nz * T], B2 = [b.x + b.nx * T, tops[i + 1], b.z + b.nz * T];
          const A3 = [a.x + a.nx * T, a.y - 1.5, a.z + a.nz * T], B3 = [b.x + b.nx * T, b.y - 1.5, b.z + b.nz * T];
          walls.quad(A0, B0, B1, A1, face);
          walls.quad(A1, B1, B2, A2, cap);
          walls.quad(A2, B2, B3, A3, face);
          // 途切れるところは端をふさぐ
          if (i === 0 || tops[i - 1] === null) walls.quad(A0, A1, A2, A3, face);
          if (i === pts.length - 2 || tops[i + 2] === null) walls.quad(B0, B3, B2, B1, face);
        }
      }

      // 長い石段の手すり（まん中に1本）
      if (road.kind === 'steps' && road.width >= 1.6 && len > 8) {
        const coarse = samplePath(road.pts, 2);
        coarse.forEach((a, i) => {
          if (i === coarse.length - 1) return;
          const b = coarse[i + 1];
          const ya = groundY(a.x, a.z), yb = groundY(b.x, b.z);
          const rise = yb - ya;
          rails.push({ x: (a.x + b.x) / 2, y: (ya + yb) / 2 + 0.9, z: (a.z + b.z) / 2, sx: Math.hypot(a.len, rise), sy: 0.05, sz: 0.05, ry: -a.angle, rz: Math.atan2(rise, a.len), color: '#3a3f44' });
          if (i % 2 === 0) rails.push({ x: a.x, y: ya + 0.45, z: a.z, sx: 0.05, sy: 0.9, sz: 0.05, ry: -a.angle, color: '#3a3f44' });
        });
      }
    }
    this.group.add(instancedChunks(treads, lam(0xffffff)));
    const wm = new THREE.Mesh(walls.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    wm.receiveShadow = true;
    wm.castShadow = true;
    this.group.add(wm);
    this.group.add(instancedChunks(rails, lam(0xffffff), { receive: false }));
    // 灯籠は、踏み面がぜんぶ置けてから、その上に立てる
    lanterns.forEach((l) => { l.y = surfaceY(l.x, l.z); });
    this._lanterns(lanterns);
  }

  /** 高さ50cmほどの小さな石灯籠。夜は火袋がぼんやり灯る */
  _lanterns(list) {
    const stone = lam(0x8f897d);
    const parts = { base: [], post: [], box: [], cap: [] };
    for (const l of list) {
      parts.base.push({ x: l.x, y: l.y + 0.05, z: l.z, sx: 0.26, sy: 0.1, sz: 0.26, ry: l.ry });
      parts.post.push({ x: l.x, y: l.y + 0.2, z: l.z, sx: 0.1, sy: 0.22, sz: 0.1, ry: l.ry });
      parts.box.push({ x: l.x, y: l.y + 0.38, z: l.z, sx: 0.2, sy: 0.14, sz: 0.2, ry: l.ry });
      parts.cap.push({ x: l.x, y: l.y + 0.5, z: l.z, sx: 0.32, sy: 0.08, sz: 0.32, ry: l.ry + Math.PI / 4 });
    }
    this.group.add(instancedChunks(parts.base, stone), instancedChunks(parts.post, stone), instancedChunks(parts.cap, stone));
    // 火袋（夜に灯る部分）
    this.lanternMat = new THREE.MeshLambertMaterial({ color: 0x8f897d, emissive: 0xff8f3a, emissiveIntensity: 0 });
    this.group.add(instancedChunks(parts.box, this.lanternMat, { cast: false }));
    // 足もとをほのかに照らす光の粒（夜だけ見える）
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap((l) => [l.x, l.y + 0.4, l.z]), 3));
    this.lanternGlow = new THREE.PointsMaterial({ map: glowTexture(), color: 0xff8a3c, size: 0.9, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new THREE.Points(geo, this.lanternGlow));
  }

  // ---------- 建物（OpenStreetMap の輪郭を立ち上げる） ----------
  _buildings() {
    const tbTown = new TriBatch(), tbStation = new TriBatch();
    const facadeWin = [], facadeSlab = [];
    const maxFacade = Math.round(16000 * quality.s.people);
    let tb = tbTown;
    // 駅舎（いちばん大きい駅の輪郭）は、Blender のモデルに差しかえられるよう別にまとめる
    const polyOf = (b) => { const a = []; for (let k = 0; k < b.p.length; k += 2) a.push([b.p[k], b.p[k + 1]]); return a; };
    const mainStation = DATA.buildings.filter((b) => b.k === 'train_station').sort((a, b) => Math.abs(signedArea(polyOf(b))) - Math.abs(signedArea(polyOf(a))))[0];
    this.stationPoly = mainStation ? polyOf(mainStation) : null;
    const r = this.r;
    const walls = ['#e6e0d4', '#d6cebd', '#cbc3b2', '#6f5a47', '#5c4b3d', '#efe9df', '#bdb5a6', '#d8d4cc'];
    const roofTile = new THREE.Color('#4b5159'), roofFlat = new THREE.Color('#8d8a85');
    const winList = [];
    const alleyPts = [];
    for (const al of ALLEYS) for (const p of samplePath(al.pts, 0.8)) {
      for (const o of [-0.7, 0, 0.7]) alleyPts.push([p.x - Math.sin(p.angle) * o, p.z + Math.cos(p.angle) * o]);
    }
    for (const b of DATA.buildings) {
      if (b.k === 'pagoda') continue; // 三重塔は模型で置く
      if (b.n === '展望台') continue;  // 頂上の展望台は、見晴らしのデッキとして別に作る
      tb = b === mainStation ? tbStation : tbTown;
      const poly = [];
      for (let k = 0; k < b.p.length; k += 2) poly.push([b.p[k], b.p[k + 1]]);
      if (poly.length < 3) continue;
      // 商店街の路地がふさがれないように、路地にかかる建物は置かない
      if (alleyPts.some(([x, z]) => pointInPoly(x, z, poly))) continue;
      const area = Math.abs(signedArea(poly));
      if (area < 400 && inPrecinct(poly.reduce((s2, q) => s2 + q[0], 0) / poly.length, poly.reduce((s2, q) => s2 + q[1], 0) / poly.length)) continue;
      if (area < 4) continue;
      const ys = poly.map(([x, z]) => terrainY(x, z));
      const yMin = Math.min(...ys), yMax = Math.max(...ys);
      if (yMax < SEA_Y + 0.3) continue;
      let h = b.h;
      if (!h) h = area < 60 ? 5.5 + r() * 1.5 : area < 220 ? 6.5 + r() * 3 : area < 900 ? 9 + r() * 6 : 12 + r() * 8;
      if (b.k === 'temple' || b.k === 'shrine') h = 9;
      const base = yMin - 2.5;
      let top = (yMin + yMax) / 2 + h;
      const cx0 = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz0 = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const cap = viewCap(cx0, cz0) - 2.2; // 屋根の高さぶん余裕をみる
      if (top > cap) {
        if (cap - yMax < 2.5) continue;    // 近すぎて低くできない建物は置かない
        top = cap;
      }
      const station = b.k === 'train_station';
      if (station) top = Math.min(top, yMin + 8.5);
      const wc = new THREE.Color(station ? '#efede6' : walls[Math.floor(r() * walls.length)]);
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
        tb.quad([ax, base, az], [bx, base, bz], [bx, top, bz], [ax, top, az], wc);
      }
      // 3階以上の建物（海沿いのマンションやビル）：各階の窓の列と、海側のベランダ
      if (!station && top - yMin >= 7.5 && area >= 60 && facadeWin.length < maxFacade) {
        const ccw = signedArea(poly) > 0;
        const balcony = r() < 0.5;
        for (let i = 0; i < poly.length; i++) {
          const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
          const L = Math.hypot(bx - ax, bz - az);
          if (L < 4) continue;
          const dx = (bx - ax) / L, dz = (bz - az) / L;
          const ox = ccw ? dz : -dz, oz = ccw ? -dx : dx;
          const ry = Math.atan2(ox, oz);
          const n = Math.max(1, Math.floor((L - 1.2) / 2.6));
          for (let fy = yMin + 1.5; fy < top - 1.4; fy += 3) {
            for (let k = 0; k < n; k++) {
              const t = (k + 0.5) / n;
              facadeWin.push({ x: ax + (bx - ax) * t + ox * 0.06, y: fy + 0.25, z: az + (bz - az) * t + oz * 0.06, sx: 1.35, sy: 1.1, sz: 1, ry });
            }
            // 海側（南向き）の壁には、各階のベランダ
            if (balcony && oz < -0.45 && fy > yMin + 3) {
              const mx = (ax + bx) / 2, mz = (az + bz) / 2, bry = Math.atan2(-dz, dx);
              facadeSlab.push({ x: mx + ox * 0.45, y: fy - 0.85, z: mz + oz * 0.45, sx: L * 0.86, sy: 0.12, sz: 0.9, ry: bry });
              facadeSlab.push({ x: mx + ox * 0.88, y: fy - 0.4, z: mz + oz * 0.88, sx: L * 0.86, sy: 0.85, sz: 0.06, ry: bry });
            }
          }
        }
      }
      // 屋根：小さな家は瓦の寄棟、大きな建物は平らな屋上
      const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
      const hip = (area < 260 && poly.length <= 10) || station;
      if (station) {
        // 駅舎：1階はガラス張りの店先
        const glass = new THREE.Color('#8fa6b2');
        const ccx = poly.reduce((s, p) => s + p[0], 0) / poly.length, ccz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        for (let i = 0; i < poly.length; i++) {
          const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
          const mx = (ax + bx) / 2 - ccx, mz = (az + bz) / 2 - ccz, ml = Math.hypot(mx, mz) || 1;
          const ox = (mx / ml) * 0.06, oz = (mz / ml) * 0.06;
          tb.quad([ax + ox, yMin + 0.3, az + oz], [bx + ox, yMin + 0.3, bz + oz], [bx + ox, yMin + 3.2, bz + oz], [ax + ox, yMin + 3.2, az + oz], glass);
        }
      }
      if (hip) {
        const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        const shrink = station ? 0.82 : 0.35;
        const inner = poly.map(([x, z]) => [cx + (x - cx) * shrink, cz + (z - cz) * shrink]);
        const rh = station ? 1.8 : 1.4 + Math.sqrt(area) * 0.08;
        const eave = 0.45;
        const outer = poly.map(([x, z]) => {
          const dx = x - cx, dz = z - cz, L = Math.hypot(dx, dz) || 1;
          return [x + (dx / L) * eave, z + (dz / L) * eave];
        });
        for (let i = 0; i < poly.length; i++) {
          const j = (i + 1) % poly.length;
          tb.quad([outer[i][0], top - 0.2, outer[i][1]], [outer[j][0], top - 0.2, outer[j][1]], [inner[j][0], top + rh, inner[j][1]], [inner[i][0], top + rh, inner[i][1]], roofTile);
        }
        const tris = THREE.ShapeUtils.triangulateShape(inner.map(([x, z]) => new THREE.Vector2(x, z)), []);
        for (const [a, bb, c] of tris) tb.tri([inner[a][0], top + rh, inner[a][1]], [inner[bb][0], top + rh, inner[bb][1]], [inner[c][0], top + rh, inner[c][1]], roofTile);
      } else {
        const tris = THREE.ShapeUtils.triangulateShape(contour, []);
        for (const [a, bb, c] of tris) tb.tri([poly[a][0], top, poly[a][1]], [poly[bb][0], top, poly[bb][1]], [poly[c][0], top, poly[c][1]], roofFlat);
      }
      // 占有マス（あとで埋める家や木が重ならないように）
      const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
      for (let gx = Math.floor(Math.min(...xs) / 4); gx <= Math.floor(Math.max(...xs) / 4); gx++) {
        for (let gz = Math.floor(Math.min(...zs) / 4); gz <= Math.floor(Math.max(...zs) / 4); gz++) {
          if (pointInPoly(gx * 4 + 2, gz * 4 + 2, poly)) this.occupied.add(gx * 100003 + gz);
        }
      }
      // 夜に灯る窓（いちばん長い壁の外側に1〜2枚）
      if (r() < 0.7) {
        let best = 0, bi = 0;
        for (let i = 0; i < poly.length; i++) {
          const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
          const L = Math.hypot(bx - ax, bz - az);
          if (L > best) { best = L; bi = i; }
        }
        const [ax, az] = poly[bi], [bx, bz] = poly[(bi + 1) % poly.length];
        const ccw = signedArea(poly) > 0;
        const dx = (bx - ax) / best, dz = (bz - az) / best;
        const ox = ccw ? dz : -dz, oz = ccw ? -dx : dx;
        const floors = Math.max(1, Math.floor(h / 3));
        for (let f = 0; f < floors; f++) {
          if (r() < 0.5) continue;
          const t = 0.25 + r() * 0.5;
          winList.push({ x: ax + (bx - ax) * t + ox * 0.08, y: yMin + 1.6 + f * 3, z: az + (bz - az) * t + oz * 0.08, sx: 1.1, sy: 0.85, sz: 1, ry: Math.atan2(ox, oz) });
        }
      }
    }
    // 窓（昼は青みがかった暗いガラス）とベランダ
    this.group.add(instancedBoxes(facadeWin, lam(0x46525e), { cast: false, receive: false, geo: new THREE.PlaneGeometry(1, 1) }));
    this.group.add(instancedBoxes(facadeSlab, lam(0xe4e2dc), { cast: true, receive: true }));
    for (const batch of [tbTown, tbStation]) {
      const mesh = new THREE.Mesh(batch.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      if (batch === tbStation) this.stationSimple = mesh;
    }
    if (this.stationPoly) this._stationModel();
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.group.add(instancedBoxes(winList, winMat, { cast: false, receive: false, geo: new THREE.PlaneGeometry(1, 1) }));
    this.nightMats.push({ mat: winMat, max: 0.9 });
  }

  /** OSM に建物が載っていない斜面を、小さな家で埋める（尾道の坂の家並み） */
  _infill() {
    const r = this.r;
    const walls = ['#e9e2d4', '#d8cfbf', '#cfc6b5', '#6b5543', '#5a4a3c', '#efe9df', '#bfb6a6'];
    const roofs = ['#4d535b', '#454b54', '#5b6068', '#3e434a', '#6a5b4e', '#556270', '#7a4a3a'];
    const list = [];
    for (let z = -1100; z < 220; z += 7 + r() * 2.5) {
      for (let x = -720; x < 640; x += 7 + r() * 2.5) {
        const hx = x + (r() - 0.5) * 3, hz = z + (r() - 0.5) * 3;
        const ground = terrainY(hx, hz);
        const above = ground - SEA_Y;
        // 向島側は海沿いの平地だけ、まばらに
        if (!onOnomichiSide(hx, hz) && (above > 14 || r() < 0.5)) continue;
        if (above < 1.5 || above > 122) continue;                // 海と、千光寺山の上のほうの森
        if (Math.hypot(hx, hz) < 14) continue;                    // 空き家のまわり
        if (this.occupied.has(Math.floor(hx / 4) * 100003 + Math.floor(hz / 4))) continue;
        if (inPrecinct(hx, hz, 4)) continue;
        const w = 4.5 + r() * 3.5, d = 4.5 + r() * 3;
        if (nearRail(hx, hz, Math.max(w, d) / 2 + 3.5)) continue;   // 線路と、その両わきの架線柱・石垣の場所
        if (nearAnyRoad(hx, hz, Math.max(w, d) / 2 + 0.8)) continue;
        if (BENCHES.some((bb) => Math.hypot(bb.x - hx, bb.z - hz) < Math.max(w, d) / 2 + 3)) continue;
        if (STREET_SHOPS.some((sh) => Math.hypot(sh.x - hx, sh.z - hz) < Math.max(w, d) / 2 + 4)) continue;
        // 町なか（平地）も、坂の斜面も、家がひしめくように（坂の上のほうだけ、ところどころ）
        if (above > 70 && r() < 0.3) continue;
        const h = above < 8 ? 6 + r() * 5 : 3 + r() * 3;
        if (ground + h + 2.2 > viewCap(hx, hz)) continue; // 窓からの眺めをふさがない
        list.push({ x: hx, z: hz, y: ground - 3, w, h: h + 3, d, rot: (r() - 0.5) * 0.3 + Math.round(r() * 2) * Math.PI / 2, roofH: 1.3 + r() * 0.8,
          wall: walls[Math.floor(r() * walls.length)], roof: roofs[Math.floor(r() * roofs.length)] });
        this.occupied.add(Math.floor(hx / 4) * 100003 + Math.floor(hz / 4));
        addSolid(hx, hz, w, d, list[list.length - 1].rot);
      }
    }
    // 200m 四方ごとにまとめる（視野外のタイルは描かない）
    const bins = new Map();
    for (const h of list) {
      const k = Math.floor(h.x / 200) * 100003 + Math.floor(h.z / 200);
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(h);
    }
    const win = [];
    for (const items of bins.values()) win.push(...this.world._houses(items));
    this.world._windowLights(win);
  }

  _trees() {
    const r = this.r;
    const broad = [], pines = [], shrubs = [];
    const amount = 0.55 + 0.45 * quality.s.people;   // 画質「低」では少なめに
    const okAt = (x, z, margin) => {
      if (Math.hypot(x, z) < 10) return false;
      if (this.occupied.has(Math.floor(x / 4) * 100003 + Math.floor(z / 4))) return false;
      if (inPrecinct(x, z, 2) || nearRail(x, z, 5) || nearAnyRoad(x, z, margin) || inSolid(x, z)) return false;
      // 山頂の展望台からの眺め（南の尾道水道）をさえぎらない
      const dd = Math.hypot(x - SUMMIT.deck.x, z - SUMMIT.deck.z);
      return !(dd < 25 || (dd < 90 && z < SUMMIT.deck.z + 5));
    };
    const leaf = () => new THREE.Color().setHSL(0.24 + r() * 0.09, 0.3 + r() * 0.18, 0.15 + r() * 0.11);
    // 木立：斜面にかたまりで。上のほう（千光寺山）は深い森に
    const clusters = Math.round(1700 * amount);
    for (let i = 0; i < clusters; i++) {
      const cx = BOUNDS.x0 + r() * (BOUNDS.x1 - BOUNDS.x0), cz = BOUNDS.z0 + r() * (BOUNDS.z1 - BOUNDS.z0);
      const above0 = terrainY(cx, cz) - SEA_Y;
      if (above0 < 6) continue;
      const n = above0 > 70 ? 6 + Math.floor(r() * 6) : 2 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const x = cx + (r() - 0.5) * 14, z = cz + (r() - 0.5) * 14;
        const ground = terrainY(x, z);
        const above = ground - SEA_Y;
        if (above < 5 || !okAt(x, z, 2.2)) continue;
        const s = 1.6 + r() * (above > 80 ? 4.2 : 2.8);
        if (ground + s * 1.6 > viewCap(x, z)) continue;
        if (r() < 0.22) {
          // 松：細い幹に、平たい葉の段
          pines.push({ x, y: ground + s * 1.1, z, sx: s * 0.75, sy: s * 0.45, sz: s * 0.75, color: new THREE.Color().setHSL(0.3, 0.32, 0.13 + r() * 0.06) });
        } else {
          broad.push({ x, y: ground + s * 0.6, z, sx: s, sy: s * (0.8 + r() * 0.5), sz: s, color: leaf() });
        }
      }
    }
    // 石段や坂道のわきの植え込み・草むら（細い道を歩いている感じに）
    const shrubCap = Math.round(5200 * amount);
    for (const road of ROADS) {
      if (shrubs.length > shrubCap) break;
      if (road.surface !== 'stone' || road.covered) continue;
      for (const p of samplePath(road.pts, 2.2)) {
        if (r() > 0.42) continue;
        const side = r() < 0.5 ? -1 : 1;
        const o = road.width / 2 + 0.45 + r() * 0.6;
        const x = p.x - Math.sin(p.angle) * side * o, z = p.z + Math.cos(p.angle) * side * o;
        const ground = terrainY(x, z);
        if (ground - SEA_Y < 3 || !okAt(x, z, 0.25)) continue;
        const s = 0.45 + r() * 0.7;
        if (ground + s > viewCap(x, z)) continue;
        shrubs.push({ x, y: ground + s * 0.45, z, sx: s * 1.2, sy: s, sz: s * 1.2, color: leaf() });
      }
    }
    const mat = lam(0xffffff, { flatShading: true });
    this.group.add(instancedChunks(broad, mat, { geo: new THREE.IcosahedronGeometry(1, 0) }));
    // 松：葉の段（つぶした円錐）
    const pineGeo = new THREE.ConeGeometry(1, 1, 7);
    this.group.add(instancedChunks(pines, mat, { geo: pineGeo }));
    this.group.add(instancedChunks(pines.map((p) => ({ x: p.x, y: p.y - p.sy * 1.6, z: p.z, sx: 0.12, sy: p.sy * 2.6, sz: 0.12, color: new THREE.Color(0x4a3a2c) })), lam(0xffffff), { geo: new THREE.CylinderGeometry(1, 1, 1, 5) }));
    this.group.add(instancedChunks(shrubs, mat, { geo: new THREE.IcosahedronGeometry(1, 0), cast: false }));
  }

  /** 空き家の外観：石垣の土台、瓦屋根、戸口 */
  _house() {
    const stone = lam(0x7d776c);
    const base = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 5), stone);
    base.position.set(0, -3.1, 0.5);
    base.receiveShadow = true;
    this.group.add(base);
    const roofGeo = new THREE.CylinderGeometry(0.62, 0.62, 1, 3, 1);
    roofGeo.rotateZ(Math.PI / 2);
    roofGeo.rotateX(-Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, lam(0x474c54));
    roof.scale.set(6.6, 2.0, 6.4);
    roof.position.set(0, 2.95, 0.5);
    roof.castShadow = true;
    this.group.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.85, 0.95), lam(0x5a3d29));
    door.position.set(-2.66, 0.92, 1.5);
    this.group.add(door);
    const lattice = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.5), lam(0xe6dcc6));
    lattice.position.set(-2.75, 1.0, 1.5);
    lattice.rotation.y = -Math.PI / 2;
    this.group.add(lattice);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.42), new THREE.MeshBasicMaterial({ map: labelTexture('空き家', { w: 64, h: 192, size: 44, vertical: true, bg: '#d8ccb0', fg: '#3a2a1a' }) }));
    plate.position.set(-2.75, 1.45, 2.15);
    plate.rotation.y = -Math.PI / 2;
    this.group.add(plate);
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.2), stone);
    step.position.set(-3.4, -0.25, 1.5);
    this.group.add(step);
  }

  // ---------- 本通り商店街：アーケードの屋根と店先 ----------
  _arcade() {
    // 昭和の商店街：鉄骨のトラスに明かり取りの屋根、さびたトタンの壁、シャッターの閉まった店、
    // 吊り看板と縦長の電飾看板、雨どい、のぼり、鉢植え。まとめ描きで、描く回数はわずかにする
    const r = this.r;
    const atlas = buildSignAtlas();
    const retro = buildRetroSignAtlas();
    const signs = new QuadBatch(), glassDay = new QuadBatch(), glassNight = new QuadBatch();
    const tin = new QuadBatch(), shutters = new QuadBatch(), retroSigns = new QuadBatch();
    const awnings = [], fronts = [], ribs = [], lamps = [], shades = [], pipes = [], cases = [], pots = [], plants = [];
    const facadeColors = ['#cfc8b8', '#bdb4a2', '#d9d2c2', '#a89f8c', '#8a7a68', '#c4b8a0'];
    const awningColors = ['#a33a2a', '#2f5a7a', '#3a6a4a', '#c8a050', '#7a6a5a', '#5a3a6a'];
    const roofTb = new TriBatch(), skyTb = new TriBatch();
    const sheet = [new THREE.Color(0xb7ad98), new THREE.Color(0xa99f8a), new THREE.Color(0xc2b8a2)];
    const skyC = new THREE.Color(0xf4f6f2);
    let signIdx = 0, plateIdx = 0, vertIdx = 0;
    for (const road of ARCADE_ROADS) {
      const hw = road.width / 2;
      const s = samplePath(road.pts, 2);
      const W = hw + 1.2;
      // 屋根：両わきはトタン（下から見ると、さびの浮いた鉄板）、まん中は明かり取りの半透明パネル
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        const ya = terrainY(a.x, a.z) + 7, yb = terrainY(b.x, b.z) + 7;
        const na = { x: -Math.sin(a.angle), z: Math.cos(a.angle) }, nb = { x: -Math.sin(b.angle), z: Math.cos(b.angle) };
        const P = (q, n, y, t, sd) => [q.x + n.x * W * t * sd, y + 0.9 * (1 - t), q.z + n.z * W * t * sd];
        const sc = sheet[i % 3];
        for (const sd of [-1, 1]) {
          roofTb.quad(P(a, na, ya, 1, sd), P(b, nb, yb, 1, sd), P(b, nb, yb, 0.5, sd), P(a, na, ya, 0.5, sd), sc, [0, 0, 2, 0, 2, 1.2, 0, 1.2]);
          skyTb.quad(P(a, na, ya, 0.5, sd), P(b, nb, yb, 0.5, sd), P(b, nb, yb, 0, sd), P(a, na, ya, 0, sd), skyC);
        }
        const segLen = Math.hypot(b.x - a.x, b.z - a.z) + 0.05;
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (ya + yb) / 2;
        // 母屋（屋根の下を通りにそって走る細い鉄骨）
        for (const t of [-1, -0.5, 0, 0.5, 1]) {
          ribs.push({ x: mx + na.x * W * t, y: my + 0.9 * (1 - Math.abs(t)) - 0.08, z: mz + na.z * W * t, sx: segLen, sy: 0.08, sz: 0.08, ry: -a.angle, color: '#4a4c50' });
        }
        // 4m ごとのトラス：水平の梁と、まん中の束、斜めの材
        if (i % 2 === 0) {
          ribs.push({ x: a.x, y: ya - 0.45, z: a.z, sx: 0.1, sy: 0.12, sz: W * 2, ry: -a.angle, color: '#3e4044' });
          ribs.push({ x: a.x, y: ya + 0.2, z: a.z, sx: 0.08, sy: 1.3, sz: 0.08, ry: -a.angle, color: '#3e4044' });
          for (const sd of [-1, 1]) {
            ribs.push({ x: a.x + na.x * W * 0.5 * sd, y: ya + 0.02, z: a.z + na.z * W * 0.5 * sd, sx: 0.07, sy: 0.07, sz: W * 1.04, ry: -a.angle, rx: sd * 0.42, color: '#3e4044' });
          }
        }
        // 吊りランプ（傘つき）。梁から細い吊り棒で
        if (i % 4 === 1) {
          lamps.push({ x: a.x, y: ya - 1.5, z: a.z });
          shades.push({ x: a.x, y: ya - 1.32, z: a.z, sx: 0.5, sy: 0.32, sz: 0.5 });
          ribs.push({ x: a.x, y: ya - 0.85, z: a.z, sx: 0.03, sy: 0.9, sz: 0.03, color: '#2a2a2c' });
        }
      }
      // 両側の店先（約6.5m ごと）。決まった場所はパン屋とラーメン屋にする
      const specials = (SPECIAL_SHOPS[road.name] || []).map((sp) => ({ ...sp }));
      for (const side of [-1, 1]) {
        const shops = samplePath(road.pts, 6.5);
        for (let i = 0; i < shops.length - 1; i++) {
          const p = shops[i];
          const frac = i / Math.max(1, shops.length - 2);
          const nx = -Math.sin(p.angle) * side, nz = Math.cos(p.angle) * side;   // 通りの外向き
          const off = hw + 0.35;
          const fx = p.x + nx * off, fz = p.z + nz * off;
          // 店の間口と奥行きのどこかに路地・横道がかかるなら、そこは空けて通れるようにする
          const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
          let blocked = false;
          for (const t of [-3.1, -1.5, 0, 1.5, 3.1]) {
            for (const d of [0.8, 3, 6, 8.5]) {
              const r0 = nearAnyRoad(fx + nx * d + ca * t, fz + nz * d + sa * t, 0.2);
              if (r0 && !r0.covered) { blocked = true; break; }
            }
            if (blocked) break;
          }
          if (blocked) continue;
          const gy = groundY(fx, fz);
          // 通りを向く面：法線 = -(外向き) → 横ベクトル r = (nz, -nx)·(-1)
          const rx = -nz, rz = nx;
          const warm = 0.85 + r() * 0.15;
          const sp = specials.find((q) => q.side === side && !q.done && frac >= q.f);
          // 昼でもシャッターを下ろしたままの店がある（決まった店は開いている）
          const closed = !sp && r() < 0.38;
          const shY = gy + 3.85, shTop = terrainY(p.x, p.z) + 6.95;
          // 店先の上：さびたトタン張りの壁
          tin.addOriented(fx - nx * 0.04, (shY + shTop) / 2, fz - nz * 0.04, rx, rz, 6.4, shTop - shY, [0, 0, 6.4 / 1.6, (shTop - shY) / 1.6], [0.85 + r() * 0.15, 0.82 + r() * 0.12, 0.78 + r() * 0.1]);
          if (closed) {
            const tint = [[0.75, 0.78, 0.74], [0.62, 0.68, 0.6], [0.8, 0.8, 0.8], [0.7, 0.74, 0.78]][Math.floor(r() * 4)];
            shutters.addOriented(fx - nx * 0.05, gy + 1.4, fz - nz * 0.05, rx, rz, 5.4, 2.8, [0, 0, 1, 1], tint);
            cases.push({ x: fx - nx * 0.2, y: gy + 2.95, z: fz - nz * 0.2, sx: 5.6, sy: 0.32, sz: 0.36, ry: -p.angle, color: '#7c8078' });
          } else {
            glassDay.addOriented(fx - nx * 0.02, gy + 1.35, fz - nz * 0.02, rx, rz, 5.2, 2.3, undefined, [0.3, 0.27, 0.23]);
            glassNight.addOriented(fx - nx * 0.04, gy + 1.35, fz - nz * 0.04, rx, rz, 5.2, 2.3, undefined, [warm, 0.78 * warm, 0.5 * warm]);
            if (!sp && r() < 0.45) awnings.push({ x: fx - nx * 0.5, y: gy + 2.75, z: fz - nz * 0.5, sx: 5.6, sy: 0.07, sz: 0.95, ry: -p.angle, rx: side * 0.35, color: awningColors[Math.floor(r() * awningColors.length)] });
            // 鉢植え
            if (!sp && r() < 0.3) {
              const t = (r() - 0.5) * 4;
              const px = fx - nx * 0.45 + ca * t, pz = fz - nz * 0.45 + sa * t;
              pots.push({ x: px, y: gy + 0.17, z: pz, sx: 0.36, sy: 0.34, sz: 0.36, color: '#b0563a' });
              plants.push({ x: px, y: gy + 0.5, z: pz, sx: 0.46, sy: 0.4, sz: 0.46, color: r() < 0.3 ? '#c8507a' : '#3e6e34' });
            }
          }
          if (sp) {
            sp.done = true;
            this._specialShop(sp, p, fx, fz, gy, nx, nz, hw);
          } else {
            signs.addOriented(fx - nx * 0.06, gy + 3.35, fz - nz * 0.06, rx, rz, 3.3, 0.82, atlas.uv(signIdx++));
          }
          const h = 5.5 + r() * 5;
          fronts.push({ x: fx + nx * 4, y: gy + h / 2 - 1, z: fz + nz * 4, sx: 6.3, sy: h + 2, sz: 8, ry: -p.angle, color: facadeColors[Math.floor(r() * facadeColors.length)] });
          // 通りに張り出す看板（通りの向きから読める、両面）
          const roll = r();
          if (roll < 0.42) {
            const w = Math.min(2.3, hw * 0.75), hgt = w * 0.25;
            const cx = fx - nx * (0.25 + w / 2), cz = fz - nz * (0.25 + w / 2), cy = gy + 4.35 + r() * 0.8;
            const t = (r() - 0.5) * 3;
            const uv = retro.plate(plateIdx++);
            retroSigns.addOriented(cx + ca * (t + side * 0.03), cy, cz + sa * (t + side * 0.03), -nx, -nz, w, hgt, uv);
            retroSigns.addOriented(cx + ca * (t - side * 0.03), cy, cz + sa * (t - side * 0.03), nx, nz, w, hgt, uv);
            cases.push({ x: cx + ca * t, y: cy, z: cz + sa * t, sx: 0.05, sy: hgt + 0.04, sz: w + 0.04, ry: -p.angle, color: '#5a554c' });
            ribs.push({ x: cx + ca * t, y: cy + hgt / 2 + 0.06, z: cz + sa * t, sx: 0.04, sy: 0.04, sz: w + 0.25, ry: -p.angle, color: '#2a2a2c' });
          } else if (roll < 0.7) {
            // 縦長の電飾看板（箱の両面に文字）
            const hgt = 2.2 + r() * 0.6, w = 0.42;
            const cx = fx - nx * 0.48, cz = fz - nz * 0.48, cy = gy + 3.15 + hgt / 2;
            const t = (r() - 0.5) * 3.6;
            const uv = retro.vertical(vertIdx++);
            retroSigns.addOriented(cx + ca * (t + side * 0.11), cy, cz + sa * (t + side * 0.11), -nx, -nz, w, hgt, uv);
            retroSigns.addOriented(cx + ca * (t - side * 0.11), cy, cz + sa * (t - side * 0.11), nx, nz, w, hgt, uv);
            cases.push({ x: cx + ca * t, y: cy, z: cz + sa * t, sx: 0.2, sy: hgt + 0.08, sz: w + 0.06, ry: -p.angle, color: '#8a8478' });
          } else if (roll < 0.82) {
            // のぼり旗（竿と、縦長の布）
            const t = (r() - 0.5) * 4;
            const bx = fx - nx * 0.7 + ca * t, bz = fz - nz * 0.7 + sa * t;
            pipes.push({ x: bx, y: gy + 1.45, z: bz, sx: 0.5, sy: 2.9, sz: 0.5, color: '#d8d8d8' });
            const uv = retro.vertical(vertIdx++);
            retroSigns.addOriented(bx - nx * 0.28 + ca * side * 0.02, gy + 1.75, bz - nz * 0.28 + sa * side * 0.02, -nx, -nz, 0.5, 2.0, uv, [1, 0.92, 0.92]);
            retroSigns.addOriented(bx - nx * 0.28 - ca * side * 0.02, gy + 1.75, bz - nz * 0.28 - sa * side * 0.02, nx, nz, 0.5, 2.0, uv, [1, 0.92, 0.92]);
          }
          // 店と店のさかい：雨どい（青みがかった灰色）や、根もとを赤く塗った柱
          if (r() < 0.55) {
            const ex = fx - nx * 0.16 + ca * 3.2, ez = fz - nz * 0.16 + sa * 3.2;
            const post = r() < 0.4;
            const top = shTop - gy;
            pipes.push({ x: ex, y: gy + top / 2, z: ez, sx: post ? 1.6 : 0.9, sy: top, sz: post ? 1.6 : 0.9, color: post ? '#d6d0bc' : '#8e9db0' });
            if (post || r() < 0.4) pipes.push({ x: ex, y: gy + 0.3, z: ez, sx: post ? 1.9 : 1.1, sy: 0.6, sz: post ? 1.9 : 1.1, color: '#a8322a' });
          }
        }
      }
      // 通りの名前の吊り看板（両端）
      if (road.name) {
        for (const f of [0.02, 0.98]) {
          const q = samplePath(road.pts, 1);
          const p = q[Math.floor(f * (q.length - 1))];
          const tex = labelTexture(road.name, { w: 1024, h: 160, size: 96, bg: '#2a2622', fg: '#f3e6c8' });
          for (const flip of [0, Math.PI]) {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 0.8), new THREE.MeshBasicMaterial({ map: tex }));
            m.position.set(p.x, terrainY(p.x, p.z) + 6, p.z);
            m.rotation.y = -p.angle + Math.PI / 2 + flip;
            m.translateZ(0.02);
            this.group.add(m);
          }
        }
      }
    }
    const tinTex = arcadeTinTexture(), shutterTex = shutterTexture();
    const roof = new THREE.Mesh(roofTb.build(), lam(0xffffff, { vertexColors: true, map: tinTex, side: THREE.DoubleSide }));
    roof.castShadow = roof.receiveShadow = true;
    this.group.add(roof);
    // 明かり取り：昼は空の光でほんのり白く光る
    this.skylightMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false, emissive: 0xfffaf0, emissiveIntensity: 0.5 });
    this.group.add(new THREE.Mesh(skyTb.build(), this.skylightMat));
    this.group.add(instancedBoxes(ribs, lam(0xffffff), { receive: false }));
    this.group.add(instancedBoxes(fronts, lam(0xffffff)));
    this.group.add(instancedBoxes(awnings, lam(0xffffff, { side: THREE.DoubleSide }), { receive: false }));
    this.group.add(instancedBoxes(cases, lam(0xffffff), { receive: false }));
    this.group.add(instancedBoxes(pipes, lam(0xffffff), { receive: false, geo: new THREE.CylinderGeometry(0.07, 0.07, 1, 8) }));
    this.group.add(instancedBoxes(pots, lam(0xffffff), { geo: new THREE.CylinderGeometry(0.5, 0.38, 1, 10) }));
    this.group.add(instancedBoxes(plants, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(0.6, 0) }));
    this.group.add(new THREE.Mesh(tin.build(), lam(0xffffff, { vertexColors: true, map: tinTex })));
    this.group.add(new THREE.Mesh(shutters.build(), lam(0xffffff, { vertexColors: true, map: shutterTex })));
    this.group.add(new THREE.Mesh(glassDay.build(), lam(0xffffff, { vertexColors: true })));
    const nightMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new THREE.Mesh(glassNight.build(), nightMat));
    this.nightMats.push({ mat: nightMat, max: 0.95 });
    this.signMat = new THREE.MeshLambertMaterial({ map: atlas.tex, emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.15 });
    this.group.add(new THREE.Mesh(signs.build(), this.signMat));
    // 吊り看板・電飾看板：夜は内側から灯る
    const retroMat = new THREE.MeshLambertMaterial({ map: retro.tex, vertexColors: true, emissive: 0xffffff, emissiveMap: retro.tex, emissiveIntensity: 0.2 });
    this.specialSignMats.push(retroMat);
    this.group.add(new THREE.Mesh(retroSigns.build(), retroMat));
    this.arcadeLampMat = new THREE.MeshBasicMaterial({ color: 0xffcf98 });
    this.group.add(instancedBoxes(lamps.map((l) => ({ ...l, sx: 0.32, sy: 0.32, sz: 0.32 })), this.arcadeLampMat, { cast: false, receive: false, geo: new THREE.SphereGeometry(0.5, 10, 8) }));
    this.group.add(instancedBoxes(shades, lam(0xe8e4dc, { side: THREE.DoubleSide }), { cast: false, receive: false, geo: new THREE.CylinderGeometry(0.12, 0.5, 1, 12, 1, true) }));
    lamps.forEach((l, i) => { if (i % 2 === 0) this.lampPositions.push([l.x, l.y - 0.2, l.z]); });
  }

  /** パン屋・ラーメン屋の店構え（看板・のれん・ショーケース）と、立ち寄れる場所 */
  _specialShop(sp, p, fx, fz, gy, nx, nz, hw) {
    const yaw = -p.angle + (nz * Math.cos(p.angle) - nx * Math.sin(p.angle) > 0 ? Math.PI : 0);
    const face = Math.atan2(-nx, -nz); // 通りに向いた面の向き
    const g = new THREE.Group();
    g.position.set(fx - nx * 0.08, gy, fz - nz * 0.08);
    g.rotation.y = face;
    const ramen = sp.type === 'ramen';
    const kama = sp.type === 'kamaboko';
    const cafe = sp.type === 'cafe';
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshLambertMaterial({
      map: labelTexture(sp.name, { w: 640, h: 160, size: 84, bg: ramen ? '#7a1e18' : kama ? '#f6f2ea' : cafe ? '#2a1c14' : '#f4ead2', fg: ramen ? '#fbeedc' : kama ? '#1e3a5e' : cafe ? '#e8d2a8' : '#5a3a1a' }),
      emissive: 0xffffff, emissiveIntensity: 0.2,
    }));
    sign.position.set(0, 3.35, 0.02);
    sign.material.emissiveMap = sign.material.map;
    this.specialSignMats.push(sign.material);
    g.add(sign);
    if (ramen) {
      // 赤いのれん（3枚）
      const tex = labelTexture('ら ー め ん', { w: 512, h: 128, size: 72, bg: '#a82a22', fg: '#fff4e4' });
      const noren = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      noren.position.set(0, 2.15, 0.25);
      g.add(noren);
      // 赤ちょうちん
      for (const x of [-1.9, 1.9]) {
        const lan = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshLambertMaterial({ color: 0xd8402e, emissive: 0xff5a30, emissiveIntensity: 0.3 }));
        lan.scale.y = 1.3;
        lan.position.set(x, 2.5, 0.35);
        this.specialSignMats.push(lan.material);
        g.add(lan);
      }
    } else if (cafe) {
      // 喫茶店：濃い木の扉と、あたたかい灯りの窓
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.2, 0.1), lam(0x4a2e1e));
      door.position.set(1.4, 1.1, 0.12);
      g.add(door);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), new THREE.MeshLambertMaterial({ color: 0x6a5040, emissive: 0xffb060, emissiveIntensity: 0.3 }));
      win.position.set(-0.9, 1.45, 0.13);
      this.specialSignMats.push(win.material);
      g.add(win);
      const awn = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.06, 1.0), lam(0x3a2a20, { side: THREE.DoubleSide }));
      awn.position.set(0, 2.7, 0.5);
      awn.rotation.x = 0.35;
      g.add(awn);
    } else if (kama) {
      // 紺ののれんと、紅白のかまぼこが並ぶショーケース
      const tex = labelTexture('か ま ぼ こ', { w: 512, h: 128, size: 72, bg: '#1e3a5e', fg: '#f6f2ea' });
      const noren = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      noren.position.set(0, 2.15, 0.25);
      g.add(noren);
      const caseBox = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.95, 0.6), lam(0xe8e4dc));
      caseBox.position.set(0, 0.48, 0.35);
      g.add(caseBox);
      const pink = lam(0xe88a9a), white = lam(0xf6f2ea), gold = lam(0xc8903e);
      for (let k = 0; k < 9; k++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.14), k % 3 === 2 ? gold : k % 2 ? white : pink);
        m.position.set(-1.1 + (k % 5) * 0.55, 1.0, 0.25 + Math.floor(k / 5) * 0.22);
        g.add(m);
      }
    } else {
      // パンの並んだショーケース
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.5), lam(0x8a6a4a));
      shelf.position.set(-0.6, 0.45, 0.3);
      g.add(shelf);
      const breadMat = lam(0xd09a52);
      for (let k = 0; k < 10; k++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.09 + this.r() * 0.04, 10, 8), breadMat);
        b.scale.y = 0.6;
        b.position.set(-1.6 + (k % 5) * 0.45, 0.95, 0.15 + Math.floor(k / 5) * 0.25);
        g.add(b);
      }
      const awn = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.06, 1.0), lam(0xf0e2c0, { side: THREE.DoubleSide }));
      awn.position.set(0, 2.7, 0.5);
      awn.rotation.x = 0.35;
      g.add(awn);
    }
    this.group.add(g);
    // 立ち寄る場所：店の前の通りの上
    const sx = p.x + nx * (hw - 0.9), sz = p.z + nz * (hw - 0.9);
    this.interactables.push({ type: sp.type, name: sp.name, x: sx, z: sz, yaw: Math.atan2(-nx, -nz), radius: 2.4 });
    void yaw;
  }

  /** アーケードの外の、ひとつ建ちの小さなお店（坂の途中のパン屋、駅前のおやつの店） */
  _streetShops() {
    for (const sh of STREET_SHOPS) {
      const tx = Math.cos(sh.ang), tz = Math.sin(sh.ang);
      // 店先の床の高さ（坂でも水平に、低いほうは土台で埋める）
      let floor = -Infinity, low = Infinity;
      for (const u of [-2.3, 0, 2.3]) for (const v of [0, 2, 4]) {
        const y = groundY(sh.fx + tx * u + sh.nx * v, sh.fz + tz * u + sh.nz * v);
        low = Math.min(low, y);
        if (v === 0) floor = Math.max(floor, y);
      }
      floor += 0.05;
      const face = Math.atan2(-sh.nx, -sh.nz); // 正面（+z）が道を向く
      const g = new THREE.Group();
      g.position.set(sh.x, floor, sh.z);
      g.rotation.y = face;
      const sweets = sh.style === 'sweets';
      const wallC = sweets ? 0xf4efe6 : 0xd9c7a6, roofC = sweets ? 0x5a6470 : 0x6a4a34;
      const H = sweets ? 3.4 : 2.8;
      const base = floor - low + 0.2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, H + base, 4), lam(wallC));
      body.position.set(0, (H - base) / 2, 0);
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      // 瓦屋根（片流れ）
      const roof = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 4.8), lam(roofC));
      roof.position.set(0, H + 0.25, 0.1);
      roof.rotation.x = 0.18;
      roof.castShadow = true;
      g.add(roof);
      // ガラス戸とショーケース
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.9), new THREE.MeshLambertMaterial({ color: 0x9ab0b8, emissive: 0xffc888, emissiveIntensity: 0 }));
      glass.position.set(0.5, 1.15, 2.01);
      this.specialSignMats.push(glass.material);
      g.add(glass);
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.85, 0.5), lam(0x8a6a4a));
      shelf.position.set(-1.45, 0.43, 2.25);
      g.add(shelf);
      if (sweets) {
        // 小さな瓶のプリン（茶色のふた、赤い帯）
        const glassMat = new THREE.MeshLambertMaterial({ color: 0xf2d58a }), lid = lam(0x6a3f22), band = lam(0xc8302a);
        for (let k = 0; k < 6; k++) {
          const x = -1.95 + (k % 3) * 0.25, z = 2.15 + Math.floor(k / 3) * 0.2;
          const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.13, 10), glassMat);
          jar.position.set(x, 0.92, z);
          const l = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.03, 10), lid);
          l.position.set(x, 1.0, z);
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.025, 10), band);
          b.position.set(x, 0.91, z);
          g.add(jar, l, b);
        }
      } else {
        const breadMat = lam(0xd09a52);
        for (let k = 0; k < 6; k++) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), breadMat);
          b.scale.y = 0.6;
          b.position.set(-1.95 + (k % 3) * 0.25, 0.92, 2.15 + Math.floor(k / 3) * 0.2);
          g.add(b);
        }
      }
      // 看板
      const tex = labelTexture(sh.name, { w: 640, h: 160, size: 76, bg: sweets ? '#2e3a44' : '#f4ead2', fg: sweets ? '#f4e6c8' : '#5a3a1a' });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2 }));
      sign.position.set(0, H - 0.35, 2.02);
      this.specialSignMats.push(sign.material);
      g.add(sign);
      const awn = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.05, 0.9), lam(sweets ? 0x2e3a44 : 0xb8502a, { side: THREE.DoubleSide }));
      awn.position.set(0, H - 0.95, 2.4);
      awn.rotation.x = 0.3;
      g.add(awn);
      this.group.add(g);
      this.lampPositions.push([sh.fx, floor + 2.4, sh.fz]);
      this.interactables.push({ type: sh.type, menu: sh.menu, name: sh.name, x: sh.standX, z: sh.standZ, yaw: face, radius: 2.6 });
    }
  }

  /** 自販機：海沿いのベンチの近く、渡船のりば、ロープウェイ山麓駅、駅前、家の前の石段、路地の入口 */
  _vendingMachines() {
    const spots = [];
    BENCHES.slice(0, 4).forEach((b) => spots.push([b.x + Math.sin(b.yaw) * 2.5, b.z + Math.cos(b.yaw) * 2.5]));
    FERRY_ROUTES.forEach((r) => spots.push([r.a.x, r.a.z]));
    spots.push([ROPEWAY.base.x, ROPEWAY.base.z]);
    const station = POIS.find((p) => p.n === 'JR尾道駅');
    if (station) spots.push([station.x, station.z]);
    spots.push([-14, -3]);
    ALLEYS.filter((_, i) => i % 5 === 2).forEach((a) => spots.push(a.pts[1]));
    const panel = canvasTexture(128, 256, (g, w, h) => {
      g.fillStyle = '#1c2228';
      g.fillRect(0, 0, w, h);
      const cols = ['#5a3a24', '#2a3a5a', '#f08a1c', '#3f7a3a', '#7ac8e8', '#b88a5a', '#c8302a', '#e8d040'];
      for (let row = 0; row < 3; row++) {
        g.fillStyle = '#e8eef2';
        g.fillRect(6, 14 + row * 58, w - 12, 50);
        for (let c = 0; c < 4; c++) {
          g.fillStyle = cols[(row * 4 + c) % cols.length];
          g.fillRect(12 + c * 28, 20 + row * 58, 18, 34);
          g.fillStyle = row === 0 ? '#e83a2a' : '#2a6ae8';
          g.fillRect(12 + c * 28, 57 + row * 58, 18, 4);
        }
      }
      g.fillStyle = '#0c0e10';
      g.fillRect(14, h - 50, w - 28, 30);
      g.fillStyle = '#9aa';
      g.fillRect(w - 30, 190, 12, 18);
    });
    const placed = [];
    // 置けるかどうか：舗装された道（石段・小径は石垣があるので避ける）の端の外側で、
    // 建物・海・ほかの道にかからず、足もとがほぼ平らで、前に人が立てるところ
    const tryAt = (qx, qz) => {
      const n = nearestRoad(qx, qz);
      if (!n || n.d > 30 || n.road.surface === 'stone' || n.road.covered) return null;
      const s = n.seg;
      const ang = Math.atan2(s.dz, s.dx);
      for (const side of [-1, 1]) {
        const nx = -Math.sin(ang) * side, nz = Math.cos(ang) * side;
        const x = n.px + nx * (s.half + 0.5), z = n.pz + nz * (s.half + 0.5);
        if (inBuilding(x, z) || inBuilding(x + nx * 0.5, z + nz * 0.5) || inSolid(x, z) || inSolid(x + nx * 0.5, z + nz * 0.5) || terrainY(x, z) < SEA_Y + 0.5 || nearAnyRoad(x, z, 0.05)) continue;
        // 箱の四隅の高さ（傾きが大きいところには置かない）
        const tx = Math.cos(ang), tz = Math.sin(ang);
        const ys = [];
        for (const a of [-0.5, 0.5]) for (const b of [-0.4, 0.4]) ys.push(groundY(x + tx * a + nx * b, z + tz * a + nz * b));
        if (Math.max(...ys) - Math.min(...ys) > 0.45) continue;
        if (!walkable(x - nx * 1.1, z - nz * 1.1)) continue;
        return { x, z, nx, nz, ang, y: Math.max(...ys, surfaceY(x - nx * 0.45, z - nz * 0.45)), low: Math.min(...ys) };
      }
      return null;
    };
    for (const [x0, z0] of spots) {
      // 目安の場所から、近いほうへ少しずつ探す
      let best = null;
      for (let r = 0; r <= 24 && !best; r += 3) {
        for (let k = 0; k < (r ? 8 : 1) && !best; k++) {
          const a = (k / 8) * Math.PI * 2;
          best = tryAt(x0 + Math.cos(a) * r, z0 + Math.sin(a) * r);
        }
      }
      if (!best || placed.some((p) => Math.hypot(p.x - best.x, p.z - best.z) < 25)) continue;
      placed.push(best);
      const y = best.y;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.83, 0.75), lam(VENDING_COLORS[placed.length % VENDING_COLORS.length]));
      body.position.y = 0.915;
      body.castShadow = true;
      const front = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.6), new THREE.MeshLambertMaterial({ map: panel, emissive: 0xffffff, emissiveMap: panel, emissiveIntensity: 0.25 }));
      front.position.set(0, 0.95, 0.38);
      this.vendingMats.push(front.material);
      // 低いほうの足もとが浮かないよう、コンクリートの台
      const plinthH = y - best.low + 0.15;
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.06, plinthH, 0.8), lam(0x8e8a82));
      plinth.position.y = -plinthH / 2 + 0.02;
      g.add(body, front, plinth);
      g.position.set(best.x, y, best.z);
      g.rotation.y = Math.atan2(-best.nx, -best.nz); // 正面（+z）を道へ
      this.group.add(g);
      this.lampPositions.push([best.x - best.nx * 0.5, y + 1.2, best.z - best.nz * 0.5]);
      const sx = best.x - best.nx * 1.1, sz = best.z - best.nz * 1.1;
      this.interactables.push({ type: 'vending', name: '自販機', x: sx, z: sz, yaw: Math.atan2(-best.nx, -best.nz), radius: 1.8 });
    }
  }

  // ---------- 線路・踏切 ----------
  _rails() {
    // ---- 線路：茶色いバラストの盛り土、コンクリートのまくら木、さびた茶色のレール（すべて1つにまとめる） ----
    const tb = new TriBatch();
    const rr = seededRandom('rails');
    const cTie = new THREE.Color(0x9a958c), cTieSide = new THREE.Color(0x7a766e);
    const cRail = new THREE.Color(0x6a4636), cRailTop = new THREE.Color(0xb4aca2);
    const railY = (x, z) => terrainY(x, z) + 0.12;
    for (const rail of RAILS) {
      const s = samplePath(rail.pts, 3);
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        const na = { x: -Math.sin(a.angle), z: Math.cos(a.angle) }, nb = { x: -Math.sin(b.angle), z: Math.cos(b.angle) };
        const ya = railY(a.x, a.z), yb = railY(b.x, b.z);
        const A = (o, h) => [a.x + na.x * o, ya + h, a.z + na.z * o], B = (o, h) => [b.x + nb.x * o, yb + h, b.z + nb.z * o];
        // バラストの断面：上は平ら、両肩はなだらかに地面へ。色は少しずつむらに
        const k = 0.9 + rr() * 0.2;
        const cBal = new THREE.Color(0x7a6454).multiplyScalar(k), cBalSide = new THREE.Color(0x66574a).multiplyScalar(k);
        tb.quad(A(-1.45, 0.12), A(1.45, 0.12), B(1.45, 0.12), B(-1.45, 0.12), cBal);
        tb.quad(A(-2.2, -0.15), A(-1.45, 0.12), B(-1.45, 0.12), B(-2.2, -0.15), cBalSide);
        tb.quad(A(1.45, 0.12), A(2.2, -0.15), B(2.2, -0.15), B(1.45, 0.12), cBalSide);
        // レール：上面は車輪でみがかれて明るく、横はさびた茶色
        for (const o of [-0.535, 0.535]) {
          const w = 0.035;
          tb.quad(A(o - w, 0.34), A(o + w, 0.34), B(o + w, 0.34), B(o - w, 0.34), cRailTop);
          tb.quad(A(o - w, 0.2), A(o - w, 0.34), B(o - w, 0.34), B(o - w, 0.2), cRail);
          tb.quad(A(o + w, 0.34), A(o + w, 0.2), B(o + w, 0.2), B(o + w, 0.34), cRail);
        }
      }
      // まくら木（約0.7mおき）。上面と、前後の面だけ
      for (const p of samplePath(rail.pts, 0.7)) {
        const tx = Math.cos(p.angle) * 0.11, tz = Math.sin(p.angle) * 0.11;
        const nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        const y = railY(p.x, p.z);
        const P = (o, d, h) => [p.x + nx * o + tx * d, y + h, p.z + nz * o + tz * d];
        tb.quad(P(-1.2, -1, 0.2), P(-1.2, 1, 0.2), P(1.2, 1, 0.2), P(1.2, -1, 0.2), cTie);
        tb.quad(P(-1.2, -1, 0.12), P(-1.2, -1, 0.2), P(1.2, -1, 0.2), P(1.2, -1, 0.12), cTieSide);
        tb.quad(P(1.2, 1, 0.12), P(1.2, 1, 0.2), P(-1.2, 1, 0.2), P(-1.2, 1, 0.12), cTieSide);
      }
    }
    const trackMesh = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    trackMesh.receiveShadow = true;
    this.group.add(trackMesh);
    this._catenary(railY);
    // 踏切：警報機（黄色と黒のしま模様の柱、×の踏切警標、左右に交互に点滅する赤い灯、「とまれみよ」の板、上にスピーカー）と、
    // しま模様の遮断かん（線路と平行に、道をふさぐ向き）
    const tiger = (rx, ry) => canvasTexture(64, 64, (g2, w, h) => {
      g2.fillStyle = '#f2c81e';
      g2.fillRect(0, 0, w, h);
      g2.fillStyle = '#1e1c1a';
      for (let k = -2; k < 3; k++) { g2.beginPath(); g2.moveTo(k * 32, 0); g2.lineTo(k * 32 + 16, 0); g2.lineTo(k * 32 + 16 + 64, h); g2.lineTo(k * 32 + 64, h); g2.fill(); }
    }, { repeat: [rx, ry] });
    const M = {
      poleStripe: lam(0xffffff, { map: tiger(2, 5) }),
      pole: lam(0x3a3c40),
      cross: lam(0xffffff, { map: tiger(3, 0.4) }),
      black: lam(0x161616),
      box: lam(0xffffff, { map: tiger(1, 1) }),
      arm: lam(0xffffff, { map: tiger(10, 0.25) }),
      speaker: lam(0x9a9ea2),
      plate: new THREE.MeshLambertMaterial({ map: labelTexture('とまれみよ', { w: 256, h: 64, size: 40, bg: '#f4f2ec', fg: '#c8202a' }), side: THREE.DoubleSide }),
    };
    const G = {
      poleLow: new THREE.CylinderGeometry(0.075, 0.075, 2.0, 10),
      poleHigh: new THREE.CylinderGeometry(0.065, 0.065, 2.0, 8),
      bar: new THREE.BoxGeometry(1.15, 0.16, 0.035),
      back: new THREE.CylinderGeometry(0.24, 0.24, 0.03, 18).rotateX(Math.PI / 2),
      lens: new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14).rotateX(Math.PI / 2),
      visor: new THREE.BoxGeometry(0.28, 0.025, 0.14),
      beam: new THREE.BoxGeometry(0.9, 0.07, 0.06),
      plate: new THREE.PlaneGeometry(0.62, 0.16),
      speaker: new THREE.CylinderGeometry(0.09, 0.13, 0.16, 10),
      gear: new THREE.BoxGeometry(0.34, 0.6, 0.3),
    };
    this.crossings = CROSSINGS.map((cr) => {
      const g = new THREE.Group();
      const lights = [], arms = [];
      const ra = cr.railAngle;
      const rx = Math.cos(ra), rz = Math.sin(ra);          // 線路の向き
      const px = -rz, pz = rx;                               // 線路に直角（道の向き）
      const gy = terrainY(cr.x, cr.z);
      for (const side of [-1, 1]) {
        const ox = cr.x + px * side * 4.3 + rx * side * (cr.width / 2 + 0.6);
        const oz = cr.z + pz * side * 4.3 + rz * side * (cr.width / 2 + 0.6);
        // 警報機：正面（+Z）を、踏切に近づいてくる道のほうへ
        const post = new THREE.Group();
        post.position.set(ox, gy, oz);
        post.rotation.y = Math.atan2(side * px, side * pz);
        const low = new THREE.Mesh(G.poleLow, M.poleStripe);
        low.position.y = 1.0;
        const high = new THREE.Mesh(G.poleHigh, M.pole);
        high.position.y = 3.0;
        low.castShadow = high.castShadow = true;
        post.add(low, high);
        for (const a of [0.62, -0.62]) {
          const bar = new THREE.Mesh(G.bar, M.cross);
          bar.position.set(0, 3.45, 0.08);
          bar.rotation.z = a;
          post.add(bar);
        }
        const spk = new THREE.Mesh(G.speaker, M.speaker);
        spk.position.y = 4.05;
        post.add(spk);
        const beam = new THREE.Mesh(G.beam, M.black);
        beam.position.y = 2.6;
        post.add(beam);
        const plate = new THREE.Mesh(G.plate, M.plate);
        plate.position.set(0, 2.15, 0.08);
        post.add(plate);
        // 赤い灯：左右ひと組を、表と裏に。左右が交互に点滅する
        for (const lx of [-0.34, 0.34]) {
          const lensMat = new THREE.MeshLambertMaterial({ color: 0x5a1410, emissive: 0xff2a18, emissiveIntensity: 0 });
          for (const face of [1, -1]) {
            const back = new THREE.Mesh(G.back, M.black);
            back.position.set(lx, 2.6, face * 0.06);
            const lens = new THREE.Mesh(G.lens, lensMat);
            lens.position.set(lx, 2.6, face * 0.09);
            const visor = new THREE.Mesh(G.visor, M.black);
            visor.position.set(lx, 2.73, face * 0.14);
            post.add(back, lens, visor);
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3020, transparent: true, opacity: 0, depthWrite: false }));
            sp.position.set(lx, 2.6, face * 0.2);
            sp.scale.setScalar(0.8);
            sp.userData.lens = lensMat;
            post.add(sp);
            lights.push(sp);
          }
        }
        g.add(post);
        // 遮断機：しま模様の箱から、しま模様のさおが道をふさぐ
        const pivot = new THREE.Group();
        pivot.position.set(ox + px * side * 0.45, gy + 0.95, oz + pz * side * 0.45);
        pivot.rotation.y = -ra;
        const gear = new THREE.Mesh(G.gear, M.box);
        gear.position.y = -0.65;
        gear.castShadow = true;
        pivot.add(gear);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(cr.width + 0.6, 0.07, 0.07), M.arm);
        arm.position.x = -side * (cr.width + 0.6) / 2;
        const tilt = new THREE.Group();
        tilt.add(arm);
        pivot.add(tilt);
        tilt.userData.side = side;
        tilt.rotation.z = side * 1.45;
        g.add(pivot);
        arms.push(tilt);
      }
      this.group.add(g);
      return { ...cr, lights, arms, down: 0, rang: false };
    });
  }

  /**
   * 山陽本線の架線（電柱・はり・腕木・がいし・架線）と、山側の石垣（谷積み）。
   * 電柱はおよそ50mおきに複線の両外側へ立て、上に門形のはりを渡す。道や踏切の上には立てない
   */
  _catenary(railY) {
    const [TA, TB] = TRAIN_TRACKS;
    if (!TA) return;
    const lenA = roadLength(TA);
    const sampB = TB ? samplePath(TB, 2) : [];
    // TB 上の点と、その道のり
    const cumB = [0];
    for (let i = 1; i < sampB.length; i++) cumB.push(cumB[i - 1] + Math.hypot(sampB[i].x - sampB[i - 1].x, sampB[i].z - sampB[i - 1].z));
    const nearB = (x, z) => {
      let bi = -1, bd = 12;
      for (let i = 0; i < sampB.length; i++) { const d = Math.hypot(sampB[i].x - x, sampB[i].z - z); if (d < bd) { bd = d; bi = i; } }
      return bi < 0 ? null : { ...sampB[bi], s: cumB[bi], d: bd };
    };
    const blocked = (x, z) => nearAnyRoad(x, z, 0.7) || inBuilding(x, z) || CROSSINGS.some((c) => Math.hypot(c.x - x, c.z - z) < 12);
    const spans = [];   // { a: {x,z,s}, b: 同 or null }
    const mats = { mast: [], beam: [], arm: [], ins: [] };
    const box = (list, ax, ay, az, bx, by, bz, w) => list.push({ ax, ay, az, bx, by, bz, w });
    for (let s = 20; s < lenA - 20; s += 50) {
      // 立てられる場所を、少し前後にずらしながら探す。両側に立てられれば門形、片側だけなら片持ちのはり
      let ok = null;
      for (const ds of [0, 6, -6, 12, -12]) {
        const a = pointAlong(TA, (s + ds) / lenA);
        const b = nearB(a.x, a.z);
        let n = { x: -Math.sin(a.angle), z: Math.cos(a.angle) };
        if (b && b.d > 1.5) n = { x: (b.x - a.x) / b.d, z: (b.z - a.z) / b.d };
        let mA = { x: a.x - n.x * 2.5, z: a.z - n.z * 2.5 };
        let mB = b ? { x: b.x + n.x * 2.5, z: b.z + n.z * 2.5 } : { x: a.x + n.x * 2.5, z: a.z + n.z * 2.5 };
        if (blocked(mA.x, mA.z)) mA = null;
        if (blocked(mB.x, mB.z)) mB = null;
        if (!mA && !mB) continue;
        ok = { a: { ...a, s: s + ds }, b, n, mA, mB };
        break;
      }
      if (!ok) continue;
      const { a, b, n, mA, mB } = ok;
      const top = Math.max(railY(a.x, a.z), b ? railY(b.x, b.z) : -1e9) + 7.4;
      for (const m of [mA, mB]) if (m) box(mats.mast, m.x, terrainY(m.x, m.z) - 0.3, m.z, m.x, top + 0.5, m.z, 0.32);
      // はり：門形は電柱から電柱へ、片持ちは立てた側から、反対側の線の少し先まで
      const far = b || a;
      const from = mA || mB;
      const to = mA && mB ? mB : mA ? { x: far.x + n.x * 0.8, z: far.z + n.z * 0.8 } : { x: a.x - n.x * 0.8, z: a.z - n.z * 0.8 };
      box(mats.beam, from.x, top, from.z, to.x, top, to.z, 0.24);
      // 各線の上：はりからつり下げた棒と、横の腕木、がいし
      for (const t of [a, b]) {
        if (!t) continue;
        const ty = railY(t.x, t.z);
        const m = t === a ? (mA || mB) : (mB || mA);   // 近いほうの電柱から腕木をのばす
        box(mats.arm, t.x, top, t.z, t.x, ty + 6.5, t.z, 0.07);
        box(mats.arm, m.x, ty + 5.45, m.z, t.x, ty + 5.45, t.z, 0.06);
        box(mats.ins, t.x, ty + 6.55, t.z, t.x, ty + 6.2, t.z, 0.12);
        box(mats.ins, m.x * 0.2 + t.x * 0.8, ty + 5.45, m.z * 0.2 + t.z * 0.8, m.x * 0.4 + t.x * 0.6, ty + 5.45, m.z * 0.4 + t.z * 0.6, 0.1);
      }
      spans.push({ a, b });
    }
    // 角材を、向きと長さをつけた InstancedMesh に
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const inst = (list, mat) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(unit, mat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      list.forEach((e, i) => {
        v.set(e.bx - e.ax, e.by - e.ay, e.bz - e.az);
        const L = v.length();
        q.setFromUnitVectors(up, v.normalize());
        m4.compose(new THREE.Vector3((e.ax + e.bx) / 2, (e.ay + e.by) / 2, (e.az + e.bz) / 2), q, new THREE.Vector3(e.w, L, e.w));
        mesh.setMatrixAt(i, m4);
      });
      mesh.castShadow = true;
      this.group.add(mesh);
    };
    // 電柱：鉄のトラス（格子もようの透かし）
    const lattice = canvasTexture(32, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.strokeRect(2, 0, w - 4, h);
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(2, 0); g.lineTo(w - 2, h / 2); g.lineTo(2, h); g.moveTo(w - 2, 0); g.lineTo(2, h / 2); g.lineTo(w - 2, h); g.stroke();
    }, { repeat: [1, 6] });
    inst(mats.mast, lam(0x8e9194, { map: lattice, alphaTest: 0.5, side: THREE.DoubleSide }));
    inst(mats.beam, lam(0x8e9194, { map: lattice, alphaTest: 0.5, side: THREE.DoubleSide }));
    inst(mats.arm, lam(0x9a9ca0));
    inst(mats.ins, lam(0x6a4a3a));
    // 架線：電柱と電柱のあいだで少したわむ吊架線と、まっすぐなトロリ線。ところどころにハンガー
    const seg = [];
    const wire = (pts) => { for (let i = 0; i < pts.length - 1; i++) seg.push(...pts[i], ...pts[i + 1]); };
    for (const [track, key] of [[TA, 'a'], [TB, 'b']]) {
      if (!track) continue;
      const L = roadLength(track);
      for (let k = 0; k < spans.length - 1; k++) {
        const s0 = key === 'a' ? spans[k].a.s : spans[k].b?.s, s1 = key === 'a' ? spans[k + 1].a.s : spans[k + 1].b?.s;
        if (s0 == null || s1 == null || s1 <= s0 || s1 - s0 > 120) continue;
        const mess = [], cont = [];
        const N = Math.max(4, Math.round((s1 - s0) / 6));
        for (let i = 0; i <= N; i++) {
          const f = i / N;
          const p = pointAlong(track, (s0 + (s1 - s0) * f) / L);
          const y = railY(p.x, p.z);
          mess.push([p.x, y + 6.3 - Math.sin(f * Math.PI) * 0.55, p.z]);
          cont.push([p.x, y + 5.25, p.z]);
          if (i > 0 && i < N) seg.push(p.x, y + 6.3 - Math.sin(f * Math.PI) * 0.55, p.z, p.x, y + 5.25, p.z);
        }
        wire(mess);
        wire(cont);
      }
    }
    if (seg.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      this.group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2a2a2c })));
    }

    // ---- 山側の石垣：線路の外側の地面が高く切り立っているところに、谷積み（斜めに組んだ石）の擁壁 ----
    const stone = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#5e5850';
      g.fillRect(0, 0, w, h);
      const r2 = seededRandom('tanizumi');
      const step = 32;
      for (let y = -step; y < h + step; y += step / 2) {
        for (let x = -step; x < w + step; x += step) {
          const ox = ((y / (step / 2)) % 2) * (step / 2);
          const v = 120 + Math.floor(r2() * 50);
          g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
          g.beginPath();
          const cx = x + ox, cy = y;
          g.moveTo(cx, cy - step / 2 + 2); g.lineTo(cx + step / 2 - 2, cy); g.lineTo(cx, cy + step / 2 - 2); g.lineTo(cx - step / 2 + 2, cy);
          g.closePath();
          g.fill();
        }
      }
    }, { repeat: [1, 1] });
    const wb = new TriBatch();
    const white = new THREE.Color(0xffffff), capC = new THREE.Color(0x8a857c);
    const sampA = samplePath(TA, 8);
    for (const track of [TA, TB]) {
      if (!track) continue;
      const pts = samplePath(track, 4);
      // まず各点で、壁を立てるか・高さを調べる
      const col = pts.map((p) => {
        // 複線の外側（TA は TB の反対側、TB は TA の反対側）
        let n = { x: -Math.sin(p.angle), z: Math.cos(p.angle) };
        const other = track === TA ? nearB(p.x, p.z) : null;
        if (other && other.d > 1.5) n = { x: (other.x - p.x) / other.d, z: (other.z - p.z) / other.d };
        else if (track === TB) {
          let bd = 1e9, best = null;
          for (const q of sampA) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; best = q; } }
          if (best && bd < 12 && bd > 1.5) n = { x: (p.x - best.x) / bd, z: (p.z - best.z) / bd };
        }
        const out = track === TA ? -1 : 1;
        const ox = n.x * out, oz = n.z * out;
        const wx = p.x + ox * 3.3, wz = p.z + oz * 3.3;
        const y0 = railY(p.x, p.z) - 0.2;
        const rise = Math.max(...[3.5, 5.5, 8].map((d) => terrainY(p.x + ox * d, p.z + oz * d))) - y0;
        const ok = rise > 1.8 && !nearAnyRoad(wx, wz, 1.2) && !CROSSINGS.some((c) => Math.hypot(c.x - wx, c.z - wz) < 9);
        return { ok, x: wx, z: wz, ox, oz, y0, rise };
      });
      // 高さはなめらかに。12m より短い切れはしは立てない
      for (let i = 0; i < col.length; i++) {
        if (!col[i].ok) continue;
        const near = [col[i - 1], col[i], col[i + 1]].filter((c) => c && c.ok);
        col[i].y1 = col[i].y0 + Math.min(9, near.reduce((a, c) => a + c.rise, 0) / near.length + 0.3);
      }
      let run = [];
      const flush = () => {
        if (run.length >= 4) {
          for (let k = 0; k < run.length - 1; k++) {
            const a = run[k], b = run[k + 1];
            const u0 = a.i * 4 / 3, u1 = b.i * 4 / 3;
            wb.quad([a.x, a.y0, a.z], [b.x, b.y0, b.z], [b.x, b.y1, b.z], [a.x, a.y1, a.z], white, [u0, a.y0 / 3, u1, b.y0 / 3, u1, b.y1 / 3, u0, a.y1 / 3]);
            // 上の笠石
            wb.quad([a.x, a.y1, a.z], [b.x, b.y1, b.z], [b.x + b.ox * 0.5, b.y1, b.z + b.oz * 0.5], [a.x + a.ox * 0.5, a.y1, a.z + a.oz * 0.5], capC);
          }
        }
        run = [];
      };
      col.forEach((c, i) => { if (c.ok) run.push({ ...c, i }); else flush(); });
      flush();
    }
    if (wb.pos.length) {
      const wall = new THREE.Mesh(wb.build(), lam(0xffffff, { map: stone, vertexColors: true, side: THREE.DoubleSide }));
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.group.add(wall);
    }
  }

  // ---------- 千光寺山ロープウェイ ----------
  _ropeway() {
    const { base, top } = ROPEWAY;
    const by = terrainY(base.x, base.z), ty = terrainY(top.x, top.z);
    // 駅舎そのものは OpenStreetMap の建物で立っているので、ここではゴンドラの乗り場の屋根だけ
    const st = (p, y) => {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 5), lam(0x7a2a22));
      roof.position.set(p.x, y + 6.2, p.z);
      roof.castShadow = true;
      this.group.add(roof);
    };
    st(base, by);
    st(top, ty);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1), new THREE.MeshBasicMaterial({ map: labelTexture('千光寺山ロープウェイ', { w: 768, h: 128, size: 64, bg: '#7a2a22', fg: '#f6ead8' }), side: THREE.DoubleSide }));
    sign.position.set(base.x, by + 7.2, base.z - 4.6);
    this.group.add(sign);
    this.ropeA = new THREE.Vector3(base.x, by + 8.5, base.z);
    this.ropeB = new THREE.Vector3(top.x, ty + 7.5, top.z);
    // 上りと下りのゴンドラは、左右に分かれた別々の索道（すれちがってもぶつからない）
    const hx = top.x - base.x, hz = top.z - base.z, hl = Math.hypot(hx, hz);
    this.ropeSide = new THREE.Vector3(-hz / hl, 0, hx / hl).multiplyScalar(2.8);
    // 山肌にゴンドラがもぐらないよう、地面から十分に離れるまでケーブルを持ち上げる
    const N = 80;
    const deficit = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      let need = 0;
      for (const sd of [-1, 0, 1]) {
        const p = this._cableBase(t).addScaledVector(this.ropeSide, sd);
        need = Math.max(need, terrainY(p.x, p.z) + 11 - p.y);   // ゴンドラの床（ケーブルの3.3m下）が地面から8mほど上
      }
      deficit.push(Math.max(0, need));
    }
    // 持ち上げはなめらかに（どの点も、まわりの必要量から、ゆるい傾きで下がっていく包みにする）
    this.cableLift = deficit.map((_, i) => Math.max(...deficit.map((d, j) => d - Math.abs(i - j) * 0.9)));
    this.cableLift[0] = this.cableLift[N] = 0;
    const wire = new THREE.LineBasicMaterial({ color: 0x333333 });
    for (const sd of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 60; i++) pts.push(this.cablePoint(i / 60, sd));
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
    }
    // 支柱：両方のケーブルをかける腕木つき。いちばん持ち上げたあたりと、その間に
    const towerTs = [0.33, 0.66];
    const peak = this.cableLift.indexOf(Math.max(...this.cableLift)) / N;
    if (Math.max(...this.cableLift) > 1 && towerTs.every((t) => Math.abs(t - peak) > 0.12)) towerTs.push(peak);
    const steel = lam(0x8a8a88);
    for (const t of towerTs) {
      const p = this.cablePoint(t, 0);
      const gy = terrainY(p.x, p.z);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, Math.max(1, p.y - gy + 1.2), 0.8), steel);
      tower.position.set(p.x, (p.y + 0.6 + gy) / 2, p.z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 7), steel);
      arm.position.set(p.x, p.y + 0.6, p.z);
      arm.rotation.y = Math.atan2(this.ropeSide.x, this.ropeSide.z);
      tower.castShadow = true;
      this.group.add(tower, arm);
    }
    this.gondolas = [0, 0.5].map((phase) => {
      const g = new THREE.Group();
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.2), lam(0xe0e4e8));
      cab.position.y = -2.4;
      cab.castShadow = true;
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.4, 2.22), lam(0xb03a2e));
      band.position.y = -1.6;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), lam(0x333333));
      arm.position.y = -0.7;
      const simple = new THREE.Group();
      simple.add(cab, band, arm);
      g.add(simple);
      g.rotation.y = -Math.atan2(top.z - base.z, top.x - base.x);
      this.group.add(g);
      return { g, phase, simple, side: phase === 0 ? -1 : 1 };
    });
    // Blender のゴンドラ（窓の大きいクリーム色の車体に赤い帯）
    if (USE_MODELS) {
      this._swapModel('gondola', null, (g) => { g.visible = false; }).then((proto) => {
        if (!proto) return;
        this.group.remove(proto);
        for (const gd of this.gondolas) {
          const m = proto.clone();
          m.visible = true;
          gd.g.remove(gd.simple);
          gd.g.add(m);
        }
      });
    }
  }

  /** ケーブルのもとの形：駅と駅をまっすぐ結んで、少したわませる */
  _cableBase(t) {
    const p = new THREE.Vector3().lerpVectors(this.ropeA, this.ropeB, t);
    p.y -= Math.sin(t * Math.PI) * 5;
    return p;
  }

  /** ロープウェイのケーブル上の点（t=0 山麓駅、1 山頂駅）。side は左右の索道（-1 = 乗るほう、1 = もう1台） */
  cablePoint(t, side = -1) {
    const p = this._cableBase(t).addScaledVector(this.ropeSide, side);
    if (this.cableLift) {
      const f = Math.min(1, Math.max(0, t)) * (this.cableLift.length - 1), i = Math.floor(f), k = f - i;
      const a = this.cableLift[i], b = this.cableLift[Math.min(i + 1, this.cableLift.length - 1)];
      p.y += a + (b - a) * k;
    }
    return p;
  }

  /** 千光寺山の頂上の展望台（デッキ）。海側へ張り出した木のデッキと手すり */
  _summitDeck() {
    const d = SUMMIT.deck;
    const gy = terrainY(d.x, d.z);
    const top = gy + 4;
    this.deckTop = top;
    const g = new THREE.Group();
    const wood = lam(0x9a7a58), metal = lam(0x50565c);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(18, 0.3, 4.5), wood);
    floor.position.y = top - gy;
    floor.castShadow = floor.receiveShadow = true;
    g.add(floor);
    for (const x of [-8, -2.7, 2.7, 8]) for (const z of [-1.9, 1.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, top - gy + 2, 8), metal);
      post.position.set(x, (top - gy) / 2 - 1, z);
      g.add(post);
    }
    for (const z of [-2.2, 2.2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(18, 0.06, 0.06), metal);
      rail.position.set(0, top - gy + 1.05, z);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(18, 0.9), new THREE.MeshLambertMaterial({ color: 0xe4eef2, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
      glass.position.set(0, top - gy + 0.55, z);
      g.add(rail, glass);
    }
    // デッキは尾道水道（南南西）へ向ける
    g.rotation.y = 0.35;
    g.position.set(d.x, gy, d.z);
    this.group.add(g);
    this.interactables.push({ type: 'deck', name: '展望台', x: SUMMIT.x, z: SUMMIT.z, radius: 9, seat: { x: d.x + Math.sin(0.35) * -1.6, z: d.z - Math.cos(0.35) * 1.6, y: top + 0.43, yaw: 0, kind: 'deck' } });
  }

  // ---------- 名所：天寧寺の三重塔、艮神社、千光寺 ----------
  _landmarks() {
    const poi = (n) => POIS.find((p) => p.n === n);
    const pagoda = poi('天寧寺三重塔');
    if (pagoda) this._pagoda(pagoda.x, pagoda.z);
    const ushitora = poi('艮神社');
    if (ushitora) this._shrine(ushitora.x, ushitora.z);
    const senkoji = poi('千光寺');
    if (senkoji) {
      // 千光寺の朱塗りの本堂（赤堂）
      const y = terrainY(senkoji.x, senkoji.z);
      const simple = new THREE.Group();
      const hall = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 6), lam(0xb8402e));
      hall.position.set(senkoji.x, y + 1.8, senkoji.z);
      hall.castShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2.6, 4), lam(0x3a3f46));
      roof.rotation.y = Math.PI / 4;
      roof.position.set(senkoji.x, y + 5.1, senkoji.z);
      roof.scale.set(1, 1, 0.9);
      simple.add(hall, roof);
      this.group.add(simple);
      // 崖の上に張り出した懸造りの本堂と、鐘楼「驚音楼」、大きな岩。舞台は坂の下（海）へ向ける
      // 本堂・舞台、鐘楼、裏の大岩は、石段や参道にかからない場所と向きに（すり抜けないように）
      const fit = MODEL_FITS.senkoji;
      this._swapModel('senkoji', simple, (g) => {
        g.position.set(fit.x, terrainY(fit.x, fit.z) - 0.3, fit.z);
        g.rotation.y = fit.yaw;
        this._addSolids(fit, MODEL_RECTS.senkoji);
      });
    }
  }

  _pagoda(x, z) {
    const g = new THREE.Group();
    const wood = lam(0x4a3428), roof = lam(0x33373d);
    let y = 0;
    [5.2, 4.5, 3.8].forEach((s, i) => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(s * 0.7, 3.4, s * 0.7), wood);
      body.position.y = y + 1.7;
      body.castShadow = true;
      g.add(body);
      const rf = new THREE.Mesh(new THREE.ConeGeometry(s * 0.95, 1.6, 4, 1, true), roof);
      rf.rotation.y = Math.PI / 4;
      rf.position.y = y + 3.9;
      rf.castShadow = true;
      g.add(rf);
      const eave = new THREE.Mesh(new THREE.ConeGeometry(s * 0.95, 0.5, 4), roof);
      eave.rotation.y = Math.PI / 4;
      eave.position.y = y + 3.4;
      eave.scale.y = -1;
      g.add(eave);
      y += 3.9 - i * 0.1;
    });
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 5, 6), lam(0x6b5a3a));
    spire.position.y = y + 2.5;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(5, 1.5, 5), lam(0x8a857a));
    plinth.position.y = -0.5;
    g.add(spire, plinth);
    g.position.set(x, terrainY(x, z) - 0.2, z);
    g.scale.setScalar(1.45);
    g.rotation.y = 0.3;
    this.group.add(g);
    // Blender で作った三重塔（assets/models/pagoda.glb）が読めたら差しかえる。読めなければ上の簡単な塔のまま
    this._pagodaModel(x, z, g);
  }

  /**
   * Blender のモデルを読んで、簡単な形（simple）と差しかえる。
   * 素材は町のほかの建物と同じ光の当たり方になるよう、色だけ受けついで Lambert に。
   * place(g, model) で位置や向きを決める。読めなければ simple のまま
   */
  async _swapModel(name, simple, place) {
    if (!USE_MODELS) return null;
    try {
      const model = await loadModel(name);
      const mats = new Map();
      model.traverse((o) => {
        if (!o.isMesh) return;
        const src = o.material;
        if (!mats.has(src)) mats.set(src, this._modelMaterial(src));
        o.material = mats.get(src);
        o.castShadow = !o.material.transparent;
        o.receiveShadow = true;
      });
      const g = new THREE.Group();
      g.add(model);
      place(g, model);
      this.group.add(g);
      if (simple) {
        simple.parent?.remove(simple);
        simple.traverse((o) => o.geometry?.dispose());
      }
      (this.models ||= {})[name] = g;
      return g;
    } catch (e) {
      console.warn(`${name} のモデルを読めなかったので、簡単な形のままにします`, e);
      return null;
    }
  }

  /** 模型の中の長方形を、歩けない場所として登録する */
  _addSolids(fit, rects) {
    const c = Math.cos(fit.yaw), sn = Math.sin(fit.yaw);
    for (const [a, b, e, f] of rects) {
      const lx = (a + b) / 2, lz = (e + f) / 2;
      addSolid(fit.x + lx * c + lz * sn, fit.z - lx * sn + lz * c, b - a, f - e, fit.yaw);
    }
  }

  _modelMaterial(src) {
    const m = this._modelMaterialFor(src.name || '', src.color.getHex());
    m.name = src.name;
    src.dispose();
    return m;
  }

  _modelMaterialFor(n, color) {
    if (/glass/.test(n)) {
      // ガラス：夜は中の明かりで、ほんのり暖かく光る
      const m = lam(color, { transparent: true, opacity: 0.42, depthWrite: false, emissive: 0xffc890, emissiveIntensity: 0 });
      this.glowMats.push({ mat: m, base: 0, add: 0.55 });
      return m;
    }
    if (/interior_light/.test(n)) {
      // 駅の中の明かり：夜になると灯る
      const m = lam(color, { emissive: 0xffd29a, emissiveIntensity: 0.15 });
      this.glowMats.push({ mat: m, base: 0.15, add: 1.9 });
      return m;
    }
    if (/gold/.test(n)) return lam(color, { emissive: 0x2a2208 });
    return lam(color);
  }

  _pagodaModel(x, z, simple) {
    this._swapModel('pagoda', simple, (g) => {
      // 坂に建つので、基壇の下を石垣で地面まで埋める
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(9.6, 3, 9.6), lam(0xb3ab9c));
      skirt.position.y = -1.5;
      skirt.receiveShadow = true;
      g.add(skirt);
      const y = Math.min(...[-4.8, 4.8].flatMap((dx) => [-4.8, 4.8].map((dz) => terrainY(x + dx, z + dz))));
      g.position.set(x, Math.max(y, terrainY(x, z) - 0.6), z);
      g.rotation.y = 0.3;
    }).then((g) => { this.pagodaModel = g; });
  }

  /** 駅舎：OSM の輪郭のいちばん長い辺の向きにそろえ、正面（+Z）を駅前広場へ */
  _stationModel() {
    const poly = this.stationPoly;
    const cx = poly.reduce((s2, p) => s2 + p[0], 0) / poly.length, cz = poly.reduce((s2, p) => s2 + p[1], 0) / poly.length;
    let best = 0, ang = 0;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L > best) { best = L; ang = Math.atan2(bz - az, bx - ax); }
    }
    // 輪郭を長い辺の向きに回して、大きさをはかる
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    const us = poly.map(([x, z]) => (x - cx) * ca - (z - cz) * sa), vs = poly.map(([x, z]) => (x - cx) * sa + (z - cz) * ca);
    const len = Math.max(...us) - Math.min(...us), dep = Math.max(...vs) - Math.min(...vs);
    const mx = cx + ((Math.max(...us) + Math.min(...us)) / 2) * Math.cos(ang) - ((Math.max(...vs) + Math.min(...vs)) / 2) * Math.sin(ang);
    const mz = cz + ((Math.max(...us) + Math.min(...us)) / 2) * Math.sin(ang) + ((Math.max(...vs) + Math.min(...vs)) / 2) * Math.cos(ang);
    const yMin = Math.min(...poly.map(([x, z]) => groundY(x, z)));
    this._swapModel('station', this.stationSimple, (g, model) => {
      // モデルは 50m × 約22m。輪郭に合わせて少しだけ伸び縮みさせる
      model.scale.set(Math.min(1.15, Math.max(0.8, len / 50)), 1, Math.min(1.15, Math.max(0.8, dep / 22)));
      g.position.set(mx, yMin, mz);
      // 長い辺の向きに +X をそろえる。正面 +Z は、駅前広場（線路と反対の、海側）を向く
      g.rotation.y = -ang;
      const C = this.stationCenter;
      const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y);
      if (C && (C.x - mx) * front.x + (C.z - mz) * front.z < 0) g.rotation.y += Math.PI;
      // 入口の上の看板
      let sign = null;
      model.traverse((o) => { if (o.isMesh && o.material.name === 'sign') sign = o; });
      const box = new THREE.Box3();
      if (sign) box.setFromObject(sign); else box.set(new THREE.Vector3(-4, 4.2, 12), new THREE.Vector3(4, 5.2, 12.1));
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: labelTexture('尾道駅', { w: 512, h: 128, size: 76, bg: '#2a2c30', fg: '#f4efe4' }), emissive: 0xffffff, emissiveIntensity: 0.2 }));
      label.material.emissiveMap = label.material.map;
      this.specialSignMats.push(label.material);
      const size = box.getSize(new THREE.Vector3());
      label.scale.set(Math.min(size.x * 0.9, size.y * 4), size.y * 0.85, 1);
      label.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z + 0.03);
      model.add(label);
    });
  }

  _shrine(x, z) {
    const y = terrainY(x, z);
    const simple = new THREE.Group();
    this.group.add(simple);
    const vermilion = lam(0xc8442e);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(6, 3.5, 5), lam(0x7a5a3e));
    hall.position.set(x, y + 1.5, z + 3);
    hall.castShadow = true;
    const hallRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.4, 4), lam(0x3a3f46));
    hallRoof.rotation.y = Math.PI / 4;
    hallRoof.position.set(x, y + 4.3, z + 3);
    simple.add(hall, hallRoof);
    // 鳥居は、いちばん近い道の上に
    const torii = new THREE.Group();
    for (const sx of [-1.4, 1.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 3.6, 10), vermilion);
      post.position.set(sx, 1.8, 0);
      torii.add(post);
    }
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.28, 0.4), lam(0x2a2422));
    kasagi.position.y = 3.7;
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 0.25), vermilion);
    nuki.position.y = 3.1;
    torii.add(kasagi, nuki);
    torii.position.set(x, terrainY(x, z - 6), z - 6);
    simple.add(torii);
    // 境内の大きな楠
    const kusu = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 8, 8), lam(0x4a3a2e));
    trunk.position.y = 4;
    kusu.add(trunk);
    for (let i = 0; i < 6; i++) {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + this.r() * 1.5, 1), lam(0x2f4a28, { flatShading: true }));
      crown.position.set((this.r() - 0.5) * 6, 8 + this.r() * 4, (this.r() - 0.5) * 6);
      crown.castShadow = true;
      kusu.add(crown);
    }
    kusu.position.set(x + 7, terrainY(x + 7, z + 1), z + 1);
    simple.add(kusu);
    // 拝殿・本殿・狛犬・石灯籠・鳥居と、大きな楠。参道（正面）は坂の下へ
    // 拝殿・本殿・楠の幹は道にかからず、参道（鳥居から拝殿まで）ができるだけ道の上にくる場所と向きに
    const fit = MODEL_FITS.ushitora;
    this._swapModel('ushitora', simple, (g) => {
      g.position.set(fit.x, terrainY(fit.x, fit.z) - 0.15, fit.z);
      g.rotation.y = fit.yaw;
      this._addSolids(fit, MODEL_RECTS.ushitora);
    });
  }

  // ---------- 渡船のりば・ベンチ ----------
  _piersAndBenches() {
    const pontoonMat = lam(0x9a9890), hutMat = lam(0xe8e2d4);
    const signTex = labelTexture('渡船のりば', { w: 512, h: 128, size: 72, bg: '#1f3b5a', fg: '#f4efe4' });
    const mukaiTex = labelTexture('向 島 行 渡 船 の り ば', { w: 1024, h: 128, size: 76, bg: '#f4f2ec', fg: '#1f3b8a' });
    const archMat = lam(0x5e9a72, { side: THREE.DoubleSide }), poleMat = lam(0xe8e6e0);
    FERRY_ROUTES.forEach((route, ri) => {
      for (const end of [route.a, route.b]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 8), pontoonMat);
        p.position.set(end.x, SEA_Y + 0.6, end.z);
        p.receiveShadow = true;
        this.group.add(p);
      }
      // 尾道側に待合の小屋
      const a = route.a;
      const dir = Math.atan2(route.b.z - a.z, route.b.x - a.x);
      const hx = a.x - Math.cos(dir) * 14, hz = a.z - Math.sin(dir) * 14;
      const hy = terrainY(hx, hz);
      if (!nearAnyRoad(hx, hz, 0)) {
        const hut = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3), hutMat);
        hut.position.set(hx, hy + 1.3, hz);
        hut.castShadow = true;
        this.group.add(hut);
      }
      const ax = a.x - Math.cos(dir) * 8, az = a.z - Math.sin(dir) * 8, ay = terrainY(ax, az);
      if (ri === 0) {
        // 尾道渡船（向島行）：のりばの入口に、緑の屋根のアーチ
        const arch = new THREE.Group();
        arch.position.set(ax, ay, az);
        arch.rotation.y = -dir + Math.PI / 2;
        // 半円筒の屋根（軸は通路の向き）
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 3, 24, 1, true, Math.PI / 2, Math.PI), archMat);
        roof.rotation.x = Math.PI / 2;
        roof.position.y = 0.6;
        arch.add(roof);
        for (const sx of [-3.1, 3.1]) {
          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), poleMat);
          pole.position.set(sx, 0.35, 0);
          arch.add(pole);
        }
        for (const flip of [0, Math.PI]) {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.55), new THREE.MeshBasicMaterial({ map: mukaiTex }));
          sign.position.set(0, 3.0, 0);
          sign.rotation.y = flip;
          sign.translateZ(1.52);
          arch.add(sign);
        }
        this.group.add(arch);
      } else {
        for (const flip of [0, Math.PI]) {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: signTex }));
          sign.position.set(ax, ay + 3.2, az);
          sign.rotation.y = -dir + Math.PI / 2 + flip;
          sign.translateZ(0.02);
          this.group.add(sign);
        }
      }
    });
    // 海沿いのベンチ：木の背もたれつきと、雨風で銀色になった板張りの広い腰掛け
    const boxes = [];
    const r = this.r;
    for (const b of BENCHES) {
      const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
      const put = (lx, ly, lz, sx, sy, sz, color, rx = 0) => boxes.push({
        x: b.x + lx * c + lz * sn, y: b.y + ly, z: b.z - lx * sn + lz * c, sx, sy, sz, ry: b.yaw, rx, color,
      });
      if (b.style === 'deck') {
        const g = 0.55 + r() * 0.06;
        const grey = new THREE.Color(g, g * 0.98, g * 0.93);
        for (let i = 0; i < 8; i++) put(0, 0.42, -0.42 + i * 0.12, 2.2, 0.045, 0.1, grey.clone().offsetHSL(0, 0, (r() - 0.5) * 0.05));
        for (const sx of [-0.95, 0, 0.95]) put(sx, 0.2, 0, 0.08, 0.4, 0.9, '#5d5a55');
      } else {
        const wood = new THREE.Color(0x8a6a4a).offsetHSL(0, 0, (r() - 0.5) * 0.06);
        for (let i = 0; i < 3; i++) put(0, 0.45, -0.16 + i * 0.16, 1.8, 0.05, 0.12, wood);
        put(0, 0.72, 0.24, 1.8, 0.35, 0.05, wood, -0.15);
        for (const sx of [-0.75, 0.75]) put(sx, 0.22, 0, 0.06, 0.45, 0.45, '#2f3336');
      }
    }
    this.group.add(instancedChunks(boxes, lam(0xffffff)));

    // 海沿いの遊歩道の、丸い笠の街灯（ベンチふたつにひとつ、緑の柱に乳白の玉がふたつ）
    const poles = [], globes = [];
    BENCHES.forEach((b, i) => {
      if (i % 2) return;
      const x = b.x + Math.cos(b.yaw) * 1.7, z = b.z - Math.sin(b.yaw) * 1.7;
      const y = groundY(x, z);
      poles.push({ x, y: y + 2.1, z, sx: 0.12, sy: 4.2, sz: 0.12, color: '#2f4a44' });
      for (const side of [-1, 1]) {
        const gx = x + Math.cos(b.yaw) * side * 0.32, gz = z - Math.sin(b.yaw) * side * 0.32;
        globes.push({ x: gx, y: y + 4.05 + (side > 0 ? 0.12 : 0), z: gz, sx: 0.42, sy: 0.42, sz: 0.42 });
        this.lampPositions.push([gx, y + 4.1, gz]);
      }
    });
    this.group.add(instancedChunks(poles, lam(0xffffff), { receive: false, geo: new THREE.CylinderGeometry(0.5, 0.6, 1, 6) }));
    this.globeMat = new THREE.MeshLambertMaterial({ color: 0xf4ead6, emissive: 0xffa040, emissiveIntensity: 0 });
    this.group.add(instancedChunks(globes, this.globeMat, { cast: false, receive: false, geo: new THREE.SphereGeometry(0.5, 12, 10) }));
  }

  /** 猫の細道の、猫の絵を描いた丸い石 */
  _nekoStones() {
    const tex = canvasTexture(256, 128, (g, w, h) => {
      g.fillStyle = '#f2ece0';
      g.fillRect(0, 0, w, h);
      const cx = w * 0.25, cy = h * 0.5;
      g.fillStyle = '#e09a50';
      g.beginPath(); g.ellipse(cx, cy, 30, 24, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(cx - 26, cy - 10); g.lineTo(cx - 22, cy - 36); g.lineTo(cx - 6, cy - 20); g.fill();
      g.beginPath(); g.moveTo(cx + 26, cy - 10); g.lineTo(cx + 22, cy - 36); g.lineTo(cx + 6, cy - 20); g.fill();
      g.fillStyle = '#222';
      g.beginPath(); g.arc(cx - 10, cy - 2, 3, 0, Math.PI * 2); g.arc(cx + 10, cy - 2, 3, 0, Math.PI * 2); g.fill();
    });
    const geo = new THREE.SphereGeometry(0.3, 16, 10);
    for (const road of ROADS.filter((r) => r.name === '猫の細道')) {
      const s = samplePath(road.pts, 1);
      for (let i = 5; i < s.length; i += 11) {
        const p = s[i];
        const side = i % 2 ? 1 : -1;
        const x = p.x - Math.sin(p.angle) * side * (road.width / 2 - 0.2), z = p.z + Math.cos(p.angle) * side * (road.width / 2 - 0.2);
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, color: new THREE.Color().setHSL(0.08, 0.2, 0.85 + this.r() * 0.1) }));
        m.scale.set(1, 0.75, 1);
        m.position.set(x, terrainY(x, z) + 0.2, z);
        m.rotation.y = -p.angle + side * Math.PI / 2 + Math.PI;
        m.castShadow = true;
        this.group.add(m);
      }
    }
  }

  /** 空き家の窓の左手に見える松 */
  _pine() {
    const leaf = lam(0x2f4a2a, { flatShading: true });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    [[-8, 5.5, -13, 1.6], [-9.5, 4.7, -14.5, 1.9], [-7.2, 6.4, -15, 1.3], [-10.6, 6, -12.5, 1.5]].forEach(([x, dy, z, s]) => {
      const m = new THREE.Mesh(geo, leaf);
      m.position.set(x, terrainY(x, z) + dy, z);
      m.scale.set(s * 1.4, s * 0.6, s);
      m.castShadow = true;
      this.group.add(m);
    });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 6, 6), lam(0x4a3a2e));
    trunk.position.set(-9, terrainY(-9, -14) + 2.6, -14);
    trunk.rotation.z = -0.3;
    this.group.add(trunk);
  }

  /** 夜の灯り（街灯）。Points 1つでまとめて描く */
  /**
   * 尾道駅前：駅舎の前の石畳の広場、海ぎわの芝生（港の緑地）、海沿いの柵、横断歩道、時計の柱。
   * 駅舎の2階から見た写真のように、広場の先に道路と芝生、その向こうに尾道水道と向島のクレーン。
   */
  _stationFront() {
    const st = POIS.find((p) => p.n === 'JR尾道駅');
    if (!st) return;
    const C = { x: st.x - 5, z: st.z - 60 }, R = 120;
    this.stationLawn = [];   // 芝生のマス（灯りまつりの模様に使う）
    this.stationCenter = C;
    this.inStationArea = (x, z) => Math.hypot(x - C.x, z - C.z) < R && terrainY(x, z) - SEA_Y < 8;
    const water = (x, z) => demAt(x, z) < SEA_Y;
    const nearWater = (x, z, d) => {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        for (let r = 3; r <= d; r += 3) if (water(x + Math.cos(a) * r, z + Math.sin(a) * r)) return r;
      }
      return Infinity;
    };
    const tb = new TriBatch();
    const cell = 2;
    const col = new THREE.Color();
    for (let x = C.x - R; x < C.x + R; x += cell) {
      for (let z = C.z - R; z < C.z + R; z += cell) {
        const cx = x + cell / 2, cz = z + cell / 2;
        if (!this.inStationArea(cx, cz)) continue;
        if (demAt(cx, cz) < SEA_Y + 0.8 || nearAnyRoad(cx, cz, 0.1) || inBuilding(cx, cz) || inSolid(cx, cz)) continue;
        const w = nearWater(cx, cz, 30);
        const lawn = w > 5 && w < 30;
        if (lawn) this.stationLawn.push([cx, cz]);
        const k = (Math.floor(x / cell) + Math.floor(z / cell)) & 1;
        if (lawn) col.setRGB(0.42 + this.r() * 0.05, 0.56 + this.r() * 0.05, 0.3);
        else if (w <= 5) col.setRGB(0.6, 0.59, 0.56);                 // 海ぎわの遊歩道
        else col.setRGB(k ? 0.66 : 0.6, k ? 0.65 : 0.59, k ? 0.62 : 0.57); // 石畳の広場（市松）
        const P = (px, pz) => [px, groundY(px, pz) + 0.035, pz];
        tb.quad(P(x, z), P(x, z + cell), P(x + cell, z + cell), P(x + cell, z), col);
      }
    }
    const ground = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.7, polygonOffsetUnits: -1 }));
    ground.receiveShadow = true;
    this.group.add(ground);

    // 海沿いの柵（黒い柱と手すり）
    const fence = [];
    for (const line of COAST) {
      for (const p of samplePath(line, 2.5)) {
        if (!this.inStationArea(p.x, p.z)) continue;
        let nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        if (terrainY(p.x + nx * 4, p.z + nz * 4) < terrainY(p.x - nx * 4, p.z - nz * 4)) { nx = -nx; nz = -nz; }
        const x = p.x + nx * 0.4, z = p.z + nz * 0.4, y = groundY(x, z);
        fence.push({ x, y: y + 0.55, z, sx: 0.08, sy: 1.1, sz: 0.08, color: '#2a2e30' });
        fence.push({ x, y: y + 1.08, z, sx: 2.55, sy: 0.06, sz: 0.06, ry: -p.angle, color: '#2a2e30' });
        fence.push({ x, y: y + 0.6, z, sx: 2.55, sy: 0.04, sz: 0.04, ry: -p.angle, color: '#2a2e30' });
      }
    }
    this.group.add(instancedChunks(fence, lam(0xffffff), { receive: false }));

    // 横断歩道（駅前の広い道）
    const zebra = new TriBatch();
    const white = new THREE.Color(0.92, 0.92, 0.9);
    for (const road of ROADS) {
      if (road.surface !== 'asphalt' || road.width < 5.5) continue;
      for (const p of samplePath(road.pts, 38).slice(1, -1)) {
        if (!this.inStationArea(p.x, p.z)) continue;
        const tx = Math.cos(p.angle), tz = Math.sin(p.angle), nx = -tz, nz = tx;
        const n = Math.floor((road.width - 0.6) / 0.9);
        for (let k = 0; k < n; k++) {
          const o = -road.width / 2 + 0.5 + k * 0.9;
          const Q = (u, v) => { const x = p.x + tx * u + nx * v, z = p.z + tz * u + nz * v; return [x, groundY(x, z) + 0.075, z]; };
          zebra.quad(Q(-1.5, o), Q(-1.5, o + 0.45), Q(1.5, o + 0.45), Q(1.5, o), white);
        }
      }
    }
    this.group.add(new THREE.Mesh(zebra.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })));

    // 時計の柱（広場のまん中あたり、うすい青緑）
    let clock = null;
    for (let r = 0; r < 60 && !clock; r += 3) {
      for (let k = 0; k < 8 && !clock; k++) {
        const x = st.x + Math.cos(k) * r, z = st.z - 30 + Math.sin(k) * r;
        if (!nearAnyRoad(x, z, 1) && !inBuilding(x, z) && !inSolid(x, z) && demAt(x, z) > SEA_Y + 1 && nearAnyRoad(x, z, 6)) clock = { x, z };
      }
    }
    if (clock) {
      const g = new THREE.Group();
      g.position.set(clock.x, groundY(clock.x, clock.z), clock.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 3.6, 8), lam(0x7fa898));
      pole.position.y = 1.8;
      g.add(pole);
      const face = canvasTexture(128, 128, (c, w, h) => {
        c.fillStyle = '#f6f3ea'; c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#2a2e30'; c.lineWidth = 5; c.stroke();
        c.lineWidth = 6; c.beginPath(); c.moveTo(64, 64); c.lineTo(64, 26); c.stroke();
        c.lineWidth = 4; c.beginPath(); c.moveTo(64, 64); c.lineTo(94, 72); c.stroke();
      });
      for (const flip of [0, Math.PI]) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshLambertMaterial({ map: face }));
        m.position.y = 3.75;
        m.rotation.y = flip;
        m.translateZ(0.06);
        g.add(m);
      }
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.1, 24), lam(0x7fa898));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 3.75;
      g.add(rim);
      this.group.add(g);
    }
  }

  _lamps() {
    const posts = [];
    for (const road of ROADS) {
      if (road.covered || roadLength(road.pts) < 20) continue;
      const s = samplePath(road.pts, 32);
      s.forEach((p, i) => {
        if (i === 0) return;
        const x = p.x - Math.sin(p.angle) * (road.width / 2 + 0.3), z = p.z + Math.cos(p.angle) * (road.width / 2 + 0.3);
        const y = groundY(x, z);
        if (this.inStationArea?.(x, z)) {
          // 駅前は、うすい青緑の柱に白い灯具がふたつの街灯
          posts.push({ x, y: y + 2, z, sx: 0.14, sy: 4, sz: 0.14, color: '#7fa898' });
          for (const sd of [-1, 1]) {
            const hx = x + Math.cos(p.angle) * sd * 0.45, hz = z + Math.sin(p.angle) * sd * 0.45;
            posts.push({ x: (x + hx) / 2, y: y + 3.75, z: (z + hz) / 2, sx: 0.06, sy: 0.06, sz: 0.06, color: '#7fa898' });
            this.stationLanterns.push({ x: hx, y: y + 3.55, z: hz, sx: 0.32, sy: 0.48, sz: 0.32, ry: -p.angle });
            this.lampPositions.push([hx, y + 3.55, hz]);
          }
          return;
        }
        posts.push({ x, y: y + 1.7, z, sx: 0.1, sy: 3.4, sz: 0.1, color: '#2f3336' });
        this.lampPositions.push([x, y + 3.5, z]);
      });
    }
    this.group.add(instancedChunks(posts, lam(0xffffff), { receive: false, geo: new THREE.CylinderGeometry(0.5, 0.6, 1, 5) }));
    if (this.stationLanterns.length) {
      this.lanternHeadMat = new THREE.MeshLambertMaterial({ color: 0xf4f0e6, emissive: 0xffb060, emissiveIntensity: 0 });
      this.group.add(instancedBoxes(this.stationLanterns, this.lanternHeadMat, { cast: false, receive: false, geo: new THREE.CylinderGeometry(0.5, 0.42, 1, 6) }));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.lampPositions.flat(), 3));
    this.lampMat = new THREE.PointsMaterial({ map: glowTexture(), color: 0xff9a48, size: 2.2, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new THREE.Points(geo, this.lampMat));
  }

  // ---------- 電車（JR山陽本線の実際の線形を走る） ----------
  _train() {
    this.tracks = TRAIN_TRACKS.map((pts) => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts, cum, length: cum[cum.length - 1] };
    });
    // 踏切が線路のどこにあるか
    this.crossings.forEach((c) => {
      c.at = this.tracks.map((t) => {
        let best = 0, bd = 1e9;
        t.pts.forEach((p, i) => { const d = Math.hypot(p[0] - c.x, p[1] - c.z); if (d < bd) { bd = d; best = t.cum[i]; } });
        return bd < 20 ? best : null;
      });
    });
    const body = lam(0xe8e6e0), stripe = lam(0xb8322a), dark = lam(0x2a2e33);
    this.trainWinMat = new THREE.MeshBasicMaterial({ color: 0xffe2c0, transparent: true, opacity: 0 });
    const cars = [];
    for (let i = 0; i < 4; i++) {
      const car = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(19.5, 3.2, 2.9), body);
      b.position.y = 2.1;
      b.castShadow = true;
      const s = new THREE.Mesh(new THREE.BoxGeometry(19.55, 0.35, 2.95), stripe);
      s.position.y = 1.2;
      const w = new THREE.Mesh(new THREE.BoxGeometry(17.5, 0.9, 2.95), dark);
      w.position.y = 2.6;
      const wl = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.8, 2.97), this.trainWinMat);
      wl.position.y = 2.6;
      car.add(b, s, w, wl);
      car.visible = false;
      this.group.add(car);
      cars.push(car);
    }
    this.train = { cars, track: 0, s: 0, dir: 1, active: false, timer: 20 + this.r() * 30, speed: 17 };
  }

  _trackPoint(t, s) {
    const { pts, cum } = t;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(0.01, cum[i] - cum[i - 1]);
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, angle: Math.atan2(bz - az, bx - ax) };
  }

  /** 毎フレーム。電車が近づいて鳴りはじめた踏切を返す */
  update(time, elapsed, dt) {
    const night = time.p.night;
    this.nightMats.forEach(({ mat, max }) => { mat.opacity = Math.min(max, night * 1.2); });
    this.glowMats.forEach(({ mat, base, add }) => { mat.emissiveIntensity = base + night * add; });
    this.lampMat.opacity = Math.min(1, night * 1.3);
    if (this.globeMat) this.globeMat.emissiveIntensity = night * 1.3;
    if (this.lanternHeadMat) this.lanternHeadMat.emissiveIntensity = night * 1.2;
    this.lanternMat.emissiveIntensity = night * 1.1;
    this.specialSignMats.forEach((m) => { m.emissiveIntensity = 0.2 + night * 0.7; });
    this.vendingMats.forEach((m) => { m.emissiveIntensity = 0.25 + night * 0.85; });
    this.lanternGlow.opacity = Math.min(0.85, night * 1.1);
    this.trainWinMat.opacity = Math.min(1, night * 1.2);
    this.signMat.emissiveIntensity = 0.15 + night * 0.6;
    this.arcadeLampMat.color.setScalar(0.7 + night * 0.3);
    if (this.skylightMat) this.skylightMat.emissiveIntensity = 0.5 * (1 - night);

    // ロープウェイ：片道およそ3分。2台が交互に上り下りし、駅で少し停まる
    const RIDE = 180, DWELL = 25, LEG = RIDE + DWELL;
    const cyc = elapsed % (LEG * 2);
    const up = cyc < LEG;
    const k = Math.min(1, (up ? cyc : cyc - LEG) / RIDE);
    const eased = k * k * (3 - 2 * k) * 0.08 + k * 0.92;
    const tA = up ? eased : 1 - eased;
    this.gondolas.forEach((gd) => {
      // 乗っているあいだは、1台目がこちらの乗っているゴンドラになる
      const t = gd.phase === 0 && this.ride ? this.ride.t : gd.phase === 0 ? tA : 1 - tA;
      gd.g.position.copy(this.cablePoint(t, gd.side));
      // 乗っているゴンドラは見えなくして、空の中にいるように（天井や壁で景色をふさがない）
      gd.g.visible = !(gd.phase === 0 && this.ride);
    });

    // 電車
    const T = this.train;
    const events = [];
    if (!T.active) {
      T.timer -= dt;
      if (T.timer <= 0) {
        T.active = true;
        T.track = this.r() < 0.5 ? 0 : 1;
        T.dir = T.track === 0 ? 1 : -1;
        const L = this.tracks[T.track].length;
        T.s = T.dir > 0 ? -90 : L + 90;
        this.crossings.forEach((c) => { c.rang = false; });
      }
    } else {
      T.s += T.dir * T.speed * dt;
      const track = this.tracks[T.track];
      T.cars.forEach((car, i) => {
        const s = T.s - T.dir * i * 20.3;
        car.visible = s > 0 && s < track.length;
        if (!car.visible) return;
        const p = this._trackPoint(track, s);
        car.position.set(p.x, terrainY(p.x, p.z) + 0.25, p.z);
        car.rotation.y = -p.angle;
      });
      if ((T.dir > 0 && T.s > track.length + 100) || (T.dir < 0 && T.s < -100)) {
        T.active = false;
        T.cars.forEach((c) => { c.visible = false; });
        T.timer = 70 + this.r() * 80;
      }
    }
    for (const c of this.crossings) {
      const at = T.active ? c.at[T.track] : null;
      let approaching = false;
      if (at !== null && at !== undefined) {
        const head = T.s, tail = T.s - T.dir * 82;
        approaching = T.dir > 0 ? head > at - 170 && tail < at + 6 : head < at + 170 && tail > at - 6;
      }
      if (approaching && !c.rang) { c.rang = true; events.push(c); }
      c.down += ((approaching ? 1 : 0) - c.down) * Math.min(1, dt * 1.5);
      c.arms.forEach((a) => { a.rotation.z = a.userData.side * 1.45 * (1 - c.down); });
      const blink = approaching ? Math.floor(elapsed * 2.2) % 2 : -1;
      // 灯は [左表, 左裏, 右表, 右裏] の順。左右が交互に点く
      c.lights.forEach((l, i) => {
        const on = blink === -1 ? 0 : Math.floor(i / 2) % 2 === blink ? 1 : 0.08;
        l.material.opacity = on;
        l.userData.lens.emissiveIntensity = on * 2.2;
      });
    }
    return events;
  }
}
