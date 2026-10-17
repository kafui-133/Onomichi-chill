// 町の人：散歩する人、旅人、買い食いする人、自転車で通学する学生、ロードバイク、釣りの人、渡船を待つ人。
//   人数は多くしすぎない（画質の設定でさらに減らす）。時間帯によって、いる人といない人がいる。
//   歩いている人には近づくと話しかけられる（自転車の人は通りすぎていく）。
import * as THREE from 'three';
import { ROADS, BENCHES, PLACES, POIS, surfaceY, terrainY, groundY, pointAlong, roadLength, distToCoast, walkable, SEA_Y } from './townMap.js';
import { lam } from './townKit.js';
import { seededRandom, damp } from './util.js';

// ---------- 会話（地元の人は尾道弁、旅の人は標準語） ----------
const TALK = {
  stroller: [
    { lines: ['こんにちは。ええ天気じゃねえ。', 'わしゃあ毎日、この道を歩いとるんよ。坂がええ運動になる。', '猫？ おるおる。石段の上で、よう昼寝しとるよ。'] },
    { lines: ['あら、こんにちは。どちらから？', '尾道はね、坂と路地ばっかりじゃけど、そのぶん歩くと楽しいんよ。', '夕方になったら海のほうを見てごらん。向島の灯りがきれいなけえ。'] },
    { lines: ['おはようさん。早いねえ。', '朝の渡船の音を聞くとね、ああ一日が始まるなあ思うんよ。', 'ほいじゃ、またね。'], hours: [5, 10] },
    { lines: ['こんばんは。日が短うなったねえ。', '夕焼けのあとの、空が青うなる時間が好きなんよ。', '暗うなるけえ、気をつけて帰りんさいよ。'], hours: [16.5, 23] },
    { lines: ['このへんの家はね、坂の上に建っとるけえ、荷物を運ぶのがひと苦労なんよ。', 'じゃけど、どの家の窓からも海が見える。それがええんよね。', 'あんたも、ええ場所を見つけんさいね。'] },
  ],
  traveler: [
    { lines: ['こんにちは。旅の途中なんです。', '千光寺の上から見た尾道水道、思っていたよりずっと近くて、びっくりしました。', '次は渡船で向島に渡ってみようと思っています。'] },
    { lines: ['あ、こんにちは。猫、見かけました？', '猫の細道を歩いてきたんですけど、石に描いた猫ばかりで、本物はなかなか……。', 'でも、それもふくめて楽しいですね。'] },
    { lines: ['しまなみ海道を自転車で来たんです。', 'ここから今治まで、島をいくつも渡っていくんですよ。', '今日は尾道でひと休み。ラーメンを食べて帰ります。'] },
    { lines: ['写真を撮りながら、のんびり歩いてます。', '坂の途中で振り返ると、急に海が見えるでしょう。あれがたまらなくて。', 'よい旅を……って、あなたもですよね。'] },
    { lines: ['ロープウェイ、乗りました？', '下りは歩いてみたんです。お寺と石段と、猫と。あっという間でした。', '足はくたくたですけどね。'] },
  ],
  snacker: [
    { lines: ['ん、こんにちは。いま、かまぼこの天ぷら食べとるとこ。', '揚げたてが一番うまいんよ。あそこの店、行ってみんさい。', '歩きながら食べるのが、商店街のええところよね。'] },
    { lines: ['プリンを買いに来たんですけど、つい寄り道しちゃって。', 'パン屋さんのいい匂い、ずるいですよね。', 'おやつは別腹、ってことで。'] },
    { lines: ['この商店街、端から端まで歩くと結構あるんよ。', 'ラーメン屋さんの前は、昼どきになると行列じゃけえね。', 'あ、これ？ ワッフル。マロン珈琲のよ。'] },
  ],
  fisher: [
    { lines: ['しーっ……。いま、ちょっと引いとる気がするんよ。', '……なんじゃ、海藻じゃった。', 'ここはね、潮が動く時間がええんよ。チヌやメバルが釣れる。'] },
    { lines: ['こんにちは。釣れとるかって？ ぼちぼちじゃねえ。', '船が通るたびに波が来るけえ、のんびりやっとるんよ。', '釣れんでも、海を見とるだけでええんよ。'] },
  ],
  commuter: [
    { lines: ['向島に帰るとこなんよ。', '渡船はね、すぐそこじゃけど、毎日乗ると、ちょっとした船旅じゃ。', 'ほら、もう来た来た。'], hours: [14, 24] },
    { lines: ['おはようございます。これから仕事なんです。', '向島から渡船で通ってるんですよ。橋もあるけど、こっちのほうが早いし、気持ちいい。', 'それじゃ、いってきます。'], hours: [0, 12] },
  ],
};
const AKARI_LINE = { stroller: '今夜は灯りまつりじゃけえ、坂の上まで行ってみんさい。ろうそくがずうっと並んどるよ。', traveler: '今夜は灯りまつりなんですって。それが見たくて、もう一泊することにしました。' };

// 種類ごとの、見た目・速さ・いる時間・人数
const KINDS = {
  stroller: { labels: ['散歩中のおじいさん', '散歩中のおばあさん', '近所の人'], speed: 0.95, hours: [[6, 20.5]], count: 6 },
  traveler: { labels: ['旅の人'], speed: 1.15, hours: [[8.5, 18.5]], count: 5 },
  snacker: { labels: ['買い食い中の人'], speed: 0.8, hours: [[10, 19.5]], count: 4 },
  student: { labels: ['自転車の学生'], speed: 4.2, hours: [[7, 8.7], [15.6, 18.2]], count: 5, bike: true },
  roadbike: { labels: ['ロードバイクの人'], speed: 7.5, hours: [[8, 17]], count: 2, bike: true },
  fisher: { labels: ['釣りの人'], speed: 0, hours: [[5.5, 18.5]], count: 3 },
  commuter: { labels: ['渡船を待つ人'], speed: 0, hours: [[6.8, 9.2], [16.5, 19.6]], count: 2 },
};

const PAL = {
  skin: ['#e8c4a2', '#dcb08c', '#f0d2b6'],
  hair: ['#1e1814', '#2c2219', '#4a3a2c', '#8a8580', '#d8d4cc'],
  top: ['#6b8aa6', '#c25a42', '#e8e2d4', '#4f6b4a', '#d8a84a', '#3e4a5e', '#9a6a8a', '#7a8a6a'],
  bottom: ['#3a3f4a', '#5a4a3a', '#2a2e36', '#7a7064', '#4a5a6a'],
};

// ---------- かたち（共有のジオメトリ） ----------
let G = null;
function geos() {
  if (G) return G;
  const leg = new THREE.CapsuleGeometry(0.068, 0.66, 3, 8); leg.translate(0, -0.4, 0);
  const arm = new THREE.CapsuleGeometry(0.05, 0.46, 3, 8); arm.translate(0, -0.27, 0);
  const torso = new THREE.CapsuleGeometry(0.155, 0.4, 4, 10); torso.scale(1.05, 1, 0.68);
  const hair = new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const hat = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 14); hat.translate(0, 0.07, 0);
  const crown = new THREE.CylinderGeometry(0.11, 0.12, 0.1, 12); crown.translate(0, 0.12, 0);
  const pack = new THREE.BoxGeometry(0.3, 0.38, 0.16);
  const wheel = new THREE.TorusGeometry(0.33, 0.022, 6, 20); wheel.rotateY(Math.PI / 2);
  const bar = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);
  G = { leg, arm, torso, hair, hat, crown, pack, wheel, bar,
    head: new THREE.SphereGeometry(0.118, 14, 10), eye: new THREE.SphereGeometry(0.014, 6, 4), shoe: new THREE.BoxGeometry(0.11, 0.07, 0.22),
    rod: new THREE.CylinderGeometry(0.008, 0.014, 3.2, 5), item: new THREE.BoxGeometry(0.08, 0.06, 0.12) };
  return G;
}
const MATS = new Map();
const mat = (c) => { if (!MATS.has(c)) MATS.set(c, lam(c)); return MATS.get(c); };

/** 人をひとり組み立てる。正面は +Z。足もとが原点 */
function buildPerson(kind, r) {
  const g = geos();
  const pick = (a) => a[Math.floor(r() * a.length)];
  const root = new THREE.Group();
  const body = new THREE.Group();          // 自転車に乗るときは上に持ちあげる
  root.add(body);
  const h = 0.92 + r() * 0.14;
  body.scale.setScalar(h);
  const skin = mat(pick(PAL.skin));
  const elder = kind === 'stroller' && r() < 0.6;
  let top = pick(PAL.top), bottom = pick(PAL.bottom);
  if (kind === 'student') { top = r() < 0.5 ? '#f4f2ec' : '#2a3048'; bottom = '#262a36'; }
  if (kind === 'roadbike') { top = pick(['#d83a2a', '#2a7ad8', '#f0c020']); bottom = '#1a1a1e'; }
  const parts = {};
  for (const side of [-1, 1]) {
    const L = new THREE.Group();
    L.position.set(side * 0.1, 0.86, 0);
    const leg = new THREE.Mesh(g.leg, mat(bottom));
    const shoe = new THREE.Mesh(g.shoe, mat('#2a2622'));
    shoe.position.set(0, -0.82, 0.04);
    L.add(leg, shoe);
    body.add(L);
    parts[side < 0 ? 'legL' : 'legR'] = L;
    const A = new THREE.Group();
    A.position.set(side * 0.205, 1.42, 0);
    A.rotation.z = side * 0.06;
    A.add(new THREE.Mesh(g.arm, mat(top)));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
    hand.position.y = -0.52;
    A.add(hand);
    body.add(A);
    parts[side < 0 ? 'armL' : 'armR'] = A;
  }
  const torso = new THREE.Mesh(g.torso, mat(top));
  torso.position.y = 1.18;
  torso.castShadow = true;
  const head = new THREE.Group();
  head.position.y = 1.56;
  head.add(new THREE.Mesh(g.head, skin));
  const hairM = new THREE.Mesh(g.hair, mat(elder ? pick(['#8a8580', '#d8d4cc']) : pick(PAL.hair.slice(0, 3))));
  hairM.position.set(0, 0.015, -0.018);
  hairM.rotation.x = -0.55;   // 前髪は額の上まで。顔は見えるように
  head.add(hairM);
  for (const sx of [-1, 1]) { const eye = new THREE.Mesh(g.eye, mat('#1e1a18')); eye.position.set(sx * 0.04, -0.005, 0.105); head.add(eye); }
  body.add(torso, head);
  parts.head = head;
  parts.torso = torso;
  // 持ち物・帽子
  if (kind === 'traveler') {
    const pack = new THREE.Mesh(g.pack, mat(pick(['#4a6a8a', '#8a5a3a', '#3a5a3a', '#c8b48a'])));
    pack.position.set(0, 1.22, -0.22);
    body.add(pack);
    if (r() < 0.6) { const hat = new THREE.Group(); hat.add(new THREE.Mesh(g.hat, mat('#d8c8a0')), new THREE.Mesh(g.crown, mat('#d8c8a0'))); head.add(hat); }
  }
  if (elder && r() < 0.6) { const hat = new THREE.Group(); hat.add(new THREE.Mesh(g.hat, mat('#e8e2d4')), new THREE.Mesh(g.crown, mat('#e8e2d4'))); head.add(hat); }
  if (kind === 'roadbike') { const helm = new THREE.Mesh(g.hair, mat('#f4f2ec')); helm.scale.setScalar(1.15); helm.position.y = 0.03; head.add(helm); }
  if (kind === 'snacker') { const item = new THREE.Mesh(g.item, mat(pick(['#e8b860', '#c88a4a', '#f4e8d0']))); item.position.set(0, -0.56, 0.05); parts.armR.add(item); parts.armR.rotation.x = -1.1; }
  if (kind === 'fisher') {
    const hat = new THREE.Group(); hat.add(new THREE.Mesh(g.hat, mat('#4a5a4a')), new THREE.Mesh(g.crown, mat('#4a5a4a'))); head.add(hat);
    const rod = new THREE.Mesh(g.rod, mat('#2a2622'));
    rod.position.set(0, -0.5, 1.4);
    rod.rotation.x = 1.2;
    parts.armR.add(rod);
    parts.armR.rotation.x = -0.9;
    parts.armL.rotation.x = -0.7;
    // 糸（竿の先から海へ）
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 3, 3), mat('#d8d8d8'));
    line.position.set(0.24, 0.55, 2.55);
    body.add(line);
  }
  if (KINDS[kind].bike) {
    const bike = new THREE.Group();
    const frameC = kind === 'student' ? pick(['#a8acb0', '#3a5a8a', '#8a2a2a']) : pick(['#1a1a1e', '#e8e8e8', '#2a6ad8']);
    for (const z of [-0.52, 0.52]) { const w = new THREE.Mesh(g.wheel, mat('#1e1e20')); w.position.set(0, 0.34, z); bike.add(w); }
    const tube = (a, b, c = frameC) => {
      const m = new THREE.Mesh(g.bar, mat(c));
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      m.position.copy(va).add(vb).multiplyScalar(0.5);
      m.scale.y = va.distanceTo(vb);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      bike.add(m);
    };
    tube([0, 0.34, -0.52], [0, 0.82, -0.2]); tube([0, 0.34, 0.52], [0, 0.95, 0.42]); tube([0, 0.82, -0.2], [0, 0.95, 0.42]); tube([0, 0.34, -0.1], [0, 0.82, -0.2]);
    tube([0, 0.34, -0.1], [0, 0.34, -0.52]);
    tube([-0.24, 0.98, 0.42], [0.24, 0.98, 0.42], '#2a2a2a');
    if (kind === 'student') { const basket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.26), mat('#8a8e92')); basket.position.set(0, 0.88, 0.62); bike.add(basket); }
    root.add(bike);
    // 乗った姿勢：サドルに腰かけて、前のハンドルに手をのばす
    body.position.set(0, 0.06, -0.28);
    torso.rotation.x = kind === 'roadbike' ? 0.75 : 0.25;
    torso.position.z = kind === 'roadbike' ? 0.12 : 0.04;
    head.position.z = kind === 'roadbike' ? 0.32 : 0.12;
    head.position.y = kind === 'roadbike' ? 1.45 : 1.53;
    for (const a of [parts.armL, parts.armR]) { a.rotation.x = kind === 'roadbike' ? -1.2 : -0.85; }
  }
  return { root, parts, label: KINDS[kind].labels[elder ? Math.floor(r() * 2) : Math.min(KINDS[kind].labels.length - 1, 2)] };
}

// ---------- どこにいるか ----------
function placeOf(name) { return PLACES.find((p) => p.name === name || p.id === name); }
function roadsNear(points, radius, filter) {
  return ROADS.filter((rd) => {
    if (rd.alley || rd.connector) return false;
    if (filter && !filter(rd)) return false;
    const len = roadLength(rd.pts);
    if (len < 30) return false;
    const m = pointAlong(rd.pts, 0.5);
    return points.some((p) => p && Math.hypot(p.x - m.x, p.z - m.z) < radius);
  });
}

export class People {
  /** amount: 画質に応じた人数の割合（1 = すべて） */
  constructor(scene, amount = 1) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.list = [];
    this.talking = null;
    const r = seededRandom('people');
    const spots = {
      arcade: ROADS.filter((rd) => rd.covered && roadLength(rd.pts) > 40),
      sights: roadsNear(['千光寺', '猫の細道', '天寧寺 三重塔', '艮神社', 'ロープウェイ山麓駅', '尾道駅前'].map(placeOf), 140),
      coast: roadsNear(BENCHES.slice(0, 30), 40, (rd) => rd.surface !== 'stone'),
      near: roadsNear([{ x: 0, z: 0 }, placeOf('猫の細道')], 220),
      flat: ROADS.filter((rd) => !rd.alley && !rd.connector && rd.surface !== 'stone' && roadLength(rd.pts) > 70 && terrainY(...rd.pts[0]) - SEA_Y < 10 && terrainY(...rd.pts[rd.pts.length - 1]) - SEA_Y < 10),
    };
    const roadsFor = {
      stroller: [...spots.coast, ...spots.near, ...spots.arcade],
      traveler: [...spots.sights, ...spots.arcade],
      snacker: spots.arcade,
      student: [...spots.flat, ...spots.arcade],
      roadbike: spots.coast.length ? spots.coast.filter((rd) => roadLength(rd.pts) > 80) : spots.flat,
    };
    for (const kind of Object.keys(KINDS)) {
      const n = Math.max(1, Math.round(KINDS[kind].count * amount));
      for (let i = 0; i < n; i++) {
        const p = this._spawn(kind, r, roadsFor[kind], i);
        if (p) this.list.push(p);
      }
    }
  }

  _spawn(kind, r, roads, i) {
    const k = KINDS[kind];
    const { root, parts, label } = buildPerson(kind, r);
    const person = { kind, root, parts, label, speed: k.speed * (0.85 + r() * 0.3), hours: k.hours, phase: r() * 10, pause: 0, face: 0, talk: TALK[kind] ? Math.floor(r() * 1000) : -1 };
    if (kind === 'fisher') {
      // 海沿いのベンチの前、岸壁のきわに立って、海へ糸をたれる
      const benches = BENCHES.filter((b) => groundY(b.x, b.z) - SEA_Y < 4);
      const b = benches[Math.floor(((i + 0.5) / KINDS.fisher.count) * benches.length)];
      if (!b) return null;
      const dx = -Math.sin(b.yaw), dz = -Math.cos(b.yaw);
      let x = b.x + 2 * Math.cos(b.yaw), z = b.z - 2 * Math.sin(b.yaw);
      for (let s = 0; s < 16 && distToCoast(x, z) > 1.1; s++) { const nx = x + dx * 0.5, nz = z + dz * 0.5; if (!walkable(nx, nz)) break; x = nx; z = nz; }
      person.fixed = { x, z, yaw: Math.atan2(dx, dz) };
    } else if (kind === 'commuter') {
      const pier = placeOf('渡船のりば（尾道渡船）');
      if (!pier) return null;
      const sx = Math.cos(pier.yaw) * (i ? 1.6 : -1.4), sz = -Math.sin(pier.yaw) * (i ? 1.6 : -1.4);
      person.fixed = { x: pier.x + sx, z: pier.z + sz, yaw: Math.atan2(-Math.sin(pier.yaw), -Math.cos(pier.yaw)) };
    } else {
      if (!roads?.length) return null;
      person.road = roads[Math.floor(r() * roads.length)];
      person.len = roadLength(person.road.pts);
      person.f = r();
      person.dir = r() < 0.5 ? 1 : -1;
      person.lane = (r() - 0.5) * Math.min(1.6, person.road.width * 0.5);
      this._advance(person, 0);
    }
    if (person.fixed) {
      root.position.set(person.fixed.x, surfaceY(person.fixed.x, person.fixed.z), person.fixed.z);
      root.rotation.y = person.fixed.yaw;
      person.face = person.fixed.yaw;
    }
    this.group.add(root);
    return person;
  }

  _present(p, hour) { return p.hours.some(([a, b]) => hour >= a && hour < b); }

  /** 話しかけられる人（歩いている人・止まっている人。自転車は通りすぎる） */
  near(x, z, radius = 2.4) {
    let best = null, bd = radius;
    for (const p of this.list) {
      if (!p.root.visible || KINDS[p.kind].bike) continue;
      const d = Math.hypot(p.root.position.x - x, p.root.position.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** 話しかける。1回目で最初のひとこと、押すたびに続き。終わったら null */
  talk(p, hour, event) {
    if (this.talking?.p !== p) {
      const sets = TALK[p.kind].filter((s) => !s.hours || (hour >= s.hours[0] && hour < s.hours[1]));
      const set = sets[p.talk % sets.length];
      const lines = [...set.lines];
      if (event === 'akari' && AKARI_LINE[p.kind] && hour > 15) lines.splice(lines.length - 1, 0, AKARI_LINE[p.kind]);
      this.talking = { p, lines, i: 0 };
      p.talk++;   // 次に話すときは、別の話
    } else this.talking.i++;
    const t = this.talking;
    if (t.i >= t.lines.length) { this.talking = null; return null; }
    return { who: p.label, text: t.lines[t.i], last: t.i === t.lines.length - 1 };
  }

  endTalk() { this.talking = null; }

  update(dt, hour, camPos, player) {
    for (const p of this.list) {
      const pos = p.root.position;
      const dCam = Math.hypot(pos.x - camPos.x, pos.z - camPos.z);
      const present = this._present(p, hour);
      // いない時間になったら、見ていないところで帰っていく
      if (!present && (dCam > 40 || !p.root.visible)) { p.root.visible = false; continue; }
      if (present && !p.root.visible && dCam < 40 && !p.fixed) continue; // 目の前に急にあらわれないように
      p.root.visible = dCam < 260;
      if (!p.root.visible) { if (!p.fixed) this._advance(p, dt); continue; }
      const talkingTo = this.talking?.p === p;
      const dPlayer = player ? Math.hypot(pos.x - player.x, pos.z - player.z) : 99;
      if (talkingTo && dPlayer > 4.5) this.talking = null;
      let moving = false;
      if (!p.fixed) {
        // こちらとぶつかりそうなら、少し待つ。話しているあいだは止まる
        const blocked = talkingTo || (dPlayer < (KINDS[p.kind].bike ? 3 : 1.3) && this._ahead(p, player));
        if (p.pause > 0) p.pause -= dt;
        else if (!blocked) { this._advance(p, dt); moving = true; }
      }
      // 向き：歩く向き、話しているときはこちら
      let face = p.face;
      if (talkingTo && player) face = Math.atan2(player.x - pos.x, player.z - pos.z);
      let d = ((face - p.root.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      p.root.rotation.y += d * (1 - Math.exp(-6 * dt));
      this._animate(p, dt, moving, talkingTo);
    }
  }

  _ahead(p, player) {
    const pos = p.root.position;
    return (player.x - pos.x) * Math.sin(p.face) + (player.z - pos.z) * Math.cos(p.face) > -0.3;
  }

  _advance(p, dt) {
    p.f += (p.dir * p.speed * dt) / p.len;
    if (p.f > 1 || p.f < 0) {
      // 道の端：ひと息ついて、引き返す
      p.f = Math.min(1, Math.max(0, p.f));
      p.dir *= -1;
      p.pause = KINDS[p.kind].bike ? 0.5 : 2 + Math.random() * 4;
    }
    const a = pointAlong(p.road.pts, p.f);
    const b = pointAlong(p.road.pts, Math.min(1, Math.max(0, p.f + p.dir * (1.5 / p.len))));
    const ang = Math.atan2(b.x - a.x, b.z - a.z);
    const lane = p.lane * p.dir;
    const x = a.x + Math.cos(ang) * lane, z = a.z - Math.sin(ang) * lane;
    p.root.position.set(x, surfaceY(x, z), z);
    if (Math.hypot(b.x - a.x, b.z - a.z) > 0.01) p.face = ang;
  }

  _animate(p, dt, moving, talking) {
    const P = p.parts;
    const bike = KINDS[p.kind].bike;
    if (moving) p.phase += dt * (bike ? p.speed * 1.6 : p.speed * 5.2);
    const s = moving ? Math.sin(p.phase) : 0;
    if (bike) {
      // ペダルをこぐ
      P.legL.rotation.x = -1.1 + Math.sin(p.phase) * 0.45;
      P.legR.rotation.x = -1.1 - Math.sin(p.phase) * 0.45;
      return;
    }
    if (p.kind === 'fisher' || p.kind === 'commuter') {
      P.head.rotation.x = Math.sin(p.phase += dt * 0.4) * 0.05;
      if (talking) P.head.rotation.y = Math.sin(performance.now() / 600) * 0.08;
      return;
    }
    P.legL.rotation.x = damp(P.legL.rotation.x, s * 0.55, 12, dt);
    P.legR.rotation.x = damp(P.legR.rotation.x, -s * 0.55, 12, dt);
    if (p.kind !== 'snacker') P.armR.rotation.x = damp(P.armR.rotation.x, s * 0.45, 12, dt);
    P.armL.rotation.x = damp(P.armL.rotation.x, -s * 0.45, 12, dt);
    P.torso.position.y = 1.18 + (moving ? Math.abs(Math.cos(p.phase)) * 0.025 : 0);
    // 話しているあいだは、ときどきうなずく
    P.head.rotation.x = talking ? Math.max(0, Math.sin(performance.now() / 380)) * 0.12 : damp(P.head.rotation.x, 0, 4, dt);
  }
}
