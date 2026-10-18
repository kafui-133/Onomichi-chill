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
    this.scheduled = [];     // 日と時間帯で、一つずつ点いたり消えたりする窓の灯り
    this.craneLights = [];   // 夜にライトアップする向島のクレーン
    this._lastSchedule = -1;

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
      // 夜に灯る窓（点くかどうかは、日と時間で決める）
      if (this.r() < 0.9) {
        const floors = Math.max(1, Math.round(h.h / 3.2));
        for (let f = 0; f < floors; f++) {
          if (this.r() < 0.25) continue;
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

  /**
   * 家や建物の窓の灯り。一つずつ、その日その時間に点いているかを決める（帰りの早い家、夜ふかしの家、
   * 朝早い家、今日は留守の家）。list: { x, y, z, sx, sy, ry } または { x, y, z, s }
   */
  scheduledWindows(list) {
    if (!list.length) return null;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), black = new THREE.Color(0, 0, 0);
    const seeds = new Float32Array(list.length);
    list.forEach((w, i) => {
      e.set(0, w.ry || 0, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(w.x, w.y, w.z), q, new THREE.Vector3(w.sx ?? w.s, w.sy ?? w.s * 0.8, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, black);
      seeds[i] = this.r() * 1000;
    });
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.scheduled.push({ mesh, mat, seeds });
    return mesh;
  }

  _updateSchedule(time) {
    const day = time.day, hour = time.hour < 5 ? time.hour + 24 : time.hour;
    const fr = (x) => x - Math.floor(x);
    const hash = (a, b) => fr(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
    const tones = [new THREE.Color(0xffa45a), new THREE.Color(0xffb878), new THREE.Color(0xfff0d6), new THREE.Color(0xc98a50)];
    const black = new THREE.Color(0, 0, 0);
    for (const S of this.scheduled) {
      const n = S.seeds.length;
      for (let i = 0; i < n; i++) {
        const sd = S.seeds[i];
        const h1 = hash(sd, day), h2 = hash(sd + 1.7, day), h3 = hash(sd + 3.1, day), h4 = hash(sd + 5.3, day);
        let on = false;
        if (h1 > 0.12) {
          const evOn = 16.8 + h2 * 3.2, evOff = 20.5 + h3 * 5;          // 夕方に帰ってきて、寝るまで
          if (hour >= evOn && hour < evOff) on = true;
          if (h4 < 0.3 && hour >= 5.1 + h2 * 0.8 && hour < 6.5 + h3 * 1.3) on = true; // 朝早い家
        }
        S.mesh.setColorAt(i, on ? tones[Math.floor(hash(sd + 7.7, 0) * tones.length)] : black);
      }
      S.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** 向島の造船所：赤白のゴライアスクレーンとドックの船体 */
  /**
   * 向島の造船所のクレーン：うすい青緑色のジブクレーン（低いトラスの門型の台に、旋回する機械室と、
   * 斜めに立ち上がる格子のジブ。先端からワイヤーとフックが垂れる）と、赤白のクローラークレーン。
   */
  _cranes() {
    const green = this.mat(0x9ccfba), pale = this.mat(0xdfeee6), dark = this.mat(0x3a4440);
    const lineMat = (color) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const blinkMat = () => new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3a2a, transparent: true, depthWrite: false, fog: false, opacity: 0 });
    const box = (g, mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      g.add(m);
      return m;
    };
    /** a→b に太さ w の棒を渡す */
    const strut = (g, mat, a, b, w) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, w, d.length()), mat);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize()); // 親の中での向き
      g.add(m);
      return m;
    };
    const blink = (g, x, y, z) => {
      const sp = new THREE.Sprite(blinkMat());
      sp.position.set(x, y, z);
      sp.scale.setScalar(8);
      g.add(sp);
      this.blinkers.push({ mat: sp.material, phase: this.r() * 6 });
    };
    /** 格子のジブ：根もと a から先端 b まで、2本の弦材と、ジグザグの斜材 */
    const lattice = (g, mat, a, b, w, color) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const len = d.length();
      const side = new THREE.Vector3(0, 1, 0).cross(d).normalize().multiplyScalar(w / 2);
      const up = new THREE.Vector3().crossVectors(d, side).normalize().multiplyScalar(w / 2);
      const pts = [];
      const chords = [[side, up], [side.clone().negate(), up], [side, up.clone().negate()], [side.clone().negate(), up.clone().negate()]];
      for (const [s1, u1] of chords) {
        const p0 = a.clone().add(s1).add(u1), p1 = b.clone().add(s1.clone().multiplyScalar(0.3)).add(u1.clone().multiplyScalar(0.3));
        strut(g, mat, p0, p1, 0.55);
      }
      const n = Math.max(6, Math.round(len / 3));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const sc0 = 1 - 0.7 * t0, sc1 = 1 - 0.7 * t1;
        const q = (t, sc, sgn, usg) => a.clone().addScaledVector(d, t).addScaledVector(side, sgn * sc).addScaledVector(up, usg * sc);
        for (const usg of [1, -1]) { pts.push(q(t0, sc0, 1, usg), q(t1, sc1, -1, usg)); pts.push(q(t1, sc1, -1, usg), q(t1, sc1, 1, usg)); }
        for (const sgn of [1, -1]) pts.push(q(t0, sc0, sgn, 1), q(t1, sc1, sgn, -1));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      g.add(new THREE.LineSegments(geo, lineMat(color)));
    };
    const jibCrane = (x, z, slew, jibAngle, jibLen) => {
      const g = new THREE.Group();
      // 台：4本脚の低いトラスの門型（高さ 14m）
      const H = 14, S = 9;
      for (const [lx, lz] of [[-S, -S], [S, -S], [-S, S], [S, S]]) box(g, green, 1.2, H, 1.2, lx, H / 2, lz);
      for (const lz of [-S, S]) {
        box(g, green, S * 2 + 1.2, 1.4, 1.2, 0, H, lz);
        strut(g, green, new THREE.Vector3(-S, 1, lz), new THREE.Vector3(0, H - 0.5, lz), 0.5);
        strut(g, green, new THREE.Vector3(S, 1, lz), new THREE.Vector3(0, H - 0.5, lz), 0.5);
      }
      for (const lx of [-S, S]) box(g, green, 1.2, 1.4, S * 2 + 1.2, lx, H, 0);
      // 塔と、旋回する機械室・運転室
      const top = new THREE.Group();
      top.position.y = H;
      top.rotation.y = slew;
      g.add(top);
      box(top, green, 4, 16, 4, 0, 8, 0);
      box(top, pale, 9, 5, 7, -1.5, 18.5, 0);
      box(top, pale, 2.6, 2.6, 2.6, 3.8, 15.5, 2.5);
      box(top, dark, 2.2, 1.0, 0.1, 3.8, 15.9, 3.85);
      // 釣り合いのおもりと、後ろのA形の柱
      box(top, green, 3, 3, 5, -7, 18, 0);
      const mastTop = new THREE.Vector3(-2.5, 30, 0);
      strut(top, green, new THREE.Vector3(-4, 21, -2.4), mastTop, 0.7);
      strut(top, green, new THREE.Vector3(-4, 21, 2.4), mastTop, 0.7);
      // ジブ（斜めに立ち上がる格子）
      const root = new THREE.Vector3(2.5, 20, 0);
      const tip = root.clone().add(new THREE.Vector3(Math.cos(jibAngle) * jibLen, Math.sin(jibAngle) * jibLen, 0));
      lattice(top, green, root, tip, 2.4, 0x9ccfba);
      // ワイヤー（柱の上からジブの先へ）と、先から垂れるフック
      const wires = [mastTop, tip, mastTop, root.clone().add(new THREE.Vector3(Math.cos(jibAngle) * jibLen * 0.55, Math.sin(jibAngle) * jibLen * 0.55, 0)), tip, new THREE.Vector3(tip.x, 8, 0)];
      top.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wires), lineMat(0x2a2e2c)));
      box(top, dark, 1.2, 1.6, 1.2, tip.x, 7.5, 0);
      blink(top, tip.x, tip.y + 1.5, 0);
      g.position.set(x, SEA_LEVEL + 1.5, z);
      this.group.add(g);
      this._litCrane(g, [green, pale]);
    };
    const crawler = (x, z, slew) => {
      const g = new THREE.Group();
      const red = this.mat(0xc8463a), white = this.mat(0xe8e6e0);
      box(g, dark, 7, 1.4, 5, 0, 0.7, 0);
      const top = new THREE.Group();
      top.position.y = 1.4;
      top.rotation.y = slew;
      g.add(top);
      box(top, red, 5, 2.6, 3.6, -0.5, 1.3, 0);
      box(top, white, 1.6, 1.6, 1.4, 2, 2.2, 1.2);
      const root = new THREE.Vector3(1.5, 2.5, 0);
      const ang = 1.2, len = 46;
      const tip = root.clone().add(new THREE.Vector3(Math.cos(ang) * len, Math.sin(ang) * len, 0));
      lattice(top, red, root, tip, 1.4, 0xc8463a);
      top.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.5, 3, 0), tip, tip, new THREE.Vector3(tip.x, 6, 0)]), lineMat(0x2a2e2c)));
      blink(top, tip.x, tip.y + 1.2, 0);
      g.position.set(x, SEA_LEVEL + 1.5, z);
      this.group.add(g);
      this._litCrane(g, [red, white]);
    };
    // 向島側の岸辺（水道の中心から南へ）
    const fz = (x) => straitAt(x).z - 135;
    jibCrane(140, fz(140), 0.5, 0.95, 46);
    jibCrane(185, fz(185) - 4, 2.2, 1.05, 42);
    jibCrane(232, fz(232) - 2, 0.9, 0.85, 48);
    jibCrane(300, fz(300) - 8, 2.6, 1.0, 40);
    crawler(262, fz(262) - 18, 1.9);
    // ドックの船体と船橋
    const hull = new THREE.Mesh(new THREE.BoxGeometry(110, 12, 22), this.mat(0x2f4a66));
    hull.position.set(200, SEA_LEVEL + 5, fz(200) + 8);
    this.group.add(hull);
    const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(18, 14, 16), pale);
    bridgeDeck.position.set(240, SEA_LEVEL + 17, fz(240) + 8);
    this.group.add(bridgeDeck);
    const funnel = new THREE.Mesh(new THREE.BoxGeometry(5, 8, 5), this.mat(0xd8b040));
    funnel.position.set(246, SEA_LEVEL + 28, fz(246) + 8);
    this.group.add(funnel);
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

  /** クレーンの骨組み（mats の素材）を、このクレーン専用の、光る素材に差しかえる */
  _litCrane(g, mats) {
    const own = new Map();
    const lines = [];
    // 下からの投光：足もとほど明るく、上へいくほど暗くなる（骨組みの色も残す）
    const uBase = { value: g.position.y }, uSpan = { value: 55 };
    const uplight = (m) => {
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uBase = uBase;
        sh.uniforms.uSpan = uSpan;
        sh.vertexShader = 'varying float vLiftY;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLiftY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = 'uniform float uBase, uSpan;\nvarying float vLiftY;\n' + sh.fragmentShader.replace(
          'vec3 totalEmissiveRadiance = emissive;',
          'float upl = 1.0 - smoothstep(uBase, uBase + uSpan, vLiftY);\nvec3 totalEmissiveRadiance = emissive * (0.12 + 0.88 * upl * upl) * (0.45 + 0.55 * diffuseColor.rgb);');
      };
      m.customProgramCacheKey = () => 'crane-uplight';
    };
    g.traverse((o) => {
      if (o.isMesh && mats.includes(o.material)) {
        if (!own.has(o.material)) { const m = o.material.clone(); uplight(m); own.set(o.material, m); }
        o.material = own.get(o.material);
      } else if (o.isLineSegments && o.material.color.getHex() !== 0x2a2e2c) {
        o.material = o.material.clone();
        lines.push({ mat: o.material, base: o.material.color.clone() });
      }
    });
    // 足もとの投光器のにじみ（地面と水面がほんのり色づく）
    const glows = [];
    for (const [dx, dz] of [[-8, 9], [8, 9], [0, -9]]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      sp.position.set(g.position.x + dx, g.position.y + 2, g.position.z + dz);
      sp.scale.set(26, 14, 1);
      this.group.add(sp);
      glows.push(sp);
    }
    this.craneLights.push({ mats: [...own.values()], lines, glows });
  }

  /**
   * 夜のクレーンのライトアップ。夜ごとに、全部を一色にそろえる日、1基ずつ違う色の日、
   * ゆっくり色が移ろう日がある（色は紫・緑・青・赤・桃・水色・琥珀）
   */
  _updateCranes(time, elapsed) {
    const COLORS = [0x9a50ff, 0x30e070, 0x3a78ff, 0xff3a3a, 0xff5ab0, 0x40d8ff, 0xffb030];
    const day = time.day;
    if (this._craneDay !== day) {
      this._craneDay = day;
      const r = seededRandom('crane' + day);
      const mode = r() < 0.45 ? 'one' : r() < 0.75 ? 'each' : 'shift';
      const first = Math.floor(r() * COLORS.length);
      const stepC = 2 + Math.floor(r() * 3);   // 7色を、重ならない間隔でめぐる
      this._cranePlan = { mode, colors: this.craneLights.map((_, i) => COLORS[mode === 'one' ? first : (first + i * stepC) % COLORS.length]) };
    }
    // 日が暮れてから、夜11時ごろまで
    const h = time.hour;
    const lit = time.p.night * (h > 12 ? Math.min(1, Math.max(0, (23.2 - h) * 2)) : 0);
    const c = new THREE.Color();
    this.craneLights.forEach((L, i) => {
      c.set(this._cranePlan.colors[i]);
      if (this._cranePlan.mode === 'shift') c.offsetHSL(((elapsed * 0.01 + i * 0.12) % 1), 0, 0);
      // 色は少しだけ落ち着かせる（白とまぜる）
      c.lerp(new THREE.Color(0xffffff), 0.12);
      for (const m of L.mats) { m.emissive.copy(c); m.emissiveIntensity = lit * 0.75; }
      // 細い格子の線は、照らされた骨組みよりも控えめに
      for (const l of L.lines) l.mat.color.copy(l.base).multiplyScalar(1 - lit * 0.75).lerp(c, lit * 0.45);
      for (const sp of L.glows) { sp.material.color.copy(c); sp.material.opacity = lit * 0.32; }
    });
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
    // 窓の灯り：ゲームの中の数分ごとに、点いている窓を決めなおす
    const slot = Math.floor(time.hour * 20) + time.day * 1000;
    if (slot !== this._lastSchedule) { this._lastSchedule = slot; this._updateSchedule(time); }
    for (const S of this.scheduled) S.mat.opacity = Math.min(0.95, night * 1.3);
    this._updateCranes(time, elapsed);
    this.blinkers.forEach((b) => {
      b.mat.opacity = night * (0.5 + 0.5 * Math.sin(elapsed * 1.6 + b.phase)) * 0.9;
    });
  }
}
