// 遠景：向島の造船所クレーン・尾道大橋・瀬戸内の島影。
// 尾道と向島の地形・道・建物は実データから town.js が作る。
import * as THREE from 'three';
import { seededRandom, glowTexture } from './util.js';
import { SEA_Y, BOUNDS, straitAt } from './townMap.js';

export const SEA_LEVEL = SEA_Y;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.r = seededRandom('onomichi-town');
    this.blinkers = [];
    this.lightMats = [];

    this._cranes();
    this._bridge();
    this._farIslands();
  }

  mat(color, opts = {}) {
    return new THREE.MeshLambertMaterial({ color, ...opts });
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
    bodies.castShadow = bodies.receiveShadow = true;
    roofs.castShadow = true;
    this.group.add(bodies, roofs);
    return windows;
  }

  _windowLights(list, color = 0xffa75e, scale = 1) {
    const geo = new THREE.PlaneGeometry(1, 0.8);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
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

  /** 向島の造船所：赤白のゴライアスクレーンとドックの船体 */
  _cranes() {
    // 向島の造船所のクレーンは、うすい青緑色
    const red = this.mat(0x9ccfba);
    const white = this.mat(0xdfeee6);
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
    // 向島側の岸辺（水道の中心から南へ）
    const fz = (x) => straitAt(x).z - 135;
    addCrane(150, fz(150), 62, 70);
    addCrane(260, fz(260) - 10, 48, 50);
    // ドックの船体
    const hull = new THREE.Mesh(new THREE.BoxGeometry(110, 12, 22), this.mat(0x2f4a66));
    hull.position.set(200, SEA_LEVEL + 5, fz(200) + 8);
    this.group.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(18, 14, 16), white);
    deck.position.set(240, SEA_LEVEL + 17, fz(240) + 8);
    this.group.add(deck);
  }

  /** 尾道大橋（斜張橋）のシルエット */
  _bridge() {
    const g = new THREE.Group();
    const mat = this.mat(0xd9d8d2);
    // 尾道大橋は町の東のはずれ（データの範囲の外）で水道をまたぐ
    const x = BOUNDS.x0 - 160;
    const deckY = SEA_LEVEL + 32;
    const c = straitAt(BOUNDS.x0).z;
    const z0 = c + 170, z1 = c - 170;
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
    this._windowLights(lamps, 0xffa04a, 1.6);
  }

  /** 瀬戸内の島影（霞んで重なる） */
  _farIslands() {
    const r = this.r;
    const layers = [
      { z: -1750, color: 0x4d6a72, count: 7 },
      { z: -2300, color: 0x6b8590, count: 6 },
      { z: -2900, color: 0x8399a4, count: 5 },
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

  update(time, elapsed) {
    const night = time.p.night;
    this.lightMats.forEach(({ mat }) => { mat.opacity = Math.min(1, night * 1.2); });
    this.blinkers.forEach((b) => {
      b.mat.opacity = night * (0.5 + 0.5 * Math.sin(elapsed * 1.6 + b.phase)) * 0.9;
    });
  }
}
