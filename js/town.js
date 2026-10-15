// 歩ける尾道の町（実データ版）：地形・道・建物・線路・海岸線を OpenStreetMap と国土地理院の標高から組み立てる。
// 道は地形に沿う帯、急な小径は石段と石垣、商店街（本通り）はアーケードと店先、
// 線路と踏切、電車、千光寺山ロープウェイ、天寧寺の三重塔、艮神社、渡船のりば。
import * as THREE from 'three';
import { canvasTexture, glowTexture, seededRandom, speckle } from './util.js';
import { lam, buildSignAtlas, labelTexture, QuadBatch, instancedBoxes, instancedChunks } from './townKit.js';
import {
  DATA, SEA_Y, BOUNDS, terrainY, groundY, ROADS, OTHER_ROADS, ARCADE_ROADS, nearAnyRoad, samplePath, roadLength,
  ALLEYS, COAST, RAILS, CROSSINGS, TRAIN_TRACKS, ROPEWAY, SUMMIT, BENCHES, FERRY_ROUTES, POIS, onOnomichiSide, nearestRoad, inBuilding,
} from './townMap.js';

const SURFACE_LIFT = { asphalt: 0.05, tile: 0.07, stone: 0.09 };

// 本通り商店街の、食べられるお店（店名は架空）。f は通りの中での位置（0〜1）、side は通りのどちら側か
const SPECIAL_SHOPS = {
  '本町センター街': [{ f: 0.5, side: 1, type: 'ramen', name: '尾道ラーメン 汐' }],
  '中商店街': [{ f: 0.42, side: -1, type: 'bakery', name: 'パン 潮風' }, { f: 0.15, side: 1, type: 'ramen', name: '中華そば 坂の上' }],
  '一番街': [{ f: 0.55, side: 1, type: 'bakery', name: 'パン屋 あさなぎ' }],
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
    this.nightMats = [];
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
    this._rails();
    this._ropeway();
    this._landmarks();
    this._piersAndBenches();
    this._nekoStones();
    this._pine();
    this._vendingMachines();
    this._summitDeck();
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
    const tb = new TriBatch();
    const c = new THREE.Color(0x8e8a80);
    for (const line of COAST) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1];
        if (ax < BOUNDS.x0 || ax > BOUNDS.x1 || az < BOUNDS.z0 || az > BOUNDS.z1) continue;
        const ta = Math.max(SEA_Y + 1.6, terrainY(ax, az)), tbb = Math.max(SEA_Y + 1.6, terrainY(bx, bz));
        tb.quad([ax, SEA_Y - 3, az], [bx, SEA_Y - 3, bz], [bx, tbb, bz], [ax, ta, az], c);
      }
    }
    const m = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    this.group.add(m);
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
   * 階段（steps）は全部、ふつうの小径でも勾配が急なところ（約1/6より急）は段にする。
   * 長い石段には手すり、斜面側には石垣。
   */
  _steps() {
    const RISE = 0.17;
    const treads = [], walls = [], rails = [], lanterns = [];
    this.stepLanterns = lanterns;
    const r = this.r;
    for (const road of ROADS) {
      if (road.surface !== 'stone') continue;
      const s = samplePath(road.pts, 0.1);
      const H = s.map((p) => groundY(p.x, p.z));
      const steep = (i) => {
        if (road.kind === 'steps') return true;
        const j = Math.min(s.length - 1, i + 15), k = Math.max(0, i - 15);
        return Math.abs(H[j] - H[k]) / Math.max(0.5, (j - k) * 0.1) > 0.17;
      };
      let start = -1;   // いまの踏み面の始まり
      let base = 0;     // いまの踏み面の高さの基準
      let flights = 0;
      const flush = (i0, i1) => {
        if (i1 - i0 < 2) return;
        const a = s[i0], b = s[i1];
        let top = -Infinity;
        for (let k = i0; k <= i1; k++) top = Math.max(top, H[k]);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const v = 0.44 + r() * 0.1;
        treads.push({ x: (a.x + b.x) / 2, y: top + 0.04 - 0.35, z: (a.z + b.z) / 2, sx: len + 0.04, sy: 0.7, sz: road.width + 0.1, ry: -Math.atan2(b.z - a.z, b.x - a.x),
          color: new THREE.Color(v, v * 0.97, v * 0.9) });
        flights++;
      };
      for (let i = 0; i < s.length; i++) {
        if (!steep(i)) {
          if (start >= 0) { flush(start, i - 1); start = -1; }
          continue;
        }
        if (start < 0) { start = i; base = H[i]; continue; }
        if (Math.abs(H[i] - base) >= RISE) { flush(start, i); start = i; base = H[i]; }
      }
      if (start >= 0) flush(start, s.length - 1);
      if (!flights) continue;

      // 石段の端の小さな石灯籠（間隔をあけて、片側ずつ交互に）
      if (road.kind === 'steps' || flights > 12) {
        const spots = samplePath(road.pts, 14 + r() * 6);
        spots.forEach((p, i) => {
          if (i === 0 || !steep(Math.min(s.length - 1, Math.round(i * (s.length / spots.length))))) return;
          const side = i % 2 ? 1 : -1;
          const off = road.width / 2 - 0.18;
          const x = p.x - Math.sin(p.angle) * side * off, z = p.z + Math.cos(p.angle) * side * off;
          lanterns.push({ x, z, y: groundY(x, z), ry: -p.angle });
        });
      }

      // 石垣（斜面側＝高いほうの横）と、長い石段の手すり
      const coarse = samplePath(road.pts, 2);
      coarse.forEach((a, i) => {
        if (i === coarse.length - 1) return;
        const b = coarse[i + 1];
        const ya = groundY(a.x, a.z), yb = groundY(b.x, b.z);
        const grade = Math.abs(yb - ya) / Math.max(0.1, a.len);
        if (grade < 0.1 && road.kind !== 'steps') return;
        for (const side of [-1, 1]) {
          const nx = -Math.sin(a.angle) * side, nz = Math.cos(a.angle) * side;
          const wx = a.x + nx * (road.width / 2 + 0.22), wz = a.z + nz * (road.width / 2 + 0.22);
          const other = nearAnyRoad(wx, wz, 0.25);
          if (other && other !== road) continue;
          const beside = terrainY(wx + nx * 1.5, wz + nz * 1.5);
          const top = Math.max(beside, Math.max(ya, yb)) + 0.5 + r() * 0.5;
          const bottom = Math.min(ya, yb) - 1.5;
          const g = 0.37 + r() * 0.1;
          walls.push({ x: wx, y: (top + bottom) / 2, z: wz, sx: a.len + 0.05, sy: top - bottom, sz: 0.4, ry: -a.angle, color: new THREE.Color(g * 1.03, g, g * 0.88) });
        }
        if (road.kind === 'steps' && road.width >= 1.6 && i % 1 === 0) {
          const rise = yb - ya;
          rails.push({ x: (a.x + b.x) / 2, y: (ya + yb) / 2 + 0.9, z: (a.z + b.z) / 2, sx: Math.hypot(a.len, rise), sy: 0.05, sz: 0.05, ry: -a.angle, rz: Math.atan2(rise, a.len), color: '#3a3f44' });
          if (i % 2 === 0) rails.push({ x: a.x, y: ya + 0.45, z: a.z, sx: 0.05, sy: 0.9, sz: 0.05, ry: -a.angle, color: '#3a3f44' });
        }
      });
    }
    this.group.add(instancedChunks(treads, lam(0xffffff)));
    this.group.add(instancedChunks(walls, lam(0xffffff)));
    this.group.add(instancedChunks(rails, lam(0xffffff), { receive: false }));
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
    this.lanternMat = new THREE.MeshLambertMaterial({ color: 0x8f897d, emissive: 0xffb45c, emissiveIntensity: 0 });
    this.group.add(instancedChunks(parts.box, this.lanternMat, { cast: false }));
    // 足もとをほのかに照らす光の粒（夜だけ見える）
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap((l) => [l.x, l.y + 0.4, l.z]), 3));
    this.lanternGlow = new THREE.PointsMaterial({ map: glowTexture(), color: 0xffb060, size: 0.9, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new THREE.Points(geo, this.lanternGlow));
  }

  // ---------- 建物（OpenStreetMap の輪郭を立ち上げる） ----------
  _buildings() {
    const tb = new TriBatch();
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
      const poly = [];
      for (let k = 0; k < b.p.length; k += 2) poly.push([b.p[k], b.p[k + 1]]);
      if (poly.length < 3) continue;
      // 商店街の路地がふさがれないように、路地にかかる建物は置かない
      if (alleyPts.some(([x, z]) => pointInPoly(x, z, poly))) continue;
      const area = Math.abs(signedArea(poly));
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
      const wc = new THREE.Color(walls[Math.floor(r() * walls.length)]);
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
        tb.quad([ax, base, az], [bx, base, bz], [bx, top, bz], [ax, top, az], wc);
      }
      // 屋根：小さな家は瓦の寄棟、大きな建物は平らな屋上
      const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
      const hip = area < 260 && poly.length <= 10;
      if (hip) {
        const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        const inner = poly.map(([x, z]) => [cx + (x - cx) * 0.35, cz + (z - cz) * 0.35]);
        const rh = 1.4 + Math.sqrt(area) * 0.08;
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
    const mesh = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffd39a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.group.add(instancedBoxes(winList, winMat, { cast: false, receive: false, geo: new THREE.PlaneGeometry(1, 1) }));
    this.nightMats.push({ mat: winMat, max: 0.9 });
  }

  /** OSM に建物が載っていない斜面を、小さな家で埋める（尾道の坂の家並み） */
  _infill() {
    const r = this.r;
    const walls = ['#e9e2d4', '#d8cfbf', '#cfc6b5', '#6b5543', '#5a4a3c', '#efe9df', '#bfb6a6'];
    const roofs = ['#4d535b', '#454b54', '#5b6068', '#3e434a', '#6a5b4e', '#556270', '#7a4a3a'];
    const list = [];
    for (let z = -1100; z < 220; z += 8 + r() * 3) {
      for (let x = -720; x < 640; x += 8 + r() * 3) {
        const hx = x + (r() - 0.5) * 3, hz = z + (r() - 0.5) * 3;
        const ground = terrainY(hx, hz);
        const above = ground - SEA_Y;
        // 向島側は海沿いの平地だけ、まばらに
        if (!onOnomichiSide(hx, hz) && (above > 14 || r() < 0.5)) continue;
        if (above < 1.5 || above > 115) continue;                // 海と、千光寺山の上のほうの森
        if (Math.hypot(hx, hz) < 14) continue;                    // 空き家のまわり
        if (this.occupied.has(Math.floor(hx / 4) * 100003 + Math.floor(hz / 4))) continue;
        const w = 4.5 + r() * 3.5, d = 4.5 + r() * 3;
        if (nearAnyRoad(hx, hz, Math.max(w, d) / 2 + 0.8)) continue;
        // 町なか（平地）は詰まって建つ、斜面はところどころ
        if (above > 12 && r() < 0.35) continue;
        const h = above < 8 ? 6 + r() * 5 : 3 + r() * 3;
        if (ground + h + 2.2 > viewCap(hx, hz)) continue; // 窓からの眺めをふさがない
        list.push({ x: hx, z: hz, y: ground - 3, w, h: h + 3, d, rot: (r() - 0.5) * 0.3 + Math.round(r() * 2) * Math.PI / 2, roofH: 1.3 + r() * 0.8,
          wall: walls[Math.floor(r() * walls.length)], roof: roofs[Math.floor(r() * roofs.length)] });
        this.occupied.add(Math.floor(hx / 4) * 100003 + Math.floor(hz / 4));
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
    const trees = [];
    for (let i = 0; i < 2600; i++) {
      const x = BOUNDS.x0 + r() * (BOUNDS.x1 - BOUNDS.x0), z = BOUNDS.z0 + r() * (BOUNDS.z1 - BOUNDS.z0);
      const ground = terrainY(x, z);
      const above = ground - SEA_Y;
      if (above < 6) continue;
      if (Math.hypot(x, z) < 10) continue;
      if (this.occupied.has(Math.floor(x / 4) * 100003 + Math.floor(z / 4))) continue;
      if (nearAnyRoad(x, z, 2.5)) continue;
      // 山頂の展望台からの眺め（南の尾道水道）をさえぎらない
      const dd = Math.hypot(x - SUMMIT.deck.x, z - SUMMIT.deck.z);
      if (dd < 25 || (dd < 90 && z < SUMMIT.deck.z + 5)) continue;
      const s = 1.8 + r() * (above > 80 ? 4 : 2.8);
      if (ground + s * 1.5 > viewCap(x, z)) continue;
      const c = new THREE.Color().setHSL(0.24 + r() * 0.08, 0.3 + r() * 0.15, 0.17 + r() * 0.1);
      trees.push({ x, y: ground + s * 0.6, z, sx: s, sy: s * (0.8 + r() * 0.5), sz: s, color: c });
    }
    this.group.add(instancedChunks(trees, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(1, 0) }));
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
    const r = this.r;
    const atlas = buildSignAtlas();
    const signs = new QuadBatch(), glassDay = new QuadBatch(), glassNight = new QuadBatch();
    const awnings = [], fronts = [], ribs = [], lamps = [];
    const facadeColors = ['#d8d2c4', '#c9c1b0', '#e6e0d4', '#b4ab9a', '#8a7a68', '#efe9dc'];
    const awningColors = ['#a33a2a', '#2f5a7a', '#3a6a4a', '#c8a050', '#7a6a5a', '#efe6d6', '#5a3a6a'];
    const roofTb = new TriBatch();
    const roofColor = new THREE.Color(0xe9efe9);
    let signIdx = 0;
    for (const road of ARCADE_ROADS) {
      const hw = road.width / 2;
      const s = samplePath(road.pts, 2);
      // 屋根（ゆるい切妻の半透明パネル）と鉄骨のリブ
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        const ya = terrainY(a.x, a.z) + 7, yb = terrainY(b.x, b.z) + 7;
        const na = { x: -Math.sin(a.angle), z: Math.cos(a.angle) }, nb = { x: -Math.sin(b.angle), z: Math.cos(b.angle) };
        const W = hw + 1.2;
        roofTb.quad([a.x + na.x * W, ya, a.z + na.z * W], [b.x + nb.x * W, yb, b.z + nb.z * W], [b.x, yb + 0.8, b.z], [a.x, ya + 0.8, a.z], roofColor);
        roofTb.quad([a.x - na.x * W, ya, a.z - na.z * W], [a.x, ya + 0.8, a.z], [b.x, yb + 0.8, b.z], [b.x - nb.x * W, yb, b.z - nb.z * W], roofColor);
        if (i % 2 === 0) ribs.push({ x: a.x, y: ya + 0.2, z: a.z, sx: 0.14, sy: 0.2, sz: road.width + 2.4, ry: -a.angle, color: '#5a5f66' });
        if (i % 4 === 1) lamps.push({ x: a.x, y: ya - 1.2, z: a.z });
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
          glassDay.addOriented(fx - nx * 0.02, gy + 1.35, fz - nz * 0.02, rx, rz, 5.2, 2.3, undefined, [0.16, 0.15, 0.14]);
          glassNight.addOriented(fx - nx * 0.04, gy + 1.35, fz - nz * 0.04, rx, rz, 5.2, 2.3, undefined, [warm, 0.78 * warm, 0.5 * warm]);
          const sp = specials.find((q) => q.side === side && !q.done && frac >= q.f);
          if (sp) {
            sp.done = true;
            this._specialShop(sp, p, fx, fz, gy, nx, nz, hw);
          } else {
            signs.addOriented(fx - nx * 0.06, gy + 3.35, fz - nz * 0.06, rx, rz, 3.3, 0.82, atlas.uv(signIdx++));
          }
          awnings.push({ x: fx - nx * 0.5, y: gy + 2.75, z: fz - nz * 0.5, sx: 5.6, sy: 0.07, sz: 0.95, ry: -p.angle, rx: side * 0.35, color: awningColors[Math.floor(r() * awningColors.length)] });
          const h = 5.5 + r() * 5;
          fronts.push({ x: fx + nx * 4, y: gy + h / 2 - 1, z: fz + nz * 4, sx: 6.3, sy: h + 2, sz: 8, ry: -p.angle, color: facadeColors[Math.floor(r() * facadeColors.length)] });
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
    const roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const roof = new THREE.Mesh(roofTb.build(), roofMat);
    roof.castShadow = true;
    this.group.add(roof);
    this.group.add(instancedBoxes(ribs, lam(0xffffff), { receive: false }));
    this.group.add(instancedBoxes(fronts, lam(0xffffff)));
    this.group.add(instancedBoxes(awnings, lam(0xffffff, { side: THREE.DoubleSide }), { receive: false }));
    this.group.add(new THREE.Mesh(glassDay.build(), lam(0xffffff, { vertexColors: true })));
    const nightMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new THREE.Mesh(glassNight.build(), nightMat));
    this.nightMats.push({ mat: nightMat, max: 0.95 });
    this.signMat = new THREE.MeshLambertMaterial({ map: atlas.tex, emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.15 });
    this.group.add(new THREE.Mesh(signs.build(), this.signMat));
    this.arcadeLampMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0 });
    this.group.add(instancedBoxes(lamps.map((l) => ({ ...l, sx: 0.35, sy: 0.35, sz: 0.35 })), this.arcadeLampMat, { cast: false, receive: false, geo: new THREE.SphereGeometry(0.5, 10, 8) }));
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
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshLambertMaterial({
      map: labelTexture(sp.name, { w: 640, h: 160, size: 84, bg: ramen ? '#7a1e18' : '#f4ead2', fg: ramen ? '#fbeedc' : '#5a3a1a' }),
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
    for (const [x0, z0] of spots) {
      const n = nearestRoad(x0, z0);
      if (!n || n.d > 30) continue;
      // 道の端に、道のほうを向けて置く（建物や海にかからない側）
      let best = null;
      for (const side of [-1, 1]) {
        const s = n.seg;
        const ang = Math.atan2(s.dz, s.dx);
        const nx = -Math.sin(ang) * side, nz = Math.cos(ang) * side;
        const x = n.px + nx * (s.half + 0.55), z = n.pz + nz * (s.half + 0.55);
        if (inBuilding(x, z) || terrainY(x, z) < SEA_Y + 0.5 || nearAnyRoad(x, z, 0.1)) continue;
        best = { x, z, nx, nz, ang };
        break;
      }
      if (!best || placed.some((p) => Math.hypot(p.x - best.x, p.z - best.z) < 25)) continue;
      placed.push(best);
      const y = groundY(best.x, best.z);
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.83, 0.75), lam(VENDING_COLORS[placed.length % VENDING_COLORS.length]));
      body.position.y = 0.915;
      body.castShadow = true;
      const front = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.6), new THREE.MeshLambertMaterial({ map: panel, emissive: 0xffffff, emissiveMap: panel, emissiveIntensity: 0.25 }));
      front.position.set(0, 0.95, 0.38);
      this.vendingMats.push(front.material);
      g.add(body, front);
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
    const ballast = new TriBatch(), steel = new TriBatch();
    const cb = new THREE.Color(0x6b6560), cs = new THREE.Color(0x8a8580);
    for (const rail of RAILS) {
      const s = samplePath(rail.pts, 3);
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        const na = { x: -Math.sin(a.angle), z: Math.cos(a.angle) }, nb = { x: -Math.sin(b.angle), z: Math.cos(b.angle) };
        const ya = terrainY(a.x, a.z) + 0.12, yb = terrainY(b.x, b.z) + 0.12;
        ballast.quad([a.x - na.x * 1.5, ya, a.z - na.z * 1.5], [a.x + na.x * 1.5, ya, a.z + na.z * 1.5], [b.x + nb.x * 1.5, yb, b.z + nb.z * 1.5], [b.x - nb.x * 1.5, yb, b.z - nb.z * 1.5], cb);
        for (const o of [-0.53, 0.53]) {
          const w = 0.05;
          steel.quad([a.x + na.x * (o - w), ya + 0.16, a.z + na.z * (o - w)], [a.x + na.x * (o + w), ya + 0.16, a.z + na.z * (o + w)],
            [b.x + nb.x * (o + w), yb + 0.16, b.z + nb.z * (o + w)], [b.x + nb.x * (o - w), yb + 0.16, b.z + nb.z * (o - w)], cs);
        }
      }
    }
    const bm = new THREE.Mesh(ballast.build(), lam(0xffffff, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    bm.receiveShadow = true;
    this.group.add(bm, new THREE.Mesh(steel.build(), lam(0xffffff, { vertexColors: true })));

    // 踏切：警報機と遮断かん（線路と平行に、道をふさぐ向き）
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
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 8), lam(0x222222));
        pole.position.set(ox, gy + 1.7, oz);
        g.add(pole);
        const cross = new THREE.Group();
        for (const a of [0.6, -0.6]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.05), lam(0xf0d020));
          bar.rotation.z = a;
          cross.add(bar);
        }
        cross.position.set(ox, gy + 3.0, oz);
        cross.rotation.y = -ra + Math.PI / 2;
        g.add(cross);
        for (const lx of [-0.25, 0.25]) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3020, transparent: true, opacity: 0, depthWrite: false }));
          sp.position.set(ox + rx * lx, gy + 2.4, oz + rz * lx);
          sp.scale.setScalar(0.7);
          g.add(sp);
          lights.push(sp);
        }
        const pivot = new THREE.Group();
        pivot.position.set(ox, gy + 1.0, oz);
        pivot.rotation.y = -ra;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(cr.width + 0.6, 0.08, 0.08), lam(0xf0d020));
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
    this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.ropeA, this.ropeB]), new THREE.LineBasicMaterial({ color: 0x333333 })));
    for (const t of [0.33, 0.66]) {
      const p = new THREE.Vector3().lerpVectors(this.ropeA, this.ropeB, t);
      const gy = terrainY(p.x, p.z);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, Math.max(1, p.y - gy + 1), 0.8), lam(0x8a8a88));
      tower.position.set(p.x, (p.y + gy) / 2, p.z);
      this.group.add(tower);
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
      g.add(cab, band, arm);
      g.rotation.y = -Math.atan2(top.z - base.z, top.x - base.x);
      this.group.add(g);
      return { g, phase };
    });
  }

  /** ロープウェイのケーブル上の点（t=0 山麓駅、1 山頂駅）。少したわませる */
  cablePoint(t) {
    const p = new THREE.Vector3().lerpVectors(this.ropeA, this.ropeB, t);
    p.y -= Math.sin(t * Math.PI) * 5;
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
      const hall = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 6), lam(0xb8402e));
      hall.position.set(senkoji.x, y + 1.8, senkoji.z);
      hall.castShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2.6, 4), lam(0x3a3f46));
      roof.rotation.y = Math.PI / 4;
      roof.position.set(senkoji.x, y + 5.1, senkoji.z);
      roof.scale.set(1, 1, 0.9);
      this.group.add(hall, roof);
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
  }

  _shrine(x, z) {
    const y = terrainY(x, z);
    const vermilion = lam(0xc8442e);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(6, 3.5, 5), lam(0x7a5a3e));
    hall.position.set(x, y + 1.5, z + 3);
    hall.castShadow = true;
    const hallRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.4, 4), lam(0x3a3f46));
    hallRoof.rotation.y = Math.PI / 4;
    hallRoof.position.set(x, y + 4.3, z + 3);
    this.group.add(hall, hallRoof);
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
    this.group.add(torii);
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
    this.group.add(kusu);
  }

  // ---------- 渡船のりば・ベンチ ----------
  _piersAndBenches() {
    const pontoonMat = lam(0x9a9890), hutMat = lam(0xe8e2d4);
    const signTex = labelTexture('渡船のりば', { w: 512, h: 128, size: 72, bg: '#1f3b5a', fg: '#f4efe4' });
    for (const route of FERRY_ROUTES) {
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
      for (const flip of [0, Math.PI]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: signTex }));
        sign.position.set(a.x - Math.cos(dir) * 8, terrainY(a.x - Math.cos(dir) * 8, a.z - Math.sin(dir) * 8) + 3.2, a.z - Math.sin(dir) * 8);
        sign.rotation.y = -dir + Math.PI / 2 + flip;
        sign.translateZ(0.02);
        this.group.add(sign);
      }
    }
    const wood = lam(0x8a6a4a), iron = lam(0x2f3336);
    for (const b of BENCHES) {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.12), wood);
        slat.position.set(0, 0.45, -0.16 + i * 0.16);
        slat.castShadow = true;
        g.add(slat);
      }
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.05), wood);
      back.position.set(0, 0.72, 0.24);
      back.rotation.x = -0.15;
      g.add(back);
      for (const sx of [-0.75, 0.75]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.45), iron);
        leg.position.set(sx, 0.22, 0);
        g.add(leg);
      }
      g.position.set(b.x, b.y, b.z);
      g.rotation.y = b.yaw; // 背もたれは陸側、座ると海を向く
      this.group.add(g);
    }
  }

  /** 猫の細道の福石猫（丸い石に描かれた猫） */
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
  _lamps() {
    const posts = [];
    for (const road of ROADS) {
      if (road.covered || roadLength(road.pts) < 20) continue;
      const s = samplePath(road.pts, 32);
      s.forEach((p, i) => {
        if (i === 0) return;
        const x = p.x - Math.sin(p.angle) * (road.width / 2 + 0.3), z = p.z + Math.cos(p.angle) * (road.width / 2 + 0.3);
        const y = groundY(x, z);
        posts.push({ x, y: y + 1.7, z, sx: 0.1, sy: 3.4, sz: 0.1, color: '#2f3336' });
        this.lampPositions.push([x, y + 3.5, z]);
      });
    }
    this.group.add(instancedChunks(posts, lam(0xffffff), { receive: false, geo: new THREE.CylinderGeometry(0.5, 0.6, 1, 5) }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.lampPositions.flat(), 3));
    this.lampMat = new THREE.PointsMaterial({ map: glowTexture(), color: 0xffd9a0, size: 2.2, transparent: true, opacity: 0, depthWrite: false });
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
    this.trainWinMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0 });
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
    this.lampMat.opacity = Math.min(1, night * 1.3);
    this.lanternMat.emissiveIntensity = night * 1.1;
    this.specialSignMats.forEach((m) => { m.emissiveIntensity = 0.2 + night * 0.7; });
    this.vendingMats.forEach((m) => { m.emissiveIntensity = 0.25 + night * 0.85; });
    this.lanternGlow.opacity = Math.min(0.85, night * 1.1);
    this.trainWinMat.opacity = Math.min(1, night * 1.2);
    this.signMat.emissiveIntensity = 0.15 + night * 0.6;
    this.arcadeLampMat.color.setScalar(0.7 + night * 0.3);

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
      gd.g.position.copy(this.cablePoint(t));
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
      c.lights.forEach((l, i) => { l.material.opacity = blink === -1 ? 0 : i % 2 === blink ? 1 : 0.1; });
    }
    return events;
  }
}
