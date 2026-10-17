// 坂の上の古民家の一室：畳・土壁・障子・文机と石油ランプ・乳白ガラスの吊りランプ・瓢箪・風鈴・柱時計。
// 薄暗い部屋の奥に、障子にはさまれた開口があって、その向こうだけが明るい（尾道の古い家の二階のように）
import * as THREE from 'three';
import { canvasTexture, speckle, seededRandom, glowTexture } from './util.js';

export const ROOM = { minX: -2.6, maxX: 2.6, minZ: -1.6, maxZ: 2.6, h: 2.35 };
export const WINDOW = { minX: -1.3, maxX: 1.95, minY: 0.35, maxY: 2.0, z: -1.6 };
export const SILL_Y = 0.38;

function tatamiTexture() {
  const r = seededRandom('tatami');
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#b7ad7c';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) {
      const v = 160 + r() * 40;
      g.fillStyle = `rgba(${v},${v - 10},${v - 70},0.35)`;
      g.fillRect(0, y, w, 1.4);
    }
    speckle(g, w, h, 900, 0.12, r);
    // 畳縁
    g.fillStyle = '#3d382f';
    g.fillRect(0, 0, 8, h);
    g.fillRect(w - 8, 0, 8, h);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 0, w, 3);
  }, { repeat: [5.2 / 0.9, 4.2 / 1.8] });
}

function plasterTexture() {
  const r = seededRandom('plaster');
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#c9b796';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 4000, 0.14, r);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(120,90,60,${0.05 * r()})`;
      g.beginPath();
      g.arc(r() * w, r() * h, 10 + r() * 30, 0, Math.PI * 2);
      g.fill();
    }
  }, { repeat: [3, 2] });
}

function woodTexture(base = '#6b4a32', repeat = [1, 1]) {
  const r = seededRandom('wood' + base);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const y = r() * h;
      g.strokeStyle = `rgba(30,18,10,${0.08 + r() * 0.15})`;
      g.lineWidth = 0.5 + r() * 1.5;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3);
      g.stroke();
    }
    speckle(g, w, h, 500, 0.08, r);
  }, { repeat });
}

function fusumaTexture() {
  const r = seededRandom('fusuma');
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#e6dcc6';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2500, 0.07, r);
    // 淡い波模様（青海波）
    g.strokeStyle = 'rgba(120,130,140,0.18)';
    g.lineWidth = 1;
    for (let y = 0; y < h + 20; y += 14) {
      for (let x = (y / 14) % 2 ? 0 : 14; x < w + 28; x += 28) {
        for (let k = 3; k > 0; k--) {
          g.beginPath();
          g.arc(x, y, k * 4.5, Math.PI, 0);
          g.stroke();
        }
      }
    }
    g.fillStyle = 'rgba(80,60,40,0.06)';
    g.fillRect(0, h * 0.7, w, h * 0.3);
  });
}

/** 障子：白い和紙に、細い組子の格子（縦3・横8）。外の光で、紙だけがほんのり明るく見える */
function shojiTexture() {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#f3efe4';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(200,190,170,0.18)';
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    g.fillStyle = '#241a12';
    for (let i = 0; i <= 3; i++) g.fillRect(Math.round((i / 3) * (w - 4)), 0, i === 0 || i === 3 ? 6 : 3, h);
    for (let j = 0; j <= 8; j++) g.fillRect(0, Math.round((j / 8) * (h - 4)), w, j === 0 || j === 8 ? 6 : 3);
  });
}

function paperTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#f2ead8';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(70,90,140,0.45)';
    for (let y = 18; y < h; y += 10) {
      g.beginPath();
      g.moveTo(10, y);
      g.lineTo(w - 10, y);
      g.stroke();
    }
    g.strokeStyle = 'rgba(40,40,60,0.75)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(14, 32);
    for (let x = 14; x < 100; x += 6) g.lineTo(x, 31 + Math.sin(x) * 2);
    g.moveTo(14, 52);
    for (let x = 14; x < 80; x += 6) g.lineTo(x, 51 + Math.cos(x) * 2);
    g.stroke();
  });
}

export class Room {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mats = {
      tatami: new THREE.MeshStandardMaterial({ map: tatamiTexture(), roughness: 0.95 }),
      plaster: new THREE.MeshStandardMaterial({ map: plasterTexture(), roughness: 1, color: 0x9a8a72 }),
      wood: new THREE.MeshStandardMaterial({ map: woodTexture('#5a3d29'), roughness: 0.8 }),
      darkWood: new THREE.MeshStandardMaterial({ map: woodTexture('#2c1e15'), roughness: 0.75 }),
      ceiling: new THREE.MeshStandardMaterial({ map: woodTexture('#4a3626', [4, 1]), roughness: 0.9 }),
      shoji: (() => { const t = shojiTexture(); return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.4, roughness: 1 }); })(),
      fusuma: new THREE.MeshStandardMaterial({ map: fusumaTexture(), roughness: 1 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xcfe0e8, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.1, depthWrite: false }),
    };
    this._structure();
    this._window();
    this._desk();
    this._rightSide();
    this._lamp();
    this._zabuton();
  }

  box(w, h, d, mat, x, y, z, { cast = true, receive = true } = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = receive;
    this.group.add(m);
    return m;
  }

  _structure() {
    const { minX, maxX, minZ, maxZ, h } = ROOM;
    const W = maxX - minX, D = maxZ - minZ;
    const cz = (minZ + maxZ) / 2;
    this.box(W, 0.1, D, this.mats.tatami, 0, -0.05, cz, { cast: false });
    this.box(W + 0.2, 0.1, D + 0.2, this.mats.ceiling, 0, h + 0.05, cz);
    // 梁
    this.box(W, 0.16, 0.14, this.mats.darkWood, 0, h - 0.08, 0.5);
    this.box(W, 0.12, 0.12, this.mats.darkWood, 0, h - 0.06, minZ + 0.06);
    // 左右の壁
    this.box(0.12, h, D, this.mats.plaster, minX - 0.06, h / 2, cz);
    this.box(0.12, h, D, this.mats.plaster, maxX + 0.06, h / 2, cz);
    // 柱
    for (const x of [minX + 0.06, maxX - 0.06]) {
      for (const z of [minZ + 0.06, maxZ - 0.06, 0.5]) this.box(0.12, h, 0.12, this.mats.darkWood, x, h / 2, z);
    }
    // 左右の壁の手前（窓側）は障子。外からの光で白く浮かぶ
    for (const sx of [minX + 0.005, maxX - 0.005]) {
      const z0 = minZ + 0.12, z1 = 0.44, n = 3, pw = (z1 - z0) / n;
      for (let i = 0; i < n; i++) this._shoji(sx, z0 + pw * (i + 0.5), pw - 0.01, 1.85, sx < 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    // 長押（なげし）
    this.box(0.04, 0.08, D, this.mats.darkWood, minX + 0.02, 1.85, cz);
    this.box(0.04, 0.08, D, this.mats.darkWood, maxX - 0.02, 1.85, cz);
    // 畳寄せ
    this.box(W, 0.04, 0.03, this.mats.darkWood, 0, 0.02, maxZ - 0.015);

    // 奥の襖
    this.box(W, h, 0.1, this.mats.plaster, 0, h / 2, maxZ + 0.05);
    const fw = W / 4;
    for (let i = 0; i < 4; i++) {
      const x = minX + fw * (i + 0.5);
      const f = this.box(fw - 0.02, 1.8, 0.03, this.mats.fusuma, x, 0.9, maxZ - 0.02 - (i % 2) * 0.03);
      f.receiveShadow = true;
      this.box(fw, 0.03, 0.05, this.mats.darkWood, x, 1.81, maxZ - 0.03);
      const handle = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), this.mats.darkWood);
      handle.position.set(x + (i % 2 ? -1 : 1) * (fw * 0.38), 0.85, maxZ - 0.04 - (i % 2) * 0.03);
      handle.rotation.y = Math.PI;
      this.group.add(handle);
    }
  }

  /** 障子1枚：腰板（下の板）と、和紙の格子と、まわりの框。x, z は中心、rot は向き（正面が部屋のほう） */
  _shoji(x, z, w, top, rot = 0) {
    const g = new THREE.Group();
    const koshi = 0.28;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, top - koshi - 0.04), this.mats.shoji);
    paper.position.y = koshi + (top - koshi) / 2;
    const board = new THREE.Mesh(new THREE.BoxGeometry(w, koshi, 0.025), this.mats.darkWood);
    board.position.y = koshi / 2;
    g.add(paper, board);
    for (const fx of [-w / 2 + 0.015, w / 2 - 0.015]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.03, top, 0.035), this.mats.darkWood);
      st.position.set(fx, top / 2, 0.005);
      g.add(st);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, 0.035), this.mats.darkWood);
    rail.position.y = top - 0.015;
    g.add(rail);
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    this.group.add(g);
    return g;
  }

  _window() {
    const { minX, maxX, h } = ROOM;
    const Wn = WINDOW;
    const z = Wn.z;
    const t = 0.12;
    // 開口の上の小壁と、出窓の板の下の壁
    this.box(maxX - minX, h - Wn.maxY, t, this.mats.plaster, 0, (h + Wn.maxY) / 2, z);
    this.box(Wn.maxX - Wn.minX, Wn.minY, t, this.mats.plaster, (Wn.minX + Wn.maxX) / 2, Wn.minY / 2, z);
    // 開口の左右は、開け放した障子が重なって寄せてある（外の光で白く光る）
    const left = Wn.minX - minX, right = maxX - Wn.maxX;
    this._shoji(minX + left * 0.27, z + 0.05, left * 0.54, Wn.maxY);
    this._shoji(minX + left * 0.73, z + 0.09, left * 0.54, Wn.maxY);
    this._shoji(Wn.maxX + right / 2, z + 0.05, right, Wn.maxY);
    // 障子の裏は壁（夜に外から透けないように）
    this.box(left, Wn.maxY, 0.04, this.mats.plaster, minX + left / 2, Wn.maxY / 2, z - 0.02);
    this.box(right, Wn.maxY, 0.04, this.mats.plaster, Wn.maxX + right / 2, Wn.maxY / 2, z - 0.02);

    // 鴨居・柱と、猫が座る出窓の板
    const ww = Wn.maxX - Wn.minX;
    this.sill = this.box(ww + 0.12, 0.06, 0.48, this.mats.wood, (Wn.minX + Wn.maxX) / 2, Wn.minY, z + 0.12);
    this.box(maxX - minX, 0.1, 0.2, this.mats.darkWood, 0, Wn.maxY + 0.03, z + 0.02);
    for (const px of [Wn.minX - 0.04, Wn.maxX + 0.04]) this.box(0.1, Wn.maxY, 0.14, this.mats.darkWood, px, Wn.maxY / 2, z + 0.02);

    // 外の手すり：上は竹、下は朱色の桟
    const outZ = z - 0.5;
    const bamboo = new THREE.MeshStandardMaterial({ color: 0xb59c62, roughness: 0.6 });
    const redRail = new THREE.MeshStandardMaterial({ color: 0x8a3428, roughness: 0.8 });
    const railGeo = new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2);
    for (const [y, r, m] of [[0.8, 0.035, bamboo], [0.56, 0.022, redRail]]) {
      const rl = new THREE.Mesh(railGeo, m);
      rl.scale.set(ww + 0.6, r, r);
      rl.position.set((Wn.minX + Wn.maxX) / 2, y, outZ);
      rl.castShadow = true;
      this.group.add(rl);
    }
    for (const px of [Wn.minX - 0.2, (Wn.minX + Wn.maxX) / 2, Wn.maxX + 0.2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), redRail);
      post.position.set(px, 0.3, outZ);
      this.group.add(post);
    }
    // 手すりの向こうの、色づきはじめた庭木（窓の下のほう）
    const leafMats = [0xc8783a, 0xd8a050, 0x6a8a3a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
    const blobGeo = new THREE.IcosahedronGeometry(1, 1);
    [[-0.75, -0.55, -3.4, 0.55, 0], [-0.2, -0.45, -3.8, 0.45, 1], [-1.1, -0.6, -3.1, 0.42, 2], [0.4, -0.7, -3.3, 0.38, 0]].forEach(([x, y, zz, r, k]) => {
      const b = new THREE.Mesh(blobGeo, leafMats[k]);
      b.position.set(x, y, zz);
      b.scale.set(r, r * 0.8, r);
      this.group.add(b);
    });

    // 瓢箪：開口の左上から、ひもで吊るしてある
    const gourd = new THREE.Group();
    const gm = new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.45 });
    const lo = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), gm);
    lo.position.y = -0.3;
    lo.scale.y = 1.15;
    const hi = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), gm);
    hi.position.y = -0.23;
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.2), new THREE.MeshBasicMaterial({ color: 0x2a2018 }));
    str.position.y = -0.1;
    gourd.add(str, hi, lo);
    gourd.position.set(Wn.minX + 0.18, Wn.maxY - 0.02, z + 0.1);
    this.gourd = gourd;
    this.group.add(gourd);

    // 軒（のき）
    const eave = this.box(maxX - minX + 1.2, 0.08, 1.4, this.mats.darkWood, 0, h + 0.18, z - 0.65);
    eave.rotation.x = -0.18;

    // 風鈴
    this.fuurin = new THREE.Group();
    const bell = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.55, roughness: 0.1, side: THREE.DoubleSide })
    );
    bell.position.y = -0.18;
    const goldfish = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xd8402e }));
    goldfish.position.set(0.04, -0.16, 0.03);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.18), new THREE.MeshBasicMaterial({ color: 0xc23a2a }));
    string.position.y = -0.09;
    this.fuurinStrip = new THREE.Group();
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.16), new THREE.MeshStandardMaterial({ color: 0xe8d9b0, side: THREE.DoubleSide }));
    strip.position.y = -0.12;
    const stripString = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.1), string.material);
    stripString.position.y = -0.03;
    this.fuurinStrip.add(strip, stripString);
    this.fuurinStrip.position.y = -0.2;
    this.fuurin.add(string, bell, goldfish, this.fuurinStrip);
    this.fuurin.position.set(1.35, Wn.maxY - 0.03, z - 0.05);
    this.group.add(this.fuurin);
  }

  _desk() {
    // 窓の前の、黒ずんだ古い文机（長いほうが窓と平行）
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.035, 1.15), this.mats.darkWood);
    top.position.y = 0.34;
    top.castShadow = top.receiveShadow = true;
    g.add(top);
    for (const x of [-0.24, 0.24]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.33, 1.05), this.mats.darkWood);
      leg.position.set(x, 0.165, 0);
      leg.castShadow = true;
      g.add(leg);
    }
    // 開いた手帳
    const note = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.3), new THREE.MeshStandardMaterial({ map: paperTexture(), roughness: 1 }));
    note.position.set(0.02, 0.364, 0.05);
    note.rotation.y = 0.15;
    note.castShadow = true;
    g.add(note);
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14), new THREE.MeshStandardMaterial({ color: 0x1a1a1f, metalness: 0.4, roughness: 0.3 }));
    pen.rotation.z = Math.PI / 2;
    pen.rotation.y = 0.6;
    pen.position.set(0.09, 0.365, 0.2);
    g.add(pen);
    // 珈琲
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.085, 20), new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.4 }));
    cup.position.set(0.08, 0.4, -0.3);
    cup.castShadow = true;
    g.add(cup);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.036, 20), new THREE.MeshStandardMaterial({ color: 0x2a160c, roughness: 0.2 }));
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.set(0.08, 0.438, -0.3);
    g.add(coffee);
    // 拾いもの：シーグラス・松ぼっくり・流木
    const seaGlass = [[0x7fc8b0, -0.12, -0.42], [0x8ab4d8, -0.06, -0.47], [0xd8f0e0, -0.15, -0.36]];
    seaGlass.forEach(([c, x, z2]) => {
      const sg = new THREE.Mesh(new THREE.DodecahedronGeometry(0.018, 0), new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.75, roughness: 0.35 }));
      sg.scale.y = 0.45;
      sg.position.set(x, 0.365, z2);
      g.add(sg);
    });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 8), new THREE.MeshStandardMaterial({ color: 0x6b4428, flatShading: true }));
    cone.rotation.z = Math.PI / 2.3;
    cone.position.set(-0.13, 0.385, 0.38);
    g.add(cone);
    const drift = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.022, 0.32, 6), new THREE.MeshStandardMaterial({ color: 0xb8a990, roughness: 1 }));
    drift.rotation.z = Math.PI / 2;
    drift.rotation.y = 1.2;
    drift.position.set(-0.17, 0.375, 0.05);
    g.add(drift);
    // 古いフィルムカメラ
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.065, 0.05), new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.5 }));
    cam.position.set(0.12, 0.39, 0.43);
    cam.rotation.y = -0.4;
    g.add(cam);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0x111, metalness: 0.6, roughness: 0.3 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0.0, 0, 0.035);
    cam.add(lens);
    // 本
    [0x6b2f2a, 0x2f4a5a, 0x8a7a50].forEach((c, i) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.025, 0.21), new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
      b.position.set(-0.12, 0.37 + i * 0.026, -0.1);
      b.rotation.y = (i - 1) * 0.08;
      b.castShadow = true;
      g.add(b);
    });

    // 石油ランプ：台と油壺、ふくらんだガラスのほや。夜は小さな炎が灯る
    const lampX = 0.12, lampZ = 0.46;
    const brass = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.5, metalness: 0.4 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.03, 16), brass);
    base.position.set(lampX, 0.372, lampZ);
    const font = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.3, metalness: 0.3 }));
    font.position.set(lampX, 0.42, lampZ);
    font.scale.y = 0.8;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.03, 12), brass);
    collar.position.set(lampX, 0.47, lampZ);
    const chimneyProfile = [[0.024, 0], [0.034, 0.03], [0.04, 0.07], [0.03, 0.12], [0.02, 0.16], [0.021, 0.22]].map(([r, y]) => new THREE.Vector2(r, y));
    const chimney = new THREE.Mesh(new THREE.LatheGeometry(chimneyProfile, 16), new THREE.MeshStandardMaterial({ color: 0xdfe8ea, transparent: true, opacity: 0.32, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
    chimney.position.set(lampX, 0.485, lampZ);
    g.add(base, font, collar, chimney);
    this.deskBulb = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd090 }));
    this.deskBulb.scale.y = 1.8;
    this.deskBulb.position.set(lampX, 0.53, lampZ);
    g.add(this.deskBulb);
    this.flameGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa850, transparent: true, opacity: 0, depthWrite: false }));
    this.flameGlow.position.set(lampX, 0.54, lampZ);
    this.flameGlow.scale.setScalar(0.3);
    g.add(this.flameGlow);
    this.deskLight = new THREE.PointLight(0xffb070, 0, 3.5, 2);
    this.deskLight.position.set(lampX, 0.58, lampZ);
    g.add(this.deskLight);

    // 湯気
    this.steam = [];
    const steamMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(steamMat.clone());
      s.userData.t = i / 7;
      g.add(s);
      this.steam.push(s);
    }
    this.cupPos = new THREE.Vector3(0.08, 0.45, -0.3);

    g.position.set(-0.25, 0, -1.0);
    g.rotation.y = Math.PI / 2;   // 机の長いほう（ローカルの z）が、窓と平行に
    this.group.add(g);
    this.desk = g;
  }

  _rightSide() {
    // 箪笥
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.95, 1.0), this.mats.darkWood);
    body.position.y = 0.475;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const drawerMat = new THREE.MeshStandardMaterial({ map: woodTexture('#5a3a24'), roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, metalness: 0.7, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.92), drawerMat);
      d.position.set(-0.23, 0.13 + i * 0.225, 0);
      g.add(d);
      for (const z of [-0.25, 0.25]) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.08), metal);
        h.position.set(-0.245, 0.13 + i * 0.225, z);
        g.add(h);
      }
    }
    // ラジオ
    const radio = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.26), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.6 }));
    radio.position.set(0, 1.02, 0.2);
    radio.castShadow = true;
    g.add(radio);
    const grill = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), new THREE.MeshStandardMaterial({ color: 0xd8cfb8 }));
    grill.position.set(-0.081, 1.02, 0.15);
    grill.rotation.y = -Math.PI / 2;
    g.add(grill);
    // 鉢植え
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 14), new THREE.MeshStandardMaterial({ color: 0x9a5a3a, roughness: 0.9 }));
    pot.position.set(0, 1.01, -0.25);
    g.add(pot);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), new THREE.MeshStandardMaterial({ color: 0x4d6e3a, flatShading: true, roughness: 0.9 }));
    leaves.position.set(0, 1.15, -0.25);
    leaves.scale.y = 0.8;
    leaves.castShadow = true;
    g.add(leaves);
    g.position.set(2.32, 0, 1.0);
    this.group.add(g);

    // 柱時計
    const clock = new THREE.Group();
    const caseM = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.3), this.mats.darkWood);
    caseM.castShadow = true;
    clock.add(caseM);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), new THREE.MeshStandardMaterial({ color: 0xf0e6cc }));
    face.position.set(-0.052, 0.16, 0);
    face.rotation.y = -Math.PI / 2;
    clock.add(face);
    const hand = new THREE.MeshBasicMaterial({ color: 0x111111 });
    this.hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.055, 0.008), hand);
    this.minHand = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.08, 0.006), hand);
    for (const hm of [this.hourHand, this.minHand]) {
      hm.geometry.translate(0, hm.geometry.parameters.height / 2, 0);
      const pivot = new THREE.Group();
      pivot.position.set(-0.056, 0.16, 0);
      pivot.add(hm);
      clock.add(pivot);
      hm.userData.pivot = pivot;
    }
    const glassWin = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.26), new THREE.MeshStandardMaterial({ color: 0x1b140e }));
    glassWin.position.set(-0.052, -0.13, 0);
    glassWin.rotation.y = -Math.PI / 2;
    clock.add(glassWin);
    this.pendulum = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.18, 0.006), new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.8, roughness: 0.3 }));
    rod.position.y = -0.09;
    const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 20), rod.material);
    bob.rotation.z = Math.PI / 2;
    bob.position.y = -0.19;
    this.pendulum.add(rod, bob);
    this.pendulum.position.set(-0.056, -0.01, 0);
    clock.add(this.pendulum);
    clock.position.set(ROOM.maxX - 0.05, 1.6, 0.85);
    this.group.add(clock);
  }

  _lamp() {
    // 開口の前に吊るした、乳白ガラスの笠のランプ。夜は暖かく灯る
    const g = new THREE.Group();
    const drop = ROOM.h - WINDOW.maxY + 0.12;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, drop), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    cord.position.y = -drop / 2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.04, 12), new THREE.MeshStandardMaterial({ color: 0x2a2420, metalness: 0.4, roughness: 0.5 }));
    cap.position.y = -drop;
    // 笠：ふちが少し波打つ、浅い乳白ガラスのドーム
    const profile = [[0.03, 0.02], [0.08, 0.0], [0.15, -0.05], [0.2, -0.1], [0.215, -0.12], [0.205, -0.125]].map(([r, y]) => new THREE.Vector2(r, y));
    const shade = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 28),
      new THREE.MeshStandardMaterial({ color: 0xf2eadb, side: THREE.DoubleSide, roughness: 0.4, emissive: 0xffc078, emissiveIntensity: 0 })
    );
    shade.position.y = -drop - 0.01;
    this.lampShade = shade;
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), new THREE.MeshBasicMaterial({ color: 0xfff1d0 }));
    this.bulb.position.y = -drop - 0.08;
    g.add(cord, cap, shade, this.bulb);
    this.ceilingLight = new THREE.PointLight(0xffc887, 0, 9, 1.6);
    this.ceilingLight.position.y = -drop - 0.12;
    this.ceilingLight.castShadow = false;
    g.add(this.ceilingLight);
    g.position.set(0.3, ROOM.h, WINDOW.z + 0.32);
    this.group.add(g);
  }

  _zabuton() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a2f36, roughness: 0.95 });
    const mk = (x, z, rot) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.65), mat);
      m.position.set(x, 0.04, z);
      m.rotation.y = rot;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    mk(0, 0.82, 0.05);
    this.catCushion = mk(0.62, 0.38, -0.25);
  }

  update(time, elapsed, dt, wind) {
    const p = time.p;
    // 灯り
    const lamp = p.lamp;
    this.ceilingLight.intensity = lamp * 2.4;
    this.bulb.material.color.setRGB(0.35 + lamp * 0.65, 0.33 + lamp * 0.6, 0.3 + lamp * 0.5);
    this.lampShade.material.emissiveIntensity = lamp * 0.35;
    this.deskLight.intensity = lamp * 0.9;
    this.deskBulb.material.color.setRGB(0.3 + lamp * 0.7, 0.28 + lamp * 0.55, 0.2 + lamp * 0.35);
    this.deskBulb.visible = lamp > 0.05;
    this.flameGlow.material.opacity = lamp * (0.55 + Math.sin(elapsed * 9) * 0.05 + Math.sin(elapsed * 23) * 0.04);
    // 障子は、外が明るいほど白く浮かぶ。夜は、部屋の灯りをうっすら受けるだけ
    this.mats.shoji.emissiveIntensity = (1 - p.night) * 0.42 + lamp * 0.06;
    this.gourd.rotation.z = Math.sin(elapsed * 0.9) * 0.02 + wind * 0.05 * Math.sin(elapsed * 2.1);

    // 風鈴は風に揺れる
    const sway = Math.sin(elapsed * 1.7) * 0.05 + wind * 0.35 * Math.sin(elapsed * 3.1 + 1.0);
    this.fuurin.rotation.z = sway * 0.3;
    this.fuurinStrip.rotation.x = -wind * 0.6 + Math.sin(elapsed * 2.3) * (0.08 + wind * 0.3);
    this.fuurinStrip.rotation.z = Math.sin(elapsed * 2.9) * (0.1 + wind * 0.4);

    // 柱時計
    this.pendulum.rotation.x = Math.sin(elapsed * Math.PI) * 0.18;
    const hh = time.hour % 12;
    this.hourHand.userData.pivot.rotation.x = (hh / 12) * Math.PI * 2;
    this.minHand.userData.pivot.rotation.x = (time.hour % 1) * Math.PI * 2;

    // 湯気
    this.steam.forEach((s) => {
      s.userData.t = (s.userData.t + dt * 0.18) % 1;
      const t = s.userData.t;
      s.position.set(
        this.cupPos.x + Math.sin(t * 6 + elapsed) * 0.02 * t,
        this.cupPos.y + t * 0.28,
        this.cupPos.z + Math.cos(t * 5) * 0.015
      );
      s.scale.setScalar(0.03 + t * 0.09);
      s.material.opacity = Math.sin(t * Math.PI) * 0.12;
    });
  }
}
