// 窓の外：坂の家並み・三重塔・対岸（向島）の街と造船所クレーン・尾道大橋・瀬戸内の島影
import * as THREE from 'three';
import { seededRandom, glowTexture } from './util.js';

export const SEA_LEVEL = -60;
export const SHORE_Z = -220;       // 尾道側の岸
export const FAR_SHORE_Z = -560;   // 向島の岸

/** 坂の地面の高さ（家の窓から海岸まで下っていく） */
function slopeY(z) {
  const t = Math.min(1, Math.max(0, (-z - 6) / (Math.abs(SHORE_Z) - 14)));
  return -5 - Math.pow(t, 1.1) * (Math.abs(SEA_LEVEL) - 7);
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.r = seededRandom('onomichi-town');
    this.blinkers = [];
    this.lightMats = [];

    this._ground();
    this._slopeTown();
    this._pagoda(-46, -110);
    this._shoreTown();
    this._mukaishima();
    this._cranes();
    this._bridge();
    this._farIslands();
    this._nearFoliage();
  }

  mat(color, opts = {}) {
    return new THREE.MeshLambertMaterial({ color, ...opts });
  }

  _ground() {
    // 坂の斜面（家々の下の地面）
    const geo = new THREE.PlaneGeometry(1400, 230, 80, 40);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i) - 118;
      pos.setZ(i, z);
      pos.setY(i, slopeY(z) - 0.5 + Math.sin(pos.getX(i) * 0.05) * 1.2);
    }
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, this.mat(0x4b5a3c));
    this.group.add(ground);

    // 海岸の護岸
    const quay = new THREE.Mesh(new THREE.BoxGeometry(2000, 2, 8), this.mat(0x8a8780));
    quay.position.set(0, SEA_LEVEL + 0.6, SHORE_Z - 2);
    this.group.add(quay);
  }

  /** InstancedMesh で家を並べる（胴体＋切妻屋根） */
  _houses(list) {
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    bodyGeo.translate(0, 0.5, 0);
    const roofGeo = new THREE.CylinderGeometry(0.62, 0.62, 1, 3, 1);
    // 三角柱：長さ方向を x に、頂点（棟）を上に向ける
    roofGeo.rotateZ(Math.PI / 2);
    roofGeo.rotateX(-Math.PI / 2);
    const bodies = new THREE.InstancedMesh(bodyGeo, this.mat(0xffffff), list.length);
    const roofs = new THREE.InstancedMesh(roofGeo, this.mat(0xffffff), list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const windows = [];
    list.forEach((h, i) => {
      q.setFromEuler(new THREE.Euler(0, h.rot, 0));
      m.compose(new THREE.Vector3(h.x, h.y, h.z), q, new THREE.Vector3(h.w, h.h, h.d));
      bodies.setMatrixAt(i, m);
      bodies.setColorAt(i, c.set(h.wall));
      m.compose(new THREE.Vector3(h.x, h.y + h.h + h.roofH * 0.25, h.z), q, new THREE.Vector3(h.w * 1.08, h.roofH, h.d * 1.15));
      roofs.setMatrixAt(i, m);
      roofs.setColorAt(i, c.set(h.roof));
      // 夜に灯る窓
      if (this.r() < 0.75) {
        const floors = Math.max(1, Math.round(h.h / 3.2));
        for (let f = 0; f < floors; f++) {
          if (this.r() < 0.45) continue;
          windows.push({ x: h.x + (this.r() - 0.5) * h.w * 0.6, y: h.y + 1.4 + f * 3.1, z: h.z + h.d / 2 + 0.05, s: 0.7 + this.r() * 0.6 });
        }
      }
    });
    this.group.add(bodies, roofs);
    return windows;
  }

  _windowLights(list, color = 0xffc77a, scale = 1) {
    const geo = new THREE.PlaneGeometry(1, 0.8);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    list.forEach((w, i) => {
      m.makeScale(w.s * scale, w.s * scale, 1);
      m.setPosition(w.x, w.y, w.z);
      mesh.setMatrixAt(i, m);
    });
    this.group.add(mesh);
    this.lightMats.push({ mat, phase: this.r() });
    return mesh;
  }

  _slopeTown() {
    const r = this.r;
    const walls = ['#e9e2d4', '#d8cfbf', '#cfc6b5', '#6b5543', '#5a4a3c', '#efe9df', '#bfb6a6'];
    const roofs = ['#4d535b', '#454b54', '#5b6068', '#3e434a', '#6a5b4e', '#556270', '#7a4a3a'];
    const list = [];
    for (let z = -34; z > SHORE_Z + 8; z -= 6 + r() * 4) {
      const spread = 60 + (-z) * 2.2;
      for (let x = -spread; x < spread; x += 7 + r() * 7) {
        if (r() < 0.22) continue;
        if (Math.abs(x + 46) < 12 && Math.abs(z + 110) < 12) continue; // 三重塔の場所
        const w = 4 + r() * 4, d = 4 + r() * 3, h = 2.8 + r() * 3.5;
        list.push({
          x: x + (r() - 0.5) * 3, z, y: slopeY(z) - 0.3, w, h, d,
          rot: (r() - 0.5) * 0.25, roofH: 1.4 + r() * 0.8,
          wall: walls[Math.floor(r() * walls.length)], roof: roofs[Math.floor(r() * roofs.length)],
        });
      }
    }
    const win = this._houses(list);
    this._windowLights(win);

    // 坂の緑（木々）
    const treeGeo = new THREE.IcosahedronGeometry(1, 1);
    const n = 320;
    const trees = new THREE.InstancedMesh(treeGeo, this.mat(0xffffff, { flatShading: true }), n);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const z = -36 - r() * (Math.abs(SHORE_Z) - 45);
      const x = (r() - 0.5) * (120 + -z * 4);
      const s = 2 + r() * 3.5;
      m.makeScale(s, s * (0.8 + r() * 0.5), s);
      m.setPosition(x, slopeY(z) + s * 0.6, z);
      trees.setMatrixAt(i, m);
      trees.setColorAt(i, c.setHSL(0.24 + r() * 0.08, 0.3 + r() * 0.15, 0.2 + r() * 0.1));
    }
    this.group.add(trees);
  }

  /** 天寧寺の三重塔のシルエット */
  _pagoda(x, z) {
    const g = new THREE.Group();
    const wood = this.mat(0x4a3428);
    const roof = this.mat(0x33373d);
    let y = 0;
    const sizes = [5.2, 4.5, 3.8];
    sizes.forEach((s, i) => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(s * 0.7, 3.4, s * 0.7), wood);
      body.position.y = y + 1.7;
      g.add(body);
      const rf = new THREE.Mesh(new THREE.ConeGeometry(s * 0.95, 1.6, 4, 1, true), roof);
      rf.rotation.y = Math.PI / 4;
      rf.position.y = y + 3.4 + 0.5;
      g.add(rf);
      const eave = new THREE.Mesh(new THREE.ConeGeometry(s * 0.95, 0.5, 4), roof);
      eave.rotation.y = Math.PI / 4;
      eave.position.y = y + 3.4;
      eave.scale.y = -1;
      g.add(eave);
      y += 3.9 - i * 0.1;
    });
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 5, 6), this.mat(0x6b5a3a));
    spire.position.y = y + 2.5;
    g.add(spire);
    g.position.set(x, slopeY(z) - 0.5, z);
    g.scale.setScalar(1.6);
    g.rotation.y = 0.3;
    this.group.add(g);
  }

  _shoreTown() {
    const r = this.r;
    const list = [];
    const walls = ['#e4e1da', '#cfd0cc', '#d9d2c4', '#b9b5ad', '#efeae0'];
    const roofs = ['#5c626a', '#7a7f86', '#4b5058'];
    for (let x = -700; x < 700; x += 7 + r() * 8) {
      const z = SHORE_Z + 10 + r() * 6;
      const h = 5 + r() * (Math.abs(x) < 150 ? 16 : 8);
      list.push({ x, z, y: SEA_LEVEL + 1, w: 6 + r() * 6, h, d: 7 + r() * 4, rot: 0, roofH: 0.6, wall: walls[Math.floor(r() * walls.length)], roof: roofs[Math.floor(r() * roofs.length)] });
    }
    const win = this._houses(list);
    this._windowLights(win, 0xffd9a0);
  }

  _mukaishima() {
    const r = this.r;
    // 向島の丘
    const hillMat = this.mat(0x3d5236);
    const hills = [
      [-560, 300, 55, 170], [-180, 320, 75, 200], [200, 260, 50, 160], [520, 340, 80, 220], [880, 300, 60, 180], [-950, 320, 65, 200],
    ];
    hills.forEach(([x, sx, sy, sz]) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), hillMat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, SEA_LEVEL - 8, FAR_SHORE_Z - sz - 20);
      this.group.add(m);
    });
    // 対岸の低い街並み
    const list = [];
    const walls = ['#d8d4cb', '#c4c0b8', '#e6e2d8', '#a9a49b', '#6f8aa0'];
    const roofs = ['#55606b', '#3f4650', '#6c7682'];
    for (let x = -900; x < 900; x += 8 + r() * 10) {
      if (x > 80 && x < 330) continue; // 造船所のエリア
      const z = FAR_SHORE_Z - 6 - r() * 25;
      list.push({ x, z, y: SEA_LEVEL + 0.5, w: 7 + r() * 8, h: 4 + r() * 7, d: 8, rot: 0, roofH: 1.2, wall: walls[Math.floor(r() * walls.length)], roof: roofs[Math.floor(r() * roofs.length)] });
    }
    const win = this._houses(list);
    this._windowLights(win, 0xffe0b0, 2.2);
    const quay = new THREE.Mesh(new THREE.BoxGeometry(2000, 2, 30), this.mat(0x7d7b76));
    quay.position.set(0, SEA_LEVEL + 0.2, FAR_SHORE_Z - 10);
    this.group.add(quay);
  }

  /** 向島の造船所：赤白のゴライアスクレーンとドックの船体 */
  _cranes() {
    const red = this.mat(0xc8463a);
    const white = this.mat(0xe8e6e0);
    const blinkMat = () => new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3a2a, transparent: true, depthWrite: false, fog: false, opacity: 0 });
    const addCrane = (x, z, h, span) => {
      const g = new THREE.Group();
      const legGeo = new THREE.BoxGeometry(2.5, h, 2.5);
      [-span / 2, span / 2].forEach((lx, i) => {
        const leg = new THREE.Mesh(legGeo, i ? red : white);
        leg.position.set(lx, h / 2, 0);
        g.add(leg);
      });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 10, 5, 4), red);
      beam.position.y = h;
      g.add(beam);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(span + 10.2, 1.6, 4.2), white);
      stripe.position.y = h;
      g.add(stripe);
      // 航空障害灯（夜にゆっくり明滅）
      [-span / 2, span / 2].forEach((lx) => {
        const s = new THREE.Sprite(blinkMat());
        s.position.set(lx, h + 4, 0);
        s.scale.setScalar(9);
        g.add(s);
        this.blinkers.push({ mat: s.material, phase: this.r() * 6 });
      });
      g.position.set(x, SEA_LEVEL, z);
      this.group.add(g);
    };
    addCrane(150, FAR_SHORE_Z - 30, 62, 70);
    addCrane(260, FAR_SHORE_Z - 40, 48, 50);
    // ドックの船体
    const hull = new THREE.Mesh(new THREE.BoxGeometry(110, 12, 22), this.mat(0x2f4a66));
    hull.position.set(200, SEA_LEVEL + 5, FAR_SHORE_Z - 32);
    this.group.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(18, 14, 16), white);
    deck.position.set(240, SEA_LEVEL + 17, FAR_SHORE_Z - 32);
    this.group.add(deck);
  }

  /** 尾道大橋（斜張橋）のシルエット */
  _bridge() {
    const g = new THREE.Group();
    const mat = this.mat(0xd9d8d2);
    const x = -720;
    const deckY = SEA_LEVEL + 32;
    const z0 = SHORE_Z + 20, z1 = FAR_SHORE_Z - 20;
    const len = z0 - z1;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 3, len), mat);
    deck.position.set(x, deckY, (z0 + z1) / 2);
    g.add(deck);
    const towers = [z0 - len * 0.28, z1 + len * 0.28];
    const cablePts = [];
    towers.forEach((tz) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(4, 60, 4), mat);
      t.position.set(x, deckY + 18, tz);
      g.add(t);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(8, 34, 8), mat);
      pier.position.set(x, SEA_LEVEL + 15, tz);
      g.add(pier);
      for (let i = 1; i <= 8; i++) {
        for (const sgn of [-1, 1]) {
          cablePts.push(x, deckY + 46 - i * 1.5, tz, x, deckY + 1.5, tz + sgn * i * 11);
        }
      }
    });
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
    g.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0xe8e8e2, transparent: true, opacity: 0.7 })));
    this.group.add(g);
    // 橋の街灯
    const lamps = [];
    for (let z = z1; z < z0; z += 14) lamps.push({ x: x + 8, y: deckY + 3, z, s: 1.2 });
    this._windowLights(lamps, 0xffe6b0, 1.6);
  }

  /** 瀬戸内の島影（霞んで重なる） */
  _farIslands() {
    const r = this.r;
    const layers = [
      { z: -1150, color: 0x4d6a72, count: 7 },
      { z: -1800, color: 0x6b8590, count: 6 },
      { z: -2500, color: 0x8399a4, count: 5 },
    ];
    layers.forEach((L) => {
      const mat = this.mat(L.color);
      for (let i = 0; i < L.count; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mat);
        const sx = 180 + r() * 380;
        m.scale.set(sx, 60 + r() * 110, 120 + r() * 120);
        m.position.set(-2400 + (i + r() * 0.7) * (4800 / L.count), SEA_LEVEL - 10, L.z - r() * 200);
        this.group.add(m);
      }
    });
  }

  /** 窓のすぐ外：軒先の松の枝と瓦屋根 */
  _nearFoliage() {
    const leaf = this.mat(0x2f4a2a, { flatShading: true });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const clusters = [
      [8.5, 3.4, -13, 1.6], [9.8, 2.6, -14.5, 1.9], [7.6, 4.2, -15, 1.3], [10.6, 3.8, -12.5, 1.5],
      [-11, -1.5, -16, 2.2], [-9.5, -0.5, -17.5, 1.6],
    ];
    clusters.forEach(([x, y, z, s]) => {
      const m = new THREE.Mesh(geo, leaf);
      m.position.set(x, y, z);
      m.scale.set(s * 1.4, s * 0.6, s);
      this.group.add(m);
    });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 7, 6), this.mat(0x4a3a2e));
    trunk.position.set(9.4, -0.8, -14);
    trunk.rotation.z = 0.35;
    this.group.add(trunk);

    // 下の家の瓦屋根（すぐ眼下）
    const roofMat = this.mat(0x4f555d);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 6), roofMat);
    roof.position.set(-1.5, -6.5, -12);
    roof.rotation.x = 0.35;
    this.group.add(roof);
  }

  update(time, elapsed) {
    const night = time.p.night;
    this.lightMats.forEach(({ mat }) => { mat.opacity = Math.min(1, night * 1.2); });
    this.blinkers.forEach((b) => {
      b.mat.opacity = night * (0.5 + 0.5 * Math.sin(elapsed * 1.6 + b.phase)) * 0.9;
    });
  }
}
