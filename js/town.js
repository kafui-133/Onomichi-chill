// 歩ける尾道の町（実データ版）：地形・道・建物・線路・海岸線を OpenStreetMap と国土地理院の標高から組み立てる。
// 道は地形に沿う帯、急な小径は石段と石垣、商店街（本通り）はアーケードと店先、
// 線路と踏切、電車、千光寺山ロープウェイ、天寧寺の三重塔、艮神社、渡船のりば。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, glowTexture, seededRandom, speckle } from './util.js';
import { quality } from './quality.js';
import { buildPerson, geos as personGeos } from './people.js';
import { lam, buildSignAtlas, buildRetroSignAtlas, buildShopInteriorAtlas, SHOP_INTERIOR_KINDS, labelTexture, QuadBatch, instancedBoxes, instancedChunks } from './townKit.js';
import {
  DATA, SEA_Y, BOUNDS, terrainY, groundY, surfaceY, addTread, addSolid, inSolid, walkable, ROADS, OTHER_ROADS, ARCADE_ROADS, nearAnyRoad, samplePath, roadLength, pointAlong,
  STREET_SHOPS, demAt, ALLEYS, COAST, distToCoast, straitAt, RAILS, CROSSINGS, TRAIN_TRACKS, ROPEWAY, SUMMIT, BENCHES, FERRY_ROUTES, POIS, onOnomichiSide, nearestRoad, inBuilding,
  ROOFS, DECKS, addUpper, SANDO, KOJI, walkRoute, TAKEDA_PLAZA, FUJI_BEND, UNDERPASSES, railGroundY, inUnderpassCut,
} from './townMap.js';

const SURFACE_LIFT = { asphalt: 0.05, tile: 0.07, stone: 0.09 };

// Blender で作った3Dモデル（assets/models/*.glb。作り方は tools/blender/）。
// 読めないとき、または ?models=simple のときは、プログラムで組んだ簡単な形のまま
const USE_MODELS = typeof location === 'undefined' || new URLSearchParams(location.search).get('models') !== 'simple';
let gltfLoader = null;
async function loadModel(name) {
  if (!gltfLoader) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    gltfLoader = new GLTFLoader();
  }
  return (await gltfLoader.loadAsync(`assets/models/${name}.glb`)).scene;
}
/** 坂の下る向き（モデルの正面 +Z をこちらへ向けるための rotation.y） */
/** ガード下の掘り下げのそば（線路の高さで置く物は、ここには置かない） */
function nearUnder(x, z) {
  if (!UNDERPASSES.some((u) => Math.hypot(u.x - x, u.z - z) < 50)) return false;
  for (const [a, b] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) if (inUnderpassCut(x + a, z + b)) return true;
  return UNDERPASSES.some((u) => Math.hypot(u.x - x, u.z - z) < 12);
}
function downhillYaw(x, z, d = 4) {
  const gx = terrainY(x + d, z) - terrainY(x - d, z), gz = terrainY(x, z + d) - terrainY(x, z - d);
  return Math.atan2(-gx, -gz);
}

// 千光寺・艮神社の模型の中の長方形 [x0, x1, z0, z1]（正面 +Z）。道にかからないように置き、歩けない場所にする
const MODEL_RECTS = {
  senkoji: [[-5.8, 5.8, -4.8, 8.9], [8.8, 13.2, -2.4, 2.4], [-9, 6, -14, -6]],   // 本堂と舞台、鐘楼、裏の大岩
  ushitora: [[-4.2, 4.2, -3.2, 3.4], [-3.2, 3.2, -9.3, -3.2], [7.6, 10.4, -3.4, -0.6]], // 拝殿、本殿、楠の幹
};
/**
 * 模型の置き場所さがし：rects（模型の中の長方形 [x0, x1, z0, z1]、正面 +Z）が道にかからない位置と向き。
 * 向きは坂の下る向きを基本に、少しだけ振る。approach の点は道の上にあるほどよい
 */
function fitPlacement(x0, z0, rects, { maxShift = 20, approach = [] } = {}) {
  let best = null;
  for (let dx = -maxShift; dx <= maxShift; dx += 2) {
    for (let dz = -maxShift; dz <= maxShift; dz += 2) {
      const shift = Math.hypot(dx, dz);
      if (shift > maxShift) continue;
      const x = x0 + dx, z = z0 + dz;
      const down = downhillYaw(x, z, 6);
      for (const dy of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const yaw = down + dy, c = Math.cos(yaw), sn = Math.sin(yaw);
        const at = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
        let hits = 0;
        for (const [a, b, e, f] of rects) {
          for (let lx = a; lx <= b + 0.01; lx += 1.6) for (let lz = e; lz <= f + 0.01; lz += 1.6) if (nearAnyRoad(...at(lx, lz), 0.5)) hits++;
        }
        let onPath = 0;
        for (const [lx, lz] of approach) if (nearAnyRoad(...at(lx, lz), 0)) onPath++;
        const cost = hits * 10 - onPath * 6 + shift * 0.4 + Math.abs(dy) * 6;
        if (!best || cost < best.cost) best = { x, z, yaw, cost, hits };
      }
    }
  }
  return best;
}

const MODEL_FITS = (() => {
  const poi = (n) => POIS.find((q) => q.n === n);
  const out = {};
  const sk = poi('千光寺'), us = poi('艮神社');
  if (sk) out.senkoji = fitPlacement(sk.x, sk.z, MODEL_RECTS.senkoji, { maxShift: 24 });
  // 艮神社は、参道（鳥居から拝殿まで）が道の上にくるほどよい
  if (us) out.ushitora = fitPlacement(us.x, us.z, MODEL_RECTS.ushitora, { maxShift: 16, approach: [[0, 6], [0, 9], [0, 12]] });
  return out;
})();

const SMALL_SHRINES = ['住吉神社', '吉備津彦神社'];
const JODOJI = POIS.find((q) => q.n === '浄土寺') || null;
// 名所の境内：まわりを埋める家や木を置かず、OpenStreetMap の小さな建物（境内のお堂など）も模型にまかせる
const PRECINCTS = [
  MODEL_FITS.senkoji && { ...MODEL_FITS.senkoji, r: 19 },
  MODEL_FITS.ushitora && { ...MODEL_FITS.ushitora, r: 18 },
  ...[['天寧寺三重塔', 9]].map(([n, r]) => { const p = POIS.find((q) => q.n === n); return p && { x: p.x, z: p.z, r }; }),
  (() => { const p = POIS.find((q) => q.n === '尾道城'); return p && { x: p.x, z: p.z, r: 20 }; })(),
  // 浄土寺（国宝の本堂と多宝塔）の境内
  JODOJI && { x: JODOJI.x, z: JODOJI.z - 6, r: 26 },
  // 町なかの小さな神社（住吉神社・吉備津彦神社）：地図の箱の代わりに、社殿と鳥居を建てる
  ...SMALL_SHRINES.map((n) => { const p = POIS.find((q) => q.n === n); return p && { x: p.x, z: p.z, r: 8 }; }),
  // 空き家の上の、竹田像の広場と、みはらし亭
  { x: TAKEDA_PLAZA.x, z: TAKEDA_PLAZA.z, r: TAKEDA_PLAZA.r + 1 },
  (() => { const p = POIS.find((q) => q.n === 'みはらし亭') || { x: 25, z: 35 }; const y = downhillYaw(p.x, p.z, 6); return { x: p.x + Math.sin(y) * 6.5, z: p.z + Math.cos(y) * 6.5, r: 6 }; })(),
  // 山頂の展望デッキのまわり（眺めをふさがない）
  SUMMIT.deck && { x: SUMMIT.deck.x, z: SUMMIT.deck.z, r: 22 },
  // 三重塔の下の墓地（家を建てずにあけておく）
  (() => { const p = POIS.find((q) => q.n === '天寧寺三重塔'); if (!p) return null; const y = downhillYaw(p.x, p.z, 8); return { x: p.x + Math.sin(y) * 26, z: p.z + Math.cos(y) * 26, r: 17 }; })(),
].filter(Boolean);
// 尾道駅前（駅のロータリーから海ぎわの広場まで）：平地はひらけていて、建物は OpenStreetMap にあるものだけ。埋める家は置かない
const STATION_FRONT = (() => { const p = POIS.find((q) => q.n === 'JR尾道駅'); return p && { x: p.x - 5, z: p.z - 60, r: 120 }; })();
const inStationFront = (x, z) => !!STATION_FRONT && Math.hypot(x - STATION_FRONT.x, z - STATION_FRONT.z) < STATION_FRONT.r && terrainY(x, z) - SEA_Y < 8;
// 尾道市立美術館（千光寺公園の中）
const MUSEUM = POIS.find((q) => q.n === '尾道市立美術館') || null;
const inPrecinct = (x, z, m = 0) => PRECINCTS.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + m);

// 線路のまわり（4mのマスごとに線路の点をおぼえておく）。埋める家や木が線路の上に建たないように
const RAIL_CELL = 4;
const RAIL_GRID = (() => {
  const grid = new Map();
  for (const rail of RAILS) for (const p of samplePath(rail.pts, 2)) {
    const k = Math.floor(p.x / RAIL_CELL) * 100003 + Math.floor(p.z / RAIL_CELL);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  return grid;
})();
/** 線路の中心から m より近いか（m は 8m まで） */
function nearRail(x, z, m) {
  const r = Math.ceil(m / RAIL_CELL);
  const cx = Math.floor(x / RAIL_CELL), cz = Math.floor(z / RAIL_CELL);
  for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
    const list = RAIL_GRID.get(i * 100003 + j);
    if (list && list.some((p) => Math.hypot(p.x - x, p.z - z) < m)) return true;
  }
  return false;
}


// 本通り商店街の、食べられるお店（店名は架空）。f は通りの中での位置（0〜1）、side は通りのどちら側か
const SPECIAL_SHOPS = {
  '本町センター街': [{ f: 0.5, side: 1, type: 'ramen', name: '尾道ラーメン 汐' }, { f: 0.3, side: -1, type: 'kamaboko', name: '桂馬蒲鉾' },
    { f: 0.4, side: 1, type: 'sweets', menu: 'sweets', name: 'おやつのウミネコ' }],
  '中商店街': [{ f: 0.42, side: -1, type: 'bakery', name: 'パン 潮風' }, { f: 0.15, side: 1, type: 'ramen', name: '中華そば 坂の上' },
    { f: 0.7, side: 1, type: 'cafe', style: 'bath', name: '大和湯' }],
  '一番街': [{ f: 0.55, side: 1, type: 'bakery', name: 'パン屋 あさなぎ' }, { f: 0.3, side: -1, type: 'cafe', name: '尾道マロン珈琲' }],
};
const VENDING_COLORS = [0xc8302a, 0x2a5aa8, 0xf2f0ea, 0x3a8a4a];

/**
 * 空き家の窓から見下ろす視界（南へ開いた扇形）に入るものの、許される高さの上限。
 * 窓辺の下端より上に出ると海が隠れてしまうので、近くの建物や木はそれより低く抑える。
 */
function viewCap(x, z) {
  if (z > -1 || z < -140) return Infinity;
  const ahead = -z;
  if (Math.abs(x) > ahead * 0.95 + 6) return Infinity;
  const dist = Math.hypot(x, z);
  return 1.08 - 0.28 * dist - 0.4;
}

/** 多角形の面積（符号つき） */
function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 三角形をためて1つのジオメトリにする（頂点色つき） */
/** 商店街のトタン：縦の波板に、さびと汚れ */
function arcadeTinTexture() {
  const r = seededRandom('tin');
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#c9c1ae';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(x, 0, 3, h);
      g.fillStyle = 'rgba(40,30,20,0.16)'; g.fillRect(x + 5, 0, 2, h);
    }
    for (let k = 0; k < 40; k++) {
      const x = r() * w, y = r() * h, rr = 2 + r() * 6;
      const grd = g.createRadialGradient(x, y, 0, x, y, rr);
      grd.addColorStop(0, `rgba(${Math.round(120 + r() * 40)},${Math.round(60 + r() * 20)},30,${(0.2 + r() * 0.2).toFixed(2)})`);
      grd.addColorStop(1, 'rgba(120,60,30,0)');
      g.fillStyle = grd; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    // さびの垂れ
    for (let k = 0; k < 22; k++) { g.fillStyle = `rgba(110,60,30,${(0.1 + r() * 0.15).toFixed(2)})`; g.fillRect(Math.floor(r() * 16) * 8 + 5, r() * h, 2, 20 + r() * 60); }
    g.fillStyle = 'rgba(60,50,40,0.18)'; g.fillRect(0, h - 10, w, 10);
  });
}

/** シャッター：細かい横のひだと、下の取っ手 */
function shutterTexture() {
  return canvasTexture(64, 128, (g, w, h) => {
    g.fillStyle = '#c8ccc6';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 5) {
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, y, w, 1);
      g.fillStyle = 'rgba(30,30,30,0.28)'; g.fillRect(0, y + 3, w, 1);
    }
    g.fillStyle = '#5a5e58'; g.fillRect(0, h - 7, w, 7);
    g.fillStyle = 'rgba(80,60,40,0.18)'; g.fillRect(0, h - 30, w, 23);
  });
}

class TriBatch {
  constructor() { this.pos = []; this.col = []; this.uv = []; }
  tri(a, b, c, color, uv) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
    if (uv) this.uv.push(...uv); else this.uv.push(0, 0, 0, 0, 0, 0);
  }
  quad(a, b, c, d, color, uv) {
    this.tri(a, b, c, color, uv ? [uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]] : null);
    this.tri(a, c, d, color, uv ? [uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]] : null);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

/**
 * ブロンズ像の人：町の人と同じ体つきを、ブロンズ一色で。pose = 'stand'（遠くを指す）| 'sit'（腰かける）| 'crouch'（しゃがんで頬杖）
 * 足もと（立ち）や座面（座り・しゃがみ）が原点。正面は +Z
 */
function bronzeFigure(mat, pose, seed) {
  const p = buildPerson('stroller', seededRandom(seed));
  const { root, parts } = p;
  const body = parts.torso.parent;
  root.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; } });
  // 帽子などの小物は外す（髪はのこす）
  parts.head.children.filter((c) => c.isGroup).forEach((c) => parts.head.remove(c));
  const shin = (L, ang) => {
    // ひざから下：もも（脚の上半分）を前へ、すねを下へ
    const leg = L.children[0];
    leg.scale.y = 0.55;
    const sh = new THREE.Mesh(personGeos().leg, mat);
    sh.castShadow = true;
    sh.scale.y = 0.55;
    sh.position.set(0, -0.43, 0);
    sh.rotation.x = ang;
    L.add(sh);
    const shoe = L.children[1];
    shoe.position.set(0, -0.43 - Math.cos(ang) * 0.44, Math.sin(ang) * 0.44 + 0.04);
    shoe.rotation.x = ang;
  };
  if (pose === 'stand') {
    parts.armR.rotation.x = -1.35; parts.armR.rotation.z = -0.15;   // 海の向こうを指す
    parts.head.rotation.y = -0.15;
  } else if (pose === 'sit') {
    body.position.y = -0.86;
    for (const L of [parts.legL, parts.legR]) { L.rotation.x = -1.5; shin(L, 1.5); }
    parts.armL.rotation.x = -0.5; parts.armR.rotation.x = -0.6;
    parts.head.rotation.x = 0.1;
  } else {
    body.position.y = -0.62;
    for (const L of [parts.legL, parts.legR]) { L.rotation.x = -2.2; shin(L, 2.6); }
    parts.torso.rotation.x = 0.3;
    parts.head.position.z = 0.12;
    parts.armR.rotation.x = -2.2;   // 頬杖
    parts.armL.rotation.x = -0.9;
  }
  return root;
}

export class Town {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.r = seededRandom('onomichi-real');
    this.lampPositions = [];
    this.stationLanterns = [];
    this.nightMats = [];
    this.glowMats = [];   // 夜に灯るモデルの素材 { mat, base, add }
    this.occupied = new Set(); // 建物のある 4m マス
    this.interactables = [];   // 立ち寄れる場所（パン屋・ラーメン屋・自販機）
    this.specialSignMats = [];
    this.vendingMats = [];

    this._terrain();
    this._coastWalls();
    this._roads();
    this._steps();
    this._buildings();
    this._infill();
    this._sando();
    this._trees();
    this._house();
    this._arcade();
    this._streetShops();
    this._rails();
    this._ropeway();
    this._landmarks();
    this._moreSights();
    this._koji();
    this._parks();
    this._piersAndBenches();
    this._nekoStones();
    this._pine();
    this._vendingMachines();
    this._summitDeck();
    this._stationFront();
    this._canopies();
    this._deck();
    this._lamps();
    this._seaside();
    this._streetDetails();
    this._parkedCars();
    this._sculptures();
    this._takedaPlaza();
    this._mihara();
    this._fuji();
    this._underpasses();
    this._smallShrines();
    this._jodoji();
    this._train();
    this._mergeStatic();
  }

  /**
   * 軽くする：動かない物（建物・看板・お店・社寺など）を、およそ120m 四方の区画と素材ごとに1つの形にまとめる。
   * 見た目は同じまま、描く回数（ドローコール）を大きく減らす。
   * 動く物（踏切の遮断機、電車、ゴンドラ）、あとで模型に差しかえる仮の形、毎フレーム変わる素材を使う物は、そのまま
   */
  _mergeStatic() {
    const root = this.group;
    root.updateMatrixWorld(true);
    // 毎フレーム値を変える素材（このクラスが持っている素材）
    const dynamicMats = new Set();
    const note = (v) => {
      if (!v) return;
      if (v.isMaterial) dynamicMats.add(v);
      else if (Array.isArray(v)) v.forEach((e) => { if (e?.isMaterial) dynamicMats.add(e); else if (e?.mat?.isMaterial) dynamicMats.add(e.mat); else if (e?.mats) e.mats.forEach((m) => m?.isMaterial && dynamicMats.add(m)); });
    };
    for (const k of Object.keys(this)) note(this[k]);
    const skip = new Set();
    // 踏切：動く遮断機（さお）と、点滅する灯のレンズだけはそのまま。柱や看板はまとめる
    (this.crossings || []).forEach((c) => c.arms?.forEach((a) => skip.add(a.parent || a)));
    (this.crossings || []).forEach((c) => c.lights?.forEach((l) => l.userData.lens && dynamicMats.add(l.userData.lens)));
    (this.gondolas || []).forEach((g) => skip.add(g.g));
    (this.train?.cars || []).forEach((c) => skip.add(c));
    // 同じ見た目の素材は1つにまとめる（毎フレーム変わる素材はのぞく）
    const sig = (m) => [m.type, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.map?.uuid, m.emissiveMap?.uuid, m.vertexColors, m.side, m.transparent, m.opacity, m.depthWrite, m.flatShading, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, !!m.onBeforeCompile && m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? m.uuid : 0].join('|');
    // 踏切の灯のレンズは1つずつ点滅するので、それぞれの素材のまま（同じ素材どうしでもまとめない）
    const lensMats = new Set();
    (this.crossings || []).forEach((c) => c.lights?.forEach((l) => l.userData.lens && lensMats.add(l.userData.lens)));
    const lensOnly = (o) => lensMats.has(o.material);
    const canon = new Map();
    const groups = new Map();
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const visit = (o) => {
      if (skip.has(o) || o.userData.noMerge) return;
      if (o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && o.visible && o.geometry?.attributes?.position && !o.userData.detail && !lensOnly(o)) {
        let m = o.material;
        if (!dynamicMats.has(m)) { const k = sig(m); if (!canon.has(k)) canon.set(k, m); m = canon.get(k); }
        const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        const key = `${m.uuid}|${Math.floor(p.x / 120)},${Math.floor(p.z / 120)}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}`;
        if (!groups.has(key)) groups.set(key, { mat: m, list: [], cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder });
        groups.get(key).list.push(o);
      }
      for (const c of [...o.children]) visit(c);
    };
    for (const c of [...root.children]) visit(c);
    let merged = 0, removed = 0;
    for (const gr of groups.values()) {
      if (gr.list.length < 2) continue;
      const vc = !!gr.mat.vertexColors;
      const geos = [];
      for (const o of gr.list) {
        let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
        const n = g.attributes.position.count;
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
        if (vc && !g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
        if (!vc && g.attributes.color) g.deleteAttribute('color');
        if (g.attributes.color && g.attributes.color.itemSize !== 3) { g.deleteAttribute('color'); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
        g.morphAttributes = {};
        g.clearGroups();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        geos.push(g);
      }
      const geo = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, gr.mat);
      mesh.castShadow = gr.cast;
      mesh.receiveShadow = gr.receive;
      mesh.renderOrder = gr.order;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      for (const o of gr.list) { o.parent?.remove(o); removed++; }
      merged++;
    }
    // 中身のなくなったグループを片づける
    const prune = (o) => { for (const c of [...o.children]) prune(c); if (o !== root && o.isGroup && !o.children.length && !o.userData.noMerge && !skip.has(o)) o.parent?.remove(o); };
    prune(root);
    this.mergeStats = { merged, removed };
    // まとめられなかった小さな物（文字の看板・灯籠・標識など）も、遠くでは描かない
    const tmp = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.userData.detail || o.matrixAutoUpdate === false) return;
      let p = o; let movable = false;
      while (p && p !== root) { if (skip.has(p)) { movable = true; break; } p = p.parent; }
      if (movable || !o.geometry) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const sc = o.getWorldScale(tmp).length() / Math.sqrt(3);
      const rad = o.geometry.boundingSphere.radius * sc;
      if (rad > 4) return;
      o.getWorldPosition(tmp);
      o.userData.detail = { x: tmp.x, z: tmp.z, r: rad, d: 90 };
    });
    // 遠くでは描かない小物
    this.detailMeshes = [];
    root.traverse((o) => { if (o.userData.detail) this.detailMeshes.push(o); });
  }

  /** 遠くの小物を隠す（カメラの位置から。数フレームに1回で十分） */
  cullDetails(cam) {
    if (!this.detailMeshes) return;
    for (const m of this.detailMeshes) {
      const d = m.userData.detail;
      m.visible = Math.hypot(cam.x - d.x, cam.z - d.z) - d.r < d.d;
    }
  }

  // ---------- 地形（5m メッシュ） ----------
  /**
   * 地形メッシュ。32×32 マスのタイルに分け、町なか（尾道側）は 5m、遠く（向島・山の奥）は 10m の細かさで作る。
   */
  _terrain() {
    const { x0, z0, step, nx, nz } = DATA.dem;
    const T = 32;
    const r = this.r;
    const c = new THREE.Color();
    // 地面のきめ：やわらかいまだらと、細かい粒（草地にも、町の舗装にも。色は頂点の色を掛ける）。8m でくり返す
    const ground = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#f8f8f8'; g.fillRect(0, 0, w, h);
      const rr = seededRandom('ground-tex');
      for (let k = 0; k < 70; k++) {
        const x = rr() * w, y = rr() * h, rad = 8 + rr() * 30, dark = rr() < 0.6;
        for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
          const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
          grd.addColorStop(0, dark ? `rgba(40,40,30,${0.05 + rr() * 0.06})` : 'rgba(255,255,255,0.06)');
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
        }
      }
      speckle(g, w, h, 5000, 0.1, rr);
    });
    const mat = lam(0xffffff, { vertexColors: true, map: ground });
    const UV = 1 / 8;
    const colorAt0 = (x, z, y) => {
      const above = y - SEA_Y;
      const slope = Math.abs(terrainY(x + 2.5, z) - terrainY(x - 2.5, z)) / 5 + Math.abs(terrainY(x, z + 2.5) - terrainY(x, z - 2.5)) / 5;
      if (above < -0.5) return c.setRGB(0.32, 0.36, 0.34);           // 海の底
      if (above < 7) return c.setRGB(0.5, 0.49, 0.46);                // 海沿いの平地（町なか）
      if (slope > 1.2) return c.setRGB(0.36, 0.33, 0.27);             // 崖・岩
      return c.setHSL(0.23 + r() * 0.05, 0.28, 0.2 + r() * 0.06 + Math.min(0.06, above / 2500));
    };
    const colorAt = (x, z, y) => colorAt0(x, z, y).multiplyScalar(1.1);   // きめの分、少し明るく
    // ガード下：掘り下げにかかるマス（とそのとなり）を探す
    const cutCells = new Set();
    for (const u of UNDERPASSES) {
      for (let x = u.x - u.reach; x <= u.x + u.reach; x += 1) for (let z = u.z - u.reach; z <= u.z + u.reach; z += 1) {
        if (!inUnderpassCut(x, z)) continue;
        const i = Math.floor((x - x0) / step), j = Math.floor((z - z0) / step);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) cutCells.add((i + a) * 100003 + (j + b));
      }
    }
    for (let tj = 0; tj < nz - 1; tj += T) {
      for (let ti = 0; ti < nx - 1; ti += T) {
        const cx = x0 + (ti + T / 2) * step, cz = z0 + (tj + T / 2) * step;
        const near = Math.abs(cx) < 760 && cz > -760 && onOnomichiSide(cx, cz + 60);
        const m = near ? 1 : 2;
        const ci = Math.min(T, nx - 1 - ti), cj = Math.min(T, nz - 1 - tj);
        const vx = Math.floor(ci / m) + 1, vz = Math.floor(cj / m) + 1;
        const pos = new Float32Array(vx * vz * 3), col = new Float32Array(vx * vz * 3), uv = new Float32Array(vx * vz * 2);
        for (let j = 0; j < vz; j++) {
          for (let i = 0; i < vx; i++) {
            const k = j * vx + i;
            const x = x0 + (ti + Math.min(ci, i * m)) * step, z = z0 + (tj + Math.min(cj, j * m)) * step;
            const y = terrainY(x, z);
            pos[k * 3] = x; pos[k * 3 + 1] = y - 0.15; pos[k * 3 + 2] = z;
            uv[k * 2] = x * UV; uv[k * 2 + 1] = z * UV;
            colorAt(x, z, y);
            col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
          }
        }
        const idx = [];
        for (let j = 0; j < vz - 1; j++) {
          for (let i = 0; i < vx - 1; i++) {
            const a = j * vx + i, b = a + 1, cc = a + vx, d = cc + 1;
            // ガード下の掘り下げのマスは、あとで細かい網目で張る
            if (m === 1 && cutCells.has((ti + i) * 100003 + (tj + j))) continue;
            idx.push(a, cc, b, b, cc, d);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
    // 掘り下げのマスは、1m ごとの細かい網目で（ふちは、まわりのマスとぴったり合う）
    if (cutCells.size) {
      const pos = [], col = [], uv = [];
      const S = 10;
      for (const key of cutCells) {
        const i = Math.floor(key / 100003 + 1e-9), j = key - i * 100003;
        const bx = x0 + i * step, bz = z0 + j * step;
        for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
          const P = (u, v) => { const x = bx + (u / S) * step, z = bz + (v / S) * step, y = terrainY(x, z); colorAt(x, z, y); return [x, y - 0.15, z, c.r, c.g, c.b]; };
          const A = P(a, b), B = P(a + 1, b), C = P(a, b + 1), D = P(a + 1, b + 1);
          for (const q of [A, C, B, B, C, D]) { pos.push(q[0], q[1], q[2]); col.push(q[3], q[4], q[5]); uv.push(q[0] * UV, q[2] * UV); }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** 海岸線にそって、岸壁（コンクリートの垂直な壁）を立てる */
  _coastWalls() {
    const tb = new TriBatch(), deck = new TriBatch();
    const c = new THREE.Color(0x8e8a80), deckC = new THREE.Color(0.52, 0.51, 0.48), capC = new THREE.Color(0xb4b0a6);
    // 水ぎわの、消波ブロックを並べたような模様の帯（長さに沿って模様をくり返す）
    const blockPos = [], blockUv = [];
    let run = 0;
    for (const line of COAST) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1];
        if (ax < BOUNDS.x0 || ax > BOUNDS.x1 || az < BOUNDS.z0 || az > BOUNDS.z1) continue;
        const ta = Math.max(SEA_Y + 1.6, groundY(ax, az)), tbb = Math.max(SEA_Y + 1.6, groundY(bx, bz));
        tb.quad([ax, SEA_Y - 3, az], [bx, SEA_Y - 3, bz], [bx, tbb, bz], [ax, ta, az], c);
        // 岸壁の上の、明るいコンクリートの笠石（低い胸壁）
        if (ta - SEA_Y < 9) tb.quad([ax, ta - 0.05, az], [bx, tbb - 0.05, bz], [bx, tbb + 0.45, bz], [ax, ta + 0.45, az], capC);
        const segL = Math.hypot(bx - ax, bz - az);
        if (segL > 0.01 && ta - SEA_Y < 9) {
          // 海側へ少し出した帯（両面）
          const sx = (bz - az) / segL * 0.12, sz = -(bx - ax) / segL * 0.12;
          const u0 = run / 2.4, u1 = (run + segL) / 2.4;
          const y0 = SEA_Y - 0.6, y1 = SEA_Y + 1.25;
          blockPos.push(ax + sx, y0, az + sz, bx + sx, y0, bz + sz, bx + sx, y1, bz + sz, ax + sx, y0, az + sz, bx + sx, y1, bz + sz, ax + sx, y1, az + sz);
          blockUv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
          run += segL;
        }
        // 岸壁の上の、平らなコンクリートの帯（標高のマス目で海へ下がって見えるところを覆う）
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01 || ta - SEA_Y > 9) continue;
        let nx = -(bz - az) / len, nz = (bx - ax) / len;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (terrainY(mx + nx * 6, mz + nz * 6) < terrainY(mx - nx * 6, mz - nz * 6)) { nx = -nx; nz = -nz; } // 陸のほうへ
        const W = 5;
        const ia = [ax + nx * W, groundY(ax + nx * W, az + nz * W) + 0.03, az + nz * W];
        const ib = [bx + nx * W, groundY(bx + nx * W, bz + nz * W) + 0.03, bz + nz * W];
        deck.quad([ax, ta + 0.03, az], ia, ib, [bx, tbb + 0.03, bz], deckC);
      }
    }
    const m = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    this.group.add(m);
    if (blockPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(blockPos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(blockUv, 2));
      g.computeVertexNormals();
      const tex = canvasTexture(128, 64, (g2, w, h) => {
        g2.fillStyle = '#6f6c66';
        g2.fillRect(0, 0, w, h);
        // 互い違いに並んだ、くぼみのあるブロック
        for (let row = 0; row < 3; row++) {
          for (let col = -1; col < 5; col++) {
            const x = col * 32 + (row % 2) * 16, y = row * 22 + 2;
            g2.fillStyle = row === 0 ? '#5a5853' : '#8a867e';
            g2.beginPath(); g2.moveTo(x + 4, y); g2.lineTo(x + 28, y); g2.lineTo(x + 30, y + 18); g2.lineTo(x + 2, y + 18); g2.closePath(); g2.fill();
            g2.fillStyle = '#4a4844';
            g2.fillRect(x + 12, y + 6, 8, 7);
          }
        }
        // 水につかる下のほうは、暗く濡れた色
        const grd = g2.createLinearGradient(0, h, 0, h * 0.55);
        grd.addColorStop(0, 'rgba(40,46,44,0.85)');
        grd.addColorStop(1, 'rgba(40,46,44,0)');
        g2.fillStyle = grd;
        g2.fillRect(0, 0, w, h);
      });
      tex.wrapT = THREE.ClampToEdgeWrapping;
      const bm = new THREE.Mesh(g, lam(0xffffff, { map: tex, side: THREE.DoubleSide }));
      bm.receiveShadow = true;
      this.group.add(bm);
    }
    const dm = new THREE.Mesh(deck.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -1 }));
    dm.receiveShadow = true;
    this.group.add(dm);
  }

  // ---------- 道（地形に沿う帯） ----------
  _texture(kind) {
    const r = seededRandom('tex' + kind);
    return canvasTexture(256, 256, (g, w, h) => {
      if (kind === 'asphalt') {
        // アスファルト：細かい粒と、両端の白線（u=0..1 が道の幅）
        g.fillStyle = '#56575b';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 3000, 0.12, r);
        g.fillStyle = 'rgba(236,232,220,0.85)';
        g.fillRect(6, 0, 5, h);
        g.fillRect(w - 11, 0, 5, h);
        g.fillStyle = 'rgba(40,40,44,0.5)';
        g.fillRect(0, 0, 4, h);
        g.fillRect(w - 4, 0, 4, h);
      } else if (kind === 'tile') {
        // 商店街・広場のタイル（1マス＝0.5m）
        g.fillStyle = '#bcb19c';
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          const v = 175 + r() * 25;
          g.fillStyle = `rgb(${v},${v - 9},${v - 28})`;
          g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
        }
        speckle(g, w, h, 900, 0.06, r);
      } else if (kind === 'wall') {
        // 石垣：横に長い割り石を積んだ面（1枚 = 横1.5m × 高さ1m）。色は頂点の色で変える
        g.fillStyle = '#5e5a54';
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 30 + r() * 10) {
          const rowH = 30 + r() * 12;
          let x = -r() * 40;
          while (x < w) {
            const sw = 38 + r() * 46, v = 170 + r() * 50;
            g.fillStyle = `rgb(${v},${v - 3},${v - 12})`;
            g.beginPath();
            g.roundRect ? g.roundRect(x + 2, y + 2, sw - 4, rowH - 4, 6) : g.rect(x + 2, y + 2, sw - 4, rowH - 4);
            g.fill();
            // 石の上側は明るく、下側は影
            g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 4, y + 3, sw - 8, 4);
            g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 4, y + rowH - 8, sw - 8, 4);
            x += sw;
          }
        }
        speckle(g, w, h, 2500, 0.1, r);
      } else if (kind === 'granite') {
        // 石段の踏み面：御影石の細かい粒
        g.fillStyle = '#cfcac0';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 6000, 0.22, r);
        g.fillStyle = 'rgba(60,56,50,0.25)';
        g.fillRect(0, 0, w, 6);
      } else {
        // 石畳・石段の小径：割り石と目地（u=0..1 が道の幅、両端に縁石）
        g.fillStyle = '#6d675e';
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 26) {
          let x = 22 + ((y / 26) % 2) * 18;
          while (x < w - 22) {
            const sw = 28 + r() * 30;
            const v = 135 + r() * 40;
            g.fillStyle = `rgb(${v},${v - 4},${v - 14})`;
            g.fillRect(x + 1.5, y + 1.5, Math.min(sw, w - 22 - x) - 3, 23);
            x += sw;
          }
        }
        g.fillStyle = '#8e887c';
        g.fillRect(0, 0, 20, h);
        g.fillRect(w - 20, 0, 20, h);
        speckle(g, w, h, 1500, 0.08, r);
      }
    });
  }

  /** 道：地面メッシュと同じ高さ（三角形補間）に、細かく分けた帯を少し浮かせて敷く */
  _roads() {
    const mk = (kind, f) => new THREE.MeshLambertMaterial({ map: this._texture(kind), polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f * 2 });
    const mats = { asphalt: mk('asphalt', -1), tile: mk('tile', -2), stone: mk('stone', -3) };
    const batches = { asphalt: new TriBatch(), tile: new TriBatch(), stone: new TriBatch() };
    const white = new THREE.Color(1, 1, 1);
    // v 方向（道の長さ）の模様の大きさ
    const vScale = { asphalt: 8, tile: 2, stone: 1.6 };
    for (const road of [...ROADS, ...OTHER_ROADS]) {
      const tb = batches[road.surface];
      const lift = SURFACE_LIFT[road.surface];
      const hw = road.width / 2;
      const across = Math.max(1, Math.ceil(road.width / 2.2));
      const s = samplePath(road.pts, 1.25);
      const uMax = road.surface === 'tile' ? road.width / 2 : 1;
      let v = 0;
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        const v1 = v + L / vScale[road.surface];
        const na = { x: -Math.sin(a.angle), z: Math.cos(a.angle) }, nb = { x: -Math.sin(b.angle), z: Math.cos(b.angle) };
        for (let k = 0; k < across; k++) {
          const o0 = -hw + (road.width * k) / across, o1 = -hw + (road.width * (k + 1)) / across;
          const P = (p, n, o) => { const x = p.x + n.x * o, z = p.z + n.z * o; return [x, groundY(x, z) + lift, z]; };
          const u0 = (k / across) * uMax, u1 = ((k + 1) / across) * uMax;
          // 上を向く面になる順番（左→右→右先→左先）
          tb.quad(P(a, na, o0), P(a, na, o1), P(b, nb, o1), P(b, nb, o0), white, [u0, v, u1, v, u1, v1, u0, v1]);
        }
        v = v1;
      }
    }
    for (const k of Object.keys(batches)) {
      const m = new THREE.Mesh(batches[k].build(), mats[k]);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /**
   * 石段：蹴上げ約17cm ごとに水平な踏み面を置く本物の階段にする。
   * 階段（steps）は全部、ふつうの小径でも勾配がしばらく急なところ（約1/6より急が3m以上）だけ段にする。
   * 曲がり角では段を切って、踏み面が道からはみ出さないようにする。
   * 道の両わきは、斜面の高いほうに石垣、低いほうが崖なら低い塀。高さはなめらかにつなぐ。
   */
  _steps() {
    const RISE = 0.17;
    const STEP = 0.1;
    const treads = [], rails = [], lanterns = [];
    const walls = new TriBatch();
    this.stepLanterns = lanterns;
    const r = this.r;
    for (const road of ROADS) {
      if (road.surface !== 'stone') continue;
      const s = samplePath(road.pts, STEP);
      if (s.length < 4) continue;
      const H = s.map((p) => groundY(p.x, p.z));
      // 横に傾いた道でも踏み面が埋もれないよう、両端の高さも見る
      const hw = road.width / 2 - 0.05;
      const Hx = s.map((p, i) => Math.max(H[i], groundY(p.x - Math.sin(p.angle) * hw, p.z + Math.cos(p.angle) * hw), groundY(p.x + Math.sin(p.angle) * hw, p.z - Math.cos(p.angle) * hw)));
      // 急かどうか（前後 2m の平均勾配）。ふつうの小径は 3m 以上続くところだけ
      const W = 20;
      const grade = s.map((_, i) => {
        const j = Math.min(s.length - 1, i + W), k = Math.max(0, i - W);
        return Math.abs(H[j] - H[k]) / Math.max(0.5, (j - k) * STEP);
      });
      const steep = s.map((_, i) => road.kind === 'steps' || grade[i] > 0.16);
      if (road.kind !== 'steps') {
        let i = 0;
        while (i < s.length) {
          if (!steep[i]) { i++; continue; }
          let j = i;
          while (j < s.length && steep[j]) j++;
          if ((j - i) * STEP < 3) for (let k = i; k < j; k++) steep[k] = false;
          i = j;
        }
      }
      let start = -1, base = 0, flights = 0;
      const flush = (i0, i1) => {
        if (i1 - i0 < 2) return;
        const a = s[i0], b = s[i1];
        let top = -Infinity;
        for (let k = i0; k <= i1; k++) top = Math.max(top, Hx[k]);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const v = 0.43 + r() * 0.05;
        const ang = Math.atan2(b.z - a.z, b.x - a.x);
        treads.push({ x: (a.x + b.x) / 2, y: top + 0.03 - 0.3, z: (a.z + b.z) / 2, sx: len + 0.02, sy: 0.6, sz: road.width - 0.1, ry: -ang,
          color: new THREE.Color(v, v * 0.97, v * 0.9) });
        addTread((a.x + b.x) / 2, (a.z + b.z) / 2, len + 0.02, road.width - 0.1, ang, top + 0.03);
        flights++;
      };
      const turn = (i, j) => Math.abs(((s[j].angle - s[i].angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      for (let i = 0; i < s.length; i++) {
        if (!steep[i]) {
          if (start >= 0) { flush(start, i - 1); start = -1; }
          continue;
        }
        if (start < 0) { start = i; base = H[i]; continue; }
        if (Math.abs(H[i] - base) >= RISE || turn(start, i) > 0.2 || (i - start) * STEP > 3) { flush(start, i); start = i; base = H[i]; }
      }
      if (start >= 0) flush(start, s.length - 1);

      // 石段の端の小さな石灯籠（間隔をあけて、片側ずつ交互に）
      if (flights && (road.kind === 'steps' || flights > 12)) {
        const spots = samplePath(road.pts, 14 + r() * 6);
        spots.forEach((p, i) => {
          if (i === 0) return;
          const k = Math.min(s.length - 1, Math.round((i / spots.length) * s.length));
          if (!steep[k]) return;
          const side = i % 2 ? 1 : -1;
          const off = road.width / 2 - 0.18;
          const x = p.x - Math.sin(p.angle) * side * off, z = p.z + Math.cos(p.angle) * side * off;
          lanterns.push({ x, z, ry: -p.angle });
        });
      }

      // 両わきの石垣・塀：1m おきに高さを決め、ならしてから、ひと続きの壁にする
      const c = samplePath(road.pts, 1);
      const len = roadLength(road.pts);
      for (const side of [-1, 1]) {
        const off = road.width / 2 + 0.05;
        const pts = c.map((p, i) => {
          const nx = -Math.sin(p.angle) * side, nz = Math.cos(p.angle) * side;
          const x = p.x + nx * off, z = p.z + nz * off;
          const y = groundY(p.x, p.z);
          const beside = terrainY(p.x + nx * (off + 1.2), p.z + nz * (off + 1.2));
          const along = Math.min(i, c.length - 1 - i); // 道の端からの距離（m）
          // 交差点・道の端の近くには建てない
          const other = nearAnyRoad(x + nx * 0.4, z + nz * 0.4, 0.6);
          const shopFront = STREET_SHOPS.some((sh) => Math.hypot(sh.fx - x, sh.fz - z) < 3.4);
          const free = along > 1.5 && !(other && other !== road) && !shopFront;
          let top = null;
          if (free && beside - y > 0.35) top = Math.min(beside, y + 2.6) + 0.15; // 石垣（山側）
          else if (free && y - beside > 1.0 && road.kind === 'steps') top = y + 0.55; // 低い塀（谷側）
          return { x, z, y, nx, nz, top };
        });
        // 高さを前後でならす（ギザギザにしない）
        const tops = pts.map((p, i) => {
          if (p.top === null) return null;
          let sum = 0, n = 0;
          for (let k = i - 2; k <= i + 2; k++) if (pts[k] && pts[k].top !== null) { sum += pts[k].top; n++; }
          return Math.max(p.y + 0.4, sum / n);
        });
        const g = 0.62 + r() * 0.08;
        const face = new THREE.Color(g * 1.03, g, g * 0.9), cap = new THREE.Color(g * 1.12, g * 1.1, g);
        // 足もとの苔（湿った石垣の下のほう）
        const moss = new THREE.Color(g * 0.7, g * 0.86, g * 0.52);
        const capMoss = new THREE.Color(g * 0.85, g * 1.0, g * 0.66);
        const U = 1 / 1.5, V = 1;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          if (tops[i] === null || tops[i + 1] === null) continue;
          const T = 0.35;
          const A0 = [a.x, a.y - 0.3, a.z], B0 = [b.x, b.y - 0.3, b.z];
          const Am = [a.x, Math.min(tops[i], a.y + 0.3 + r() * 0.25), a.z], Bm = [b.x, Math.min(tops[i + 1], b.y + 0.3 + r() * 0.25), b.z];
          const A1 = [a.x, tops[i], a.z], B1 = [b.x, tops[i + 1], b.z];
          const A2 = [a.x + a.nx * T, tops[i], a.z + a.nz * T], B2 = [b.x + b.nx * T, tops[i + 1], b.z + b.nz * T];
          // 裏側は、地面がもっと低いところまで下ろす（宙に浮いて見えないように）
          const A3 = [a.x + a.nx * T, Math.min(a.y - 1.5, terrainY(a.x + a.nx * T, a.z + a.nz * T) - 0.4), a.z + a.nz * T];
          const B3 = [b.x + b.nx * T, Math.min(b.y - 1.5, terrainY(b.x + b.nx * T, b.z + b.nz * T) - 0.4), b.z + b.nz * T];
          const ua = i * U, ub = (i + 1) * U;
          const uv = (p0, p1, p2, p3) => [ua, p0[1] * V, ub, p1[1] * V, ub, p2[1] * V, ua, p3[1] * V];
          walls.quad(A0, B0, Bm, Am, moss, uv(A0, B0, Bm, Am));
          walls.quad(Am, Bm, B1, A1, face, uv(Am, Bm, B1, A1));
          walls.quad(A1, B1, B2, A2, r() < 0.3 ? capMoss : cap, [ua, 0, ub, 0, ub, 0.3, ua, 0.3]);
          walls.quad(A2, B2, B3, A3, face);
          // 途切れるところは端をふさぐ
          if (i === 0 || tops[i - 1] === null) walls.quad(A0, A1, A2, A3, face);
          if (i === pts.length - 2 || tops[i + 2] === null) walls.quad(B0, B3, B2, B1, face);
        }
      }

      // 長い石段の手すり（まん中に1本）
      if (road.kind === 'steps' && road.width >= 1.6 && len > 8) {
        const coarse = samplePath(road.pts, 2);
        coarse.forEach((a, i) => {
          if (i === coarse.length - 1) return;
          const b = coarse[i + 1];
          const ya = groundY(a.x, a.z), yb = groundY(b.x, b.z);
          const rise = yb - ya;
          rails.push({ x: (a.x + b.x) / 2, y: (ya + yb) / 2 + 0.9, z: (a.z + b.z) / 2, sx: Math.hypot(a.len, rise), sy: 0.05, sz: 0.05, ry: -a.angle, rz: Math.atan2(rise, a.len), color: '#3a3f44' });
          if (i % 2 === 0) rails.push({ x: a.x, y: ya + 0.45, z: a.z, sx: 0.05, sy: 0.9, sz: 0.05, ry: -a.angle, color: '#3a3f44' });
        });
      }
    }
    this.group.add(instancedChunks(treads, lam(0xffffff, { map: this._texture('granite') })));
    const wm = new THREE.Mesh(walls.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, map: this._texture('wall') }));
    wm.receiveShadow = true;
    wm.castShadow = true;
    this.group.add(wm);
    this.group.add(instancedChunks(rails, lam(0xffffff), { detail: 90, receive: false }));
    // 灯籠は、踏み面がぜんぶ置けてから、その上に立てる
    lanterns.forEach((l) => { l.y = surfaceY(l.x, l.z); });
    this._lanterns(lanterns);
  }

  /** 高さ50cmほどの小さな石灯籠。夜は火袋がぼんやり灯る */
  _lanterns(list) {
    const stone = lam(0x8f897d);
    const parts = { base: [], post: [], box: [], cap: [] };
    for (const l of list) {
      parts.base.push({ x: l.x, y: l.y + 0.05, z: l.z, sx: 0.26, sy: 0.1, sz: 0.26, ry: l.ry });
      parts.post.push({ x: l.x, y: l.y + 0.2, z: l.z, sx: 0.1, sy: 0.22, sz: 0.1, ry: l.ry });
      parts.box.push({ x: l.x, y: l.y + 0.38, z: l.z, sx: 0.2, sy: 0.14, sz: 0.2, ry: l.ry });
      parts.cap.push({ x: l.x, y: l.y + 0.5, z: l.z, sx: 0.32, sy: 0.08, sz: 0.32, ry: l.ry + Math.PI / 4 });
    }
    this.group.add(instancedChunks(parts.base, stone, { detail: 90 }), instancedChunks(parts.post, stone, { detail: 90 }), instancedChunks(parts.cap, stone, { detail: 90 }));
    // 火袋（夜に灯る部分）
    this.lanternMat = new THREE.MeshLambertMaterial({ color: 0x8f897d, emissive: 0xff8f3a, emissiveIntensity: 0 });
    this.group.add(instancedChunks(parts.box, this.lanternMat, { detail: 90, cast: false }));
    // 足もとをほのかに照らす光の粒（夜だけ見える）
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap((l) => [l.x, l.y + 0.4, l.z]), 3));
    this.lanternGlow = new THREE.PointsMaterial({ map: glowTexture(), color: 0xff8a3c, size: 0.9, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new THREE.Points(geo, this.lanternGlow));
  }

  // ---------- 建物（OpenStreetMap の輪郭を立ち上げる） ----------
  _buildings() {
    const tbTown = new TriBatch(), tbStation = new TriBatch();
    const facadeWin = [], facadeSlab = [];
    const houseWin = [], houseFrame = [], houseDoor = [], shopFront = [], houseBits = [], laundry = [];
    const roofTb = new TriBatch();   // 瓦屋根（瓦の列のテクスチャをくり返して貼る）
    const maxHouseWin = Math.round(14000 * quality.s.people);
    const maxFacade = Math.round(16000 * quality.s.people);
    let tb = tbTown;
    // 駅舎（いちばん大きい駅の輪郭）は、Blender のモデルに差しかえられるよう別にまとめる
    const polyOf = (b) => { const a = []; for (let k = 0; k < b.p.length; k += 2) a.push([b.p[k], b.p[k + 1]]); return a; };
    const mainStation = DATA.buildings.filter((b) => b.k === 'train_station').sort((a, b) => Math.abs(signedArea(polyOf(b))) - Math.abs(signedArea(polyOf(a))))[0];
    this.stationPoly = mainStation ? polyOf(mainStation) : null;
    const r = this.r;
    // 写真の尾道：白・クリーム・うす桃のしっくいやモルタル、焦げ茶の板壁。瓦は紺や青みの灰色が多く、ところどころ赤茶
    const walls = ['#ece6da', '#e2d8c6', '#d6ccb8', '#efe9df', '#e6d4c4', '#c9bca6', '#6f5a47', '#5c4b3d', '#d8d4cc'];
    const roofTiles = ['#3c4658', '#465166', '#4b5159', '#565c66', '#2f3644', '#6e3a34', '#5a4e48'].map((c) => new THREE.Color(c));
    let roofTile = roofTiles[0];
    const roofFlat = new THREE.Color('#8d8a85');
    const winList = [];
    const museumPolys = [];
    const alleyPts = [];
    for (const al of ALLEYS) for (const p of samplePath(al.pts, 0.8)) {
      for (const o of [-0.7, 0, 0.7]) alleyPts.push([p.x - Math.sin(p.angle) * o, p.z + Math.cos(p.angle) * o]);
    }
    for (const b of DATA.buildings) {
      if (b.k === 'pagoda') continue; // 三重塔は模型で置く
      if (b.k === 'roof') continue;   // 屋根だけのもの（屋根つき歩道・桟橋の上屋）は _canopies で
      if (b.n === '展望台') continue;  // 頂上の展望台は、見晴らしのデッキとして別に作る
      if (MUSEUM && Math.hypot(b.p.filter((_, k) => k % 2 === 0).reduce((t, v) => t + v, 0) / (b.p.length / 2) - MUSEUM.x, b.p.filter((_, k) => k % 2 === 1).reduce((t, v) => t + v, 0) / (b.p.length / 2) - MUSEUM.z) < 16) { museumPolys.push(b); continue; }  // 美術館は _museum で
      tb = b === mainStation ? tbStation : tbTown;
      const poly = [];
      for (let k = 0; k < b.p.length; k += 2) poly.push([b.p[k], b.p[k + 1]]);
      if (poly.length < 3) continue;
      // 商店街の路地がふさがれないように、路地にかかる建物は置かない
      if (alleyPts.some(([x, z]) => pointInPoly(x, z, poly))) continue;
      const area = Math.abs(signedArea(poly));
      if (area < 400 && inPrecinct(poly.reduce((s2, q) => s2 + q[0], 0) / poly.length, poly.reduce((s2, q) => s2 + q[1], 0) / poly.length)) continue;
      if (area < 4) continue;
      const ys = poly.map(([x, z]) => terrainY(x, z));
      const yMin = Math.min(...ys), yMax = Math.max(...ys);
      if (yMax < SEA_Y + 0.3) continue;
      let h = b.h;
      if (!h) h = area < 60 ? 5.5 + r() * 1.5 : area < 220 ? 6.5 + r() * 3 : area < 900 ? 9 + r() * 6 : 12 + r() * 8;
      if (b.k === 'temple' || b.k === 'shrine') h = 9;
      // 古寺めぐりのお寺の境内の建物（本堂・庫裏・鐘楼など）：家やビルではなく、お堂の姿に。
      // 低めの焦げ茶の板壁に白い小壁、大きく張り出した瓦の屋根。窓の列やベランダはつけない
      const pcx = poly.reduce((s2, q) => s2 + q[0], 0) / poly.length, pcz = poly.reduce((s2, q) => s2 + q[1], 0) / poly.length;
      const templeHall = area >= 30 && area < 900 && !b.h && KOJI.some((t) => Math.hypot(t.x - pcx, t.z - pcz) < 26);
      if (templeHall) h = Math.min(6.5, 3.6 + Math.sqrt(area) * 0.12);
      const base = yMin - 2.5;
      let top = (yMin + yMax) / 2 + h;
      const cx0 = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz0 = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const cap = viewCap(cx0, cz0) - 2.2; // 屋根の高さぶん余裕をみる
      if (top > cap) {
        if (cap - yMax < 2.5) continue;    // 近すぎて低くできない建物は置かない
        top = cap;
      }
      const station = b.k === 'train_station';
      if (station) top = Math.min(top, yMin + 8.5);
      const u2 = b.n === 'ONOMICHI U2';
      if (u2) this.u2Poly = poly;
      const wc = new THREE.Color(station ? '#efede6' : u2 ? '#5a6068' : templeHall ? ['#5a3e2c', '#4e3626', '#634430'][Math.floor(r() * 3)] : walls[Math.floor(r() * walls.length)]);
      roofTile = templeHall ? new THREE.Color(['#353a42', '#3c4148', '#2f343b'][Math.floor(r() * 3)]) : roofTiles[Math.floor(r() * roofTiles.length)];
      let wu = 0;
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
        // 壁の質感（しっくいのむらと、うっすらとした板の目地）：u は壁にそって、v は高さ（m）
        const wl = Math.hypot(bx - ax, bz - az);
        tb.quad([ax, base, az], [bx, base, bz], [bx, top, bz], [ax, top, az], wc, [wu / 3, base / 3, (wu + wl) / 3, base / 3, (wu + wl) / 3, top / 3, wu / 3, top / 3]);
        wu += wl;
        if (templeHall) {
          // 白い小壁（軒の下）と、石の基壇（足もと）
          const mx = (ax + bx) / 2 - pcx, mz = (az + bz) / 2 - pcz, ml = Math.hypot(mx, mz) || 1, ox = (mx / ml) * 0.05, oz = (mz / ml) * 0.05;
          tb.quad([ax + ox, top - 1.1, az + oz], [bx + ox, top - 1.1, bz + oz], [bx + ox, top - 0.05, bz + oz], [ax + ox, top - 0.05, az + oz], new THREE.Color('#ece6da'));
          tb.quad([ax + ox * 6, yMin - 0.6, az + oz * 6], [bx + ox * 6, yMin - 0.6, bz + oz * 6], [bx + ox * 6, yMin + 0.55, bz + oz * 6], [ax + ox * 6, yMin + 0.55, az + oz * 6], new THREE.Color('#a8a296'));
          // 柱（およそ2m ごと）と、腰の高さの長押（横木）
          const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / (L || 1), tz = (bz - az) / (L || 1), post = new THREE.Color('#3a2418');
          const n = Math.max(1, Math.round(L / 2));
          for (let k = 0; k <= n; k++) {
            const px = ax + (bx - ax) * (k / n) + ox * 1.6, pz = az + (bz - az) * (k / n) + oz * 1.6;
            tb.quad([px - tx * 0.14, yMin + 0.55, pz - tz * 0.14], [px + tx * 0.14, yMin + 0.55, pz + tz * 0.14], [px + tx * 0.14, top - 1.1, pz + tz * 0.14], [px - tx * 0.14, top - 1.1, pz - tz * 0.14], post);
          }
          for (const hy of [yMin + 1.5, top - 1.25]) tb.quad([ax + ox * 1.3, hy - 0.09, az + oz * 1.3], [bx + ox * 1.3, hy - 0.09, bz + oz * 1.3], [bx + ox * 1.3, hy + 0.09, bz + oz * 1.3], [ax + ox * 1.3, hy + 0.09, az + oz * 1.3], post);
        }
      }
      // 3階以上の建物（海沿いのマンションやビル）：各階の窓の列と、海側のベランダ
      if (!station && !templeHall && top - yMin >= 7.5 && area >= 60 && facadeWin.length < maxFacade) {
        const ccw = signedArea(poly) > 0;
        const balcony = r() < 0.5;
        for (let i = 0; i < poly.length; i++) {
          const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
          const L = Math.hypot(bx - ax, bz - az);
          if (L < 4) continue;
          const dx = (bx - ax) / L, dz = (bz - az) / L;
          const ox = ccw ? dz : -dz, oz = ccw ? -dx : dx;
          const ry = Math.atan2(ox, oz);
          const n = Math.max(1, Math.floor((L - 1.2) / 2.6));
          // 平地で、道に面した壁の1階は、お店の店先（ガラスかシャッター、色つきの日よけ、看板）
          const mx0 = (ax + bx) / 2, mz0 = (az + bz) / 2;
          const shop = yMin - SEA_Y < 8 && L >= 4.5 && !!nearAnyRoad(mx0 + ox * 3.5, mz0 + oz * 3.5, 0) && r() < 0.8;
          if (shop) {
            const bry = Math.atan2(-dz, dx), w = L * 0.84;
            const closed = r() < 0.3;
            shopFront.push({ x: mx0 + ox * 0.07, y: yMin + 1.4, z: mz0 + oz * 0.07, sx: w, sy: 2.4, sz: 1, ry, color: closed ? '#a8aaa6' : ['#55646e', '#4a5a62', '#6a6a60'][Math.floor(r() * 3)] });
            if (!closed) shopFront.push({ x: mx0 + ox * 0.08, y: yMin + 1.05, z: mz0 + oz * 0.08, sx: w * 0.9, sy: 1.5, sz: 1, ry, color: ['#d8c8a0', '#c8b890', '#e0d4b8'][Math.floor(r() * 3)], glow: true });
            facadeSlab.push({ x: mx0 + ox * 0.55, y: yMin + 2.85, z: mz0 + oz * 0.55, sx: w, sy: 0.08, sz: 1.1, ry: bry, rx: 0.25, color: ['#c8402a', '#2a5a8a', '#3a7a4a', '#d8a030', '#8a3a5a', '#e8e4d8'][Math.floor(r() * 6)] });
            facadeSlab.push({ x: mx0 + ox * 0.1, y: yMin + 3.35, z: mz0 + oz * 0.1, sx: Math.min(w, 5), sy: 0.6, sz: 0.12, ry: bry, color: ['#f2efe6', '#2a2a2a', '#c8302a', '#1f4f9a'][Math.floor(r() * 4)] });
          }
          for (let fy = yMin + 1.5; fy < top - 1.4; fy += 3) {
            if (shop && fy < yMin + 3) continue;
            for (let k = 0; k < n; k++) {
              const t = (k + 0.5) / n;
              facadeWin.push({ x: ax + (bx - ax) * t + ox * 0.06, y: fy + 0.25, z: az + (bz - az) * t + oz * 0.06, sx: 1.35, sy: 1.1, sz: 1, ry });
            }
            // 海側（南向き）の壁には、各階のベランダ
            if (balcony && oz < -0.45 && fy > yMin + 3) {
              const mx = (ax + bx) / 2, mz = (az + bz) / 2, bry = Math.atan2(-dz, dx);
              facadeSlab.push({ x: mx + ox * 0.45, y: fy - 0.85, z: mz + oz * 0.45, sx: L * 0.86, sy: 0.12, sz: 0.9, ry: bry, color: '#e4e2dc' });
              facadeSlab.push({ x: mx + ox * 0.88, y: fy - 0.4, z: mz + oz * 0.88, sx: L * 0.86, sy: 0.85, sz: 0.06, ry: bry, color: '#e4e2dc' });
            }
          }
        }
      }
      // 屋根：小さな家は瓦の寄棟、大きな建物は平らな屋上
      const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
      const hip = (area < 260 && poly.length <= 10) || station || (templeHall && poly.length <= 12);
      if (station) {
        // 駅舎：1階はガラス張りの店先
        const glass = new THREE.Color('#8fa6b2');
        const ccx = poly.reduce((s, p) => s + p[0], 0) / poly.length, ccz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        for (let i = 0; i < poly.length; i++) {
          const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
          const mx = (ax + bx) / 2 - ccx, mz = (az + bz) / 2 - ccz, ml = Math.hypot(mx, mz) || 1;
          const ox = (mx / ml) * 0.06, oz = (mz / ml) * 0.06;
          tb.quad([ax + ox, yMin + 0.3, az + oz], [bx + ox, yMin + 0.3, bz + oz], [bx + ox, yMin + 3.2, bz + oz], [ax + ox, yMin + 3.2, az + oz], glass);
        }
      }
      if (hip) {
        const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        const shrink = station ? 0.82 : templeHall ? 0.25 : 0.35;
        const inner = poly.map(([x, z]) => [cx + (x - cx) * shrink, cz + (z - cz) * shrink]);
        const rh = station ? 1.8 : templeHall ? 2.2 + Math.sqrt(area) * 0.16 : 1.4 + Math.sqrt(area) * 0.08;
        const eave = templeHall ? 1.5 : 0.45;
        const outer = poly.map(([x, z]) => {
          const dx = x - cx, dz = z - cz, L = Math.hypot(dx, dz) || 1;
          return [x + (dx / L) * eave, z + (dz / L) * eave];
        });
        for (let i = 0; i < poly.length; i++) {
          const j = (i + 1) % poly.length;
          // 瓦の列：u は軒にそって（m）、v は軒から棟へ（m）。瓦のテクスチャをくり返す
          const eL = Math.hypot(outer[j][0] - outer[i][0], outer[j][1] - outer[i][1]);
          const mo = [(outer[i][0] + outer[j][0]) / 2, (outer[i][1] + outer[j][1]) / 2], mi = [(inner[i][0] + inner[j][0]) / 2, (inner[i][1] + inner[j][1]) / 2];
          const sL = Math.hypot(Math.hypot(mi[0] - mo[0], mi[1] - mo[1]), rh + 0.2);
          const iL = Math.hypot(inner[j][0] - inner[i][0], inner[j][1] - inner[i][1]), off = (eL - iL) / 2;
          (station ? tb : roofTb).quad([outer[i][0], top - 0.2, outer[i][1]], [outer[j][0], top - 0.2, outer[j][1]], [inner[j][0], top + rh, inner[j][1]], [inner[i][0], top + rh, inner[i][1]], roofTile,
            [0, 0, eL / 2, 0, (off + iL) / 2, sL / 0.55, off / 2, sL / 0.55]);
        }
        const tris = THREE.ShapeUtils.triangulateShape(inner.map(([x, z]) => new THREE.Vector2(x, z)), []);
        for (const [a, bb, c] of tris) (station ? tb : roofTb).tri([inner[a][0], top + rh, inner[a][1]], [inner[bb][0], top + rh, inner[bb][1]], [inner[c][0], top + rh, inner[c][1]], roofTile.clone().multiplyScalar(0.8), [0, 0.02, 0, 0.02, 0, 0.02]);
      } else {
        const tris = THREE.ShapeUtils.triangulateShape(contour, []);
        for (const [a, bb, c] of tris) tb.tri([poly[a][0], top, poly[a][1]], [poly[bb][0], top, poly[bb][1]], [poly[c][0], top, poly[c][1]], roofFlat);
      }
      // 占有マス（あとで埋める家や木が重ならないように）
      const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
      for (let gx = Math.floor(Math.min(...xs) / 4); gx <= Math.floor(Math.max(...xs) / 4); gx++) {
        for (let gz = Math.floor(Math.min(...zs) / 4); gz <= Math.floor(Math.max(...zs) / 4); gz++) {
          if (pointInPoly(gx * 4 + 2, gz * 4 + 2, poly)) this.occupied.add(gx * 100003 + gz);
        }
      }
      // 低い家（1〜2階）：昼も見える窓（白い枠に暗いガラス、ときどき格子）と、いちばん長い壁に玄関の戸。
      // 夜は、そのうちのいくつかが灯る
      const lowHouse = !station && !templeHall && !u2 && (top - yMin < 7.5 || area < 60);
      if (lowHouse && houseWin.length < maxHouseWin) {
        const ccw = signedArea(poly) > 0;
        let best = 0, bi = 0;
        for (let i = 0; i < poly.length; i++) { const L = Math.hypot(poly[(i + 1) % poly.length][0] - poly[i][0], poly[(i + 1) % poly.length][1] - poly[i][1]); if (L > best) { best = L; bi = i; } }
        const floors = Math.max(1, Math.min(2, Math.round((top - yMin - 0.6) / 2.8)));
        const koshi = r() < 0.35;   // 古い町家の、木の格子の窓
        for (let i = 0; i < poly.length; i++) {
          const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
          const L = Math.hypot(bx - ax, bz - az);
          if (L < 2.6) continue;
          const dx = (bx - ax) / L, dz = (bz - az) / L;
          const ox = ccw ? dz : -dz, oz = ccw ? -dx : dx;
          const ry = Math.atan2(ox, oz);
          const n = Math.max(1, Math.floor((L - 0.8) / 2.8));
          for (let f = 0; f < floors; f++) {
            for (let k = 0; k < n; k++) {
              const t = (k + 0.5) / n;
              // 坂では、壁の外の地面の高さから測る（窓が地面に埋もれないように）
              const gy = Math.max(yMin, terrainY(ax + (bx - ax) * t + ox * 0.8, az + (bz - az) * t + oz * 0.8));
              const fy = gy + 1.45 + f * 2.8;
              if (fy + 0.6 > top - 0.3) continue;
              // 玄関（いちばん長い壁の1階の、まん中の窓のかわり）
              if (i === bi && f === 0 && k === Math.floor(n / 2)) {
                houseDoor.push({ x: ax + (bx - ax) * t + ox * 0.05, y: gy + 1.0, z: az + (bz - az) * t + oz * 0.05, sx: 0.95, sy: 1.95, sz: 1, ry, color: ['#5a3e2c', '#3e2e24', '#6a6a66', '#7a5a3a'][Math.floor(r() * 4)] });
                continue;
              }
              if (r() < 0.15) continue;
              const wx = ax + (bx - ax) * t, wz = az + (bz - az) * t;
              houseWin.push({ x: wx + ox * 0.05, y: fy, z: wz + oz * 0.05, sx: 1.0, sy: 0.9, sz: 1, ry });
              houseFrame.push({ x: wx + ox * 0.04, y: fy, z: wz + oz * 0.04, sx: 1.16, sy: 1.06, sz: 0.06, ry, color: koshi ? '#5a3e2c' : '#e8e4da' });
              if (koshi && f === 0) for (let q = -2; q <= 2; q++) houseFrame.push({ x: wx + ox * 0.09 + dx * q * 0.2, y: fy, z: wz + oz * 0.09 + dz * q * 0.2, sx: 0.04, sy: 0.9, sz: 0.04, ry, color: '#4a3424' });
              if (r() < 0.4) winList.push({ x: wx + ox * 0.08, y: fy, z: wz + oz * 0.08, sx: 0.95, sy: 0.85, sz: 1, ry });
            }
          }
          // 道に面した壁の、暮らしの小物：エアコンの室外機、雨どい、物干し、玄関わきの鉢植え
          const at = (t, off) => [ax + (bx - ax) * t + ox * off, az + (bz - az) * t + oz * off];
          const [cx, cz] = at(0.5, 1.4);
          if (!nearAnyRoad(cx, cz, 1.2)) continue;
          const floorAt = (t, off) => { const [x, z] = at(t, off); return [x, Math.max(yMin, terrainY(x, z)), z]; };
          // 雨どい（壁の端、軒から地面まで）
          if (r() < 0.6) {
            const [x, y, z] = floorAt(r() < 0.5 ? 0.06 : 0.94, 0.07);
            houseBits.push({ x, y: (y + top - 0.2) / 2, z, sx: 0.08, sy: top - 0.2 - y, sz: 0.08, ry, color: '#8a8a84' });
          }
          // 室外機（白い箱に、黒っぽいファンの丸）：地面に置くか、2階の壁に金具でつける
          if (r() < 0.45) {
            const t = 0.15 + r() * 0.7, high = floors > 1 && r() < 0.4;
            const [x, y, z] = floorAt(t, 0.32);
            if (high || !nearAnyRoad(x, z, 0.05)) {
              const uy = high ? y + 3.6 : y + 0.3;
              if (uy + 0.3 < top - 0.4) {
                houseBits.push({ x, y: uy, z, sx: 0.8, sy: 0.6, sz: 0.3, ry, color: '#e6e4dc' });
                houseBits.push({ x: x + ox * 0.155 - dx * 0.1, y: uy, z: z + oz * 0.155 - dz * 0.1, sx: 0.42, sy: 0.42, sz: 0.02, ry, color: '#4a4c4c' });
                if (high) houseBits.push({ x: x - ox * 0.05, y: uy - 0.33, z: z - oz * 0.05, sx: 0.9, sy: 0.05, sz: 0.4, ry, color: '#6a6a66' });
                const [px, , pz] = floorAt(t + 0.25 / L, 0.05);
                houseBits.push({ x: px, y: (uy + y) / 2 + 0.1, z: pz, sx: 0.04, sy: Math.max(0.2, uy - y), sz: 0.04, ry, color: '#d8d4c8' });   // ドレンの管
              }
            }
          }
          // 物干し：2階の窓の下に、さお竿と洗濯物（晴れた昼の暮らし）
          if (floors > 1 && L > 4 && r() < 0.22) {
            const t = 0.3 + r() * 0.4, [x, y, z] = floorAt(t, 0.55);
            const py = y + 4.35;
            if (py < top - 0.3) {
              for (const s of [-1, 1]) houseBits.push({ x: x + dx * s * 0.9 - ox * 0.25, y: py, z: z + dz * s * 0.9 - oz * 0.25, sx: 0.04, sy: 0.04, sz: 0.55, ry, color: '#7a7a76' });
              houseBits.push({ x, y: py, z, sx: 2.2, sy: 0.04, sz: 0.04, ry, color: '#c8c8c2' });
              let u = -0.9;
              while (u < 0.8) {
                const w2 = 0.3 + r() * 0.35, h2 = 0.4 + r() * 0.45;
                laundry.push({ x: x + dx * (u + w2 / 2), y: py - h2 / 2 - 0.02, z: z + dz * (u + w2 / 2), sx: w2, sy: h2, sz: 0.03, ry, color: ['#f2f0ea', '#e8e8f0', '#8aa8c8', '#e0a0a8', '#d8c870', '#6a7a9a', '#f0f0f0', '#c86a4a'][Math.floor(r() * 8)] });
                u += w2 + 0.06 + r() * 0.15;
              }
            }
          }
          // 玄関わきの鉢植え
          if (i === bi && r() < 0.55) {
            for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
              const [x, y, z] = floorAt(0.5 + (0.7 + k * 0.42) / L * (r() < 0.5 ? 1 : -1), 0.3);
              if (nearAnyRoad(x, z, 0.02)) continue;
              const s2 = 0.26 + r() * 0.16;
              houseBits.push({ x, y: y + s2 / 2, z, sx: s2, sy: s2, sz: s2, color: ['#b0563a', '#8a5a3a', '#6a7a8a', '#c8b89a'][Math.floor(r() * 4)] });
              houseBits.push({ x, y: y + s2 + 0.15, z, sx: s2 * 1.3, sy: 0.32 + r() * 0.25, sz: s2 * 1.3, color: r() < 0.25 ? ['#d84a6a', '#f0c030', '#e8e4f0'][Math.floor(r() * 3)] : ['#3e6e34', '#4f7c3e', '#5a8a44'][Math.floor(r() * 3)] });
            }
          }
        }
      }
      // 夜に灯る窓（いちばん長い壁の外側に1〜2枚）
      if (!lowHouse && r() < 0.7) {
        let best = 0, bi = 0;
        for (let i = 0; i < poly.length; i++) {
          const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
          const L = Math.hypot(bx - ax, bz - az);
          if (L > best) { best = L; bi = i; }
        }
        const [ax, az] = poly[bi], [bx, bz] = poly[(bi + 1) % poly.length];
        const ccw = signedArea(poly) > 0;
        const dx = (bx - ax) / best, dz = (bz - az) / best;
        const ox = ccw ? dz : -dz, oz = ccw ? -dx : dx;
        const floors = Math.max(1, Math.floor(h / 3));
        for (let f = 0; f < floors; f++) {
          if (r() < 0.5) continue;
          const t = 0.25 + r() * 0.5;
          winList.push({ x: ax + (bx - ax) * t + ox * 0.08, y: yMin + 1.6 + f * 3, z: az + (bz - az) * t + oz * 0.08, sx: 1.1, sy: 0.85, sz: 1, ry: Math.atan2(ox, oz) });
        }
      }
    }
    // 窓（昼は青みがかった暗いガラス）とベランダ
    this.group.add(instancedBoxes(facadeWin, lam(0x46525e), { cast: false, receive: false, geo: new THREE.PlaneGeometry(1, 1) }));
    this.group.add(instancedChunks(facadeSlab, lam(0xffffff), { cast: true, receive: true }));
    // 1階の店先：シャッターやガラス戸と、店の中の明るさ（夜は灯る）
    if (shopFront.length) {
      this.group.add(instancedChunks(shopFront.filter((f) => !f.glow), lam(0xffffff), { detail: 160, cast: false, geo: new THREE.PlaneGeometry(1, 1) }));
      this.shopGlowMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffd8a0, emissiveIntensity: 0.1 });
      this.specialSignMats.push(this.shopGlowMat);
      this.group.add(instancedChunks(shopFront.filter((f) => f.glow), this.shopGlowMat, { detail: 160, cast: false, geo: new THREE.PlaneGeometry(1, 1) }));
    }
    // 低い家の窓・枠・玄関（遠くでは描かない）
    if (houseWin.length) {
      this.group.add(instancedChunks(houseWin, lam(0x3e4a54), { detail: 170, cast: false, receive: false, geo: new THREE.PlaneGeometry(1, 1) }));
      this.group.add(instancedChunks(houseFrame, lam(0xffffff), { detail: 130, cast: false }));
      this.group.add(instancedChunks(houseDoor, lam(0xffffff), { detail: 150, cast: false, geo: new THREE.PlaneGeometry(1, 1) }));
      if (houseBits.length) this.group.add(instancedChunks(houseBits, lam(0xffffff), { detail: 110, receive: false }));
      if (laundry.length) this.group.add(instancedChunks(laundry, lam(0xffffff), { detail: 110, receive: false }));
    }
    {
      // 瓦：横の列ごとに、丸みの明暗と、列のあいだの影。色は頂点の色（紺・灰・赤茶）を掛ける
      const tile = canvasTexture(64, 64, (g, w, h) => {
        g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 8) { const grd = g.createLinearGradient(x, 0, x + 8, 0); grd.addColorStop(0, '#9a9a9a'); grd.addColorStop(0.5, '#f4f4f4'); grd.addColorStop(1, '#a8a8a8'); g.fillStyle = grd; g.fillRect(x, 0, 8, h); }
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, h - 7, w, 7);
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, w, 3);
      }, { srgb: true });
      tile.wrapS = tile.wrapT = THREE.RepeatWrapping;
      const rm = new THREE.Mesh(roofTb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, map: tile }));
      rm.castShadow = rm.receiveShadow = true;
      this.group.add(rm);
    }
    // 壁：しっくいのむら、雨だれのうすい筋、ときどき板の目地（3m 四方でくり返す）。屋根や窓などは、まん中の無地のところを使う
    const wallTex = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#f0f0f0'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 1800, 0.07, seededRandom('wall-tex'));
      const rr = seededRandom('wall-tex2');
      for (let k = 0; k < 10; k++) { g.fillStyle = `rgba(0,0,0,${0.03 + rr() * 0.04})`; g.fillRect(rr() * w, rr() * h * 0.5, 1 + rr() * 2, h * (0.3 + rr() * 0.5)); }   // 雨だれ
      g.fillStyle = 'rgba(0,0,0,0.07)';
      for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1);                       // 目地
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, h - 4, w, 4);                  // 足もとの汚れ（1枚ごと）
      g.fillStyle = '#f0f0f0'; for (const [cx, cy] of [[0, 0], [w - 3, 0], [0, h - 3], [w - 3, h - 3]]) g.fillRect(cx, cy, 3, 3);   // 四すみ（uv (0,0) のあたり）は無地
    });
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    this.wallTex = wallTex;
    for (const batch of [tbTown, tbStation]) {
      const mesh = new THREE.Mesh(batch.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, map: wallTex }));
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      if (batch === tbStation) this.stationSimple = mesh;
    }
    if (this.stationPoly) this._stationModel();
    if (museumPolys.length) this._museum(museumPolys);
    // 夜の窓の灯り：家の窓と、ビルやマンションの窓。一つずつ、日と時間帯で点いたり消えたりする
    const nightWin = facadeWin.filter((_, i) => (i * 7919) % 4 !== 0).map((w) => ({ x: w.x + Math.sin(w.ry) * 0.05, y: w.y, z: w.z + Math.cos(w.ry) * 0.05, sx: 1.25, sy: 1.0, ry: w.ry }));
    this.world.scheduledWindows([...winList, ...nightWin]);
  }

  /** OSM に建物が載っていない斜面を、小さな家で埋める（尾道の坂の家並み） */
  _infill() {
    const r = this.r;
    const walls = ['#ece6da', '#e2d8c6', '#d6ccb8', '#efe9df', '#e6d4c4', '#6b5543', '#5a4a3c', '#bfb6a6', '#8a6a4e'];
    const roofs = ['#3c4658', '#465166', '#4d535b', '#2f3644', '#5b6068', '#556270', '#6e3a34', '#7a4a3a', '#7a5a40'];
    const list = [];
    for (let z = -1100; z < 220; z += 7 + r() * 2.5) {
      for (let x = -720; x < 640; x += 7 + r() * 2.5) {
        const hx = x + (r() - 0.5) * 3, hz = z + (r() - 0.5) * 3;
        const ground = terrainY(hx, hz);
        const above = ground - SEA_Y;
        // 向島側は海沿いの平地だけ、まばらに
        if (!onOnomichiSide(hx, hz) && (above > 14 || r() < 0.5)) continue;
        if (above < 1.5 || above > 105) continue;                // 海と、千光寺山の上のほうの森
        if (Math.hypot(hx, hz) < 14) continue;                    // 空き家のまわり
        if (this.occupied.has(Math.floor(hx / 4) * 100003 + Math.floor(hz / 4))) continue;
        if (inPrecinct(hx, hz, 4) || inStationFront(hx, hz)) continue;
        if (onOnomichiSide(hx, hz) && distToCoast(hx, hz) < 16) continue;   // 海沿いの道（岸壁ぞい）は、地図にある建物だけ
        const w = 4.5 + r() * 3.5, d = 4.5 + r() * 3;
        if (nearRail(hx, hz, Math.max(w, d) / 2 + 3.5)) continue;   // 線路と、その両わきの架線柱・石垣の場所
        if (nearAnyRoad(hx, hz, Math.max(w, d) / 2 + 0.8)) continue;
        if (BENCHES.some((bb) => Math.hypot(bb.x - hx, bb.z - hz) < Math.max(w, d) / 2 + 3)) continue;
        if (STREET_SHOPS.some((sh) => Math.hypot(sh.x - hx, sh.z - hz) < Math.max(w, d) / 2 + 4)) continue;
        // 町なか（平地）と坂の下のほうは、家がひしめくように。上へ行くほど森に変わっていく（写真の千光寺山のように）
        if (above > 42 && r() < Math.min(0.92, (above - 42) / 40)) continue;
        const h = above < 8 ? 6 + r() * 5 : 3 + r() * 3;
        if (ground + h + 2.2 > viewCap(hx, hz)) continue; // 窓からの眺めをふさがない
        list.push({ x: hx, z: hz, y: ground - 3, w, h: h + 3, d, rot: (r() - 0.5) * 0.3 + Math.round(r() * 2) * Math.PI / 2, roofH: 1.3 + r() * 0.8,
          wall: walls[Math.floor(r() * walls.length)], roof: roofs[Math.floor(r() * roofs.length)] });
        this.occupied.add(Math.floor(hx / 4) * 100003 + Math.floor(hz / 4));
        addSolid(hx, hz, w, d, list[list.length - 1].rot);
      }
    }
    // 200m 四方ごとにまとめる（視野外のタイルは描かない）
    const bins = new Map();
    for (const h of list) {
      const k = Math.floor(h.x / 200) * 100003 + Math.floor(h.z / 200);
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(h);
    }
    const win = [];
    this.world.houseWallMap = this.wallTex;
    for (const items of bins.values()) win.push(...this.world._houses(items));
    this.world.scheduledWindows(win);
    // 坂の家の土台：石垣の段（尾道の斜面は、家ごとに石を積んで平らにしてある）。下り側に石垣が見える
    const tb = new TriBatch(), sc = new THREE.Color();
    for (const h of list) {
      const ground = h.y + 3, cr = Math.cos(h.rot), sr = Math.sin(h.rot);
      const hw = h.w / 2 + 0.35, hd = h.d / 2 + 0.35;
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [h.x + lx * cr + lz * sr, h.z - lx * sr + lz * cr]);
      const ys = corners.map(([x, z]) => terrainY(x, z));
      const lo = Math.min(...ys), hi = Math.max(...ys);
      if (hi - lo < 0.5) continue;                        // 平らなところは、土台なし
      const top = Math.min(hi + 0.25, ground + 0.9), bot = lo - 0.6;
      if (top - bot < 0.8) continue;
      sc.setHSL(0.09 + this.r() * 0.04, 0.08 + this.r() * 0.06, 0.5 + this.r() * 0.12);
      let u = 0;
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4], L = Math.hypot(bx - ax, bz - az);
        tb.quad([ax, bot, az], [bx, bot, bz], [bx, top, bz], [ax, top, az], sc, [u / 1.5, bot, (u + L) / 1.5, bot, (u + L) / 1.5, top, u / 1.5, top]);
        u += L;
      }
      // 上の面（家のまわりの、ふちの石）
      tb.quad([corners[0][0], top, corners[0][1]], [corners[3][0], top, corners[3][1]], [corners[2][0], top, corners[2][1]], [corners[1][0], top, corners[1][1]], sc);
    }
    if (tb.pos.length) {
      const mesh = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, map: this._texture('wall') }));
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /**
   * 千光寺の参道（山の上のほう）：石灯籠の列、花崗岩の大きな岩、赤いのぼり、お地蔵さん、
   * 道の上にかぶさる木々。千光寺山は岩の山で、参道のわきにも大きな岩がごろごろしている
   */
  _sando() {
    if (SANDO.length < 2) return;
    const r = this.r;
    const stone = [], roofs = [], fire = [], rocks = [], poles = [], cloth = [], jizo = [], heads = [], trunks = [], crowns = [], walls = [], moss = [];
    const month = new Date().getMonth() + 1;
    const autumn = month === 10 || month === 11;
    const free = (x, z, m = 0.6) => !nearAnyRoad(x, z, m) && !inBuilding(x, z) && !inSolid(x, z) && !inPrecinct(x, z, -4);
    const pts = samplePath(SANDO, 2);
    let total = 0, lastLantern = -99, lastRock = -99, lastTree = -99, lastBanner = -99, jizoCount = 0;
    const templeEnd = 90;   // 千光寺から下へ90mまでは、のぼりを立てる
    for (let i = 0; i < pts.length; i++, total += 2) {
      const p = pts[i];
      const above = terrainY(p.x, p.z) - SEA_Y;
      if (above < 28) break;   // 山の上のほうだけ（町なかに入ったら終わり）
      const n = nearestRoad(p.x, p.z);
      const hw = n ? n.seg.half : 1;
      const nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
      // 両わきの石垣（野面積み）：山側は土を受けて高く、谷側は低い。上と、道に向いた面に苔
      if (i < pts.length - 1) {
        const py = groundY(p.x, p.z);
        for (const sd of [-1, 1]) {
          const wx = p.x + nx * sd * (hw + 0.25), wz = p.z + nz * sd * (hw + 0.25);
          if (nearAnyRoad(wx, wz, 0.05) || inBuilding(wx, wz) || inPrecinct(wx, wz, -4)) continue;
          const beside = groundY(p.x + nx * sd * (hw + 1.6), p.z + nz * sd * (hw + 1.6));
          const h = beside > py + 0.3 ? Math.min(2.2, beside - py + 0.45) : 0.55;
          const tone = ['#a39d90', '#968f82', '#aaa598', '#8f8a7e'][Math.floor(r() * 4)];
          // 谷側では、外の地面まで積み下ろす（宙に浮かないように）
          const outside = terrainY(wx + nx * sd * 0.3, wz + nz * sd * 0.3);
          const top = py + h, bottom = Math.min(py - 0.3, outside - 0.3);
          walls.push({ x: wx, y: (top + bottom) / 2, z: wz, sx: 2.08, sy: top - bottom, sz: 0.5, ry: -p.angle, color: tone });
          // 積んだ石の出っぱり（ところどころ、色のちがう石）
          for (let k = 0; k < Math.round(h * 2); k++) {
            const u = (r() - 0.5) * 1.6, v = 0.15 + r() * (h - 0.25);
            const tx = Math.cos(p.angle) * u, tz = Math.sin(p.angle) * u;
            walls.push({ x: wx + tx - nx * sd * 0.27, y: py + v, z: wz + tz - nz * sd * 0.27, sx: 0.35 + r() * 0.3, sy: 0.22 + r() * 0.18, sz: 0.06, ry: -p.angle, color: ['#b4afa2', '#8a8478', '#9f998c'][Math.floor(r() * 3)] });
          }
          // 苔：石垣の上、道に向いた面のすそ、道ばた
          if (r() < 0.6) moss.push({ x: wx, y: py + h + 0.02, z: wz, sx: 1.6 + r() * 0.5, sy: 0.07, sz: 0.56, ry: -p.angle, color: ['#5d7a3a', '#6a8444', '#4e6a32'][Math.floor(r() * 3)] });
          if (r() < 0.45) {
            const u = (r() - 0.5) * 1.2, ph = 0.25 + r() * Math.min(0.6, h * 0.5);
            moss.push({ x: wx + Math.cos(p.angle) * u - nx * sd * 0.26, y: py + ph / 2, z: wz + Math.sin(p.angle) * u - nz * sd * 0.26, sx: 0.5 + r() * 0.7, sy: ph, sz: 0.04, ry: -p.angle, color: ['#5a7438', '#6c8848', '#4a6230'][Math.floor(r() * 3)] });
          }
          if (r() < 0.6) {
            const gx = p.x + nx * sd * (hw - 0.05), gz = p.z + nz * sd * (hw - 0.05);
            moss.push({ x: gx, y: groundY(gx, gz) + 0.03, z: gz, sx: 1.2 + r() * 0.8, sy: 0.05, sz: 0.25 + r() * 0.15, ry: -p.angle, color: ['#5f7c3c', '#6e8a48'][Math.floor(r() * 2)] });
          }
        }
      }
      // 石灯籠：両側に、約14m ごと
      if (total - lastLantern > 14) {
        for (const sd of [-1, 1]) {
          const x = p.x + nx * sd * (hw + 0.9), z = p.z + nz * sd * (hw + 0.9);
          if (!free(x, z, 0.3)) continue;
          lastLantern = total;
          const y = groundY(x, z);
          stone.push({ x, y: y + 0.2, z, sx: 0.8, sy: 0.4, sz: 0.8, color: '#a8a296' });     // 基礎
          stone.push({ x, y: y + 0.85, z, sx: 0.28, sy: 0.9, sz: 0.28, color: '#aaa498' });  // 竿
          stone.push({ x, y: y + 1.36, z, sx: 0.62, sy: 0.14, sz: 0.62, color: '#a49e92' }); // 中台
          fire.push({ x, y: y + 1.62, z, sx: 0.42, sy: 0.38, sz: 0.42 });                    // 火袋
          roofs.push({ x, y: y + 1.98, z, sx: 0.95, sy: 0.32, sz: 0.95, ry: -p.angle, color: '#8e897e' }); // 笠
          stone.push({ x, y: y + 2.22, z, sx: 0.14, sy: 0.18, sz: 0.14, color: '#8e897e' });  // 宝珠
          this.lampPositions.push([x, y + 1.62, z]);
          addSolid(x, z, 0.9, 0.9, -p.angle);
        }
      }
      // 花崗岩の岩（道のわきに、ところどころ大きいもの）
      if (total - lastRock > 5 && r() < 0.6) {
        const sd = r() < 0.5 ? -1 : 1;
        const size = 1 + r() * (r() < 0.25 ? 4 : 1.8);
        const off = hw + 1.2 + size * 0.6 + r() * 2;
        const x = p.x + nx * sd * off, z = p.z + nz * sd * off;
        if (free(x, z, size * 0.5)) {
          lastRock = total;
          const y = groundY(x, z);
          const mossy = r() < 0.35;
          rocks.push({ x, y: y + size * 0.25, z, sx: size * (0.9 + r() * 0.5), sy: size * (0.55 + r() * 0.4), sz: size * (0.8 + r() * 0.5), ry: r() * 6, rx: (r() - 0.5) * 0.4, color: mossy ? '#7c8162' : ['#a29d92', '#958f83', '#aaa69c'][Math.floor(r() * 3)] });
          addSolid(x, z, size, size, 0);
        }
      }
      // 道にかぶさる木（松・楠・もみじ）
      if (total - lastTree > 7) {
        for (const sd of [-1, 1]) {
          if (r() < 0.35) continue;
          const off = hw + 3 + r() * 3;
          const x = p.x + nx * sd * off, z = p.z + nz * sd * off;
          if (!free(x, z, 1.5)) continue;
          lastTree = total;
          const y = groundY(x, z);
          const h = 5 + r() * 4;
          const lean = -sd * 0.12;   // 道のほうへ少しかたむける
          trunks.push({ x, y: y + h / 2, z, sx: 0.32, sy: h, sz: 0.32, rx: lean * nz, rz: -lean * nx, color: '#4e3e30' });
          // もみじは11月が見ごろ。10月は色づきはじめ（少なめで、橙や黄色）
          const maple = autumn && r() < (month === 11 ? 0.45 : 0.18);
          const cx = x - nx * sd * 1.4, cz = z - nz * sd * 1.4;
          for (let k = 0; k < 3; k++) {
            const c = maple ? (month === 11 ? ['#c84a2a', '#d8702a', '#b8382a'] : ['#c8803a', '#b89a3e', '#5a6a34'])[k % 3] : ['#3e5a34', '#4a6a3a', '#36502e'][k % 3];
            crowns.push({ x: cx + (r() - 0.5) * 2.4, y: y + h - 0.6 + k * 0.7, z: cz + (r() - 0.5) * 2.4, sx: 2.8 + r() * 1.4, sy: 1.6 + r() * 0.8, sz: 2.8 + r() * 1.4, ry: r() * 6, color: c });
          }
          addSolid(x, z, 0.8, 0.8, 0);
        }
      }
      // 赤いのぼり（千光寺の近く）
      if (total < templeEnd && total - lastBanner > 5) {
        const x = p.x + nx * (hw + 0.5), z = p.z + nz * (hw + 0.5);
        if (free(x, z, 0.2)) {
          lastBanner = total;
          const y = groundY(x, z);
          poles.push({ x, y: y + 1.6, z, sx: 0.05, sy: 3.2, sz: 0.05, color: '#d8d4c8' });
          const tx = Math.cos(p.angle) * 0.3, tz = Math.sin(p.angle) * 0.3;
          cloth.push({ x: x + tx, y: y + 1.85, z: z + tz, sx: 0.55, sy: 2.2, sz: 0.02, ry: -p.angle, color: '#c8302a' });
          cloth.push({ x: x + tx, y: y + 2.86, z: z + tz, sx: 0.56, sy: 0.18, sz: 0.025, ry: -p.angle, color: '#f2ece0' });
        }
      }
      // お地蔵さん（赤い前かけ）を、道のわきに3か所ほど
      if (jizoCount < 3 && i % 23 === 11) {
        const x = p.x - nx * (hw + 0.7), z = p.z - nz * (hw + 0.7);
        if (free(x, z, 0.2)) {
          jizoCount++;
          const y = groundY(x, z);
          const face = Math.atan2(nx, nz);
          stone.push({ x, y: y + 0.12, z, sx: 0.6, sy: 0.24, sz: 0.5, ry: face, color: '#9c968a' });
          stone.push({ x, y: y + 0.55, z, sx: 0.34, sy: 0.62, sz: 0.28, ry: face, color: '#b2ac9f' });
          heads.push({ x, y: y + 0.98, z, sx: 0.26, sy: 0.28, sz: 0.26, color: '#b2ac9f' });
          cloth.push({ x: x + nx * 0.13, y: y + 0.66, z: z + nz * 0.13, sx: 0.34, sy: 0.3, sz: 0.05, ry: face, color: '#c8302a' });
          addSolid(x, z, 0.7, 0.6, 0);
        }
      }
    }
    if (stone.length) this.group.add(instancedChunks(stone, lam(0xffffff), { detail: 80 }));
    if (walls.length) this.group.add(instancedChunks(walls, lam(0xffffff), { detail: 90 }));
    if (moss.length) this.group.add(instancedChunks(moss, lam(0xffffff), { detail: 60, cast: false }));
    if (roofs.length) this.group.add(instancedChunks(roofs, lam(0xffffff), { detail: 80, geo: new THREE.CylinderGeometry(0.2, 0.75, 1, 4, 1, false, Math.PI / 4) }));
    if (fire.length) {
      // 火袋：昼は石の色、夜はほんのり灯る
      this.sandoFireMat = new THREE.MeshLambertMaterial({ color: 0xb8b2a4, emissive: 0xffa040, emissiveIntensity: 0 });
      this.group.add(instancedChunks(fire, this.sandoFireMat, { detail: 80, cast: false }));
    }
    if (rocks.length) this.group.add(instancedChunks(rocks, lam(0xffffff, { flatShading: true }), { geo: new THREE.DodecahedronGeometry(0.6, 0) }));
    if (poles.length) this.group.add(instancedChunks(poles, lam(0xffffff), { detail: 80, receive: false }));
    if (cloth.length) this.group.add(instancedChunks(cloth, lam(0xffffff, { side: THREE.DoubleSide }), { detail: 80, receive: false }));
    if (heads.length) this.group.add(instancedChunks(heads, lam(0xffffff), { detail: 60, geo: new THREE.SphereGeometry(0.5, 10, 8) }));
    if (trunks.length) {
      this.group.add(instancedChunks(trunks, lam(0xffffff), { geo: new THREE.CylinderGeometry(0.4, 0.55, 1, 6) }));
      this.group.add(instancedChunks(crowns, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(0.6, 1) }));
    }
  }

  _trees() {
    const r = this.r;
    const broad = [], pines = [], shrubs = [];
    const amount = 0.55 + 0.45 * quality.s.people;   // 画質「低」では少なめに
    const okAt = (x, z, margin) => {
      if (Math.hypot(x, z) < 10) return false;
      if (this.occupied.has(Math.floor(x / 4) * 100003 + Math.floor(z / 4))) return false;
      if (inPrecinct(x, z, 2) || nearRail(x, z, 5) || nearAnyRoad(x, z, margin) || inSolid(x, z)) return false;
      // 山頂の展望台からの眺め（南の尾道水道）をさえぎらない
      const dd = Math.hypot(x - SUMMIT.deck.x, z - SUMMIT.deck.z);
      if (dd < 25 || (dd < 90 && z < SUMMIT.deck.z + 5)) return false;
      // 竹田像の広場から谷（海）への眺めもあけておく
      const px = x - TAKEDA_PLAZA.x, pz = z - TAKEDA_PLAZA.z, pd = Math.hypot(px, pz);
      return !(pd < 45 && px * plazaView.x + pz * plazaView.z > pd * 0.35);
    };
    const pv = downhillYaw(TAKEDA_PLAZA.x, TAKEDA_PLAZA.z, TAKEDA_PLAZA.r + 6), plazaView = { x: Math.sin(pv), z: Math.cos(pv) };
    // 秋（10〜11月）は、ところどころ赤や橙、黄色に色づく
    const month = new Date().getMonth() + 1;
    const autumn = month === 10 ? 0.12 : month === 11 ? 0.28 : 0;
    const AUTUMN = [[0.02, 0.46, 0.32], [0.04, 0.5, 0.35], [0.07, 0.5, 0.38], [0.11, 0.48, 0.4], [0.14, 0.42, 0.38], [0.98, 0.38, 0.3]];
    const leaf = () => {
      if (r() < autumn) { const [h, sat, l] = AUTUMN[Math.floor(r() * AUTUMN.length)]; return new THREE.Color().setHSL(h, sat, l * (0.8 + r() * 0.3)); }
      return new THREE.Color().setHSL(0.24 + r() * 0.09, 0.3 + r() * 0.18, 0.15 + r() * 0.11);
    };
    // 木立：斜面にかたまりで。上のほう（千光寺山）は深い森に
    const clusters = Math.round(2600 * amount);
    for (let i = 0; i < clusters; i++) {
      const cx = BOUNDS.x0 + r() * (BOUNDS.x1 - BOUNDS.x0), cz = BOUNDS.z0 + r() * (BOUNDS.z1 - BOUNDS.z0);
      const above0 = terrainY(cx, cz) - SEA_Y;
      if (above0 < 6) continue;
      // 上のほうは、すき間なく茂る森
      const forest = above0 > 45;
      const n = forest ? 10 + Math.floor(r() * 8) : 2 + Math.floor(r() * 4);
      const spread = forest ? 20 : 14;
      for (let k = 0; k < n; k++) {
        const x = cx + (r() - 0.5) * spread, z = cz + (r() - 0.5) * spread;
        const ground = terrainY(x, z);
        const above = ground - SEA_Y;
        if (above < 5) continue;
        const s = above > 45 ? 2.6 + r() * 3.6 : 1.6 + r() * 2.8;
        // 葉の広がり（半径およそ s）が、道や石段にかからないように
        if (!okAt(x, z, s * 1.05 + 0.8)) continue;
        if (ground + s * 1.6 > viewCap(x, z)) continue;
        if (r() < 0.22) {
          // 松：細い幹に、平たい葉の段
          pines.push({ x, y: ground + s * 1.1, z, sx: s * 0.75, sy: s * 0.45, sz: s * 0.75, color: new THREE.Color().setHSL(0.3, 0.32, 0.13 + r() * 0.06) });
        } else {
          broad.push({ x, y: ground + s * 0.6, z, sx: s, sy: s * (0.8 + r() * 0.5), sz: s, color: leaf() });
        }
      }
    }
    // 千光寺山などの上のほう（海から40m以上）：すき間の少ない森で斜面をおおう
    const step = 6.5 / Math.sqrt(amount);
    for (let x = BOUNDS.x0; x < BOUNDS.x1; x += step) {
      for (let z = BOUNDS.z0; z < BOUNDS.z1; z += step) {
        const tx = x + (r() - 0.5) * step, tz = z + (r() - 0.5) * step;
        const ground = terrainY(tx, tz);
        const above = ground - SEA_Y;
        if (above < 40 || r() > Math.min(0.9, (above - 40) / 25)) continue;
        const sz = 3 + r() * 3.8;
        if (!okAt(tx, tz, sz * 1.05 + 0.8)) continue;
        if (ground + sz * 1.4 > viewCap(tx, tz)) continue;
        if (r() < 0.15) pines.push({ x: tx, y: ground + sz * 1.1, z: tz, sx: sz * 0.75, sy: sz * 0.45, sz: sz * 0.75, color: new THREE.Color().setHSL(0.3, 0.32, 0.12 + r() * 0.05) });
        else broad.push({ x: tx, y: ground + sz * 0.55, z: tz, sx: sz, sy: sz * (0.75 + r() * 0.4), sz, color: r() < autumn * 0.6 ? leaf() : new THREE.Color().setHSL(0.25 + r() * 0.08, 0.32 + r() * 0.15, 0.13 + r() * 0.09) });
      }
    }
    // 石段や坂道のわきの植え込み・草むら（細い道を歩いている感じに）
    const shrubCap = Math.round(5200 * amount);
    for (const road of ROADS) {
      if (shrubs.length > shrubCap) break;
      if (road.surface !== 'stone' || road.covered) continue;
      for (const p of samplePath(road.pts, 2.2)) {
        if (r() > 0.42) continue;
        const side = r() < 0.5 ? -1 : 1;
        const s = 0.45 + r() * 0.7;
        const o = road.width / 2 + s * 1.2 + 0.25 + r() * 0.5;
        const x = p.x - Math.sin(p.angle) * side * o, z = p.z + Math.cos(p.angle) * side * o;
        const ground = terrainY(x, z);
        // 平地（町の舗装のところ）には生やさない。広場の植え込みは、それぞれの場所で鉢や花壇に植える
        if (ground - SEA_Y < 7 || !okAt(x, z, s * 1.2 + 0.15)) continue;
        if (ground + s > viewCap(x, z)) continue;
        shrubs.push({ x, y: ground + s * 0.45, z, sx: s * 1.2, sy: s, sz: s * 1.2, color: leaf() });
      }
    }
    // 葉のかたまり：いくつかの丸を寄せた、でこぼこの樹冠。下ほど暗く、上ほど明るく（頂点の色を、木ごとの色に掛ける）
    const shade = (g, lo = 0.55) => {
      g.computeBoundingBox();
      const { min, max } = g.boundingBox, pos = g.attributes.position, col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) - min.y) / (max.y - min.y || 1);
        const v = lo + (1 - lo) * Math.min(1, t * 1.25);
        col[i * 3] = v * 0.97; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 0.92;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    };
    const lobes = (list) => mergeGeometries(list.map(([x, y, z, rad]) => new THREE.IcosahedronGeometry(rad, 0).translate(x, y, z)));
    const clumpGeo = shade(lobes([[0, -0.05, 0, 0.82], [0.5, 0.1, 0.25, 0.58], [-0.42, 0.05, 0.38, 0.6], [-0.1, 0.05, -0.52, 0.58], [0.08, 0.5, 0.02, 0.6]]));
    const simpleGeo = shade(new THREE.IcosahedronGeometry(1, 0), 0.62);
    // 葉のきめ：明るい葉と暗いすき間の、細かいまだら
    const leafTex = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, w, h);
      const rr = seededRandom('leaf-tex');
      for (let k = 0; k < 900; k++) {
        const x = rr() * w, y = rr() * h, rad = 1.5 + rr() * 3.5, v = rr() < 0.35 ? 90 + rr() * 40 : 200 + rr() * 55;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.beginPath(); g.ellipse(x, y, rad, rad * 0.6, rr() * 3, 0, Math.PI * 2); g.fill();
      }
    });
    leafTex.repeat.set(3, 3);
    const vmat = lam(0xffffff, { flatShading: true, vertexColors: true, map: leafTex });
    const mat = lam(0xffffff, { flatShading: true });
    // 町なかと坂の木（海から50mまで）は、でこぼこの樹冠と幹。上の森は、軽い丸のまま
    const townTrees = broad.filter((b) => b.y - SEA_Y < 50), forestTrees = broad.filter((b) => b.y - SEA_Y >= 50);
    // 町の木は、幹が見えるくらい樹冠を持ち上げる（窓からの眺めをふさがない範囲で）
    for (const b of townTrees) b.y += Math.max(0, Math.min(b.sx * 0.22, viewCap(b.x, b.z) - (b.y + b.sy) - 0.3));
    this.group.add(instancedChunks(townTrees, vmat, { geo: clumpGeo }));
    this.group.add(instancedChunks(forestTrees, vmat, { geo: simpleGeo }));
    this.group.add(instancedChunks(townTrees.map((b) => {
      const g = terrainY(b.x, b.z), top = b.y - b.sy * 0.35;
      return { x: b.x, y: (g + top) / 2 - 0.2, z: b.z, sx: 0.15 * b.sx + 0.08, sy: top - g + 0.4, sz: 0.15 * b.sx + 0.08, color: new THREE.Color().setHSL(0.07, 0.18, 0.2 + ((b.x * 7.1 + b.z) % 1 + 1) % 1 * 0.08) };
    }), lam(0xffffff), { geo: new THREE.CylinderGeometry(0.7, 1, 1, 5), receive: false }));
    // 松：葉の段（つぶした円錐）
    const pineGeo = new THREE.ConeGeometry(1, 1, 7);
    this.group.add(instancedChunks(pines, mat, { geo: pineGeo }));
    this.group.add(instancedChunks(pines.map((p) => ({ x: p.x, y: p.y - p.sy * 1.6, z: p.z, sx: 0.12, sy: p.sy * 2.6, sz: 0.12, color: new THREE.Color(0x4a3a2c) })), lam(0xffffff), { geo: new THREE.CylinderGeometry(1, 1, 1, 5) }));
    this.group.add(instancedChunks(shrubs, vmat, { geo: shade(lobes([[0, 0, 0, 0.8], [0.45, -0.1, 0.2, 0.55], [-0.4, -0.1, -0.25, 0.55]]), 0.6), cast: false }));
  }

  /** 空き家の外観：石垣の土台、瓦屋根、戸口 */
  _house() {
    const stone = lam(0x7d776c);
    const base = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 5), stone);
    base.position.set(0, -3.1, 0.5);
    base.receiveShadow = true;
    this.group.add(base);
    const roofGeo = new THREE.CylinderGeometry(0.62, 0.62, 1, 3, 1);
    roofGeo.rotateZ(Math.PI / 2);
    roofGeo.rotateX(-Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, lam(0x474c54));
    roof.scale.set(6.6, 2.0, 6.4);
    roof.position.set(0, 2.95, 0.5);
    roof.castShadow = true;
    this.group.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.85, 0.95), lam(0x5a3d29));
    door.position.set(-2.66, 0.92, 1.5);
    this.group.add(door);
    const lattice = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.5), lam(0xe6dcc6));
    lattice.position.set(-2.75, 1.0, 1.5);
    lattice.rotation.y = -Math.PI / 2;
    this.group.add(lattice);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.42), new THREE.MeshBasicMaterial({ map: labelTexture('空き家', { w: 64, h: 192, size: 44, vertical: true, bg: '#d8ccb0', fg: '#3a2a1a' }) }));
    plate.position.set(-2.75, 1.45, 2.15);
    plate.rotation.y = -Math.PI / 2;
    this.group.add(plate);
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.2), stone);
    step.position.set(-3.4, -0.25, 1.5);
    this.group.add(step);
  }

  // ---------- 本通り商店街：アーケードの屋根と店先 ----------
  _arcade() {
    // 昭和の商店街：鉄骨のトラスに明かり取りの屋根、さびたトタンの壁、シャッターの閉まった店、
    // 吊り看板と縦長の電飾看板、雨どい、のぼり、鉢植え。まとめ描きで、描く回数はわずかにする
    const r = this.r;
    const atlas = buildSignAtlas();
    const retro = buildRetroSignAtlas();
    const interior = buildShopInteriorAtlas();
    const signs = new QuadBatch(), glassDay = new QuadBatch(), glassNight = new QuadBatch();
    const tin = new QuadBatch(), shutters = new QuadBatch(), retroSigns = new QuadBatch();
    const awnings = [], fronts = [], ribs = [], lamps = [], shades = [], pipes = [], cases = [], pots = [], plants = [], wheels = [];
    const facadeColors = ['#cfc8b8', '#bdb4a2', '#d9d2c2', '#a89f8c', '#8a7a68', '#c4b8a0'];
    const awningColors = ['#a33a2a', '#2f5a7a', '#3a6a4a', '#c8a050', '#7a6a5a', '#5a3a6a'];
    const roofTb = new TriBatch(), skyTb = new TriBatch();
    const sheet = [new THREE.Color(0xb7ad98), new THREE.Color(0xa99f8a), new THREE.Color(0xc2b8a2)];
    const skyC = new THREE.Color(0xf4f6f2);
    let signIdx = 0, plateIdx = 0, vertIdx = 0;
    for (const road of ARCADE_ROADS) {
      const hw = road.width / 2;
      const s = samplePath(road.pts, 2);
      const W = hw + 1.2;
      // 屋根：両わきはトタン（下から見ると、さびの浮いた鉄板）、まん中は明かり取りの半透明パネル
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        const ya = terrainY(a.x, a.z) + 7, yb = terrainY(b.x, b.z) + 7;
        const na = { x: -Math.sin(a.angle), z: Math.cos(a.angle) }, nb = { x: -Math.sin(b.angle), z: Math.cos(b.angle) };
        const P = (q, n, y, t, sd) => [q.x + n.x * W * t * sd, y + 0.9 * (1 - t), q.z + n.z * W * t * sd];
        const sc = sheet[i % 3];
        for (const sd of [-1, 1]) {
          roofTb.quad(P(a, na, ya, 1, sd), P(b, nb, yb, 1, sd), P(b, nb, yb, 0.5, sd), P(a, na, ya, 0.5, sd), sc, [0, 0, 2, 0, 2, 1.2, 0, 1.2]);
          skyTb.quad(P(a, na, ya, 0.5, sd), P(b, nb, yb, 0.5, sd), P(b, nb, yb, 0, sd), P(a, na, ya, 0, sd), skyC);
        }
        const segLen = Math.hypot(b.x - a.x, b.z - a.z) + 0.05;
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (ya + yb) / 2;
        // 母屋（屋根の下を通りにそって走る細い鉄骨）
        for (const t of [-1, -0.5, 0, 0.5, 1]) {
          ribs.push({ x: mx + na.x * W * t, y: my + 0.9 * (1 - Math.abs(t)) - 0.08, z: mz + na.z * W * t, sx: segLen, sy: 0.08, sz: 0.08, ry: -a.angle, color: '#4a4c50' });
        }
        // 4m ごとのトラス：水平の梁と、まん中の束、斜めの材
        if (i % 2 === 0) {
          ribs.push({ x: a.x, y: ya - 0.45, z: a.z, sx: 0.1, sy: 0.12, sz: W * 2, ry: -a.angle, color: '#3e4044' });
          ribs.push({ x: a.x, y: ya + 0.2, z: a.z, sx: 0.08, sy: 1.3, sz: 0.08, ry: -a.angle, color: '#3e4044' });
          for (const sd of [-1, 1]) {
            ribs.push({ x: a.x + na.x * W * 0.5 * sd, y: ya + 0.02, z: a.z + na.z * W * 0.5 * sd, sx: 0.07, sy: 0.07, sz: W * 1.04, ry: -a.angle, rx: sd * 0.42, color: '#3e4044' });
          }
        }
        // 吊りランプ（傘つき）。梁から細い吊り棒で
        if (i % 4 === 1) {
          lamps.push({ x: a.x, y: ya - 1.5, z: a.z });
          shades.push({ x: a.x, y: ya - 1.32, z: a.z, sx: 0.5, sy: 0.32, sz: 0.5 });
          ribs.push({ x: a.x, y: ya - 0.85, z: a.z, sx: 0.03, sy: 0.9, sz: 0.03, color: '#2a2a2c' });
        }
      }
      // 両側の店先（約6.5m ごと）。決まった場所はパン屋とラーメン屋にする
      const specials = (SPECIAL_SHOPS[road.name] || []).map((sp) => ({ ...sp }));
      for (const side of [-1, 1]) {
        const shops = samplePath(road.pts, 6.5);
        for (let i = 0; i < shops.length - 1; i++) {
          const p = shops[i];
          const frac = i / Math.max(1, shops.length - 2);
          const nx = -Math.sin(p.angle) * side, nz = Math.cos(p.angle) * side;   // 通りの外向き
          const off = hw + 0.35;
          const fx = p.x + nx * off, fz = p.z + nz * off;
          // 店の間口と奥行きのどこかに路地・横道がかかるなら、そこは空けて通れるようにする
          const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
          let blocked = false;
          for (const t of [-3.1, -1.5, 0, 1.5, 3.1]) {
            for (const d of [0.8, 3, 6, 8.5]) {
              const r0 = nearAnyRoad(fx + nx * d + ca * t, fz + nz * d + sa * t, 0.2);
              if (r0 && !r0.covered) { blocked = true; break; }
            }
            if (blocked) break;
          }
          if (blocked) continue;
          const gy = groundY(fx, fz);
          // 通りを向く面：法線 = -(外向き) → 横ベクトル r = (nz, -nx)·(-1)
          const rx = -nz, rz = nx;
          const warm = 0.85 + r() * 0.15;
          const sp = specials.find((q) => q.side === side && !q.done && frac >= q.f);
          // 昼でもシャッターを下ろしたままの店がある（決まった店は開いている）
          const closed = !sp && r() < 0.38;
          const shY = gy + 3.85, shTop = terrainY(p.x, p.z) + 6.95;
          // 店先の上：さびたトタン張りの壁
          tin.addOriented(fx - nx * 0.04, (shY + shTop) / 2, fz - nz * 0.04, rx, rz, 6.4, shTop - shY, [0, 0, 6.4 / 1.6, (shTop - shY) / 1.6], [0.85 + r() * 0.15, 0.82 + r() * 0.12, 0.78 + r() * 0.1]);
          if (closed) {
            const tint = [[0.75, 0.78, 0.74], [0.62, 0.68, 0.6], [0.8, 0.8, 0.8], [0.7, 0.74, 0.78]][Math.floor(r() * 4)];
            shutters.addOriented(fx - nx * 0.05, gy + 1.4, fz - nz * 0.05, rx, rz, 5.4, 2.8, [0, 0, 1, 1], tint);
            cases.push({ x: fx - nx * 0.2, y: gy + 2.95, z: fz - nz * 0.2, sx: 5.6, sy: 0.32, sz: 0.36, ry: -p.angle, color: '#7c8078' });
          } else {
            // ガラス戸ごしの店の中（棚と品物）。サッシの縦の桟と、上の欄間
            const kind = Math.floor(r() * SHOP_INTERIOR_KINDS);
            const tone = 0.82 + r() * 0.18;
            glassDay.addOriented(fx - nx * 0.02, gy + 1.35, fz - nz * 0.02, rx, rz, 5.2, 2.3, interior.uv(kind), [tone, tone * 0.97, tone * 0.93]);
            for (const t of [-2.6, -1.3, 0, 1.3, 2.6]) cases.push({ x: fx - nx * 0.05 + ca * t, y: gy + 1.35, z: fz - nz * 0.05 + sa * t, sx: 0.07, sy: 2.3, sz: 0.06, ry: -p.angle, color: '#3a3a36' });
            cases.push({ x: fx - nx * 0.05, y: gy + 2.5, z: fz - nz * 0.05, sx: 5.3, sy: 0.08, sz: 0.07, ry: -p.angle, color: '#3a3a36' });
            // 店先に出した品物（八百屋のひな壇、ワゴンや台に並べた品）
            if (!sp && r() < 0.55) {
              const d = kind === 0 ? 0.75 : 0.6;
              const bx = fx - nx * d, bz = fz - nz * d;
              const w = kind === 0 ? 4 : 1.6 + r() * 0.8;
              const t0 = kind === 0 ? 0 : (r() - 0.5) * 2.4;
              const cx = bx + ca * t0, cz = bz + sa * t0;
              const th = kind === 0 ? 0.8 : 0.72;
              cases.push({ x: cx, y: gy + th / 2, z: cz, sx: w, sy: th, sz: kind === 0 ? 0.9 : 0.6, ry: -p.angle, color: kind === 0 ? '#7a5a36' : r() < 0.5 ? '#8a6a4a' : '#b8b4aa' });
              const goods = kind === 0 ? ['#e0662a', '#3a8a3a', '#c8302a', '#f0b020', '#88b040', '#f08a1c'] : kind === 6 ? ['#e04a6a', '#f0c020', '#5ab0e0', '#70c050'] : kind === 5 ? ['#e8dcc0', '#2e3a5a', '#c89a3a', '#6a6a3a'] : ['#c84a3a', '#e8c050', '#4a7ab0', '#e8e0d0', '#7aa04a', '#a0a4a8'];
              const n = Math.round(w / 0.42);
              for (let k2 = 0; k2 < n; k2++) {
                const u = -w / 2 + 0.25 + (k2 * (w - 0.5)) / Math.max(1, n - 1);
                const gh = kind === 0 ? 0.16 : 0.12 + r() * 0.18;
                cases.push({ x: cx + ca * u - nx * (r() - 0.5) * 0.2, y: gy + th + gh / 2, z: cz + sa * u - nz * (r() - 0.5) * 0.2, sx: 0.32, sy: gh, sz: kind === 0 ? 0.5 : 0.3, ry: -p.angle, color: goods[Math.floor(r() * goods.length)] });
              }
              // 立て看板
              if (r() < 0.35) {
                const t1 = t0 + (t0 > 0 ? -1 : 1) * (w / 2 + 0.6);
                cases.push({ x: bx - nx * 0.5 + ca * t1, y: gy + 0.45, z: bz - nz * 0.5 + sa * t1, sx: 0.5, sy: 0.9, sz: 0.05, ry: -p.angle + Math.PI / 2, color: r() < 0.5 ? '#2a2a28' : '#f2efe6' });
              }
            }
            glassNight.addOriented(fx - nx * 0.04, gy + 1.35, fz - nz * 0.04, rx, rz, 5.2, 2.3, interior.uv(kind), [warm, 0.86 * warm, 0.66 * warm]);
            if (!sp && r() < 0.45) awnings.push({ x: fx - nx * 0.5, y: gy + 2.75, z: fz - nz * 0.5, sx: 5.6, sy: 0.07, sz: 0.95, ry: -p.angle, rx: side * 0.35, color: awningColors[Math.floor(r() * awningColors.length)] });
            // 鉢植え
            if (!sp && r() < 0.3) {
              const t = (r() - 0.5) * 4;
              const px = fx - nx * 0.45 + ca * t, pz = fz - nz * 0.45 + sa * t;
              pots.push({ x: px, y: gy + 0.17, z: pz, sx: 0.36, sy: 0.34, sz: 0.36, color: '#b0563a' });
              plants.push({ x: px, y: gy + 0.5, z: pz, sx: 0.46, sy: 0.4, sz: 0.46, color: r() < 0.3 ? '#c8507a' : '#3e6e34' });
            }
          }
          if (sp) {
            sp.done = true;
            this._specialShop(sp, p, fx, fz, gy, nx, nz, hw);
          } else {
            signs.addOriented(fx - nx * 0.06, gy + 3.35, fz - nz * 0.06, rx, rz, 3.3, 0.82, atlas.uv(signIdx++));
          }
          const h = 5.5 + r() * 5;
          fronts.push({ x: fx + nx * 4, y: gy + h / 2 - 1, z: fz + nz * 4, sx: 6.3, sy: h + 2, sz: 8, ry: -p.angle, color: facadeColors[Math.floor(r() * facadeColors.length)] });
          // 店の上の室外機（トタンの壁にとりつけ、ドレンの管が下へ）
          if (r() < 0.4) {
            const t = (r() - 0.5) * 3.6, ay = gy + 4.3 + r() * 1.6;
            const axx = fx - nx * 0.2 + ca * t, azz = fz - nz * 0.2 + sa * t;
            cases.push({ x: axx, y: ay, z: azz, sx: 0.82, sy: 0.6, sz: 0.3, ry: -p.angle, color: '#dcdad2' });
            cases.push({ x: axx - nx * 0.16 + ca * 0.12, y: ay, z: azz - nz * 0.16 + sa * 0.12, sx: 0.44, sy: 0.44, sz: 0.02, ry: -p.angle, color: '#5a5a58' });
            cases.push({ x: axx - ca * 0.3, y: ay - 0.4, z: azz - sa * 0.3, sx: 0.05, sy: 0.25, sz: 0.05, color: '#c8c4b8' });
            pipes.push({ x: axx + ca * 0.36, y: (ay + gy) / 2, z: azz + sa * 0.36, sx: 0.35, sy: ay - gy, sz: 0.35, color: '#e6e2d6' });
          }
          if (!sp) {
            // 店先のこまごましたもの：自転車、積んだコンテナ、バケツ
            const roll2 = r();
            if (roll2 < 0.12) {
              const t = (r() - 0.5) * 4, bx = fx - nx * 0.55 + ca * t, bz = fz - nz * 0.55 + sa * t;
              const col = ['#c8302a', '#2a5aa8', '#3a3a3a', '#e8e4dc'][Math.floor(r() * 4)];
              cases.push({ x: bx, y: gy + 0.62, z: bz, sx: 1.05, sy: 0.05, sz: 0.05, ry: -p.angle, rz: 0.12, color: col });
              cases.push({ x: bx + ca * 0.25, y: gy + 0.5, z: bz + sa * 0.25, sx: 0.05, sy: 0.5, sz: 0.05, ry: -p.angle, color: col });
              cases.push({ x: bx - ca * 0.42, y: gy + 0.85, z: bz - sa * 0.42, sx: 0.06, sy: 0.06, sz: 0.5, ry: -p.angle, color: '#222' });
              for (const w of [-0.5, 0.5]) wheels.push({ x: bx + ca * w, y: gy + 0.34, z: bz + sa * w, sx: 0.68, sy: 0.68, sz: 0.68, ry: -p.angle, color: '#1e1e20' });
            } else if (roll2 < 0.3) {
              const t = (r() - 0.5) * 4, bx = fx - nx * 0.5 + ca * t, bz = fz - nz * 0.5 + sa * t;
              for (let k = 0; k < 1 + Math.floor(r() * 3); k++) cases.push({ x: bx + (r() - 0.5) * 0.06, y: gy + 0.16 + k * 0.32, z: bz, sx: 0.6, sy: 0.3, sz: 0.42, ry: -p.angle + (r() - 0.5) * 0.2, color: ['#2a6ab8', '#e8c030', '#3a8a5a'][Math.floor(r() * 3)] });
              if (r() < 0.5) cases.push({ x: bx + ca * 0.7, y: gy + 0.15, z: bz + sa * 0.7, sx: 0.3, sy: 0.3, sz: 0.3, color: '#3a9ad8' });
            }
            // 住所の板（茶色）と、黄色い縦長の看板
            if (r() < 0.1) cases.push({ x: fx - nx * 0.07 + ca * 3.05, y: gy + 1.7, z: fz - nz * 0.07 + sa * 3.05, sx: 0.16, sy: 0.5, sz: 0.02, ry: -p.angle, color: '#6a3a24' });
          }
          // 通りに張り出す看板（通りの向きから読める、両面）
          const roll = r();
          if (roll < 0.42) {
            const w = Math.min(2.3, hw * 0.75), hgt = w * 0.25;
            const cx = fx - nx * (0.25 + w / 2), cz = fz - nz * (0.25 + w / 2), cy = gy + 4.35 + r() * 0.8;
            const t = (r() - 0.5) * 3;
            const uv = retro.plate(plateIdx++);
            retroSigns.addOriented(cx + ca * (t + side * 0.03), cy, cz + sa * (t + side * 0.03), -nx, -nz, w, hgt, uv);
            retroSigns.addOriented(cx + ca * (t - side * 0.03), cy, cz + sa * (t - side * 0.03), nx, nz, w, hgt, uv);
            cases.push({ x: cx + ca * t, y: cy, z: cz + sa * t, sx: 0.05, sy: hgt + 0.04, sz: w + 0.04, ry: -p.angle, color: '#5a554c' });
            ribs.push({ x: cx + ca * t, y: cy + hgt / 2 + 0.06, z: cz + sa * t, sx: 0.04, sy: 0.04, sz: w + 0.25, ry: -p.angle, color: '#2a2a2c' });
          } else if (roll < 0.7) {
            // 縦長の電飾看板（箱の両面に文字）
            const hgt = 2.2 + r() * 0.6, w = 0.42;
            const cx = fx - nx * 0.48, cz = fz - nz * 0.48, cy = gy + 3.15 + hgt / 2;
            const t = (r() - 0.5) * 3.6;
            const uv = retro.vertical(vertIdx++);
            retroSigns.addOriented(cx + ca * (t + side * 0.11), cy, cz + sa * (t + side * 0.11), -nx, -nz, w, hgt, uv);
            retroSigns.addOriented(cx + ca * (t - side * 0.11), cy, cz + sa * (t - side * 0.11), nx, nz, w, hgt, uv);
            cases.push({ x: cx + ca * t, y: cy, z: cz + sa * t, sx: 0.2, sy: hgt + 0.08, sz: w + 0.06, ry: -p.angle, color: '#8a8478' });
          } else if (roll < 0.82) {
            // のぼり旗（竿と、縦長の布）
            const t = (r() - 0.5) * 4;
            const bx = fx - nx * 0.7 + ca * t, bz = fz - nz * 0.7 + sa * t;
            pipes.push({ x: bx, y: gy + 1.45, z: bz, sx: 0.5, sy: 2.9, sz: 0.5, color: '#d8d8d8' });
            const uv = retro.vertical(vertIdx++);
            retroSigns.addOriented(bx - nx * 0.28 + ca * side * 0.02, gy + 1.75, bz - nz * 0.28 + sa * side * 0.02, -nx, -nz, 0.5, 2.0, uv, [1, 0.92, 0.92]);
            retroSigns.addOriented(bx - nx * 0.28 - ca * side * 0.02, gy + 1.75, bz - nz * 0.28 - sa * side * 0.02, nx, nz, 0.5, 2.0, uv, [1, 0.92, 0.92]);
          }
          // 店と店のさかい：雨どい（青みがかった灰色）や、根もとを赤く塗った柱
          if (r() < 0.55) {
            const ex = fx - nx * 0.16 + ca * 3.2, ez = fz - nz * 0.16 + sa * 3.2;
            const post = r() < 0.4;
            const top = shTop - gy;
            pipes.push({ x: ex, y: gy + top / 2, z: ez, sx: post ? 1.6 : 0.9, sy: top, sz: post ? 1.6 : 0.9, color: post ? '#d6d0bc' : '#8e9db0' });
            if (post || r() < 0.4) pipes.push({ x: ex, y: gy + 0.3, z: ez, sx: post ? 1.9 : 1.1, sy: 0.6, sz: post ? 1.9 : 1.1, color: '#a8322a' });
          }
        }
      }
      // 通りの名前の吊り看板（両端）
      if (road.name) {
        for (const f of [0.02, 0.98]) {
          const q = samplePath(road.pts, 1);
          const p = q[Math.floor(f * (q.length - 1))];
          // 入口の標識：車両進入禁止（自動二輪をのぞく）と高さ制限、通りの名を刻んだ石柱
          {
            const nx2 = -Math.sin(p.angle), nz2 = Math.cos(p.angle);
            const sx2 = p.x + nx2 * (hw - 0.3), sz2 = p.z + nz2 * (hw - 0.3), y2 = groundY(sx2, sz2);
            const face = f < 0.5 ? -p.angle + Math.PI / 2 : -p.angle - Math.PI / 2;
            ribs.push({ x: sx2, y: y2 + 1.3, z: sz2, sx: 0.06, sy: 2.6, sz: 0.06, color: '#8a8e90' });
            const signG = new THREE.Group();
            signG.position.set(sx2, y2, sz2);
            signG.rotation.y = face;
            const disc = (y, tex) => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), new THREE.MeshBasicMaterial({ map: tex })); m.position.set(0, y, 0.05); signG.add(m); };
            disc(2.35, this._signTex = this._signTex || canvasTexture(128, 128, (g2) => { g2.fillStyle = '#fff'; g2.beginPath(); g2.arc(64, 64, 62, 0, 7); g2.fill(); g2.strokeStyle = '#c8202a'; g2.lineWidth = 14; g2.beginPath(); g2.arc(64, 64, 52, 0, 7); g2.stroke(); g2.beginPath(); g2.moveTo(28, 28); g2.lineTo(100, 100); g2.stroke(); }));
            disc(1.5, this._heightTex = this._heightTex || canvasTexture(128, 128, (g2) => { g2.fillStyle = '#fff'; g2.beginPath(); g2.arc(64, 64, 62, 0, 7); g2.fill(); g2.strokeStyle = '#c8202a'; g2.lineWidth = 12; g2.beginPath(); g2.arc(64, 64, 54, 0, 7); g2.stroke(); g2.fillStyle = '#1e3a8a'; g2.font = 'bold 48px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('2.3', 64, 68); }));
            const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.32), new THREE.MeshBasicMaterial({ map: labelTexture('自動車　自動2輪車を除く', { w: 256, h: 128, size: 22, bg: '#ffffff', fg: '#222222' }) }));
            plate.position.set(0, 1.9, 0.05);
            signG.add(plate);
            this.group.add(signG);
            const px2 = p.x - nx2 * (hw - 0.3), pz2 = p.z - nz2 * (hw - 0.3), py2 = groundY(px2, pz2);
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.4, 0.32), [lam(0x9a958a), lam(0x9a958a), lam(0x9a958a), lam(0x9a958a), new THREE.MeshLambertMaterial({ map: labelTexture(road.name + '通り', { w: 128, h: 512, size: Math.min(80, 420 / (road.name.length + 2)), bg: '#9a958a', fg: '#2a2622', vertical: true }) }), lam(0x9a958a)]);
            pillar.position.set(px2, py2 + 0.7, pz2);
            pillar.rotation.y = face;
            this.group.add(pillar);
          }
          const tex = labelTexture(road.name, { w: 1024, h: 160, size: 96, bg: '#2a2622', fg: '#f3e6c8' });
          for (const flip of [0, Math.PI]) {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 0.8), new THREE.MeshBasicMaterial({ map: tex }));
            m.position.set(p.x, terrainY(p.x, p.z) + 6, p.z);
            m.rotation.y = -p.angle + Math.PI / 2 + flip;
            m.translateZ(0.02);
            this.group.add(m);
          }
        }
      }
    }
    const tinTex = arcadeTinTexture(), shutterTex = shutterTexture();
    const roof = new THREE.Mesh(roofTb.build(), lam(0xffffff, { vertexColors: true, map: tinTex, side: THREE.DoubleSide }));
    roof.castShadow = roof.receiveShadow = true;
    this.group.add(roof);
    // 明かり取り：昼は空の光でほんのり白く光る
    this.skylightMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false, emissive: 0xfffaf0, emissiveIntensity: 0.5 });
    // 上から（坂の上や空き家の窓から）見ると、光らない灰色の波板に見える
    this.skylightMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vSkyWY;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvSkyWY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSkyWY;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat skyAbove = step(vSkyWY, cameraPosition.y);\ntotalEmissiveRadiance *= 1.0 - skyAbove;\ndiffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.66, 0.68), skyAbove);\ndiffuseColor.a = mix(diffuseColor.a, 0.95, skyAbove);');
    };
    this.group.add(new THREE.Mesh(skyTb.build(), this.skylightMat));
    this.group.add(instancedBoxes(ribs, lam(0xffffff), { receive: false }));
    this.group.add(instancedBoxes(fronts, lam(0xffffff)));
    this.group.add(instancedBoxes(awnings, lam(0xffffff, { side: THREE.DoubleSide }), { receive: false }));
    this.group.add(instancedBoxes(cases, lam(0xffffff), { receive: false }));
    if (wheels.length) this.group.add(instancedBoxes(wheels, lam(0xffffff), { receive: false, geo: new THREE.TorusGeometry(0.5, 0.06, 6, 14) }));
    this.group.add(instancedBoxes(pipes, lam(0xffffff), { receive: false, geo: new THREE.CylinderGeometry(0.07, 0.07, 1, 8) }));
    this.group.add(instancedBoxes(pots, lam(0xffffff), { geo: new THREE.CylinderGeometry(0.5, 0.38, 1, 10) }));
    this.group.add(instancedBoxes(plants, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(0.6, 0) }));
    this.group.add(new THREE.Mesh(tin.build(), lam(0xffffff, { vertexColors: true, map: tinTex })));
    this.group.add(new THREE.Mesh(shutters.build(), lam(0xffffff, { vertexColors: true, map: shutterTex })));
    // 店の中は電灯で明るいので、日陰のアーケードでも少し光って見える
    this.group.add(new THREE.Mesh(glassDay.build(), lam(0xffffff, { vertexColors: true, map: interior.tex, emissive: 0xffffff, emissiveMap: interior.tex, emissiveIntensity: 0.22 })));
    // 夜は、電灯のついた店の中がガラス戸ごしに見える
    const nightMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: interior.tex, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new THREE.Mesh(glassNight.build(), nightMat));
    this.nightMats.push({ mat: nightMat, max: 0.95 });
    this.signMat = new THREE.MeshLambertMaterial({ map: atlas.tex, emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.15 });
    this.group.add(new THREE.Mesh(signs.build(), this.signMat));
    // 吊り看板・電飾看板：夜は内側から灯る
    const retroMat = new THREE.MeshLambertMaterial({ map: retro.tex, vertexColors: true, emissive: 0xffffff, emissiveMap: retro.tex, emissiveIntensity: 0.2 });
    this.specialSignMats.push(retroMat);
    this.group.add(new THREE.Mesh(retroSigns.build(), retroMat));
    this.arcadeLampMat = new THREE.MeshBasicMaterial({ color: 0xffcf98 });
    this.group.add(instancedBoxes(lamps.map((l) => ({ ...l, sx: 0.32, sy: 0.32, sz: 0.32 })), this.arcadeLampMat, { cast: false, receive: false, geo: new THREE.SphereGeometry(0.5, 10, 8) }));
    this.group.add(instancedBoxes(shades, lam(0xe8e4dc, { side: THREE.DoubleSide }), { cast: false, receive: false, geo: new THREE.CylinderGeometry(0.12, 0.5, 1, 12, 1, true) }));
    lamps.forEach((l, i) => { if (i % 2 === 0) this.lampPositions.push([l.x, l.y - 0.2, l.z]); });
  }

  /** パン屋・ラーメン屋の店構え（看板・のれん・ショーケース）と、立ち寄れる場所 */
  _specialShop(sp, p, fx, fz, gy, nx, nz, hw) {
    const yaw = -p.angle + (nz * Math.cos(p.angle) - nx * Math.sin(p.angle) > 0 ? Math.PI : 0);
    const face = Math.atan2(-nx, -nz); // 通りに向いた面の向き
    const g = new THREE.Group();
    g.position.set(fx - nx * 0.08, gy, fz - nz * 0.08);
    g.rotation.y = face;
    const ramen = sp.type === 'ramen';
    const kama = sp.type === 'kamaboko';
    const cafe = sp.type === 'cafe';
    const sweets = sp.type === 'sweets';
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshLambertMaterial({
      map: labelTexture(sp.name, { w: 640, h: 160, size: 84, bg: ramen ? '#7a1e18' : kama ? '#f6f2ea' : cafe ? '#2a1c14' : sweets ? '#2e3a44' : '#f4ead2', fg: ramen ? '#fbeedc' : kama ? '#1e3a5e' : cafe ? '#e8d2a8' : sweets ? '#f4e6c8' : '#5a3a1a' }),
      emissive: 0xffffff, emissiveIntensity: 0.2,
    }));
    sign.position.set(0, 3.35, 0.02);
    sign.material.emissiveMap = sign.material.map;
    this.specialSignMats.push(sign.material);
    g.add(sign);
    if (ramen) {
      // 赤いのれん（3枚）
      const tex = labelTexture('ら ー め ん', { w: 512, h: 128, size: 72, bg: '#a82a22', fg: '#fff4e4' });
      const noren = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      noren.position.set(0, 2.15, 0.25);
      g.add(noren);
      // 赤ちょうちん
      for (const x of [-1.9, 1.9]) {
        const lan = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshLambertMaterial({ color: 0xd8402e, emissive: 0xff5a30, emissiveIntensity: 0.3 }));
        lan.scale.y = 1.3;
        lan.position.set(x, 2.5, 0.35);
        this.specialSignMats.push(lan.material);
        g.add(lan);
      }
    } else if (cafe && sp.style === 'bath') {
      // 大和湯：むかしの銭湯の正面。下は豆タイル、入口の上に唐破風（そりあがった屋根）、紺ののれん「ゆ」
      sign.position.y = 4.25;   // 屋号は唐破風の上に
      const tile = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.1, 0.12), lam(0x6a8a8a));
      tile.position.set(0, 0.55, 0.08);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.9, 0.1), lam(0xe8e0cc));
      wall.position.set(0, 2.05, 0.06);
      g.add(tile, wall);
      for (const x of [-2.75, 2.75]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 0.2), lam(0x4a3324)); post.position.set(x, 1.5, 0.2); g.add(post); }
      const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.1), new THREE.MeshLambertMaterial({ color: 0x5a4030, emissive: 0xffb060, emissiveIntensity: 0.3 }));
      door.position.set(0, 1.05, 0.15);
      this.specialSignMats.push(door.material);
      g.add(door);
      const noren = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.85), new THREE.MeshLambertMaterial({ map: labelTexture('ゆ', { w: 256, h: 96, size: 80, bg: '#24406a', fg: '#f6f2ea' }), side: THREE.DoubleSide }));
      noren.position.set(0, 1.75, 0.3);
      g.add(noren);
      // 唐破風：前へ張り出した、まんなかが盛りあがる屋根（瓦は銀ねず）
      const roofM = lam(0x4e545c);
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.4, 16, 1, true, -Math.PI / 2, Math.PI), new THREE.MeshLambertMaterial({ color: 0x4e545c, side: THREE.DoubleSide }));
      arch.rotation.x = -Math.PI / 2;
      arch.scale.set(1, 1, 0.42);   // 低くそらせる
      arch.position.set(0, 2.95, 0.6);
      g.add(arch);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 1.4), roofM);
      ridge.position.set(0, 3.72, 0.6);
      g.add(ridge);
      const gable = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 1.4), lam(0x5a3e2c));
      gable.position.set(0, 2.85, 0.6);
      g.add(gable);
    } else if (cafe) {
      // 喫茶店：濃い木の扉と、あたたかい灯りの窓
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.2, 0.1), lam(0x4a2e1e));
      door.position.set(1.4, 1.1, 0.12);
      g.add(door);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), new THREE.MeshLambertMaterial({ color: 0x6a5040, emissive: 0xffb060, emissiveIntensity: 0.3 }));
      win.position.set(-0.9, 1.45, 0.13);
      this.specialSignMats.push(win.material);
      g.add(win);
      const awn = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.06, 1.0), lam(0x3a2a20, { side: THREE.DoubleSide }));
      awn.position.set(0, 2.7, 0.5);
      awn.rotation.x = 0.35;
      g.add(awn);
    } else if (sweets) {
      // 白いショーケースに、小さな瓶のプリン（茶色のふた、赤い帯）。紺のひさし
      const caseBox = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.6), lam(0xf4efe6));
      caseBox.position.set(-0.8, 0.45, 0.35);
      g.add(caseBox);
      const jarMat = new THREE.MeshLambertMaterial({ color: 0xf2d58a }), lid = lam(0x6a3f22), band = lam(0xc8302a);
      for (let k = 0; k < 8; k++) {
        const x = -1.85 + (k % 4) * 0.7, z = 0.25 + Math.floor(k / 4) * 0.22;
        const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.15, 10), jarMat);
        jar.position.set(x, 0.98, z);
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 10), lid);
        l.position.set(x, 1.07, z);
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.03, 10), band);
        b.position.set(x, 0.96, z);
        g.add(jar, l, b);
      }
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.9), new THREE.MeshLambertMaterial({ color: 0x9ab0b8, emissive: 0xffc888, emissiveIntensity: 0.3 }));
      win.position.set(1.5, 1.15, 0.13);
      this.specialSignMats.push(win.material);
      g.add(win);
      const awn = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.06, 1.0), lam(0x2e3a44, { side: THREE.DoubleSide }));
      awn.position.set(0, 2.7, 0.5);
      awn.rotation.x = 0.35;
      g.add(awn);
    } else if (kama) {
      // 紺ののれんと、紅白のかまぼこが並ぶショーケース
      const tex = labelTexture('か ま ぼ こ', { w: 512, h: 128, size: 72, bg: '#1e3a5e', fg: '#f6f2ea' });
      const noren = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      noren.position.set(0, 2.15, 0.25);
      g.add(noren);
      const caseBox = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.95, 0.6), lam(0xe8e4dc));
      caseBox.position.set(0, 0.48, 0.35);
      g.add(caseBox);
      const pink = lam(0xe88a9a), white = lam(0xf6f2ea), gold = lam(0xc8903e);
      for (let k = 0; k < 9; k++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.14), k % 3 === 2 ? gold : k % 2 ? white : pink);
        m.position.set(-1.1 + (k % 5) * 0.55, 1.0, 0.25 + Math.floor(k / 5) * 0.22);
        g.add(m);
      }
    } else {
      // パンの並んだショーケース
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.5), lam(0x8a6a4a));
      shelf.position.set(-0.6, 0.45, 0.3);
      g.add(shelf);
      const breadMat = lam(0xd09a52);
      for (let k = 0; k < 10; k++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.09 + this.r() * 0.04, 10, 8), breadMat);
        b.scale.y = 0.6;
        b.position.set(-1.6 + (k % 5) * 0.45, 0.95, 0.15 + Math.floor(k / 5) * 0.25);
        g.add(b);
      }
      const awn = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.06, 1.0), lam(0xf0e2c0, { side: THREE.DoubleSide }));
      awn.position.set(0, 2.7, 0.5);
      awn.rotation.x = 0.35;
      g.add(awn);
    }
    this.group.add(g);
    // 立ち寄る場所：店の前の通りの上
    const sx = p.x + nx * (hw - 0.9), sz = p.z + nz * (hw - 0.9);
    this.interactables.push({ type: sp.type, menu: sp.menu, name: sp.name, x: sx, z: sz, yaw: Math.atan2(-nx, -nz), radius: 2.4 });
    void yaw;
  }

  /** アーケードの外の、ひとつ建ちの小さなお店（坂の途中のパン屋、駅前のおやつの店） */
  _streetShops() {
    for (const sh of STREET_SHOPS) {
      const tx = Math.cos(sh.ang), tz = Math.sin(sh.ang);
      // 店先の床の高さ（坂でも水平に、低いほうは土台で埋める）
      let floor = -Infinity, low = Infinity;
      for (const u of [-2.3, 0, 2.3]) for (const v of [0, 2, 4]) {
        const y = groundY(sh.fx + tx * u + sh.nx * v, sh.fz + tz * u + sh.nz * v);
        low = Math.min(low, y);
        if (v === 0) floor = Math.max(floor, y);
      }
      floor += 0.05;
      const face = Math.atan2(-sh.nx, -sh.nz); // 正面（+z）が道を向く
      const g = new THREE.Group();
      g.position.set(sh.x, floor, sh.z);
      g.rotation.y = face;
      const sweets = sh.style === 'sweets';
      const wallC = sweets ? 0xf4efe6 : 0xd9c7a6, roofC = sweets ? 0x5a6470 : 0x6a4a34;
      const H = sweets ? 3.4 : 2.8;
      const base = floor - low + 0.2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, H + base, 4), lam(wallC));
      body.position.set(0, (H - base) / 2, 0);
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      // 瓦屋根（片流れ）
      const roof = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 4.8), lam(roofC));
      roof.position.set(0, H + 0.25, 0.1);
      roof.rotation.x = 0.18;
      roof.castShadow = true;
      g.add(roof);
      // ガラス戸とショーケース
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.9), new THREE.MeshLambertMaterial({ color: 0x9ab0b8, emissive: 0xffc888, emissiveIntensity: 0 }));
      glass.position.set(0.5, 1.15, 2.01);
      this.specialSignMats.push(glass.material);
      g.add(glass);
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.85, 0.5), lam(0x8a6a4a));
      shelf.position.set(-1.45, 0.43, 2.25);
      g.add(shelf);
      if (sweets) {
        // 小さな瓶のプリン（茶色のふた、赤い帯）
        const glassMat = new THREE.MeshLambertMaterial({ color: 0xf2d58a }), lid = lam(0x6a3f22), band = lam(0xc8302a);
        for (let k = 0; k < 6; k++) {
          const x = -1.95 + (k % 3) * 0.25, z = 2.15 + Math.floor(k / 3) * 0.2;
          const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.13, 10), glassMat);
          jar.position.set(x, 0.92, z);
          const l = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.03, 10), lid);
          l.position.set(x, 1.0, z);
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.025, 10), band);
          b.position.set(x, 0.91, z);
          g.add(jar, l, b);
        }
      } else {
        const breadMat = lam(0xd09a52);
        for (let k = 0; k < 6; k++) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), breadMat);
          b.scale.y = 0.6;
          b.position.set(-1.95 + (k % 3) * 0.25, 0.92, 2.15 + Math.floor(k / 3) * 0.2);
          g.add(b);
        }
      }
      // 看板
      const tex = labelTexture(sh.name, { w: 640, h: 160, size: 76, bg: sweets ? '#2e3a44' : '#f4ead2', fg: sweets ? '#f4e6c8' : '#5a3a1a' });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2 }));
      sign.position.set(0, H - 0.35, 2.02);
      this.specialSignMats.push(sign.material);
      g.add(sign);
      const awn = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.05, 0.9), lam(sweets ? 0x2e3a44 : 0xb8502a, { side: THREE.DoubleSide }));
      awn.position.set(0, H - 0.95, 2.4);
      awn.rotation.x = 0.3;
      g.add(awn);
      this.group.add(g);
      this.lampPositions.push([sh.fx, floor + 2.4, sh.fz]);
      this.interactables.push({ type: sh.type, menu: sh.menu, name: sh.name, x: sh.standX, z: sh.standZ, yaw: face, radius: 2.6 });
    }
  }

  /** 自販機：海沿いのベンチの近く、渡船のりば、ロープウェイ山麓駅、駅前、家の前の石段、路地の入口 */
  _vendingMachines() {
    const spots = [];
    BENCHES.slice(0, 4).forEach((b) => spots.push([b.x + Math.sin(b.yaw) * 2.5, b.z + Math.cos(b.yaw) * 2.5]));
    FERRY_ROUTES.forEach((r) => spots.push([r.a.x, r.a.z]));
    spots.push([ROPEWAY.base.x, ROPEWAY.base.z]);
    const station = POIS.find((p) => p.n === 'JR尾道駅');
    if (station) spots.push([station.x, station.z]);
    spots.push([-14, -3]);
    ALLEYS.filter((_, i) => i % 5 === 2).forEach((a) => spots.push(a.pts[1]));
    const panel = canvasTexture(128, 256, (g, w, h) => {
      g.fillStyle = '#1c2228';
      g.fillRect(0, 0, w, h);
      const cols = ['#5a3a24', '#2a3a5a', '#f08a1c', '#3f7a3a', '#7ac8e8', '#b88a5a', '#c8302a', '#e8d040'];
      for (let row = 0; row < 3; row++) {
        g.fillStyle = '#e8eef2';
        g.fillRect(6, 14 + row * 58, w - 12, 50);
        for (let c = 0; c < 4; c++) {
          g.fillStyle = cols[(row * 4 + c) % cols.length];
          g.fillRect(12 + c * 28, 20 + row * 58, 18, 34);
          g.fillStyle = row === 0 ? '#e83a2a' : '#2a6ae8';
          g.fillRect(12 + c * 28, 57 + row * 58, 18, 4);
        }
      }
      g.fillStyle = '#0c0e10';
      g.fillRect(14, h - 50, w - 28, 30);
      g.fillStyle = '#9aa';
      g.fillRect(w - 30, 190, 12, 18);
    });
    const placed = [];
    // 置けるかどうか：舗装された道（石段・小径は石垣があるので避ける）の端の外側で、
    // 建物・海・ほかの道にかからず、足もとがほぼ平らで、前に人が立てるところ
    const tryAt = (qx, qz) => {
      const n = nearestRoad(qx, qz);
      if (!n || n.d > 30 || n.road.surface === 'stone' || n.road.covered) return null;
      const s = n.seg;
      const ang = Math.atan2(s.dz, s.dx);
      for (const side of [-1, 1]) {
        const nx = -Math.sin(ang) * side, nz = Math.cos(ang) * side;
        const x = n.px + nx * (s.half + 0.5), z = n.pz + nz * (s.half + 0.5);
        if (inBuilding(x, z) || inBuilding(x + nx * 0.5, z + nz * 0.5) || inSolid(x, z) || inSolid(x + nx * 0.5, z + nz * 0.5) || terrainY(x, z) < SEA_Y + 0.5 || nearAnyRoad(x, z, 0.05)) continue;
        // 箱の四隅の高さ（傾きが大きいところには置かない）
        const tx = Math.cos(ang), tz = Math.sin(ang);
        const ys = [];
        for (const a of [-0.5, 0.5]) for (const b of [-0.4, 0.4]) ys.push(groundY(x + tx * a + nx * b, z + tz * a + nz * b));
        if (Math.max(...ys) - Math.min(...ys) > 0.45) continue;
        if (!walkable(x - nx * 1.1, z - nz * 1.1)) continue;
        return { x, z, nx, nz, ang, y: Math.max(...ys, surfaceY(x - nx * 0.45, z - nz * 0.45)), low: Math.min(...ys) };
      }
      return null;
    };
    for (const [x0, z0] of spots) {
      // 目安の場所から、近いほうへ少しずつ探す
      let best = null;
      for (let r = 0; r <= 24 && !best; r += 3) {
        for (let k = 0; k < (r ? 8 : 1) && !best; k++) {
          const a = (k / 8) * Math.PI * 2;
          best = tryAt(x0 + Math.cos(a) * r, z0 + Math.sin(a) * r);
        }
      }
      if (!best || placed.some((p) => Math.hypot(p.x - best.x, p.z - best.z) < 25)) continue;
      placed.push(best);
      const y = best.y;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.83, 0.75), lam(VENDING_COLORS[placed.length % VENDING_COLORS.length]));
      body.position.y = 0.915;
      body.castShadow = true;
      const front = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.6), new THREE.MeshLambertMaterial({ map: panel, emissive: 0xffffff, emissiveMap: panel, emissiveIntensity: 0.25 }));
      front.position.set(0, 0.95, 0.38);
      this.vendingMats.push(front.material);
      // 低いほうの足もとが浮かないよう、コンクリートの台
      const plinthH = y - best.low + 0.15;
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.06, plinthH, 0.8), lam(0x8e8a82));
      plinth.position.y = -plinthH / 2 + 0.02;
      g.add(body, front, plinth);
      g.position.set(best.x, y, best.z);
      g.rotation.y = Math.atan2(-best.nx, -best.nz); // 正面（+z）を道へ
      this.group.add(g);
      this.lampPositions.push([best.x - best.nx * 0.5, y + 1.2, best.z - best.nz * 0.5]);
      const sx = best.x - best.nx * 1.1, sz = best.z - best.nz * 1.1;
      this.interactables.push({ type: 'vending', name: '自販機', x: sx, z: sz, yaw: Math.atan2(-best.nx, -best.nz), radius: 1.8 });
    }
  }

  // ---------- 線路・踏切 ----------
  _rails() {
    // ---- 線路：茶色いバラストの盛り土、コンクリートのまくら木、さびた茶色のレール（すべて1つにまとめる） ----
    const tb = new TriBatch();
    const rr = seededRandom('rails');
    const cTie = new THREE.Color(0x9a958c), cTieSide = new THREE.Color(0x7a766e);
    const cRail = new THREE.Color(0x6a4636), cRailTop = new THREE.Color(0xb4aca2);
    const railY = (x, z) => railGroundY(x, z) + 0.12;   // ガード下の掘り下げは含めない
    for (const rail of RAILS) {
      const s = samplePath(rail.pts, 3);
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        const na = { x: -Math.sin(a.angle), z: Math.cos(a.angle) }, nb = { x: -Math.sin(b.angle), z: Math.cos(b.angle) };
        const ya = railY(a.x, a.z), yb = railY(b.x, b.z);
        const A = (o, h) => [a.x + na.x * o, ya + h, a.z + na.z * o], B = (o, h) => [b.x + nb.x * o, yb + h, b.z + nb.z * o];
        // バラストの断面：上は平ら、両肩はなだらかに地面へ。色は少しずつむらに
        const k = 0.9 + rr() * 0.2;
        const cBal = new THREE.Color(0x7a6454).multiplyScalar(k), cBalSide = new THREE.Color(0x66574a).multiplyScalar(k);
        tb.quad(A(-1.45, 0.12), A(1.45, 0.12), B(1.45, 0.12), B(-1.45, 0.12), cBal);
        tb.quad(A(-2.2, -0.15), A(-1.45, 0.12), B(-1.45, 0.12), B(-2.2, -0.15), cBalSide);
        tb.quad(A(1.45, 0.12), A(2.2, -0.15), B(2.2, -0.15), B(1.45, 0.12), cBalSide);
        // レール：上面は車輪でみがかれて明るく、横はさびた茶色
        for (const o of [-0.535, 0.535]) {
          const w = 0.035;
          tb.quad(A(o - w, 0.34), A(o + w, 0.34), B(o + w, 0.34), B(o - w, 0.34), cRailTop);
          tb.quad(A(o - w, 0.2), A(o - w, 0.34), B(o - w, 0.34), B(o - w, 0.2), cRail);
          tb.quad(A(o + w, 0.34), A(o + w, 0.2), B(o + w, 0.2), B(o + w, 0.34), cRail);
        }
      }
      // まくら木（約0.7mおき）。上面と、前後の面だけ
      for (const p of samplePath(rail.pts, 0.7)) {
        const tx = Math.cos(p.angle) * 0.11, tz = Math.sin(p.angle) * 0.11;
        const nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        const y = railY(p.x, p.z);
        const P = (o, d, h) => [p.x + nx * o + tx * d, y + h, p.z + nz * o + tz * d];
        tb.quad(P(-1.2, -1, 0.2), P(-1.2, 1, 0.2), P(1.2, 1, 0.2), P(1.2, -1, 0.2), cTie);
        tb.quad(P(-1.2, -1, 0.12), P(-1.2, -1, 0.2), P(1.2, -1, 0.2), P(1.2, -1, 0.12), cTieSide);
        tb.quad(P(1.2, 1, 0.12), P(1.2, 1, 0.2), P(-1.2, 1, 0.2), P(-1.2, 1, 0.12), cTieSide);
      }
    }
    const trackMesh = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    trackMesh.receiveShadow = true;
    this.group.add(trackMesh);
    this._catenary(railY);
    // 踏切：警報機（黄色と黒のしま模様の柱、×の踏切警標、左右に交互に点滅する赤い灯、「とまれみよ」の板、上にスピーカー）と、
    // しま模様の遮断かん（線路と平行に、道をふさぐ向き）
    const tiger = (rx, ry) => canvasTexture(64, 64, (g2, w, h) => {
      g2.fillStyle = '#f2c81e';
      g2.fillRect(0, 0, w, h);
      g2.fillStyle = '#1e1c1a';
      for (let k = -2; k < 3; k++) { g2.beginPath(); g2.moveTo(k * 32, 0); g2.lineTo(k * 32 + 16, 0); g2.lineTo(k * 32 + 16 + 64, h); g2.lineTo(k * 32 + 64, h); g2.fill(); }
    }, { repeat: [rx, ry] });
    const M = {
      poleStripe: lam(0xffffff, { map: tiger(2, 5) }),
      pole: lam(0x3a3c40),
      cross: lam(0xffffff, { map: tiger(3, 0.4) }),
      black: lam(0x161616),
      box: lam(0xffffff, { map: tiger(1, 1) }),
      arm: lam(0xffffff, { map: tiger(10, 0.25) }),
      speaker: lam(0x9a9ea2),
      plate: new THREE.MeshLambertMaterial({ map: labelTexture('とまれみよ', { w: 256, h: 64, size: 40, bg: '#f4f2ec', fg: '#c8202a' }), side: THREE.DoubleSide }),
    };
    const G = {
      poleLow: new THREE.CylinderGeometry(0.075, 0.075, 2.0, 10),
      poleHigh: new THREE.CylinderGeometry(0.065, 0.065, 2.0, 8),
      bar: new THREE.BoxGeometry(1.15, 0.16, 0.035),
      back: new THREE.CylinderGeometry(0.24, 0.24, 0.03, 18).rotateX(Math.PI / 2),
      lens: new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14).rotateX(Math.PI / 2),
      visor: new THREE.BoxGeometry(0.28, 0.025, 0.14),
      beam: new THREE.BoxGeometry(0.9, 0.07, 0.06),
      plate: new THREE.PlaneGeometry(0.62, 0.16),
      speaker: new THREE.CylinderGeometry(0.09, 0.13, 0.16, 10),
      gear: new THREE.BoxGeometry(0.34, 0.6, 0.3),
    };
    this.crossings = CROSSINGS.map((cr) => {
      const g = new THREE.Group();
      const lights = [], arms = [];
      const ra = cr.railAngle;
      const rx = Math.cos(ra), rz = Math.sin(ra);          // 線路の向き
      const px = -rz, pz = rx;                               // 線路に直角（道の向き）
      const gy = terrainY(cr.x, cr.z);
      for (const side of [-1, 1]) {
        const ox = cr.x + px * side * 4.3 + rx * side * (cr.width / 2 + 0.6);
        const oz = cr.z + pz * side * 4.3 + rz * side * (cr.width / 2 + 0.6);
        // 警報機：正面（+Z）を、踏切に近づいてくる道のほうへ
        const post = new THREE.Group();
        post.position.set(ox, gy, oz);
        post.rotation.y = Math.atan2(side * px, side * pz);
        const low = new THREE.Mesh(G.poleLow, M.poleStripe);
        low.position.y = 1.0;
        const high = new THREE.Mesh(G.poleHigh, M.pole);
        high.position.y = 3.0;
        low.castShadow = high.castShadow = true;
        post.add(low, high);
        for (const a of [0.62, -0.62]) {
          const bar = new THREE.Mesh(G.bar, M.cross);
          bar.position.set(0, 3.45, 0.08);
          bar.rotation.z = a;
          post.add(bar);
        }
        const spk = new THREE.Mesh(G.speaker, M.speaker);
        spk.position.y = 4.05;
        post.add(spk);
        const beam = new THREE.Mesh(G.beam, M.black);
        beam.position.y = 2.6;
        post.add(beam);
        const plate = new THREE.Mesh(G.plate, M.plate);
        plate.position.set(0, 2.15, 0.08);
        post.add(plate);
        // 赤い灯：左右ひと組を、表と裏に。左右が交互に点滅する
        for (const lx of [-0.34, 0.34]) {
          const lensMat = new THREE.MeshLambertMaterial({ color: 0x5a1410, emissive: 0xff2a18, emissiveIntensity: 0 });
          for (const face of [1, -1]) {
            const back = new THREE.Mesh(G.back, M.black);
            back.position.set(lx, 2.6, face * 0.06);
            const lens = new THREE.Mesh(G.lens, lensMat);
            lens.position.set(lx, 2.6, face * 0.09);
            const visor = new THREE.Mesh(G.visor, M.black);
            visor.position.set(lx, 2.73, face * 0.14);
            post.add(back, lens, visor);
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3020, transparent: true, opacity: 0, depthWrite: false }));
            sp.position.set(lx, 2.6, face * 0.2);
            sp.scale.setScalar(0.8);
            sp.userData.lens = lensMat;
            post.add(sp);
            lights.push(sp);
          }
        }
        g.add(post);
        // 遮断機：しま模様の箱から、しま模様のさおが道をふさぐ
        const pivot = new THREE.Group();
        pivot.position.set(ox + px * side * 0.45, gy + 0.95, oz + pz * side * 0.45);
        pivot.rotation.y = -ra;
        const gear = new THREE.Mesh(G.gear, M.box);
        gear.position.y = -0.65;
        gear.castShadow = true;
        pivot.add(gear);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(cr.width + 0.6, 0.07, 0.07), M.arm);
        arm.position.x = -side * (cr.width + 0.6) / 2;
        const tilt = new THREE.Group();
        tilt.add(arm);
        pivot.add(tilt);
        tilt.userData.side = side;
        tilt.rotation.z = side * 1.45;
        g.add(pivot);
        arms.push(tilt);
      }
      this.group.add(g);
      return { ...cr, lights, arms, down: 0, rang: false };
    });
  }

  /**
   * 山陽本線の架線（電柱・はり・腕木・がいし・架線）と、山側の石垣（谷積み）。
   * 電柱はおよそ50mおきに複線の両外側へ立て、上に門形のはりを渡す。道や踏切の上には立てない
   */
  _catenary(railY) {
    const [TA, TB] = TRAIN_TRACKS;
    if (!TA) return;
    const lenA = roadLength(TA);
    const sampB = TB ? samplePath(TB, 2) : [];
    // TB 上の点と、その道のり
    const cumB = [0];
    for (let i = 1; i < sampB.length; i++) cumB.push(cumB[i - 1] + Math.hypot(sampB[i].x - sampB[i - 1].x, sampB[i].z - sampB[i - 1].z));
    const nearB = (x, z) => {
      let bi = -1, bd = 12;
      for (let i = 0; i < sampB.length; i++) { const d = Math.hypot(sampB[i].x - x, sampB[i].z - z); if (d < bd) { bd = d; bi = i; } }
      return bi < 0 ? null : { ...sampB[bi], s: cumB[bi], d: bd };
    };
    const blocked = (x, z) => nearAnyRoad(x, z, 0.7) || inBuilding(x, z) || CROSSINGS.some((c) => Math.hypot(c.x - x, c.z - z) < 12) || nearUnder(x, z);
    const spans = [];   // { a: {x,z,s}, b: 同 or null }
    const mats = { mast: [], beam: [], arm: [], ins: [] };
    const box = (list, ax, ay, az, bx, by, bz, w) => list.push({ ax, ay, az, bx, by, bz, w });
    for (let s = 20; s < lenA - 20; s += 50) {
      // 立てられる場所を、少し前後にずらしながら探す。両側に立てられれば門形、片側だけなら片持ちのはり
      let ok = null;
      for (const ds of [0, 6, -6, 12, -12]) {
        const a = pointAlong(TA, (s + ds) / lenA);
        const b = nearB(a.x, a.z);
        let n = { x: -Math.sin(a.angle), z: Math.cos(a.angle) };
        if (b && b.d > 1.5) n = { x: (b.x - a.x) / b.d, z: (b.z - a.z) / b.d };
        let mA = { x: a.x - n.x * 2.5, z: a.z - n.z * 2.5 };
        let mB = b ? { x: b.x + n.x * 2.5, z: b.z + n.z * 2.5 } : { x: a.x + n.x * 2.5, z: a.z + n.z * 2.5 };
        if (blocked(mA.x, mA.z)) mA = null;
        if (blocked(mB.x, mB.z)) mB = null;
        if (!mA && !mB) continue;
        ok = { a: { ...a, s: s + ds }, b, n, mA, mB };
        break;
      }
      if (!ok) continue;
      const { a, b, n, mA, mB } = ok;
      const top = Math.max(railY(a.x, a.z), b ? railY(b.x, b.z) : -1e9) + 7.4;
      for (const m of [mA, mB]) if (m) box(mats.mast, m.x, terrainY(m.x, m.z) - 0.3, m.z, m.x, top + 0.5, m.z, 0.32);
      // はり：門形は電柱から電柱へ、片持ちは立てた側から、反対側の線の少し先まで
      const far = b || a;
      const from = mA || mB;
      const to = mA && mB ? mB : mA ? { x: far.x + n.x * 0.8, z: far.z + n.z * 0.8 } : { x: a.x - n.x * 0.8, z: a.z - n.z * 0.8 };
      box(mats.beam, from.x, top, from.z, to.x, top, to.z, 0.24);
      // 各線の上：はりからつり下げた棒と、横の腕木、がいし
      for (const t of [a, b]) {
        if (!t) continue;
        const ty = railY(t.x, t.z);
        const m = t === a ? (mA || mB) : (mB || mA);   // 近いほうの電柱から腕木をのばす
        box(mats.arm, t.x, top, t.z, t.x, ty + 6.5, t.z, 0.07);
        box(mats.arm, m.x, ty + 5.45, m.z, t.x, ty + 5.45, t.z, 0.06);
        box(mats.ins, t.x, ty + 6.55, t.z, t.x, ty + 6.2, t.z, 0.12);
        box(mats.ins, m.x * 0.2 + t.x * 0.8, ty + 5.45, m.z * 0.2 + t.z * 0.8, m.x * 0.4 + t.x * 0.6, ty + 5.45, m.z * 0.4 + t.z * 0.6, 0.1);
      }
      spans.push({ a, b });
    }
    // 角材を、向きと長さをつけた InstancedMesh に
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const inst = (list, mat) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(unit, mat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      list.forEach((e, i) => {
        v.set(e.bx - e.ax, e.by - e.ay, e.bz - e.az);
        const L = v.length();
        q.setFromUnitVectors(up, v.normalize());
        m4.compose(new THREE.Vector3((e.ax + e.bx) / 2, (e.ay + e.by) / 2, (e.az + e.bz) / 2), q, new THREE.Vector3(e.w, L, e.w));
        mesh.setMatrixAt(i, m4);
      });
      mesh.castShadow = true;
      this.group.add(mesh);
    };
    // 電柱：鉄のトラス（格子もようの透かし）
    const lattice = canvasTexture(32, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.strokeRect(2, 0, w - 4, h);
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(2, 0); g.lineTo(w - 2, h / 2); g.lineTo(2, h); g.moveTo(w - 2, 0); g.lineTo(2, h / 2); g.lineTo(w - 2, h); g.stroke();
    }, { repeat: [1, 6] });
    inst(mats.mast, lam(0x8e9194, { map: lattice, alphaTest: 0.5, side: THREE.DoubleSide }));
    inst(mats.beam, lam(0x8e9194, { map: lattice, alphaTest: 0.5, side: THREE.DoubleSide }));
    inst(mats.arm, lam(0x9a9ca0));
    inst(mats.ins, lam(0x6a4a3a));
    // 架線：電柱と電柱のあいだで少したわむ吊架線と、まっすぐなトロリ線。ところどころにハンガー
    const seg = [];
    const wire = (pts) => { for (let i = 0; i < pts.length - 1; i++) seg.push(...pts[i], ...pts[i + 1]); };
    for (const [track, key] of [[TA, 'a'], [TB, 'b']]) {
      if (!track) continue;
      const L = roadLength(track);
      for (let k = 0; k < spans.length - 1; k++) {
        const s0 = key === 'a' ? spans[k].a.s : spans[k].b?.s, s1 = key === 'a' ? spans[k + 1].a.s : spans[k + 1].b?.s;
        if (s0 == null || s1 == null || s1 <= s0 || s1 - s0 > 120) continue;
        const mess = [], cont = [];
        const N = Math.max(4, Math.round((s1 - s0) / 6));
        for (let i = 0; i <= N; i++) {
          const f = i / N;
          const p = pointAlong(track, (s0 + (s1 - s0) * f) / L);
          const y = railY(p.x, p.z);
          mess.push([p.x, y + 6.3 - Math.sin(f * Math.PI) * 0.55, p.z]);
          cont.push([p.x, y + 5.25, p.z]);
          if (i > 0 && i < N) seg.push(p.x, y + 6.3 - Math.sin(f * Math.PI) * 0.55, p.z, p.x, y + 5.25, p.z);
        }
        wire(mess);
        wire(cont);
      }
    }
    if (seg.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      this.group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2a2a2c })));
    }

    // ---- 山側の石垣：線路の外側の地面が高く切り立っているところに、谷積み（斜めに組んだ石）の擁壁 ----
    const stone = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#5e5850';
      g.fillRect(0, 0, w, h);
      const r2 = seededRandom('tanizumi');
      const step = 32;
      for (let y = -step; y < h + step; y += step / 2) {
        for (let x = -step; x < w + step; x += step) {
          const ox = ((y / (step / 2)) % 2) * (step / 2);
          const v = 120 + Math.floor(r2() * 50);
          g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
          g.beginPath();
          const cx = x + ox, cy = y;
          g.moveTo(cx, cy - step / 2 + 2); g.lineTo(cx + step / 2 - 2, cy); g.lineTo(cx, cy + step / 2 - 2); g.lineTo(cx - step / 2 + 2, cy);
          g.closePath();
          g.fill();
        }
      }
    }, { repeat: [1, 1] });
    const wb = new TriBatch();
    const white = new THREE.Color(0xffffff), capC = new THREE.Color(0x8a857c);
    const sampA = samplePath(TA, 8);
    for (const track of [TA, TB]) {
      if (!track) continue;
      const pts = samplePath(track, 4);
      // まず各点で、壁を立てるか・高さを調べる
      const col = pts.map((p) => {
        // 複線の外側（TA は TB の反対側、TB は TA の反対側）
        let n = { x: -Math.sin(p.angle), z: Math.cos(p.angle) };
        const other = track === TA ? nearB(p.x, p.z) : null;
        if (other && other.d > 1.5) n = { x: (other.x - p.x) / other.d, z: (other.z - p.z) / other.d };
        else if (track === TB) {
          let bd = 1e9, best = null;
          for (const q of sampA) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; best = q; } }
          if (best && bd < 12 && bd > 1.5) n = { x: (p.x - best.x) / bd, z: (p.z - best.z) / bd };
        }
        const out = track === TA ? -1 : 1;
        const ox = n.x * out, oz = n.z * out;
        const wx = p.x + ox * 3.3, wz = p.z + oz * 3.3;
        const y0 = railY(p.x, p.z) - 0.2;
        const rise = Math.max(...[3.5, 5.5, 8].map((d) => terrainY(p.x + ox * d, p.z + oz * d))) - y0;
        const ok = rise > 1.8 && !nearAnyRoad(wx, wz, 1.2) && !CROSSINGS.some((c) => Math.hypot(c.x - wx, c.z - wz) < 9) && !nearUnder(wx, wz);
        return { ok, x: wx, z: wz, ox, oz, y0, rise };
      });
      // 高さはなめらかに。12m より短い切れはしは立てない
      for (let i = 0; i < col.length; i++) {
        if (!col[i].ok) continue;
        const near = [col[i - 1], col[i], col[i + 1]].filter((c) => c && c.ok);
        col[i].y1 = col[i].y0 + Math.min(9, near.reduce((a, c) => a + c.rise, 0) / near.length + 0.3);
      }
      let run = [];
      const flush = () => {
        if (run.length >= 4) {
          for (let k = 0; k < run.length - 1; k++) {
            const a = run[k], b = run[k + 1];
            const u0 = a.i * 4 / 3, u1 = b.i * 4 / 3;
            wb.quad([a.x, a.y0, a.z], [b.x, b.y0, b.z], [b.x, b.y1, b.z], [a.x, a.y1, a.z], white, [u0, a.y0 / 3, u1, b.y0 / 3, u1, b.y1 / 3, u0, a.y1 / 3]);
            // 上の笠石
            wb.quad([a.x, a.y1, a.z], [b.x, b.y1, b.z], [b.x + b.ox * 0.5, b.y1, b.z + b.oz * 0.5], [a.x + a.ox * 0.5, a.y1, a.z + a.oz * 0.5], capC);
          }
        }
        run = [];
      };
      col.forEach((c, i) => { if (c.ok) run.push({ ...c, i }); else flush(); });
      flush();
    }
    if (wb.pos.length) {
      const wall = new THREE.Mesh(wb.build(), lam(0xffffff, { map: stone, vertexColors: true, side: THREE.DoubleSide }));
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.group.add(wall);
    }
  }

  // ---------- 千光寺山ロープウェイ ----------
  _ropeway() {
    const { base, top } = ROPEWAY;
    const by = terrainY(base.x, base.z), ty = terrainY(top.x, top.z);
    // 駅舎そのものは OpenStreetMap の建物で立っているので、ここではゴンドラの乗り場の屋根だけ
    const st = (p, y) => {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 5), lam(0x7a2a22));
      roof.position.set(p.x, y + 6.2, p.z);
      roof.castShadow = true;
      this.group.add(roof);
    };
    st(base, by);
    st(top, ty);
    // 山麓駅の看板と入口：駅舎（OpenStreetMap の建物）は乗り場から西へのびている。通りに面した東と南の壁に、赤い看板
    const signMat = new THREE.MeshBasicMaterial({ map: labelTexture('千光寺山ロープウェイ', { w: 768, h: 128, size: 64, bg: '#7a2a22', fg: '#f6ead8' }) });
    const east = new THREE.Mesh(new THREE.PlaneGeometry(6, 1), signMat);
    east.position.set(base.x - 0.14, by + 5.4, base.z - 0.6);
    east.rotation.y = -Math.PI / 2;
    const south = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.25), signMat);
    south.position.set(base.x - 9, by + 5.3, base.z - 5.2);
    south.rotation.y = Math.PI;
    this.group.add(east, south);
    {
      // 入口：赤いひさし、ガラスの戸、きっぷうりばの札、時刻と運賃の掲示板、のぼり
      const items = [];
      const ex = base.x - 0.1, ez = base.z - 2.8;
      items.push({ x: ex - 0.9, y: by + 2.75, z: ez, sx: 1.9, sy: 0.14, sz: 3.6, color: '#7a2a22' });
      for (const dz of [-1.6, 1.6]) items.push({ x: ex - 1.75, y: by + 1.35, z: ez + dz, sx: 0.1, sy: 2.7, sz: 0.1, color: '#5a5f62' });
      this.group.add(instancedChunks(items, lam(0xffffff), { detail: 80 }));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.3), new THREE.MeshLambertMaterial({ color: 0x3a4a52, emissive: 0xffd8a8, emissiveIntensity: 0.25 }));
      glass.position.set(ex - 0.06, by + 1.2, ez);
      glass.rotation.y = -Math.PI / 2;
      this.specialSignMats.push(glass.material);
      const tk = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.36), new THREE.MeshBasicMaterial({ map: labelTexture('きっぷうりば', { w: 512, h: 112, size: 64, bg: '#f4efe4', fg: '#7a2a22' }) }));
      tk.position.set(ex - 0.08, by + 2.5, ez);
      tk.rotation.y = -Math.PI / 2;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), new THREE.MeshLambertMaterial({ map: canvasTexture(192, 240, (g, w, h) => {
        g.fillStyle = '#f2ede2'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#7a2a22'; g.fillRect(0, 0, w, 40);
        g.fillStyle = '#f6ead8'; g.font = '600 26px "Shippori Mincho", serif'; g.textAlign = 'center'; g.fillText('運行時刻', w / 2, 29);
        g.fillStyle = '#2a2420'; g.font = '400 18px "Shippori Mincho", serif';
        ['山麓駅 ⇄ 山頂駅', '', '9:00 〜 17:15', '15分ごとに運行'].forEach((t, i) => g.fillText(t, w / 2, 80 + i * 34));
      }) }));
      board.position.set(ex - 0.08, by + 1.35, ez + 2.6);
      board.rotation.y = -Math.PI / 2;
      this.group.add(glass, tk, board);
    }
    this.ropeA = new THREE.Vector3(base.x, by + 8.5, base.z);
    this.ropeB = new THREE.Vector3(top.x, ty + 7.5, top.z);
    // 上りと下りのゴンドラは、左右に分かれた別々の索道（すれちがってもぶつからない）
    const hx = top.x - base.x, hz = top.z - base.z, hl = Math.hypot(hx, hz);
    this.ropeSide = new THREE.Vector3(-hz / hl, 0, hx / hl).multiplyScalar(2.8);
    // 山肌にゴンドラがもぐらないよう、地面から十分に離れるまでケーブルを持ち上げる
    const N = 80;
    const deficit = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      let need = 0;
      for (const sd of [-1, 0, 1]) {
        const p = this._cableBase(t).addScaledVector(this.ropeSide, sd);
        need = Math.max(need, terrainY(p.x, p.z) + 11 - p.y);   // ゴンドラの床（ケーブルの3.3m下）が地面から8mほど上
      }
      deficit.push(Math.max(0, need));
    }
    // 持ち上げはなめらかに（どの点も、まわりの必要量から、ゆるい傾きで下がっていく包みにする）
    this.cableLift = deficit.map((_, i) => Math.max(...deficit.map((d, j) => d - Math.abs(i - j) * 0.9)));
    this.cableLift[0] = this.cableLift[N] = 0;
    const wire = new THREE.LineBasicMaterial({ color: 0x333333 });
    for (const sd of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 60; i++) pts.push(this.cablePoint(i / 60, sd));
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
    }
    // 支柱：両方のケーブルをかける腕木つき。いちばん持ち上げたあたりと、その間に
    const towerTs = [0.33, 0.66];
    const peak = this.cableLift.indexOf(Math.max(...this.cableLift)) / N;
    if (Math.max(...this.cableLift) > 1 && towerTs.every((t) => Math.abs(t - peak) > 0.12)) towerTs.push(peak);
    const steel = lam(0x8a8a88);
    for (const t of towerTs) {
      const p = this.cablePoint(t, 0);
      const gy = terrainY(p.x, p.z);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, Math.max(1, p.y - gy + 1.2), 0.8), steel);
      tower.position.set(p.x, (p.y + 0.6 + gy) / 2, p.z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 7), steel);
      arm.position.set(p.x, p.y + 0.6, p.z);
      arm.rotation.y = Math.atan2(this.ropeSide.x, this.ropeSide.z);
      tower.castShadow = true;
      this.group.add(tower, arm);
    }
    this.gondolas = [0, 0.5].map((phase) => {
      const g = new THREE.Group();
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.2), lam(0xe0e4e8));
      cab.position.y = -2.4;
      cab.castShadow = true;
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.4, 2.22), lam(0xb03a2e));
      band.position.y = -1.6;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), lam(0x333333));
      arm.position.y = -0.7;
      const simple = new THREE.Group();
      simple.add(cab, band, arm);
      g.add(simple);
      g.rotation.y = -Math.atan2(top.z - base.z, top.x - base.x);
      this.group.add(g);
      return { g, phase, simple, side: phase === 0 ? -1 : 1 };
    });
    // Blender のゴンドラ（窓の大きいクリーム色の車体に赤い帯）
    if (USE_MODELS) {
      this._swapModel('gondola', null, (g) => { g.visible = false; }).then((proto) => {
        if (!proto) return;
        this.group.remove(proto);
        for (const gd of this.gondolas) {
          const m = proto.clone();
          m.visible = true;
          gd.g.remove(gd.simple);
          gd.g.add(m);
        }
      });
    }
  }

  /** ケーブルのもとの形：駅と駅をまっすぐ結んで、少したわませる */
  _cableBase(t) {
    const p = new THREE.Vector3().lerpVectors(this.ropeA, this.ropeB, t);
    p.y -= Math.sin(t * Math.PI) * 5;
    return p;
  }

  /** ロープウェイのケーブル上の点（t=0 山麓駅、1 山頂駅）。side は左右の索道（-1 = 乗るほう、1 = もう1台） */
  cablePoint(t, side = -1) {
    const p = this._cableBase(t).addScaledVector(this.ropeSide, side);
    if (this.cableLift) {
      const f = Math.min(1, Math.max(0, t)) * (this.cableLift.length - 1), i = Math.floor(f), k = f - i;
      const a = this.cableLift[i], b = this.cableLift[Math.min(i + 1, this.cableLift.length - 1)];
      p.y += a + (b - a) * k;
    }
    return p;
  }

  /** 千光寺山の頂上の展望台（デッキ）。海側へ張り出した木のデッキと手すり */
  _summitDeck() {
    // 千光寺山頂の展望デッキ：細い白い柱に、長い板張りのデッキ。ガラスの手すりと、白い鉄の縁。
    // 坂の上（山頂の広場）側の端から、ゆるい斜路で上がれる
    const d = SUMMIT.deck;
    const gy = terrainY(d.x, d.z);
    const top = gy + 4;
    this.deckTop = top;
    const L = 36, W = 3.6, yaw = 0.35;
    const g = new THREE.Group();
    const wood = lam(0xa88660), white = lam(0xeeeeea), dark = lam(0x7a6248);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(L, 0.3, W), wood);
    floor.position.y = top - gy;
    floor.castShadow = floor.receiveShadow = true;
    g.add(floor);
    // 板の目地
    const seams = [];
    for (let x = -L / 2 + 0.6; x < L / 2; x += 0.6) seams.push({ x, y: top - gy + 0.155, z: 0, sx: 0.03, sy: 0.01, sz: W - 0.1, color: '#7a6248' });
    g.add(instancedBoxes(seams, lam(0xffffff), { cast: false }));
    // 白い鉄の縁（デッキの側面）
    for (const z of [-W / 2, W / 2]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(L, 0.55, 0.12), white);
      edge.position.set(0, top - gy - 0.1, z);
      g.add(edge);
    }
    // 細い白い柱（2本ずつ、6m ごと）。坂の地面まで
    for (let x = -L / 2 + 2; x <= L / 2 - 2; x += 6) for (const z of [-W / 2 + 0.3, W / 2 - 0.3]) {
      const wx = d.x + x * Math.cos(yaw) + z * Math.sin(yaw), wz = d.z - x * Math.sin(yaw) + z * Math.cos(yaw);
      const base = terrainY(wx, wz);
      const h = top - base;
      if (h < 0.3) continue;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, h, 8), white);
      post.position.set(x, base - gy + h / 2 - 0.15, z);
      g.add(post);
    }
    // ガラスの手すりと、上の手すり（木）
    for (const z of [-W / 2 + 0.05, W / 2 - 0.05]) {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.0), new THREE.MeshLambertMaterial({ color: 0xe4eef2, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      glass.position.set(0, top - gy + 0.65, z);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.08, 0.14), dark);
      rail.position.set(0, top - gy + 1.17, z);
      g.add(glass, rail);
      for (let x = -L / 2; x <= L / 2; x += 3) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), white);
        st.position.set(x, top - gy + 0.65, z);
        g.add(st);
      }
    }
    // 端の手すり（斜路のある側は空ける）
    {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.0), new THREE.MeshLambertMaterial({ color: 0xe4eef2, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      glass.rotation.y = Math.PI / 2;
      glass.position.set(L / 2, top - gy + 0.65, 0);
      g.add(glass);
    }
    // 長いベンチと、望遠鏡ふたつ
    const bench = new THREE.Mesh(new THREE.BoxGeometry(12, 0.42, 0.5), dark);
    bench.position.set(2, top - gy + 0.36, -W / 2 + 0.6);
    g.add(bench);
    for (const x of [-8, 12]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.1, 8), lam(0x3a4a5a));
      st.position.set(x, top - gy + 0.7, W / 2 - 0.5);
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), lam(0x3a4a5a));
      scope.position.set(x, top - gy + 1.35, W / 2 - 0.5);
      scope.rotation.y = Math.PI / 2;
      g.add(st, scope);
    }
    g.rotation.y = yaw;
    g.position.set(d.x, gy, d.z);
    this.group.add(g);
    // 歩ける：デッキの上と、山頂の広場から上がる斜路
    const ax = Math.cos(yaw), az = -Math.sin(yaw);   // デッキの長い向き（世界座標）
    addUpper(d.x, d.z, L, W - 0.5, Math.atan2(az, ax), top + 0.15);
    const ex = d.x - ax * L / 2, ez = d.z - az * L / 2;      // 山頂側の端
    // 山頂側の端から下りる階段（地面に届く長さ。勾配はおよそ30°）
    let len = 4;
    for (; len < 20; len += 0.5) if (top + 0.15 - groundY(ex - ax * len, ez - az * len) <= len * 0.6 && walkable(ex - ax * (len + 0.6), ez - az * (len + 0.6))) break;
    const gx = ex - ax * len, gz = ez - az * len, g1 = groundY(gx, gz);
    addUpper(ex - ax * len / 2, ez - az * len / 2, len + 0.4, 2.2, Math.atan2(az, ax), g1 + 0.05, top + 0.15);
    const steps = [];
    const n = Math.ceil((top + 0.15 - g1) / 0.18), run = len / n;
    for (let k = 0; k < n; k++) {
      const u = len - (k + 0.5) * run, yTop = g1 + (k + 1) * (top + 0.15 - g1) / n;
      steps.push({ x: ex - ax * u, y: (yTop + Math.max(g1, yTop - 0.5)) / 2, z: ez - az * u, sx: run + 0.02, sy: Math.max(0.18, Math.min(0.5, yTop - g1)), sz: 2.4, ry: yaw, color: '#a88660' });
    }
    for (const sd of [-1, 1]) {
      const ox = Math.sin(yaw) * sd * 1.25, oz = Math.cos(yaw) * sd * 1.25;
      const pitch = Math.atan2(top + 0.15 - g1, len);
      steps.push({ x: ex - ax * len / 2 + ox, y: (g1 + top) / 2 + 0.95, z: ez - az * len / 2 + oz, sx: Math.hypot(len, top - g1), sy: 0.06, sz: 0.08, ry: yaw, rz: pitch, color: '#eeeeea' });
    }
    this.group.add(instancedBoxes(steps, lam(0xffffff)));
    this.interactables.push({ type: 'deck', name: '展望台', x: SUMMIT.x, z: SUMMIT.z, radius: 9, seat: { x: d.x + Math.sin(yaw) * -1.6, z: d.z - Math.cos(yaw) * 1.6, y: top + 0.43, yaw: 0, kind: 'deck' } });
  }

  // ---------- 名所：天寧寺の三重塔、艮神社、千光寺 ----------
  _landmarks() {
    const poi = (n) => POIS.find((p) => p.n === n);
    const pagoda = poi('天寧寺三重塔');
    if (pagoda) { this._pagoda(pagoda.x, pagoda.z); this._cemetery(pagoda.x, pagoda.z); }
    this._castle();
    const ushitora = poi('艮神社');
    if (ushitora) this._shrine(ushitora.x, ushitora.z);
    const senkoji = poi('千光寺');
    if (senkoji) {
      // 千光寺の朱塗りの本堂（赤堂）
      const y = terrainY(senkoji.x, senkoji.z);
      const simple = new THREE.Group();
      const hall = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 6), lam(0xb8402e));
      hall.position.set(senkoji.x, y + 1.8, senkoji.z);
      hall.castShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2.6, 4), lam(0x3a3f46));
      roof.rotation.y = Math.PI / 4;
      roof.position.set(senkoji.x, y + 5.1, senkoji.z);
      roof.scale.set(1, 1, 0.9);
      simple.add(hall, roof);
      this.group.add(simple);
      // 崖の上に張り出した懸造りの本堂と、鐘楼「驚音楼」、大きな岩。舞台は坂の下（海）へ向ける
      // 本堂・舞台、鐘楼、裏の大岩は、石段や参道にかからない場所と向きに（すり抜けないように）
      const fit = MODEL_FITS.senkoji;
      this._swapModel('senkoji', simple, (g) => {
        g.position.set(fit.x, terrainY(fit.x, fit.z) - 0.3, fit.z);
        g.rotation.y = fit.yaw;
        this._addSolids(fit, MODEL_RECTS.senkoji);
      });
    }
  }

  /**
   * 古寺めぐり：めぐる寺ごとに、寺の名を刻んだ石標と、お参りの場所。地図に堂のない寺には、本堂と鐘楼。
   * 寺と寺のあいだの道には、「古寺めぐり」の小さな道しるべ（およそ60m ごと）
   */
  _koji() {
    const r = seededRandom('koji');
    const stones = [], posts = [];
    const granite = lam(0xb0aa9e);
    const hasBuilding = (x, z) => DATA.buildings.some((b) => { let bx = 0, bz = 0; const n = b.p.length / 2; for (let k = 0; k < b.p.length; k += 2) { bx += b.p[k]; bz += b.p[k + 1]; } return Math.hypot(bx / n - x, bz / n - z) < 18; });
    const signTex = labelTexture('古寺めぐり', { w: 128, h: 512, size: 92, bg: '#a8a296', fg: '#3a3430', vertical: true });
    const signMat = new THREE.MeshLambertMaterial({ map: signTex });
    KOJI.forEach((t, i) => {
      // 石標（寺の名）：お参りの場所の道ばた
      const n = nearestRoad(t.stand.x, t.stand.z);
      const ang = n ? Math.atan2(n.seg.dz, n.seg.dx) : 0;
      const hw = n ? n.seg.half : 1;
      let sx = t.stand.x, sz = t.stand.z;
      for (const sd of [1, -1]) {
        const x = t.stand.x - Math.sin(ang) * sd * (hw + 0.5), z = t.stand.z + Math.cos(ang) * sd * (hw + 0.5);
        if (!nearAnyRoad(x, z, 0.1) && !inBuilding(x, z) && !inSolid(x, z)) { sx = x; sz = z; break; }
      }
      const sy = groundY(sx, sz);
      const tex = labelTexture(t.name, { w: 128, h: 512, size: Math.min(100, 440 / t.name.length), bg: '#b0aa9e', fg: '#2e2a26', vertical: true });
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.8, 0.42), [granite, granite, granite, granite, new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex })]);
      pillar.position.set(sx, sy + 0.9, sz);
      pillar.rotation.y = Math.atan2(t.stand.x - sx, t.stand.z - sz);   // 文字の面を道へ
      pillar.castShadow = true;
      this.group.add(pillar);
      stones.push({ x: sx, y: sy + 0.1, z: sz, sx: 0.7, sy: 0.2, sz: 0.7, ry: -ang, color: '#9a9488' });
      addSolid(sx, sz, 0.6, 0.6, -ang);
      // 地図に堂がない寺：本堂を建てる（道にかからない場所に、坂の下へ向けて）
      if (!hasBuilding(t.x, t.z) && t.name !== '御袖天満宮' && t.name !== '浄土寺') {
        const fit = fitPlacement(t.x, t.z, [[-4.5, 4.5, -4, 4]], { maxShift: 14 });
        if (fit && fit.hits < 3) {
          const hall = this._hall(7, 6, 3.6);
          hall.position.set(fit.x, Math.min(...[[-4, -4], [4, -4], [-4, 4], [4, 4]].map(([a, b]) => terrainY(fit.x + a, fit.z + b))) - 0.2, fit.z);
          hall.rotation.y = fit.yaw;
          this.group.add(hall);
          addSolid(fit.x, fit.z, 8, 7, -fit.yaw);
        }
      }
      this.interactables.push({ type: 'temple', name: t.name, idx: i, x: t.stand.x, z: t.stand.z, radius: 4.5 });
      // 道しるべ：前の寺からの道すじに、およそ60m ごと
      if (t.route.length > 1) {
        const pts = samplePath(t.route, 4);
        let run = 0, last = 0;
        for (const p of pts) {
          run += 4;
          if (run - last < 60 || run < 20) continue;
          const nr = nearestRoad(p.x, p.z);
          const w = nr ? nr.seg.half + 0.45 : 1.2;
          const sd = r() < 0.5 ? -1 : 1;
          const x = p.x - Math.sin(p.angle) * sd * w, z = p.z + Math.cos(p.angle) * sd * w;
          if (nearAnyRoad(x, z, 0.05) || inBuilding(x, z) || inSolid(x, z)) continue;
          last = run;
          posts.push({ x, z, y: groundY(x, z), face: Math.atan2(p.x - x, p.z - z) });
        }
      }
    });
    if (stones.length) this.group.add(instancedChunks(stones, lam(0xffffff), { detail: 80 }));
    for (const p of posts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.95, 0.22), [granite, granite, granite, granite, signMat, signMat]);
      m.position.set(p.x, p.y + 0.47, p.z);
      m.rotation.y = p.face;
      this.group.add(m);
    }
  }

  /**
   * 坂の町の公園と広場：
   * ・千光寺公園（山頂のまわり）：桜の林、ベンチ、東屋
   * ・文学のこみち（山頂から千光寺へ下る小道）：文人の名を刻んだ自然石の文学碑
   * ・坂の途中の小さな公園：平らなあき地に、砂の広場、ぶらんこ、すべり台、ベンチ、木
   */
  _parks() {
    const r = seededRandom('parks');
    const month = new Date().getMonth() + 1;
    const sakura = month === 3 || month === 4 ? ['#f2c4cf', '#eab4c2', '#f6d4dc'] : month === 10 || month === 11 ? ['#c86a3a', '#b8803a', '#7a8a44'] : ['#5f8a44', '#6e9a4c', '#557c3c'];
    const boxes = [], trunks = [], crowns = [], rocks = [];
    const free = (x, z, m = 1) => !nearAnyRoad(x, z, m) && !inBuilding(x, z) && !inSolid(x, z);
    this.sakuraTrees = [];   // さくら祭りで、季節でなくても満開にするため
    const tree = (x, z, colors, h = 4.5 + r() * 1.5) => {
      const y = groundY(x, z);
      if (colors === sakura) this.sakuraTrees.push({ x, y, z, h });
      trunks.push({ x, y: y + h / 2, z, sx: 0.32, sy: h, sz: 0.32, rz: (r() - 0.5) * 0.25, color: '#4e3a30' });
      for (let j = 0; j < 4; j++) crowns.push({ x: x + (r() - 0.5) * 3, y: y + h - 0.3 + r() * 1.2, z: z + (r() - 0.5) * 3, sx: 2.8 + r() * 1.2, sy: 1.8 + r() * 0.6, sz: 2.8 + r() * 1.2, ry: r() * 6, color: colors[j % colors.length] });
      addSolid(x, z, 0.7, 0.7, 0);
    };
    const bench = (x, z, ang) => {
      const y = groundY(x, z);
      boxes.push({ x, y: y + 0.42, z, sx: 1.6, sy: 0.08, sz: 0.42, ry: ang, color: '#8a6a48' });
      boxes.push({ x: x - Math.sin(ang) * 0.18, y: y + 0.7, z: z - Math.cos(ang) * 0.18, sx: 1.6, sy: 0.35, sz: 0.06, ry: ang, color: '#8a6a48' });
      for (const sd of [-0.65, 0.65]) boxes.push({ x: x + Math.cos(ang) * sd, y: y + 0.21, z: z - Math.sin(ang) * sd, sx: 0.08, sy: 0.42, sz: 0.4, ry: ang, color: '#3a3a3a' });
      addSolid(x, z, 1.7, 0.6, ang);
    };
    // ---- 千光寺公園：山頂のまわり、ゆるい斜面に桜をまとめて ----
    const S = SUMMIT;
    let n = 0;
    for (let k = 0; k < 160 && n < 34; k++) {
      const a = r() * Math.PI * 2, d = 20 + r() * 110;
      const x = S.x + Math.cos(a) * d, z = S.z + Math.sin(a) * d;
      if (!free(x, z, 2.5) || inPrecinct(x, z, 2)) continue;
      const above = terrainY(x, z) - SEA_Y;
      if (above < 100) continue;
      n++;
      tree(x, z, sakura);
      // 木の下にベンチ（ときどき）
      if (n % 4 === 0) {
        const bx = x + 2.4, bz = z;
        if (free(bx, bz, 0.5)) bench(bx, bz, r() * 6);
      }
    }
    // 東屋（四本柱に方形の屋根）を、山頂の広場の近くに
    for (let k = 0; k < 40; k++) {
      const a = r() * Math.PI * 2, d = 26 + r() * 30;
      const x = S.x + Math.cos(a) * d, z = S.z + Math.sin(a) * d;
      if (!free(x, z, 3.5) || inPrecinct(x, z, 3)) continue;
      const y = groundY(x, z);
      for (const [px, pz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) boxes.push({ x: x + px, y: y + 1.3, z: z + pz, sx: 0.2, sy: 2.6, sz: 0.2, color: '#5a3e2c' });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.4, 4), lam(0x3c4148));
      roof.rotation.y = Math.PI / 4;
      roof.position.set(x, y + 3.25, z);
      roof.castShadow = true;
      this.group.add(roof);
      boxes.push({ x, y: y + 0.45, z: z + 1.0, sx: 2.6, sy: 0.08, sz: 0.4, color: '#8a6a48' });
      boxes.push({ x, y: y + 0.45, z: z - 1.0, sx: 2.6, sy: 0.08, sz: 0.4, color: '#8a6a48' });
      boxes.push({ x, y: y + 0.72, z, sx: 1.2, sy: 0.06, sz: 0.8, color: '#8a6a48' });
      addSolid(x, z, 3.6, 3.6, 0);
      break;
    }
    // ---- 文学のこみち：山頂から千光寺へ下る道に、文学碑（自然石に、文人の名） ----
    const sk = POIS.find((q) => q.n === '千光寺');
    if (sk) {
      const route = walkRoute(S.x, S.z, sk.x, sk.z);
      const names = ['正岡子規', '松尾芭蕉', '十返舎一九', '徳冨蘆花', '頼山陽', '林芙美子', '志賀直哉', '金田一京助', '中村憲吉', '山口誓子', '緒方洪庵', '吉井勇', '巌谷小波', '前田夕暮', '小林和作', '江戸川乱歩', '柳原白蓮', '寺内萬治郎', '森田思軒', '物外和尚', '高垣眸', '亀山光夫', '尾崎紅葉', '下村湖人', '良寛'];
      const pts = samplePath(route, 2);
      let run = 0, last = -99, ni = 0;
      for (const p of pts) {
        run += 2;
        if (run - last < 16 || ni >= names.length) continue;
        const nr = nearestRoad(p.x, p.z);
        const w = nr ? nr.seg.half : 1;
        const sd = ni % 2 ? 1 : -1;
        const x = p.x - Math.sin(p.angle) * sd * (w + 1.3), z = p.z + Math.cos(p.angle) * sd * (w + 1.3);
        if (!free(x, z, 0.6)) continue;
        last = run;
        const y = groundY(x, z), size = 1.2 + r() * 0.8;
        rocks.push({ x, y: y + size * 0.45, z, sx: size * 1.2, sy: size * 1.1, sz: size * 0.8, ry: Math.atan2(p.x - x, p.z - z), rx: (r() - 0.5) * 0.2, color: ['#9a958a', '#8e897e', '#a29d92'][Math.floor(r() * 3)] });
        // 刻んだ文字の板（道に向けて）
        const tex = labelTexture(names[ni], { w: 128, h: 384, size: Math.min(84, 330 / names[ni].length), bg: '#8a857a', fg: '#2e2a26', vertical: true });
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1.0), new THREE.MeshLambertMaterial({ map: tex }));
        const face = Math.atan2(p.x - x, p.z - z);
        plate.position.set(x + Math.sin(face) * size * 0.42, y + size * 0.55, z + Math.cos(face) * size * 0.42);
        plate.rotation.y = face;
        this.group.add(plate);
        addSolid(x, z, size, size, 0);
        ni++;
      }
    }
    // ---- 坂の途中の小さな公園：平らなあき地（石段の小道のそば） ----
    const parks = [];
    const flatAt = (x, z) => { const ys = [[-6, 0], [6, 0], [0, -6], [0, 6], [0, 0]].map(([a, b]) => terrainY(x + a, z + b)); return Math.max(...ys) - Math.min(...ys); };
    for (const road of ROADS) {
      if (road.surface !== 'stone' || parks.length >= 6) continue;
      for (const p of samplePath(road.pts, 10)) {
        if (parks.length >= 6) break;
        const above = terrainY(p.x, p.z) - SEA_Y;
        if (above < 12 || above > 85) continue;
        for (const sd of [-1, 1]) {
          const x = p.x - Math.sin(p.angle) * sd * 9, z = p.z + Math.cos(p.angle) * sd * 9;
          if (parks.some((q) => Math.hypot(q.x - x, q.z - z) < 140) || flatAt(x, z) > 1.6) continue;
          let ok = true;
          for (let a = 0; a < 6.3 && ok; a += 0.8) for (const d of [0, 3, 6]) { const qx = x + Math.cos(a) * d, qz = z + Math.sin(a) * d; if (!free(qx, qz, 0.3) || inPrecinct(qx, qz, 2)) { ok = false; break; } }
          if (!ok) continue;
          parks.push({ x, z, face: Math.atan2(p.x - x, p.z - z) });
          break;
        }
      }
    }
    const tb = new TriBatch();
    for (const pk of parks) {
      // 砂の地面
      for (let a = -7; a < 7; a += 1) for (let b = -7; b < 7; b += 1) {
        if (Math.hypot(a, b) > 7) continue;
        const v = 0.78 + r() * 0.05, col = new THREE.Color(v, v * 0.92, v * 0.78);
        const P = (px, pz) => [pk.x + px, groundY(pk.x + px, pk.z + pz) + 0.05, pk.z + pz];
        tb.quad(P(a, b), P(a, b + 1), P(a + 1, b + 1), P(a + 1, b), col);
      }
      const y = groundY(pk.x, pk.z), c = Math.cos(pk.face), sn = Math.sin(pk.face);
      const W = (lx, lz) => ({ x: pk.x + lx * c + lz * sn, z: pk.z - lx * sn + lz * c });
      // ぶらんこ（黄色い鉄の枠、赤い座板ふたつ）
      const sw = W(-3, -2);
      for (const sd of [-1.6, 1.6]) for (const t of [-0.6, 0.6]) {
        const q = W(-3 + sd, -2 + t);
        boxes.push({ x: q.x, y: y + 1.2, z: q.z, sx: 0.1, sy: 2.5, sz: 0.1, rx: -t * 0.4, ry: pk.face, color: '#e0b030' });
      }
      boxes.push({ x: sw.x, y: y + 2.4, z: sw.z, sx: 3.4, sy: 0.12, sz: 0.12, ry: pk.face, color: '#e0b030' });
      for (const sd of [-0.8, 0.8]) {
        const q = W(-3 + sd, -2);
        boxes.push({ x: q.x, y: y + 0.45, z: q.z, sx: 0.5, sy: 0.06, sz: 0.25, ry: pk.face, color: '#c8302a' });
        boxes.push({ x: q.x, y: y + 1.45, z: q.z, sx: 0.02, sy: 1.95, sz: 0.02, ry: pk.face, color: '#888' });
      }
      addSolid(sw.x, sw.z, 3.6, 1.6, -pk.face);
      // すべり台（青い階段と、銀色のすべり面）
      const sl = W(3, -1.5);
      boxes.push({ x: sl.x, y: y + 0.9, z: sl.z, sx: 0.9, sy: 0.1, sz: 0.9, ry: pk.face, color: '#3a6ab8' });
      for (const t of [-0.4, 0.4]) { const q = W(3 + t, -2); boxes.push({ x: q.x, y: y + 0.45, z: q.z, sx: 0.08, sy: 0.9, sz: 0.08, color: '#3a6ab8' }); }
      const sm = W(3, -0.1);
      boxes.push({ x: sm.x, y: y + 0.5, z: sm.z, sx: 0.7, sy: 0.06, sz: 2.2, ry: pk.face, rx: -0.42, color: '#c8ccd0' });
      addSolid(sl.x, sl.z, 1.2, 3, -pk.face);
      // ベンチ2つと、木2本（桜と、緑の木）、低い柵
      for (const [lx, lz] of [[-4.5, 4], [1.5, 4.5]]) { const q = W(lx, lz); bench(q.x, q.z, pk.face + Math.PI); }
      const t1 = W(-5.5, 5.5), t2 = W(5.5, 4);
      tree(t1.x, t1.z, sakura);
      tree(t2.x, t2.z, ['#3e6e34', '#4f7c3e', '#5a8a44'], 5 + r() * 2);
      for (let a = 0; a < Math.PI * 2; a += 0.35) {
        const qx = pk.x + Math.cos(a) * 7.3, qz = pk.z + Math.sin(a) * 7.3;
        if (nearAnyRoad(qx, qz, 0.6)) continue;
        boxes.push({ x: qx, y: groundY(qx, qz) + 0.35, z: qz, sx: 0.08, sy: 0.7, sz: 0.08, color: '#4a6a4a' });
        boxes.push({ x: qx, y: groundY(qx, qz) + 0.66, z: qz, sx: 2.5, sy: 0.06, sz: 0.06, ry: -(a + Math.PI / 2), color: '#4a6a4a' });
      }
    }
    if (parks.length) {
      const sand = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.6, polygonOffsetUnits: -1 }));
      sand.receiveShadow = true;
      this.group.add(sand);
    }
    this.parkSpots = parks;
    if (boxes.length) this.group.add(instancedChunks(boxes, lam(0xffffff), { detail: 80 }));
    if (rocks.length) this.group.add(instancedChunks(rocks, lam(0xffffff, { flatShading: true }), { detail: 80, geo: new THREE.DodecahedronGeometry(0.6, 0) }));
    if (trunks.length) {
      this.group.add(instancedChunks(trunks, lam(0xffffff), { geo: new THREE.CylinderGeometry(0.4, 0.55, 1, 6) }));
      this.group.add(instancedChunks(crowns, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(0.6, 1) }));
    }
  }

  /** 木造の堂・社殿（低ポリゴン）：石の基壇、柱と壁、四方に軒の出た屋根（寄棟風）。正面は +Z */
  _hall(w, d, h, { wall = 0x5a3e2c, roof = 0x3c4148, plaster = 0xeae4d6, base = 0x9a9488 } = {}) {
    const g = new THREE.Group();
    const add = (geo, color, x, y, z) => { const m = new THREE.Mesh(geo, lam(color)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    add(new THREE.BoxGeometry(w + 1.2, 0.8, d + 1.2), base, 0, 0.1, 0);
    add(new THREE.BoxGeometry(w, h, d), wall, 0, 0.5 + h / 2, 0);
    add(new THREE.BoxGeometry(w + 0.02, h * 0.28, d + 0.02), plaster, 0, 0.5 + h * 0.84, 0);
    for (const x of [-w / 2, -w / 6, w / 6, w / 2]) add(new THREE.BoxGeometry(0.28, h, 0.28), 0x3a2a20, x, 0.5 + h / 2, d / 2 + 0.05);
    const R = Math.hypot(w, d) / 2 + 1.6;
    const rf = add(new THREE.ConeGeometry(R, h * 0.75, 4), roof, 0, 0.5 + h + h * 0.36, 0);
    rf.rotation.y = Math.PI / 4;
    rf.scale.set(1, 1, d / w);
    const eave = add(new THREE.BoxGeometry(w + 2.4, 0.25, d + 2.4), roof, 0, 0.5 + h + 0.05, 0);
    eave.castShadow = true;
    add(new THREE.BoxGeometry(w * 0.5, 0.3, 0.3), roof, 0, 0.5 + h + h * 0.72, 0);   // 棟
    return g;
  }

  /** 町のほかの名所：御袖天満宮の大石段と社殿、持光寺の延命門、ONOMICHI U2、ロープウェイ山頂駅 */
  _moreSights() {
    const poi = (n) => POIS.find((q) => q.n === n);
    const stone = lam(0xa8a296), granite = lam(0xb4aea2);
    // ---- 御袖天満宮：下の道から、まっすぐ上る長い石段（一枚岩の段）、上に社殿 ----
    const tm = poi('御袖天満宮');
    if (tm) {
      // 石段は、社殿より下の道から上る（いちばん近い、下の道の点）
      const gTm = groundY(tm.x, tm.z);
      let n = null;
      for (const road of ROADS) for (const [x, z] of road.pts) {
        const d = Math.hypot(x - tm.x, z - tm.z), gy = groundY(x, z);
        if (d < 80 && gy < gTm - 4 && road.surface !== 'stone' || d < 80 && gy < gTm - 4 && road.kind === 'steps') if (!n || d < n.d) n = { d, px: x, pz: z };
      }
      if (n) {
        const bx = n.px, bz = n.pz, by = surfaceY(bx, bz);
        let dx = tm.x - bx, dz = tm.z - bz;
        const dist = Math.hypot(dx, dz); dx /= dist; dz /= dist;
        const ang = Math.atan2(dz, dx);
        const run = Math.max(8, dist - 7);
        const ty = groundY(bx + dx * run, bz + dz * run);
        const topY = Math.max(ty, by + 2) + 0.3;
        const stairs = [];
        const steps = Math.max(10, Math.round((topY - by) / 0.19)), sr = run / steps;
        for (let k = 0; k < steps; k++) {
          const u = (k + 0.5) * sr, y = by + (k + 1) * (topY - by) / steps;
          const x = bx + dx * (u + 1), z = bz + dz * (u + 1);
          stairs.push({ x, y: y - 0.35, z, sx: sr + 0.02, sy: 0.7, sz: 2.6, ry: -ang, color: k % 2 ? '#aaa498' : '#b2ac9f' });
        }
        // 両わきの石垣
        for (const sd of [-1, 1]) for (let u = 0; u < run; u += 2) {
          const x = bx + dx * (u + 2) - dz * sd * 1.6, z = bz + dz * (u + 2) + dx * sd * 1.6;
          const y = by + (u + 1) / run * (topY - by);
          const gy = groundY(x, z);
          stairs.push({ x, y: (y + 0.6 + Math.min(gy, y) - 1) / 2, z, sx: 2.05, sy: Math.max(0.8, y + 0.6 - Math.min(gy, y) + 1), sz: 0.5, ry: -ang, color: '#9a948a' });
        }
        this.group.add(instancedChunks(stairs, lam(0xffffff)));
        addUpper(bx + dx * (run / 2 + 0.6), bz + dz * (run / 2 + 0.6), run + 0.8, 2.3, ang, by + 0.02, topY);
        // 石段の上：石を敷いた境内（平ら）と、社殿・狛犬・石灯籠
        const cx = bx + dx * (run + 6), cz = bz + dz * (run + 6);
        const low = Math.min(...[[-6, -6], [6, -6], [-6, 6], [6, 6]].map(([a2, b2]) => groundY(cx + a2, cz + b2)));
        const yard = new THREE.Mesh(new THREE.BoxGeometry(12, Math.min(3, Math.max(0.6, topY - low + 0.4)), 12), stone);
        yard.position.set(cx, topY - yard.geometry.parameters.height / 2, cz);
        yard.rotation.y = -ang;
        yard.receiveShadow = true;
        this.group.add(yard);
        addUpper(cx, cz, 12, 12, ang, topY);
        const hall = this._hall(6, 5, 3.4, { wall: 0x4a3324 });
        hall.position.set(bx + dx * (run + 9), topY - 0.3, bz + dz * (run + 9));
        hall.rotation.y = Math.atan2(-dx, -dz);
        this.group.add(hall);
        // 鳥居（石）を石段の下に
        const torii = new THREE.Group();
        for (const sx of [-1.5, 1.5]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 4, 10), granite); post.position.set(sx, 2, 0); torii.add(post); }
        const kasagi = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.35, 0.5), granite); kasagi.position.y = 4.1;
        const nuki = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.25, 0.3), granite); nuki.position.y = 3.4;
        torii.add(kasagi, nuki);
        torii.position.set(bx + dx * 0.6, by, bz + dz * 0.6);
        torii.rotation.y = Math.atan2(dx, dz) + Math.PI / 2 - Math.PI / 2;
        torii.rotation.y = -ang + Math.PI / 2;
        this.group.add(torii);
        for (const sd of [-1, 1]) {
          const lx = cx - dx * 4 - dz * sd * 3, lz = cz - dz * 4 + dx * sd * 3;
          const parts = [[0.8, 0.4, 0.2], [0.28, 0.9, 0.85], [0.44, 0.4, 1.5], [0.9, 0.25, 1.85]];
          for (const [w, hh, yy] of parts) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, w), stone); m.position.set(lx, topY + yy, lz); this.group.add(m); }
          this.lampPositions.push([lx, topY + 1.5, lz]);
        }
      }
    }
    // ---- 持光寺の延命門：花崗岩を組んだ石の門（道がくぐる） ----
    const jk = poi('持光寺');
    if (jk) {
      const n = nearestRoad(jk.x, jk.z);
      if (n) {
        const ang = Math.atan2(n.seg.dz, n.seg.dx), hw = n.seg.half;
        const g = new THREE.Group();
        const y0 = groundY(n.px, n.pz);
        for (const sd of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const blk = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.05, 1.3), granite);
            blk.position.set(0, 0.52 + k * 1.05, sd * (hw + 0.75));
            blk.castShadow = true;
            g.add(blk);
          }
        }
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, hw * 2 + 2.8), granite);
        lintel.position.y = 3.6;
        const roofG = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(1.2, hw * 2 + 2.8) / 2 + 1, 1.3, 4), lam(0x3c4148));
        roofG.rotation.y = Math.PI / 4;
        roofG.scale.set(1, 1, (hw * 2 + 3.6) / 2.6);
        roofG.position.y = 4.7;
        g.add(lintel, roofG);
        g.position.set(n.px, y0, n.pz);
        g.rotation.y = -ang;
        this.group.add(g);
        for (const sd of [-1, 1]) addSolid(n.px - Math.sin(ang) * sd * (hw + 0.75), n.pz + Math.cos(ang) * sd * (hw + 0.75), 1.3, 1.3, -ang);
      }
    }
    // ---- ONOMICHI U2：海ぞいの倉庫（濃い灰色の壁）に、館名、海側の木のデッキとテーブル、自転車 ----
    if (this.u2Poly) {
      const poly = this.u2Poly;
      let bestL = 0, a0 = null;
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i], [bx2, bz2] = poly[(i + 1) % poly.length];
        const mx = (ax + bx2) / 2, mz = (az + bz2) / 2, L = Math.hypot(bx2 - ax, bz2 - az);
        if (L > bestL && distToCoast(mx, mz) < 25) { bestL = L; a0 = { ax, az, bx: bx2, bz: bz2, mx, mz, L }; }
      }
      if (a0) {
        const ang = Math.atan2(a0.bz - a0.az, a0.bx - a0.ax);
        let nx = -Math.sin(ang), nz = Math.cos(ang);
        if (inBuilding(a0.mx + nx * 2, a0.mz + nz * 2)) { nx = -nx; nz = -nz; }   // 外向き（海側）
        const y = groundY(a0.mx + nx * 2, a0.mz + nz * 2);
        const tex = labelTexture('ONOMICHI U2', { w: 1024, h: 192, size: 120, bg: 'rgba(0,0,0,0)', fg: '#f2efe8' });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshLambertMaterial({ map: tex, transparent: true, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2 }));
        sign.position.set(a0.mx + nx * 0.08, y + 6.5, a0.mz + nz * 0.08);
        sign.rotation.y = Math.atan2(nx, nz);
        this.specialSignMats.push(sign.material);
        this.group.add(sign);
        const items = [];
        const dl = Math.min(a0.L - 4, 40);
        // 木のデッキ
        items.push({ x: a0.mx + nx * 3, y: y + 0.12, z: a0.mz + nz * 3, sx: dl, sy: 0.24, sz: 5, ry: -ang, color: '#8a6a48' });
        // 大きなガラスの開口（夜は灯る）
        const glassMat = new THREE.MeshLambertMaterial({ color: 0x6a7a84, emissive: 0xffc888, emissiveIntensity: 0.2 });
        this.specialSignMats.push(glassMat);
        for (let u = -dl / 2 + 3; u < dl / 2 - 2; u += 6) {
          const gx = a0.mx + Math.cos(ang) * u + nx * 0.06, gz = a0.mz + Math.sin(ang) * u + nz * 0.06;
          const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3), glassMat);
          m.position.set(gx, y + 1.8, gz);
          m.rotation.y = Math.atan2(nx, nz);
          this.group.add(m);
          // テーブルと椅子
          const tx = gx + nx * 3.2, tz = gz + nz * 3.2;
          items.push({ x: tx, y: y + 0.95, z: tz, sx: 1.2, sy: 0.06, sz: 0.8, ry: -ang, color: '#e8e4dc' });
          items.push({ x: tx, y: y + 0.6, z: tz, sx: 0.08, sy: 0.7, sz: 0.08, color: '#3a3a3a' });
          for (const sd of [-1, 1]) items.push({ x: tx + Math.cos(ang) * sd * 0.9, y: y + 0.5, z: tz + Math.sin(ang) * sd * 0.9, sx: 0.45, sy: 0.08, sz: 0.45, color: '#3a3a3a' });
        }
        // 自転車（サイクリストのホテルなので、ずらりと）
        for (let k = 0; k < 6; k++) {
          const u = -dl / 2 + 1.5 + k * 0.9, bx3 = a0.mx + Math.cos(ang) * u + nx * 1.3, bz3 = a0.mz + Math.sin(ang) * u + nz * 1.3;
          items.push({ x: bx3, y: y + 0.6, z: bz3, sx: 0.06, sy: 0.5, sz: 1.6, ry: -ang + Math.PI / 2, color: ['#c8302a', '#2a5aa8', '#e8e4dc', '#3a3a3a'][k % 4] });
          items.push({ x: bx3, y: y + 0.38, z: bz3, sx: 0.04, sy: 0.65, sz: 0.65, ry: -ang + Math.PI / 2, color: '#222' });
        }
        this.group.add(instancedChunks(items, lam(0xffffff)));
      }
    }
    // ---- ロープウェイ山頂駅：白い駅舎（ガラスの帯）と、ゴンドラの乗り場の大きな滑車 ----
    {
      const { base, top } = ROPEWAY;
      const ty = terrainY(top.x, top.z);
      const ax = top.x - base.x, az = top.z - base.z, L = Math.hypot(ax, az);
      const ux = ax / L, uz = az / L;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(10, 7, 9), lam(0xe8e6e0));
      body.position.set(0, 3.5, 0);
      const band = new THREE.Mesh(new THREE.BoxGeometry(10.05, 1.6, 9.05), new THREE.MeshLambertMaterial({ color: 0x6a7a84, emissive: 0xffd8a8, emissiveIntensity: 0.2 }));
      band.position.set(0, 4.6, 0);
      this.specialSignMats.push(band.material);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.4, 20), lam(0x50565c));
      wheel.position.set(-7, 6.3, 0);
      const plat = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 7), lam(0xb8b2a6));
      plat.position.set(-7, 1, 0);
      [body, band, wheel, plat].forEach((m) => { m.castShadow = true; g.add(m); });
      const tex = labelTexture('山頂駅', { w: 512, h: 128, size: 80, bg: '#7a2a22', fg: '#f6ead8' });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      sign.position.set(-5.05, 6.4, 0);
      sign.rotation.y = Math.PI / 2;
      g.add(sign);
      // 駅舎は、ケーブルの来るほう（-X）に乗り場が向くよう、ケーブルの延長上の奥に
      g.position.set(top.x + ux * 8, ty, top.z + uz * 8);
      g.rotation.y = -Math.atan2(uz, ux);
      this.group.add(g);
    }
  }

  /** 山の上の、お城のかたちの建物（白壁に黒い瓦の屋根を重ねた天守閣風）と石垣 */
  _castle() {
    const P = POIS.find((q) => q.n === '尾道城');
    if (!P) return;
    const y = terrainY(P.x, P.z);
    const g = new THREE.Group();
    const white = lam(0xeeece4), roof = lam(0x3c4250), stone = lam(0x8f897d);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 6, 4), stone);
    base.rotation.y = Math.PI / 4;
    base.position.y = 1;
    g.add(base);
    let h = 4, w = 12;
    for (let i = 0; i < 5; i++) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, 3.2, w * 0.85), white);
      body.position.y = h + 1.6;
      body.castShadow = true;
      const rf = new THREE.Mesh(new THREE.ConeGeometry(w * 0.82, 1.6, 4), roof);
      rf.rotation.y = Math.PI / 4;
      rf.scale.z = 0.85;
      rf.position.y = h + 3.6;
      g.add(body, rf);
      h += 3.4;
      w *= 0.8;
    }
    // てっぺんの入母屋の屋根と、しゃちほこ代わりの小さな飾り
    const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.9, 2.4, 4), roof);
    cap.rotation.y = Math.PI / 4;
    cap.position.y = h + 1.6;
    g.add(cap);
    g.position.set(P.x, y - 2, P.z);
    g.scale.setScalar(1.55);   // 天守閣風の5層、高さ25mほど
    g.rotation.y = downhillYaw(P.x, P.z, 8);
    this.group.add(g);
    addSolid(P.x, P.z, 16, 16, g.rotation.y);
  }

  /** 三重塔の下の斜面に広がる墓地（灰色の墓石が段々に並ぶ） */
  _cemetery(px, pz) {
    const r = seededRandom('bochi');
    const yaw = downhillYaw(px, pz, 8);
    const fx = Math.sin(yaw), fz = Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw);
    const bases = [], stones = [];
    for (let a = 12; a < 40; a += 1.5) {          // 塔から坂の下へ
      for (let b = -22; b <= 22; b += 1.25) {      // 横へ
        if (r() < 0.18) continue;
        const x = px + fx * a + sx * b + (r() - 0.5) * 0.3, z = pz + fz * a + sz * b + (r() - 0.5) * 0.3;
        if (nearAnyRoad(x, z, 0.6) || inSolid(x, z) || inBuilding(x, z) || Math.hypot(x - px, z - pz) < 9) continue;
        if (this.occupied.has(Math.floor(x / 4) * 100003 + Math.floor(z / 4))) continue;
        const y = terrainY(x, z);
        // 墓石：台石・中台・竿石の三段。灰色の御影石が多く、ところどころ黒御影
        const black = r() < 0.15;
        const g = black ? 0.2 + r() * 0.05 : 0.42 + r() * 0.16;
        const c = new THREE.Color().setRGB(g, g * 0.99, g * 0.96);
        bases.push({ x, y: y + 0.12, z, sx: 0.78, sy: 0.26, sz: 0.74, ry: yaw, color: c.clone().multiplyScalar(0.9) });
        bases.push({ x, y: y + 0.36, z, sx: 0.56, sy: 0.22, sz: 0.52, ry: yaw, color: c });
        const h = 0.55 + r() * 0.35;
        stones.push({ x, y: y + 0.47 + h / 2, z, sx: 0.3, sy: h, sz: 0.27, ry: yaw, color: c.clone().multiplyScalar(1.05) });
        // 花立ての花（手前の両わき）
        if (r() < 0.55) for (const sd of [-1, 1]) {
          const fx2 = x + fx * 0.32 + sx * sd * 0.22, fz2 = z + fz * 0.32 + sz * sd * 0.22;
          stones.push({ x: fx2, y: y + 0.45, z: fz2, sx: 0.08, sy: 0.18, sz: 0.08, color: '#7a7670' });
          stones.push({ x: fx2, y: y + 0.58, z: fz2, sx: 0.1, sy: 0.1, sz: 0.1, color: ['#c8a838', '#b84a52', '#e6e0d6', '#8a5a98'][Math.floor(r() * 4)] });
        }
        // 卒塔婆（うしろに立てた木の板）
        if (r() < 0.3) for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
          const off = (k - 1) * 0.16;
          stones.push({ x: x - fx * 0.42 + sx * off, y: y + 0.85, z: z - fz * 0.42 + sz * off, sx: 0.07, sy: 1.4 + r() * 0.3, sz: 0.02, ry: yaw, rz: (r() - 0.5) * 0.08, color: '#cbb894' });
        }
      }
    }
    const mat = lam(0xffffff);
    this.group.add(instancedChunks(bases, mat, { detail: 90, cast: false }), instancedChunks(stones, mat, { detail: 90, cast: true }));
  }

  _pagoda(x, z) {
    const g = new THREE.Group();
    const wood = lam(0x4a3428), roof = lam(0x33373d);
    let y = 0;
    [5.2, 4.5, 3.8].forEach((s, i) => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(s * 0.7, 3.4, s * 0.7), wood);
      body.position.y = y + 1.7;
      body.castShadow = true;
      g.add(body);
      const rf = new THREE.Mesh(new THREE.ConeGeometry(s * 0.95, 1.6, 4, 1, true), roof);
      rf.rotation.y = Math.PI / 4;
      rf.position.y = y + 3.9;
      rf.castShadow = true;
      g.add(rf);
      const eave = new THREE.Mesh(new THREE.ConeGeometry(s * 0.95, 0.5, 4), roof);
      eave.rotation.y = Math.PI / 4;
      eave.position.y = y + 3.4;
      eave.scale.y = -1;
      g.add(eave);
      y += 3.9 - i * 0.1;
    });
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 5, 6), lam(0x6b5a3a));
    spire.position.y = y + 2.5;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(5, 1.5, 5), lam(0x8a857a));
    plinth.position.y = -0.5;
    g.add(spire, plinth);
    g.position.set(x, terrainY(x, z) - 0.2, z);
    g.scale.setScalar(1.45);
    g.rotation.y = 0.3;
    this.group.add(g);
    // Blender で作った三重塔（assets/models/pagoda.glb）が読めたら差しかえる。読めなければ上の簡単な塔のまま
    this._pagodaModel(x, z, g);
    this._pagodaGrounds(x, z);
  }

  /**
   * Blender のモデルを読んで、簡単な形（simple）と差しかえる。
   * 素材は町のほかの建物と同じ光の当たり方になるよう、色だけ受けついで Lambert に。
   * place(g, model) で位置や向きを決める。読めなければ simple のまま
   */
  async _swapModel(name, simple, place) {
    if (simple) simple.userData.noMerge = true;   // あとで模型に差しかえるので、まとめ描きに入れない
    if (!USE_MODELS) return null;
    try {
      const model = await loadModel(name);
      const mats = new Map();
      model.traverse((o) => {
        if (!o.isMesh) return;
        const src = o.material;
        if (!mats.has(src)) mats.set(src, this._modelMaterial(src));
        o.material = mats.get(src);
        o.castShadow = !o.material.transparent;
        o.receiveShadow = true;
      });
      const g = new THREE.Group();
      g.add(model);
      place(g, model);
      this.group.add(g);
      if (simple) {
        simple.parent?.remove(simple);
        simple.traverse((o) => o.geometry?.dispose());
      }
      (this.models ||= {})[name] = g;
      return g;
    } catch (e) {
      console.warn(`${name} のモデルを読めなかったので、簡単な形のままにします`, e);
      return null;
    }
  }

  /** 模型の中の長方形を、歩けない場所として登録する */
  _addSolids(fit, rects) {
    const c = Math.cos(fit.yaw), sn = Math.sin(fit.yaw);
    for (const [a, b, e, f] of rects) {
      const lx = (a + b) / 2, lz = (e + f) / 2;
      addSolid(fit.x + lx * c + lz * sn, fit.z - lx * sn + lz * c, b - a, f - e, fit.yaw);
    }
  }

  _modelMaterial(src) {
    const m = this._modelMaterialFor(src.name || '', src.color.getHex());
    m.name = src.name;
    src.dispose();
    return m;
  }

  _modelMaterialFor(n, color) {
    if (/glass/.test(n)) {
      // ガラス：夜は中の明かりで、ほんのり暖かく光る
      const m = lam(color, { transparent: true, opacity: 0.42, depthWrite: false, emissive: 0xffc890, emissiveIntensity: 0 });
      this.glowMats.push({ mat: m, base: 0, add: 0.55 });
      return m;
    }
    if (/interior_light/.test(n)) {
      // 駅の中の明かり：夜になると灯る
      const m = lam(color, { emissive: 0xffd29a, emissiveIntensity: 0.15 });
      this.glowMats.push({ mat: m, base: 0.15, add: 1.9 });
      return m;
    }
    if (/gold/.test(n)) return lam(color, { emissive: 0x2a2208 });
    return lam(color);
  }

  /** 三重塔のまわり：玉砂利、石の玉垣、参道の石灯籠、塔を囲む桜と松（尾道の、塔と桜の眺め） */
  /**
   * 尾道市立美術館：打ち放しのコンクリートの箱に、ガラスの正面と、木を組んだ深い庇。
   * 地図の輪郭（ふたつの建物）をまとめた範囲に、正面を海側（下り坂）へ向けて建てる
   */
  _museum(polys) {
    const pts = polys.flatMap((b) => { const a = []; for (let k = 0; k < b.p.length; k += 2) a.push([b.p[k], b.p[k + 1]]); return a; });
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs);
    const yMin = Math.min(...pts.map(([x, z]) => groundY(x, z)));
    const yaw = downhillYaw(cx, cz, 10);             // 正面（+Z）を下り坂へ
    const face = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);   // 地図の輪郭にそろえて90°刻みに
    const along = Math.abs(Math.sin(face)) > 0.5 ? d : w, deep = Math.abs(Math.sin(face)) > 0.5 ? w : d;
    const g = new THREE.Group();
    const concrete = lam(0xbdbab2), concDark = lam(0xa8a59e), glass = new THREE.MeshLambertMaterial({ color: 0x7f98a4, emissive: 0xffd8a0, emissiveIntensity: 0 });
    const wood = lam(0x9a7448), dark = lam(0x3a3836);
    const H = 7.5;
    const base = new THREE.Mesh(new THREE.BoxGeometry(along, 1.2, deep), concDark);
    base.position.y = -0.4;
    // 本体：奥の打ち放しの箱（2階建て）と、手前のガラスの吹き抜け
    const back = new THREE.Mesh(new THREE.BoxGeometry(along, H, deep * 0.62), concrete);
    back.position.set(0, H / 2, -deep * 0.19);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(along * 0.62, H - 1.2, deep * 0.34), glass);
    hall.position.set(-along * 0.12, (H - 1.2) / 2, deep * 0.3);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(along * 0.3, H - 2.5, deep * 0.34), concrete);
    wing.position.set(along * 0.35, (H - 2.5) / 2, deep * 0.3);
    [back, hall, wing].forEach((m) => { m.castShadow = true; m.receiveShadow = true; });
    g.add(base, back, hall, wing);
    // ガラスの縦の桟
    for (let x = -along * 0.43; x <= along * 0.19; x += 1.6) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, H - 1.2, 0.08), dark);
      m.position.set(x, (H - 1.2) / 2, deep * 0.47 + 0.02);
      g.add(m);
    }
    // 打ち放しの型枠の穴（Pコン）の目
    const dots = [];
    for (let x = -along / 2 + 0.6; x < along / 2; x += 0.9) for (let y = 0.45; y < H; y += 0.6) dots.push({ x, y, z: -deep * 0.5 - 0.01, sx: 0.05, sy: 0.05, sz: 0.02, color: '#8e8b84' });
    g.add(instancedBoxes(dots, lam(0xffffff), { cast: false }));
    // 木を組んだ深い庇（ガラスの吹き抜けの前、格子状）
    const lat = [];
    const ly = H - 0.9, lz0 = deep * 0.47, lz1 = deep * 0.47 + 4.5;
    for (let x = -along * 0.45; x <= along * 0.2; x += 0.7) lat.push({ x, y: ly, z: (lz0 + lz1) / 2, sx: 0.14, sy: 0.24, sz: lz1 - lz0, color: '#9a7448' });
    for (let z = lz0; z <= lz1; z += 0.7) lat.push({ x: -along * 0.12, y: ly - 0.26, z, sx: along * 0.66, sy: 0.14, sz: 0.14, color: '#8a6640' });
    g.add(instancedBoxes(lat, lam(0xffffff)));
    for (const x of [-along * 0.43, along * 0.18]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, ly, 0.3), wood);
      col.position.set(x, ly / 2, lz1 - 0.3);
      g.add(col);
    }
    // 館名
    const tex = labelTexture('尾道市立美術館', { w: 1024, h: 160, size: 92, bg: '#bdbab2', fg: '#3a3836' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.0), new THREE.MeshLambertMaterial({ map: tex }));
    sign.position.set(along * 0.35, H - 3.2, deep * 0.47 + 0.02);
    g.add(sign);
    g.position.set(cx, yMin + 0.6, cz);
    g.rotation.y = face;
    this.group.add(g);
    this.specialSignMats.push(glass);   // 夜はガラスの吹き抜けに灯り
    addSolid(cx, cz, Math.abs(Math.sin(face)) > 0.5 ? deep : along, Math.abs(Math.sin(face)) > 0.5 ? along : deep, 0);
  }

  _pagodaGrounds(x, z) {
    const r = seededRandom('tenneiji');
    const tb = new TriBatch();
    for (let a = -8; a < 8; a += 1.2) for (let b = -8; b < 8; b += 1.2) {
      if (Math.hypot(a, b) > 7.6) continue;
      const qx = x + a, qz = z + b;
      if (nearAnyRoad(qx + 0.6, qz + 0.6, 0)) continue;
      const v = 0.68 + r() * 0.06, col = new THREE.Color(v, v * 0.97, v * 0.92);
      const P = (px, pz) => [px, groundY(px, pz) + 0.05, pz];
      tb.quad(P(qx, qz), P(qx, qz + 1.2), P(qx + 1.2, qz + 1.2), P(qx + 1.2, qz), col);
    }
    const ground = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.6, polygonOffsetUnits: -1 }));
    ground.receiveShadow = true;
    this.group.add(ground);
    const parts = [], trunks = [], crowns = [];
    // 玉垣
    for (let a = 0; a < Math.PI * 2; a += 0.13) {
      const qx = x + Math.cos(a) * 7.8, qz = z + Math.sin(a) * 7.8;
      if (nearAnyRoad(qx, qz, 0.4)) continue;
      const y = groundY(qx, qz);
      parts.push({ x: qx, y: y + 0.4, z: qz, sx: 0.2, sy: 0.8, sz: 0.2, color: '#a49e92' });
      const mx = x + Math.cos(a + 0.065) * 7.8, mz = z + Math.sin(a + 0.065) * 7.8;
      parts.push({ x: mx, y: y + 0.65, z: mz, sx: 1.05, sy: 0.1, sz: 0.12, ry: -(a + 0.065) - Math.PI / 2, color: '#9a9488' });
    }
    // 石灯籠：塔のいちばん近い道のほうに一対
    const n = nearestRoad(x, z);
    if (n) {
      const dx = n.px - x, dz = n.pz - z, L = Math.hypot(dx, dz) || 1;
      for (const sd of [-1, 1]) {
        const qx = x + dx / L * 6 - dz / L * sd * 2.2, qz = z + dz / L * 6 + dx / L * sd * 2.2;
        if (nearAnyRoad(qx, qz, 0.3)) continue;
        const y = groundY(qx, qz);
        parts.push({ x: qx, y: y + 0.2, z: qz, sx: 0.8, sy: 0.4, sz: 0.8, color: '#a8a296' });
        parts.push({ x: qx, y: y + 0.85, z: qz, sx: 0.28, sy: 0.9, sz: 0.28, color: '#aaa498' });
        parts.push({ x: qx, y: y + 1.6, z: qz, sx: 0.44, sy: 0.4, sz: 0.44, color: '#b8b2a4' });
        parts.push({ x: qx, y: y + 1.95, z: qz, sx: 0.9, sy: 0.25, sz: 0.9, color: '#8e897e' });
        this.lampPositions.push([qx, y + 1.6, qz]);
        addSolid(qx, qz, 0.9, 0.9, 0);
      }
    }
    // 桜（春は薄紅、秋は少し色づく）と松
    const month = new Date().getMonth() + 1;
    const leaf = month === 3 || month === 4 ? ['#f2c4cf', '#eab4c2', '#f6d4dc'] : month === 10 || month === 11 ? ['#c86a3a', '#6a8444', '#b8803a'] : ['#5f8a44', '#6e9a4c', '#557c3c'];
    let placed = 0;
    for (let k = 0; k < 24 && placed < 7; k++) {
      const a = r() * Math.PI * 2, d = 9.5 + r() * 6;
      const qx = x + Math.cos(a) * d, qz = z + Math.sin(a) * d;
      if (nearAnyRoad(qx, qz, 2.2) || inBuilding(qx, qz) || inSolid(qx, qz)) continue;
      placed++;
      const y = groundY(qx, qz);
      const pine = placed % 3 === 0;
      const h = pine ? 6 + r() * 2 : 4.5 + r() * 1.5;
      trunks.push({ x: qx, y: y + h / 2, z: qz, sx: 0.3, sy: h, sz: 0.3, rz: (r() - 0.5) * 0.25, color: pine ? '#5a4636' : '#4e3a30' });
      if (pine) {
        for (let j = 0; j < 3; j++) crowns.push({ x: qx + (r() - 0.5) * 1.5, y: y + h - 1.6 + j * 0.9, z: qz + (r() - 0.5) * 1.5, sx: 3.2 - j * 0.6, sy: 1, sz: 2.8 - j * 0.5, ry: r() * 6, color: '#3e5a34' });
      } else {
        for (let j = 0; j < 4; j++) crowns.push({ x: qx + (r() - 0.5) * 3, y: y + h - 0.4 + r() * 1.2, z: qz + (r() - 0.5) * 3, sx: 2.8 + r() * 1.2, sy: 1.8 + r() * 0.6, sz: 2.8 + r() * 1.2, ry: r() * 6, color: leaf[j % 3] });
      }
      addSolid(qx, qz, 0.8, 0.8, 0);
    }
    this.group.add(instancedChunks(parts, lam(0xffffff), { detail: 80 }));
    if (trunks.length) {
      this.group.add(instancedChunks(trunks, lam(0xffffff), { geo: new THREE.CylinderGeometry(0.4, 0.55, 1, 6) }));
      this.group.add(instancedChunks(crowns, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(0.6, 1) }));
    }
  }

  _pagodaModel(x, z, simple) {
    this._swapModel('pagoda', simple, (g) => {
      // 坂に建つので、基壇の下を石垣で地面まで埋める
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(9.6, 3, 9.6), lam(0xb3ab9c));
      skirt.position.y = -1.5;
      skirt.receiveShadow = true;
      g.add(skirt);
      const y = Math.min(...[-4.8, 4.8].flatMap((dx) => [-4.8, 4.8].map((dz) => terrainY(x + dx, z + dz))));
      g.position.set(x, Math.max(y, terrainY(x, z) - 0.6), z);
      g.rotation.y = 0.3;
    }).then((g) => { this.pagodaModel = g; });
  }

  /** 駅舎：OSM の輪郭のいちばん長い辺の向きにそろえ、正面（+Z）を駅前広場へ */
  _stationModel() {
    const poly = this.stationPoly;
    const cx = poly.reduce((s2, p) => s2 + p[0], 0) / poly.length, cz = poly.reduce((s2, p) => s2 + p[1], 0) / poly.length;
    let best = 0, ang = 0;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L > best) { best = L; ang = Math.atan2(bz - az, bx - ax); }
    }
    // 輪郭を長い辺の向きに回して、大きさをはかる
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    const us = poly.map(([x, z]) => (x - cx) * ca - (z - cz) * sa), vs = poly.map(([x, z]) => (x - cx) * sa + (z - cz) * ca);
    const len = Math.max(...us) - Math.min(...us), dep = Math.max(...vs) - Math.min(...vs);
    const mx = cx + ((Math.max(...us) + Math.min(...us)) / 2) * Math.cos(ang) - ((Math.max(...vs) + Math.min(...vs)) / 2) * Math.sin(ang);
    const mz = cz + ((Math.max(...us) + Math.min(...us)) / 2) * Math.sin(ang) + ((Math.max(...vs) + Math.min(...vs)) / 2) * Math.cos(ang);
    const yMin = Math.min(...poly.map(([x, z]) => groundY(x, z)));
    // 歩道橋・テラス・駅前の店の位置合わせに使う（モデルと同じ大きさのはかり方）
    this.stationFrame = { mx, mz, ang, len, dep, yMin, sx: Math.min(1.15, Math.max(0.8, len / 50)), sz: Math.min(1.15, Math.max(0.8, dep / 22)) };
    this._swapModel('station', this.stationSimple, (g, model) => {
      // モデルは 50m × 約22m。輪郭に合わせて少しだけ伸び縮みさせる
      model.scale.set(Math.min(1.15, Math.max(0.8, len / 50)), 1, Math.min(1.15, Math.max(0.8, dep / 22)));
      g.position.set(mx, yMin, mz);
      // 長い辺の向きに +X をそろえる。正面 +Z は、駅前広場（線路と反対の、海側）を向く
      g.rotation.y = -ang;
      const C = this.stationCenter;
      const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y);
      if (C && (C.x - mx) * front.x + (C.z - mz) * front.z < 0) g.rotation.y += Math.PI;
      // 入口の上の看板
      let sign = null;
      model.traverse((o) => { if (o.isMesh && o.material.name === 'sign') sign = o; });
      const box = new THREE.Box3();
      if (sign) box.setFromObject(sign); else box.set(new THREE.Vector3(-4, 4.2, 12), new THREE.Vector3(4, 5.2, 12.1));
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: labelTexture('尾道駅', { w: 512, h: 128, size: 76, bg: '#2a2c30', fg: '#f4efe4' }), emissive: 0xffffff, emissiveIntensity: 0.2 }));
      label.material.emissiveMap = label.material.map;
      this.specialSignMats.push(label.material);
      const size = box.getSize(new THREE.Vector3());
      label.scale.set(Math.min(size.x * 0.9, size.y * 4), size.y * 0.85, 1);
      label.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z + 0.03);
      model.add(label);
    });
  }

  _shrine(x, z) {
    const y = terrainY(x, z);
    const simple = new THREE.Group();
    this.group.add(simple);
    const vermilion = lam(0xc8442e);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(6, 3.5, 5), lam(0x7a5a3e));
    hall.position.set(x, y + 1.5, z + 3);
    hall.castShadow = true;
    const hallRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.4, 4), lam(0x3a3f46));
    hallRoof.rotation.y = Math.PI / 4;
    hallRoof.position.set(x, y + 4.3, z + 3);
    simple.add(hall, hallRoof);
    // 鳥居は、いちばん近い道の上に
    const torii = new THREE.Group();
    for (const sx of [-1.4, 1.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 3.6, 10), vermilion);
      post.position.set(sx, 1.8, 0);
      torii.add(post);
    }
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.28, 0.4), lam(0x2a2422));
    kasagi.position.y = 3.7;
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 0.25), vermilion);
    nuki.position.y = 3.1;
    torii.add(kasagi, nuki);
    torii.position.set(x, terrainY(x, z - 6), z - 6);
    simple.add(torii);
    // 境内の大きな楠
    const kusu = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 8, 8), lam(0x4a3a2e));
    trunk.position.y = 4;
    kusu.add(trunk);
    for (let i = 0; i < 6; i++) {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + this.r() * 1.5, 1), lam(0x2f4a28, { flatShading: true }));
      crown.position.set((this.r() - 0.5) * 6, 8 + this.r() * 4, (this.r() - 0.5) * 6);
      crown.castShadow = true;
      kusu.add(crown);
    }
    kusu.position.set(x + 7, terrainY(x + 7, z + 1), z + 1);
    simple.add(kusu);
    // 拝殿・本殿・狛犬・石灯籠・鳥居と、大きな楠。参道（正面）は坂の下へ
    // 拝殿・本殿・楠の幹は道にかからず、参道（鳥居から拝殿まで）ができるだけ道の上にくる場所と向きに
    const fit = MODEL_FITS.ushitora;
    this._swapModel('ushitora', simple, (g) => {
      g.position.set(fit.x, terrainY(fit.x, fit.z) - 0.15, fit.z);
      g.rotation.y = fit.yaw;
      this._addSolids(fit, MODEL_RECTS.ushitora);
    });
    if (fit) this._shrineGrounds(fit);
  }

  /**
   * 艮神社の境内：玉砂利の地面、石の玉垣、手水舎、絵馬掛け、そして境内をおおう楠の大木（いちばん太い木には注連縄）。
   * 楠は、上を通るロープウェイのゴンドラにかからない高さまで
   */
  _shrineGrounds(fit) {
    const r = this.r;
    const c = Math.cos(fit.yaw), sn = Math.sin(fit.yaw);
    const W = (lx, lz) => ({ x: fit.x + lx * c + lz * sn, z: fit.z - lx * sn + lz * c });
    // ロープウェイの、その場所でのいちばん低いゴンドラの下端
    const cableY = (x, z) => {
      let low = Infinity;
      if (!this.cablePoint) return low;
      for (let i = 0; i <= 160; i++) for (const sd of [-1, 1]) {
        const p = this.cablePoint(i / 160, sd);
        if (Math.hypot(p.x - x, p.z - z) < 10) low = Math.min(low, p.y - 6);
      }
      return low;
    };
    // 玉砂利（境内の地面）：拝殿のまわり、半径13mほど
    const tb = new TriBatch();
    const cell = 1.5;
    for (let lx = -13; lx < 13; lx += cell) for (let lz = -12; lz < 13; lz += cell) {
      if (Math.hypot(lx, lz * 0.9) > 13) continue;
      const q = W(lx + cell / 2, lz + cell / 2);
      if (inBuilding(q.x, q.z)) continue;
      const v = 0.7 + r() * 0.06;
      const col = new THREE.Color(v, v * 0.98, v * 0.93);
      const P = (ax, az) => { const w = W(ax, az); return [w.x, groundY(w.x, w.z) + 0.04, w.z]; };
      tb.quad(P(lx, lz), P(lx, lz + cell), P(lx + cell, lz + cell), P(lx + cell, lz), col);
    }
    const gravel = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.6, polygonOffsetUnits: -1 }));
    gravel.receiveShadow = true;
    this.group.add(gravel);
    // 石の玉垣：境内のふち（参道の正面と、道が通るところは空ける）
    const fence = [];
    for (let a = 0; a < Math.PI * 2; a += 0.09) {
      const lx = Math.sin(a) * 13.4, lz = Math.cos(a) * 12.4;
      if (lz > 9 && Math.abs(lx) < 3.5) continue;   // 正面の入口
      const q = W(lx, lz);
      if (nearAnyRoad(q.x, q.z, 0.4) || inBuilding(q.x, q.z)) continue;
      const y = groundY(q.x, q.z);
      fence.push({ x: q.x, y: y + 0.45, z: q.z, sx: 0.22, sy: 0.9, sz: 0.22, color: '#a49e92' });
      const q2 = W(Math.sin(a + 0.045) * 13.4, Math.cos(a + 0.045) * 12.4), q3 = W(Math.sin(a + 0.09) * 13.4, Math.cos(a + 0.09) * 12.4);
      const ry = -Math.atan2(q3.z - q.z, q3.x - q.x);
      fence.push({ x: q2.x, y: y + 0.75, z: q2.z, sx: 1.25, sy: 0.12, sz: 0.14, ry, color: '#9a9488' });
      fence.push({ x: q2.x, y: y + 0.35, z: q2.z, sx: 1.25, sy: 0.1, sz: 0.12, ry, color: '#9a9488' });
    }
    if (fence.length) this.group.add(instancedChunks(fence, lam(0xffffff), { detail: 80 }));
    // 手水舎（参道の右）と、絵馬掛け（左）
    const parts = [];
    const sq = W(5.5, 6.5), sy = groundY(sq.x, sq.z);
    for (const [px, pz] of [[-1, -0.8], [1, -0.8], [-1, 0.8], [1, 0.8]]) { const q = W(5.5 + px, 6.5 + pz); parts.push({ x: q.x, y: sy + 1.1, z: q.z, sx: 0.16, sy: 2.2, sz: 0.16, color: '#5a3e2c' }); }
    parts.push({ x: sq.x, y: sy + 2.35, z: sq.z, sx: 3, sy: 0.25, sz: 2.4, ry: fit.yaw, color: '#3c4148' });
    parts.push({ x: sq.x, y: sy + 0.45, z: sq.z, sx: 1.5, sy: 0.7, sz: 0.8, ry: fit.yaw, color: '#8f8a80' });   // 水盤
    parts.push({ x: sq.x, y: sy + 0.81, z: sq.z, sx: 1.3, sy: 0.04, sz: 0.6, ry: fit.yaw, color: '#4a6a7a' }); // 水
    addSolid(sq.x, sq.z, 2.4, 2.2, -fit.yaw);
    const em = W(-5.5, 5), ey = groundY(em.x, em.z);
    for (const px of [-1.2, 1.2]) { const q = W(-5.5 + px, 5); parts.push({ x: q.x, y: ey + 0.8, z: q.z, sx: 0.12, sy: 1.6, sz: 0.12, color: '#5a3e2c' }); }
    parts.push({ x: em.x, y: ey + 1.65, z: em.z, sx: 2.8, sy: 0.12, sz: 0.5, ry: fit.yaw, color: '#3c4148' });
    for (let k = 0; k < 14; k++) {
      const u = -1.05 + (k % 7) * 0.35, v = k < 7 ? 1.35 : 1.0;
      const q = W(-5.5 + u, 5.02);
      parts.push({ x: q.x, y: ey + v, z: q.z, sx: 0.28, sy: 0.2, sz: 0.03, ry: fit.yaw, color: ['#d8c098', '#c8a878', '#e0caa0'][k % 3] });
    }
    parts.push({ x: em.x, y: ey + 1.2, z: em.z, sx: 2.4, sy: 0.05, sz: 0.05, ry: fit.yaw, color: '#5a3e2c' });
    addSolid(em.x, em.z, 2.8, 0.6, -fit.yaw);
    this.group.add(instancedChunks(parts, lam(0xffffff), { detail: 80 }));
    // 楠の大木：境内のまわりに3本（模型の1本とあわせて4本）。太い幹から枝が四方へひろがり、境内に影を落とす
    const bark = lam(0x4a3f34), crowns = [];
    const spots = [[-9.5, -3], [-7, -12], [9.5, -11]];
    spots.forEach(([lx, lz], ti) => {
      const q = W(lx, lz);
      if (nearAnyRoad(q.x, q.z, 1.5) || inBuilding(q.x, q.z)) return;
      const y = groundY(q.x, q.z);
      const big = ti === 0;
      const R = big ? 1.5 : 1.0 + r() * 0.3;
      const limit = cableY(q.x, q.z);
      const top = Math.min(y + (big ? 22 : 17 + r() * 4), limit);
      if (top - y < 9) return;
      const trunkH = (top - y) * 0.32;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.75, R, trunkH, 9), bark);
      trunk.position.set(q.x, y + trunkH / 2, q.z);
      trunk.castShadow = true;
      this.group.add(trunk);
      // 根の張り出し
      for (let k = 0; k < 5; k++) {
        const a = k * 1.26 + r() * 0.4;
        const root = new THREE.Mesh(new THREE.ConeGeometry(R * 0.45, 2.2, 5), bark);
        root.position.set(q.x + Math.cos(a) * R * 0.9, y + 0.35, q.z + Math.sin(a) * R * 0.9);
        root.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
        this.group.add(root);
      }
      // 太い枝（4本、斜め上へ）と、その先の葉のかたまり
      const spread = big ? 10 : 7.5;
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + r() * 0.8;
        const len = spread * (0.75 + r() * 0.3);
        const from = new THREE.Vector3(q.x, y + trunkH - 0.4, q.z);
        const to = new THREE.Vector3(q.x + Math.cos(a) * len * 0.8, y + trunkH + (top - y - trunkH) * 0.55, q.z + Math.sin(a) * len * 0.8);
        const d = to.clone().sub(from);
        const limb = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.28, R * 0.5, d.length(), 6), bark);
        limb.position.copy(from).addScaledVector(d, 0.5);
        limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        limb.castShadow = true;
        this.group.add(limb);
        for (let j = 0; j < 4; j++) {
          crowns.push({ x: to.x + (r() - 0.5) * 6, y: Math.min(top - 2.5, to.y + 1 + r() * 3.5), z: to.z + (r() - 0.5) * 6, sx: 6 + r() * 3, sy: 3.5 + r() * 2, sz: 6 + r() * 3, ry: r() * 6, color: ['#2f4a28', '#3b5a2f', '#28401f', '#35522c'][Math.floor(r() * 4)] });
        }
      }
      crowns.push({ x: q.x, y: top - 2.5, z: q.z, sx: 9, sy: 4.5, sz: 9, ry: r() * 6, color: '#2f4a28' });
      addSolid(q.x, q.z, R * 2.2, R * 2.2, 0);
      // いちばん太い木には、注連縄と紙垂
      if (big) {
        const rope = new THREE.Mesh(new THREE.TorusGeometry(R * 0.93, 0.13, 6, 18), lam(0xcdb98a));
        rope.rotation.x = Math.PI / 2;
        rope.position.set(q.x, y + 2.2, q.z);
        this.group.add(rope);
        for (let k = 0; k < 6; k++) {
          const a = k * Math.PI / 3;
          const shide = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.42), lam(0xf4f1ea, { side: THREE.DoubleSide }));
          shide.position.set(q.x + Math.cos(a) * R * 0.98, y + 1.9, q.z + Math.sin(a) * R * 0.98);
          shide.rotation.y = -a + Math.PI / 2;
          this.group.add(shide);
        }
      }
    });
    if (crowns.length) this.group.add(instancedChunks(crowns, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(0.5, 1) }));
  }

  // ---------- 渡船のりば・ベンチ ----------
  _piersAndBenches() {
    const pontoonMat = lam(0x9a9890), hutMat = lam(0xe8e2d4);
    const signTex = labelTexture('渡船のりば', { w: 512, h: 128, size: 72, bg: '#1f3b5a', fg: '#f4efe4' });
    const mukaiTex = labelTexture('向 島 行 渡 船 の り ば', { w: 1024, h: 128, size: 76, bg: '#f4f2ec', fg: '#1f3b8a' });
    const archMat = lam(0x5e9a72, { side: THREE.DoubleSide }), poleMat = lam(0xe8e6e0);
    // 浮き桟橋：緑の床の台船、ふちに古タイヤの防舷材。岸からは、赤い手すりの渡り橋（写真の福本渡船のように）
    const deckMat = lam(0x5f7a5a), tireMat = lam(0x1e1e20), redMat = lam(0xb8403a), rampMat = lam(0x8a8680);
    const tireGeo = new THREE.TorusGeometry(0.42, 0.16, 6, 10);
    FERRY_ROUTES.forEach((route, ri) => {
      for (const end of [route.a, route.b]) {
        const other = end === route.a ? route.b : route.a;
        const dir = Math.atan2(other.z - end.z, other.x - end.x);   // 海へ向かう向き
        const g = new THREE.Group();
        g.position.set(end.x, SEA_Y, end.z);
        g.rotation.y = -dir;
        const p = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 9), pontoonMat);
        p.position.y = 0.6;
        p.receiveShadow = true;
        const top = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.06, 8.6), deckMat);
        top.position.y = 1.23;
        g.add(p, top);
        for (const sz of [4.6, -4.6]) {
          for (let k = 0; k < 7; k++) {
            const tire = new THREE.Mesh(tireGeo, tireMat);
            tire.position.set(-4.2 + k * 1.4, 0.55, sz);
            g.add(tire);
          }
        }
        // 岸から台船へ、ゆるく下る渡り橋（赤い手すり）。岸までの長さをはかる
        let L = 6;
        for (let d = 5; d < 40; d += 0.5) {
          if (groundY(end.x - Math.cos(dir) * d, end.z - Math.sin(dir) * d) > SEA_Y + 1.2) { L = Math.max(4, d - 5 + 1); break; }
        }
        const shoreY = Math.max(groundY(end.x - Math.cos(dir) * (L + 5), end.z - Math.sin(dir) * (L + 5)), SEA_Y + 2);
        const drop = shoreY - (SEA_Y + 1.25);
        const ramp = new THREE.Group();
        ramp.position.set(-5 - L / 2, 1.25 + drop / 2, 0);
        ramp.rotation.z = -Math.atan2(drop, L);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(L, drop), 0.25, 3.2), rampMat);
        ramp.add(deck);
        for (const sz of [-1.55, 1.55]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(L, drop), 0.1, 0.1), redMat);
          rail.position.set(0, 1.0, sz);
          ramp.add(rail);
          for (let k = -4; k <= 4; k++) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), redMat);
            post.position.set(k * Math.hypot(L, drop) / 9, 0.5, sz);
            ramp.add(post);
          }
        }
        g.add(ramp);
        this.group.add(g);
      }
      // 尾道側に待合の小屋
      const a = route.a;
      const dir = Math.atan2(route.b.z - a.z, route.b.x - a.x);
      const hx = a.x - Math.cos(dir) * 14, hz = a.z - Math.sin(dir) * 14;
      const hy = terrainY(hx, hz);
      if (!nearAnyRoad(hx, hz, 0)) {
        const hut = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3), hutMat);
        hut.position.set(hx, hy + 1.3, hz);
        hut.castShadow = true;
        this.group.add(hut);
      }
      const ax = a.x - Math.cos(dir) * 8, az = a.z - Math.sin(dir) * 8, ay = terrainY(ax, az);
      if (ri === 0) {
        // 尾道渡船（向島行）：のりばの入口に、緑の屋根のアーチ
        const arch = new THREE.Group();
        arch.position.set(ax, ay, az);
        arch.rotation.y = -dir + Math.PI / 2;
        // 半円筒の屋根（軸は通路の向き）
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 3, 24, 1, true, Math.PI / 2, Math.PI), archMat);
        roof.rotation.x = Math.PI / 2;
        roof.position.y = 0.6;
        arch.add(roof);
        // 夜はアーチの下が明るく灯る（写真の夜の渡船のりば）
        const archLight = new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0 });
        this.nightMats.push({ mat: archLight, max: 0.9 });
        const glowPanel = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.6), archLight);
        glowPanel.rotation.x = Math.PI / 2;
        glowPanel.position.y = 3.5;
        arch.add(glowPanel);
        for (const sx of [-3.1, 3.1]) {
          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), poleMat);
          pole.position.set(sx, 0.35, 0);
          arch.add(pole);
        }
        for (const flip of [0, Math.PI]) {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.55), new THREE.MeshBasicMaterial({ map: mukaiTex }));
          sign.position.set(0, 3.0, 0);
          sign.rotation.y = flip;
          sign.translateZ(1.52);
          arch.add(sign);
        }
        this.group.add(arch);
      } else {
        for (const flip of [0, Math.PI]) {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: signTex }));
          sign.position.set(ax, ay + 3.2, az);
          sign.rotation.y = -dir + Math.PI / 2 + flip;
          sign.translateZ(0.02);
          this.group.add(sign);
        }
      }
    });
    // 海沿いのベンチ：木の背もたれつきと、雨風で銀色になった板張りの広い腰掛け
    const boxes = [];
    const r = this.r;
    for (const b of BENCHES) {
      const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
      const put = (lx, ly, lz, sx, sy, sz, color, rx = 0) => boxes.push({
        x: b.x + lx * c + lz * sn, y: b.y + ly, z: b.z - lx * sn + lz * c, sx, sy, sz, ry: b.yaw, rx, color,
      });
      if (b.style === 'deck') {
        const g = 0.55 + r() * 0.06;
        const grey = new THREE.Color(g, g * 0.98, g * 0.93);
        for (let i = 0; i < 8; i++) put(0, 0.42, -0.42 + i * 0.12, 2.2, 0.045, 0.1, grey.clone().offsetHSL(0, 0, (r() - 0.5) * 0.05));
        for (const sx of [-0.95, 0, 0.95]) put(sx, 0.2, 0, 0.08, 0.4, 0.9, '#5d5a55');
      } else {
        const wood = new THREE.Color(0x8a6a4a).offsetHSL(0, 0, (r() - 0.5) * 0.06);
        for (let i = 0; i < 3; i++) put(0, 0.45, -0.16 + i * 0.16, 1.8, 0.05, 0.12, wood);
        put(0, 0.72, 0.24, 1.8, 0.35, 0.05, wood, -0.15);
        for (const sx of [-0.75, 0.75]) put(sx, 0.22, 0, 0.06, 0.45, 0.45, '#2f3336');
      }
    }
    this.group.add(instancedChunks(boxes, lam(0xffffff), { detail: 110 }));

    // 海沿いの遊歩道の、丸い笠の街灯（ベンチふたつにひとつ、緑の柱に乳白の玉がふたつ）
    const poles = [], globes = [];
    BENCHES.forEach((b, i) => {
      if (i % 2) return;
      const x = b.x + Math.cos(b.yaw) * 1.7, z = b.z - Math.sin(b.yaw) * 1.7;
      const y = groundY(x, z);
      poles.push({ x, y: y + 2.1, z, sx: 0.12, sy: 4.2, sz: 0.12, color: '#2f4a44' });
      for (const side of [-1, 1]) {
        const gx = x + Math.cos(b.yaw) * side * 0.32, gz = z - Math.sin(b.yaw) * side * 0.32;
        globes.push({ x: gx, y: y + 4.05 + (side > 0 ? 0.12 : 0), z: gz, sx: 0.42, sy: 0.42, sz: 0.42 });
        this.lampPositions.push([gx, y + 4.1, gz]);
      }
    });
    this.group.add(instancedChunks(poles, lam(0xffffff), { detail: 120, receive: false, geo: new THREE.CylinderGeometry(0.5, 0.6, 1, 6) }));
    this.globeMat = new THREE.MeshLambertMaterial({ color: 0xf4ead6, emissive: 0xffa040, emissiveIntensity: 0 });
    this.group.add(instancedChunks(globes, this.globeMat, { cast: false, receive: false, geo: new THREE.SphereGeometry(0.5, 12, 10) }));
  }

  /** 猫の細道の、猫の絵を描いた丸い石 */
  /**
   * 猫の細道：道ばたの「福石猫」（丸い石に猫の顔を描いたもの）を、親子や兄弟のように寄りそわせて並べる。
   * 毛色は4種類（茶トラ・黒・白ぶち・三毛）。ところどころに招き猫の置物、植木鉢、木の案内板
   */
  _nekoStones() {
    const r = seededRandom('neko-stones');
    const coats = [
      { base: '#f2ece0', patch: '#e09a50', stripe: 'rgba(170,90,30,0.7)', ear: '#e09a50' },   // 茶トラ
      { base: '#2a2624', patch: null, stripe: null, ear: '#2a2624', eye: '#e8c040' },          // 黒
      { base: '#f4f0e8', patch: '#6a6660', stripe: null, ear: '#6a6660' },                     // 白ぶち
      { base: '#f4f0e8', patch: '#d8843e', patch2: '#2e2925', stripe: null, ear: '#d8843e' },  // 三毛
    ];
    const mats = coats.map((c) => new THREE.MeshLambertMaterial({ map: canvasTexture(256, 128, (g, w, h) => {
      g.fillStyle = c.base; g.fillRect(0, 0, w, h);
      const cx = w * 0.25, cy = h * 0.52;
      if (c.patch) { g.fillStyle = c.patch; g.beginPath(); g.ellipse(cx + 70, cy - 20, 50, 34, 0.3, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(cx - 18, cy - 26, 20, 14, 0, 0, Math.PI * 2); g.fill(); }
      if (c.patch2) { g.fillStyle = c.patch2; g.beginPath(); g.ellipse(cx + 20, cy - 30, 16, 11, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(cx + 150, cy, 40, 28, 0, 0, Math.PI * 2); g.fill(); }
      if (c.stripe) { g.strokeStyle = c.stripe; g.lineWidth = 5; for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(cx + 40 + k * 16, 10); g.lineTo(cx + 34 + k * 16, 70); g.stroke(); } }
      // 耳（顔の上に小さな三角）
      g.fillStyle = c.ear;
      for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(cx + sd * 26, cy - 18); g.lineTo(cx + sd * 22, cy - 44); g.lineTo(cx + sd * 6, cy - 26); g.fill(); }
      // 顔：目は、ねむそうな弧か、まるい目
      const line = c.base === '#2a2624' ? '#f4f0e8' : '#2a2420';
      g.strokeStyle = line; g.fillStyle = c.eye || line; g.lineWidth = 3;
      if (c.eye) { for (const sd of [-1, 1]) { g.beginPath(); g.arc(cx + sd * 11, cy - 2, 4, 0, Math.PI * 2); g.fill(); } }
      else for (const sd of [-1, 1]) { g.beginPath(); g.arc(cx + sd * 11, cy - 4, 5, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
      g.fillStyle = '#d87a7a'; g.beginPath(); g.moveTo(cx - 3, cy + 4); g.lineTo(cx + 3, cy + 4); g.lineTo(cx, cy + 8); g.fill();
      g.beginPath(); g.moveTo(cx, cy + 8); g.quadraticCurveTo(cx - 4, cy + 13, cx - 8, cy + 10); g.moveTo(cx, cy + 8); g.quadraticCurveTo(cx + 4, cy + 13, cx + 8, cy + 10); g.stroke();
      g.lineWidth = 1.5;
      for (const sd of [-1, 1]) for (const k of [-1, 1]) { g.beginPath(); g.moveTo(cx + sd * 12, cy + 7 + k * 2); g.lineTo(cx + sd * 30, cy + 4 + k * 5); g.stroke(); }
    }) }));
    const geo = new THREE.SphereGeometry(0.3, 18, 12);
    const stones = coats.map(() => []);
    const figs = [], pots = [], plants = [];
    const roads = ROADS.filter((rd) => rd.name === '猫の細道');
    for (const road of roads) {
      const s = samplePath(road.pts, 1);
      for (let i = 3; i < s.length - 2; i += 3 + Math.floor(r() * 3)) {
        const p = s[i];
        const side = r() < 0.5 ? 1 : -1;
        const off = road.width / 2 + 0.05;
        const nx = -Math.sin(p.angle) * side, nz = Math.cos(p.angle) * side;
        const x = p.x + nx * off, z = p.z + nz * off;
        if (inBuilding(x, z)) continue;
        // 親子・兄弟：1〜3個を寄せて、道のほうを向ける
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const sc = k === 0 ? 0.8 + r() * 0.5 : 0.45 + r() * 0.3;
          const u = (k - (n - 1) / 2) * 0.42;
          const sx = x + Math.cos(p.angle) * u - nx * 0.05 * k, sz = z + Math.sin(p.angle) * u - nz * 0.05 * k;
          stones[Math.floor(r() * coats.length)].push({ x: sx, z: sz, y: groundY(sx, sz) + 0.21 * sc, sc, ry: Math.atan2(-nx, -nz) + (r() - 0.5) * 0.6 });
        }
        // ときどき、招き猫の置物か、植木鉢
        const q = r();
        if (q < 0.18) {
          const fx = x + Math.cos(p.angle) * 0.9, fz = z + Math.sin(p.angle) * 0.9, fy = groundY(fx, fz);
          figs.push({ x: fx, y: fy, z: fz, ry: Math.atan2(-nx, -nz) });
        } else if (q < 0.4) {
          const fx = x - Math.cos(p.angle) * 0.8, fz = z - Math.sin(p.angle) * 0.8, fy = groundY(fx, fz), s2 = 0.3 + r() * 0.15;
          pots.push({ x: fx, y: fy + s2 / 2, z: fz, sx: s2, sy: s2, sz: s2, color: ['#b0563a', '#8a5a3a', '#c8b89a'][Math.floor(r() * 3)] });
          plants.push({ x: fx, y: fy + s2 + 0.15, z: fz, sx: s2 * 1.5, sy: 0.4, sz: s2 * 1.5, color: r() < 0.3 ? ['#d84a6a', '#f0c030', '#e8e4f0'][Math.floor(r() * 3)] : ['#3e6e34', '#4f7c3e'][Math.floor(r() * 2)] });
        }
      }
    }
    stones.forEach((list, ci) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mats[ci], list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      list.forEach((st, k) => {
        // 球の UV の正面（u=0.25）は +Z。顔を道へ向ける
        q.setFromEuler(e.set(0, st.ry, 0));
        m.compose(new THREE.Vector3(st.x, st.y, st.z), q, new THREE.Vector3(st.sc, st.sc * 0.72, st.sc * 0.92));
        mesh.setMatrixAt(k, m);
      });
      mesh.castShadow = true;
      this.group.add(mesh);
    });
    // 招き猫（白い陶器、赤い首輪、片手をあげる）
    if (figs.length) {
      const white = lam(0xf2eee6), red = lam(0xc8302a), gold = lam(0xd8b048);
      for (const f of figs) {
        const g = new THREE.Group();
        g.position.set(f.x, f.y, f.z);
        g.rotation.y = f.ry;
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), white); body.scale.set(1, 1.15, 0.9); body.position.y = 0.14;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), white); head.position.y = 0.33; head.scale.set(1.1, 0.95, 0.95);
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.015, 6, 14), red); collar.rotation.x = Math.PI / 2; collar.position.y = 0.25;
        const bell = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), gold); bell.position.set(0, 0.23, 0.08);
        const paw = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), white); paw.position.set(0.11, 0.4, 0.03);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.14, 6), white); arm.position.set(0.11, 0.32, 0.03);
        g.add(body, head, collar, bell, paw, arm);
        for (const sd of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 4), white); ear.position.set(sd * 0.06, 0.43, 0); g.add(ear); }
        g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this.group.add(g);
      }
    }
    if (pots.length) {
      this.group.add(instancedChunks(pots, lam(0xffffff), { detail: 60, geo: new THREE.CylinderGeometry(0.5, 0.38, 1, 8) }));
      this.group.add(instancedChunks(plants, lam(0xffffff, { flatShading: true }), { detail: 60, geo: new THREE.IcosahedronGeometry(0.5, 0) }));
    }
    // 下の入口に、木の案内板「猫の細道」
    const all = roads.flatMap((rd) => [rd.pts[0], rd.pts[rd.pts.length - 1]]);
    if (all.length) {
      const low = all.reduce((a, b) => (groundY(a[0], a[1]) < groundY(b[0], b[1]) ? a : b));
      const n = nearestRoad(low[0], low[1]);
      const ang = n ? Math.atan2(n.seg.dz, n.seg.dx) : 0;
      const hw = n ? n.seg.half : 1;
      const x = low[0] - Math.sin(ang) * (hw + 0.6), z = low[1] + Math.cos(ang) * (hw + 0.6), y = groundY(x, z);
      const tex = labelTexture('猫の細道', { w: 128, h: 448, size: 96, bg: '#6a4a32', fg: '#f4ead8', vertical: true });
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.9, 0.12), new THREE.MeshLambertMaterial({ map: tex }));
      post.position.set(x, y + 0.95, z);
      post.rotation.y = Math.atan2(low[0] - x, low[1] - z) + Math.PI / 2;
      post.castShadow = true;
      this.group.add(post);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.2), lam(0x4a3424));
      cap.position.set(x, y + 1.93, z);
      cap.rotation.y = post.rotation.y;
      this.group.add(cap);
      // てっぺんに、木彫りの猫の頭
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), lam(0x8a6a48));
      head.position.set(x, y + 2.08, z);
      this.group.add(head);
      for (const sd of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 4), lam(0x8a6a48));
        ear.position.set(x + Math.cos(post.rotation.y) * sd * 0.08, y + 2.2, z - Math.sin(post.rotation.y) * sd * 0.08);
        this.group.add(ear);
      }
      addSolid(x, z, 0.3, 0.3, 0);
    }
  }

  /** 空き家の窓の左手に見える松 */
  _pine() {
    const leaf = lam(0x2f4a2a, { flatShading: true });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    [[-8, 5.5, -13, 1.6], [-9.5, 4.7, -14.5, 1.9], [-7.2, 6.4, -15, 1.3], [-10.6, 6, -12.5, 1.5]].forEach(([x, dy, z, s]) => {
      const m = new THREE.Mesh(geo, leaf);
      m.position.set(x, terrainY(x, z) + dy, z);
      m.scale.set(s * 1.4, s * 0.6, s);
      m.castShadow = true;
      this.group.add(m);
    });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 6, 6), lam(0x4a3a2e));
    trunk.position.set(-9, terrainY(-9, -14) + 2.6, -14);
    trunk.rotation.z = -0.3;
    this.group.add(trunk);
  }

  /** 夜の灯り（街灯）。Points 1つでまとめて描く */
  /**
   * 尾道駅前：駅舎の前の石畳の広場、海ぎわの芝生（港の緑地）、海沿いの柵、横断歩道、時計の柱。
   * 駅舎の2階から見た写真のように、広場の先に道路と芝生、その向こうに尾道水道と向島のクレーン。
   */
  /** 屋根だけの建物：駅の西の屋根つき歩道や、桟橋の上屋。細い柱に、うすい屋根 */
  _canopies() {
    const tb = new TriBatch(), tbUnder = new TriBatch();
    const top = new THREE.Color('#7e858a'), under = new THREE.Color('#dedad0'), edge = new THREE.Color('#e9e7e1');
    const posts = [];
    const carRoad = (x, z) => { const rd = nearAnyRoad(x, z, 0.3); return rd && rd.surface === 'asphalt' && !['footway', 'pedestrian', 'steps', 'path'].includes(rd.kind); };
    for (const poly of ROOFS) {
      const cx = poly.reduce((a, q) => a + q[0], 0) / poly.length, cz = poly.reduce((a, q) => a + q[1], 0) / poly.length;
      if (inPrecinct(cx, cz)) continue;
      let base = Math.max(...poly.map(([x, z]) => groundY(x, z)));
      if (base < SEA_Y + 1) base = SEA_Y + 1;   // 桟橋の上屋（海の上）
      const y = base + 3.3;
      const ccw = signedArea(poly) > 0;
      const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
        const A = poly[a], B = poly[b], C = poly[c];
        tb.tri([A[0], y + 0.18, A[1]], [B[0], y + 0.18, B[1]], [C[0], y + 0.18, C[1]], top);
        tbUnder.tri([A[0], y, A[1]], [C[0], y, C[1]], [B[0], y, B[1]], under);
      }
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
        tb.quad([ax, y - 0.12, az], [bx, y - 0.12, bz], [bx, y + 0.22, bz], [ax, y + 0.22, az], edge);
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 2) continue;
        const dx = (bx - ax) / L, dz = (bz - az) / L;
        const ix = ccw ? -dz : dz, iz = ccw ? dx : -dx;   // 内向き
        const n = Math.max(1, Math.round(L / 5.5));
        for (let k = 0; k <= n; k++) {
          if (k === n && i < poly.length - 1) continue;    // 角の柱は次の辺で
          const t = k / n;
          const x = ax + (bx - ax) * t + ix * 0.35, z = az + (bz - az) * t + iz * 0.35;
          if (inBuilding(x, z) || carRoad(x, z)) continue;
          if (posts.some((q) => Math.hypot(q.x - x, q.z - z) < 2.5)) continue;
          const gy = Math.max(groundY(x, z), SEA_Y + 0.4);
          posts.push({ x, z, y: (gy + y) / 2, sx: 0.16, sy: y - gy, sz: 0.16, color: '#5a5e62' });
        }
      }
    }
    const roof = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    roof.castShadow = true; roof.receiveShadow = true;
    // 屋根の裏：日は当たらないが、地面の照り返しで明るく見える
    const ceil = new THREE.Mesh(tbUnder.build(), lam(0xffffff, { vertexColors: true, emissive: 0x4a4740 }));
    this.group.add(roof, ceil);
    if (posts.length) this.group.add(instancedChunks(posts, lam(0xffffff), { detail: 120 }));
  }

  /** 駅の2階のテラス（海側）の、帯の位置と高さ。モデルの寸法（間口48m・奥行20m・テラス奥行3.2m・床4.32m）から */
  _stationTerrace() {
    const F = this.stationFrame;
    if (!F) return null;
    const C = this.stationCenter || { x: F.mx, z: F.mz - 60 };
    const e = { x: Math.cos(F.ang), z: Math.sin(F.ang) };          // 駅の長い辺の向き（+x＝西寄り）
    let f = { x: -Math.sin(F.ang), z: Math.cos(F.ang) };           // 海側（駅前広場のほう）
    if ((C.x - F.mx) * f.x + (C.z - F.mz) * f.z < 0) f = { x: -f.x, z: -f.z };
    const y = F.yMin + 4.32;
    const mid = 8.4 * F.sz;
    return { e, f, y, x: F.mx + f.x * mid, z: F.mz + f.z * mid, len: 46.4 * F.sx, wid: 2.7 * F.sz, front: F.dep / 2 };
  }

  /** 駅前の大きな歩道橋（2階の高さのデッキ）。駅の2階テラスから、ロータリーと国道をまたいで、海ぎわへ降りる。歩ける */
  _deck() {
    const T = this._stationTerrace();
    if (T) {
      // 駅の2階テラス：尾道水道を見わたす展望台
      addUpper(T.x, T.z, T.len, T.wid, Math.atan2(T.e.z, T.e.x), T.y);
    }
    for (const d of DECKS) {
      const pts = d.pts.slice();
      const dist = (p) => Math.hypot(p[0] - (T ? T.x : 521), p[1] - (T ? T.z : -547));
      if (dist(pts[0]) < dist(pts[pts.length - 1])) pts.reverse();   // 駅のほうを終点に
      const W = Math.max(4.5, d.width), hw = W / 2;
      const Y = T ? T.y : groundY(pts[pts.length - 1][0], pts[pts.length - 1][1]) + 4.3;
      // 海側のいちばん端の短い区間は、海ぎわへ降りる階段にする
      const [s0, s1] = [pts[0], pts[1]];
      const deckPts = pts.slice(1);
      // 駅の端：テラスの端までのばしてつなぐ
      if (T) {
        const E = deckPts[deckPts.length - 1];
        const p = (E[0] - T.x) * T.e.x + (E[1] - T.z) * T.e.z;
        const sg = Math.sign(p) || 1;
        const q = Math.abs(p) > T.len / 2 ? sg * (T.len / 2 - 1) : p;
        deckPts.push([T.x + T.e.x * q, T.z + T.e.z * q]);
      }
      for (let i = 0; i < deckPts.length - 1; i++) {
        const [ax, az] = deckPts[i], [bx, bz] = deckPts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.05) continue;
        addUpper((ax + bx) / 2, (az + bz) / 2, L + hw, W - 0.6, Math.atan2(bz - az, bx - ax), Y);
      }
      const tb = new TriBatch();
      const topC = new THREE.Color('#b9b2a4'), underC = new THREE.Color('#cfccc4'), sideC = new THREE.Color('#eceae4');
      const s = samplePath(deckPts, 1.2);
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        const na = [-Math.sin(a.angle) * hw, Math.cos(a.angle) * hw], nb = [-Math.sin(b.angle) * hw, Math.cos(b.angle) * hw];
        const L = (p, n, y) => [p.x + n[0], y, p.z + n[1]], R = (p, n, y) => [p.x - n[0], y, p.z - n[1]];
        tb.quad(L(a, na, Y), L(b, nb, Y), R(b, nb, Y), R(a, na, Y), topC);
        tb.quad(L(a, na, Y - 0.9), R(a, na, Y - 0.9), R(b, nb, Y - 0.9), L(b, nb, Y - 0.9), underC);
        tb.quad(L(a, na, Y - 0.9), L(b, nb, Y - 0.9), L(b, nb, Y + 0.1), L(a, na, Y + 0.1), sideC);
        tb.quad(R(a, na, Y - 0.9), R(a, na, Y + 0.1), R(b, nb, Y + 0.1), R(b, nb, Y - 0.9), sideC);
      }
      const parts = [], glass = [];
      // 手すり（すりガラスの腰壁と、上の白い手すり）。階段の降り口は空けておく
      const stairDir = Math.atan2(s0[1] - s1[1], s0[0] - s1[0]);
      for (const p of samplePath(deckPts, 2)) {
        for (const sd of [-1, 1]) {
          const x = p.x - Math.sin(p.angle) * (hw - 0.1) * sd, z = p.z + Math.cos(p.angle) * (hw - 0.1) * sd;
          if (Math.hypot(x - s1[0], z - s1[1]) < 2.2 && Math.cos(Math.atan2(z - s1[1], x - s1[0]) - stairDir) > 0.3) continue;
          glass.push({ x, y: Y + 0.55, z, sx: 2.05, sy: 0.9, sz: 0.06, ry: -p.angle, color: '#c8d4d6' });
          parts.push({ x, y: Y + 1.08, z, sx: 2.05, sy: 0.08, sz: 0.12, ry: -p.angle, color: '#e8e6e0' });
        }
      }
      // 柱（車道の上には立てない）
      const carRoad = (x, z) => { const rd = nearAnyRoad(x, z, 1.2); return rd && rd.surface === 'asphalt' && !['footway', 'pedestrian', 'steps', 'path'].includes(rd.kind); };
      const total = roadLength(deckPts);
      for (let t = 6; t < total - 3; t += 11) {
        let spot = null;
        for (const o of [0, 2.5, -2.5, 5, -5]) {
          const q = pointAlong(deckPts, Math.min(1, Math.max(0, (t + o) / total)));
          if (q && !carRoad(q.x, q.z) && !inBuilding(q.x, q.z)) { spot = q; break; }
        }
        if (!spot) continue;
        const gy = groundY(spot.x, spot.z);
        parts.push({ x: spot.x, y: (gy + Y - 0.9) / 2, z: spot.z, sx: 0.9, sy: Y - 0.9 - gy, sz: 0.9, color: '#d6d2c8' });
        addSolid(spot.x, spot.z, 1.1, 1.1, 0);
      }
      // 海ぎわへ降りる階段（歩ける）
      {
        const ang = stairDir;
        const tx = Math.cos(ang), tz = Math.sin(ang), nx = -tz, nz = tx;
        const rise0 = Y - groundY(s0[0], s0[1]);
        const n = Math.ceil(rise0 / 0.18), run = 0.3, len = n * run;
        const bx = s1[0] + tx * (hw - 0.3), bz = s1[1] + tz * (hw - 0.3);   // デッキの端から降りはじめる
        const gy = groundY(bx + tx * len, bz + tz * len);
        const rise = Y - gy;
        for (let k = 0; k < n; k++) {
          const u = k * run + run / 2, x = bx + tx * u, z = bz + tz * u;
          const yTop = Y - (k + 1) * (rise / n);
          parts.push({ x, y: (yTop + Math.max(gy, yTop - 0.6)) / 2, z, sx: run + 0.02, sy: Math.max(0.2, Math.min(0.6, yTop - gy + 0.01)), sz: 3, ry: -ang, color: '#bdb7aa' });
        }
        addUpper(bx + tx * len / 2, bz + tz * len / 2, len, 2.6, ang, Y, gy + 0.05);
        addUpper(bx - tx * 0.4, bz - tz * 0.4, 1.2, 3, ang, Y);   // デッキとのつなぎ目
        const pitch = Math.atan2(rise, len), ym = (Y + gy) / 2;
        for (const sd of [-1, 1]) {
          const x = bx + tx * len / 2 + nx * 1.55 * sd, z = bz + tz * len / 2 + nz * 1.55 * sd;
          parts.push({ x, y: ym + 0.6, z, sx: len / Math.cos(pitch), sy: 1.0, sz: 0.1, ry: -ang, rz: pitch, color: '#e4e2dc' });
        }
      }
      const mesh = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, emissive: 0x2e2b26 }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      this.group.add(instancedChunks(parts, lam(0xffffff), { detail: 120 }));
      this.group.add(instancedChunks(glass, lam(0xffffff), { detail: 120, receive: false }));
      // 夜の足もとの灯り
      for (const p of samplePath(deckPts, 12)) this.lampPositions.push([p.x, Y + 1.2, p.z]);
    }
    this._juiceStand();
  }

  /** 駅に向かって右（東）の端の、みかんジュースのスタンド */
  _juiceStand() {
    const F = this.stationFrame, T = this._stationTerrace();
    if (!F || !T) return;
    // 東＝ -x。駅の長い辺の向き e のうち、-x を向くほうの端
    const east = T.e.x < 0 ? 1 : -1;
    const out = T.front + 2.2;
    let x = F.mx + T.f.x * out + T.e.x * east * (F.len / 2 - 6), z = F.mz + T.f.z * out + T.e.z * east * (F.len / 2 - 6);
    // 建物・道にかからないところまで、海側へ少しずらす
    for (let k = 0; k < 8 && (inBuilding(x, z) || nearAnyRoad(x, z, 1.6) && nearAnyRoad(x, z, 1.6).surface === 'asphalt' && !['footway', 'pedestrian'].includes(nearAnyRoad(x, z, 1.6).kind)); k++) { x += T.f.x; z += T.f.z; }
    const gy = groundY(x, z);
    const face = Math.atan2(T.f.x, T.f.z);   // 正面（+z）が海側を向く
    const g = new THREE.Group();
    g.position.set(x, gy, z);
    g.rotation.y = face;
    const orange = lam(0xe8822a), cream = lam(0xf6eedc), wood = lam(0x9a6a40), dark = lam(0x3a3430);
    const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; g.add(m); return m; };
    add(new THREE.BoxGeometry(3.4, 2.5, 2.2), cream, 0, 1.25, -0.2);            // 小屋
    add(new THREE.BoxGeometry(3.6, 0.16, 2.8), dark, 0, 2.6, 0);                 // 屋根
    add(new THREE.BoxGeometry(3.4, 1.0, 0.5), wood, 0, 0.5, 1.05);               // カウンター
    add(new THREE.BoxGeometry(3.5, 0.06, 0.62), cream, 0, 1.03, 1.05);
    const awn = add(new THREE.BoxGeometry(3.6, 0.05, 0.9), orange, 0, 2.15, 1.3);
    awn.rotation.x = 0.32;
    // カウンターに並ぶ、色のちがうみかんジュースの瓶（黄色っぽいものから、濃い橙まで）
    const tones = [0xf4c430, 0xf2a01e, 0xee8a18, 0xe8741a, 0xf0b040, 0xd9661a];
    tones.forEach((c, i) => {
      const b = add(new THREE.CylinderGeometry(0.07, 0.08, 0.3, 10), new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.12 }), -1.3 + i * 0.32, 1.21, 1.08);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), cream, b.position.x, 1.39, 1.08);
    });
    // みかんを盛ったかご
    const mk = lam(0xf08a1c);
    for (let k = 0; k < 7; k++) add(new THREE.SphereGeometry(0.075, 8, 6), mk, 0.75 + (k % 4) * 0.13 + (k > 3 ? 0.06 : 0), 1.12 + (k > 3 ? 0.1 : 0), 1.0 + (k % 2) * 0.08);
    add(new THREE.CylinderGeometry(0.32, 0.26, 0.12, 12), wood, 0.95, 1.1, 1.04);
    // 看板
    const tex = labelTexture('みかんジュース', { w: 640, h: 160, size: 70, bg: '#e8822a', fg: '#fff8e8' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.75), new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2 }));
    sign.position.set(0, 2.35, 1.0);
    this.specialSignMats.push(sign.material);
    g.add(sign);
    const menu = labelTexture('あまい ← → すっぱい', { w: 512, h: 128, size: 52, bg: '#2e2a26', fg: '#f6eedc' });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshLambertMaterial({ map: menu }));
    board.position.set(0, 1.75, 0.91);
    g.add(board);
    this.group.add(g);
    addSolid(x, z, 3.6, 2.8, -face);
    this.lampPositions.push([x + T.f.x * 1.4, gy + 2.3, z + T.f.z * 1.4]);
    this.interactables.push({ type: 'juice', menu: 'juice', name: 'みかんジュースのスタンド', x: x + T.f.x * 2.6, z: z + T.f.z * 2.6, yaw: Math.atan2(T.f.x, T.f.z), radius: 2.4 });
  }

  _stationFront() {
    const st = POIS.find((p) => p.n === 'JR尾道駅');
    if (!st) return;
    const C = { x: st.x - 5, z: st.z - 60 }, R = 120;
    this.stationLawn = [];   // 芝生のマス（灯りまつりの模様に使う）
    this.stationCenter = C;
    this.inStationArea = (x, z) => Math.hypot(x - C.x, z - C.z) < R && terrainY(x, z) - SEA_Y < 8;
    const water = (x, z) => demAt(x, z) < SEA_Y;
    const nearWater = (x, z, d) => {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        for (let r = 3; r <= d; r += 3) if (water(x + Math.cos(a) * r, z + Math.sin(a) * r)) return r;
      }
      return Infinity;
    };
    const tb = new TriBatch();
    const cell = 2;
    const col = new THREE.Color();
    for (let x = C.x - R; x < C.x + R; x += cell) {
      for (let z = C.z - R; z < C.z + R; z += cell) {
        const cx = x + cell / 2, cz = z + cell / 2;
        if (!this.inStationArea(cx, cz)) continue;
        if (demAt(cx, cz) < SEA_Y + 0.8 || nearAnyRoad(cx, cz, 0.1) || inBuilding(cx, cz) || inSolid(cx, cz)) continue;
        const w = nearWater(cx, cz, 30);
        const lawn = w > 5 && w < 30;
        if (lawn) this.stationLawn.push([cx, cz]);
        const k = (Math.floor(x / cell) + Math.floor(z / cell)) & 1;
        if (lawn) col.setRGB(0.42 + this.r() * 0.05, 0.56 + this.r() * 0.05, 0.3);
        else if (w <= 5) col.setRGB(0.6, 0.59, 0.56);                 // 海ぎわの遊歩道
        else col.setRGB(k ? 0.66 : 0.6, k ? 0.65 : 0.59, k ? 0.62 : 0.57); // 石畳の広場（市松）
        const P = (px, pz) => [px, groundY(px, pz) + 0.035, pz];
        tb.quad(P(x, z), P(x, z + cell), P(x + cell, z + cell), P(x + cell, z), col);
      }
    }
    const ground = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.7, polygonOffsetUnits: -1 }));
    ground.receiveShadow = true;
    this.group.add(ground);

    // 海沿いの柵（黒い柱と手すり）
    const fence = [];
    for (const line of COAST) {
      for (const p of samplePath(line, 2.5)) {
        if (!this.inStationArea(p.x, p.z)) continue;
        let nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        if (terrainY(p.x + nx * 4, p.z + nz * 4) < terrainY(p.x - nx * 4, p.z - nz * 4)) { nx = -nx; nz = -nz; }
        const x = p.x + nx * 0.4, z = p.z + nz * 0.4, y = groundY(x, z);
        fence.push({ x, y: y + 0.55, z, sx: 0.08, sy: 1.1, sz: 0.08, color: '#2a2e30' });
        fence.push({ x, y: y + 1.08, z, sx: 2.55, sy: 0.06, sz: 0.06, ry: -p.angle, color: '#2a2e30' });
        fence.push({ x, y: y + 0.6, z, sx: 2.55, sy: 0.04, sz: 0.04, ry: -p.angle, color: '#2a2e30' });
      }
    }
    this.group.add(instancedChunks(fence, lam(0xffffff), { detail: 90, receive: false }));

    // 横断歩道（駅前の広い道）
    const zebra = new TriBatch();
    const white = new THREE.Color(0.92, 0.92, 0.9);
    for (const road of ROADS) {
      if (road.surface !== 'asphalt' || road.width < 5.5) continue;
      for (const p of samplePath(road.pts, 38).slice(1, -1)) {
        if (!this.inStationArea(p.x, p.z)) continue;
        const tx = Math.cos(p.angle), tz = Math.sin(p.angle), nx = -tz, nz = tx;
        const n = Math.floor((road.width - 0.6) / 0.9);
        for (let k = 0; k < n; k++) {
          const o = -road.width / 2 + 0.5 + k * 0.9;
          const Q = (u, v) => { const x = p.x + tx * u + nx * v, z = p.z + tz * u + nz * v; return [x, groundY(x, z) + 0.075, z]; };
          zebra.quad(Q(-1.5, o), Q(-1.5, o + 0.45), Q(1.5, o + 0.45), Q(1.5, o), white);
        }
      }
    }
    this.group.add(new THREE.Mesh(zebra.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })));

    // 花壇：石畳の小径のわきに、御影石のふちの低い植え込み（刈りこんだ生け垣と、ときどき花）
    const curbs = [], hedges = [];
    const sr = seededRandom('station-beds');
    for (const road of ROADS) {
      if (road.surface !== 'stone' || road.covered) continue;
      let last = -99, run = 0;
      for (const p of samplePath(road.pts, 2)) {
        run += 2;
        if (!this.inStationArea(p.x, p.z) || run - last < 24 || curbs.length >= 90) continue;
        const nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        for (const sd of [-1, 1]) {
          const off = road.width / 2 + 1.1, x = p.x + nx * sd * off, z = p.z + nz * sd * off;
          const L = 4.2, ok = [-L / 2, 0, L / 2].every((u) => { const qx = x + Math.cos(p.angle) * u, qz = z + Math.sin(p.angle) * u; return !nearAnyRoad(qx, qz, 0.4) && !inBuilding(qx, qz) && !inSolid(qx, qz) && demAt(qx, qz) > SEA_Y + 1; });
          if (!ok) continue;
          last = run;
          const y = groundY(x, z), ry = -p.angle;
          curbs.push({ x, y: y + 0.22, z, sx: L, sy: 0.44, sz: 1.3, ry, color: '#bab4a8' });
          curbs.push({ x, y: y + 0.45, z, sx: L - 0.24, sy: 0.04, sz: 1.06, ry, color: '#5a4a38' });   // 土
          for (let k = 0; k < 5; k++) {
            const u = (k - 2) * 0.78, qx = x + Math.cos(p.angle) * u, qz = z + Math.sin(p.angle) * u;
            hedges.push({ x: qx, y: y + 0.72, z: qz, sx: 0.95, sy: 0.55, sz: 0.95, ry: sr() * 6, color: new THREE.Color().setHSL(0.27 + sr() * 0.04, 0.4, 0.24 + sr() * 0.05) });
            // ときどき、葉の上に小さな花
            if (sr() < 0.3) {
              const fc = ['#d84a6a', '#e8c040', '#f0eef0', '#b070c8'][Math.floor(sr() * 4)];
              for (let f = 0; f < 6; f++) hedges.push({ x: qx + (sr() - 0.5) * 0.7, y: y + 0.88 + sr() * 0.12, z: qz + (sr() - 0.5) * 0.7, sx: 0.16, sy: 0.12, sz: 0.16, color: fc });
            }
          }
          addSolid(x, z, L, 1.3, -p.angle);
        }
      }
    }
    if (curbs.length) {
      this.group.add(instancedChunks(curbs, lam(0xffffff), { detail: 140 }));
      this.group.add(instancedChunks(hedges, lam(0xffffff, { flatShading: true }), { detail: 120, geo: new THREE.IcosahedronGeometry(0.6, 0) }));
    }
    // バスのりば：駅前の広い道ぞいに、屋根とベンチと、のりばの標識
    const stops = [];
    for (const road of ROADS) {
      if (road.surface !== 'asphalt' || road.width < 6) continue;
      for (const p of samplePath(road.pts, 6)) {
        if (stops.length >= 3 || Math.hypot(p.x - st.x, p.z - st.z) > 70 || stops.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 25)) continue;
        const nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        for (const sd of [1, -1]) {
          const x = p.x + nx * sd * (road.width / 2 + 1.6), z = p.z + nz * sd * (road.width / 2 + 1.6);
          if ([-2, 0, 2].some((u) => { const qx = x + Math.cos(p.angle) * u, qz = z + Math.sin(p.angle) * u; return nearAnyRoad(qx, qz, 0.2) || inBuilding(qx, qz) || inSolid(qx, qz) || demAt(qx, qz) < SEA_Y + 1; })) continue;
          stops.push({ x, z, ang: p.angle, sd, n: stops.length + 1 });
          break;
        }
      }
    }
    const frameM = lam(0x6a7a80), roofM = lam(0xe8e8e4), glassM = new THREE.MeshLambertMaterial({ color: 0xc8dce4, transparent: true, opacity: 0.35 }), benchM = lam(0x8a6a4a);
    for (const sp of stops) {
      const g = new THREE.Group();
      g.position.set(sp.x, groundY(sp.x, sp.z), sp.z);
      g.rotation.y = -sp.ang + (sp.sd > 0 ? Math.PI : 0);   // 正面（+Z）を道へ
      const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
      for (const x of [-1.9, 1.9]) box(0.08, 2.5, 0.08, frameM, x, 1.25, -0.5);
      box(4.3, 0.08, 1.7, roofM, 0, 2.55, 0.1);
      box(3.8, 1.9, 0.03, glassM, 0, 1.3, -0.55);
      box(0.03, 1.9, 1.0, glassM, -1.9, 1.3, -0.05);
      box(2.6, 0.06, 0.4, benchM, 0, 0.45, -0.3);
      for (const x of [-1.1, 1.1]) box(0.06, 0.45, 0.35, frameM, x, 0.22, -0.3);
      // のりばの標識（丸い板に番号）
      const sign = labelTexture(`${sp.n}番のりば`, { w: 256, h: 96, size: 48, bg: '#2a6aa8', fg: '#ffffff' });
      box(0.06, 2.6, 0.06, frameM, 2.4, 1.3, 0.6);
      for (const flip of [0, Math.PI]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshLambertMaterial({ map: sign })); m.position.set(2.4, 2.5, 0.6); m.rotation.y = flip + Math.PI / 2; m.translateZ(0.035); g.add(m); }
      this.group.add(g);
      addSolid(sp.x, sp.z, 4.2, 1.2, -sp.ang);
    }
    this.busStops = stops;

    // 時計の柱（広場のまん中あたり、うすい青緑）
    let clock = null;
    for (let r = 0; r < 60 && !clock; r += 3) {
      for (let k = 0; k < 8 && !clock; k++) {
        const x = st.x + Math.cos(k) * r, z = st.z - 30 + Math.sin(k) * r;
        if (!nearAnyRoad(x, z, 1) && !inBuilding(x, z) && !inSolid(x, z) && demAt(x, z) > SEA_Y + 1 && nearAnyRoad(x, z, 6)) clock = { x, z };
      }
    }
    if (clock) {
      const g = new THREE.Group();
      g.position.set(clock.x, groundY(clock.x, clock.z), clock.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 3.6, 8), lam(0x7fa898));
      pole.position.y = 1.8;
      g.add(pole);
      const face = canvasTexture(128, 128, (c, w, h) => {
        c.fillStyle = '#f6f3ea'; c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#2a2e30'; c.lineWidth = 5; c.stroke();
        c.lineWidth = 6; c.beginPath(); c.moveTo(64, 64); c.lineTo(64, 26); c.stroke();
        c.lineWidth = 4; c.beginPath(); c.moveTo(64, 64); c.lineTo(94, 72); c.stroke();
      });
      for (const flip of [0, Math.PI]) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshLambertMaterial({ map: face }));
        m.position.y = 3.75;
        m.rotation.y = flip;
        m.translateZ(0.06);
        g.add(m);
      }
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.1, 24), lam(0x7fa898));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 3.75;
      g.add(rim);
      this.group.add(g);
    }
  }

  /**
   * 海沿いの道：岸壁ぞいの石畳の帯、濃い緑の鉄の手すり、ところどころ船をつなぐ係船柱と小舟、
   * 植えこみの松や桜。尾道側の、水ぎわの低いところだけ
   */
  _seaside() {
    const r = this.r;
    const tb = new TriBatch();
    const rail = [], bitts = [], planters = [], trunks = [], crowns = [], hulls = [], cabins = [], fenders = [], ropes = [];
    const tileA = new THREE.Color('#bdb4a3'), tileB = new THREE.Color('#ada392'), edgeC = new THREE.Color('#8a8072');
    const piers = POIS.filter((p) => p.k === 'ferry_terminal');
    // たるんだ綱（a から b へ）
    const rope = (ax, ay, az, bx, by, bz, sag) => {
      let prev = new THREE.Vector3(ax, ay, az);
      for (let k = 1; k <= 6; k++) {
        const t = k / 6, q = new THREE.Vector3(ax + (bx - ax) * t, ay + (by - ay) * t - Math.sin(t * Math.PI) * sag, az + (bz - az) * t);
        ropes.push(prev, q); prev = q;
      }
    };
    /** 小舟を1そう（ang = へさきの向き）。へさきと、ともの綱をとる点を返す */
    const addBoat = (bx, bz, ang) => {
      const by = SEA_Y + 0.25, ry = -ang, tx = Math.cos(ang), tz = Math.sin(ang);
      const white = r() < 0.7, len = 4 + r() * 1.6;
      hulls.push({ x: bx, y: by, z: bz, sx: len, sy: 0.8, sz: 1.6, ry, color: white ? '#ece9e2' : ['#5a7a8a', '#7a4a3a', '#3e5a7a'][Math.floor(r() * 3)] });
      hulls.push({ x: bx, y: by + 0.24, z: bz, sx: len * 1.01, sy: 0.1, sz: 1.62, ry, color: white ? ['#2a5a8a', '#b03a2e', '#2a7a5a'][Math.floor(r() * 3)] : '#e8e4da' });
      hulls.push({ x: bx, y: by + 0.36, z: bz, sx: len * 0.9, sy: 0.04, sz: 1.4, ry, color: '#8a6e50' });   // 甲板（板張り）
      // 船外機（とも＝船尾に、黒い箱と、水へのびる足）
      const sx0 = bx - tx * len * 0.52, sz0 = bz - tz * len * 0.52;
      cabins.push({ x: sx0, y: by + 0.7, z: sz0, sx: 0.36, sy: 0.5, sz: 0.3, ry, color: '#2a2c30' });
      cabins.push({ x: sx0 - tx * 0.05, y: by + 0.15, z: sz0 - tz * 0.05, sx: 0.08, sy: 0.7, sz: 0.12, ry, color: '#3a3c40' });
      if (r() < 0.55) {
        // 小さな操舵室：白い箱に、まわりの窓（暗い帯）と屋根
        cabins.push({ x: bx + tx * 0.4, y: by + 0.75, z: bz + tz * 0.4, sx: 1.0, sy: 0.75, sz: 0.95, ry, color: '#f4f2ec' });
        cabins.push({ x: bx + tx * 0.4, y: by + 0.88, z: bz + tz * 0.4, sx: 1.02, sy: 0.26, sz: 0.97, ry, color: '#3a4652' });
        cabins.push({ x: bx + tx * 0.4, y: by + 1.15, z: bz + tz * 0.4, sx: 1.15, sy: 0.06, sz: 1.08, ry, color: '#e8e4dc' });
      } else for (let k = 0; k < 2; k++) cabins.push({ x: bx + tx * (k - 0.3) * 1.1, y: by + 0.48, z: bz + tz * (k - 0.3) * 1.1, sx: 0.25, sy: 0.12, sz: 1.3, ry, color: '#a0825e' });   // 腰掛けの板
      if (r() < 0.3) cabins.push({ x: bx - tx * len * 0.2, y: by + 0.5, z: bz - tz * len * 0.2, sx: 0.6, sy: 0.16, sz: 0.9, ry: ry + 0.2, color: '#3a6aa8' });   // 青いシートをかけた荷
      return { bow: new THREE.Vector3(bx + tx * len * 0.47, by + 0.45, bz + tz * len * 0.47), stern: new THREE.Vector3(bx - tx * len * 0.45, by + 0.45, bz - tz * len * 0.45) };
    };
    let lastTree = -99, run = 0;
    for (const line of COAST) {
      const pts = samplePath(line, 2.5);
      let mode = 'rail', modeLeft = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        run += 2.5;
        if (a.x < BOUNDS.x0 || a.x > BOUNDS.x1 || a.z < BOUNDS.z0 || a.z > BOUNDS.z1) continue;
        if (!onOnomichiSide(a.x, a.z) || this.inStationArea?.(a.x, a.z)) continue;
        const gy = groundY(a.x, a.z);
        if (gy - SEA_Y > 6) continue;
        let nx = -Math.sin(a.angle), nz = Math.cos(a.angle);
        if (terrainY(a.x + nx * 6, a.z + nz * 6) < terrainY(a.x - nx * 6, a.z - nz * 6)) { nx = -nx; nz = -nz; }
        // 建物が水ぎわまで建っているところ、桟橋のところは空けておく
        if (inBuilding(a.x + nx * 1.5, a.z + nz * 1.5)) continue;
        if (piers.some((q) => Math.hypot(q.x - a.x, q.z - a.z) < 14)) continue;
        // 30m ほどごとに、手すりの区間と、船をつなぐ岸壁の区間を切りかえる
        if (modeLeft <= 0) { mode = r() < 0.6 ? 'rail' : 'quay'; modeLeft = 8 + Math.floor(r() * 8); }
        modeLeft--;
        // 石畳の帯（幅3m、1.25m ごとに色を変える）
        const W = 3;
        for (let h = 0; h < 2; h++) {
          const t0 = h / 2, t1 = (h + 1) / 2;
          const P = (q, t, w) => { const x = q.x + (b.x - a.x) * t + nx * w, z = q.z + (b.z - a.z) * t + nz * w; return [x, groundY(x, z) + 0.06, z]; };
          tb.quad(P(a, t0, 0.35), P(a, t0, W), P(a, t1, W), P(a, t1, 0.35), (i * 2 + h) % 2 ? tileA : tileB);
        }
        const P2 = (t, w) => { const x = a.x + (b.x - a.x) * t + nx * w, z = a.z + (b.z - a.z) * t + nz * w; return [x, groundY(x, z) + 0.065, z]; };
        tb.quad(P2(0, W), P2(0, W + 0.25), P2(1, W + 0.25), P2(1, W), edgeC);
        const ry = -a.angle;
        if (mode === 'rail') {
          // 鉄の手すり（濃い緑の柱と、上・中の横棒）
          const x = a.x + nx * 0.45, z = a.z + nz * 0.45, y = groundY(x, z);
          rail.push({ x, y: y + 0.55, z, sx: 0.07, sy: 1.1, sz: 0.07, color: '#2f4a42' });
          const mx = (a.x + b.x) / 2 + nx * 0.45, mz = (a.z + b.z) / 2 + nz * 0.45;
          rail.push({ x: mx, y: y + 1.08, z: mz, sx: 2.55, sy: 0.07, sz: 0.07, ry, color: '#2f4a42' });
          rail.push({ x: mx, y: y + 0.6, z: mz, sx: 2.55, sy: 0.04, sz: 0.04, ry, color: '#2f4a42' });
        } else if (i % 3 === 0) {
          // 係船柱（黒い、頭のふくらんだ短い柱）
          const x = a.x + nx * 0.6, z = a.z + nz * 0.6, y = groundY(x, z);
          bitts.push({ x, y: y + 0.25, z, sx: 0.32, sy: 0.5, sz: 0.32, color: '#25272a' });
          // 岸壁の、古タイヤの防舷材（水面の少し上に、ロープでつるす）
          const fy = (gy + SEA_Y) / 2 + 0.2;
          fenders.push({ x: a.x - nx * 0.12, y: fy, z: a.z - nz * 0.12, sx: 0.7, sy: 0.7, sz: 0.7, ry: ry + Math.PI / 2, color: '#1e1f20' });
          ropes.push(new THREE.Vector3(a.x - nx * 0.05, gy, a.z - nz * 0.05), new THREE.Vector3(a.x - nx * 0.1, fy + 0.3, a.z - nz * 0.1));
          // 小舟をつないでおく（海側に水があるところだけ）。ときどき、外側にもう1そう横づけ
          if (r() < 0.75 && demAt(a.x - nx * 4, a.z - nz * 4) < SEA_Y - 0.5) {
            const flip = r() < 0.5 ? 0 : Math.PI;
            const b1 = addBoat(a.x - nx * 2.7, a.z - nz * 2.7, a.angle + flip);
            rope(x, y + 0.45, z, b1.bow.x, b1.bow.y, b1.bow.z, 0.35);       // もやい綱（係船柱から、へさきへ）
            rope(x, y + 0.45, z, b1.stern.x, b1.stern.y, b1.stern.z, 0.3);  // ともづな
            if (r() < 0.35 && demAt(a.x - nx * 6, a.z - nz * 6) < SEA_Y - 0.5) {
              const b2 = addBoat(a.x - nx * 4.5 + Math.cos(a.angle) * (r() - 0.5), a.z - nz * 4.5 + Math.sin(a.angle) * (r() - 0.5), a.angle + flip);
              rope(b1.bow.x, b1.bow.y, b1.bow.z, b2.bow.x, b2.bow.y, b2.bow.z, 0.15);
              rope(b1.stern.x, b1.stern.y, b1.stern.z, b2.stern.x, b2.stern.y, b2.stern.z, 0.15);
            }
          }
        }
        // 植えこみ（約28m ごと）：コンクリートの鉢に、松か桜
        if (run - lastTree > 28) {
          const x = a.x + nx * (W + 1.4), z = a.z + nz * (W + 1.4);
          if (!nearAnyRoad(x, z, 1) && !inBuilding(x, z) && !inSolid(x, z) && demAt(x, z) > SEA_Y + 0.8) {
            lastTree = run;
            const y = groundY(x, z);
            planters.push({ x, y: y + 0.25, z, sx: 1.7, sy: 0.5, sz: 1.7, ry, color: '#b8b2a6' });
            const pine = r() < 0.5;
            const autumn = [9, 10].includes(new Date().getMonth());
            trunks.push({ x, y: y + 1.5, z, sx: 0.22, sy: 2.4, sz: 0.22, color: '#5a4636' });
            const cc = pine ? '#3e5a34' : autumn && r() < 0.6 ? '#c8703a' : '#5f8a44';
            crowns.push({ x, y: y + 3.0, z, sx: pine ? 2.6 : 2.4, sy: pine ? 1.1 : 1.9, sz: pine ? 2.2 : 2.4, ry: r() * 3, color: cc });
            if (pine) crowns.push({ x: x + nx * 0.6, y: y + 2.3, z: z + nz * 0.6, sx: 1.6, sy: 0.7, sz: 1.4, ry: r() * 3, color: '#46623a' });
            addSolid(x, z, 1.7, 1.7, -a.angle);
          }
        }
      }
    }
    // 沖のブイにつないだ舟：岸から少し離れた水の上に、潮の流れ（水道の向き）にへさきを向けて浮かぶ。
    // ブイ（橙や白の浮き）から、へさきへ綱をとる。渡船の航路と、のりばのまわりはあけておく
    const buoys = [];
    const nearFerry = (x, z) => FERRY_ROUTES.some(({ a, b }) => {
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      return Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < 18;
    });
    const deep = (x, z) => demAt(x, z) < SEA_Y - 1.2;
    for (const line of COAST) {
      for (const p of samplePath(line, 26)) {
        if (Math.abs(p.x) > 900 || p.z < BOUNDS.z0 || p.z > BOUNDS.z1 || r() > 0.45) continue;
        let nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        if (demAt(p.x + nx * 10, p.z + nz * 10) > demAt(p.x - nx * 10, p.z - nz * 10)) { nx = -nx; nz = -nz; }   // 海のほうへ
        const off = 12 + r() * 14;
        const n = r() < 0.35 ? 2 + Math.floor(r() * 2) : 1;   // ときどき、2〜3そう並べて
        for (let k = 0; k < n; k++) {
          const ux = Math.cos(p.angle), uz = Math.sin(p.angle);
          const bx = p.x + nx * off + ux * k * 7, bz = p.z + nz * off + uz * k * 7;
          const st = straitAt(bx), ang = st.angle + (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.3;
          const fx = Math.cos(ang), fz = Math.sin(ang);
          const qx = bx + fx * 6.5, qz = bz + fz * 6.5;
          if (!deep(bx, bz) || !deep(qx, qz) || !deep(bx - fx * 3, bz - fz * 3) || nearFerry(bx, bz) || piers.some((q) => Math.hypot(q.x - bx, q.z - bz) < 24)) continue;
          if (Math.abs(bz - st.z) < 62) continue;   // 水道のまん中（行き交う船の通り道）はあけておく
          const b = addBoat(bx, bz, ang);
          buoys.push({ x: qx, y: SEA_Y + 0.1, z: qz, sx: 0.55, sy: 0.5, sz: 0.55, color: r() < 0.6 ? '#e8702a' : '#f0eee8' });
          rope(b.bow.x, b.bow.y, b.bow.z, qx, SEA_Y + 0.3, qz, 0.25);
        }
      }
    }
    if (buoys.length) { const bg = instancedChunks(buoys, lam(0xffffff), { detail: 200, geo: new THREE.SphereGeometry(0.5, 10, 8) }); bg.name = 'buoys'; this.group.add(bg); }
    const ground = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    ground.receiveShadow = true;
    this.group.add(ground);
    if (rail.length) this.group.add(instancedChunks(rail, lam(0xffffff), { detail: 90, receive: false }));
    if (bitts.length) this.group.add(instancedChunks(bitts, lam(0xffffff), { detail: 70, geo: new THREE.CylinderGeometry(0.42, 0.5, 1, 8) }));
    if (planters.length) {
      this.group.add(instancedChunks(planters, lam(0xffffff), { detail: 90 }));
      this.group.add(instancedChunks(trunks, lam(0xffffff), { geo: new THREE.CylinderGeometry(0.4, 0.5, 1, 6) }));
      this.group.add(instancedChunks(crowns, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(0.6, 1) }));
    }
    if (hulls.length) {
      // 舟の形：上から見て、へさきのとがった形を、縦にのばしたもの（底は少しすぼめる）
      const sh = new THREE.Shape();
      sh.moveTo(-0.5, -0.42); sh.lineTo(0.12, -0.5); sh.quadraticCurveTo(0.42, -0.42, 0.5, 0); sh.quadraticCurveTo(0.42, 0.42, 0.12, 0.5); sh.lineTo(-0.5, 0.42);
      const hullGeo = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 6 });
      hullGeo.rotateX(-Math.PI / 2);
      hullGeo.translate(0, -0.5, 0);
      const hp = hullGeo.attributes.position;
      for (let i = 0; i < hp.count; i++) if (hp.getY(i) < 0) { hp.setX(i, hp.getX(i) * 0.9); hp.setZ(i, hp.getZ(i) * 0.7); }
      hullGeo.computeVertexNormals();
      // つないだ舟は、うねりに合わせて、ゆっくり上下にゆれる（場所ごとに少しずつずれて、舟がかたむく）
      this.bobTime = { value: 0 };
      const bobbing = () => {
        const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uBob = this.bobTime;
          sh.vertexShader = 'uniform float uBob;\n' + sh.vertexShader.replace('#include <project_vertex>', `
            vec4 mvPosition = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              mvPosition = instanceMatrix * mvPosition;
            #endif
            vec4 bw = modelMatrix * mvPosition;
            bw.y += sin(uBob * 1.15 + bw.x * 0.23 + bw.z * 0.17) * 0.06 + sin(uBob * 0.71 + bw.x * 0.08 - bw.z * 0.12) * 0.05;
            mvPosition = viewMatrix * bw;
            gl_Position = projectionMatrix * mvPosition;`);
        };
        m.customProgramCacheKey = () => 'bob';
        return m;
      };
      this.group.add(instancedChunks(hulls, bobbing(), { geo: hullGeo }));
      if (cabins.length) this.group.add(instancedChunks(cabins, bobbing()));
    }
    if (fenders.length) this.group.add(instancedChunks(fenders, lam(0xffffff), { detail: 80, geo: new THREE.TorusGeometry(0.36, 0.13, 6, 12) }));
    if (ropes.length) this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ropes), new THREE.LineBasicMaterial({ color: 0xd8cfb0 })));
  }

  /**
   * 道の細かいところ：踏切の手前の停止線と「とまれ」、線路ぞいの白い柵。
   * 国道2号の白線（中央の黄線・車線の破線・外側線）、ガードレール、信号、青い案内標識。
   * 坂の小道の電柱と電線、カーブミラー、家の前の鉢植え
   */
  _streetDetails() {
    const r = this.r;
    const lines = new TriBatch();
    const white = new THREE.Color(0.93, 0.93, 0.9), yellow = new THREE.Color(0.95, 0.72, 0.18);
    const boxes = [], whiteRail = [], poles = [], wires = [], mirrors = [], pots = [], plants = [], tufts = [];
    const month = new Date().getMonth() + 1;
    const stripe = (p, ang, off, len, w, col, lift = 0.085) => {
      const tx = Math.cos(ang), tz = Math.sin(ang), nx = -tz, nz = tx;
      const Q = (u, v) => { const x = p.x + tx * u + nx * (off + v), z = p.z + tz * u + nz * (off + v); return [x, groundY(x, z) + lift, z]; };
      lines.quad(Q(-len / 2, -w / 2), Q(-len / 2, w / 2), Q(len / 2, w / 2), Q(len / 2, -w / 2), col);
    };
    const nearCrossing = (x, z, d) => CROSSINGS.some((c) => Math.hypot(c.x - x, c.z - z) < d);
    // ---- 踏切のまわり ----
    const tomare = labelTexture('とまれ', { w: 512, h: 160, size: 120, bg: 'rgba(0,0,0,0)', fg: '#f2f0ea' });
    const marks = [];
    for (const c of CROSSINGS) {
      const ra = c.railAngle, rx = Math.cos(ra), rz = Math.sin(ra), px = -rz, pz = rx;
      for (const side of [-1, 1]) {
        // 停止線（道を横切る白い帯）と、「とまれ」の文字
        const sx = c.x + px * side * 5.6, sz = c.z + pz * side * 5.6;
        stripe({ x: sx, z: sz }, ra, 0, c.width - 0.4, 0.35, white);
        if (c.width >= 3) marks.push({ x: c.x + px * side * 7.6, z: c.z + pz * side * 7.6, ang: Math.atan2(pz * side, px * side), w: Math.min(2.6, c.width - 0.6) });
        // 線路ぞいの白いパイプの柵（踏切の両わき、道の外へ8m）
        for (const along of [-1, 1]) {
          for (let d = c.width / 2 + 1.2; d < c.width / 2 + 9; d += 1.6) {
            const fx = c.x + rx * along * d + px * side * 3.2, fz = c.z + rz * along * d + pz * side * 3.2;
            if (nearAnyRoad(fx, fz, 0.2) || inBuilding(fx, fz)) continue;
            const y = groundY(fx, fz);
            whiteRail.push({ x: fx, y: y + 0.55, z: fz, sx: 0.06, sy: 1.1, sz: 0.06, color: '#e8e6e0' });
            whiteRail.push({ x: fx - rx * along * 0.8, y: y + 1.05, z: fz - rz * along * 0.8, sx: 1.6, sy: 0.06, sz: 0.06, ry: -ra, color: '#e8e6e0' });
            whiteRail.push({ x: fx - rx * along * 0.8, y: y + 0.55, z: fz - rz * along * 0.8, sx: 1.6, sy: 0.05, sz: 0.05, ry: -ra, color: '#e8e6e0' });
          }
        }
      }
    }
    if (marks.length) {
      const mat = new THREE.MeshLambertMaterial({ map: tomare, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
      for (const m of marks) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(m.w, m.w * 0.36), mat);
        mesh.rotation.set(-Math.PI / 2, 0, -m.ang - Math.PI / 2);
        mesh.position.set(m.x, groundY(m.x, m.z) + 0.1, m.z);
        this.group.add(mesh);
      }
    }
    // ---- 国道2号 ----
    const signals = [];
    const signTex = labelTexture('← 福山　　尾道駅　　三原 →', { w: 1024, h: 192, size: 78, bg: '#1f4f9a', fg: '#ffffff' });
    let signRun = 120;
    for (const road of ROADS) {
      if (road.kind !== 'trunk') continue;
      const hw = road.width / 2;
      const pts = samplePath(road.pts, 1.5);
      let run = 0;
      for (let i = 0; i < pts.length; i++, run += 1.5) {
        const p = pts[i];
        const nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        if (this.inStationArea?.(p.x, p.z) && road.width < 8) continue;
        // 交差点（ほかの車道が近い）では白線を切る
        const other = (() => { for (const sd of [-1, 1]) { const q = nearAnyRoad(p.x + nx * sd * (hw + 1.5), p.z + nz * sd * (hw + 1.5), 0); if (q && q !== road) return q; } return null; })();
        if (!other && !nearCrossing(p.x, p.z, 8)) {
          stripe(p, p.angle, 0, 1.55, 0.14, yellow);                                    // 中央線（黄色の実線）
          stripe(p, p.angle, hw - 0.35, 1.55, 0.14, white);                             // 外側線
          stripe(p, p.angle, -(hw - 0.35), 1.55, 0.14, white);
          // ガードレール（白、2.4m ごとの柱）
          if (i % 2 === 0) for (const sd of [-1, 1]) {
            const gx = p.x + nx * sd * (hw + 0.3), gz = p.z + nz * sd * (hw + 0.3);
            if (inBuilding(gx, gz) || nearAnyRoad(gx + nx * sd * 0.6, gz + nz * sd * 0.6, 0) && nearAnyRoad(gx + nx * sd * 0.6, gz + nz * sd * 0.6, 0) !== road && nearAnyRoad(gx + nx * sd * 0.6, gz + nz * sd * 0.6, 0).surface === 'asphalt') continue;
            const y = groundY(gx, gz);
            whiteRail.push({ x: gx, y: y + 0.4, z: gz, sx: 0.1, sy: 0.8, sz: 0.1, color: '#d8d8d4' });
            whiteRail.push({ x: gx, y: y + 0.65, z: gz, sx: 3.05, sy: 0.3, sz: 0.05, ry: -p.angle, color: '#f2f2ee' });
          }
        } else if (other && other.surface === 'asphalt' && other.width >= 4 && !signals.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 40)) {
          // 信号機：交差点の角に、車用（3灯・横向き）と歩行者用
          signals.push({ x: p.x, z: p.z });
          for (const sd of [-1, 1]) {
            const sx = p.x + nx * sd * (hw + 0.6), sz = p.z + nz * sd * (hw + 0.6);
            if (inBuilding(sx, sz)) continue;
            const y = groundY(sx, sz);
            boxes.push({ x: sx, y: y + 2.9, z: sz, sx: 0.16, sy: 5.8, sz: 0.16, color: '#8a8e90' });
            boxes.push({ x: sx - nx * sd * 1.6, y: y + 5.6, z: sz - nz * sd * 1.6, sx: 0.1, sy: 0.1, sz: 3.2, ry: -p.angle + Math.PI / 2, color: '#8a8e90' });
            boxes.push({ x: sx - nx * sd * 3, y: y + 5.4, z: sz - nz * sd * 3, sx: 1.3, sy: 0.45, sz: 0.3, ry: -p.angle + Math.PI / 2 + Math.PI / 2, color: '#3a3e40' });
            for (const [k, col] of [[-0.42, '#3aa860'], [0, '#e0b030'], [0.42, '#c8302a']]) {
              const tx = Math.cos(p.angle) * k, tz = Math.sin(p.angle) * k;
              boxes.push({ x: sx - nx * sd * 3 + tx + Math.cos(p.angle) * 0, y: y + 5.4, z: sz - nz * sd * 3 + tz, sx: 0.28, sy: 0.28, sz: 0.34, color: col });
            }
            boxes.push({ x: sx, y: y + 2.4, z: sz, sx: 0.3, sy: 0.55, sz: 0.3, color: '#3a3e40' });   // 歩行者用
          }
        }
        // 青い案内標識（およそ400m ごと、門型）
        if (run > signRun && !other && !nearCrossing(p.x, p.z, 20)) {
          signRun = run + 400;
          const y0 = groundY(p.x, p.z);
          for (const sd of [-1, 1]) boxes.push({ x: p.x + nx * sd * (hw + 0.6), y: y0 + 3.2, z: p.z + nz * sd * (hw + 0.6), sx: 0.22, sy: 6.4, sz: 0.22, color: '#8a8e90' });
          boxes.push({ x: p.x, y: y0 + 6.3, z: p.z, sx: 0.14, sy: 0.14, sz: road.width + 1.4, ry: -p.angle + Math.PI / 2 + Math.PI / 2, color: '#8a8e90' });
          for (const flip of [0, Math.PI]) {
            const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.15), new THREE.MeshLambertMaterial({ map: signTex }));
            panel.position.set(p.x, y0 + 5.5, p.z);
            panel.rotation.y = -p.angle + Math.PI / 2 + flip;
            panel.translateZ(0.06);
            this.group.add(panel);
          }
        }
      }
    }
    // ---- 坂の小道：電柱と電線、カーブミラー、鉢植え ----
    const polePts = [];
    for (const road of ROADS) {
      // 坂の小道と、平地の町なかの細い車道（国道や駅前・海ぎわの広い道はのぞく）
      const street = road.surface === 'asphalt' && road.kind !== 'trunk' && road.width <= 7;
      if ((road.surface !== 'stone' && !street) || road.covered || road.alley || roadLength(road.pts) < 25) continue;
      const pts = samplePath(road.pts, 2);
      let last = -99, run = 0;
      for (let i = 1; i < pts.length - 1; i++, run += 2) {
        const p = pts[i];
        const above = terrainY(p.x, p.z) - SEA_Y;
        if (street ? (above < 1.2 || above > 90 || distToCoast(p.x, p.z) < 14 || inStationFront(p.x, p.z) || !onOnomichiSide(p.x, p.z) || Math.hypot(p.x, p.z) > 900) : (above < 8 || above > 90)) continue;
        const nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        const hw = road.width / 2;
        // 電柱（約28m ごと、道の片側）
        if (run - last > 28) {
          const x = p.x + nx * (hw + 0.4), z = p.z + nz * (hw + 0.4);
          if (!nearAnyRoad(x, z, 0.1) && !inBuilding(x, z) && !inSolid(x, z) && !inPrecinct(x, z, 2) && !nearRail(x, z, 4)) {
            last = run;
            const y = groundY(x, z);
            const ca = -p.angle + Math.PI / 2, tx = Math.cos(p.angle), tz = Math.sin(p.angle);
            poles.push({ x, y: y + 5, z, sx: 0.26, sy: 10, sz: 0.26, color: '#9a978e' });
            // 腕木（上は高圧の3本、少し下に低圧の腕木）と、白いがいし
            for (const [hy, w] of [[9.3, 1.6], [8.3, 1.1]]) {
              boxes.push({ x, y: y + hy, z, sx: w, sy: 0.1, sz: 0.1, ry: ca, color: '#5a5a56' });
              for (const u of hy > 9 ? [-0.7, 0, 0.7] : [-0.45, 0.45]) boxes.push({ x: x + nx * u, y: y + hy + 0.1, z: z + nz * u, sx: 0.08, sy: 0.14, sz: 0.08, color: '#e8e8e2' });
            }
            if (r() < 0.45) {
              poles.push({ x: x + tx * 0.34, y: y + 7.2, z: z + tz * 0.34, sx: 0.46, sy: 0.85, sz: 0.46, color: '#8a8a84' });   // 変圧器（柱上トランス）
              boxes.push({ x: x + tx * 0.34, y: y + 7.7, z: z + tz * 0.34, sx: 0.5, sy: 0.08, sz: 0.5, color: '#6a6a66' });
            }
            // 足もとの黄色と黒の、反射板のカバー
            poles.push({ x, y: y + 1.0, z, sx: 0.29, sy: 1.6, sz: 0.29, color: '#d8b838' });
            for (let q = 0; q < 3; q++) poles.push({ x, y: y + 0.5 + q * 0.5, z, sx: 0.295, sy: 0.16, sz: 0.295, color: '#2a2a28' });
            // 番号札（青い小さな板）
            boxes.push({ x: x - nx * 0.14, y: y + 2.4, z: z - nz * 0.14, sx: 0.18, sy: 0.32, sz: 0.02, ry: ca + Math.PI / 2, color: '#2a5a9a' });
            polePts.push({ x, y: y + 9.45, z, road, nx, nz, y0: y });
            addSolid(x, z, 0.4, 0.4, 0);
          }
        }
        // カーブミラー：道が大きく曲がるところ
        const turn = Math.abs(((pts[i + 1].angle - pts[i - 1].angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (turn > 0.7 && r() < 0.5 && !mirrors.some((m) => Math.hypot(m.x - p.x, m.z - p.z) < 25)) {
          const x = p.x - nx * (hw + 0.4), z = p.z - nz * (hw + 0.4);
          if (!nearAnyRoad(x, z, 0.1) && !inBuilding(x, z) && !inSolid(x, z)) {
            const y = groundY(x, z);
            mirrors.push({ x, y, z, face: p.angle });
          }
        }
        // 道ばたの草むら：道のふちに、低い草と、ときどき花（梅雨どきは紫陽花）
        for (const sd of [-1, 1]) {
          if (street || r() > 0.4) continue;
          const off = hw + 0.35 + r() * 1.1;
          const x = p.x + nx * sd * off, z = p.z + nz * sd * off;
          if (nearAnyRoad(x, z, 0.15) || inBuilding(x, z) || inSolid(x, z) || inPrecinct(x, z, 0)) continue;
          const y = groundY(x, z);
          const flower = r() < (month === 6 || month === 7 ? 0.35 : 0.08);
          for (let k = 0; k < 2 + Math.floor(r() * 2); k++) {
            const s2 = 0.22 + r() * 0.28, jx = (r() - 0.5) * 0.6, jz = (r() - 0.5) * 0.6;
            tufts.push({ x: x + jx, y: y + s2 * 0.25, z: z + jz, sx: s2 * 1.5, sy: s2 * 0.7, sz: s2 * 1.5, ry: r() * 6,
              color: flower && k === 0 ? (month === 6 || month === 7 ? ['#6a7ec8', '#8a70b8', '#d090b8'] : ['#e8e4d8', '#e8c040', '#d07090'])[Math.floor(r() * 3)] : ['#45703a', '#4f7c3e', '#5a8240', '#3e6834', '#66804a'][Math.floor(r() * 5)] });
          }
        }
        // 鉢植え：家の壁ぎわ（道のわきに建物がある）
        if (r() < 0.12) for (const sd of [-1, 1]) {
          const x = p.x + nx * sd * (hw + 0.35), z = p.z + nz * sd * (hw + 0.35);
          if (!inBuilding(x + nx * sd * 1.2, z + nz * sd * 1.2) || nearAnyRoad(x, z, 0.05) || inSolid(x, z)) continue;
          const y = groundY(x, z);
          for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
            const u = (k - 1) * 0.42, tx = Math.cos(p.angle) * u, tz = Math.sin(p.angle) * u, s2 = 0.28 + r() * 0.16;
            pots.push({ x: x + tx, y: y + s2 / 2, z: z + tz, sx: s2, sy: s2, sz: s2, color: ['#b0563a', '#8a5a3a', '#6a7a8a', '#c8b89a'][Math.floor(r() * 4)] });
            plants.push({ x: x + tx, y: y + s2 + 0.18, z: z + tz, sx: s2 * 1.4, sy: 0.36 + r() * 0.3, sz: s2 * 1.4, color: r() < 0.25 ? ['#d84a6a', '#f0c030', '#e8e4f0'][Math.floor(r() * 3)] : ['#3e6e34', '#4f7c3e', '#5a8a44'][Math.floor(r() * 3)] });
          }
        }
      }
    }
    // 電線：同じ道の、となりあう電柱のあいだ（高圧3本・低圧2本と、下の黒い通信ケーブル。少したるませる）
    const span = (ax, ay, az, bx, by, bz, sagM) => {
      let prev = null;
      for (let k = 0; k <= 8; k++) {
        const t = k / 8, sag = Math.sin(t * Math.PI) * sagM;
        const q = new THREE.Vector3(ax + (bx - ax) * t, ay + (by - ay) * t - sag, az + (bz - az) * t);
        if (prev) wires.push(prev, q);
        prev = q;
      }
    };
    for (let i = 1; i < polePts.length; i++) {
      const a = polePts[i - 1], b = polePts[i];
      if (a.road !== b.road || Math.hypot(a.x - b.x, a.z - b.z) > 45) continue;
      for (const [dy, u, sg] of [[0, -0.7, 0.45], [0, 0, 0.45], [0, 0.7, 0.45], [-1, -0.45, 0.6], [-1, 0.45, 0.6], [-3.6, 0, 0.9], [-3.9, 0.1, 1.0]]) {
        span(a.x + a.nx * u, a.y + dy, a.z + a.nz * u, b.x + b.nx * u, b.y + dy, b.z + b.nz * u, sg);
      }
    }
    // 引込線：電柱から、道のわきの家の軒へ
    for (const a of polePts) {
      for (const sd of [1, -1]) {
        if (r() < 0.35) continue;
        for (let d = 1.5; d < 9; d += 0.5) {
          const hx = a.x + a.nx * sd * d, hz = a.z + a.nz * sd * d;
          if (!inBuilding(hx, hz)) continue;
          const j = (r() - 0.5) * 4;
          span(a.x, a.y - 1, a.z, hx - a.nx * sd * 0.2 + a.nz * j, a.y0 + 4.6, hz - a.nz * sd * 0.2 - a.nx * j, 0.35);
          break;
        }
      }
    }
    const lineMesh = new THREE.Mesh(lines.build(), lam(0xffffff, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    lineMesh.receiveShadow = true;
    this.group.add(lineMesh);
    if (boxes.length) this.group.add(instancedChunks(boxes, lam(0xffffff), { detail: 110, receive: false }));
    if (whiteRail.length) this.group.add(instancedChunks(whiteRail, lam(0xffffff), { detail: 90, receive: false }));
    if (poles.length) this.group.add(instancedChunks(poles, lam(0xffffff), { detail: 140, receive: false, geo: new THREE.CylinderGeometry(0.5, 0.6, 1, 6) }));
    if (wires.length) this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wires), new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.7 })));
    if (pots.length) {
      this.group.add(instancedChunks(pots, lam(0xffffff), { detail: 60, geo: new THREE.CylinderGeometry(0.5, 0.38, 1, 8) }));
      this.group.add(instancedChunks(plants, lam(0xffffff, { flatShading: true }), { detail: 60, geo: new THREE.IcosahedronGeometry(0.5, 0) }));
    }
    if (tufts.length) this.group.add(instancedChunks(tufts, lam(0xffffff, { flatShading: true }), { detail: 50, receive: false, geo: new THREE.IcosahedronGeometry(0.5, 0) }));
    if (mirrors.length) {
      const orange = lam(0xe0702a), glass = lam(0xd8e4ea, { emissive: 0x405058, emissiveIntensity: 0.4 });
      for (const m of mirrors) {
        const g = new THREE.Group();
        g.position.set(m.x, m.y, m.z);
        g.rotation.y = -m.face + Math.PI / 2;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), orange);
        pole.position.y = 1.3;
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 16), orange);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 2.75;
        const face = new THREE.Mesh(new THREE.CircleGeometry(0.36, 16), glass);
        face.position.set(0, 2.75, 0.045);
        g.add(pole, ring, face);
        this.group.add(g);
      }
    }
  }

  /**
   * とめてある車：平地の細い道のわきの空き地や家の前に、軽自動車がところどころ。駅前にはタクシーの列。
   * 走る車は置かない（歩く町なので、静かに）
   */
  _parkedCars() {
    const r = seededRandom('cars');
    const kei = [], keiGlass = [], sedan = [], sedanGlass = [], wheels = [], lights = [], roofSigns = [];
    const COLORS = ['#f2f2ee', '#f2f2ee', '#c8ccd0', '#2a2c30', '#e8d8b0', '#a8c8d8', '#d8a0a8', '#8a9aa0', '#b03a2e', '#e8e0c8'];
    // 車の形：横から見た輪郭（長さ1・高さ1）を、幅の向きにのばす。窓は、輪郭の内側の台形
    const profile = (pts, depth = 1) => {
      const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
      g.translate(0, 0, -depth / 2);
      return g;
    };
    const KEI = { body: profile([[-0.5, 0.18], [0.5, 0.18], [0.5, 0.45], [0.42, 0.53], [0.3, 0.57], [0.16, 0.95], [-0.43, 0.98], [-0.5, 0.88]]),
      glass: profile([[0.27, 0.6], [0.15, 0.9], [-0.41, 0.92], [-0.47, 0.62]], 1.02) };
    const SEDAN = { body: profile([[-0.5, 0.2], [0.5, 0.2], [0.5, 0.45], [0.24, 0.52], [0.08, 0.86], [-0.22, 0.88], [-0.37, 0.56], [-0.5, 0.53]]),
      glass: profile([[0.21, 0.55], [0.07, 0.82], [-0.21, 0.84], [-0.33, 0.56]], 1.02) };
    const addCar = (x, z, ang, color, taxi = false) => {
      const y = groundY(x, z), tx = Math.cos(ang), tz = Math.sin(ang), nx = -tz, nz = tx, ry = -ang;
      const L = taxi ? 4.6 : 3.4, W = taxi ? 1.7 : 1.48, H = taxi ? 1.5 : 1.65;
      (taxi ? sedan : kei).push({ x, y, z, sx: L, sy: H, sz: W, ry, color });
      (taxi ? sedanGlass : keiGlass).push({ x, y, z, sx: L * 0.999, sy: H, sz: W, ry, color: '#26303a' });
      for (const u of [-0.32, 0.32]) for (const v of [-1, 1]) wheels.push({ x: x + tx * L * u + nx * v * (W / 2 - 0.12), y: y + 0.3, z: z + tz * L * u + nz * v * (W / 2 - 0.12), sx: 0.6, sy: 0.22, sz: 0.6, rx: Math.PI / 2, ry: ry, color: '#1e1e20' });
      for (const v of [-1, 1]) {
        lights.push({ x: x + tx * (L / 2 + 0.01) + nx * v * (W / 2 - 0.25), y: y + 0.6, z: z + tz * (L / 2 + 0.01) + nz * v * (W / 2 - 0.25), sx: 0.04, sy: 0.14, sz: 0.3, ry, color: '#f4f0e0' });
        lights.push({ x: x - tx * (L / 2 + 0.01) + nx * v * (W / 2 - 0.2), y: y + (taxi ? 0.68 : 0.75), z: z - tz * (L / 2 + 0.01) + nz * v * (W / 2 - 0.2), sx: 0.04, sy: 0.18, sz: 0.22, ry, color: '#b8302a' });
      }
      if (taxi) roofSigns.push({ x: x - tx * L * 0.07, y: y + H * 0.88 + 0.09, z: z - tz * L * 0.07, sx: 0.22, sy: 0.18, sz: 0.5, ry, color: '#f0d040' });
      addSolid(x, z, L, W, -ang);
    };
    // 平地の細い道のわき（道と建物のあいだの空き地）
    let n = 0;
    for (const road of ROADS) {
      if (road.surface !== 'asphalt' || road.kind === 'trunk' || road.width > 7 || road.covered || roadLength(road.pts) < 30) continue;
      for (const p of samplePath(road.pts, 9)) {
        if (n > 70 || r() > 0.16) continue;
        const above = terrainY(p.x, p.z) - SEA_Y;
        if (above < 1.2 || above > 14 || Math.hypot(p.x, p.z) > 900 || !onOnomichiSide(p.x, p.z) || this.inStationArea?.(p.x, p.z) || distToCoast(p.x, p.z) < 8) continue;
        const nx = -Math.sin(p.angle), nz = Math.cos(p.angle), sd = r() < 0.5 ? -1 : 1;
        const off = road.width / 2 + 1.15;
        const x = p.x + nx * sd * off, z = p.z + nz * sd * off;
        const free = [-1.9, 0, 1.9].every((u) => [-0.8, 0.8].every((v) => {
          const qx = x + Math.cos(p.angle) * u + nx * v, qz = z + Math.sin(p.angle) * u + nz * v;
          return !nearAnyRoad(qx, qz, 0.05) && !inBuilding(qx, qz) && !inSolid(qx, qz) && !nearRail(qx, qz, 4) && Math.abs(terrainY(qx, qz) - terrainY(x, z)) < 0.5;
        }));
        if (!free) continue;
        addCar(x, z, p.angle + (r() < 0.5 ? 0 : Math.PI), COLORS[Math.floor(r() * COLORS.length)]);
        n++;
      }
    }
    // 駅前のタクシーのりば：駅のいちばん近くの広い道ぞいに、3台
    const st = POIS.find((q) => q.n === 'JR尾道駅');
    if (st) {
      let best = null;
      for (const road of ROADS) {
        if (road.surface !== 'asphalt' || road.width < 6) continue;
        for (const p of samplePath(road.pts, 3)) {
          const d = Math.hypot(p.x - st.x, p.z - st.z);
          if (d > 25 && d < 60 && (!best || d < best.d)) best = { p, d, road };
        }
      }
      if (best) {
        const { p, road } = best, nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        // 駅の側の車線（道のはしに寄せる）
        const sd = (st.x - p.x) * nx + (st.z - p.z) * nz > 0 ? 1 : -1;
        for (let k = 0; k < 3; k++) {
          const x = p.x + nx * sd * (road.width / 2 - 1.1) + Math.cos(p.angle) * (k - 1) * 5.4, z = p.z + nz * sd * (road.width / 2 - 1.1) + Math.sin(p.angle) * (k - 1) * 5.4;
          addCar(x, z, p.angle, ['#2a2c30', '#e8c040', '#f2f2ee'][k], true);
        }
      }
    }
    if (!kei.length && !sedan.length) return;
    const bodyG = new THREE.Group();
    bodyG.name = 'cars';
    if (kei.length) bodyG.add(instancedChunks(kei, lam(0xffffff), { detail: 160, geo: KEI.body }), instancedChunks(keiGlass, lam(0xffffff), { detail: 160, cast: false, geo: KEI.glass }));
    if (sedan.length) bodyG.add(instancedChunks(sedan, lam(0xffffff), { detail: 160, geo: SEDAN.body }), instancedChunks(sedanGlass, lam(0xffffff), { detail: 160, cast: false, geo: SEDAN.glass }));
    this.group.add(bodyG);
    this.group.add(instancedChunks(wheels, lam(0xffffff), { detail: 110, cast: false, geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 10) }));
    this.group.add(instancedChunks(lights, lam(0xffffff), { detail: 90, cast: false }));
    if (roofSigns.length) this.group.add(instancedChunks(roofSigns, lam(0xffffff), { detail: 120 }));
    this.parkedCarCount = n;
  }

  /**
   * 尾道水道ぞいの野外彫刻：駅前の海ぎわの芝生から、海岸通りの遊歩道にかけて、間をあけて並べる。
   * 立つ人のブロンズ像、ステンレスのねじれた輪、積んだ御影石、帆のかたち、ベンチに座る像。台座と銘板つき。
   * それと、本通りの入口（駅のほう）に、旅行かばんを持って座る林芙美子の像
   */
  _sculptures() {
    const r = seededRandom('sculpture');
    const bronze = lam(0x5a5a3e), steel = new THREE.MeshLambertMaterial({ color: 0xd8dde0, emissive: 0x202428 }), granite = lam(0xa49e92), plinthM = lam(0xbab4a8), brass = lam(0xb8984a);
    const spots = [];
    for (const line of COAST) {
      for (const p of samplePath(line, 4)) {
        if (!onOnomichiSide(p.x, p.z) || p.x < -420 || p.x > 640) continue;
        if (spots.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 60)) continue;
        let nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
        if (terrainY(p.x + nx * 6, p.z + nz * 6) < terrainY(p.x - nx * 6, p.z - nz * 6)) { nx = -nx; nz = -nz; }
        const x = p.x + nx * 5.2, z = p.z + nz * 5.2;
        if (groundY(x, z) - SEA_Y > 6) continue;
        let ok = true;
        for (const [a, b] of [[0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]]) if (nearAnyRoad(x + a, z + b, 0.2) || inBuilding(x + a, z + b) || inSolid(x + a, z + b) || demAt(x + a, z + b) < SEA_Y + 0.8) ok = false;
        if (!ok) continue;
        spots.push({ x, z, face: Math.atan2(-nx, -nz) });   // 海を向く
      }
    }
    const make = (kind, g) => {
      const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
      if (kind === 0) {
        // 海を見て立つ人（ブロンズ）。遠くを指さす
        const fig = bronzeFigure(bronze, 'stand', 'sc-stand');
        fig.position.y = 1.1;
        fig.scale.setScalar(1.08);
        g.add(fig);
      } else if (kind === 1) {
        // ステンレスのねじれた輪
        add(new THREE.TorusKnotGeometry(0.8, 0.14, 80, 10, 2, 3), steel, 0, 2.2, 0, 0.2, 0, 0.3);
      } else if (kind === 2) {
        // 積んだ御影石（少しずつずらして）
        for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(1.1 - k * 0.15, 0.5, 0.8 - k * 0.1), granite, (r() - 0.5) * 0.25, 1.35 + k * 0.5, (r() - 0.5) * 0.2, 0, r() * 0.6, 0);
        add(new THREE.SphereGeometry(0.28, 12, 10), granite, 0, 3.35, 0);
      } else if (kind === 3) {
        // 帆のかたち（ブロンズの曲面）
        const sail = add(new THREE.CylinderGeometry(1.4, 1.4, 2.6, 16, 1, true, 0, Math.PI * 0.6), new THREE.MeshLambertMaterial({ color: 0x6a6448, side: THREE.DoubleSide }), 0, 2.4, -1.0);
        sail.rotation.z = 0.12;
        add(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), bronze, 0, 2.6, 0.38);
      } else {
        // ベンチに座る人（ブロンズ）。となりに座れそうな空き
        add(new THREE.BoxGeometry(1.8, 0.08, 0.45), bronze, 0, 1.45, 0);
        for (const sd of [-0.75, 0.75]) add(new THREE.BoxGeometry(0.08, 0.45, 0.4), bronze, sd, 1.2, 0);
        add(new THREE.BoxGeometry(1.8, 0.4, 0.06), bronze, 0, 1.72, -0.2);   // 背もたれ
        const fig = bronzeFigure(bronze, 'sit', 'sc-sit');
        fig.position.set(-0.45, 1.49, -0.02);
        g.add(fig);
      }
    };
    const names = ['海をのぞむ', '潮のかたち', '石のことば', '帆', '待ちびと', '風', '舟出', '凪'];
    spots.slice(0, 8).forEach((sp, i) => {
      const g = new THREE.Group();
      const y = groundY(sp.x, sp.z);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.5), plinthM);
      plinth.position.y = 0.55;
      plinth.castShadow = plinth.receiveShadow = true;
      g.add(plinth);
      make(i % 5, g);
      // 銘板（題名）
      const tex = labelTexture(names[i % names.length], { w: 256, h: 96, size: 46, bg: '#b8984a', fg: '#3a2a18' });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshLambertMaterial({ map: tex }));
      plate.position.set(0, 0.7, -0.76);
      plate.rotation.y = Math.PI;
      g.add(plate);
      g.position.set(sp.x, y, sp.z);
      g.rotation.y = sp.face;
      this.group.add(g);
      this.lampPositions.push([sp.x, y + 0.3, sp.z]);   // 夜は足もとから照らす
      addSolid(sp.x, sp.z, 1.6, 1.6, -sp.face);
      void brass;
    });
    this.sculptureSpots = spots.slice(0, 8);
    // 林芙美子像：本通り（駅前商店街）の入口。旅行かばんを横に、しゃがんで頬杖をつく姿
    const arc = ROADS.find((rd) => rd.name === '駅前商店街');
    if (arc) {
      const end = arc.pts[0][0] > arc.pts[arc.pts.length - 1][0] ? arc.pts[0] : arc.pts[arc.pts.length - 1];   // 駅に近い端
      const n = nearestRoad(end[0], end[1]);
      const ang = n ? Math.atan2(n.seg.dz, n.seg.dx) : 0;
      let px = end[0], pz = end[1];
      for (const sd of [1, -1]) for (const d of [3, 4, 5]) {
        const x = end[0] - Math.sin(ang) * sd * d, z = end[1] + Math.cos(ang) * sd * d;
        if (!nearAnyRoad(x, z, 0.3) && !inBuilding(x, z) && !inSolid(x, z)) { px = x; pz = z; break; }
      }
      const g = new THREE.Group();
      const y = groundY(px, pz);
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.2), granite);
      base.position.y = 0.25;
      g.add(base);
      const add = (geo, x, yy, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, bronze); m.position.set(x, yy, z); m.rotation.set(rx, 0, rz); m.castShadow = true; g.add(m); };
      add(new THREE.BoxGeometry(0.55, 0.38, 0.25), 0.45, 0.7, 0.05);                 // 旅行かばん
      const fig = bronzeFigure(bronze, 'crouch', 'fumiko');   // しゃがんで頬杖をつく
      fig.position.set(-0.15, 0.5, 0);
      g.add(fig);
      const tex = labelTexture('林芙美子', { w: 256, h: 96, size: 52, bg: '#a49e92', fg: '#2e2a26' });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.26), new THREE.MeshLambertMaterial({ map: tex }));
      plate.position.set(0, 0.26, 0.61);
      g.add(plate);
      g.position.set(px, y, pz);
      g.rotation.y = Math.atan2(end[0] - px, end[1] - pz);
      this.group.add(g);
      addSolid(px, pz, 1.4, 1.2, 0);
      this.fumikoAt = { x: px, z: pz };
    }
  }

  /**
   * 竹田像の広場：空き家から石段を少し上ったところの、平らにならした小さな広場。
   * 御影石の敷石、谷側に低い石の塀と鉄の手すり、ベンチ、楠ともみじ、石灯籠、説明板。
   * まん中に、尾道の眺めのほうを向いて座る田能村竹田（江戸後期の文人画家）のブロンズ像
   */
  _takedaPlaza() {
    const P = TAKEDA_PLAZA, r = seededRandom('takeda');
    const y0 = P.y;
    const view = downhillYaw(P.x, P.z, P.r + 6);   // 谷（海）の向き
    // 敷石：1m 角の御影石を、色を少しずつ変えて
    const tb = new TriBatch();
    for (let a = -P.r; a < P.r; a += 1) for (let b = -P.r; b < P.r; b += 1) {
      if (Math.hypot(a + 0.5, b + 0.5) > P.r - 0.2) continue;
      const v = 0.5 + r() * 0.07, col = new THREE.Color(v, v * 0.98, v * 0.92);
      const Q = (u, w) => [P.x + u, y0 + 0.06, P.z + w];
      tb.quad(Q(a + 0.02, b + 0.02), Q(a + 0.02, b + 0.98), Q(a + 0.98, b + 0.98), Q(a + 0.98, b + 0.02), col);
    }
    // 目地（敷石のあいだの暗い線）は、一段低い面で
    const joint = new THREE.Mesh(new THREE.CircleGeometry(P.r - 0.2, 40).rotateX(-Math.PI / 2), lam(0x77726a));
    joint.position.set(P.x, y0 + 0.045, P.z);
    joint.receiveShadow = true;
    this.group.add(joint);
    const pave = new THREE.Mesh(tb.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    pave.receiveShadow = true;
    this.group.add(pave);

    const boxes = [];
    // 谷側の低い石の塀と、黒い鉄の手すり（眺めの側、半周ほど）
    for (let a = -1.5; a <= 1.5; a += 0.15) {
      const ang = view + a, x = P.x + Math.sin(ang) * (P.r - 0.1), z = P.z + Math.cos(ang) * (P.r - 0.1);
      if (nearAnyRoad(x, z, 0.4)) continue;
      const seg = (P.r - 0.1) * 0.15 + 0.03, ry = ang;   // 箱の横（x）を円の接線へ
      const g = 0.5 + r() * 0.06;
      boxes.push({ x, y: y0 + 0.3, z, sx: seg, sy: 0.6, sz: 0.4, ry, color: new THREE.Color(g, g * 0.97, g * 0.9) });
      boxes.push({ x, y: y0 + 0.62, z, sx: seg, sy: 0.06, sz: 0.46, ry, color: new THREE.Color(g * 1.12, g * 1.1, g) });
      boxes.push({ x, y: y0 + 1.05, z, sx: seg, sy: 0.05, sz: 0.05, ry, color: '#2a2c2e' });
      if (Math.round(a / 0.15) % 3 === 0) boxes.push({ x, y: y0 + 0.85, z, sx: 0.05, sy: 0.4, sz: 0.05, color: '#2a2c2e' });
      addSolid(x, z, seg, 0.5, -ry);
    }
    // ベンチ（木の座板に、石の脚）を塀ぎわに3つ。眺めのほうを向けて
    for (const a of [-0.9, 0, 0.9]) {
      const ang = view + a + 0.25, d = P.r - 1.6;
      const x = P.x + Math.sin(ang) * d, z = P.z + Math.cos(ang) * d, ry = ang;
      if (Math.hypot(x - P.statue.x, z - P.statue.z) < 2.4) continue;
      boxes.push({ x, y: y0 + 0.44, z, sx: 1.7, sy: 0.07, sz: 0.42, ry, color: '#8a6a48' });
      for (const sd of [-0.62, 0.62]) boxes.push({ x: x + Math.cos(ry) * sd, y: y0 + 0.2, z: z - Math.sin(ry) * sd, sx: 0.18, sy: 0.4, sz: 0.38, ry, color: '#9a958a' });
      addSolid(x, z, 1.8, 0.6, -ry);
    }
    // 山側に、楠ともみじ。足もとに植え込み
    const trunks = [], crowns = [], shrubs = [];
    const month = new Date().getMonth() + 1;
    const momiji = month >= 10 && month <= 11 ? ['#c8482e', '#d8642e', '#b83a2a'] : ['#5f8a44', '#6e9a4c', '#4f7c3e'];
    [[Math.PI + 1.35, 5.6, ['#2f5a2c', '#3a6a34', '#466e36'], 7], [Math.PI - 1.4, 5.4, momiji, 4.6]].forEach(([a, d, cols, h]) => {
      const ang = view + a, x = P.x + Math.sin(ang) * d, z = P.z + Math.cos(ang) * d;
      trunks.push({ x, y: y0 + h / 2, z, sx: 0.36, sy: h, sz: 0.36, rz: (r() - 0.5) * 0.2, color: '#4e3a30' });
      for (let j = 0; j < 6; j++) crowns.push({ x: x + (r() - 0.5) * 3.4, y: y0 + h - 0.2 + r() * 1.4, z: z + (r() - 0.5) * 3.4, sx: 2.6 + r() * 1.4, sy: 1.6 + r() * 0.8, sz: 2.6 + r() * 1.4, ry: r() * 6, color: cols[j % cols.length] });
      addSolid(x, z, 0.8, 0.8, 0);
    });
    for (let a = Math.PI - 1.3; a < Math.PI + 1.3; a += 0.22) {
      const ang = view + a, x = P.x + Math.sin(ang) * (P.r - 0.5), z = P.z + Math.cos(ang) * (P.r - 0.5);
      if (nearAnyRoad(x, z, 0.6)) continue;
      const sz = 0.7 + r() * 0.5;
      shrubs.push({ x, y: y0 + sz * 0.35, z, sx: sz * 1.3, sy: sz * 0.8, sz: sz * 1.3, ry: r() * 6, color: r() < 0.2 ? ['#c86a8a', '#e8e4f0', '#d8a03a'][Math.floor(r() * 3)] : ['#3e6e34', '#4f7c3e', '#35602e'][Math.floor(r() * 3)] });
    }
    this.group.add(instancedChunks(boxes, lam(0xffffff), { detail: 90 }));
    this.group.add(instancedChunks(trunks, lam(0xffffff), { geo: new THREE.CylinderGeometry(0.4, 0.55, 1, 6) }));
    this.group.add(instancedChunks(crowns, lam(0xffffff, { flatShading: true }), { geo: new THREE.IcosahedronGeometry(0.6, 1) }));
    this.group.add(instancedChunks(shrubs, lam(0xffffff, { flatShading: true }), { detail: 80, geo: new THREE.IcosahedronGeometry(0.5, 0) }));

    // ---- 田能村竹田の像：二段の御影石の台座に、膝の上に画帖をひろげて座る文人の姿 ----
    const S = P.statue, g = new THREE.Group();
    g.position.set(S.x, y0 + 0.06, S.z);
    // 広場のほうを向く（像のうしろに海がひらけて、写真を撮ると尾道水道が背景になる）
    const toC = Math.atan2(P.x - S.x, P.z - S.z);
    const face = view + Math.atan2(Math.sin(toC - view), Math.cos(toC - view)) * 0.8;
    g.rotation.y = face;
    const granite = lam(0xa8a296), dark = lam(0x8e887c);
    const bronze = new THREE.MeshLambertMaterial({ color: 0x4e5640, emissive: 0x10140c });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sc) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      if (sc) m.scale.set(...sc);
      m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
    };
    add(new THREE.BoxGeometry(2.2, 0.3, 1.9), dark, 0, 0.15, 0);
    add(new THREE.BoxGeometry(1.7, 1.05, 1.4), granite, 0, 0.82, 0);
    add(new THREE.BoxGeometry(1.85, 0.1, 1.55), dark, 0, 1.38, 0);
    const top = 1.43;
    // 座った体：着物の裾（ひざを組んで座る）、胴、肩
    add(new THREE.CylinderGeometry(0.42, 0.62, 0.42, 14), bronze, 0, top + 0.21, 0.05, 0, 0, 0, [1, 1, 0.82]);
    add(new THREE.CylinderGeometry(0.27, 0.38, 0.62, 14), bronze, 0, top + 0.72, -0.04, -0.06, 0, 0, [1, 1, 0.78]);
    add(new THREE.SphereGeometry(0.29, 14, 10), bronze, 0, top + 1.0, -0.05, 0, 0, 0, [1.05, 0.55, 0.8]);
    // 衿もと
    add(new THREE.BoxGeometry(0.06, 0.4, 0.04), bronze, -0.07, top + 0.9, 0.2, 0.3, 0, 0.35);
    add(new THREE.BoxGeometry(0.06, 0.4, 0.04), bronze, 0.07, top + 0.9, 0.2, 0.3, 0, -0.35);
    // 頭（少しうつむき、遠くを見る）と、うしろで結った髪
    add(new THREE.CylinderGeometry(0.075, 0.09, 0.14, 10), bronze, 0, top + 1.1, -0.02);
    add(new THREE.SphereGeometry(0.15, 14, 12), bronze, 0, top + 1.27, 0.0, 0, 0, 0, [0.92, 1.05, 1]);
    add(new THREE.SphereGeometry(0.06, 8, 6), bronze, 0, top + 1.33, -0.15);
    add(new THREE.SphereGeometry(0.03, 6, 4), bronze, 0, top + 1.25, 0.15);   // 鼻
    // 腕：左手で画帖を支え、右手に筆
    add(new THREE.CylinderGeometry(0.075, 0.09, 0.42, 8), bronze, 0.3, top + 0.7, 0.08, -0.7, 0, -0.25);
    add(new THREE.CylinderGeometry(0.075, 0.09, 0.42, 8), bronze, -0.3, top + 0.7, 0.08, -0.9, 0, 0.3);
    add(new THREE.BoxGeometry(0.46, 0.03, 0.32), bronze, 0, top + 0.47, 0.33, -0.35, 0, 0);          // 画帖
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 5), bronze, -0.18, top + 0.6, 0.38, -0.4, 0, 0.6);   // 筆
    add(new THREE.SphereGeometry(0.06, 8, 6), bronze, 0.22, top + 0.5, 0.36);
    add(new THREE.SphereGeometry(0.06, 8, 6), bronze, -0.2, top + 0.55, 0.36);
    // 銘板
    const tex = labelTexture('田能村竹田之像', { w: 512, h: 96, size: 56, bg: '#8e887c', fg: '#2a2622' });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.22), new THREE.MeshLambertMaterial({ map: tex }));
    plate.position.set(0, 0.95, 0.705);
    g.add(plate);
    this.group.add(g);
    addSolid(S.x, S.z, 2.3, 2.0, -face);
    this.lampPositions.push([S.x, y0 + 0.4, S.z]);

    // 説明板（像のわき）と、石灯籠
    const side = (a, d) => ({ x: P.x + Math.sin(view + a) * d, z: P.z + Math.cos(view + a) * d });
    const bp = { x: S.x + Math.cos(face) * 2.1 + Math.sin(face) * 0.6, z: S.z - Math.sin(face) * 2.1 + Math.cos(face) * 0.6 };
    const board = new THREE.Group();
    board.position.set(bp.x, y0, bp.z);
    board.rotation.y = face;
    for (const sd of [-0.5, 0.5]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), lam(0x3a2e26)); leg.position.set(sd, 0.6, 0); board.add(leg); }
    const btex = canvasTexture(512, 320, (c, w, h) => {
      c.fillStyle = '#ece4d2'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#5a4a3a'; c.lineWidth = 8; c.strokeRect(8, 8, w - 16, h - 16);
      c.fillStyle = '#2a2420';
      c.font = '600 54px "Shippori Mincho", serif'; c.textAlign = 'center'; c.fillText('田能村竹田', w / 2, 92);
      c.font = '400 30px "Shippori Mincho", serif';
      c.fillText('江戸時代後期の文人画家', w / 2, 165);
      c.fillText('豊後（いまの大分県）竹田の生まれ', w / 2, 225);
    });
    const bface = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.72), new THREE.MeshLambertMaterial({ map: btex }));
    bface.position.set(0, 1.25, 0.05);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.8, 0.06), lam(0x3a2e26));
    back.position.set(0, 1.25, 0);
    board.add(back, bface);
    this.group.add(board);
    addSolid(bp.x, bp.z, 1.2, 0.3, -face);
    // 石灯籠（人の背くらい）。火袋は町の石灯籠と同じ素材で、夜に灯る
    const lp = side(Math.PI + 0.25, P.r - 1.4);
    if (!inSolid(lp.x, lp.z)) {
      const st = [], ly = y0 + 0.06;
      st.push({ x: lp.x, y: ly + 0.1, z: lp.z, sx: 0.6, sy: 0.2, sz: 0.6 });
      st.push({ x: lp.x, y: ly + 0.6, z: lp.z, sx: 0.18, sy: 0.8, sz: 0.18 });
      st.push({ x: lp.x, y: ly + 1.05, z: lp.z, sx: 0.46, sy: 0.1, sz: 0.46 });
      st.push({ x: lp.x, y: ly + 1.55, z: lp.z, sx: 0.66, sy: 0.12, sz: 0.66, ry: Math.PI / 4 });
      st.push({ x: lp.x, y: ly + 1.68, z: lp.z, sx: 0.14, sy: 0.16, sz: 0.14 });
      this.group.add(instancedChunks(st, lam(0x8f897d), { detail: 90 }));
      const fire = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.32), this.lanternMat || lam(0x8f897d));
      fire.position.set(lp.x, ly + 1.29, lp.z);
      this.group.add(fire);
      addSolid(lp.x, lp.z, 0.6, 0.6, 0);
    }
  }

  /**
   * みはらし亭：千光寺新道の石段の途中、海を見下ろす斜面に建つ木造二階建ての茶亭（大正時代の建物）。
   * 谷側は石垣の基礎で持ち上げ、二階には海に向いたガラス戸と手すりの縁側。入口に木の看板
   */
  _mihara() {
    const P = { x: 25, z: 35 };   // OpenStreetMap の「Miharashi-tei」の点（石段の上）
    const view = downhillYaw(P.x, P.z, 6);
    const vx = Math.sin(view), vz = Math.cos(view);
    const cx = P.x + vx * 6.5, cz = P.z + vz * 6.5;
    const floor = groundY(P.x + vx * 2.5, P.z + vz * 2.5);   // 道に近い、山側の高さを一階の床に
    const low = Math.min(...[[-4, -3], [4, -3], [-4, 3], [4, 3]].map(([a, b]) => terrainY(cx + Math.cos(view) * a + vx * b, cz - Math.sin(view) * a + vz * b)));
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = view;   // 正面（+Z）を海へ
    const add = (geo, color, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, typeof color === 'number' ? lam(color) : color); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    const W = 8, D = 6;
    // 石垣の基礎（谷側は高く）
    const baseH = floor - low + 0.3;
    add(new THREE.BoxGeometry(W + 1, baseH, D + 1), new THREE.MeshLambertMaterial({ color: 0xc4beb2, map: this._texture('wall') }), 0, floor - baseH / 2, 0);
    // 一階：焦げ茶の板壁、上は白い漆喰
    add(new THREE.BoxGeometry(W, 2.8, D), 0x4e3828, 0, floor + 1.4, 0);
    add(new THREE.BoxGeometry(W + 0.02, 0.7, D + 0.02), 0xece6da, 0, floor + 2.45, 0);
    add(new THREE.BoxGeometry(W + 1.6, 0.18, D + 1.6), 0x3a3e44, 0, floor + 2.95, 0);   // 一階の庇
    // 二階：少し小さく、海側はガラス戸と縁側の手すり
    add(new THREE.BoxGeometry(W - 1.2, 2.5, D - 1.2), 0x5a4030, 0, floor + 4.2, -0.3);
    add(new THREE.BoxGeometry(W - 1.18, 0.55, D - 1.18), 0xece6da, 0, floor + 5.15, -0.3);
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x9aaab0, emissive: 0xffd0a0, emissiveIntensity: 0.15 });
    this.specialSignMats.push(glassMat);
    const glass = add(new THREE.PlaneGeometry(W - 1.6, 1.6), glassMat, 0, floor + 4.0, (D - 1.2) / 2 - 0.3 + 0.02);
    glass.castShadow = false;
    for (let k = -3; k <= 3; k++) add(new THREE.BoxGeometry(0.08, 1.6, 0.08), 0x3a2a20, k * (W - 1.6) / 6, floor + 4.0, (D - 1.2) / 2 - 0.26);
    // 縁側と手すり（二階の海側に張り出す）
    add(new THREE.BoxGeometry(W - 0.8, 0.12, 1.1), 0x6a4e36, 0, floor + 3.05, D / 2 - 0.1);
    add(new THREE.BoxGeometry(W - 0.8, 0.07, 0.07), 0x3a2a20, 0, floor + 3.95, D / 2 + 0.42);
    for (let k = 0; k <= 10; k++) add(new THREE.BoxGeometry(0.05, 0.85, 0.05), 0x3a2a20, -(W - 0.8) / 2 + k * (W - 0.8) / 10, floor + 3.5, D / 2 + 0.42);
    // 一階の海側：格子の窓
    for (let k = -2; k <= 2; k++) add(new THREE.BoxGeometry(1.1, 1.1, 0.06), 0x2e2a26, k * 1.5, floor + 1.5, D / 2 + 0.02);
    // 寄棟の瓦屋根
    const R = Math.hypot(W - 1.2, D - 1.2) / 2 + 1.4;
    const roof = add(new THREE.ConeGeometry(R, 1.9, 4), 0x3a3e44, 0, floor + 6.35, -0.3, Math.PI / 4);
    roof.scale.set(1, 1, (D - 1.2) / (W - 1.2));
    add(new THREE.BoxGeometry(W + 0.8, 0.18, D + 0.6), 0x3a3e44, 0, floor + 5.45, -0.3);
    this.group.add(g);
    addSolid(cx, cz, W + 1, D + 1, -view);
    // 入口（道の側）の木の看板
    const sx = P.x + vx * 2.2 + Math.cos(view) * 2.5, sz = P.z + vz * 2.2 - Math.sin(view) * 2.5;
    const tex = labelTexture('みはらし亭', { w: 128, h: 448, size: 92, bg: '#5a4030', fg: '#f4ead8', vertical: true });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 0.1), new THREE.MeshLambertMaterial({ map: tex }));
    sign.position.set(sx, groundY(sx, sz) + 1.2, sz);
    sign.rotation.y = view + Math.PI;
    sign.castShadow = true;
    this.group.add(sign);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), lam(0x3a2a20));
    post.position.set(sx, groundY(sx, sz) + 0.25, sz);
    this.group.add(post);
    this.lampPositions.push([cx + vx * 3.2, floor + 2.6, cz + vz * 3.2]);
  }

  /**
   * 藤の回廊：小径のヘアピンの曲がりにそって、上から見ると弧をえがく藤棚のトンネル。
   * 木の柱を両側に立て、上はゆるいアーチの梁。上に藤の葉が茂り、春（4〜5月）は紫の花房が垂れる
   */
  _fuji() {
    const r = seededRandom('fuji');
    const B = FUJI_BEND;
    const road = ROADS.find((rd) => rd.pts.some(([x, z]) => x === B.x && z === B.z) && rd.kind === 'footway');
    if (!road) return;
    // 曲がりの前後およそ14m ずつを、回廊にする
    const k0 = road.pts.findIndex(([x, z]) => x === B.x && z === B.z);
    const along = (from, dir, len) => {
      const out = [];
      let i = from, rem = len, cur = road.pts[from];
      out.push(cur);
      while (rem > 0 && road.pts[i + dir]) {
        const nx = road.pts[i + dir], d = Math.hypot(nx[0] - cur[0], nx[1] - cur[1]);
        if (d >= rem) { const t = rem / d; out.push([cur[0] + (nx[0] - cur[0]) * t, cur[1] + (nx[1] - cur[1]) * t]); break; }
        out.push(nx); rem -= d; cur = nx; i += dir;
      }
      return out;
    };
    const pts = [...along(k0, 1, 14).reverse(), ...along(k0, -1, 14).slice(1)];
    const s = samplePath(pts, 2.2);
    const month = new Date().getMonth() + 1;
    const bloom = month === 4 || month === 5;
    const wood = [], leaves = [], flowers = [];
    const hw = road.width / 2 + 0.45, H = 2.35, rise = 0.55;
    let prev = null;
    for (const p of s) {
      const nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
      const y = groundY(p.x, p.z);
      // 柱（両側）
      for (const sd of [-1, 1]) {
        const x = p.x + nx * sd * hw, z = p.z + nz * sd * hw;
        wood.push({ x, y: y + H / 2, z, sx: 0.14, sy: H, sz: 0.14, color: '#5a4430' });
        addSolid(x, z, 0.25, 0.25, 0);
      }
      // ゆるいアーチの梁（5本の短い材をつないで）
      const seg = 6;
      for (let k = 0; k < seg; k++) {
        const t0 = k / seg, t1 = (k + 1) / seg;
        const u0 = -hw + 2 * hw * t0, u1 = -hw + 2 * hw * t1;
        const h0 = H + Math.sin(t0 * Math.PI) * rise, h1 = H + Math.sin(t1 * Math.PI) * rise;
        const len = Math.hypot(u1 - u0, h1 - h0);
        const um = (u0 + u1) / 2, hm = (h0 + h1) / 2;
        wood.push({ x: p.x + nx * um, y: y + hm, z: p.z + nz * um, sx: len + 0.04, sy: 0.1, sz: 0.1, ry: -p.angle - Math.PI / 2, rz: Math.atan2(h1 - h0, u1 - u0), color: '#5a4430' });   // 箱の x を道の横（n）へ
      }
      // 前の梁とのあいだに、縦の桁（両肩とてっぺん）
      if (prev) {
        for (const u of [-hw, 0, hw]) {
          const ax = prev.x + prev.nx * u, az = prev.z + prev.nz * u, bx = p.x + nx * u, bz = p.z + nz * u;
          const hy = (u === 0 ? H + rise : H) + 0.08;
          wood.push({ x: (ax + bx) / 2, y: (prev.y + y) / 2 + hy, z: (az + bz) / 2, sx: Math.hypot(bx - ax, bz - az) + 0.05, sy: 0.08, sz: 0.08, ry: -Math.atan2(bz - az, bx - ax), color: '#4a3826' });
        }
      }
      // 上に茂る藤の葉（アーチにそって、こんもりと）
      for (let k = 0; k < 14; k++) {
        const t = r(), u = -hw - 0.3 + (2 * hw + 0.6) * t;
        const hh = H + Math.sin(Math.min(1, Math.max(0, (u + hw) / (2 * hw))) * Math.PI) * rise + 0.25;
        const sz = 0.55 + r() * 0.45;
        leaves.push({ x: p.x + nx * u + (r() - 0.5) * 1.6 * Math.cos(p.angle), y: y + hh, z: p.z + nz * u + (r() - 0.5) * 1.6 * Math.sin(p.angle), sx: sz * 1.4, sy: sz * 0.55, sz: sz * 1.4, ry: r() * 6,
          color: ['#4a7232', '#55823a', '#5f8c42', month === 11 ? '#9a9a44' : '#43682e'][Math.floor(r() * 4)] });
      }
      // 垂れ下がる花房（春）。季節はずれは、ところどころに葉のつる
      const n = bloom ? 12 : 4;
      for (let k = 0; k < n; k++) {
        const u = -hw + 0.2 + (2 * hw - 0.4) * r();
        const hh = H + Math.sin(((u + hw) / (2 * hw)) * Math.PI) * rise;
        const L = bloom ? 0.35 + r() * 0.5 : 0.18 + r() * 0.22;
        const f = { x: p.x + nx * u + (r() - 0.5) * 2 * Math.cos(p.angle), y: y + hh - L / 2 - 0.02, z: p.z + nz * u + (r() - 0.5) * 2 * Math.sin(p.angle), sx: bloom ? 0.16 : 0.08, sy: L, sz: bloom ? 0.16 : 0.08,
          color: bloom ? ['#9a78c8', '#b090d8', '#8a68b8', '#c8b0e8'][Math.floor(r() * 4)] : ['#5c8a40', '#6a9448'][Math.floor(r() * 2)] };
        flowers.push(f);
      }
      prev = { x: p.x, z: p.z, y, nx, nz };
    }
    this.group.add(instancedChunks(wood, lam(0xffffff), { detail: 120 }));
    this.group.add(instancedChunks(leaves, lam(0xffffff, { flatShading: true }), { detail: 120, geo: new THREE.IcosahedronGeometry(0.5, 0) }));
    // 花房は、下へ細くなる円すい（さかさま）
    this.group.add(instancedChunks(flowers, lam(0xffffff, { flatShading: true }), { detail: 90, receive: false, geo: new THREE.ConeGeometry(0.5, 1, 6).rotateX(Math.PI) }));
    // 回廊の中ほどに、休めるベンチ（道の外側）
    const mid = s[Math.floor(s.length / 2)];
    if (mid) {
      const nx = -Math.sin(mid.angle), nz = Math.cos(mid.angle);
      for (const sd of [-1, 1]) {
        const x = mid.x + nx * sd * (hw + 0.7), z = mid.z + nz * sd * (hw + 0.7);
        if (nearAnyRoad(x, z, 0.2) || inSolid(x, z)) continue;
        const y = groundY(x, z), ry = -mid.angle;
        const bench = [{ x, y: y + 0.42, z, sx: 1.5, sy: 0.07, sz: 0.4, ry, color: '#8a6a48' }];
        for (const t of [-0.55, 0.55]) bench.push({ x: x + Math.cos(mid.angle) * t, y: y + 0.2, z: z + Math.sin(mid.angle) * t, sx: 0.08, sy: 0.4, sz: 0.36, ry, color: '#3a3a3a' });
        this.group.add(instancedChunks(bench, lam(0xffffff), { detail: 80 }));
        addSolid(x, z, 1.6, 0.5, -ry);
        break;
      }
    }
  }

  /**
   * ガード下：線路が橋になっているところは、道が線路の下をくぐる。掘り下げた道の両側にコンクリートの擁壁、
   * 上に鉄道の橋（鋼の桁とコンクリートの床）。入口には高さ制限の札、天井には蛍光灯
   */
  _underpasses() {
    const wall = new TriBatch();
    const boxes = [], lights = [];
    for (const u of UNDERPASSES) {
      const r = seededRandom('under' + u.x.toFixed(0));
      // 道にそって1m ごと（くぐる点の前後）
      const win = [];
      for (let i = 0; i < u.pts.length - 1; i++) {
        const [ax, az] = u.pts[i], [bx, bz] = u.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
        for (let t = 0; t < L; t += 1) {
          const sAt = u.cum[i] + t;
          if (Math.abs(sAt - u.s0) > u.reach) continue;
          win.push({ x: ax + (bx - ax) * (t / L), z: az + (bz - az) * (t / L), ang: Math.atan2(bz - az, bx - ax) });
        }
      }
      for (const side of [-1, 1]) {
        let prev = null;
        for (const p of win) {
          const nx = -Math.sin(p.ang) * side, nz = Math.cos(p.ang) * side;
          const d = u.hw + 0.15;
          const x = p.x + nx * d, z = p.z + nz * d;
          const floor = terrainY(p.x, p.z) - 0.25;
          const top = railGroundY(x + nx * 1.3, z + nz * 1.3) + 0.3;
          const cur = top - floor > 0.7 ? { x, z, floor, top, nx, nz } : null;
          if (cur && prev) {
            const g = 0.6 + r() * 0.03, col = new THREE.Color(g, g * 0.99, g * 0.96), capc = new THREE.Color(g * 1.08, g * 1.07, g * 1.04);
            const T = 0.3;
            wall.quad([prev.x, prev.floor, prev.z], [cur.x, cur.floor, cur.z], [cur.x, cur.top, cur.z], [prev.x, prev.top, prev.z], col);
            wall.quad([prev.x, prev.top, prev.z], [cur.x, cur.top, cur.z], [cur.x + cur.nx * T, cur.top, cur.z + cur.nz * T], [prev.x + prev.nx * T, prev.top, prev.z + prev.nz * T], capc);
          }
          prev = cur;
        }
      }
      // 鉄道の橋：線路の下になる区間（道のり sMin〜sMax）に、天井の床と、入口の面の鋼の桁
      const at = (sv) => {
        for (let i = 0; i < u.pts.length - 1; i++) {
          if (sv <= u.cum[i + 1] || i === u.pts.length - 2) {
            const [ax, az] = u.pts[i], [bx, bz] = u.pts[i + 1], L = u.cum[i + 1] - u.cum[i] || 1, t = Math.max(0, Math.min(1, (sv - u.cum[i]) / L));
            return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, ang: Math.atan2(bz - az, bx - ax) };
          }
        }
        return { x: u.x, z: u.z, ang: 0 };
      };
      const mid = at((u.sMin + u.sMax) / 2), len = u.sMax - u.sMin;
      const ry = -mid.ang, wide = u.hw * 2 + 3.2;
      const deckTop = u.baseY + 0.05;
      boxes.push({ x: mid.x, y: deckTop - 0.6, z: mid.z, sx: len, sy: 1.2, sz: wide, ry, color: '#5e6266' });
      for (const sv of [u.sMin, u.sMax]) {
        const e = at(sv);
        boxes.push({ x: e.x, y: deckTop - 0.45, z: e.z, sx: 0.3, sy: 1.6, sz: wide + 0.4, ry, color: '#4a5560' });   // 入口の面の桁
        boxes.push({ x: e.x, y: deckTop + 0.75, z: e.z, sx: 0.08, sy: 0.08, sz: wide + 0.4, ry, color: '#4a5560' });  // 桁の上の手すり
      }
      // 天井の蛍光灯（夜は灯る）と、高さ制限の札（両方の入口）
      for (let sv = u.sMin + 2; sv < u.sMax - 1; sv += 4) { const q = at(sv); lights.push({ x: q.x, y: deckTop - 1.25, z: q.z, sx: 0.18, sy: 0.08, sz: 1.2, ry }); }
      this.lampPositions.push([mid.x, deckTop - 1.4, mid.z]);
      const clear = (deckTop - 1.2) - u.floorY;
      const tex = labelTexture(`高さ制限 ${clear.toFixed(1)}m`, { w: 512, h: 128, size: 64, bg: '#f2f0ea', fg: '#c8302a' });
      for (const [sv, dir] of [[u.sMin, -1], [u.sMax, 1]]) {
        const e = at(sv);
        const fx = Math.cos(mid.ang) * dir, fz = Math.sin(mid.ang) * dir;
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshLambertMaterial({ map: tex }));
        plate.position.set(e.x + fx * 0.17, deckTop - 0.45, e.z + fz * 0.17);
        plate.rotation.y = Math.atan2(fx, fz);
        this.group.add(plate);
      }
    }
    if (wall.pos.length) {
      const m = new THREE.Mesh(wall.build(), lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    if (boxes.length) this.group.add(instancedChunks(boxes, lam(0xffffff)));
    if (lights.length) {
      this.underLightMat = new THREE.MeshLambertMaterial({ color: 0xeef2f0, emissive: 0xf0f4ff, emissiveIntensity: 0.4 });
      this.specialSignMats.push(this.underLightMat);
      this.group.add(instancedBoxes(lights, this.underLightMat, { cast: false }));
    }
  }

  /**
   * 町なかの小さな神社：石の鳥居、短い参道（敷石）、狛犬ひと組、石灯籠、手水鉢、朱塗りの拝殿と、うしろの本殿、玉垣。
   *   住吉神社：海の神さま。海岸通りに面して、海のほうを向く。夏の住吉花火まつりの神社
   *   吉備津彦神社（一宮神社）：宝土寺のとなりの坂の上。秋のベッチャー祭りの神社。鬼の面の絵馬と、祝い棒
   */
  _smallShrines() {
    for (const name of SMALL_SHRINES) {
      const P = POIS.find((q) => q.n === name);
      if (!P) continue;
      const r = seededRandom('shrine' + name);
      const sea = name === '住吉神社';
      const face = downhillYaw(P.x, P.z, 10);   // 正面は坂の下（住吉さんは海）へ
      const fx = Math.sin(face), fz = Math.cos(face), sx = Math.cos(face), sz = -Math.sin(face);
      const at = (u, v) => ({ x: P.x + sx * u + fx * v, z: P.z + sz * u + fz * v });   // u=横、v=前
      const y0 = groundY(P.x, P.z);
      const g = new THREE.Group();
      g.position.set(P.x, y0, P.z);
      g.rotation.y = face;
      const add = (geo, color, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, typeof color === 'number' ? lam(color) : color); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
      // 境内の地面（玉砂利）と、坂の下側は石垣で受ける（宙に浮かないように、いちばん低い地面まで積む）
      let low = 0;
      for (const u of [-5.5, 0, 5.5]) for (const v of [-6.5, 0, 6.5]) { const q = at(u, v); low = Math.min(low, terrainY(q.x, q.z) - y0); }
      const baseH = 0.5 - low + 0.4;
      add(new THREE.BoxGeometry(11, baseH, 13), new THREE.MeshLambertMaterial({ color: 0xc4beb2, map: this._texture('wall') }), 0, 0.1 - baseH / 2, 0);
      add(new THREE.BoxGeometry(10.9, 0.04, 12.9), 0xb8b2a6, 0, 0.11, 0);
      // 本殿（うしろ、一段高く）と拝殿（前）。朱の柱、白い壁、銅板の緑の屋根
      const vermilion = 0xc8442e, roofC = sea ? 0x4e7a6a : 0x3c4148;
      const honden = this._hall(3.2, 3, 2.6, { wall: 0xf2eee4, roof: roofC, plaster: 0xf2eee4, base: 0xa8a296 });
      honden.position.set(0, 0.6, -4);
      g.add(honden);
      const haiden = this._hall(5.4, 3.6, 2.8, { wall: vermilion, roof: roofC, plaster: 0xf2eee4, base: 0xa8a296 });
      haiden.position.set(0, 0.2, -0.2);
      g.add(haiden);
      // 拝殿の正面：しめ縄と紙垂、鈴と鈴緒、賽銭箱
      const rope = add(new THREE.CylinderGeometry(0.11, 0.11, 4.2, 8), 0xd8c890, 0, 3.1, 1.75);
      rope.rotation.z = Math.PI / 2;
      for (const u of [-1.2, 0, 1.2]) add(new THREE.BoxGeometry(0.14, 0.4, 0.02), 0xffffff, u, 2.75, 1.82);
      add(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshLambertMaterial({ color: 0xd8b048, emissive: 0x302008 }), 0, 2.85, 1.9);
      add(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), 0xc8302a, 0, 2.0, 1.92);
      add(new THREE.BoxGeometry(1.0, 0.55, 0.5), 0x5a3e2c, 0, 0.6, 2.35);
      // 玉垣（低い石の柵）を、社殿のまわりに
      for (let k = -5; k <= 5; k++) for (const [u, v, ry] of [[k, -5.8, 0], [-5.2, k * 0.95 - 0.8, Math.PI / 2], [5.2, k * 0.95 - 0.8, Math.PI / 2]]) {
        if (Math.abs(v) > 6) continue;
        add(new THREE.BoxGeometry(0.18, 0.75, 0.18), 0xb4aea2, u, 0.48, v);
        add(new THREE.BoxGeometry(0.95, 0.1, 0.12), 0xb4aea2, u, 0.8, v, ry);
      }
      // 参道の敷石と、両わきの石灯籠・狛犬
      for (let v = 2.6; v < 9; v += 0.9) add(new THREE.BoxGeometry(1.6, 0.08, 0.82), new THREE.Color().setScalar(0.62 + r() * 0.06).getHex(), 0, 0.12, v);
      for (const u of [-1.6, 1.6]) {
        // 狛犬：台座にすわる、口をあけた獅子
        const dog = new THREE.Group();
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.9), lam(0xa8a296)); st.position.y = 0.4;
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), lam(0x9a958a)); body.scale.set(0.8, 1.1, 1); body.position.set(0, 1.12, -0.05);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), lam(0x9a958a)); head.position.set(0, 1.55, 0.12);
        const mane = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.08, 6, 12), lam(0x8e897e)); mane.position.set(0, 1.52, 0.05);
        for (const m of [st, body, head, mane]) { m.castShadow = true; dog.add(m); }
        dog.position.set(u, 0.1, 5.2);
        dog.rotation.y = -Math.sign(u) * 0.35;   // 参道のほうを向く
        g.add(dog);
        // 石灯籠
        add(new THREE.BoxGeometry(0.5, 0.2, 0.5), 0xa8a296, u * 1.6, 0.2, 7);
        add(new THREE.CylinderGeometry(0.12, 0.14, 1.0, 8), 0xa8a296, u * 1.6, 0.8, 7);
        add(new THREE.BoxGeometry(0.42, 0.38, 0.42), this.lanternMat || lam(0xa8a296), u * 1.6, 1.5, 7);
        const cap = add(new THREE.ConeGeometry(0.42, 0.32, 4), 0xa8a296, u * 1.6, 1.86, 7);
        cap.rotation.y = Math.PI / 4;
      }
      // 手水鉢（参道の左わき）
      add(new THREE.BoxGeometry(1.0, 0.6, 0.6), 0x9a958a, -3.4, 0.4, 3.6);
      add(new THREE.BoxGeometry(0.85, 0.05, 0.45), new THREE.MeshLambertMaterial({ color: 0x5a7a8a, emissive: 0x0a1418 }), -3.4, 0.71, 3.6);
      // 石の鳥居（明神鳥居）：参道の入口
      const tor = new THREE.Group();
      const stone = lam(0xb4aea2);
      for (const u of [-1.55, 1.55]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 3.8, 12), stone); post.position.set(u, 1.9, 0); tor.add(post); }
      const kasagi = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 0.42), stone); kasagi.position.y = 3.9;
      const shimaki = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 0.36), stone); shimaki.position.y = 3.68;
      const nuki = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.2, 0.22), stone); nuki.position.y = 3.05;
      const gaku = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.62), new THREE.MeshLambertMaterial({ map: labelTexture(name.replace('神社', ''), { w: 128, h: 192, size: 46, bg: '#2a2622', fg: '#e8d8a0', vertical: true }) }));
      gaku.position.set(0, 3.38, 0.13);
      tor.add(kasagi, shimaki, nuki, gaku);
      tor.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      // 鳥居の足もとは参道の入口（境内の外の、道の高さ）
      const tp = at(0, 9.6);
      const ty = groundY(tp.x, tp.z) - y0;
      tor.position.set(0, ty - 0.05, 9.6);
      g.add(tor);
      // 鳥居から境内へ：高さがちがえば石段でつなぐ
      if (Math.abs(ty - 0.1) > 0.25) {
        const n = Math.ceil(Math.abs(ty - 0.1) / 0.18);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n, yy = 0.1 + (ty - 0.1) * t, vv = 6.5 + 3.1 * t;
          add(new THREE.BoxGeometry(2.2, Math.abs(ty - 0.1) / n + 0.02, 3.1 / n + 0.02), 0xb4aea2, 0, yy - Math.sign(ty - 0.1) * 0.0, vv);
        }
      }
      // 祭りの神社らしいもの
      if (sea) {
        // 海の神さま：境内に錨（いかり）と、奉納の小さな船の模型
        const anchor = new THREE.Group();
        const shank = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.6, 0.16), lam(0x2a2c2e)); shank.position.y = 0.95;
        const arm = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 6, 16, Math.PI), lam(0x2a2c2e)); arm.rotation.z = Math.PI; arm.position.y = 0.6;
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.1), lam(0x2a2c2e)); stock.position.y = 1.6;
        anchor.add(shank, arm, stock);
        anchor.position.set(3.4, 0.1, 3.0);
        g.add(anchor);
        const boat = add(new THREE.BoxGeometry(0.9, 0.25, 0.3), 0x8a5a3a, 3.4, 0.62, 4.4);
        boat.rotation.y = 0.4;
      } else {
        // ベッチャーの神社：絵馬掛け（鬼の面の絵馬）と、祝い棒を立てた台
        add(new THREE.BoxGeometry(2.2, 0.08, 0.1), 0x5a3e2c, 3.3, 1.6, 2.8);
        for (const u of [2.3, 4.3]) add(new THREE.BoxGeometry(0.1, 1.6, 0.1), 0x5a3e2c, u, 0.85, 2.8);
        const emaTex = canvasTexture(64, 48, (c, w, h) => {
          c.fillStyle = '#d8c8a0'; c.beginPath(); c.moveTo(0, 14); c.lineTo(w / 2, 0); c.lineTo(w, 14); c.lineTo(w, h); c.lineTo(0, h); c.fill();
          c.fillStyle = '#c8302a'; c.beginPath(); c.arc(w / 2, 28, 12, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#1a1010'; c.fillRect(w / 2 - 8, 24, 5, 3); c.fillRect(w / 2 + 3, 24, 5, 3); c.fillRect(w / 2 - 5, 33, 10, 2);
        });
        const emaM = new THREE.MeshLambertMaterial({ map: emaTex });
        for (let k = 0; k < 8; k++) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.18), emaM); e.position.set(2.45 + k * 0.25, 1.45 - (k % 2) * 0.05, 2.86); e.rotation.z = (r() - 0.5) * 0.2; g.add(e); }
        for (let k = 0; k < 3; k++) { const st = add(new THREE.CylinderGeometry(0.025, 0.03, 1.4, 6), 0xd8c8a0, -3.2 + k * 0.25, 0.8, 1.6); st.rotation.z = (k - 1) * 0.12; }
      }
      // 境内の木：住吉さんは松、一宮さんは楠
      for (const [u, v] of [[-4.2, -3.5], [4.2, -3]]) {
        const p = at(u, v);
        const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 5, 7), lam(0x4e3a2e));
        tr.position.set(u, 2.5, v);
        tr.rotation.z = sea ? (u > 0 ? -0.15 : 0.12) : 0;
        g.add(tr);
        for (let k = 0; k < 4; k++) {
          const c = new THREE.Mesh(sea ? new THREE.CylinderGeometry(1.4, 1.6, 0.5, 7) : new THREE.IcosahedronGeometry(1.6, 1), lam(sea ? 0x2f4a2e : 0x355c30, { flatShading: true }));
          c.position.set(u + (r() - 0.5) * 1.6, 4.4 + k * (sea ? 0.55 : 0.8), v + (r() - 0.5) * 1.6);
          c.castShadow = true;
          g.add(c);
        }
        addSolid(p.x, p.z, 0.6, 0.6, 0);
      }
      this.group.add(g);
      // 社殿のところは歩けない。参道（前）は歩ける
      const hc = at(0, -2);
      addSolid(hc.x, hc.z, 6.5, 7.5, -face);
      this.lampPositions.push([at(-2.6, 7).x, y0 + 1.5, at(-2.6, 7).z], [at(2.6, 7).x, y0 + 1.5, at(2.6, 7).z]);
    }
  }

  /**
   * 浄土寺：浄土寺山のふもとの古いお寺。南（海と道）に向いた山門、まっすぐの石畳の参道、
   * 正面に大きな本堂（国宝）、その東に二重の多宝塔（国宝）、西に阿弥陀堂。石灯籠、香炉、松
   */
  _jodoji() {
    const P = JODOJI;
    if (!P) return;
    const r = seededRandom('jodoji');
    const face = Math.PI;   // 正面は南（-Z）。町の座標では +Z が北
    const y0 = groundY(P.x, P.z - 6);
    const g = new THREE.Group();
    g.position.set(P.x, y0, P.z);
    g.rotation.y = face;   // ローカルの +Z（前）が南
    const add = (geo, color, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, typeof color === 'number' ? lam(color) : color); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    const wood = 0x6a3a26, white = 0xeee8dc, tile = 0x3a3e44, stone = 0xb4aea2;
    // 境内の地面（白い砂）
    add(new THREE.BoxGeometry(46, 0.4, 38), 0xcfc8ba, 0, -0.1, 6);
    // 参道の石畳（山門から本堂まで）
    for (let v = 24; v > 5; v -= 1.1) add(new THREE.BoxGeometry(2.6, 0.08, 1.0), new THREE.Color().setScalar(0.6 + r() * 0.07).getHex(), 0, 0.14, v);
    // 重なる屋根：w×d の箱に、四方へ反り出す屋根を n 段
    const roof = (w, d, y, k = 1) => {
      const R = Math.hypot(w, d) / 2 + 1.8 * k;
      const rf = add(new THREE.ConeGeometry(R, 2.2 * k, 4), tile, 0, y + 1.1 * k, 0, Math.PI / 4);
      rf.scale.set(1, 1, d / w);
      add(new THREE.BoxGeometry(w + 3 * k, 0.3, d + 3 * k), tile, 0, y + 0.1, 0);
      return rf;
    };
    const hall = (w, d, h, x, z, opts = {}) => {
      const grp = new THREE.Group();
      grp.position.set(x, 0, z);
      g.add(grp);
      const A = (geo, c, xx, yy, zz) => { const m = new THREE.Mesh(geo, lam(c)); m.position.set(xx, yy, zz); m.castShadow = m.receiveShadow = true; grp.add(m); return m; };
      A(new THREE.BoxGeometry(w + 1.6, 0.9, d + 1.6), stone, 0, 0.35, 0);           // 石の基壇
      A(new THREE.BoxGeometry(w, h, d), wood, 0, 0.8 + h / 2, 0);                   // 朱の柱と板壁
      A(new THREE.BoxGeometry(w + 0.02, h * 0.3, d + 0.02), white, 0, 0.8 + h * 0.85, 0);   // 白い小壁
      for (let k = 0; k <= 4; k++) A(new THREE.BoxGeometry(0.3, h, 0.3), 0x8a3a24, -w / 2 + (k * w) / 4, 0.8 + h / 2, d / 2 + 0.1);
      // 正面の格子戸
      for (let k = 0; k < 3; k++) A(new THREE.BoxGeometry(w / 4 - 0.3, h * 0.6, 0.06), 0x3a2a20, -w / 4 + (k * w) / 4, 0.8 + h * 0.32, d / 2 + 0.06);
      // 屋根（大きく反り出す寄棟風。opts.big で厚く高く）
      const k = opts.big ? 1.5 : 1;
      const R = Math.hypot(w, d) / 2 + 2.2 * k;
      const rf = A(new THREE.ConeGeometry(R, 3 * k, 4), tile, 0, 0.8 + h + 1.5 * k, 0);
      rf.rotation.y = Math.PI / 4; rf.scale.set(1, 1, d / w);
      A(new THREE.BoxGeometry(w + 3.4 * k, 0.35, d + 3.4 * k), tile, 0, 0.8 + h + 0.12, 0);
      A(new THREE.BoxGeometry(w * 0.55, 0.4, 0.4), tile, 0, 0.8 + h + 2.9 * k, 0);   // 棟
      // 正面の階段（向拝）
      A(new THREE.BoxGeometry(w * 0.4, 0.5, 1.4), stone, 0, 0.25, d / 2 + 1.3);
      return grp;
    };
    // 本堂（国宝）：正面の奥。大きな屋根
    hall(14, 11, 4.6, 0, 0, { big: true });
    // 阿弥陀堂：本堂の西（南を向けているので、ローカルの +X が東、-X が西）
    hall(9, 7.5, 3.6, -15, 2);
    // 多宝塔（国宝）：本堂の東。下は方形、白い亀腹、上は円い塔身に方形の屋根、てっぺんに相輪
    {
      const t = new THREE.Group();
      t.position.set(15, 0, 1);
      g.add(t);
      const A = (geo, c, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, typeof c === 'number' ? lam(c) : c); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; t.add(m); return m; };
      A(new THREE.BoxGeometry(7.4, 1.0, 7.4), stone, 0, 0.4, 0);
      A(new THREE.BoxGeometry(5.2, 3.4, 5.2), 0xa8442c, 0, 2.6, 0);                 // 一重目（朱）
      A(new THREE.BoxGeometry(5.24, 0.8, 5.24), white, 0, 3.9, 0);
      const r1 = A(new THREE.ConeGeometry(6.2, 1.6, 4), tile, 0, 5.2, 0, Math.PI / 4);
      A(new THREE.BoxGeometry(8.6, 0.25, 8.6), tile, 0, 4.45, 0);
      A(new THREE.SphereGeometry(2.1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 5.6, 0);   // 亀腹（白いまんじゅう形）
      A(new THREE.CylinderGeometry(1.7, 1.7, 2.2, 18), 0xa8442c, 0, 7.4, 0);         // 円い塔身
      A(new THREE.BoxGeometry(3.6, 0.5, 3.6), 0x8a3a24, 0, 8.7, 0);                  // 組物
      const r2 = A(new THREE.ConeGeometry(5.0, 2.0, 4), tile, 0, 9.9, 0, Math.PI / 4);
      A(new THREE.BoxGeometry(7.0, 0.25, 7.0), tile, 0, 9.0, 0);
      // 相輪：細い柱に九つの輪と、宝珠
      const gold = new THREE.MeshLambertMaterial({ color: 0x8a7a4a, emissive: 0x201808 });
      A(new THREE.CylinderGeometry(0.12, 0.16, 4.6, 8), gold, 0, 13.0, 0);
      for (let k = 0; k < 9; k++) A(new THREE.CylinderGeometry(0.5 - k * 0.025, 0.5 - k * 0.025, 0.12, 12), gold, 0, 11.6 + k * 0.33, 0);
      A(new THREE.SphereGeometry(0.28, 10, 8), gold, 0, 15.5, 0);
      void r1; void r2;
    }
    // 山門：参道の入口（道のそば）。二本の太い柱に、大きな屋根
    {
      const gz = 25;
      for (const u of [-2.4, 2.4]) for (const v of [-1, 1]) add(new THREE.BoxGeometry(0.45, 4.2, 0.45), 0x7a3a24, u, 2.1, gz + v);
      add(new THREE.BoxGeometry(6.4, 0.5, 3), 0x5a3020, 0, 4.4, gz);
      const rf = add(new THREE.ConeGeometry(5.6, 2.4, 4), tile, 0, 5.7, gz, Math.PI / 4);
      rf.scale.set(1, 1, 0.55);
      add(new THREE.BoxGeometry(8.6, 0.3, 4.6), tile, 0, 4.7, gz);
      const tex = labelTexture('浄土寺', { w: 128, h: 320, size: 92, bg: '#3a2a1e', fg: '#e8d8a0', vertical: true });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.3), new THREE.MeshLambertMaterial({ map: tex }));
      plate.position.set(0, 3.7, gz + 1.55);
      g.add(plate);
      // 山門の両わきの築地塀（白壁に瓦）
      for (const sd of [-1, 1]) {
        add(new THREE.BoxGeometry(17, 2.2, 0.7), white, sd * 12.4, 1.1, gz);
        add(new THREE.BoxGeometry(17.6, 0.3, 1.3), tile, sd * 12.4, 2.35, gz);
        add(new THREE.BoxGeometry(17, 0.5, 0.75), stone, sd * 12.4, 0.25, gz);
      }
    }
    // 石灯籠（参道の両側）、香炉、鐘楼の小さな屋根
    for (const v of [9, 15, 21]) for (const u of [-3.2, 3.2]) {
      add(new THREE.BoxGeometry(0.7, 0.3, 0.7), stone, u, 0.3, v);
      add(new THREE.CylinderGeometry(0.16, 0.2, 1.3, 8), stone, u, 1.1, v);
      add(new THREE.BoxGeometry(0.6, 0.5, 0.6), this.lanternMat || lam(stone), u, 2.0, v);
      add(new THREE.ConeGeometry(0.6, 0.45, 4), stone, u, 2.45, v, Math.PI / 4);
    }
    add(new THREE.CylinderGeometry(0.7, 0.55, 0.8, 10), 0x4a4440, 0, 0.6, 8);   // 香炉
    add(new THREE.ConeGeometry(0.9, 0.6, 8), 0x4a4440, 0, 1.3, 8);
    // 松（境内の四すみ）
    for (const [u, v] of [[-20, 18], [20, 18], [-21, -4], [21, -6], [8, 16], [-8, 16]]) {
      const tr = add(new THREE.CylinderGeometry(0.3, 0.45, 6, 7), 0x4e3a2e, u, 3, v);
      tr.rotation.z = (r() - 0.5) * 0.3;
      for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(1.8 - k * 0.2, 2.0 - k * 0.2, 0.6, 8), lam(0x2f4a2e, { flatShading: true }), u + (r() - 0.5) * 1.5, 5.2 + k * 0.7, v + (r() - 0.5) * 1.5);
    }
    this.group.add(g);
    // 堂と塔のところは歩けない
    const W = (u, v) => ({ x: P.x - u, z: P.z - v });   // 南向き（ローカル → 町の座標）
    for (const [u, v, w, d] of [[0, 0, 16, 13], [-15, 2, 10.5, 9], [15, 1, 7.6, 7.6]]) { const q = W(u, v); addSolid(q.x, q.z, w, d, 0); }
    const lampAt = W(0, 9);
    this.lampPositions.push([lampAt.x, y0 + 2, lampAt.z]);
  }

  _lamps() {
    const posts = [];
    for (const road of ROADS) {
      if (road.covered || roadLength(road.pts) < 20) continue;
      // 車の通る道は街灯を多めに、坂の小道は少なめに
      const s = samplePath(road.pts, road.surface === 'asphalt' ? 22 : 30);
      s.forEach((p, i) => {
        if (i === 0) return;
        const x = p.x - Math.sin(p.angle) * (road.width / 2 + 0.3), z = p.z + Math.cos(p.angle) * (road.width / 2 + 0.3);
        const y = groundY(x, z);
        if (this.inStationArea?.(x, z)) {
          // 駅前は、うすい青緑の柱に白い灯具がふたつの街灯
          posts.push({ x, y: y + 2, z, sx: 0.14, sy: 4, sz: 0.14, color: '#7fa898' });
          for (const sd of [-1, 1]) {
            const hx = x + Math.cos(p.angle) * sd * 0.45, hz = z + Math.sin(p.angle) * sd * 0.45;
            posts.push({ x: (x + hx) / 2, y: y + 3.75, z: (z + hz) / 2, sx: 0.06, sy: 0.06, sz: 0.06, color: '#7fa898' });
            this.stationLanterns.push({ x: hx, y: y + 3.55, z: hz, sx: 0.32, sy: 0.48, sz: 0.32, ry: -p.angle });
            this.lampPositions.push([hx, y + 3.55, hz]);
          }
          return;
        }
        posts.push({ x, y: y + 1.7, z, sx: 0.1, sy: 3.4, sz: 0.1, color: '#2f3336' });
        // 道のほうへ短い腕を出して、乳白の灯具
        const ax = -Math.sin(p.angle) * -0.35, az = Math.cos(p.angle) * -0.35;
        posts.push({ x: x + ax / 2, y: y + 3.42, z: z + az / 2, sx: 0.06, sy: 0.06, sz: 0.7, ry: -p.angle + Math.PI / 2, color: '#2f3336' });
        this.stationLanterns.push({ x: x + ax, y: y + 3.3, z: z + az, sx: 0.24, sy: 0.3, sz: 0.24 });
        this.lampPositions.push([x + ax, y + 3.3, z + az]);
      });
    }
    // 海ぞいの岸壁と、向島の岸にも、オレンジの灯りの列（町の夜景の、水ぎわの灯り）
    const shore = [];
    for (const line of COAST) {
      for (const p of samplePath(line, 24)) {
        if (p.x < BOUNDS.x0 || p.x > BOUNDS.x1 || p.z < BOUNDS.z0 || p.z > BOUNDS.z1) continue;
        const gy = groundY(p.x, p.z);
        if (gy - SEA_Y > 6) continue;
        shore.push([p.x, gy + 4.5, p.z]);
        // 尾道側の岸壁は、灯りの下に柱を立てる（陸側へ少し入ったところ）
        if (onOnomichiSide(p.x, p.z) && !this.inStationArea?.(p.x, p.z)) {
          let nx = -Math.sin(p.angle), nz = Math.cos(p.angle);
          if (terrainY(p.x + nx * 6, p.z + nz * 6) < terrainY(p.x - nx * 6, p.z - nz * 6)) { nx = -nx; nz = -nz; }
          const x = p.x + nx * 0.9, z = p.z + nz * 0.9;
          if (!inBuilding(x, z)) {
            const y = groundY(x, z);
            posts.push({ x, y: y + 2.2, z, sx: 0.13, sy: 4.4, sz: 0.13, color: '#3a3f42' });
            this.stationLanterns.push({ x, y: y + 4.5, z, sx: 0.34, sy: 0.42, sz: 0.34 });
            shore[shore.length - 1] = [x, y + 4.5, z];
          }
        }
      }
    }
    this.group.add(instancedChunks(posts, lam(0xffffff), { receive: false, geo: new THREE.CylinderGeometry(0.5, 0.6, 1, 5) }));
    if (this.stationLanterns.length) {
      this.lanternHeadMat = new THREE.MeshLambertMaterial({ color: 0xf4f0e6, emissive: 0xffb060, emissiveIntensity: 0 });
      this.group.add(instancedBoxes(this.stationLanterns, this.lanternHeadMat, { cast: false, receive: false, geo: new THREE.CylinderGeometry(0.5, 0.42, 1, 6) }));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...this.lampPositions.flat(), ...shore.flat()], 3));
    this.lampMat = new THREE.PointsMaterial({ map: glowTexture(), color: 0xff9a48, size: 2.2, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new THREE.Points(geo, this.lampMat));
    // 遠くからでも町の灯りがにじんで見えるよう、大きくうすい光の輪を重ねる
    this.lampHaloMat = new THREE.PointsMaterial({ map: glowTexture(), color: 0xff8a38, size: 6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.group.add(new THREE.Points(geo, this.lampHaloMat));
    this._reflections([...this.lampPositions, ...shore]);
  }

  /**
   * 夜の水面に映る灯り：岸の近くの灯りの真下（水面）から、こちらへ向かって縦にのびる光のすじ。
   * 1つの Points で描き、すじの形と、波によるゆらぎはシェーダーで
   */
  _reflections(lamps) {
    const pos = [], col = [], seed = [];
    const add = (x, z, color) => { pos.push(x, SEA_Y + 0.05, z); const c = new THREE.Color(color); col.push(c.r, c.g, c.b); seed.push(Math.random()); };
    for (const [x, , z] of lamps) {
      const d = distToCoast(x, z);
      if (d > 22) continue;
      // 灯りから、岸の外（海側）へ少し出たところ
      const sea = onOnomichiSide(x, z) ? -1 : 1;
      const st = straitAt(x).z;
      const wz = sea < 0 ? Math.max(z - d - 7, st + 5) : Math.min(z + d + 7, st - 5);
      add(x, wz, 0xff9a48);
    }
    for (const src of this.world.reflectSources || []) add(src.x, src.z, src.color);
    // クレーンのライトアップの色（夜ごとに変わるので、update で色を入れかえる）
    this.craneReflect = [];
    for (const L of this.world.craneLights) {
      const g = L.glows[0];
      this.craneReflect.push(pos.length / 3);
      add(g.position.x, g.position.z + 24, 0xffffff);
      this.craneReflect.push(pos.length / 3);
      add(g.position.x + 8, g.position.z + 30, 0xffffff);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
    this.reflectGeo = geo;
    this.reflectMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGlow: { value: 0 }, uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float seed;
        uniform float uScale, uTime;
        varying vec3 vColor;
        varying float vSeed;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vColor = color;
          vSeed = seed;
          gl_PointSize = clamp(14.0 * uScale / max(1.0, -mv.z), 2.0, 160.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uGlow;
        varying vec3 vColor;
        varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          // 細く、下へのびるすじ。波でゆらゆら、ところどころ切れる
          float wob = sin(c.y * 40.0 + uTime * 2.3 + vSeed * 30.0) * 0.035;
          float w = exp(-pow((c.x + wob) / 0.075, 2.0));
          float v = smoothstep(0.5, 0.15, abs(c.y)) * (0.6 + 0.4 * sin(c.y * 70.0 - uTime * 3.0 + vSeed * 9.0));
          float a = w * v * uGlow;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, this.reflectMat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  // ---------- 電車（JR山陽本線の実際の線形を走る） ----------
  _train() {
    this.tracks = TRAIN_TRACKS.map((pts) => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts, cum, length: cum[cum.length - 1] };
    });
    // 踏切が線路のどこにあるか
    this.crossings.forEach((c) => {
      c.at = this.tracks.map((t) => {
        let best = 0, bd = 1e9;
        t.pts.forEach((p, i) => { const d = Math.hypot(p[0] - c.x, p[1] - c.z); if (d < bd) { bd = d; best = t.cum[i]; } });
        return bd < 20 ? best : null;
      });
    });
    const body = lam(0xe8e6e0), stripe = lam(0xb8322a), dark = lam(0x2a2e33);
    const glass = lam(0x27303a), under = lam(0x3a3c40), roofM = lam(0x9a9c9e), wheel = lam(0x202224), light = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    this.trainWinMat = new THREE.MeshBasicMaterial({ color: 0xffe2c0, transparent: true, opacity: 0 });
    // 車体の断面：すその少しすぼまった側面と、丸い屋根。長さ方向（x）にのばす
    const CL = 19.5, CW = 2.9;
    const prof = new THREE.Shape();
    prof.moveTo(-CW / 2 + 0.08, 0.6); prof.lineTo(CW / 2 - 0.08, 0.6); prof.lineTo(CW / 2, 1.1); prof.lineTo(CW / 2, 3.35);
    prof.quadraticCurveTo(CW / 2, 3.85, CW / 2 - 0.45, 3.9); prof.lineTo(-CW / 2 + 0.45, 3.9); prof.quadraticCurveTo(-CW / 2, 3.85, -CW / 2, 3.35); prof.lineTo(-CW / 2, 1.1);
    const bodyGeo = new THREE.ExtrudeGeometry(prof, { depth: CL, bevelEnabled: false, curveSegments: 5 });
    bodyGeo.rotateY(Math.PI / 2);
    bodyGeo.translate(-CL / 2, 0, 0);
    const cars = [];
    for (let i = 0; i < 4; i++) {
      const car = new THREE.Group();
      const add = (geo, mat, x, y, z, shadow = false) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; car.add(m); return m; };
      const bx = (w, h, d, mat, x, y, z, shadow) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, shadow);
      add(bodyGeo, body, 0, 0, 0, true);
      // 側面：3つの両びらきの戸（戸の窓）と、そのあいだの窓、窓の下の帯
      for (const sd of [-1, 1]) {
        const z = sd * (CW / 2 + 0.01);
        bx(CL - 0.4, 0.32, 0.02, stripe, 0, 1.45, z);
        for (const dxp of [-6.3, 0, 6.3]) {
          bx(1.35, 1.95, 0.03, dark, dxp, 1.88, z);                            // 戸のすきま
          bx(1.28, 1.9, 0.04, body, dxp, 1.88, z);                             // 戸
          for (const h of [-0.33, 0.33]) bx(0.48, 0.75, 0.05, glass, dxp + h, 2.45, z);   // 戸の窓
        }
        for (const wx of [-8.9, -3.15, 3.15, 8.9]) bx(wx === -8.9 || wx === 8.9 ? 0.9 : 3.8, 0.85, 0.035, glass, wx, 2.55, z);
        // 夜の窓明かり（窓の高さの帯）
        add(new THREE.BoxGeometry(CL - 1, 0.7, 0.05), this.trainWinMat, 0, 2.55, z * 1.003);
      }
      // 床下の機器と、台車（2つ、車輪4つずつ）
      bx(CL - 5, 0.55, CW - 0.6, under, 0, 0.55, 0);
      for (const tx of [-CL / 2 + 2.6, CL / 2 - 2.6]) {
        bx(2.6, 0.45, CW - 0.4, under, tx, 0.45, 0);
        for (const ax of [-0.95, 0.95]) for (const sd of [-1, 1]) {
          const w = add(new THREE.CylinderGeometry(0.43, 0.43, 0.14, 12), wheel, tx + ax, 0.18, sd * 0.72);
          w.rotation.x = Math.PI / 2;
        }
      }
      // 屋根：冷房の箱と、2両目にはパンタグラフ
      for (const rx of [-4.5, 4.5]) bx(2.8, 0.35, 1.7, roofM, rx, 4.05, 0);
      if (i === 1) {
        bx(1.6, 0.12, 1.4, dark, 0, 4.0, 0);
        const arm1 = bx(1.7, 0.05, 0.05, dark, -0.4, 4.45, 0); arm1.rotation.z = 0.55;
        const arm2 = bx(1.7, 0.05, 0.05, dark, 0.4, 4.85, 0); arm2.rotation.z = -0.55;
        bx(0.15, 0.06, 1.8, dark, 0.05, 5.25, 0);
      }
      // 先頭車の顔（両端の車の外側の妻面）：黒い大きな窓、帯の色の顔、前照灯
      if (i === 0 || i === 3) for (const ex of [-1, 1]) {
        const x = ex * (CL / 2 + 0.02);
        bx(0.05, 1.25, CW - 0.35, glass, x, 2.75, 0);
        bx(0.05, 1.0, CW - 0.1, stripe, x, 1.5, 0);
        for (const sd of [-1, 1]) bx(0.06, 0.16, 0.36, light, x * 1.0005, 1.75, sd * 0.95);
        bx(0.06, 0.08, 1.1, dark, x * 1.0007, 3.55, 0);   // 行き先表示
      } else for (const ex of [-1, 1]) bx(0.3, 2.3, 1.3, dark, ex * (CL / 2 + 0.15), 2.1, 0);   // 貫通路のほろ
      car.visible = false;
      this.group.add(car);
      cars.push(car);
    }
    this.train = { cars, body, stripe, track: 0, s: 0, dir: 1, active: false, timer: 20 + this.r() * 30, speed: 17 };
  }

  _trackPoint(t, s) {
    const { pts, cum } = t;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(0.01, cum[i] - cum[i - 1]);
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, angle: Math.atan2(bz - az, bx - ax) };
  }

  /** 毎フレーム。電車が近づいて鳴りはじめた踏切を返す */
  update(time, elapsed, dt) {
    const night = time.p.night;
    if (this.bobTime) this.bobTime.value = elapsed;
    this.nightMats.forEach(({ mat, max }) => { mat.opacity = Math.min(max, night * 1.2); });
    this.glowMats.forEach(({ mat, base, add }) => { mat.emissiveIntensity = base + night * add; });
    this.lampMat.opacity = Math.min(1, night * 1.3);
    this.lampHaloMat.opacity = Math.min(0.2, night * 0.26);
    if (this.reflectMat) {
      this.reflectMat.uniforms.uTime.value = elapsed;
      this.reflectMat.uniforms.uGlow.value = Math.min(0.85, night * 1.1);
      this.reflectMat.uniforms.uScale.value = window.innerHeight * 0.9;
      // クレーンの映りこみは、その夜のライトアップの色
      const colA = this.reflectGeo.attributes.color;
      this.world.craneLights.forEach((L, i) => {
        const c = L.glows[0].material.color, k = L.glows[0].material.opacity * 2.4;
        for (const j of [this.craneReflect[i * 2], this.craneReflect[i * 2 + 1]]) colA.setXYZ(j, c.r * k, c.g * k, c.b * k);
      });
      colA.needsUpdate = true;
    }
    if (this.globeMat) this.globeMat.emissiveIntensity = night * 1.3;
    if (this.lanternHeadMat) this.lanternHeadMat.emissiveIntensity = night * 1.2;
    if (this.sandoFireMat) this.sandoFireMat.emissiveIntensity = night * 1.1;
    this.lanternMat.emissiveIntensity = night * 1.1;
    this.specialSignMats.forEach((m) => { m.emissiveIntensity = 0.2 + night * 0.7; });
    this.vendingMats.forEach((m) => { m.emissiveIntensity = 0.25 + night * 0.85; });
    this.lanternGlow.opacity = Math.min(0.85, night * 1.1);
    this.trainWinMat.opacity = Math.min(1, night * 1.2);
    this.signMat.emissiveIntensity = 0.15 + night * 0.6;
    this.arcadeLampMat.color.setScalar(0.7 + night * 0.3);
    if (this.skylightMat) this.skylightMat.emissiveIntensity = 0.5 * (1 - night);

    // ロープウェイ：片道およそ3分。2台が交互に上り下りし、駅で少し停まる
    const RIDE = 180, DWELL = 25, LEG = RIDE + DWELL;
    const cyc = elapsed % (LEG * 2);
    const up = cyc < LEG;
    const k = Math.min(1, (up ? cyc : cyc - LEG) / RIDE);
    const eased = k * k * (3 - 2 * k) * 0.08 + k * 0.92;
    const tA = up ? eased : 1 - eased;
    this.gondolas.forEach((gd) => {
      // 乗っているあいだは、1台目がこちらの乗っているゴンドラになる
      const t = gd.phase === 0 && this.ride ? this.ride.t : gd.phase === 0 ? tA : 1 - tA;
      gd.g.position.copy(this.cablePoint(t, gd.side));
      // 乗っているゴンドラは見えなくして、空の中にいるように（天井や壁で景色をふさがない）
      gd.g.visible = !(gd.phase === 0 && this.ride);
    });

    // 電車
    const T = this.train;
    const events = [];
    if (!T.active) {
      T.timer -= dt;
      if (T.timer <= 0) {
        T.active = true;
        // 走ってくる電車の色：白に赤い帯（227系のような）、橙と緑の湘南色、黄色一色（115系）
        const LIVERY = [[0xe8e6e0, 0xb8322a], [0xe0702a, 0x2f6b3a], [0xe8c020, 0xd8b018]];
        const lv = LIVERY[Math.floor(this.r() * LIVERY.length)];
        T.body.color.setHex(lv[0]);
        T.stripe.color.setHex(lv[1]);
        T.track = this.r() < 0.5 ? 0 : 1;
        T.dir = T.track === 0 ? 1 : -1;
        const L = this.tracks[T.track].length;
        T.s = T.dir > 0 ? -90 : L + 90;
        this.crossings.forEach((c) => { c.rang = false; });
      }
    } else {
      T.s += T.dir * T.speed * dt;
      const track = this.tracks[T.track];
      T.cars.forEach((car, i) => {
        const s = T.s - T.dir * i * 20.3;
        car.visible = s > 0 && s < track.length;
        if (!car.visible) return;
        const p = this._trackPoint(track, s);
        car.position.set(p.x, railGroundY(p.x, p.z) + 0.25, p.z);
        car.rotation.y = -p.angle;
      });
      if ((T.dir > 0 && T.s > track.length + 100) || (T.dir < 0 && T.s < -100)) {
        T.active = false;
        T.cars.forEach((c) => { c.visible = false; });
        T.timer = 70 + this.r() * 80;
      }
    }
    for (const c of this.crossings) {
      const at = T.active ? c.at[T.track] : null;
      let approaching = false;
      if (at !== null && at !== undefined) {
        const head = T.s, tail = T.s - T.dir * 82;
        approaching = T.dir > 0 ? head > at - 170 && tail < at + 6 : head < at + 170 && tail > at - 6;
      }
      if (approaching && !c.rang) { c.rang = true; events.push(c); }
      c.down += ((approaching ? 1 : 0) - c.down) * Math.min(1, dt * 1.5);
      c.arms.forEach((a) => { a.rotation.z = a.userData.side * 1.45 * (1 - c.down); });
      const blink = approaching ? Math.floor(elapsed * 2.2) % 2 : -1;
      // 灯は [左表, 左裏, 右表, 右裏] の順。左右が交互に点く
      c.lights.forEach((l, i) => {
        const on = blink === -1 ? 0 : Math.floor(i / 2) % 2 === blink ? 1 : 0.08;
        l.material.opacity = on;
        l.visible = on > 0;   // 消えているときは描かない
        l.userData.lens.emissiveIntensity = on * 2.2;
      });
    }
    return events;
  }
}
