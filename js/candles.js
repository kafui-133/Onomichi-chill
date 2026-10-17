// 尾道灯りまつり：商店街・坂道の石段・駅前の芝生に並ぶ、ろうそくの灯り。
//   商店街と坂道には、絵を描いた紙コップの灯籠。駅前の芝生には、小さなガラスのろうそくで輪や波の模様。
//   炎は1本ずつゆらぎ、まわりにやわらかい光のにじみ。灯りの数は画質の設定で減らす。
import * as THREE from 'three';
import { ROADS, POIS, ROPEWAY_STOPS, samplePath, surfaceY, roadLength, nearAnyRoad, inBuilding } from './townMap.js';
import { canvasTexture, seededRandom } from './util.js';

const CUP_DESIGNS = 4;

/** 紙コップの絵（子どもが描いたような、色とりどりの模様） */
function cupTexture(seed) {
  const r = seededRandom('cup' + seed);
  return canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#f6f1e6';
    g.fillRect(0, 0, w, h);
    const cols = ['#e2463a', '#f0a030', '#3a8ad8', '#3aa860', '#d85aa0', '#8a5ad8', '#f0d040'];
    // 上下のふちどり
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    g.fillRect(0, 0, w, 6);
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    g.fillRect(0, h - 5, w, 5);
    // 丸や花、星、くねくね線
    for (let k = 0; k < 7; k++) {
      g.fillStyle = g.strokeStyle = cols[Math.floor(r() * cols.length)];
      const x = r() * w, y = 12 + r() * (h - 24), s = 4 + r() * 7;
      const kind = Math.floor(r() * 3);
      g.lineWidth = 2;
      if (kind === 0) { g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); }
      else if (kind === 1) { for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * s * 0.7, y + Math.sin(a) * s * 0.7, s * 0.45, 0, Math.PI * 2); g.fill(); } }
      else { g.beginPath(); g.moveTo(x - s * 2, y); for (let q = 0; q < 6; q++) g.lineTo(x - s * 2 + q * s * 0.8, y + (q % 2 ? -s * 0.6 : s * 0.6)); g.stroke(); }
    }
  });
}

/** 炎とにじみ：画面に向いた点。1本ずつ位相をずらしてゆらぐ */
function flameMaterial(size, color, alpha) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGlow: { value: 0 }, uSize: { value: size }, uScale: { value: 400 }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
    vertexShader: /* glsl */ `
      attribute float phase;
      uniform float uTime, uSize, uScale;
      varying float vFlick;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFlick = 0.78 + 0.14 * sin(uTime * 9.0 + phase * 6.3) + 0.08 * sin(uTime * 23.0 + phase * 17.0);
        gl_PointSize = uSize * uScale / max(0.5, -mv.z) * (0.9 + 0.1 * vFlick);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uGlow, uAlpha;
      varying float vFlick;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.2) * uGlow * uAlpha * vFlick;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * (0.8 + 0.4 * (1.0 - d)), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

export class Candles {
  /**
   * @param town   Town（駅前の芝生のマスを使う）
   * @param amount 画質に応じた灯りの量（1 = すべて）
   */
  constructor(scene, town, amount = 1) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const r = seededRandom('akari');
    const cups = [], votives = [];

    // ---- 商店街（アーケード）：両わきに紙コップの灯籠 ----
    for (const road of ROADS.filter((rd) => rd.covered)) {
      for (const p of samplePath(road.pts, 1.3 / Math.max(0.35, amount))) {
        for (const side of [-1, 1]) {
          const o = road.width / 2 - 0.4;
          const x = p.x - Math.sin(p.angle) * side * o, z = p.z + Math.cos(p.angle) * side * o;
          cups.push({ x, z, y: surfaceY(x, z) });
        }
      }
    }

    // ---- 坂道・石段：名所の近くから順に、両わきに並べる ----
    const keys = [{ x: 0, z: 0 }, ...['千光寺', '天寧寺三重塔', '艮神社'].map((n) => POIS.find((q) => q.n === n)).filter(Boolean), ROPEWAY_STOPS.base];
    const neko = ROADS.find((rd) => rd.name === '猫の細道');
    if (neko) keys.push(samplePath(neko.pts, roadLength(neko.pts) / 2)[1] || neko.pts[0]);
    const near = (x, z) => Math.min(...keys.map((k) => Math.hypot((k.x ?? k[0]) - x, (k.z ?? k[1]) - z)));
    const slope = [];
    for (const road of ROADS) {
      if (road.surface !== 'stone' || road.alley || road.covered) continue;
      const mid = samplePath(road.pts, Math.max(1, roadLength(road.pts) / 2))[0];
      const d = near(mid.x, mid.z);
      if (d > 420) continue;
      for (const p of samplePath(road.pts, 1.6)) {
        for (const side of [-1, 1]) {
          const o = road.width / 2 - 0.22;
          const x = p.x - Math.sin(p.angle) * side * o, z = p.z + Math.cos(p.angle) * side * o;
          slope.push({ x, z, d: near(x, z) + r() * 30 });
        }
      }
    }
    slope.sort((a, b) => a.d - b.d);
    const slopeCap = Math.round(4200 * amount);
    for (const c of slope.slice(0, slopeCap)) cups.push({ x: c.x, z: c.z, y: surfaceY(c.x, c.z) });

    // ---- 駅前の芝生：小さなガラスのろうそくで、輪と波の模様 ----
    const lawn = new Set((town.stationLawn || []).map(([x, z]) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`));
    const onLawn = (x, z) => lawn.has(`${Math.floor(x / 2)},${Math.floor(z / 2)}`);
    if (lawn.size) {
      const cells = town.stationLawn;
      // 模様の中心（芝生のなかから、いくつか）
      const centers = [];
      for (let k = 0; k < 9 && cells.length; k++) {
        const [x, z] = cells[Math.floor(r() * cells.length)];
        if (centers.every((c) => Math.hypot(c.x - x, c.z - z) > 12)) centers.push({ x, z, rings: 1 + Math.floor(r() * 3) });
      }
      const step = 0.55;
      const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
      const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1;
      for (let x = x0; x <= x1; x += step) {
        for (let z = z0; z <= z1; z += step) {
          if (!onLawn(x, z) || nearAnyRoad(x, z, 0.5) || inBuilding(x, z)) continue;
          let mark = false;
          for (const c of centers) {
            const d = Math.hypot(x - c.x, z - c.z);
            for (let k = 1; k <= c.rings; k++) if (Math.abs(d - k * 2.4) < step * 0.5) mark = true;
          }
          // ゆるやかな波の線（3本）
          for (const off of [0, 7, 14]) if (Math.abs(z - (z0 + 6 + off + Math.sin(x / 4.5) * 2.2)) < step * 0.5) mark = true;
          if (mark && r() < amount + 0.15) votives.push({ x, z, y: surfaceY(x, z) });
        }
      }
      // 芝生のふちに、絵入りの紙コップの列
      for (const [x, z] of cells) {
        if (r() < 0.25 && (!onLawn(x + 2.2, z) || !onLawn(x - 2.2, z) || !onLawn(x, z + 2.2) || !onLawn(x, z - 2.2))) cups.push({ x, z, y: surfaceY(x, z) });
      }
    }

    // ---- 形 ----
    const cupGeo = new THREE.CylinderGeometry(0.045, 0.036, 0.13, 10, 1, true);
    cupGeo.translate(0, 0.065, 0);
    const votiveGeo = new THREE.CylinderGeometry(0.03, 0.028, 0.055, 8);
    votiveGeo.translate(0, 0.028, 0);
    this.mats = [];
    const m = new THREE.Matrix4();
    const byDesign = Array.from({ length: CUP_DESIGNS }, () => []);
    cups.forEach((c, i) => byDesign[i % CUP_DESIGNS].push(c));
    byDesign.forEach((list, k) => {
      if (!list.length) return;
      const tex = cupTexture(k);
      const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffb060, emissiveMap: tex, emissiveIntensity: 0, side: THREE.DoubleSide });
      this.mats.push(mat);
      const mesh = new THREE.InstancedMesh(cupGeo, mat, list.length);
      list.forEach((c, i) => { m.makeRotationY(r() * 6.28); m.setPosition(c.x, c.y, c.z); mesh.setMatrixAt(i, m); });
      this.group.add(mesh);
    });
    if (votives.length) {
      const mat = new THREE.MeshLambertMaterial({ color: 0xf4f0e6, emissive: 0xffc070, emissiveIntensity: 0 });
      this.mats.push(mat);
      const mesh = new THREE.InstancedMesh(votiveGeo, mat, votives.length);
      votives.forEach((c, i) => { m.makeTranslation(c.x, c.y, c.z); mesh.setMatrixAt(i, m); });
      this.group.add(mesh);
    }

    // ---- 炎と、光のにじみ ----
    const all = [...cups.map((c) => [c.x, c.y + 0.07, c.z]), ...votives.map((c) => [c.x, c.y + 0.05, c.z])];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(all.flat(), 3));
    geo.setAttribute('phase', new THREE.Float32BufferAttribute(all.map(() => r()), 1));
    this.flame = flameMaterial(0.16, 0xffc070, 1.0);
    this.halo = flameMaterial(1.35, 0xff9a40, 0.42);
    const flame = new THREE.Points(geo, this.flame), halo = new THREE.Points(geo, this.halo);
    flame.frustumCulled = halo.frustumCulled = false;
    this.group.add(halo, flame);
    this.count = all.length;
  }

  /** glow: 0〜1（イベントの時刻と、日の暮れぐあい） */
  update(glow, t, viewportHeight) {
    this.group.visible = glow > 0.001;
    if (!this.group.visible) return;
    for (const m of [this.flame, this.halo]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uGlow.value = glow;
      m.uniforms.uScale.value = viewportHeight * 0.9;
    }
    for (const m of this.mats) m.emissiveIntensity = glow * 1.15;
  }
}
