// 歩ける尾道の町：千光寺新道の石段、猫の細道、本通り商店街（アーケード）、国道2号、
// JR山陽本線と踏切、海岸通りと渡船のりば、ロープウェイと艮神社、天寧寺の三重塔。
import * as THREE from 'three';
import { canvasTexture, glowTexture, seededRandom, speckle } from './util.js';
import {
  terrainY, ROADS, ARCADE_SECTIONS, CROSSINGS, BENCHES, FERRY_PIERS, nearAnyRoad, samplePath,
  FLAT_Y, SEA_Y, QUAY_Z, ARCADE_Z, ROUTE2_Z, RAIL_Z, SLOPE_Z,
} from './townMap.js';

const lam = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

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
function buildSignAtlas() {
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
function labelTexture(text, { w = 512, h = 128, bg = '#2a2420', fg = '#f2e8d2', size = 64, vertical = false } = {}) {
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
class QuadBatch {
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
function instancedBoxes(list, mat, { cast = true, receive = true, geo } = {}) {
  const mesh = new THREE.InstancedMesh(geo || new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  list.forEach((b, i) => {
    e.set(b.rx || 0, b.ry || 0, b.rz || 0);
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

export class Town {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.r = seededRandom('onomichi-walk');
    this.lampPositions = [];
    this.nightMats = [];   // 夜に灯る素材（不透明度を night に合わせる）

    this._terrain();
    this._house();
    this._slopePaths();
    this._slopeHouses();
    this._arcade();
    this._promenade();
    this._route2AndRail();
    this._ropewayAndShrine();
    this._pagoda(-60, -92);
    this._station();
    this._nekoStones();
    this._pine();
    this._lamps();
    this._train();
  }

  // ---------- 地形 ----------
  _terrain() {
    const W = 1260, D = 400;
    const geo = new THREE.PlaneGeometry(W, D, 315, 100);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) - 70;
      const z = pos.getZ(i) - 26;
      pos.setX(i, x);
      pos.setZ(i, z);
      pos.setY(i, terrainY(x, z) - 0.12);
      if (z > SLOPE_Z + 2) c.setHSL(0.22 + this.r() * 0.05, 0.25, 0.22 + this.r() * 0.06);
      else c.set(0x8d8a84).offsetHSL(0, 0, (this.r() - 0.5) * 0.04);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, lam(0xffffff, { vertexColors: true }));
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // 岸壁
    const quay = new THREE.Mesh(new THREE.BoxGeometry(1260, 4, 1.2), lam(0x8e8a80));
    quay.position.set(-65, FLAT_Y - 2, QUAY_Z - 0.4);
    quay.receiveShadow = true;
    this.group.add(quay);
    const coping = new THREE.Mesh(new THREE.BoxGeometry(1260, 0.25, 0.9), lam(0xb9b4a8));
    coping.position.set(-65, FLAT_Y + 0.1, QUAY_Z + 0.2);
    this.group.add(coping);
  }

  /** 空き家の外観：石垣の土台、瓦屋根、戸口 */
  _house() {
    const stone = lam(0x7d776c);
    const base = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 5), stone);
    base.position.set(0, -2.6, 0.5);
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
    // 東側の引き戸
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.85, 0.95), lam(0x5a3d29));
    door.position.set(-2.66, 0.92, 1.5);
    this.group.add(door);
    const lattice = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.5), new THREE.MeshLambertMaterial({ color: 0xe6dcc6 }));
    lattice.position.set(-2.75, 1.0, 1.5);
    lattice.rotation.y = -Math.PI / 2;
    this.group.add(lattice);
    // 表札がわりの小さな札
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.42), new THREE.MeshBasicMaterial({ map: labelTexture('空き家', { w: 64, h: 192, size: 44, vertical: true, bg: '#d8ccb0', fg: '#3a2a1a' }) }));
    plate.position.set(-2.75, 1.45, 2.15);
    plate.rotation.y = -Math.PI / 2;
    this.group.add(plate);
    // 戸口の石の踏み台
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.2), stone);
    step.position.set(-3.4, -0.25, 1.5);
    step.receiveShadow = true;
    this.group.add(step);
  }

  // ---------- 坂道：石段と石垣 ----------
  _slopePaths() {
    const steps = [], walls = [];
    const r = this.r;
    for (const road of ROADS) {
      if (road.surface !== 'stone') continue;
      const samples = samplePath(road.pts, 0.55);
      samples.forEach((s, i) => {
        const top = terrainY(s.x, s.z) + 0.04;
        const v = 0.42 + r() * 0.12;
        steps.push({ x: s.x, y: top - 0.35, z: s.z, sx: s.len + 0.06, sy: 0.7, sz: road.width, ry: -s.angle, color: new THREE.Color(v, v * 0.98, v * 0.92) });
        // 石垣（両側。ほかの道との交差点はあける）
        if (i % 2 === 0) {
          for (const side of [-1, 1]) {
            const nx = -Math.sin(s.angle) * side, nz = Math.cos(s.angle) * side;
            const wx = s.x + nx * (road.width / 2 + 0.2), wz = s.z + nz * (road.width / 2 + 0.2);
            const other = nearAnyRoad(wx, wz, 0.4);
            if (other && other !== road) continue;
            if (r() < 0.12) continue;
            const ground = Math.max(terrainY(wx, wz), top);
            const h = 0.8 + r() * 0.7;
            const bottom = top - 2.5;
            const g = 0.36 + r() * 0.12;
            walls.push({ x: wx, y: (ground + h + bottom) / 2, z: wz, sx: 1.15, sy: ground + h - bottom, sz: 0.38, ry: -s.angle, color: new THREE.Color(g * 1.02, g, g * 0.9) });
          }
        }
      });
    }
    const stoneMat = lam(0xffffff);
    this.group.add(instancedBoxes(steps, stoneMat, { cast: false }));
    this.group.add(instancedBoxes(walls, lam(0xffffff)));
  }

  /** 斜面の家並み（道をよけて建てる） */
  _slopeHouses() {
    const r = this.r;
    const walls = ['#e9e2d4', '#d8cfbf', '#cfc6b5', '#6b5543', '#5a4a3c', '#efe9df', '#bfb6a6', '#d6d2c8'];
    const roofs = ['#4d535b', '#454b54', '#5b6068', '#3e434a', '#6a5b4e', '#556270', '#7a4a3a'];
    const avoid = [[0, 0.5, 13], [-60, -92, 13], [-104, -146, 14], [-132, -148, 11], [-108, -132, 8]];
    const list = [];
    for (let z = SLOPE_Z + 7; z < 70; z += 7 + r() * 3) {
      for (let x = -640; x < 520; x += 8 + r() * 4) {
        const w = 4.5 + r() * 4, d = 4.5 + r() * 3;
        const hx = x + (r() - 0.5) * 3, hz = z + (r() - 0.5) * 2;
        if (r() < 0.12) continue;
        if (nearAnyRoad(hx, hz, Math.max(w, d) / 2 + 1.2)) continue;
        if (avoid.some(([ax, az, ar]) => Math.hypot(hx - ax, hz - az) < ar)) continue;
        // 空き家の窓の正面は、眼下の海が見えるようにあけておく
        if (hz > -45 && hz < 0 && Math.abs(hx) < 18 + -hz * 0.5) continue;
        const ground = terrainY(hx, hz);
        const h = 3 + r() * 3.5;
        list.push({
          x: hx, z: hz, y: ground - 3, w, h: h + 3, d, rot: (r() - 0.5) * 0.2, roofH: 1.4 + r() * 0.8,
          wall: walls[Math.floor(r() * walls.length)], roof: roofs[Math.floor(r() * roofs.length)],
        });
      }
    }
    const win = this.world._houses(list);
    this.world._windowLights(win);

    // 斜面の木々
    const trees = [];
    for (let i = 0; i < 520; i++) {
      const x = -640 + r() * 1160, z = SLOPE_Z + 4 + r() * 210;
      if (nearAnyRoad(x, z, 3)) continue;
      if (Math.hypot(x, z - 0.5) < 9) continue;
      const s = 1.8 + r() * 3.2;
      const c = new THREE.Color().setHSL(0.24 + r() * 0.08, 0.3 + r() * 0.15, 0.18 + r() * 0.1);
      trees.push({ x, y: terrainY(x, z) + s * 0.6, z, sx: s, sy: s * (0.8 + r() * 0.5), sz: s, color: c });
    }
    this.group.add(instancedBoxes(trees, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(1, 1) }));
  }

  // ---------- 本通り商店街 ----------
  _arcade() {
    const r = this.r;
    const atlas = buildSignAtlas();
    const signs = new QuadBatch();
    const glassDay = new QuadBatch();
    const glassNight = new QuadBatch();
    const bodies = [], awnings = [], upperWin = [];
    const awningColors = ['#a33a2a', '#2f5a7a', '#3a6a4a', '#c8a050', '#7a6a5a', '#efe6d6', '#5a3a6a'];
    const walls = ['#d8d2c4', '#c9c1b0', '#e6e0d4', '#b4ab9a', '#8a7a68', '#efe9dc'];
    let signIdx = 0;

    // ブロックA（海側：南）と B（山側：北）
    const blocks = [
      { z0: -207.5, z1: -191, front: -191, facing: 'z+', hMin: 6, hMax: 13 },
      { z0: -185, z1: -174.2, front: -185, facing: 'z-', hMin: 5, hMax: 9 },
    ];
    for (const B of blocks) {
      for (let x = 452; x > -620;) {
        const w = 5 + r() * 5;
        const cx = x - w / 2;
        x -= w + 0.15;
        if (nearAnyRoad(cx, (B.z0 + B.z1) / 2, w / 2 - 0.3)?.id?.startsWith('cross') || nearAnyRoad(cx, B.front, w / 2)?.id?.startsWith('cross')) continue;
        const d = B.z1 - B.z0;
        const h = B.hMin + r() * (B.hMax - B.hMin);
        bodies.push({ x: cx, y: FLAT_Y + h / 2, z: (B.z0 + B.z1) / 2, sx: w, sy: h, sz: d, color: walls[Math.floor(r() * walls.length)] });
        const out = B.facing === 'z+' ? 0.03 : -0.03;
        const fz = B.front + out;
        // 店の正面：ガラス戸（夜は灯る）・看板・日よけ
        glassDay.add(cx, FLAT_Y + 1.35, fz, w - 0.8, 2.3, B.facing, undefined, [0.16, 0.15, 0.14]);
        const warm = 0.85 + r() * 0.15;
        glassNight.add(cx, FLAT_Y + 1.35, fz + out, w - 0.8, 2.3, B.facing, undefined, [1 * warm, 0.78 * warm, 0.5 * warm]);
        signs.add(cx, FLAT_Y + 3.35, fz + out * 2, Math.min(w - 0.6, 3.4), 0.85, B.facing, atlas.uv(signIdx++));
        awnings.push({ x: cx, y: FLAT_Y + 2.75, z: B.front + (B.facing === 'z+' ? 0.45 : -0.45), sx: w - 0.4, sy: 0.08, sz: 0.95, rx: B.facing === 'z+' ? 0.35 : -0.35, color: awningColors[Math.floor(r() * awningColors.length)] });
        // 2階より上の窓（夜に灯る）
        for (let y = 5.2; y < h - 0.8; y += 3) {
          if (r() < 0.45) continue;
          for (const face of [B.z0 - 0.06, B.z1 + 0.06]) upperWin.push({ x: cx + (r() - 0.5) * w * 0.4, y: FLAT_Y + y, z: face, sx: 1.1, sy: 0.9, sz: 0.02 });
        }
      }
    }
    this.group.add(instancedBoxes(bodies, lam(0xffffff)));
    this.group.add(instancedBoxes(awnings, lam(0xffffff, { side: THREE.DoubleSide }), { receive: false }));
    this.group.add(new THREE.Mesh(glassDay.build(), lam(0xffffff, { vertexColors: true })));
    const nightMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new THREE.Mesh(glassNight.build(), nightMat));
    this.nightMats.push({ mat: nightMat, max: 0.95 });
    const signMat = new THREE.MeshLambertMaterial({ map: atlas.tex, emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.15 });
    this.signMat = signMat;
    this.group.add(new THREE.Mesh(signs.build(), signMat));
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(instancedBoxes(upperWin, winMat, { cast: false, receive: false }));
    this.nightMats.push({ mat: winMat, max: 0.9 });

    // 商店街の床（タイル）
    this._flatStrip(455, -622, ARCADE_Z, 5.2, this._tileTex('#b9ad98', '#a59a86', 1.0));

    // アーケードの屋根：半透明の屋根と鉄骨のリブ
    const roofY = FLAT_Y + 7.4;
    const len = 455 + 622;
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xe9efe9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 3.6), roofMat);
      panel.rotation.x = -Math.PI / 2 + side * 0.22;
      panel.position.set((455 - 622) / 2, roofY + 0.35, ARCADE_Z + side * 1.7);
      panel.castShadow = true;
      this.group.add(panel);
    }
    const ribs = [], lampsArc = [];
    for (let x = 455; x > -622; x -= 4) {
      ribs.push({ x, y: roofY, z: ARCADE_Z, sx: 0.14, sy: 0.18, sz: 7.2, color: '#5a5f66' });
      if (Math.round(x) % 8 === 3) lampsArc.push({ x, y: roofY - 1.1, z: ARCADE_Z });
    }
    this.group.add(instancedBoxes(ribs, lam(0xffffff), { receive: false }));
    // 吊りランプ
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0 });
    this.arcadeLampMat = lampMat;
    this.group.add(instancedBoxes(lampsArc.map((l) => ({ ...l, sx: 0.35, sy: 0.35, sz: 0.35 })), lampMat, { cast: false, receive: false, geo: new THREE.SphereGeometry(0.5, 10, 8) }));
    lampsArc.forEach((l, i) => { if (i % 2 === 0) this.lampPositions.push([l.x, l.y - 0.2, l.z]); });

    // 入口のゲートと、通りの名前の吊り看板
    const gate = (x, text, facing) => {
      const tex = labelTexture(text, { w: 1024, h: 160, size: 96, bg: '#2a2622', fg: '#f3e6c8' });
      // 表と裏に1枚ずつ（両面1枚だと裏から文字が反転して見える）
      for (const flip of [0, Math.PI]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.9), new THREE.MeshBasicMaterial({ map: tex }));
        m.position.set(x, roofY - 0.9, ARCADE_Z);
        m.rotation.y = facing + flip;
        m.translateZ(0.02);
        this.group.add(m);
      }
    };
    gate(452, '尾道本通り', Math.PI / 2);
    gate(-618, '尾道本通り', Math.PI / 2);
    ARCADE_SECTIONS.forEach((s) => { gate(s.x0 - 3, s.name, Math.PI / 2); gate(s.x1 + 3, s.name, Math.PI / 2); });
    gate(-120, '長江口', 0);
  }

  _tileTex(a, b, scale) {
    const r = seededRandom('tile' + a);
    return canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = a;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = b;
      g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke();
        g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.stroke();
      }
      speckle(g, w, h, 300, 0.08, r);
    }, { repeat: [1 / scale, 1 / scale] });
  }

  /** 東西にのびる平らな帯（x0〜x1、中心z、幅） */
  _flatStrip(x0, x1, cz, width, tex, y = FLAT_Y + 0.03) {
    const len = Math.abs(x0 - x1);
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(len / 4, width / 4);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), new THREE.MeshLambertMaterial({ map: t }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, cz);
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  // ---------- 海岸通り ----------
  _promenade() {
    const r = this.r;
    this._flatStrip(520, -650, -213.8, 12, this._tileTex('#c4bcae', '#aaa293', 1.5), FLAT_Y + 0.02);
    // 南北の小路
    for (const road of ROADS) {
      if (!road.id.startsWith('cross')) continue;
      const [x] = road.pts[0];
      const t = this._tileTex('#b3ab9c', '#9d9586', 1);
      t.repeat.set(road.width / 4, 42 / 4);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(road.width, 42), new THREE.MeshLambertMaterial({ map: t }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, FLAT_Y + 0.025, -191);
      m.receiveShadow = true;
      this.group.add(m);
    }
    // 係船柱・街灯・植え込み
    const bollards = [], posts = [], trees = [];
    for (let x = 515; x > -645; x -= 9) {
      if (FERRY_PIERS.some((p) => Math.abs(p - x) < 6)) continue;
      bollards.push({ x, y: FLAT_Y + 0.35, z: QUAY_Z + 0.6, sx: 0.35, sy: 0.7, sz: 0.35, color: '#3a3a3c' });
    }
    for (let x = 505; x > -645; x -= 27) {
      posts.push({ x, y: FLAT_Y + 2.2, z: -208.6, sx: 0.12, sy: 4.4, sz: 0.12, color: '#2f3336' });
      this.lampPositions.push([x, FLAT_Y + 4.5, -208.6]);
      if (r() < 0.5) {
        const s = 1.6 + r() * 0.8;
        trees.push({ x: x - 13, y: FLAT_Y + 2.6, z: -209, sx: s, sy: s * 1.1, sz: s, color: new THREE.Color().setHSL(0.27, 0.35, 0.25) });
      }
    }
    this.group.add(instancedBoxes(bollards, lam(0xffffff), { geo: new THREE.CylinderGeometry(0.5, 0.6, 1, 10) }));
    this.group.add(instancedBoxes(posts, lam(0xffffff), { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 6) }));
    this.group.add(instancedBoxes(trees, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(1, 1) }));

    // ベンチ（海を向いて座る）
    const wood = lam(0x8a6a4a), iron = lam(0x2f3336);
    BENCHES.forEach((b) => {
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
      g.position.set(b.x, FLAT_Y, b.z);
      this.group.add(g);
    });

    // 渡船のりば：浮き桟橋・渡り板・待合の小屋
    const pontoonMat = lam(0x9a9890), hutMat = lam(0xe8e2d4);
    const signTex = labelTexture('渡船のりば', { w: 512, h: 128, size: 72, bg: '#1f3b5a', fg: '#f4efe4' });
    FERRY_PIERS.forEach((px) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 9), pontoonMat);
      p.position.set(px, SEA_Y + 0.6, -227);
      p.receiveShadow = true;
      this.group.add(p);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 7), lam(0x6a6a66));
      plank.position.set(px + 4, (FLAT_Y + SEA_Y + 1.2) / 2, -222.5);
      plank.rotation.x = Math.atan2(FLAT_Y - (SEA_Y + 1.2), 7) * -1;
      this.group.add(plank);
      const hut = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3), hutMat);
      hut.position.set(px - 2, FLAT_Y + 1.3, -205.5);
      hut.castShadow = true;
      this.group.add(hut);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.2, 3.6), lam(0x2f5a7a));
      roof.position.set(px - 2, FLAT_Y + 2.7, -205.5);
      this.group.add(roof);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: signTex }));
      sign.position.set(px - 2, FLAT_Y + 3.2, -207.25);
      sign.rotation.y = Math.PI;
      this.group.add(sign);
      const sign2 = sign.clone();
      sign2.position.z = -203.75;
      sign2.rotation.y = 0;
      this.group.add(sign2);
    });
  }

  // ---------- 国道2号と JR山陽本線 ----------
  _route2AndRail() {
    const asphalt = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#4a4b4e';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 600, 0.12);
      g.fillStyle = '#e8e4d8';
      g.fillRect(0, h / 2 - 2, w / 2, 4);
    });
    this._flatStrip(462, -650, ROUTE2_Z, 7.4, asphalt, FLAT_Y + 0.035);
    // 横断歩道
    const zebra = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#4a4b4e'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ece8dc';
      for (let i = 0; i < 4; i++) g.fillRect(i * 16 + 2, 0, 9, h);
    });
    for (const x of [40, -120, 455]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 7), new THREE.MeshLambertMaterial({ map: zebra }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, FLAT_Y + 0.045, ROUTE2_Z);
      this.group.add(m);
    }

    // 線路：バラストと枕木のテクスチャ、レール
    const ballast = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#6b6560'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 900, 0.3);
      g.fillStyle = '#4a3a2e';
      for (let i = 0; i < 4; i++) g.fillRect(i * 16 + 4, 4, 7, h - 8);
    });
    for (const tz of [RAIL_Z - 1.6, RAIL_Z + 1.6]) {
      const bt = ballast.clone();
      bt.needsUpdate = true;
      bt.repeat.set(1180 / 2.4, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1180, 2.8), new THREE.MeshLambertMaterial({ map: bt }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(-65, FLAT_Y + 0.05, tz);
      m.receiveShadow = true;
      this.group.add(m);
    }
    const railMat = new THREE.MeshLambertMaterial({ color: 0x8a8580 });
    for (const tz of [RAIL_Z - 2.3, RAIL_Z - 0.9, RAIL_Z + 0.9, RAIL_Z + 2.3]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1180, 0.14, 0.08), railMat);
      rail.position.set(-65, FLAT_Y + 0.14, tz);
      this.group.add(rail);
    }
    // 線路わきの柵（踏切ではあける）
    const fences = [];
    for (let x = 515; x > -645; x -= 2.5) {
      if (CROSSINGS.some((cx) => Math.abs(cx - x) < 5)) continue;
      for (const fz of [RAIL_Z - 3.5, RAIL_Z + 3.6]) fences.push({ x, y: FLAT_Y + 0.6, z: fz, sx: 2.45, sy: 1.2, sz: 0.06, color: '#5f6a63' });
    }
    this.group.add(instancedBoxes(fences, new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), { receive: false }));

    // 踏切：警報機と遮断かん
    this.crossings = CROSSINGS.map((cx) => {
      const width = cx === -120 ? 6 : 3;
      const g = new THREE.Group();
      const lights = [];
      const arms = [];
      for (const side of [-1, 1]) {
        const pz = RAIL_Z + side * 4.2;
        const px = cx + side * (width / 2 + 0.5);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 8), lam(0x222222));
        pole.position.set(px, FLAT_Y + 1.7, pz);
        g.add(pole);
        const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.05), lam(0xf0d020));
        sign.position.set(px, FLAT_Y + 3.0, pz);
        sign.rotation.z = 0.6;
        const sign2 = sign.clone();
        sign2.rotation.z = -0.6;
        g.add(sign, sign2);
        for (const lx of [-0.25, 0.25]) {
          const lightMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3020, transparent: true, opacity: 0, depthWrite: false });
          const sp = new THREE.Sprite(lightMat);
          sp.position.set(px + lx, FLAT_Y + 2.4, pz);
          sp.scale.setScalar(0.7);
          g.add(sp);
          lights.push(sp);
        }
        const pivot = new THREE.Group();
        pivot.position.set(px, FLAT_Y + 1.0, pz);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, 0.08, 0.08), lam(0xf0d020));
        arm.position.x = -side * (width + 0.6) / 2;
        pivot.add(arm);
        pivot.rotation.z = side * 1.45;
        pivot.userData.side = side;
        g.add(pivot);
        arms.push(pivot);
      }
      this.group.add(g);
      return { x: cx, lights, arms, down: 0 };
    });
  }

  // ---------- ロープウェイ・艮神社 ----------
  _ropewayAndShrine() {
    const baseY = terrainY(-134, -148);
    const base = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 9), lam(0xd8d4ca));
    base.position.set(-136, baseY + 3.5, -147);
    base.castShadow = base.receiveShadow = true;
    this.group.add(base);
    const baseSign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1), new THREE.MeshBasicMaterial({ map: labelTexture('千光寺山ロープウェイ', { w: 768, h: 128, size: 64, bg: '#7a2a22', fg: '#f6ead8' }) }));
    baseSign.position.set(-136, baseY + 6.5, -151.55);
    baseSign.rotation.y = Math.PI;
    this.group.add(baseSign);
    const sign2 = baseSign.clone();
    sign2.rotation.y = -Math.PI / 2;
    sign2.position.set(-130.95, baseY + 6.5, -147);
    this.group.add(sign2);

    const topX = -40, topZ = 130;
    const topY = terrainY(topX, topZ);
    const top = new THREE.Mesh(new THREE.BoxGeometry(9, 7, 9), lam(0xd8d4ca));
    top.position.set(topX, topY + 3, topZ);
    this.group.add(top);
    this.ropeA = new THREE.Vector3(-134, baseY + 8.5, -147);
    this.ropeB = new THREE.Vector3(topX, topY + 7.5, topZ);
    const cable = new THREE.BufferGeometry().setFromPoints([this.ropeA, this.ropeB]);
    this.group.add(new THREE.Line(cable, new THREE.LineBasicMaterial({ color: 0x333333 })));
    // 支柱
    for (const t of [0.35, 0.68]) {
      const p = new THREE.Vector3().lerpVectors(this.ropeA, this.ropeB, t);
      const gy = terrainY(p.x, p.z);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, p.y - gy + 1, 0.8), lam(0x8a8a88));
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
      this.group.add(g);
      return { g, phase };
    });

    // 艮神社：朱の鳥居、拝殿、大きな楠
    const shrineY = terrainY(-104, -147);
    const vermilion = lam(0xc8442e);
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
    torii.position.set(-117.5, terrainY(-117.5, -145), -145.5);
    torii.rotation.y = 0.35;
    this.group.add(torii);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(6, 3.5, 5), lam(0x7a5a3e));
    hall.position.set(-102, shrineY + 1.5, -148);
    hall.castShadow = true;
    this.group.add(hall);
    const hallRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.4, 4), lam(0x3a3f46));
    hallRoof.rotation.y = Math.PI / 4;
    hallRoof.position.set(-102, shrineY + 4.3, -148);
    this.group.add(hallRoof);
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
    kusu.position.set(-108, terrainY(-108, -133), -133);
    this.group.add(kusu);
  }

  /** 天寧寺の三重塔（海雲塔） */
  _pagoda(x, z) {
    const g = new THREE.Group();
    const wood = lam(0x4a3428);
    const roof = lam(0x33373d);
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
    g.add(spire);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(5, 1.5, 5), lam(0x8a857a));
    plinth.position.y = -0.5;
    g.add(plinth);
    g.position.set(x, terrainY(x, z) - 0.2, z);
    g.scale.setScalar(1.6);
    g.rotation.y = 0.3;
    this.group.add(g);
  }

  _station() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(34, 7, 16), lam(0xe6e2da));
    body.position.set(0, 3.5, 0);
    body.castShadow = body.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(36, 0.6, 18), lam(0x5a4a3e));
    roof.position.y = 7.3;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(26, 3), lam(0x2a3036));
    glass.position.set(0, 2, -8.02);
    glass.rotation.y = Math.PI;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3), new THREE.MeshBasicMaterial({ map: labelTexture('尾道駅', { w: 512, h: 96, size: 70, bg: '#f4f2ee', fg: '#1f3b5a' }) }));
    sign.position.set(0, 5.6, -8.05);
    sign.rotation.y = Math.PI;
    g.add(body, roof, glass, sign);
    g.position.set(484, FLAT_Y, -176);
    this.group.add(g);
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
      g.strokeStyle = '#222'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx, cy + 6); g.lineTo(cx - 4, cy + 10); g.moveTo(cx, cy + 6); g.lineTo(cx + 4, cy + 10); g.stroke();
    });
    const geo = new THREE.SphereGeometry(0.32, 16, 10);
    const road = ROADS.find((r) => r.id === 'nekonohosomichi');
    const samples = samplePath(road.pts, 1);
    for (let i = 6; i < samples.length; i += 9) {
      const s = samples[i];
      const side = i % 2 ? 1 : -1;
      const x = s.x - Math.sin(s.angle) * side * 0.55, z = s.z + Math.cos(s.angle) * side * 0.55;
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, color: new THREE.Color().setHSL(0.08, 0.2, 0.85 + this.r() * 0.1) }));
      m.scale.set(1, 0.75, 1);
      m.position.set(x, terrainY(x, z) + 0.2, z);
      m.rotation.y = -s.angle + side * Math.PI / 2 + Math.PI;
      m.castShadow = true;
      this.group.add(m);
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

  /** 坂道と国道の街灯、夜の灯り（Points 1つでまとめて描く） */
  _lamps() {
    for (const road of ROADS) {
      if (road.surface !== 'stone') continue;
      const samples = samplePath(road.pts, 22);
      samples.forEach((s, i) => {
        if (i === 0) return;
        const x = s.x - Math.sin(s.angle) * (road.width / 2 + 0.3), z = s.z + Math.cos(s.angle) * (road.width / 2 + 0.3);
        const y = terrainY(x, z);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.2, 6), lam(0x2f3336));
        post.position.set(x, y + 1.6, z);
        this.group.add(post);
        this.lampPositions.push([x, y + 3.3, z]);
      });
    }
    for (let x = 450; x > -645; x -= 30) this.lampPositions.push([x, FLAT_Y + 5.5, ROUTE2_Z + 4]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.lampPositions.flat(), 3));
    this.lampMat = new THREE.PointsMaterial({ map: glowTexture(), color: 0xffd9a0, size: 2.2, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new THREE.Points(geo, this.lampMat));
  }

  // ---------- 電車 ----------
  _train() {
    const g = new THREE.Group();
    const body = lam(0xe8e6e0), stripe = lam(0xb8322a), dark = lam(0x2a2e33);
    this.trainWinMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0 });
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
      car.position.x = i * 20;
      g.add(car);
    }
    g.visible = false;
    g.position.y = FLAT_Y + 0.2;
    this.group.add(g);
    this.train = { g, x: 0, dir: 1, active: false, timer: 25 + this.r() * 30, speed: 17 };
  }

  /**
   * 毎フレーム。電車が近づいた踏切が鳴りはじめたら、その x を返す。
   */
  update(time, elapsed, dt) {
    const night = time.p.night;
    this.nightMats.forEach(({ mat, max }) => { mat.opacity = Math.min(max, night * 1.2); });
    this.lampMat.opacity = Math.min(1, night * 1.3);
    this.trainWinMat.opacity = Math.min(1, night * 1.2);
    this.signMat.emissiveIntensity = 0.15 + night * 0.6;
    this.arcadeLampMat.color.setScalar(0.7 + night * 0.3);

    // ロープウェイ（行ったり来たり）
    this.gondolas.forEach((gd) => {
      const ph = (elapsed / 90 + gd.phase) % 1;
      const t = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const p = new THREE.Vector3().lerpVectors(this.ropeA, this.ropeB, t);
      p.y -= Math.sin(t * Math.PI) * 4;
      gd.g.position.copy(p);
    });

    // 電車と踏切
    const T = this.train;
    const events = [];
    if (!T.active) {
      T.timer -= dt;
      if (T.timer <= 0) {
        T.active = true;
        T.dir = this.r() < 0.5 ? 1 : -1;
        T.x = T.dir > 0 ? -900 : 700;
        T.g.position.z = T.dir > 0 ? RAIL_Z - 1.6 : RAIL_Z + 1.6;
        T.g.visible = true;
        this.crossings.forEach((c) => { c.rang = false; });
      }
    } else {
      T.x += T.dir * T.speed * dt;
      T.g.position.x = T.x;
      if ((T.dir > 0 && T.x > 760) || (T.dir < 0 && T.x < -960)) {
        T.active = false;
        T.g.visible = false;
        T.timer = 70 + this.r() * 80;
      }
    }
    for (const c of this.crossings) {
      // 電車の先頭が 180m 手前に来てから、最後尾が通り過ぎるまで
      const head = T.dir > 0 ? T.x + 80 : T.x;
      const tail = T.dir > 0 ? T.x : T.x + 80;
      const approaching = T.active && (T.dir > 0 ? head > c.x - 180 && tail < c.x + 6 : head < c.x + 180 && tail > c.x - 6);
      if (approaching && !c.rang) { c.rang = true; events.push(c.x); }
      c.down += ((approaching ? 1 : 0) - c.down) * Math.min(1, dt * 1.5);
      c.arms.forEach((a) => { a.rotation.z = a.userData.side * 1.45 * (1 - c.down); });
      const blink = approaching ? (Math.floor(elapsed * 2.2) % 2) : -1;
      c.lights.forEach((l, i) => { l.material.opacity = blink === -1 ? 0 : (i % 2 === blink ? 1 : 0.1); });
    }
    return events;
  }
}
