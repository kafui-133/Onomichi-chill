// 猫：プリミティブで組んだ茶トラ。親密度に応じて4段階でふるまいが変わる。
//   Lv.1 警戒：窓辺から遠く（海）を見ている。触れると耳を伏せてそっぽを向く
//   Lv.2 関心：窓辺から降りて、少し近くに来て座る
//   Lv.3 慣れ：足もとで香箱座り。シッポをペシペシ、ゴロゴロ
//   Lv.4 信頼：となりの座布団の上で丸くなって眠る
import * as THREE from 'three';
import { canvasTexture, clamp, damp, lerp, seededRandom } from './util.js';
import { SILL_Y } from './room.js';

export const LEVEL_THRESHOLDS = [0, 4, 10, 18];
const STORAGE_KEY = 'onomichi-cat-affection';
const STRAY_KEY = 'onomichi-stray-affection';
function loadStrays() {
  try { return JSON.parse(localStorage.getItem(STRAY_KEY)) || {}; } catch { return {}; }
}

const LEVEL_TEXT = {
  2: '猫がこちらを気にしている。少しだけ近づいてきた',
  3: '足もとでシッポがぺしぺし。ゴロゴロ…',
  4: '座布団の上で丸くなった。ここで眠るらしい',
};
// 町の猫（その場から動かない）が懐いたとき
const STRAY_LEVEL_TEXT = {
  2: 'こちらを気にしている。少し、気を許したらしい',
  3: 'シッポがぴんと立った。もう逃げない',
  4: 'すっかり懐いた。地図に、この猫の居場所が記された',
};

// 各レベルの居場所（y は足もとの高さ）と向き
const SPOTS = {
  1: { pos: new THREE.Vector3(1.5, SILL_Y, -1.45), face: 'sea', pose: 'sit' },
  2: { pos: new THREE.Vector3(1.0, 0, -0.75), face: 'camera', pose: 'sit' },
  3: { pos: new THREE.Vector3(0.36, 0, -0.05), face: 'camera', pose: 'loaf' },
  4: { pos: new THREE.Vector3(0.62, 0.08, 0.38), face: 'side', pose: 'curl' },
};

// 毛色。base=地の色、stripe=縞、plain=耳・脚など、tip=シッポの先、belly=お腹の白、patches=三毛のぶち
export const COATS = {
  chatora:   { label: '茶トラ',   base: '#d98e4a', stripe: '150,75,30',  plain: 0xd38a47, tip: 0x9a5528, belly: true },
  sabatora:  { label: 'サバトラ', base: '#9c9b97', stripe: '38,38,40',   plain: 0x8e8d89, tip: 0x34343a, belly: true },
  kijitora:  { label: 'キジトラ', base: '#8c7052', stripe: '45,32,20',   plain: 0x7d6449, tip: 0x3a2a1e, belly: false },
  hachiware: { label: 'ハチワレ', base: '#2b2724', stripe: null,         plain: 0x2b2724, tip: 0x2b2724, belly: true, whiteLegs: true },
  mike:      { label: '三毛',     base: '#efe7da', stripe: null,         plain: 0xe9e0d2, tip: 0x2a2420, belly: true, patches: ['#d0843e', '#2e2925'] },
  shiro:     { label: '白',       base: '#eee8de', stripe: null,         plain: 0xece5da, tip: 0xe2dacd, belly: false },
  chashiro:  { label: '茶白',     base: '#dc9550', stripe: '160,85,35',  plain: 0xd8924e, tip: 0xa25c2c, belly: true, whiteLegs: true },
  kuro:      { label: '黒',       base: '#23201e', stripe: null,         plain: 0x23201e, tip: 0x1c1a18, belly: false, eye: 0xc9a23a },
};

function furTexture(coat, seed) {
  const r = seededRandom('tora' + seed);
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = coat.base;
    g.fillRect(0, 0, w, h);
    // 縞
    if (coat.stripe) {
      for (let i = 0; i < 18; i++) {
        const x = (i / 18) * w + r() * 6;
        g.strokeStyle = `rgba(${coat.stripe},${0.45 + r() * 0.3})`;
        g.lineWidth = 3 + r() * 5;
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y < h * 0.7; y += 8) g.lineTo(x + Math.sin(y * 0.1 + i) * 4, y);
        g.stroke();
      }
    }
    // 三毛のぶち
    if (coat.patches) {
      for (let i = 0; i < 7; i++) {
        g.fillStyle = coat.patches[i % coat.patches.length];
        g.beginPath();
        g.ellipse(r() * w, r() * h * 0.6, 14 + r() * 26, 10 + r() * 18, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    // お腹は白
    if (coat.belly) {
      const grd = g.createLinearGradient(0, h * 0.55, 0, h);
      grd.addColorStop(0, 'rgba(244,236,224,0)');
      grd.addColorStop(0.4, 'rgba(244,236,224,1)');
      g.fillStyle = grd;
      g.fillRect(0, h * 0.55, w, h * 0.45);
    }
  });
}

// ポーズ：各パーツの位置・回転・拡大
// prettier-ignore
const POSES = {
  stand: {
    body: { p: [0, 0.2, 0], r: [0, 0, 0], s: [0.1, 0.095, 0.2] },
    head: { p: [0, 0.29, 0.2], r: [0, 0, 0] },
    fl: { p: [0.05, 0.19, 0.12], r: [0, 0, 0], s: [1, 1, 1] },
    fr: { p: [-0.05, 0.19, 0.12], r: [0, 0, 0], s: [1, 1, 1] },
    bl: { p: [0.055, 0.19, -0.12], r: [0, 0, 0], s: [1, 1, 1] },
    br: { p: [-0.055, 0.19, -0.12], r: [0, 0, 0], s: [1, 1, 1] },
    tail: { p: [0, 0.24, -0.19], r: [0.9, 0, 0] },
  },
  sit: {
    body: { p: [0, 0.17, -0.03], r: [-0.75, 0, 0], s: [0.1, 0.1, 0.165] },
    head: { p: [0, 0.35, 0.085], r: [0, 0, 0] },
    fl: { p: [0.035, 0.2, 0.065], r: [-0.08, 0, 0], s: [1, 1.08, 1] },
    fr: { p: [-0.035, 0.2, 0.065], r: [-0.08, 0, 0], s: [1, 1.08, 1] },
    bl: { p: [0.075, 0.08, -0.06], r: [1.45, 0, 0], s: [1.6, 0.6, 1.6] },
    br: { p: [-0.075, 0.08, -0.06], r: [1.45, 0, 0], s: [1.6, 0.6, 1.6] },
    tail: { p: [0, 0.03, -0.15], r: [0.02, 0.9, 0] },
  },
  loaf: {
    body: { p: [0, 0.1, 0], r: [0, 0, 0], s: [0.11, 0.09, 0.19] },
    head: { p: [0, 0.2, 0.17], r: [0, 0, 0] },
    fl: { p: [0.04, 0.05, 0.12], r: [1.4, 0, 0], s: [1.2, 0.5, 1.2] },
    fr: { p: [-0.04, 0.05, 0.12], r: [1.4, 0, 0], s: [1.2, 0.5, 1.2] },
    bl: { p: [0.07, 0.06, -0.08], r: [1.5, 0, 0], s: [1.5, 0.5, 1.5] },
    br: { p: [-0.07, 0.06, -0.08], r: [1.5, 0, 0], s: [1.5, 0.5, 1.5] },
    tail: { p: [0.03, 0.03, -0.17], r: [0.0, 0.5, 0] },
  },
  curl: {
    body: { p: [0, 0.075, 0], r: [0, 0, 0], s: [0.145, 0.075, 0.15] },
    head: { p: [0.08, 0.1, 0.1], r: [0.35, 1.0, 0.3] },
    fl: { p: [0.03, 0.04, 0.08], r: [1.5, 0, 0], s: [0.3, 0.3, 0.3] },
    fr: { p: [-0.03, 0.04, 0.08], r: [1.5, 0, 0], s: [0.3, 0.3, 0.3] },
    bl: { p: [0.05, 0.04, -0.06], r: [1.5, 0, 0], s: [0.3, 0.3, 0.3] },
    br: { p: [-0.05, 0.04, -0.06], r: [1.5, 0, 0], s: [0.3, 0.3, 0.3] },
    tail: { p: [-0.06, 0.035, -0.11], r: [0.0, -1.2, 0] },
  },
};

// シッポの各節の曲がり（ポーズ別）
const TAIL_CURVES = {
  stand: [[0.15, 0], [0.15, 0], [0.1, 0], [-0.1, 0], [-0.2, 0], [-0.3, 0]],
  sit: [[0, 0.35], [0, 0.4], [0, 0.4], [0, 0.35], [0.05, 0.3], [0.15, 0.2]],
  loaf: [[0, 0.15], [0, 0.2], [0, 0.25], [0, 0.3], [0, 0.3], [0.1, 0.3]],
  curl: [[0, -0.45], [0, -0.45], [0, -0.45], [0, -0.45], [0, -0.4], [0, -0.35]],
};

// ---------- かたち（すべての猫で共有） ----------
let GEO = null;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function deform(geo, fn) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
  return geo;
}
function catGeometries() {
  if (GEO) return GEO;
  // 胴：単位球を、胸が深く、腰のくびれた、お尻の丸い猫の胴に（ポーズごとの大きさはこれに掛ける）
  const body = deform(new THREE.SphereGeometry(1, 32, 20), (v) => {
    const f = v.z;
    const waist = Math.exp(-(((f + 0.2) / 0.38) ** 2));
    v.x *= 1 - 0.12 * waist;
    if (v.y < 0) v.y *= 1 - 0.12 * waist;
    if (v.y < 0 && f > 0) v.y -= 0.14 * f * -v.y;        // 胸は深く
    if (v.y > 0 && f < 0) v.y += 0.07 * -f * v.y;          // 腰は少し高く
    if (v.y > 0) v.y *= 0.93;                              // 背中は少し平ら
    if (v.y > 0 && f > 0.45) v.y += 0.12 * (f - 0.45) * v.y; // 首のつけね
  });
  // 頭：横に広く、上は平ら、顔の前は平たく、ほおがふくらむ
  const skull = deform(new THREE.SphereGeometry(1, 28, 20), (v) => {
    const cheek = smooth(0.25, -0.35, v.y) * smooth(-0.2, 0.5, v.z);
    v.x *= 1.1 + 0.14 * cheek;
    if (v.y > 0) v.y *= 0.86;
    if (v.z > 0.55) v.z = 0.55 + (v.z - 0.55) * 0.45;       // 顔は平ら
    if (v.z < 0) v.z *= 1.06;
    v.multiplyScalar(0.075);
    v.y *= 0.96;
  });
  // 耳：前後につぶした三角。先は少し丸く、内側は桃色
  const earShape = (r, h) => deform(new THREE.ConeGeometry(r, h, 10, 3), (v) => {
    v.z *= 0.42;
    const t = (v.y + h / 2) / h;
    v.x *= 1 - 0.12 * Math.sin(t * Math.PI);
    if (v.z > 0) v.z *= 0.5;                                // 前はくぼみ
    v.y += h / 2;
  });
  const leg = deform(new THREE.CylinderGeometry(0.024, 0.017, 0.19, 10, 4), (v) => {
    const t = (0.095 - v.y) / 0.19;                          // 0 = つけね, 1 = 足先
    const thigh = 1 + 0.25 * (1 - smooth(0, 0.45, t));
    v.x *= thigh; v.z *= thigh;
    v.y -= 0.095;
  });
  const segLen = 0.045;
  const tail = Array.from({ length: 6 }, (_, i) => {
    const g = new THREE.CylinderGeometry(0.0155 - i * 0.0011, 0.0175 - i * 0.0011, segLen + 0.01, 10);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, -segLen / 2);
    return g;
  });
  // 先は丸く
  const tipCap = new THREE.SphereGeometry(0.0155 - 5 * 0.0011, 10, 6);
  tipCap.translate(0, 0, -segLen);
  GEO = {
    body, skull, tail, tipCap, leg,
    pad: new THREE.SphereGeometry(0.019, 14, 10),
    nose: deform(new THREE.ConeGeometry(0.0085, 0.009, 3), (v) => { v.z *= 0.6; }).rotateZ(Math.PI).rotateY(Math.PI),
    eye: new THREE.SphereGeometry(0.0135, 14, 10),
    pupil: new THREE.SphereGeometry(0.0085, 10, 8),
    glint: new THREE.SphereGeometry(0.0028, 6, 4),
    ear: earShape(0.033, 0.058),
    earInner: earShape(0.02, 0.04),
    paw: new THREE.SphereGeometry(0.026, 10, 8),
  };
  return GEO;
}

export class Cat {
  /**
   * @param opts.fixed 町の野良猫用。{ pos, pose: 'sit'|'loaf'|'curl', heading, level } で、
   *                   その場所から動かず、親密度も保存しない。
   */
  constructor(scene, opts = {}) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.listeners = {};
    this.fixed = opts.fixed || null;
    this.id = opts.id || 'home';
    this.coat = COATS[opts.coat] || COATS.chatora;
    this.affection = this._load();
    this.level = this.levelFor(this.affection);

    this._build();
    this.parts = { body: this.body, head: this.head, fl: this.legs.fl, fr: this.legs.fr, bl: this.legs.bl, br: this.legs.br, tail: this.tail };
    const spot = this._spot();
    this.cur = JSON.parse(JSON.stringify(POSES[spot.pose]));
    this.tailCur = TAIL_CURVES[spot.pose].map((a) => a.slice());
    this.poseName = spot.pose;
    this.root.position.copy(spot.pos);
    this.heading = this.fixed ? this.fixed.heading : Math.PI;
    this.path = [];
    this.walkPhase = 0;
    this.moving = false;
    this.hop = null;

    // 表情・反応
    this.lookTarget = new THREE.Vector3();
    this.lookWeight = 0;      // 0=前/遠く 1=カメラを見る
    this.glance = 0;          // 振り向く残り時間
    this.earsBack = 0;
    this.blink = 0;
    this.nextBlink = 2;
    this.slowBlink = 0;
    this.clickCooldown = 0;
    this.holdTime = 0;
    this.purr = 0;            // 0..1 ゴロゴロの強さ
    this.slapTimer = 1.5;
    this.slap = 0;
    this.bunt = 0;
    this.idleThought = 8;
    this.pendingLevel = null;
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, ...a) { (this.listeners[name] || []).forEach((fn) => fn(...a)); }

  _spot() {
    if (this.fixed) return { pos: this.fixed.pos, face: 'fixed', pose: this.fixed.pose };
    return SPOTS[this.level];
  }

  levelFor(a) {
    let lv = 1;
    LEVEL_THRESHOLDS.forEach((t, i) => { if (a >= t) lv = i + 1; });
    return lv;
  }

  _load() {
    // 町の猫は猫ごとに、はじめは出会ったときの懐き具合（fixed.level）から
    if (this.fixed) {
      const v = loadStrays()[this.id];
      return typeof v === 'number' ? v : LEVEL_THRESHOLDS[(this.fixed.level || 1) - 1];
    }
    try { return parseFloat(localStorage.getItem(STORAGE_KEY)) || 0; } catch { return 0; }
  }
  _save() {
    if (this.fixed) {
      const all = loadStrays();
      all[this.id] = +this.affection.toFixed(2);
      try { localStorage.setItem(STRAY_KEY, JSON.stringify(all)); } catch { /* ignore */ }
      return;
    }
    try { localStorage.setItem(STORAGE_KEY, this.affection.toFixed(2)); } catch { /* ignore */ }
  }
  reset() {
    this.affection = 0;
    this._save();
    this.level = 1;
    this.path = [];
    this.root.position.copy(SPOTS[1].pos);
    this.heading = Math.PI;
    this.poseName = 'sit';
  }

  /** 開発用：移動を省略して目的地へ */
  skipPath() {
    if (!this.path.length) return;
    this.root.position.copy(this.path[this.path.length - 1].pos);
    this.path = [];
    this.hop = null;
  }

  _build() {
    const coat = this.coat;
    const fur = new THREE.MeshStandardMaterial({ map: furTexture(coat, this.id), roughness: 0.95 });
    const furPlain = new THREE.MeshStandardMaterial({ color: coat.plain, roughness: 0.95 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2ebe0, roughness: 0.95 });
    const muzzleMat = coat.belly || coat.label === '白' ? white : furPlain;
    const dark = new THREE.MeshStandardMaterial({ color: coat.eye || 0x1a1410, roughness: 0.3 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xd88a8a, roughness: 0.6 });

    const G = catGeometries();
    this.body = new THREE.Mesh(G.body, fur);
    this.body.castShadow = true;
    this.root.add(this.body);

    // 頭：ほおの張った丸い頭に、ひげ袋（ω の形の口もと）、逆三角の鼻、大きめの目
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(G.skull, fur);
    skull.castShadow = true;
    const pads = [-1, 1].map((sx) => {
      const pad = new THREE.Mesh(G.pad, muzzleMat);
      pad.position.set(sx * 0.0155, -0.026, 0.05);
      pad.scale.set(1.05, 0.85, 0.95);
      return pad;
    });
    const chin = new THREE.Mesh(G.pad, muzzleMat);
    chin.position.set(0, -0.041, 0.043);
    chin.scale.set(0.8, 0.6, 0.8);
    const nose = new THREE.Mesh(G.nose, pink);
    nose.position.set(0, -0.0125, 0.0685);
    nose.rotation.x = -0.35;
    const irisMat = new THREE.MeshStandardMaterial({ color: coat.eye || 0xb8a040, roughness: 0.25 });
    const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.eyes = [];
    for (const sx of [-1, 1]) {
      // 目：色のついた虹彩に、縦長の瞳と、小さな光
      const eye = new THREE.Mesh(G.eye, irisMat);
      eye.position.set(sx * 0.029, 0.01, 0.054);
      eye.rotation.y = sx * 0.32;
      eye.scale.set(1, 1, 0.6);
      const pupil = new THREE.Mesh(G.pupil, dark);
      pupil.position.z = 0.0105;
      pupil.scale.set(0.42, 1, 0.4);
      const glint = new THREE.Mesh(G.glint, shine);
      glint.position.set(sx * -0.004, 0.005, 0.0135);
      eye.add(pupil, glint);
      this.eyes.push(eye);
      const ear = new THREE.Mesh(G.ear, furPlain);
      ear.position.set(sx * 0.042, 0.052, -0.012);
      ear.rotation.set(-0.15, sx * 0.3, sx * -0.3);
      ear.userData.side = sx;
      this.head.add(ear);
      (this.ears ||= []).push(ear);
      const inner = new THREE.Mesh(G.earInner, pink);
      inner.position.set(0, 0.002, 0.004);
      ear.add(inner);
    }
    this.head.add(skull, ...pads, chin, nose, ...this.eyes);
    this.root.add(this.head);

    // 脚（ピボットは上端）
    const legGeo = G.leg, pawGeo = G.paw;
    this.legs = {};
    for (const k of ['fl', 'fr', 'bl', 'br']) {
      const g = new THREE.Group();
      const leg = new THREE.Mesh(legGeo, k[0] === 'f' || coat.whiteLegs ? (coat.belly ? white : furPlain) : furPlain);
      leg.castShadow = true;
      const paw = new THREE.Mesh(pawGeo, coat.belly || coat.label === '白' ? white : furPlain);
      paw.position.y = -0.19;
      paw.scale.set(1, 0.6, 1.3);
      g.add(leg, paw);
      this.root.add(g);
      this.legs[k] = g;
    }

    // シッポ（6節のチェーン。各節は -z 方向に伸びる）
    this.tail = new THREE.Group();
    this.tailSegs = [];
    let parent = this.tail;
    const segLen = 0.045;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      const geo = G.tail[i];
      const m = new THREE.Mesh(geo, i === 5 ? new THREE.MeshStandardMaterial({ color: coat.tip }) : furPlain);
      m.castShadow = true;
      seg.add(m);
      if (i === 5) seg.add(new THREE.Mesh(G.tipCap, m.material));
      if (i > 0) seg.position.z = -segLen;
      parent.add(seg);
      this.tailSegs.push(seg);
      parent = seg;
    }
    this.root.add(this.tail);

    // クリック判定用の見えない当たり
    this.hitbox = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 0.18;
    this.root.add(this.hitbox);
  }

  // ---------- 親密度 ----------
  addAffection(v) {
    this.affection = Math.max(0, this.affection + v);
    this._saveSoon();
    const lv = this.levelFor(this.affection);
    if (lv <= this.level) return;
    if (this.fixed) {
      this.level = lv;
      this.emit('levelup', lv, STRAY_LEVEL_TEXT[lv]);
      if (lv >= 2) this.emit('meow', lv);
    } else this._levelUp(lv);
  }
  // なでているあいだ毎フレーム保存しないよう、まとめて書く
  _saveSoon() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this._save(); }, 800);
  }

  _levelUp(lv) {
    const prev = this.level;
    this.level = lv;
    const target = SPOTS[lv];
    this.path = [];
    const p = this.root.position;
    if (prev === 1) {
      // 窓辺の内側の縁まで歩いて、ひょいと降りる
      this.path.push({ pos: new THREE.Vector3(p.x - 0.05, SILL_Y, -1.32), mode: 'walk' });
      this.path.push({ pos: new THREE.Vector3(p.x - 0.15, 0, -0.95), mode: 'hop' });
    }
    if (lv === 4) {
      this.path.push({ pos: new THREE.Vector3(target.pos.x, 0, target.pos.z - 0.32), mode: 'walk' });
      this.path.push({ pos: target.pos.clone(), mode: 'hop' });
    } else {
      this.path.push({ pos: target.pos.clone(), mode: 'walk' });
    }
    this.emit('levelup', lv, LEVEL_TEXT[lv]);
    if (lv >= 2) this.emit('meow', lv);
  }

  /** クリック（短く触れる） */
  poke() {
    this.idleThought = 10;
    if (this.clickCooldown > 0) {
      // 構いすぎ。警戒中は少し引かれる
      if (this.level === 1) {
        this.addAffection(-0.3);
        this.earsBack = 1.5;
        this.glance = 0;
        this.emit('flinch');
      }
      return;
    }
    this.clickCooldown = 1.1;
    this.addAffection(1);
    if (this.level === 1) {
      this.glance = 1.4;
      this.earsBack = 0.8;
      this.emit('notice', '……（ちらりと見て、また海を見ている）');
    } else if (this.level === 2) {
      this.glance = 3;
      this.emit('meow', 2);
    } else {
      this.slowBlink = 1.2;
      this.purr = Math.max(this.purr, 0.7);
      this.bunt = 1;
      if (Math.random() < 0.4) this.emit('meow', this.level);
    }
  }

  /** 長押し（なでる）。dt ごとに呼ばれる */
  stroke(dt) {
    this.idleThought = 10;
    this.holdTime += dt;
    if (this.moving) return;
    if (this.level === 1) {
      if (this.holdTime < 1.2) this.addAffection(dt * 0.35);
      else this.earsBack = Math.max(this.earsBack, 0.5);
      this.glance = Math.max(this.glance, 0.3);
    } else {
      this.addAffection(dt * 0.75);
      this.glance = Math.max(this.glance, 0.5);
      if (this.level >= 3) this.purr = Math.min(1, this.purr + dt * 0.8);
      if (this.level >= 2) this.bunt = Math.min(1, this.bunt + dt);
    }
  }
  release() { this.holdTime = 0; }

  /** 町で、すぐそばにしゃがんでいるとき（idle: 操作していない秒数） */
  crouchedNear(dt, idle) {
    this.glance = Math.max(this.glance, 0.4);          // こちらを見る
    this.addAffection(dt * (idle > 3 ? 0.18 : 0.08));  // 目線を合わせて待つと、少しずつ懐く
    if (idle > 3) {
      this.bunt = Math.min(0.6, this.bunt + dt * 0.3); // 鼻先を寄せる
      if (this.level >= 3) this.purr = Math.min(0.6, this.purr + dt * 0.2);
      if (this.slowBlink <= 0 && Math.random() < dt * 0.15) this.slowBlink = 1.2;
    }
  }

  /** 何もしないで、ただ眺めている時間も親密度になる */
  patience(dt, inView) {
    if (inView && !this.moving) this.addAffection(dt * 0.12);
  }

  // ---------- 毎フレーム ----------
  update(dt, elapsed, camera) {
    this.clickCooldown = Math.max(0, this.clickCooldown - dt);
    this.glance = Math.max(0, this.glance - dt);
    this.earsBack = Math.max(0, this.earsBack - dt);
    this.slowBlink = Math.max(0, this.slowBlink - dt);
    this.bunt = Math.max(0, this.bunt - dt * 0.6);

    // 移動
    this.moving = this.path.length > 0;
    let poseName = this._spot().pose;
    if (this.moving) {
      poseName = 'stand';
      this._followPath(dt);
    } else {
      // 定位置での向き
      const spot = this._spot();
      let targetHeading = this.heading;
      if (spot.face === 'fixed') targetHeading = this.fixed.heading;
      else if (spot.face === 'sea') targetHeading = Math.PI + 0.25;
      else if (spot.face === 'camera') targetHeading = Math.atan2(camera.position.x - this.root.position.x, camera.position.z - this.root.position.z);
      else targetHeading = -2.3;
      this.heading = this._dampAngle(this.heading, targetHeading, 2, dt);
    }
    this.root.rotation.y = this.heading;
    this.poseName = poseName;

    // ポーズのブレンド
    const target = POSES[poseName];
    const k = this.moving ? 8 : 3;
    for (const name in this.parts) {
      const c = this.cur[name], t = target[name];
      for (const key of ['p', 'r', 's']) {
        if (!t[key]) continue;
        for (let i = 0; i < 3; i++) c[key][i] = damp(c[key][i], t[key][i], k, dt);
      }
    }
    const tc = TAIL_CURVES[poseName];
    this.tailCur.forEach((seg, i) => { seg[0] = damp(seg[0], tc[i][0], 3, dt); seg[1] = damp(seg[1], tc[i][1], 3, dt); });

    this._applyPose();
    this._animate(dt, elapsed, camera);

    // ゴロゴロは時間とともにおさまる。Lv4 は寝息のような小さいゴロゴロ
    const basePurr = this.level === 4 && !this.moving ? 0.35 : 0;
    this.purr = Math.max(basePurr, this.purr - dt * 0.15);
    this.emit('purr', this.purr);

    // ときどき、ひとりごと
    this.idleThought -= dt;
    if (this.idleThought <= 0) {
      this.idleThought = 25 + Math.random() * 30;
      if (!this.moving && this.level >= 2 && this.level < 4 && Math.random() < 0.5) this.emit('meow', this.level);
    }
  }

  _dampAngle(a, b, lambda, dt) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * (1 - Math.exp(-lambda * dt));
  }

  _followPath(dt) {
    const wp = this.path[0];
    const p = this.root.position;
    if (wp.mode === 'hop') {
      if (!this.hop) this.hop = { from: p.clone(), t: 0 };
      this.hop.t += dt / 0.55;
      const t = clamp(this.hop.t, 0, 1);
      p.lerpVectors(this.hop.from, wp.pos, t);
      p.y = lerp(this.hop.from.y, wp.pos.y, t) + Math.sin(t * Math.PI) * 0.25;
      const dir = new THREE.Vector3().subVectors(wp.pos, this.hop.from);
      this.heading = this._dampAngle(this.heading, Math.atan2(dir.x, dir.z), 10, dt);
      if (t >= 1) { this.hop = null; this.path.shift(); this.emit('land'); }
      return;
    }
    const to = new THREE.Vector3().subVectors(wp.pos, p);
    to.y = 0;
    const dist = to.length();
    const speed = 0.4;
    if (dist < 0.02) {
      p.x = wp.pos.x; p.z = wp.pos.z;
      this.path.shift();
      return;
    }
    this.heading = this._dampAngle(this.heading, Math.atan2(to.x, to.z), 6, dt);
    const step = Math.min(dist, speed * dt);
    p.addScaledVector(to.normalize(), step);
    p.y = damp(p.y, wp.pos.y, 8, dt);
    this.walkPhase += dt * 9;
  }

  _applyPose() {
    const c = this.cur;
    for (const name in this.parts) {
      const obj = this.parts[name];
      const s = c[name];
      obj.position.set(s.p[0], s.p[1], s.p[2]);
      obj.rotation.set(s.r[0], s.r[1], s.r[2]);
      if (s.s) obj.scale.set(s.s[0], s.s[1], s.s[2]);
    }
    this.tailSegs.forEach((seg, i) => { seg.rotation.set(this.tailCur[i][0], this.tailCur[i][1], 0); });
  }

  _animate(dt, elapsed, camera) {
    const breathe = Math.sin(elapsed * (this.level === 4 ? 1.6 : 2.4)) * 0.5 + 0.5;
    this.body.scale.y *= 1 + breathe * 0.04;
    this.body.scale.x *= 1 + breathe * 0.025;

    // 歩行
    if (this.moving && !this.hop) {
      const a = Math.sin(this.walkPhase) * 0.5;
      this.legs.fl.rotation.x = a; this.legs.br.rotation.x = a;
      this.legs.fr.rotation.x = -a; this.legs.bl.rotation.x = -a;
      this.body.position.y += Math.abs(Math.cos(this.walkPhase)) * 0.008;
      this.head.position.y += Math.abs(Math.cos(this.walkPhase)) * 0.006;
    }

    // 視線：Lv1 は基本的に遠くを見る。振り向き(glance)のときだけカメラを見る
    const wantsCamera = this.level === 4 ? 0 : (this.level === 1 ? (this.glance > 0 ? 1 : 0) : (this.moving ? 0.2 : 0.85));
    this.lookWeight = damp(this.lookWeight, wantsCamera, this.level === 1 ? 6 : 2.5, dt);
    if (this.poseName !== 'curl') {
      const local = this.root.worldToLocal(camera.position.clone());
      const headPos = this.head.position;
      const dx = local.x - headPos.x, dy = local.y - headPos.y, dz = local.z - headPos.z;
      let yaw = Math.atan2(dx, dz);
      yaw = clamp(yaw, -1.3, 1.3);
      const pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.6, 0.4);
      // 遠くを見るときのぼんやりした首振り
      const idleYaw = Math.sin(elapsed * 0.23) * 0.35;
      const idlePitch = -0.1 + Math.sin(elapsed * 0.17) * 0.05;
      this.head.rotation.y = lerp(idleYaw, yaw, this.lookWeight);
      this.head.rotation.x = lerp(idlePitch, pitch, this.lookWeight);
      // 首をかしげる・すりすり
      this.head.rotation.z = Math.sin(elapsed * 0.5) * 0.08 * (this.level >= 2 ? 1 : 0) + this.bunt * Math.sin(elapsed * 3) * 0.25;
      if (this.bunt > 0) this.head.position.z += this.bunt * 0.02;
    } else {
      this.head.rotation.x += Math.sin(elapsed * 1.6) * 0.03;
    }

    // 耳
    this.ears.forEach((ear) => {
      const side = ear.userData.side;
      const back = Math.min(1, this.earsBack);
      ear.rotation.z = side * (-0.3 - back * 0.9);
      ear.rotation.x = -0.15 - back * 0.5 + (Math.sin(elapsed * 7 + side) > 0.995 ? 0.3 : 0);
    });

    // まばたき（Lv3 以上はゆっくりまばたき＝信頼のサイン、Lv4 は眠っている）
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 0.15; this.nextBlink = 2 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt);
    let eyeOpen = this.blink > 0 ? 0.1 : 1;
    if (this.slowBlink > 0) eyeOpen = 0.15 + 0.85 * Math.abs(Math.cos((1 - this.slowBlink / 1.2) * Math.PI));
    if (this.level === 3 && this.purr > 0.5) eyeOpen = Math.min(eyeOpen, 0.45);
    if (this.poseName === 'curl') eyeOpen = 0.08;
    this.eyes.forEach((e) => { e.scale.y = damp(e.scale.y, eyeOpen, 25, dt); });

    // シッポ
    if (this.moving) {
      this.tailSegs.forEach((seg, i) => { seg.rotation.y += Math.sin(elapsed * 2 - i * 0.5) * 0.08; });
    } else if (this.level === 1) {
      // 警戒中：先っぽだけピクッ
      const flick = Math.max(0, Math.sin(elapsed * 1.3)) ** 8;
      this.tailSegs[4].rotation.x += flick * 0.6;
      this.tailSegs[5].rotation.x += flick * 0.8;
      if (this.earsBack > 0) this.tailSegs.forEach((seg, i) => { seg.rotation.y += Math.sin(elapsed * 14) * 0.1 * (i / 5); });
    } else if (this.level === 2) {
      this.tailSegs.forEach((seg, i) => { seg.rotation.y += Math.sin(elapsed * 1.5 - i * 0.6) * 0.1; });
    } else if (this.level === 3) {
      // ペシペシ：ためて、ぱしっ
      this.slapTimer -= dt;
      if (this.slapTimer <= 0) {
        this.slap = 1;
        this.slapTimer = 0.9 + Math.random() * 1.8;
        this.emit('slap', this.root.position);
      }
      this.slap = Math.max(0, this.slap - dt * 3.5);
      const swing = Math.sin(this.slap * Math.PI) * 1.0;
      this.tailSegs.forEach((seg, i) => {
        seg.rotation.y += swing * (0.12 + i * 0.05) - 0.05;
        seg.rotation.x += swing * 0.08 * (i > 2 ? 1 : 0);
      });
    } else {
      const tip = Math.max(0, Math.sin(elapsed * 0.6)) ** 12;
      this.tailSegs[5].rotation.y += tip * 0.5;
    }
  }

  /** カメラから見えているか（「眺めている」判定用） */
  inView(camera) {
    const v = this.root.position.clone();
    v.y += 0.15;
    v.project(camera);
    return Math.abs(v.x) < 0.6 && Math.abs(v.y) < 0.7 && v.z < 1;
  }
}
