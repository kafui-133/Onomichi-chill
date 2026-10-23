// 遠景：向島の造船所クレーン・尾道大橋・瀬戸内の島影。
// 尾道と向島の地形・道・建物は実データから town.js が作る。
import * as THREE from 'three';
import { seededRandom, glowTexture, canvasTexture } from './util.js';
import { SEA_Y, BOUNDS, straitAt, demAt } from './townMap.js';

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
    // 瓦の列（棟にそって並ぶ）。三角柱の UV は、u が屋根をまわる向き、v が棟の向き
    if (!this.roofTile) {
      this.roofTile = canvasTexture(64, 64, (g, w, h) => {
        g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 8) { const grd = g.createLinearGradient(0, y, 0, y + 8); grd.addColorStop(0, '#a0a0a0'); grd.addColorStop(0.5, '#f2f2f2'); grd.addColorStop(1, '#a8a8a8'); g.fillStyle = grd; g.fillRect(0, y, w, 8); }
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(w - 7, 0, 7, h);
      });
      this.roofTile.repeat.set(24, 22);
    }
    const roofs = new THREE.InstancedMesh(roofGeo, this.mat(0xffffff, { map: this.roofTile }), list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const windows = [];
    const glass = [], frames = [];   // 昼も見える窓（暗いガラスに白い枠）
    list.forEach((h, i) => {
      q.setFromEuler(new THREE.Euler(0, h.rot, 0));
      m.compose(new THREE.Vector3(h.x, h.y, h.z), q, new THREE.Vector3(h.w, h.h, h.d));
      bodies.setMatrixAt(i, m);
      bodies.setColorAt(i, c.set(h.wall));
      m.compose(new THREE.Vector3(h.x, h.y + h.h + h.roofH * 0.25, h.z), q, new THREE.Vector3(h.w * 1.08, h.roofH, h.d * 1.15));
      roofs.setMatrixAt(i, m);
      roofs.setColorAt(i, c.set(h.roof));
      // 昼の窓：家の表と裏に、各階1〜3枚（家は地面より3m低いところから建てている）
      {
        const floors = Math.max(1, Math.round((h.h - 3) / 3.2));
        const n = Math.max(1, Math.min(3, Math.floor(h.w / 2.6)));
        const cr = Math.cos(h.rot), sr = Math.sin(h.rot);
        for (const side of [1, -1]) for (let f = 0; f < floors; f++) for (let k = 0; k < n; k++) {
          if (this.r() < 0.2) continue;
          const lx = ((k + 0.5) / n - 0.5) * h.w * 0.8, lz = side * (h.d / 2 + 0.04);
          const wx = h.x + lx * cr + lz * sr, wz = h.z - lx * sr + lz * cr, wy = h.y + 4.4 + f * 3.1;
          if (wy > h.y + h.h - 0.6) continue;
          const ry = h.rot + (side < 0 ? Math.PI : 0);
          frames.push([wx - Math.sin(ry) * 0.01, wy, wz - Math.cos(ry) * 0.01, ry]);
          glass.push([wx, wy, wz, ry]);
        }
      }
      // 夜に灯る窓（点くかどうかは、日と時間で決める）
      if (this.r() < 0.9) {
        // 家は地面より3m低いところから建てている（坂で浮かないように）ので、窓はその上から
        const floors = Math.max(1, Math.round((h.h - 3) / 3.2));
        for (let f = 0; f < floors; f++) {
          if (this.r() < 0.25) continue;
          // 家の表と裏（回転に合わせて）の窓
          const side = this.r() < 0.5 ? 1 : -1;
          const lx = (this.r() - 0.5) * h.w * 0.6, lz = side * (h.d / 2 + 0.05);
          const cr = Math.cos(h.rot), sr = Math.sin(h.rot);
          windows.push({ x: h.x + lx * cr + lz * sr, y: h.y + 4.4 + f * 3.1, z: h.z - lx * sr + lz * cr, sx: 0.8 + this.r() * 0.6, sy: 0.65, ry: h.rot + (side < 0 ? Math.PI : 0) });
        }
      }
    });
    bodies.castShadow = bodies.receiveShadow = true;
    roofs.castShadow = true;
    this.group.add(bodies, roofs);
    if (glass.length) {
      const plane = new THREE.PlaneGeometry(1, 1);
      const put = (arr, mat, sx, sy) => {
        const mesh = new THREE.InstancedMesh(plane, mat, arr.length);
        const e = new THREE.Euler();
        arr.forEach(([x, y, z, ry], k) => { q.setFromEuler(e.set(0, ry, 0)); m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, 1)); mesh.setMatrixAt(k, m); });
        this.group.add(mesh);
      };
      put(frames, this.mat(0xe6e2d8), 1.12, 1.0);
      put(glass, this.mat(0x3e4a54), 0.95, 0.84);
    }
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
    // 向島側の岸辺（水道の中心から南へ）
    const fz = (x) => straitAt(x).z - 135;
    // 向島の岸の線（水道の中心から南へたどって、最初に陸になるところ）
    const shore = (x) => { const c = straitAt(x).z; let z = c; while (demAt(x, z) < SEA_Y && z > c - 400) z -= 1; return z; };
    // 夜にライトアップされる、うす緑の引込みクレーン4基（駅前から見て少し西）
    jibCrane(330, shore(330) + 3, 0.5, 0.95, 46);
    jibCrane(372, shore(372) + 2, 2.2, 1.05, 42);
    jibCrane(418, shore(418) + 3, 0.9, 0.85, 48);
    jibCrane(470, shore(470) + 2, 2.6, 1.0, 40);
    // 駅前の向かい：写真の、うす緑の門型トラスクレーン、白い引込みクレーン、黒い格子のクローラークレーン、
    // 低い事務所と赤い屋根の工場、積み上げた鉄板（ここはライトアップしない）
    {
      const teal = this.mat(0x9fd8c4), blue = this.mat(0x3a6ab8), white = this.mat(0xe8e8e2), rust = this.mat(0xa8a090);
      const g = new THREE.Group();
      const L = 96, H = 24, W = 16, over = 28;   // over：海の上へ張り出す片持ちの長さ
      const legsX = [-L / 2 + 6, -L / 6, L / 6, L / 2 - 6];
      for (const x of legsX) {
        for (const z of [-W / 2, W / 2]) {
          // 脚：下が広がる台形のトラス（前後にも開く）
          strut(g, teal, new THREE.Vector3(x - 4, 0, z), new THREE.Vector3(x - 1, H, z), 0.9);
          strut(g, teal, new THREE.Vector3(x + 4, 0, z), new THREE.Vector3(x + 1, H, z), 0.9);
          strut(g, teal, new THREE.Vector3(x - 4, 0, z), new THREE.Vector3(x + 1, H * 0.55, z), 0.4);
          strut(g, teal, new THREE.Vector3(x + 4, 0, z), new THREE.Vector3(x - 1, H * 0.55, z), 0.4);
        }
        box(g, this.mat(0xb0aea6), 3, 2, W + 3, x, 1, 0);   // 脚の下の台座
      }
      const x0 = -L / 2 - over, x1 = L / 2;
      for (const z of [-W / 2, W / 2]) {
        box(g, teal, x1 - x0, 1.8, 1.2, (x0 + x1) / 2, H, z);                // 下弦（主桁）
        box(g, rust, x1 - x0 - 6, 1.0, 0.8, (x0 + x1) / 2 + 3, H - 1.6, z);  // さびの出た走行レール
        lattice(g, teal, new THREE.Vector3(x0, H + 1, z), new THREE.Vector3(x1, H + 1, z), 2.6, 0x9fd8c4);
        // 上の三角のトラス（屋根のような形）と、張り出しへ下がる斜めの弦材
        const pk = new THREE.Vector3(-L / 8, H + 11, z), pk2 = new THREE.Vector3(L / 5, H + 11, z);
        strut(g, teal, new THREE.Vector3(-L / 2 + 6, H + 1, z), pk, 0.8);
        strut(g, teal, pk, pk2, 0.8);
        strut(g, teal, pk2, new THREE.Vector3(L / 2 - 6, H + 1, z), 0.8);
        strut(g, teal, new THREE.Vector3(-L / 2 + 6, H + 1, z), new THREE.Vector3(x0, H + 4, z), 0.7);
        for (const t of [0.2, 0.4, 0.6, 0.8]) {
          const px = -L / 2 + 6 + (L - 12) * t;
          const topY = px < pk.x ? H + 1 + 10 * (px - (-L / 2 + 6)) / (pk.x - (-L / 2 + 6)) : px > pk2.x ? H + 1 + 10 * ((L / 2 - 6) - px) / ((L / 2 - 6) - pk2.x) : H + 11;
          strut(g, teal, new THREE.Vector3(px, H + 1, z), new THREE.Vector3(px, topY, z), 0.5);
          strut(g, teal, new THREE.Vector3(px - 8, H + 1, z), new THREE.Vector3(px, topY, z), 0.4);
        }
      }
      for (const x of [x0, ...legsX, x1]) box(g, teal, 1.0, 1.2, W, x, H, 0);
      box(g, blue, 9, 3, W + 1, 18, H + 3, 0);          // 青い台車
      box(g, blue, 5, 2.5, 5, 22, H + 5.6, 0);
      box(g, white, 4, 2.5, 3, 14, H - 2.5, W / 2 + 1); // 運転室
      // 斜めの階段（黄色い手すり）
      strut(g, this.mat(0xd8c030), new THREE.Vector3(L / 6 + 3, 0.5, W / 2 + 1.5), new THREE.Vector3(L / 6 + 16, H, W / 2 + 1.5), 0.5);
      const gx = 215, gz = shore(215) + 2;
      g.position.set(gx, SEA_LEVEL + 1.5, gz);
      g.rotation.y = 0.12;
      this.group.add(g);
      // 白い引込みクレーン（台形の脚の上に、運転室と、長い白い腕。黄色い帯）
      {
        const c = new THREE.Group(), yel = this.mat(0xd8b040);
        for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) strut(c, white, new THREE.Vector3(lx * 1.6, 0, lz * 1.6), new THREE.Vector3(lx * 0.4, 13, lz * 0.4), 0.8);
        box(c, white, 3.4, 4, 3.4, 0, 14, 0);
        const top = new THREE.Group();
        top.position.y = 16;
        top.rotation.y = 2.3;
        c.add(top);
        box(top, white, 7, 4.5, 5, -1.5, 3.5, 0);       // 機械室・運転室
        box(top, yel, 7.05, 1.4, 5.05, -1.5, 1.9, 0);   // 下の黄色い帯
        box(top, white, 2, 9, 2, 0.5, 9, 0);            // 塔
        // 後ろへのびる「く」の字の腕（引込み用のつり合いおもり）
        strut(top, white, new THREE.Vector3(0.5, 13, 0), new THREE.Vector3(-6, 10, 0), 1.2);
        box(top, white, 2.4, 2.4, 2.4, -6.5, 9.5, 0);
        const root = new THREE.Vector3(1.5, 6, 0), tip = new THREE.Vector3(1.5 + Math.cos(1.05) * 34, 6 + Math.sin(1.05) * 34, 0);
        strut(top, white, root, tip, 1.3);
        top.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.5, 13.5, 0), tip, tip, new THREE.Vector3(tip.x, 10, 0)]), lineMat(0x2a2e2c)));
        box(top, yel, 0.8, 1.2, 0.8, tip.x, 9.5, 0);
        blink(top, tip.x, tip.y + 1, 0);
        c.position.set(gx + 70, SEA_LEVEL + 1.5, shore(gx + 70) + 6);
        this.group.add(c);
      }
      // 黒い格子のクローラークレーン（ほぼまっすぐ立てた長いブーム、赤い足まわり）
      {
        const c = new THREE.Group(), black = this.mat(0x26282a), red = this.mat(0xc8463a);
        box(c, dark, 6, 1.4, 5, 0, 0.7, 0);
        box(c, red, 4.5, 2.6, 3.4, -0.5, 2.7, 0);
        const root = new THREE.Vector3(1.2, 3.8, 0), tip = new THREE.Vector3(1.2 + Math.cos(1.45) * 44, 3.8 + Math.sin(1.45) * 44, 0);
        lattice(c, black, root, tip, 1.6, 0x26282a);
        c.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2, 4, 0), tip, tip, new THREE.Vector3(tip.x + 0.5, 12, 0)]), lineMat(0x2a2e2c)));
        blink(c, tip.x, tip.y + 1, 0);
        c.rotation.y = 0.4;
        c.position.set(gx + 56, SEA_LEVEL + 1.5, shore(gx + 56) - 4);
        this.group.add(c);
      }
      // 低い事務所（うす緑と白のプレハブ）、赤い屋根の工場、積み上げた鉄板
      const bld = (x, w, h, d, mat, back = 10) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, SEA_LEVEL + 1.5 + h / 2, shore(x) - back); this.group.add(m); return m; };
      bld(gx + 62, 22, 5, 7, this.mat(0xa8d4c8), 6);
      bld(gx + 84, 16, 6.5, 9, this.mat(0xe4e4dc), 8);
      bld(gx + 47, 4, 3, 3, this.mat(0xe8e6de), 3);   // 門型クレーンの下の小屋
      for (const [x, w] of [[gx + 102, 18], [gx + 120, 16]]) {
        const shed = bld(x, w, 7, 14, this.mat(0xd8d2c4), 14);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 9, 3, 4, 1, false, Math.PI / 4), this.mat(0x9a4a3a));
        roof.scale.set(w / 12.7, 1, 1.05);
        roof.position.set(shed.position.x, SEA_LEVEL + 1.5 + 8.5, shed.position.z);
        this.group.add(roof);
      }
      const plates = this.mat(0x5a4436);
      for (let k = 0; k < 7; k++) {
        const x = gx - 20 + k * 11 + this.r() * 3;
        bld(x, 8, 0.8 + this.r() * 1.2, 4, plates, 7 + this.r() * 6);
      }
    }
    // ドック：灰色の岸壁の中に、建造中の大きな船（写真の向島のドックのように）
    const dz = fz(200) + 8;
    const dockFrom = this.group.children.length;
    const wallM = this.mat(0x8c8a84);
    for (const sz of [-15, 15]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(130, 7, 4), wallM);
      wall.position.set(200, SEA_LEVEL + 2, dz + sz);
      this.group.add(wall);
    }
    // 船体：下は赤茶の船底、上は灰色。船尾に白い船橋と、帯の入った煙突
    const hullLow = new THREE.Mesh(new THREE.BoxGeometry(112, 5, 22), this.mat(0x7a3a30));
    hullLow.position.set(200, SEA_LEVEL + 3, dz);
    const hullUp = new THREE.Mesh(new THREE.BoxGeometry(112, 8, 22.2), this.mat(0x6a706e));
    hullUp.position.set(200, SEA_LEVEL + 9.5, dz);
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(11.1, 11.1, 13, 12, 1, false, 0, Math.PI), this.mat(0x6a706e));
    bow.rotation.y = -Math.PI / 2;
    bow.scale.set(1, 1, 0.9);
    bow.position.set(144, SEA_LEVEL + 7.5, dz);
    this.group.add(hullLow, hullUp, bow);
    const white = this.mat(0xeeeeea), winM = this.mat(0x2a3440);
    const house = new THREE.Mesh(new THREE.BoxGeometry(14, 12, 20), white);
    house.position.set(245, SEA_LEVEL + 19.5, dz);
    const bridgeTop = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 24), white);
    bridgeTop.position.set(242, SEA_LEVEL + 27.5, dz);
    this.group.add(house, bridgeTop);
    for (let k = 0; k < 3; k++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 18), winM);
      w.position.set(237.9, SEA_LEVEL + 16 + k * 3.4, dz);
      this.group.add(w);
    }
    const bw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 22), winM);
    bw.position.set(237.4, SEA_LEVEL + 28, dz);
    this.group.add(bw);
    const funnel = new THREE.Mesh(new THREE.BoxGeometry(5, 9, 6), white);
    funnel.position.set(250, SEA_LEVEL + 30, dz);
    const band = new THREE.Mesh(new THREE.BoxGeometry(5.1, 1.6, 6.1), this.mat(0x2f5aa8));
    band.position.set(250, SEA_LEVEL + 32, dz);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(5.1, 1.2, 6.1), this.mat(0x1e1e20));
    cap.position.set(250, SEA_LEVEL + 34.6, dz);
    this.group.add(funnel, band, cap);
    // 甲板のあかり（夜）
    const lamps = [];
    for (let x = 150; x < 240; x += 9) lamps.push({ x, y: SEA_LEVEL + 14.5, z: dz - 11.2, s: 0.9 }, { x, y: SEA_LEVEL + 14.5, z: dz + 11.2, s: 0.9 });
    for (let k = 0; k < 6; k++) lamps.push({ x: 237.7, y: SEA_LEVEL + 16.5 + (k % 3) * 3.4, z: dz - 6 + Math.floor(k / 3) * 12, s: 1.1 });
    this._windowLights(lamps, 0xffe0b0, 1.1);
    // タグボート
    const tug = new THREE.Group();
    const th = new THREE.Mesh(new THREE.BoxGeometry(14, 2.4, 5.5), this.mat(0x2e3a48));
    th.position.y = 1.2;
    const tw = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), white);
    tw.position.set(-1, 3.6, 0);
    tug.add(th, tw);
    tug.position.set(190, SEA_LEVEL, dz + 32);
    this.group.add(tug);
    // ドックは、ライトアップのクレーン4基のそばへ（岸の向きにそろえる）
    const dock = new THREE.Group();
    for (const o of this.group.children.slice(dockFrom)) { o.position.x -= 200; o.position.z -= dz; dock.add(o); }
    const ddx = 395, ddz = shore(395) + 22;
    dock.position.set(ddx, 0, ddz);
    dock.rotation.y = -straitAt(395).angle * 0.6;
    this.group.add(dock);
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
    this.bridgeCable = new THREE.LineBasicMaterial({ color: 0xe8e8e2, transparent: true, opacity: 0.7 });
    g.add(new THREE.LineSegments(cg, this.bridgeCable));
    // 夜は塔とケーブルが、うすい緑がかった白にライトアップされる
    this.bridgeMat = mat;
    // となりに並ぶ、もう一本の橋（赤みのある門型の塔）
    const x2 = x + 70, deck2Y = SEA_LEVEL + 30;
    const red = this.mat(0xc8735c);
    const deck2 = new THREE.Mesh(new THREE.BoxGeometry(12, 2.6, len), this.mat(0xcfccc4));
    deck2.position.set(x2, deck2Y, (z0 + z1) / 2);
    g.add(deck2);
    for (const tz of towers) {
      for (const sx of [-5.5, 5.5]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 46, 2.4), red);
        leg.position.set(x2 + sx, deck2Y + 8, tz);
        g.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(13.4, 2.4, 2.4), red);
      beam.position.set(x2, deck2Y + 30, tz);
      g.add(beam);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(14, 30, 6), this.mat(0xb8b4aa));
      pier.position.set(x2, SEA_LEVEL + 14, tz);
      g.add(pier);
    }
    this.group.add(g);
    // 橋の街灯：欄干にそって、オレンジの灯りの粒（両方の橋）
    const pts = [];
    for (let z = z1; z < z0; z += 9) {
      pts.push(x - 7.5, deckY + 3.2, z, x + 7.5, deckY + 3.2, z);
      pts.push(x2 - 6.5, deck2Y + 2.8, z + 4.5, x2 + 6.5, deck2Y + 2.8, z + 4.5);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.bridgeLamps = new THREE.PointsMaterial({ map: glowTexture(), color: 0xffa040, size: 11, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.group.add(new THREE.Points(lg, this.bridgeLamps));
    // 水面への映りこみに使う
    this.reflectSources = [];
    for (let z = z1 + 40; z < z0 - 40; z += 18) this.reflectSources.push({ x: x + 7.5, z, color: 0xffa040 }, { x: x2 + 6.5, z: z + 9, color: 0xffa040 });
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
    // 尾道大橋の夜
    if (this.bridgeLamps) {
      this.bridgeLamps.opacity = Math.min(1, night * 1.4);
      this.bridgeCable.color.setRGB(0.91, 0.91, 0.89).lerp(new THREE.Color(0xb6f2c8), night);
      this.bridgeCable.opacity = 0.7 + night * 0.25;
      this.bridgeMat.emissive.setHex(0x9fe0b8);
      this.bridgeMat.emissiveIntensity = night * 0.35;
    }
    this.blinkers.forEach((b) => {
      b.mat.opacity = night * (0.5 + 0.5 * Math.sin(elapsed * 1.6 + b.phase)) * 0.9;
    });
  }
}
