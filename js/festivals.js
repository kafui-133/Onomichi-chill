// 尾道の年中行事（灯りまつりのろうそくは candles.js）。イベントのある日（または音のメニューで選んだとき）だけ作る。
//   さくら祭り：千光寺公園の桜の下にぼんぼり、山頂のまわりに屋台
//   みなと祭：海岸通りに屋台と万国旗、踊りの行列（太鼓の音）
//   住吉花火まつり：尾道水道の上に花火（音は距離のぶん遅れて届く）、海岸通りに屋台と浴衣の人
//   仮装・コスプレ オノミチフェスタ：駅前の芝生の広場に、仮装した人と、白いテントのマルシェ
//   ベッチャー祭り：面をつけた3体の鬼（ソバ・ベタ・ショーキー）が商店街を歩き、近づくと祝い棒でたたく。神輿も通る
import * as THREE from 'three';
import { ROADS, COAST, SUMMIT, ARCADE_ROADS, samplePath, roadLength, groundY, surfaceY, terrainY, SEA_Y, nearAnyRoad, inBuilding, inSolid, onOnomichiSide, straitAt, walkable } from './townMap.js';
import { lam, labelTexture } from './townKit.js';
import { buildPerson, mat } from './people.js';
import { canvasTexture, glowTexture, seededRandom, damp } from './util.js';

const STALL_FOOD = ['たこ焼き', '焼きそば', 'わたあめ', 'かき氷', 'りんご飴', 'ヨーヨー釣り', 'いか焼き', '金魚すくい', 'ベビーカステラ', 'フランクフルト', 'じゃがバター', 'くじ引き'];
const MARCHE = ['パン', '雑貨', 'コーヒー', 'レモネード', '手づくり', '古本', '焼き菓子', 'はちみつ'];

// ---------- 置き場所 ----------
/** 尾道側の海ぞい（海岸通り）の、陸へ少し入った点。x の範囲と、陸へ入る距離 */
function seaside(x0, x1, inland, step, r) {
  const out = [];
  for (const line of COAST) {
    for (const p of samplePath(line, step)) {
      if (!onOnomichiSide(p.x, p.z) || p.x < x0 || p.x > x1) continue;
      let nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
      if (terrainY(p.x + nx * 6, p.z + nz * 6) < terrainY(p.x - nx * 6, p.z - nz * 6)) { nx = -nx; nz = -nz; }
      const d = inland + (r ? (r() - 0.5) * 1.5 : 0);
      const x = p.x + nx * d, z = p.z + nz * d;
      if (groundY(x, z) - SEA_Y > 6 || inBuilding(x, z) || inSolid(x, z)) continue;
      out.push({ x, z, face: Math.atan2(nx, nz), tx: Math.cos(p.angle), tz: Math.sin(p.angle) });
    }
  }
  return out;
}
/** 商店街（本通り）を、駅のほうから西へつないだ一本の道 */
function arcadeChain() {
  const order = ['駅前商店街', '一番街', '中商店街', '本町センター街'];
  const pts = [];
  for (const n of order) {
    const rd = ARCADE_ROADS.find((r) => r.name === n);
    if (!rd) continue;
    let p = rd.pts.slice();
    if (pts.length) {
      const last = pts[pts.length - 1];
      if (Math.hypot(p[p.length - 1][0] - last[0], p[p.length - 1][1] - last[1]) < Math.hypot(p[0][0] - last[0], p[0][1] - last[1])) p.reverse();
    }
    pts.push(...p);
  }
  return pts;
}
/** 道のり s（m）の点と向き */
function along(pts, cum, s) {
  const L = cum[cum.length - 1];
  s = ((s % L) + L) % L;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, ang: Math.atan2(bx - ax, bz - az) };
}
const cumOf = (pts) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; };

// ---------- 小さな部品 ----------
function stripeTexture(a, b) {
  return canvasTexture(64, 64, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * w) / 8, 0, w / 8 + 1, h); } });
}
/** 赤い提灯（夜に灯る） */
function chochin(lanternMat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), lanternMat);
  body.scale.set(1, 1.25, 1);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 10), mat('#2a2420'));
  cap.position.y = 0.21;
  const bot = cap.clone(); bot.position.y = -0.21;
  g.add(body, cap, bot);
  return g;
}

/** 屋台：柱、台、しま模様の屋根、のれん（品書き）、提灯 */
function stall(label, { roofA = '#d8302a', roofB = '#f4efe4', cloth = '#c8302a', lanternMat, white = false } = {}) {
  const g = new THREE.Group();
  const wood = mat(white ? '#e8e6e0' : '#6a4a32');
  for (const [x, z] of [[-1.15, -0.8], [1.15, -0.8], [-1.15, 0.8], [1.15, 0.8]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.25, 0.07), wood);
    post.position.set(x, 1.12, z);
    g.add(post);
  }
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.85, 0.6), mat(white ? '#f2f0ea' : '#8a6a48'));
  counter.position.set(0, 0.43, 0.5);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.7), mat('#d8d2c4'));
  top.position.set(0, 0.88, 0.5);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 2.0), new THREE.MeshLambertMaterial({ map: stripeTexture(roofA, roofB) }));
  roof.position.set(0, 2.3, 0);
  roof.rotation.x = -0.12;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.1), mat(white ? '#f4f2ec' : cloth));
  back.position.set(0, 1.12, -0.8);
  const noren = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.42), new THREE.MeshLambertMaterial({ map: labelTexture(label, { w: 512, h: 96, size: 60, bg: white ? '#f4f2ec' : cloth, fg: white ? '#3a3632' : '#fff6e8' }) }));
  noren.position.set(0, 2.02, 0.84);
  g.add(counter, top, roof, back, noren);
  // 台の上の品物（色とりどりの小箱）
  for (let k = 0; k < 5; k++) {
    const it = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.18), mat(['#e8b860', '#c8302a', '#f4e8d0', '#3a8ad8', '#e85a9a'][k]));
    it.position.set(-0.8 + k * 0.4, 0.97, 0.5);
    g.add(it);
  }
  if (lanternMat) for (const x of [-1.1, 1.1]) { const c = chochin(lanternMat); c.position.set(x, 1.85, 0.95); g.add(c); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---------- 人（祭りの衣装） ----------
function dress(person, top, bottom, hairColor) {
  const { parts } = person;
  parts.torso.material = mat(top);
  for (const a of [parts.armL, parts.armR]) a.children[0].material = mat(top);
  for (const l of [parts.legL, parts.legR]) l.children[0].material = mat(bottom);
  if (hairColor) parts.head.children[1].material = mat(hairColor);
}
function yukata(r) {
  const p = buildPerson('stroller', r);
  const c = ['#2a3a6a', '#e8a0b8', '#f2f0ea', '#3a6a5a', '#c8402a', '#5a3a7a'][Math.floor(r() * 6)];
  dress(p, c, c);
  const obi = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 12), mat(['#e8c040', '#c8302a', '#f4efe4', '#3a3a5a'][Math.floor(r() * 4)]));
  obi.scale.z = 0.7;
  obi.position.y = 1.02;
  p.parts.torso.parent.add(obi);
  if (r() < 0.4) { const fan = new THREE.Mesh(new THREE.CircleGeometry(0.12, 10, 0, Math.PI), mat('#f0e8d8')); fan.position.set(0, -0.5, 0.06); p.parts.armR.add(fan); p.parts.armR.rotation.x = -0.9; }
  return p;
}
function dancer(r, i) {
  const p = buildPerson('stroller', r);
  const coat = ['#2a5aa8', '#c8302a', '#e8a020'][i % 3];
  dress(p, coat, '#f2f0ea');
  // はちまき
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 6, 14), mat('#f4f2ec'));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.03;
  p.parts.head.add(band);
  // 手に鳴子（黄色い板）
  for (const a of [p.parts.armL, p.parts.armR]) { const nk = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.08), mat('#e8c040')); nk.position.y = -0.58; a.add(nk); }
  return p;
}
function cosplayer(r) {
  const p = buildPerson('stroller', r);
  const vivid = ['#e8427a', '#3a8ae8', '#2ac8a8', '#f0c020', '#8a4ae8', '#f4f2ec', '#1a1a22', '#e86a2a'];
  const hairs = ['#f2a0c8', '#6ad8f0', '#c8c8d8', '#f0e070', '#8ae86a', '#e83a3a', '#1a1a22', '#f4f2ec'];
  dress(p, vivid[Math.floor(r() * vivid.length)], vivid[Math.floor(r() * vivid.length)], hairs[Math.floor(r() * hairs.length)]);
  const head = p.parts.head;
  const kind = Math.floor(r() * 5);
  if (kind === 0) {   // マント
    const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.25), new THREE.MeshLambertMaterial({ color: vivid[Math.floor(r() * vivid.length)], side: THREE.DoubleSide }));
    cape.position.set(0, 1.0, -0.14); cape.rotation.x = 0.12;
    p.parts.torso.parent.add(cape);
  } else if (kind === 1) {   // とんがり帽子
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 12), mat('#2a2236'));
    hat.position.y = 0.26; head.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 16), mat('#2a2236')); brim.position.y = 0.08; head.add(brim);
  } else if (kind === 2) {   // 猫耳
    for (const sx of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 4), mat('#f4f2ec')); ear.position.set(sx * 0.075, 0.12, 0); head.add(ear); }
  } else if (kind === 3) {   // 剣
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.9, 0.06), mat('#d8dde0'));
    sword.position.set(0, -0.9, 0.05); p.parts.armR.add(sword); p.parts.armR.rotation.x = -0.5;
  } else {   // 長い髪（うしろへ）
    const long = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.06), p.parts.head.children[1].material);
    long.position.set(0, -0.2, -0.1); head.add(long);
  }
  return p;
}
/** ベッチャーの鬼：面をつけ、派手な衣装で、祝い棒かササラを持つ */
function oni(r, i) {
  const p = buildPerson('stroller', r);
  const spec = [
    { name: 'ソバ', robe: '#2a3a7a', face: '#2a2a3a', hair: '#e8e4dc', tool: 'sasara' },
    { name: 'ベタ', robe: '#c83a2a', face: '#b8302a', hair: '#1a1614', tool: 'iwai' },
    { name: 'ショーキー', robe: '#3a6a3a', face: '#c84a2a', hair: '#1a1614', tool: 'iwai', beard: true },
  ][i];
  dress(p, spec.robe, spec.robe, spec.hair);
  p.root.scale.setScalar(1.08);
  const head = p.parts.head;
  // 面：顔の前に大きな面。目と口は黒く、牙
  const mask = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), mat(spec.face));
  mask.scale.set(1, 1.15, 0.7);
  mask.position.set(0, 0, 0.05);
  head.add(mask);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), mat('#f0d040')); eye.position.set(sx * 0.05, 0.03, 0.14); head.add(eye);
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.05, 4), mat('#f4f2ec')); fang.rotation.x = Math.PI; fang.position.set(sx * 0.035, -0.07, 0.14); head.add(fang);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.09, 6), mat('#e8dcc0')); horn.position.set(sx * 0.07, 0.16, 0.02); horn.rotation.z = -sx * 0.3; head.add(horn);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), mat('#1a1010')); mouth.position.set(0, -0.06, 0.15); head.add(mouth);
  if (spec.beard) { const beard = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 8), mat('#1a1614')); beard.rotation.x = Math.PI; beard.position.set(0, -0.2, 0.08); head.add(beard); }
  // ふさふさの髪（面のうしろ）
  const mane = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat(spec.hair));
  mane.scale.set(1, 0.9, 0.8); mane.position.set(0, 0.02, -0.09); head.add(mane);
  // 持ち物：祝い棒（紙の房のついた棒）か、ササラ（先を細く割った竹）
  const stick = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.1, 6), mat(spec.tool === 'sasara' ? '#c8b070' : '#d8c8a0'));
  pole.position.y = -0.55;
  stick.add(pole);
  if (spec.tool === 'iwai') for (let k = 0; k < 6; k++) { const tas = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.01), mat(['#f4f2ec', '#c8302a', '#e8c040'][k % 3])); tas.position.set(Math.cos(k) * 0.04, -1.15, Math.sin(k) * 0.04); stick.add(tas); }
  else for (let k = 0; k < 7; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.35, 0.012), mat('#c8b070')); sp.position.set((k - 3) * 0.012, -1.22, 0); sp.rotation.z = (k - 3) * 0.05; stick.add(sp); }
  stick.position.y = -0.5;
  stick.rotation.x = Math.PI * 0.85;   // 手に持って、上へかかげる
  p.parts.armR.add(stick);
  p.name = spec.name;
  return p;
}
/** 神輿：屋根と鳳凰をのせた箱を、担ぎ棒で4人が担ぐ */
function mikoshi(r) {
  const g = new THREE.Group();
  const gold = new THREE.MeshLambertMaterial({ color: 0xd8a838, emissive: 0x3a2a08 }), black = mat('#1a1614');
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), black); box.position.y = 1.9;
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 1.0), gold); base.position.y = 1.58;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.5, 4), black); roof.rotation.y = Math.PI / 4; roof.position.y = 2.45;
  const bird = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), gold); bird.position.y = 2.8;
  g.add(box, base, roof, bird);
  for (const sx of [-0.35, 0.35]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.4), mat('#c8b48a')); pole.position.set(sx, 1.52, 0); g.add(pole); }
  const bearers = [];
  for (const [x, z] of [[-0.55, -1.2], [0.55, -1.2], [-0.55, 1.2], [0.55, 1.2]]) {
    const p = buildPerson('stroller', r);
    dress(p, '#f4f2ec', '#f4f2ec');
    p.root.position.set(x, 0, z);
    p.parts.armL.rotation.x = p.parts.armR.rotation.x = -2.6;   // 肩の上の棒をつかむ
    g.add(p.root);
    bearers.push(p);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, bearers };
}

// ---------- 花火 ----------
class Fireworks {
  constructor(scene, launch) {
    this.launch = launch;   // 打ち上げの台船（海の上）
    this.N = 14000;
    this.pos = new Float32Array(this.N * 3);
    this.col = new Float32Array(this.N * 3);
    this.vel = new Float32Array(this.N * 3);
    this.life = new Float32Array(this.N);
    this.max = new Float32Array(this.N);
    this.base = new Float32Array(this.N * 3);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 4.6, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.shells = [];
    this.timer = 1;
    this.pending = [];
    this.r = seededRandom('hanabi');
  }
  _emit(x, y, z, vx, vy, vz, life, c) {
    const i = this.next; this.next = (this.next + 1) % this.N;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.base.set(c, i * 3);
    this.life[i] = life; this.max[i] = life;
  }
  /** 1発打ち上げる。onBurst(x, y, z) は開いた瞬間（音のため） */
  shoot(onBurst) {
    const r = this.r, L = this.launch;
    this.shells.push({ x: L.x + (r() - 0.5) * 40, z: L.z + (r() - 0.5) * 16, y: L.y, vy: 55 + r() * 18, t: 0, fuse: 1.3 + r() * 0.6, onBurst,
      kind: Math.floor(r() * 4), color: [[1, 0.45, 0.3], [1, 0.85, 0.35], [0.45, 0.75, 1], [0.6, 1, 0.5], [1, 0.5, 0.85], [1, 1, 0.95]][Math.floor(r() * 6)] });
  }
  update(dt, active) {
    const r = this.r;
    if (active) {
      this.timer -= dt;
      if (this.timer <= 0) {
        // ふだんは1〜3発ずつ。ときどき、たて続けに十数発（スターマイン）
        const q = r();
        const n = q < 0.12 ? 10 + Math.floor(r() * 8) : 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) this.pending.push(k * (q < 0.12 ? 0.18 : 0.35) + r() * 0.1);
        this.timer = q < 0.12 ? 4 : 0.5 + r() * 1.0;
      }
      for (let k = this.pending.length - 1; k >= 0; k--) {
        this.pending[k] -= dt;
        if (this.pending[k] <= 0) { this.shoot(this.onBurst); this.pending.splice(k, 1); }
      }
    }
    // 上がっていく玉：細い火の尾
    for (const s of this.shells) {
      s.t += dt; s.vy -= 9.8 * dt * 0.6; s.y += s.vy * dt;
      this._emit(s.x, s.y, s.z, (r() - 0.5) * 0.6, -2, (r() - 0.5) * 0.6, 0.5, [1, 0.75, 0.4]);
      if (s.t >= s.fuse) {
        s.done = true;
        const n = s.kind === 3 ? 110 : 220, sp = s.kind === 1 ? 20 : 32 + r() * 8;
        for (let k = 0; k < n; k++) {
          // 球のかたちに散る（kind 2 は輪、3 は柳のように垂れる）
          let ux = r() * 2 - 1, uy = r() * 2 - 1, uz = r() * 2 - 1;
          if (s.kind === 2) uy *= 0.15;
          const l = Math.hypot(ux, uy, uz) || 1;
          const v = sp * (0.85 + r() * 0.15);
          const c = k % 7 === 0 ? [1, 1, 0.9] : s.color;
          this._emit(s.x, s.y, s.z, (ux / l) * v, (uy / l) * v, (uz / l) * v, s.kind === 3 ? 3.2 : 1.8 + r() * 0.6, c);
        }
        s.onBurst?.(s.x, s.y, s.z);
      }
    }
    this.shells = this.shells.filter((s) => !s.done);
    const P = this.pos, V = this.vel, C = this.col, B = this.base;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt;
      const drag = Math.exp(-1.6 * dt);
      V[i * 3] *= drag; V[i * 3 + 1] = V[i * 3 + 1] * drag - 6 * dt; V[i * 3 + 2] *= drag;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      const tw = f < 0.35 ? (Math.sin(i * 12.9 + this.life[i] * 40) > 0 ? 1 : 0.3) : 1;   // 消えぎわにちらちら
      const a = Math.min(1, f * 1.6) * tw;
      C[i * 3] = B[i * 3] * a; C[i * 3 + 1] = B[i * 3 + 1] * a; C[i * 3 + 2] = B[i * 3 + 2] * a;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------- まとめ ----------
export class Festivals {
  constructor(scene, town, audio) {
    this.scene = scene;
    this.town = town;
    this.audio = audio;
    this.built = {};
    this.active = new Set();
    this.lanternMat = new THREE.MeshLambertMaterial({ color: 0xd8402a, emissive: 0xff7a3a, emissiveIntensity: 0 });
    this.onToast = null;
  }

  /** その日のイベント（id の配列）を出す・しまう */
  set(ids) {
    this.active = new Set(ids);
    for (const id of ['sakura', 'minato', 'hanabi', 'cosplay', 'beccha']) {
      if (this.active.has(id) && !this.built[id]) this.built[id] = this['_' + id]();
      if (this.built[id]) this.built[id].group.visible = this.active.has(id);
    }
  }

  _group() { const g = new THREE.Group(); this.scene.add(g); return g; }

  /** 海岸通りに屋台を並べ、頭の上に提灯の列 */
  _stalls(g, x0, x1, count, seedName, white = false) {
    const r = seededRandom(seedName);
    const spots = seaside(x0, x1, 5.5, 3, r).filter((p) => !nearAnyRoad(p.x, p.z, 0.3));
    const all = [];
    for (const p of spots.sort((a, b) => b.x - a.x)) if (!all.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 3.4)) all.push(p);
    // 範囲ぜんたいに、ふた組ずつ並ぶように間引く
    const pick = [];
    const stepN = Math.max(1, Math.floor(all.length / count));
    for (let i = 0; i < all.length && pick.length < count; i += (pick.length % 2 ? stepN * 2 - 1 : 1)) pick.push(all[i]);
    const list = white ? MARCHE : STALL_FOOD;
    pick.forEach((p, i) => {
      const s = stall(list[i % list.length], white ? { white: true, roofA: '#f4f2ec', roofB: '#e8e4dc', lanternMat: null } : { lanternMat: this.lanternMat, roofA: ['#d8302a', '#2a5aa8', '#e89a20'][i % 3], cloth: ['#c8302a', '#2a4a8a', '#3a7a3a', '#8a3a7a'][i % 4] });
      s.position.set(p.x, surfaceY(p.x, p.z), p.z);
      s.rotation.y = p.face + Math.PI;   // 店の正面（+Z）を陸の道へ
      g.add(s);
    });
    return pick;
  }

  _people(g, spots, make, n, r, spread = 4) {
    const out = [];
    for (let i = 0; i < n * 3 && out.length < n && spots.length; i++) {
      const s = spots[Math.floor(r() * spots.length)];
      const p = make(r, out.length);
      const x = s.x + (r() - 0.5) * spread, z = s.z + (r() - 0.5) * spread;
      if (!walkable(x, z)) continue;
      p.root.position.set(x, surfaceY(x, z), z);
      p.root.rotation.y = r() * Math.PI * 2;
      p.phase = r() * 10;
      g.add(p.root);
      out.push(p);
    }
    return out;
  }

  _sakura() {
    const g = this._group(), r = seededRandom('sakura-fes');
    // ぼんぼり（千光寺公園：山頂のまわりの小径）
    const bon = [];
    for (const rd of ROADS) {
      if (!rd.pts.some(([x, z]) => Math.hypot(x - SUMMIT.x, z - SUMMIT.z) < 160)) continue;
      samplePath(rd.pts, 7).forEach((p, i) => {
        if (terrainY(p.x, p.z) - SEA_Y < 95 || Math.hypot(p.x - SUMMIT.x, p.z - SUMMIT.z) > 170) return;
        const sd = i % 2 ? 1 : -1, off = rd.width / 2 + 0.5;
        const x = p.x - Math.sin(p.angle) * sd * off, z = p.z + Math.cos(p.angle) * sd * off;
        if (inBuilding(x, z) || inSolid(x, z)) return;
        bon.push({ x, z, y: groundY(x, z) });
      });
    }
    const paper = new THREE.MeshLambertMaterial({ color: 0xf6e8e0, emissive: 0xffc8a8, emissiveIntensity: 0 });
    this.bonboriMat = paper;
    const postG = new THREE.CylinderGeometry(0.04, 0.05, 1.5, 6), boxG = new THREE.BoxGeometry(0.28, 0.42, 0.28);
    const posts = new THREE.InstancedMesh(postG, mat('#5a4430'), bon.length), boxes = new THREE.InstancedMesh(boxG, paper, bon.length);
    const m = new THREE.Matrix4();
    bon.forEach((b, i) => { posts.setMatrixAt(i, m.makeTranslation(b.x, b.y + 0.75, b.z)); boxes.setMatrixAt(i, m.makeTranslation(b.x, b.y + 1.65, b.z)); });
    g.add(posts, boxes);
    this.bonPts = bon;
    // ぼんぼりの光のにじみ（夜だけ）
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(bon.flatMap((b) => [b.x, b.y + 1.65, b.z]), 3));
    this.bonGlow = new THREE.PointsMaterial({ map: glowTexture(), color: 0xffb890, size: 2.2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    g.add(new THREE.Points(glowGeo, this.bonGlow));
    // 桜（季節でなくても、桜の木を満開に）
    const pink = ['#f2c4cf', '#eab4c2', '#f6d4dc'];
    const trees = this.town.sakuraTrees || [];
    // 夜桜：ぼんぼりに照らされて、夜もほんのり白く見える
    this.yozakura = new THREE.MeshLambertMaterial({ flatShading: true, emissive: 0xf0c0cc, emissiveIntensity: 0 });
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6, 1), this.yozakura, trees.length * 4);
    let k = 0;
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
    for (const t of trees) for (let j = 0; j < 4; j++) {
      pos.set(t.x + (r() - 0.5) * 3, t.y + t.h - 0.2 + r() * 1.3, t.z + (r() - 0.5) * 3);
      sc.set(3.2 + r(), 2 + r() * 0.6, 3.2 + r());
      crown.setMatrixAt(k, m.compose(pos, q, sc));
      crown.setColorAt(k, col.set(pink[j % 3]));
      k++;
    }
    crown.count = k;
    if (k) g.add(crown);
    // 屋台（山頂の広場のまわり）
    const spots = [];
    for (const rd of ROADS) {
      if (spots.length >= 8 || !rd.pts.some(([x, z]) => Math.hypot(x - SUMMIT.x, z - SUMMIT.z) < 70)) continue;
      for (const p of samplePath(rd.pts, 9)) {
        if (spots.length >= 8 || Math.hypot(p.x - SUMMIT.x, p.z - SUMMIT.z) > 70) continue;
        const nx = -Math.sin(p.angle), nz = Math.cos(p.angle), off = rd.width / 2 + 1.6;
        const x = p.x + nx * off, z = p.z + nz * off;
        if (inBuilding(x, z) || inSolid(x, z) || nearAnyRoad(x, z, 0.4) || spots.some((q) => Math.hypot(q.x - x, q.z - z) < 4)) continue;
        spots.push({ x, z, face: Math.atan2(-nx, -nz) });   // 道のほうを向く
      }
    }
    spots.forEach((p, i) => { const s = stall(STALL_FOOD[i % STALL_FOOD.length], { lanternMat: this.lanternMat }); s.position.set(p.x, surfaceY(p.x, p.z), p.z); s.rotation.y = p.face; g.add(s); });
    const people = this._people(g, spots.length ? spots : [{ x: SUMMIT.x, z: SUMMIT.z }], (rr) => buildPerson('traveler', rr), 14, r);
    return { group: g, people };
  }

  _minato() {
    const g = this._group(), r = seededRandom('minato');
    const stalls = this._stalls(g, -150, 420, 22, 'minato-stalls');
    // 万国旗：屋台の列の上に、色とりどりの小旗をつないだ紐
    const flags = [], cols = ['#c8302a', '#f4f2ec', '#2a5aa8', '#e8c040', '#3a8a3a', '#e86a9a'];
    for (let i = 0; i < stalls.length - 1; i++) {
      const a = stalls[i], b = stalls[i + 1];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 12) continue;
      const ya = surfaceY(a.x, a.z) + 3.4, yb = surfaceY(b.x, b.z) + 3.4;
      for (let k = 0; k < 10; k++) {
        const t = k / 10, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = ya + (yb - ya) * t - Math.sin(t * Math.PI) * 0.4;
        flags.push({ x, y, z, ang: Math.atan2(b.x - a.x, b.z - a.z), c: cols[k % cols.length] });
      }
    }
    const fg = new THREE.ConeGeometry(0.16, 0.32, 3);
    fg.rotateX(Math.PI);
    const inst = new THREE.InstancedMesh(fg, new THREE.MeshLambertMaterial(), flags.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    flags.forEach((f, i) => { q.setFromEuler(e.set(0, f.ang, 0)); inst.setMatrixAt(i, m.compose(new THREE.Vector3(f.x, f.y, f.z), q, new THREE.Vector3(1, 1, 0.2))); inst.setColorAt(i, col.set(f.c)); });
    if (flags.length) g.add(inst);
    // 踊りの行列：海岸通りを、ゆっくり進む
    const path = seaside(-150, 420, 9, 4, null).filter((p) => walkable(p.x, p.z)).sort((a, b) => b.x - a.x).map((p) => [p.x, p.z]);
    const cum = cumOf(path);
    const dancers = [];
    for (let i = 0; i < 18; i++) {
      const p = dancer(r, i);
      p.s = -(Math.floor(i / 3) * 2.2);
      p.lane = ((i % 3) - 1) * 1.3;
      g.add(p.root);
      dancers.push(p);
    }
    const people = this._people(g, stalls, (rr) => buildPerson('stroller', rr), 24, r);
    return { group: g, people, dancers, path, cum, head: 0, drum: 0 };
  }

  _hanabi() {
    const g = this._group(), r = seededRandom('hanabi-fes');
    const stalls = this._stalls(g, -150, 300, 16, 'hanabi-stalls');
    const people = this._people(g, stalls, yukata, 30, r);
    const lx = -60, lz = straitAt(lx).z + 25;
    this.fw = new Fireworks(this.scene, { x: lx, y: SEA_Y + 2, z: lz });
    this.fw.onBurst = (x, y, z) => this.burst?.(x, y, z);
    // 打ち上げの台船
    const barge = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 6), mat('#3a3e44'));
    barge.position.set(lx, SEA_Y + 0.3, lz);
    g.add(barge);
    return { group: g, people };
  }

  _cosplay() {
    const g = this._group(), r = seededRandom('cosplay');
    // 駅前の芝生の広場（駅の東、海ぎわ）。白いテントのマルシェと、仮装した人たち
    const lawn = seaside(380, 520, 14, 3, r).filter((p) => walkable(p.x, p.z));
    const stalls = this._stalls(g, 380, 520, 8, 'marche', true);
    // 仮装の人は、芝生の3か所に集まって、写真を撮りあう
    const centers = lawn.length ? [lawn[Math.floor(lawn.length * 0.25)], lawn[Math.floor(lawn.length * 0.5)], lawn[Math.floor(lawn.length * 0.75)]] : stalls;
    const people = this._people(g, centers, cosplayer, 36, r, 11);
    // 写真を撮る人
    const cams = this._people(g, centers, (rr) => buildPerson('traveler', rr), 10, r, 14);
    for (const c of cams) { c.parts.armL.rotation.x = c.parts.armR.rotation.x = -1.4; }
    return { group: g, people: [...people, ...cams] };
  }

  _beccha() {
    const g = this._group(), r = seededRandom('beccha');
    const path = arcadeChain(), cum = cumOf(path), L = cum[cum.length - 1] || 1;
    const onis = [0, 1, 2].map((i) => {
      const p = oni(r, i);
      p.s = L * (0.2 + i * 0.3); p.dir = i % 2 ? 1 : -1; p.hitCool = 0; p.swing = 0;
      g.add(p.root);
      return p;
    });
    const mk = mikoshi(r);
    mk.s = L * 0.5;
    g.add(mk.group);
    // 見物の人（商店街のあちこち）
    const crowd = [];
    for (let i = 0; i < 20; i++) {
      const p = buildPerson(r() < 0.5 ? 'stroller' : 'traveler', r);
      const q = along(path, cum, r() * L);
      const sd = r() < 0.5 ? 1 : -1;
      const x = q.x + Math.cos(q.ang) * sd * 1.8, z = q.z - Math.sin(q.ang) * sd * 1.8;
      p.root.position.set(x, surfaceY(x, z), z);
      p.root.rotation.y = q.ang + (sd > 0 ? -Math.PI / 2 : Math.PI / 2);
      p.phase = r() * 10;
      g.add(p.root);
      crowd.push(p);
    }
    return { group: g, onis, mk, path, cum, L, people: crowd };
  }

  // ---------- 毎フレーム ----------
  update(dt, t, hour, cam, night) {
    this.lanternMat.emissiveIntensity = night * 1.2;
    if (this.bonboriMat) {
      const on = this.active.has('sakura') && hour > 17.5 ? night : 0;
      this.bonboriMat.emissiveIntensity = on * 1.2;
      this.bonGlow.opacity = on * 0.8;
      this.yozakura.emissiveIntensity = on * 0.3;
    }
    for (const id of this.active) {
      const b = this.built[id];
      if (!b) continue;
      for (const p of b.people || []) {
        // 立っている人：すこし揺れて、ときどき向きを変える
        p.root.children[0].position.y = Math.abs(Math.sin(t * 1.3 + p.phase)) * 0.01;
        if (Math.sin(t * 0.13 + p.phase) > 0.995) p.root.rotation.y += dt * 1.5;
      }
    }
    // みなと祭：踊りの行列（昼間）
    const mn = this.active.has('minato') && this.built.minato;
    if (mn && mn.path.length > 2) {
      const day = hour > 9 && hour < 18;
      mn.head += day ? dt * 0.7 : 0;
      for (const p of mn.dancers) {
        const q = along(mn.path, mn.cum, mn.head + p.s);
        const x = q.x + Math.cos(q.ang) * p.lane, z = q.z - Math.sin(q.ang) * p.lane;
        p.root.position.set(x, surfaceY(x, z), z);
        p.root.rotation.y = q.ang;
        const sw = Math.sin(t * 4 + p.s);
        p.parts.armL.rotation.x = -1.6 + sw * 0.9; p.parts.armR.rotation.x = -1.6 - sw * 0.9;
        p.parts.legL.rotation.x = sw * 0.4; p.parts.legR.rotation.x = -sw * 0.4;
        p.root.visible = day;
      }
      // 太鼓の音（行列が近いとき）
      const lead = mn.dancers[0].root.position, d = Math.hypot(lead.x - cam.x, lead.z - cam.z);
      mn.drum -= dt;
      if (day && d < 90 && mn.drum <= 0) { mn.drum = 0.55; this.audio.taiko?.(Math.max(0.05, 0.5 * (1 - d / 90))); }
    }
    // 花火（夜の19時半〜20時半）
    if (this.fw) {
      // 花火の日は、暗くなったら（夜の19時ごろ〜明け方まで）ずっと上がる。時を止めていても上がりつづける
      const on = this.active.has('hanabi') && (night > 0.35 || (hour >= 19 && hour < 21));
      this.fw.points.visible = this.active.has('hanabi');
      this.burst = (x, y, z) => {
        const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
        this.audio.boom?.(Math.min(0.9, 140 / (60 + d)), d / 340);
      };
      this.fw.update(dt, on);
    }
    // ベッチャー：鬼は商店街を行き来し、近づくと寄ってきて、祝い棒でぽんとたたく
    const bc = this.active.has('beccha') && this.built.beccha;
    if (bc && bc.path.length > 2) {
      const day = hour > 8.5 && hour < 17.5;
      for (const o of bc.onis) {
        o.root.visible = day;
        if (!day) continue;
        const pos = o.root.position, dCam = Math.hypot(pos.x - cam.x, pos.z - cam.z);
        o.hitCool -= dt;
        let moving = true;
        if (dCam < 7 && o.hitCool <= 0) {
          // 寄ってくる
          const ux = (cam.x - pos.x) / (dCam || 1), uz = (cam.z - pos.z) / (dCam || 1);
          if (dCam > 1.3) { pos.x += ux * dt * 1.6; pos.z += uz * dt * 1.6; }
          else {
            o.swing = 1; o.hitCool = 25; moving = false;
            this.audio.whack?.();
            this.onToast?.(`鬼の「${o.name}」に、祝い棒で頭をぽんとたたかれた。これで一年、元気でいられるらしい`);
          }
          o.root.rotation.y = Math.atan2(ux, uz);
          pos.y = surfaceY(pos.x, pos.z);
        } else {
          o.s += o.dir * dt * 0.9;
          if (o.s < 0 || o.s > bc.L) o.dir *= -1;
          const q = along(bc.path, bc.cum, o.s);
          // 道の上へ、なめらかに戻る
          pos.x = damp(pos.x, q.x, 1.5, dt); pos.z = damp(pos.z, q.z, 1.5, dt);
          pos.y = surfaceY(pos.x, pos.z);
          o.root.rotation.y = q.ang + (o.dir < 0 ? Math.PI : 0);
        }
        o.swing = Math.max(0, o.swing - dt * 1.5);
        const w = Math.sin(t * 5 + o.s);
        o.parts.legL.rotation.x = moving ? w * 0.45 : 0; o.parts.legR.rotation.x = moving ? -w * 0.45 : 0;
        o.parts.armR.rotation.x = o.swing > 0 ? -2.6 + (1 - o.swing) * 2.4 : -0.6 + Math.sin(t * 2 + o.s) * 0.4;
        o.parts.armL.rotation.x = -w * 0.3;
      }
      // 神輿：ゆっくり、わっしょいと上下しながら
      const mk = bc.mk;
      mk.group.visible = day;
      if (day) {
        mk.s += dt * 0.45;
        const q = along(bc.path, bc.cum, mk.s);
        mk.group.position.set(q.x, surfaceY(q.x, q.z) + Math.abs(Math.sin(t * 2.4)) * 0.12, q.z);
        mk.group.rotation.y = q.ang;
        for (const p of mk.bearers) { const w = Math.sin(t * 4.8 + p.root.position.x); p.parts.legL.rotation.x = w * 0.4; p.parts.legR.rotation.x = -w * 0.4; }
      }
    }
  }
}
