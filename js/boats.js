// 尾道水道を行き交う船：渡船（向島との往復）、小さな漁船、ゆっくりの貨物船
import * as THREE from 'three';
import { SEA_LEVEL } from './world.js';
import { FERRY_ROUTES, BOUNDS, straitAt } from './townMap.js';
import { glowTexture, rand, pick } from './util.js';


function lightSprite(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  s.scale.setScalar(size);
  return s;
}

function buildBoat(type) {
  const g = new THREE.Group();
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  let len, beam, lights = [];
  if (type === 'ferry') {
    len = 16; beam = 7;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len, 1.6, beam), lam(0xe9e6de));
    hull.position.y = 0.6;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, 0.4, beam + 0.1), lam(0x2f6aa8));
    stripe.position.y = 0.2;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 3), lam(0xf4f2ec));
    cabin.position.set(0, 2.6, -1.5);
    g.add(hull, stripe, cabin);
    lights.push([0xfff0c8, [0, 3, -1.5], 6], [0x40ff70, [len / 2, 2, 0], 3], [0xff4030, [-len / 2, 2, 0], 3]);
  } else if (type === 'fishing') {
    len = 9; beam = 2.6;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, beam), lam(0xf0efe8));
    hull.position.y = 0.5;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(beam * 0.72, 2.6, 4), lam(0xf0efe8));
    bow.rotation.z = -Math.PI / 2;
    bow.rotation.x = Math.PI / 4;
    bow.scale.set(1, 1, 0.5);
    bow.position.set(len / 2 + 1.2, 0.6, 0);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 1.8), lam(0xdedad0));
    cabin.position.set(-1.5, 1.8, 0);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4), lam(0x555555));
    mast.position.set(-1.2, 3.6, 0);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshLambertMaterial({ color: pick([0xd03a30, 0x2a5aa8, 0xf2c53a]), side: THREE.DoubleSide }));
    flag.position.set(-1.7, 5.2, 0);
    g.add(hull, bow, cabin, mast, flag);
    lights.push([0xffffff, [-1.2, 5.8, 0], 4], [0xfff0c0, [-1.5, 2, 0], 3]);
  } else {
    len = 95; beam = 15;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len, 8, beam), lam(pick([0x3b4f6b, 0x7a2f2a, 0x2f4a3f])));
    hull.position.y = 2;
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 1, beam), lam(0xd8d4c8));
    top.position.y = 6.5;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(12, 10, beam - 2), lam(0xf2f0ea));
    bridge.position.set(-len / 2 + 9, 11, 0);
    const funnel = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 3), lam(0xc23a2a));
    funnel.position.set(-len / 2 + 6, 18, 0);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(len * 0.6, 4, beam - 3), lam(pick([0xb8572e, 0x3f6a8a, 0x9a8a3a])));
    cargo.position.set(len * 0.12, 9, 0);
    g.add(hull, top, bridge, funnel, cargo);
    lights.push([0xffffff, [-len / 2 + 9, 19, 0], 8], [0xfff0c0, [-len / 2 + 9, 12, 0], 10], [0xffffff, [len / 2 - 4, 9, 0], 5]);
  }
  const sprites = lights.map(([c, p, s]) => {
    const sp = lightSprite(c, s);
    sp.position.set(...p);
    g.add(sp);
    return sp;
  });
  return { group: g, len, sprites };
}

class Boat {
  constructor(scene, type) {
    this.type = type;
    const b = buildBoat(type);
    this.group = b.group;
    this.len = b.len;
    this.sprites = b.sprites;
    this.angle = 0;
    this.speed = 0;
    this.active = false;
    this.wait = rand(0, 20);
    scene.add(this.group);
    this.group.visible = false;
    this.passed = false;
  }
  get x() { return this.group.position.x; }
  get z() { return this.group.position.z; }
}

export class Boats {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.passListeners = [];
    // 渡船：実際の3航路（尾道渡船・福本渡船・駅前渡船）を行き来する
    FERRY_ROUTES.forEach((route, i) => {
      const b = new Boat(scene, 'ferry');
      b.ferry = { route, side: i % 2, wait: 4 + i * 15, t: 0 };
      const p = i % 2 ? route.b : route.a;
      b.group.position.set(p.x, SEA_LEVEL, p.z);
      b.group.visible = true;
      this.list.push(b);
    });
    for (let i = 0; i < 3; i++) {
      const b = new Boat(scene, 'fishing');
      b.wait = rand(0, 25) + i * 12;
      this.list.push(b);
    }
    const cargo = new Boat(scene, 'cargo');
    cargo.wait = rand(30, 70);
    this.list.push(cargo);
  }

  /** 船が正面を通り過ぎたとき（引き波が岸に届く音を鳴らすため） */
  onPass(fn) { this.passListeners.push(fn); }

  /** 水道の中心線にそって東西に横切る船 */
  _spawnTraverse(b) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    b.lane = b.type === 'cargo' ? rand(-15, 15) : rand(-70, 70);
    b.dir = dir;
    b.group.position.x = dir > 0 ? BOUNDS.x0 - 250 : BOUNDS.x1 + 250;
    b.speed = b.type === 'cargo' ? rand(5, 7) : rand(7, 11);
    b.active = true;
    b.passed = false;
    b.group.visible = true;
    this._placeOnStrait(b);
  }

  _placeOnStrait(b) {
    const s = straitAt(b.group.position.x);
    b.group.position.z = s.z + b.lane;
    b.angle = s.angle + (b.dir > 0 ? 0 : Math.PI);
    b.group.rotation.y = -b.angle;
  }

  update(dt, elapsed, night) {
    for (const b of this.list) {
      if (b.ferry) this._updateFerry(b, dt);
      else if (!b.active) {
        b.wait -= dt;
        if (b.wait <= 0) this._spawnTraverse(b);
      } else {
        // 中心線の向きに進む（x 方向の成分ぶん進める）
        b.group.position.x += b.dir * b.speed * dt * Math.abs(Math.cos(straitAt(b.x).angle));
        this._placeOnStrait(b);
        if (!b.passed && Math.sign(b.x) === b.dir) {
          b.passed = true;
          this.passListeners.forEach((fn) => fn(b));
        }
        if (b.x < BOUNDS.x0 - 300 || b.x > BOUNDS.x1 + 300) {
          b.active = false;
          b.group.visible = false;
          b.wait = b.type === 'cargo' ? rand(70, 160) : rand(10, 45);
        }
      }
      // ゆらゆら
      b.group.position.y = SEA_LEVEL + Math.sin(elapsed * 0.8 + b.len) * 0.15;
      b.group.rotation.z = Math.sin(elapsed * 0.7 + b.len) * 0.02;
      b.sprites.forEach((s) => { s.material.opacity = Math.min(1, night * 1.3); });
    }
  }

  _updateFerry(b, dt) {
    const f = b.ferry;
    const from = f.side ? f.route.b : f.route.a, to = f.side ? f.route.a : f.route.b;
    if (f.wait > 0) {
      f.wait -= dt;
      b.speed = 0;
      if (f.wait <= 0) { f.t = 0; b.passed = false; }
      return;
    }
    const dx = to.x - from.x, dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    const dur = dist / 5.5;
    f.t += dt / dur;
    const t = Math.min(1, f.t);
    const s = t * t * (3 - 2 * t);
    // 潮に流されるように、少しふくらんで渡る
    const bulge = Math.sin(t * Math.PI) * 14;
    b.group.position.x = from.x + dx * s - (dz / dist) * bulge;
    b.group.position.z = from.z + dz * s + (dx / dist) * bulge;
    b.angle = Math.atan2(dz, dx);
    b.group.rotation.y = -b.angle;
    b.speed = 5.5 * 6 * s * (1 - s);
    if (!b.passed && t > 0.5) { b.passed = true; this.passListeners.forEach((fn) => fn(b)); }
    if (t >= 1) { f.side = 1 - f.side; f.wait = 18 + Math.random() * 10; }
  }

  /** 海面シェーダーに渡す引き波情報 */
  wakes(cameraPos) {
    return this.list
      .filter((b) => b.group.visible && b.speed > 0.5)
      .map((b) => ({ x: b.x, z: b.z, strength: Math.min(1, b.speed / 8) * (b.type === 'cargo' ? 1 : 0.8), angle: b.angle, d: Math.hypot(b.x - cameraPos.x, b.z - cameraPos.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
  }

  nearestFishing(cameraPos) {
    let best = null;
    for (const b of this.list) {
      if (b.type !== 'fishing' || !b.active) continue;
      const d = Math.hypot(b.x - cameraPos.x, b.z - cameraPos.z);
      if (!best || d < best.d) best = { boat: b, d };
    }
    return best;
  }
}
