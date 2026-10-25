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

/**
 * 船体：上から見た形（へさきのとがり、ともは平ら。両頭なら両方とも丸く）を縦にのばし、底を少しすぼめたもの。
 * 長さ len（x）、幅 beam（z）、高さ h（y：0〜h）
 */
function hullGeometry(len, beam, h, { bow = 0.28, doubleEnded = false } = {}) {
  const L = len / 2, B = beam / 2, sh = new THREE.Shape();
  const bx = L - len * bow;
  if (doubleEnded) sh.moveTo(0, -B); else sh.moveTo(-L, -B * 0.9);
  sh.lineTo(bx, -B);
  sh.quadraticCurveTo(L * 0.96, -B * 0.85, L, 0);
  sh.quadraticCurveTo(L * 0.96, B * 0.85, bx, B);
  if (doubleEnded) {
    sh.lineTo(-bx, B);
    sh.quadraticCurveTo(-L * 0.96, B * 0.85, -L, 0);
    sh.quadraticCurveTo(-L * 0.96, -B * 0.85, -bx, -B);   // ここから始点へは、まっすぐ閉じる
  } else {
    sh.lineTo(-L, B * 0.9);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < h * 0.5) { p.setX(i, p.getX(i) * 0.94); p.setZ(i, p.getZ(i) * 0.72); }
  g.computeVertexNormals();
  return g;
}

function buildBoat(type) {
  const g = new THREE.Group();
  const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; };
  let len, beam, lights = [];
  if (type === 'ferry') {
    // 尾道の渡船：車も乗せる平たい両頭船。甲板の両わきに手すりと客室の屋根、片側に高い操舵室、両端に車の渡り板
    len = 16; beam = 7;
    const white = lam(0xe9e6de), blue = lam(0x2f6aa8), dark = lam(0x2a3038), rail = lam(0xd8d6ce), deckM = lam(0x6a6e72), glass = lam(0x34424e);
    const hull = new THREE.Mesh(hullGeometry(len, beam, 1.5, { bow: 0.18, doubleEnded: true }), white);
    hull.position.y = -0.4;
    const stripe = new THREE.Mesh(hullGeometry(len * 1.005, beam * 1.005, 0.35, { bow: 0.18, doubleEnded: true }), blue);
    stripe.position.y = -0.25;
    g.add(hull, stripe);
    box(len * 0.82, 0.06, beam * 0.86, deckM, 0, 1.12, 0);                       // 甲板（車の通るところ）
    for (const sd of [-1, 1]) {
      // 両わきの客室（窓の帯と屋根）と、手すり
      box(len * 0.62, 1.9, 1.2, white, 0, 2.05, sd * (beam / 2 - 0.7));
      box(len * 0.6, 0.6, 1.22, glass, 0, 2.35, sd * (beam / 2 - 0.7));
      box(len * 0.66, 0.12, 1.5, rail, 0, 3.05, sd * (beam / 2 - 0.65));
      for (let k = -3; k <= 3; k++) box(0.06, 1.0, 0.06, rail, k * 1.9, 1.65, sd * (beam / 2 - 0.15));
      box(len * 0.75, 0.06, 0.06, rail, 0, 2.15, sd * (beam / 2 - 0.15));
      // 車の渡り板（両端、少し持ち上げてある）
      const ramp = box(1.6, 0.1, beam * 0.5, deckM, sd * (len / 2 + 0.2), 1.35, 0);
      ramp.rotation.z = sd * 0.3;
      // 船ばたの古タイヤ
      for (let k = -2; k <= 2; k++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.12, 5, 10), dark);
        t.position.set(k * 3, 0.55, sd * (beam / 2 + 0.05));
        g.add(t);
      }
    }
    // 操舵室：片側の客室の上に、四方に窓
    box(2.4, 1.5, 1.7, white, 1.5, 3.85, -(beam / 2 - 0.85));
    box(2.42, 0.6, 1.72, glass, 1.5, 4.05, -(beam / 2 - 0.85));
    box(2.7, 0.12, 2.0, rail, 1.5, 4.66, -(beam / 2 - 0.85));
    const mast = box(0.08, 1.4, 0.08, rail, 1.5, 5.4, -(beam / 2 - 0.85));
    mast.castShadow = false;
    lights.push([0xfff0c8, [0, 2.6, beam / 2 - 0.7], 6], [0xfff0c8, [0, 2.6, -beam / 2 + 0.7], 6], [0xffffff, [1.5, 6.1, -beam / 2 + 0.85], 3], [0x40ff70, [len / 2 - 1, 3.2, beam / 2 - 0.7], 2.5], [0xff4030, [len / 2 - 1, 3.2, -beam / 2 + 0.7], 2.5]);
  } else if (type === 'fishing') {
    len = 10; beam = 2.8;
    const white = lam(pick([0xf0efe8, 0xf0efe8, 0xe8eef2])), deckM = lam(0x8a7a62), glass = lam(0x34424e);
    const hull = new THREE.Mesh(hullGeometry(len, beam, 1.4, { bow: 0.32 }), white);
    hull.position.y = -0.3;
    const band = new THREE.Mesh(hullGeometry(len * 1.015, beam * 1.03, 0.18, { bow: 0.32 }), lam(pick([0x2a5a8a, 0xb03a2e, 0x2a7a5a])));
    band.position.y = 0.9;
    g.add(hull, band);
    box(len * 0.8, 0.05, beam * 0.8, deckM, -0.2, 1.08, 0);
    // 操舵室（窓の帯）と、マスト、旗、ともの巻き上げ機
    box(2, 1.6, 1.9, lam(0xdedad0), -1.6, 1.9, 0);
    box(2.02, 0.5, 1.92, glass, -1.6, 2.25, 0);
    box(2.3, 0.1, 2.1, lam(0xe6e2d8), -1.6, 2.75, 0);
    box(0.07, 4, 0.07, lam(0x555555), -1.2, 3.8, 0);
    box(2.6, 0.05, 0.05, lam(0x555555), -1.2, 4.6, 0).rotation.y = Math.PI / 2;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshLambertMaterial({ color: pick([0xd03a30, 0x2a5aa8, 0xf2c53a]), side: THREE.DoubleSide }));
    flag.position.set(-1.7, 5.4, 0);
    g.add(flag);
    box(0.8, 0.6, 0.9, lam(0x5a6a72), -len / 2 + 1.2, 1.4, 0);
    lights.push([0xffffff, [-1.2, 5.9, 0], 4], [0xfff0c0, [-1.6, 2.2, 0], 3]);
  } else {
    len = 95; beam = 15;
    const hullC = pick([0x3b4f6b, 0x7a2f2a, 0x2f4a3f]);
    const hull = new THREE.Mesh(hullGeometry(len, beam, 8, { bow: 0.16 }), lam(hullC));
    hull.position.y = -2;
    const boot = new THREE.Mesh(hullGeometry(len * 1.003, beam * 1.003, 1.6, { bow: 0.16 }), lam(0x8a2a24));
    boot.position.y = -1.9;
    g.add(hull, boot);
    box(len * 0.82, 0.6, beam * 0.9, lam(0xd8d4c8), -len * 0.02, 6.2, 0);
    // 船橋（白い箱に窓の列）と、煙突
    const white = lam(0xf2f0ea), glass = lam(0x34424e);
    box(12, 10, beam - 2, white, -len / 2 + 9, 11, 0);
    for (let f = 0; f < 3; f++) box(12.05, 0.8, beam - 1.9, glass, -len / 2 + 9, 8 + f * 3, 0);
    box(4, 0.4, beam + 1, white, -len / 2 + 13, 15.6, 0);   // 船橋の張り出し
    box(3, 5, 3, lam(0xc23a2a), -len / 2 + 6, 18, 0);
    box(len * 0.6, 4, beam - 3, lam(pick([0xb8572e, 0x3f6a8a, 0x9a8a3a])), len * 0.1, 8.5, 0);
    // クレーンの柱
    for (const x of [-0.05, 0.25]) box(0.8, 9, 0.8, lam(0xe0b030), len * x, 11, 0);
    lights.push([0xffffff, [-len / 2 + 9, 19, 0], 8], [0xfff0c0, [-len / 2 + 9, 12, 0], 10], [0xffffff, [len / 2 - 4, 9, 0], 5]);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
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
    const FERRY_SPEED = 1.8; // m/s。実際の渡船のように、ゆっくり渡る
    const dur = dist / FERRY_SPEED;
    f.t += dt / dur;
    const t = Math.min(1, f.t);
    const s = t * t * (3 - 2 * t);
    // 潮に流されるように、少しふくらんで渡る
    const bulge = Math.sin(t * Math.PI) * 14;
    b.group.position.x = from.x + dx * s - (dz / dist) * bulge;
    b.group.position.z = from.z + dz * s + (dx / dist) * bulge;
    b.angle = Math.atan2(dz, dx);
    b.group.rotation.y = -b.angle;
    b.speed = FERRY_SPEED * 6 * s * (1 - s);
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
