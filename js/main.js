// 『坂道の空き家、尾道にて』技術検証プロトタイプ：エントリポイント
import * as THREE from 'three';
import { TimeSystem, TIME_PRESETS } from './timeOfDay.js';
import { Sky, Sea } from './sky.js';
import { World, SEA_LEVEL } from './world.js';
import { Room } from './room.js';
import { Boats } from './boats.js';
import { Cat, COATS } from './cat.js';
import { AudioEngine } from './audio.js';
import { LookControls } from './controls.js';
import { developFilm } from './photo.js';
import { Town } from './town.js';
import { Food } from './food.js';
import { Walker } from './walker.js';
import { MapView } from './mapView.js';
import { Zukan } from './zukan.js';
import { Diary } from './diary.js';
import { ITEMS } from './items.js';
import { quality } from './quality.js';
import { EVENTS, eventsOn, eventGlow, forcedEvent, setForcedEvent, whenLabel, dateOf } from './events.js';
import { Festivals } from './festivals.js';
import { Candles } from './candles.js';
import { look, Look, applyToonShading } from './look.js';
import { People } from './people.js';
import { Koji } from './koji.js';

// 絵作り：トゥーン調の陰影は、シェーダーを組み立てる前（いちばん初めの描画の前）に入れる
applyToonShading();
import { PLACES, CROSSINGS, ROADS, BENCHES, ROPEWAY, ROPEWAY_STOPS, POIS, KOJI, groundY, surfaceY, placeName, zoneWeights, pointAlong, clampToRoads, nearestRoad } from './townMap.js';
import { kanjiNumber, smoothstep, clamp } from './util.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const $ = (id) => document.getElementById(id);

// ---------- レンダラ・シーン ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// スマホ・タブレット（指で操作する端末）では描画を少し軽くする
const COARSE = window.matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.s.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // 空のグラデーションを狙いどおりの色で出す
renderer.shadowMap.enabled = quality.s.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x88aacc, 420, 3200);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.03, 7000);
camera.position.set(0, 1.08, 0.78); // 座布団に座った目の高さ
const view = new Look(renderer, scene, camera, quality.s); // 輪郭線・光のにじみ・色調（元の絵では何もしない）

// ---------- 時間 ----------
const todayIndex = Math.floor(Date.now() / 86400000);
const startHour = params.has('hour') ? parseFloat(params.get('hour')) : 16.9;
const time = new TimeSystem({ day: todayIndex, hour: startHour });

// ---------- ライト ----------
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(quality.s.shadowSize, quality.s.shadowSize);
sun.shadow.camera.left = -4.5;
sun.shadow.camera.right = 4.5;
sun.shadow.camera.top = 4.5;
sun.shadow.camera.bottom = -4.5;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.target.position.set(0, 0.6, 0.4);
scene.add(sun, sun.target);

// ---------- 世界 ----------
const sky = new Sky(scene);
const sea = new Sea(scene, SEA_LEVEL);
const world = new World(scene);
const room = new Room(scene);
const boats = new Boats(scene);
const town = new Town(scene, world);
const people = new People(scene, quality.s.people);
const cat = new Cat(scene);
const audio = new AudioEngine();

// 町の野良猫たち（その場所から動かない。触れると反応する）
// 置き場所は実際の道の上から選ぶ
const onRoad = (name, f, side = 0) => {
  const r = ROADS.find((rr) => rr.name === name);
  if (!r) return null;
  const p = pointAlong(r.pts, f);
  const off = side * (r.width / 2 - 0.4);
  return { x: p.x - Math.sin(p.angle) * off, z: p.z + Math.cos(p.angle) * off, heading: -p.angle + Math.PI / 2 };
};
const nearRopeway = clampToRoads(ROPEWAY.base.x + 6, ROPEWAY.base.z - 6);
const bench = BENCHES[0];
// 板張りのベンチ（style: deck）の上で寝そべる猫
const deckBench = BENCHES.find((b) => b.style === 'deck');
// 名所のそばの道の上
const nearPoi = (name) => {
  const p = POIS.find((q) => q.n === name);
  if (!p) return null;
  // 名所にいちばん近い道の上（端の石垣にかからないよう、少し内側）で、名所のほうを向く
  const n = nearestRoad(p.x, p.z);
  const d = Math.hypot(p.x - n.px, p.z - n.pz) || 1;
  const off = Math.max(0, n.seg.half - 0.45);
  const x = n.px + ((p.x - n.px) / d) * off, z = n.pz + ((p.z - n.pz) / d) * off;
  return { x, z, heading: Math.atan2(p.x - x, p.z - z) };
};
// level は、はじめて会ったときの懐き具合
const STRAYS = [
  { id: 'hosomichi', name: 'ほそみち', coat: 'kijitora', where: '猫の細道の石段', hint: '猫の細道のあたりで見かけるらしい', ...onRoad('猫の細道', 0.62, 1), pose: 'loaf', level: 1 },
  { id: 'fukuishi', name: 'まるいし', coat: 'shiro', where: '猫の細道の下のほう、猫の絵の丸い石のそば', hint: '猫の細道の、下のほうにいるらしい', ...onRoad('猫の細道', 0.25, -1), pose: 'curl', level: 2 },
  { id: 'ropeway', name: 'ゴンドラ', coat: 'hachiware', where: 'ロープウェイ山麓駅のそば', hint: 'ロープウェイの駅のあたりにいるらしい', x: nearRopeway.x, z: nearRopeway.z, heading: 0.4, pose: 'sit', level: 1 },
  { id: 'shotengai', name: 'かんばん', coat: 'chatora', where: '本通り商店街の店先', hint: '商店街の、どこかの店先にいるらしい', ...onRoad('本町センター街', 0.4, 1), pose: 'loaf', level: 2 },
  bench && { id: 'umibe', name: 'しおかぜ', coat: 'mike', where: '海沿いのベンチの横', hint: '海沿いのベンチのあたりにいるらしい', x: bench.x + Math.cos(bench.yaw) * 1.4, z: bench.z - Math.sin(bench.yaw) * 1.4, heading: bench.yaw + Math.PI, pose: 'sit', level: 1 },
  deckBench && { id: 'bench', name: 'いたべんち', coat: 'sabatora', where: '海沿いの、板張りのベンチの上', hint: '海沿いの、板張りのベンチにいるらしい', x: deckBench.x, z: deckBench.z, y: deckBench.y + 0.47, heading: deckBench.yaw + Math.PI / 2, pose: 'loaf', level: 1 },
  { id: 'ishidan', name: 'となり', coat: 'chashiro', where: '空き家の前の石段', hint: '家のすぐ近くにいるらしい', ...onRoad('空き家への石段', 0.8), pose: 'sit', level: 2 },
  { id: 'senkoji', name: 'やまぬし', coat: 'kijitora', where: '千光寺の境内', hint: '千光寺のあたりにいるらしい', ...nearPoi('千光寺'), pose: 'sit', level: 1 },
  { id: 'tennei', name: 'くろとう', coat: 'kuro', where: '天寧寺 三重塔のそば', hint: '三重塔のあたりにいるらしい', ...nearPoi('天寧寺三重塔'), pose: 'loaf', level: 1 },
].filter((c) => c && c.x !== undefined);
const strays = STRAYS.map((c) => new Cat(scene, {
  id: c.id, coat: c.coat,
  fixed: { pos: new THREE.Vector3(c.x, c.y ?? surfaceY(c.x, c.z), c.z), pose: c.pose, heading: c.heading, level: c.level },
}));
const allCats = [cat, ...strays];

// ---------- 季節のイベント（尾道灯りまつり など） ----------
// 灯りは、イベントのある日になってから作る（ふだんは何も足さない）
let candles = null;
let eventShownDay = null;
const eventShown = {};   // イベントごとの、知らせを出した日
const festivals = new Festivals(scene, town, audio);
festivals.onToast = (m) => { toast(m, 5000); diary.event?.('ベッチャー祭りで、鬼に祝い棒でたたかれた。これで一年、元気でいられるらしい。'); };
function prepareEvents() {
  const evs = eventsOn(time.day);
  if (evs.some((e) => e.id === 'akari') && !candles) candles = new Candles(scene, town, quality.s.candles);
  festivals.set(evs.map((e) => e.id));
  return evs;
}
let todaysEvents = prepareEvents();
time.onDayChange(() => { todaysEvents = prepareEvents(); });
const COAT_LABEL = (k) => COATS[k]?.label || '';
const catByHitbox = new Map(allCats.map((c) => [c.hitbox, c]));

// 歩いているときの手もとの灯り（夜だけ）
const walkLight = new THREE.PointLight(0xffd29a, 0, 22, 1.4);
scene.add(walkLight);
let mode = 'room'; // 'room' | 'walk'

// 窓から差し込む光の中の埃
const dust = (() => {
  const n = 160;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 4.5;
    pos[i * 3 + 1] = Math.random() * 2.2;
    pos[i * 3 + 2] = -1.4 + Math.random() * 3.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xfff0d0, size: 0.008, transparent: true, opacity: 0.3, depthWrite: false, fog: false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return pts;
})();

// ---------- 操作 ----------
const controls = new LookControls(camera, renderer.domElement, {
  pickables: () => (mode === 'room' ? [cat.hitbox] : strays.filter((c) => c.root.position.distanceTo(camera.position) < 6).map((c) => c.hitbox)),
  onPoke: (h) => { const c = catByHitbox.get(h); c?.poke(); if (c) diary.pettedCat(entryOf.get(c).name); },
  onStroke: (dt, h) => catByHitbox.get(h)?.stroke(dt),
  onRelease: (h) => catByHitbox.get(h)?.release(),
  onHover: (h) => document.body.classList.toggle('hover-cat', h),
  onLockChange: (on) => {
    if (on && !lockHinted) { lockHinted = true; toast('マウスで見渡す　・　Esc でカーソルを出す', 3600); }
  },
});
let lockHinted = false;
// パソコンでは、ボタンにキーの割り当てを表示する
document.body.classList.toggle('show-keys', controls.mouseLook);
// 地図・持ち物などの画面を開いたら、カーソルを出す（ボタンを押せるように）
new MutationObserver(() => {
  if (document.querySelector('.modal:not(.hidden)') || !$('diary-view').classList.contains('hidden')) controls.unlock();
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

// ---------- 猫と音をつなぐ ----------
const catDir = (c = cat) => new THREE.Vector3().subVectors(c.root.position, camera.position);
const audible = (c) => (mode === 'room' ? c === cat : c !== cat && catDir(c).length() < 14);
cat.on('levelup', (lv, text) => text && toast(text, 6000));
strays.forEach((c) => c.on('levelup', (lv, text) => text && toast(text, 4500)));
cat.on('notice', (text) => toast(text, 3500));
cat.on('flinch', () => toast('（びくっ）……そっとしておこう', 3000));
allCats.forEach((c) => {
  c.on('meow', (lv) => { if (audible(c)) { const d = catDir(c); audio.meow(lv, d.x, d.z); } });
  c.on('slap', () => { if (audible(c) && catDir(c).length() < 5) { const d = catDir(c); audio.tailSlap(d.x, d.z); } });
  c.on('land', () => { if (audible(c)) { const d = catDir(c); audio.land(d.x, d.z); } });
});

// ---------- 町歩き ----------
const walker = new Walker(controls);
walker.onStep = (surface) => audio.footstep(surface, zoneWeights(walker.x, walker.z).arcade);

function fadeTo(fn) {
  const f = $('fade');
  f.classList.add('on');
  setTimeout(() => {
    fn();
    setTimeout(() => f.classList.remove('on'), 120);
  }, 750);
}

function setShadowRange(range, dist) {
  const c = sun.shadow.camera;
  c.left = c.bottom = -range;
  c.right = c.top = range;
  c.far = dist * 2.5;
  c.updateProjectionMatrix();
  sun.userData.dist = dist;
  // 影の1マスの大きさに合わせて、影をずらす量を決める（町は範囲が広くマスが粗いので、
  // そのままだと地面に縞模様の影＝シャドウアクネが出る。スマホは計算の細かさも低く、出やすい）
  const texel = (range * 2) / sun.shadow.mapSize.x;
  sun.shadow.normalBias = Math.max(0.02, texel * 1.6);
  sun.shadow.bias = range > 10 ? -0.0008 : -0.0004;
}
sun.userData.dist = 12;

let lastPlace = '';
function enterTown(place) {
  mode = 'walk';
  document.body.classList.add('walking');
  walker.enter(place.x, place.z, place.yaw, place.pitch);
  controls.targetFov = 60;
  setShadowRange(28, 45);
  setNear(0.12);
  lastPlace = '';
}
// 手前の描画の境目：部屋では猫や湯のみに寄れるよう近く、町では奥行きの精度を保つため少し遠く
// （スマホは奥行きの細かさが足りず、地面に輪郭線の縞が出ることがあるため）
function setNear(n) {
  if (camera.near === n) return;
  camera.near = n;
  camera.updateProjectionMatrix();
}

function enterRoom() {
  mode = 'room';
  setNear(0.03);
  document.body.classList.remove('walking');
  walker.exit();
  controls.basePos.set(0, 1.08, 0.78);
  controls.yaw = controls.targetYaw = 0;
  controls.pitch = controls.targetPitch = -0.1;
  controls.targetFov = 55;
  sun.target.position.set(0, 0.6, 0.4);
  setShadowRange(4.5, 12);
}

function goHome() {
  fadeTo(() => {
    enterRoom();
    toast('ただいま', 2500);
  });
}

function travel(place) {
  $('map-view').classList.add('hidden');
  if (place.id === 'house' && mode === 'room') return;
  fadeTo(() => enterTown(place));
}

const koji = new Koji(KOJI.length);
const mapView = new MapView({ canvas: $('map-canvas'), list: $('map-list'), onTravel: travel, cats: () => zukan.friends(), onVisitCat: (e) => visitCat(e), koji });
function openMap() {
  const pos = mode === 'walk' ? { x: walker.x, z: walker.z, yaw: controls.yaw } : { x: 0, z: 0.5, yaw: 0 };
  const px = mapView.draw(pos);
  $('map-view').classList.remove('hidden');
  // 画面より地図が広いとき（スマホ）は、いまいる場所が真ん中に来るようにスクロール
  const sc = $('map-scroll');
  sc.scrollLeft = Math.max(0, px - sc.clientWidth / 2);
}
$('btn-map').addEventListener('click', openMap);
$('map-close').addEventListener('click', () => $('map-view').classList.add('hidden'));
$('map-view').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('map-view').classList.add('hidden'); });
$('btn-out').addEventListener('click', () => {
  fadeTo(() => enterTown(PLACES.find((p) => p.id === 'house')));
  setTimeout(() => toast('戸をあけて、坂の町へ', 3000), 900);
});

// 文脈に応じた行動ボタン
// 食べる・飲む・買う
const food = new Food({ audio, toast: (t, ms) => toast(t, ms), context: () => ({ seated: !!walker.seat, walking: mode === 'walk' }), onEat: (id) => diary.food(ITEMS[id].name) });

// 日記と、出会った猫図鑑
const diary = new Diary({ getDay: () => ({ day: time.day, label: dayLabel() }), toast: (t, ms) => toast(t, ms) });
const catEntries = [
  { id: 'home', name: 'ちゃとら', coat: 'chatora', where: '坂の上の空き家の窓辺', cat },
  ...STRAYS.map((c, i) => ({ ...c, cat: strays[i] })),
];
const entryOf = new Map(catEntries.map((e) => [e.cat, e]));
/** 猫のそばの道に立って、猫のほうを向く */
function visitCat(e) {
  if (e.id === 'home') { if (mode !== 'room') goHome(); return; }
  const p = e.cat.root.position;
  const h = e.cat.heading;
  const stand = clampToRoads(p.x + Math.sin(h) * 2.2, p.z + Math.cos(h) * 2.2);
  travel({ id: 'cat-' + e.id, name: e.name, x: stand.x, z: stand.z, yaw: Math.atan2(-(p.x - stand.x), -(p.z - stand.z)), pitch: -0.42 });
}
const zukan = new Zukan(catEntries, { onTravel: visitCat });
allCats.forEach((c) => {
  const e = entryOf.get(c);
  c.on('levelup', (lv) => {
    if (lv >= 4) diary.catFriend(e.name);
    if (c !== cat && lv >= 4) setTimeout(() => toast(`図鑑：${e.name}（${e.where}）がすっかり懐いた。地図から会いにいける`, 5000), 3200);
  });
});
const nearShop = () => (mode === 'walk' && !walker.seat && walker.upper == null ? town.interactables.find((s) => Math.hypot(s.x - walker.x, s.z - walker.z) < s.radius) : null);

// ---------- 千光寺山ロープウェイに乗る（片道およそ3分） ----------
const RIDE_SECONDS = 180;
let ride = null;
function nearRopewayStop() {
  if (mode !== 'walk' || ride || walker.seat) return null;
  if (Math.hypot(walker.x - ROPEWAY_STOPS.base.x, walker.z - ROPEWAY_STOPS.base.z) < 20) return 'up';
  if (Math.hypot(walker.x - ROPEWAY_STOPS.top.x, walker.z - ROPEWAY_STOPS.top.z) < 20) return 'down';
  return null;
}
function startRide(dir) {
  ride = { dir: dir === 'up' ? 1 : -1, t: dir === 'up' ? 0 : 1 };
  diary.ropeway();
  town.ride = ride;
  walker.enabled = false;
  walkBtn.hidden = true;
  // 尾道水道（南）のほうを向いて座る
  controls.targetYaw = Math.round(controls.yaw / (Math.PI * 2)) * Math.PI * 2;
  controls.targetPitch = -0.12;
  audio.chime();
  toast(dir === 'up' ? 'ロープウェイで山頂へ。およそ3分の空中散歩' : 'ロープウェイで山麓へ。およそ3分', 4000);
}
function updateRide(dt) {
  if (!ride) return;
  ride.t = clamp(ride.t + (ride.dir * dt) / RIDE_SECONDS, 0, 1);
  const p = town.cablePoint(ride.t);
  controls.basePos.set(p.x, p.y - 2.75, p.z);
  if ((ride.dir > 0 && ride.t >= 1) || (ride.dir < 0 && ride.t <= 0)) {
    const stop = ride.dir > 0 ? ROPEWAY_STOPS.top : ROPEWAY_STOPS.base;
    const up = ride.dir > 0;
    ride = null;
    town.ride = null;
    walker.enter(stop.x, stop.z, controls.yaw);
    toast(up ? '山頂駅に着いた。頂上の展望台はすぐそこ' : '山麓駅に着いた', 3500);
  }
}

let actions = []; // その場でできること（先頭が E / Enter で選ばれる）
let actionShop = null;
let rideDir = null;
function doAction(action = actions[0]) {
  if (!action) return;
  if (action === 'skipride' && ride) { ride.t = ride.dir > 0 ? 1 : 0; return; }
  if (action === 'ropeway' && rideDir) { startRide(rideDir); return; }
  if (action === 'deck' && actionShop) { walker.sit(actionShop.seat); diary.summit(); toast('展望台から、尾道水道を見わたす', 3000); return; }
  if (action === 'shop' && actionShop) { food.openShop(actionShop); return; }
  if (action === 'pray' && actionShop) {
    // 古寺めぐり：はじめてのお寺では御朱印をいただく。次のお寺の名も教えてもらう
    const t = actionShop, first = koji.visit(t.name);
    audio.chime && audio.chime();
    diary.temple(t.name);
    const next = KOJI.slice(t.idx + 1).concat(KOJI.slice(0, t.idx)).find((q) => !koji.has(q.name));
    if (first) toast(`${t.name}　御朱印をいただいた（${koji.count} / ${koji.total}）${next ? `　次は${next.name}へ` : ''}`, 4600);
    else toast(`${t.name}で、静かに手を合わせる`, 2600);
    if (first && koji.count === koji.total) setTimeout(() => toast('古寺めぐり、満願。尾道のお寺を、すべてめぐった', 5600), 4800);
    return;
  }
  if (action === 'home') goHome();
  else if (action === 'sit') { walker.sit(walker.nearBench()); diary.sat(); toast('ベンチに腰をおろす', 2500); }
  else if (action === 'stand') walker.stand();
  else if (action === 'crouch') { walker.setCrouch(true); toast('そっと、しゃがむ', 2000); }
  else if (action === 'rise') walker.setCrouch(false);
  else if (action === 'talk') { const p = people.talking?.p || nearPerson(); if (p) talkTo(p); }
}
// 近くの猫（しゃがむボタンを出す距離）
// 町の人と話す（話しかけるたびに続きを聞く。離れると話はおしまい）
const nearPerson = () => (mode === 'walk' && !walker.seat && !ride ? people.near(walker.x, walker.z) : null);
let talkTimer = null;
function talkTo(p) {
  const evs = todaysEvents.map((e) => e.id);
  const line = people.talk(p, time.hour, evs[0] || null);
  const box = $('talk');
  clearTimeout(talkTimer);
  talkTimer = null;
  if (!line) { box.classList.remove('show'); return; }
  $('talk-who').textContent = line.who;
  $('talk-text').textContent = line.text;
  box.classList.add('show');
  labelTimer = 0;
  if (line.last) { diary.talked(p.label); talkTimer = setTimeout(() => { talkTimer = null; box.classList.remove('show'); people.endTalk(); labelTimer = 0; }, 6000); }
}
const nearStray = () => (mode === 'walk' ? strays.find((c) => Math.hypot(c.root.position.x - walker.x, c.root.position.z - walker.z) < 2.6) : null);
// 行動ボタン：いまできることを並べる（中身が変わったときだけ作り直す）
let actsKey = '';
function renderActs(list) {
  const key = list.map((a) => a.id + a.label).join('|');
  if (key === actsKey) return;
  actsKey = key;
  const box = $('acts');
  box.replaceChildren(...list.map((a) => {
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = a.label;
    // キーボードの割り当て：しゃがむ・立ちあがるは C、いちばん目の行動は E
    const k = (a.id === 'crouch' || (a.id === 'rise' && walker.crouching)) ? 'C' : list[0] === a ? 'E' : '';
    if (k) b.dataset.key = k;
    b.addEventListener('click', () => { doAction(a.id); labelTimer = 0; });
    return b;
  }));
}
const walkBtn = $('btn-walk');
const holdWalk = (on) => { walker.touchForward = on; walkBtn.classList.toggle('held', on); };
walkBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); walkBtn.setPointerCapture?.(e.pointerId); holdWalk(true); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => walkBtn.addEventListener(ev, () => holdWalk(false)));
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return; // 日記を書いているあいだは操作しない
  if (e.repeat || eyesClosed) return;
  if ((e.code === 'KeyE' || e.code === 'Enter') && actions.length) doAction();
  if (e.code === 'KeyC' && mode === 'walk' && !walker.seat) walker.setCrouch(!walker.crouching);
  if (e.code === 'KeyB') ($('bag-view').classList.contains('hidden') ? food.openBag() : $('bag-view').classList.add('hidden'));
  if (e.code === 'KeyM') ($('map-view').classList.contains('hidden') ? openMap() : $('map-view').classList.add('hidden'));
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // ほかのボタンも、キーで押せる（ボタンの左上に小さく表示）。日記・図鑑などの画面を開いているときは、閉じるのが先
  const byKey = { Digit1: '[data-time="morning"]', Digit2: '[data-time="day"]', Digit3: '[data-time="evening"]', Digit4: '[data-time="night"]', Digit5: '#btn-flow',
    KeyO: '#btn-out', KeyP: '#btn-photo', KeyL: '#btn-album', KeyJ: '#btn-diary', KeyZ: '#btn-zukan', KeyX: '#btn-eyes', KeyV: '#btn-sound' };
  const sel = byKey[e.code];
  if (!sel || $('ui').classList.contains('hidden')) return;
  const btn = document.querySelector(sel);
  if (btn && !btn.hidden && btn.offsetParent !== null) btn.click();
});

// 船が正面を通ると、遅れて引き波の音が岸に届く
boats.onPass((b) => {
  const d = Math.hypot(b.x - camera.position.x, b.z - camera.position.z);
  if (d < 800) audio.wake(d, b.x, b.z);
});

// ---------- UI ----------
let toastTimer = null;
function toast(text, ms = 4000) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const PHASE_LABEL = { morning: '朝', day: '昼', evening: '夕暮れ', night: '夜' };
function dayLabel() {
  const d = new Date((time.day) * 86400000 + 12 * 3600000);
  return `${kanjiNumber(d.getMonth() + 1)}月${kanjiNumber(d.getDate())}日`;
}
function dateLabel() {
  const d = new Date((time.day) * 86400000 + 12 * 3600000);
  return `${kanjiNumber(d.getMonth() + 1)}月${kanjiNumber(d.getDate())}日　${PHASE_LABEL[time.phase]}`;
}

// 時間帯のボタン：押したらすぐ、そのボタンに印を移す（空が移り変わるのを待たない）
let timeChoice = null;
const markTime = () => {
  if (timeChoice && !time.transition) timeChoice = null;
  const shown = timeChoice || time.phase;
  document.querySelectorAll('[data-time]').forEach((b) => b.classList.toggle('active', b.dataset.time === shown));
};
document.querySelectorAll('[data-time]').forEach((btn) => {
  btn.addEventListener('click', () => {
    time.goTo(TIME_PRESETS[btn.dataset.time]);
    timeChoice = btn.dataset.time;
    markTime();
  });
});
$('btn-flow').addEventListener('click', (e) => {
  time.flow = !time.flow;
  e.currentTarget.setAttribute('aria-pressed', String(time.flow));
  toast(time.flow ? '時の流れに任せる' : '時を止める', 2000);
});
// 音：ボタンで音量の調整を開く（音量つまみと、消す／出す）
const volPop = $('vol-pop'), volRange = $('vol-range');
const showVolume = () => {
  const v = Math.round(audio.volume * 100);
  volRange.value = v;
  $('vol-value').textContent = audio.muted ? '消音' : v;
  $('vol-mute').textContent = audio.muted ? '出す' : '消す';
  $('btn-sound').setAttribute('aria-pressed', String(!audio.muted && v > 0));
};
showVolume();
$('btn-sound').addEventListener('click', (e) => {
  e.stopPropagation();
  volPop.hidden = !volPop.hidden;
  showVolume();
});
volRange.addEventListener('input', () => {
  controls.touch(); // 調整しているあいだは、UI を隠さない
  audio.setVolume(volRange.value / 100);
  if (audio.muted) audio.setMuted(false);
  showVolume();
});
$('vol-mute').addEventListener('click', () => { audio.setMuted(!audio.muted); showVolume(); });
// イベント：いつでも、そのイベントの尾道に切りかえる（「暦どおり」なら、その日のイベントだけ）
{
  const sel = $('event-select');
  const y = dateOf(time.day).y;
  const today = () => eventsOn(time.day).map((e) => e.name).join('・');
  const fill = () => {
    sel.replaceChildren(new Option(forcedEvent() ? '暦どおり' : `暦どおり${today() ? `（今日は${today()}）` : ''}`, ''), ...EVENTS.map((e) => new Option(`${e.name}（${whenLabel(e, y)}）`, e.id)));
    sel.value = forcedEvent() || '';
  };
  fill();
  sel.addEventListener('change', () => {
    controls.touch();
    setForcedEvent(sel.value);
    todaysEvents = prepareEvents();
    for (const k in eventShown) delete eventShown[k];
    eventShownDay = null;
    const ev = EVENTS.find((e) => e.id === sel.value);
    if (ev) {
      toast(`尾道は、${ev.name}の日になった`, 3600);
      // そのイベントがいちばんよく見える時間へ
      if (Math.abs(time.hour - ev.best) > 0.3 && (time.hour < ev.hours[0] || time.hour > ev.hours[1])) { time.goTo(ev.best); }
    } else toast('暦どおりの尾道にもどった', 2600);
    fill();
  });
}
// マウス感度（パソコンだけ）
if (controls.mouseLook) {
  const sens = $('sens-range');
  const showSens = () => { sens.value = controls.sensitivity; $('sens-value').textContent = controls.sensitivity; };
  showSens();
  sens.addEventListener('input', () => { controls.touch(); controls.setSensitivity(+sens.value); showSens(); });
} else {
  for (const id of ['sens-label', 'sens-range', 'sens-value']) $(id).hidden = true;
}
// 画質：高・中・低を順に切りかえる。描画の細かさと影はすぐ、灯りや人の数は次に開いたときに変わる
const showQuality = () => { $('vol-quality').textContent = `画質 ${quality.s.label}`; };
showQuality();
$('vol-quality').addEventListener('click', () => {
  quality.set(quality.next());
  renderer.setPixelRatio(basePixelRatio() * gov.scale);
  renderer.shadowMap.enabled = quality.s.shadows;
  sun.shadow.mapSize.set(quality.s.shadowSize, quality.s.shadowSize);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  view.setSize(window.innerWidth, window.innerHeight);
  showQuality();
  toast(`画質：${quality.s.label}（灯りの数や絵の効果は、次に開いたときに変わります）`, 3200);
});
// 絵作り：新しい絵（アニメ調）と元の絵を切りかえる。シェーダーから作りなおすので、ページを読みなおす
$('vol-look').textContent = look.label;
$('vol-look').addEventListener('click', () => {
  look.toggle();
  $('vol-look').textContent = look.label;
  toast(`「${look.label}」に切りかえます`, 1500);
  setTimeout(() => location.reload(), 900);
});
// UI のボタンやつまみを触っているあいだも「操作中」とみなして、UI を隠さない
['pointerdown', 'pointermove', 'keydown'].forEach((ev) => document.addEventListener(ev, () => controls.touch(), true));
document.addEventListener('pointerdown', (e) => {
  if (!volPop.hidden && !volPop.contains(e.target) && !e.target.closest('#btn-sound')) volPop.hidden = true;
});

// 目を閉じる
let eyesClosed = false;
function setEyes(closed) {
  eyesClosed = closed;
  walker.paused = closed;
  $('eyes').classList.toggle('on', closed);
  controls.enabled = !closed;
  $('ui').style.visibility = closed ? 'hidden' : '';
}
$('btn-eyes').addEventListener('click', () => { setEyes(true); diary.closedEyes(); });
$('eyes').addEventListener('click', () => setEyes(false));
window.addEventListener('keydown', (e) => { if ((e.key === 'Escape' || (e.code === 'KeyX' && !e.repeat)) && eyesClosed) setEyes(false); });

// 写真
let photoRequested = false;
const album = [];
$('btn-photo').addEventListener('click', () => { photoRequested = true; });
function showPhoto(url, caption) {
  $('photo-img').src = url;
  $('photo-caption').textContent = caption;
  $('photo-save').href = url;
  $('photo-save').download = `onomichi-${Date.now()}.jpg`;
  $('photo-view').classList.remove('hidden');
}
// claude.ai の共有ページではふつうのダウンロードリンクが使えないので、downloads 機能で保存する
let downloads = null;
window.claude?.use?.('downloads').then((d) => { downloads = d; }, () => {});
$('photo-save').addEventListener('click', async (e) => {
  if (!downloads) return; // ふつうのブラウザではリンクのまま保存
  e.preventDefault();
  const a = e.currentTarget;
  try {
    const blob = await (await fetch(a.href)).blob();
    await downloads.save({ filename: a.download, data: blob });
    toast('写真を保存しました', 2200);
  } catch (err) {
    if (err?.code !== 'declined') toast('ここでは保存できませんでした', 2600);
  }
});
$('photo-close').addEventListener('click', () => $('photo-view').classList.add('hidden'));
$('photo-view').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('photo-view').classList.add('hidden'); });
$('btn-album').addEventListener('click', () => {
  const grid = $('album-grid');
  grid.innerHTML = '';
  album.forEach((p) => {
    const img = document.createElement('img');
    img.src = p.url;
    img.alt = p.caption;
    img.addEventListener('click', () => { $('album-view').classList.add('hidden'); showPhoto(p.url, p.caption); });
    grid.appendChild(img);
  });
  $('album-empty').style.display = album.length ? 'none' : '';
  $('album-view').classList.remove('hidden');
});
$('album-close').addEventListener('click', () => $('album-view').classList.add('hidden'));

function takePhoto() {
  const url = developFilm(renderer.domElement, { warmth: time.phase === 'evening' ? 1.2 : 1 });
  const caption = `${dateLabel()}　${time.clockLabel()}`;
  album.unshift({ url, caption });
  diary.photo(url);
  if (album.length > 24) album.pop();
  $('album-count').textContent = album.length;
  const flash = $('flash');
  flash.classList.remove('on');
  void flash.offsetWidth;
  flash.classList.add('on');
  audio.shutter();
  setTimeout(() => showPhoto(url, caption), 650);
}

// UI は何もしていないと消える（景色と音だけになる）
let idleTimer = null;
function wakeUI() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (volPop.hidden) document.body.classList.add('idle'); else wakeUI(); }, COARSE ? 8000 : 4500);
}
window.addEventListener('pointermove', wakeUI);
window.addEventListener('pointerdown', wakeUI);

// タイトル
$('btn-start').addEventListener('click', async () => {
  await audio.start();
  $('title').classList.add('fade');
  setTimeout(() => {
    $('ui').classList.remove('hidden');
    wakeUI();
    toast('ドラッグで見渡す　・　窓辺の猫に、そっと', 6000);
  }, 1800);
});

time.onDayChange(() => { skyShown = false; });
let skyShown = false;

if (DEBUG) {
  $('debug').classList.remove('hidden');
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return; // 日記を書いているあいだは操作しない
    if (e.key === '1') cat.addAffection(2);
    if (e.key === '2') cat.reset();
    if (e.key === '3') time.hour = (time.hour + 1) % 24;
    if (e.key === '4') audio.wake(250, 0, -250);
    if (e.key === '5') audio.templeBell(true);
    if (e.key === '6') audio.fumikiri({ gain: 0.6, near: 0.5 });
    if (e.key === '7') town.train.timer = 0;
  });
  Object.assign(window, { THREE, scene, camera, time, cat, audio, boats, controls, renderer, town, walker, strays, travel, PLACES, food });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  view.setSize(window.innerWidth, window.innerHeight);
});

// ---------- ループ ----------
const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
let fpsAcc = 0, fpsFrames = 0, fps = 0;
let labelTimer = 0;

// 撮影モード（?capture）：決まった時間刻みで1コマずつ進める（デモムービーの書き出し用）
const CAPTURE = params.has('capture');
let simTime = 0;

// 透明度が0の物（昼の窓の灯り・街灯のにじみ・消えている踏切の灯など）は描かない。
// 町と遠景の、透明な素材を使う物を一度だけ集めておき、毎フレーム見える・見えないを切りかえる
let fadeList = null;
function hideFaded() {
  if (!fadeList) {
    fadeList = [];
    for (const root of [town.group, world.group]) root.traverse((o) => {
      if (o.userData.detail || !(o.isMesh || o.isSprite || o.isPoints || o.isLine)) return;
      const m = o.material;
      if (m && !Array.isArray(m) && m.transparent) fadeList.push(o);
    });
  }
  for (const o of fadeList) o.visible = o.material.opacity > 0.003;
}

// 自動の画質：FPS を見て、描く解像度を少しずつ上げ下げする（重いときは下げ、余裕があれば戻す）
const gov = { acc: 0, frames: 0, scale: 1, cool: 4 };
const basePixelRatio = () => Math.min(window.devicePixelRatio, quality.s.pixelRatio);
function govern(dt) {
  if (CAPTURE) return;
  gov.acc += dt; gov.frames++; gov.cool -= dt;
  if (gov.acc < 2) return;
  const fps = gov.frames / gov.acc;
  gov.acc = 0; gov.frames = 0;
  if (gov.cool > 0 || document.hidden) return;
  let s = gov.scale;
  if (fps < 40) s = Math.max(0.5, s - 0.12);
  else if (fps > 56) s = Math.min(1, s + 0.08);
  if (s === gov.scale) return;
  gov.scale = s;
  renderer.setPixelRatio(basePixelRatio() * s);
  view.setSize(window.innerWidth, window.innerHeight);
  gov.cool = 3;
}

function frame(fixedDt) {
  const dt = typeof fixedDt === 'number' ? fixedDt : Math.min(clock.getDelta(), 0.1);
  simTime += dt;
  const t = simTime;

  time.update(dt);
  const p = time.p;

  // ライト
  hemi.color.copy(p.hemiSky);
  hemi.groundColor.copy(p.hemiGround);
  hemi.intensity = p.hemi;
  sun.color.copy(time.sunUp ? p.sun : new THREE.Color(0x9fb4e0));
  sun.intensity = p.light;
  if (mode === 'walk') sun.target.position.set(controls.basePos.x, controls.basePos.y - 1.5, controls.basePos.z);
  sun.position.copy(sun.target.position).addScaledVector(time.lightDir, sun.userData.dist);
  scene.fog.color.copy(p.horizon).lerp(p.mid, 0.2);

  walker.update(dt);
  updateRide(dt);
  if (mode === 'walk' || ride) town.cullDetails(camera.position);
  hideFaded();
  govern(dt);
  controls.update(dt, t);
  sky.update(time, camera, t);
  world.update(time, t);
  boats.update(dt, t, p.night);
  sea.update(time, scene.fog, t, boats.wakes(camera.position));
  room.update(time, t, dt, audio.wind);
  cat.update(dt, t, camera);
  people.update(dt, time.hour, camera.position, mode === 'walk' ? walker : null);
  if (!people.talking && $('talk').classList.contains('show') && !talkTimer) $('talk').classList.remove('show');
  strays.forEach((c) => {
    const near = mode === 'walk' && c.root.position.distanceTo(camera.position) < 60;
    c.root.visible = near || mode === 'room';
    if (near) c.update(dt, t, camera);
    // そばまで来たら、図鑑に記す
    if (near && c.root.position.distanceTo(camera.position) < 7) {
      const e = entryOf.get(c);
      if (zukan.meet(e.id)) toast(`はじめて会う${COAT_LABEL(e.coat)}の猫。図鑑に「${e.name}」と記した`, 4200);
      diary.metCat(e.name);
    }
    // しゃがんで静かに待っていると、猫のほうから気にかけてくれる
    if (near && walker.crouching && c.root.position.distanceTo(camera.position) < 3) c.crouchedNear(dt, controls.idleSeconds, walker);
  });

  // 電車が近づくと踏切が鳴る。聞いている場所からいちばん近い踏切の音だけ鳴らす
  const ears = mode === 'walk' ? camera.position : new THREE.Vector3(0, 0, 0);
  const dist = (c) => Math.hypot(c.x - ears.x, c.z - ears.z);
  const nearestCrossing = CROSSINGS.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  for (const cr of town.update(time, t, dt)) {
    if (Math.hypot(cr.x - nearestCrossing.x, cr.z - nearestCrossing.z) > 1) continue;
    const d = dist(cr);
    audio.fumikiri({ gain: 0.08 + 0.8 * clamp(1 - d / 500, 0, 1), dirX: cr.x - ears.x, dirZ: cr.z - ears.z, near: clamp(1 - d / 120, 0, 1) });
  }

  // 祭り（屋台・花火・行列・鬼など）。開かれている時間になったら、はじめの一度だけ知らせる
  festivals.update(dt, t, time.hour, camera.position, p.night);
  for (const ev of todaysEvents) {
    if (ev.id === 'akari' || eventShown[ev.id] === time.day || eventGlow(ev, time.hour) < 0.5) continue;
    eventShown[ev.id] = time.day;
    toast(`今日は${ev.name}。${ev.note}`, 6000);
    diary.event(ev.diary);
  }

  // 季節のイベントの灯り（暮れてから）
  if (candles) {
    const ev = todaysEvents.find((e) => e.id === 'akari');
    const glow = ev ? eventGlow(ev, time.hour) * clamp(p.night * 1.4 + p.lamp * 0.6, 0, 1) : 0;
    candles.update(glow, t, window.innerHeight);
    if (ev && glow > 0.35 && eventShownDay !== time.day) {
      eventShownDay = time.day;
      toast(`今夜は${ev.name}。${ev.note}`, 6000);
      diary.event(ev.diary);
    }
  }

  // 夜道の手もとの灯り
  walkLight.position.set(camera.position.x, camera.position.y + 0.6, camera.position.z);
  const inArcade = mode === 'walk' && zoneWeights(walker.x, walker.z).arcade > 0;
  walkLight.intensity = mode === 'walk' ? p.night * (inArcade ? 6 : 2.5) + (inArcade ? (1 - p.night) * 0.6 : 0) : 0;

  // 何もしないで猫を眺めていると、少しずつ心を許してくれる
  if (mode === 'room' && !eyesClosed && controls.idleSeconds > 6) cat.patience(dt, cat.inView(camera));
  dust.visible = mode === 'room';

  // 埃は日が差しているときだけ見える
  dust.rotation.y = t * 0.01;
  dust.position.y = Math.sin(t * 0.2) * 0.05;
  dust.material.opacity = clamp(p.light / 2.5, 0, 1) * 0.35 + p.lamp * 0.1;

  // 視線が窓の外に向いている度合い
  controls.forward(fwd);
  const outside = mode === 'walk' ? 1 : smoothstep(0.15, 0.85, -fwd.z) * (1 - smoothstep(0.35, 0.85, -fwd.y));
  // ゴロゴロは、いちばん近い猫のものを聞く
  let purrCat = cat, purr = mode === 'room' ? cat.purr : 0;
  if (mode === 'walk') {
    for (const c of strays) {
      const d = catDir(c).length();
      const v = c.purr * clamp(1 - d / 4, 0, 1);
      if (v > purr) { purr = v; purrCat = c; }
    }
  }
  audio.update(dt, {
    outside, hour: time.hour, night: p.night, eyesClosed, yaw: controls.yaw,
    purr, catDir: catDir(purrCat), fishing: boats.nearestFishing(camera.position),
    walking: mode === 'walk', zone: mode === 'walk' ? zoneWeights(walker.x, walker.z) : null,
  });

  view.render(p.night);

  if (photoRequested) {
    photoRequested = false;
    takePhoto();
  }

  // ラベル
  labelTimer -= dt;
  if (labelTimer <= 0) {
    labelTimer = 0.5;
    $('date-label').textContent = dateLabel();
    // 町では、いまいる場所の名前と、その場でできること
    if (mode === 'walk') {
      const name = placeName(walker.x, walker.z);
      $('place-label').textContent = name;
      const head = name.split('　')[0];
      if (head !== lastPlace.split('　')[0]) { toast(head, 2600); diary.place(head.replace(/のあたり$/, '')); }
      lastPlace = name;
      actionShop = nearShop();
      rideDir = nearRopewayStop();
      actions = [];
      if (walker.seat) actions.push('stand');
      else if (walker.crouching) actions.push('rise');
      else if (!ride) {
        if (rideDir) actions.push('ropeway');
        if (actionShop) actions.push(actionShop.type === 'deck' ? 'deck' : actionShop.type === 'temple' ? 'pray' : 'shop');
        if (walker.nearDoor()) actions.push('home');
        if (walker.nearBench()) actions.push('sit');
        if (nearStray()) actions.push('crouch');
        if (people.talking || nearPerson()) actions.unshift('talk');
      }
      // 話している相手から離れたら、ふきだしを閉じる
      if (!people.talking && $('talk').classList.contains('show') && !talkTimer) $('talk').classList.remove('show');
    } else {
      $('place-label').textContent = '';
      actions = [];
    }
    if (ride) actions = ['skipride'];
    const label = (a) => a === 'skipride' ? (ride.dir > 0 ? 'すぐに山頂駅へ' : 'すぐに山麓駅へ')
      : a === 'ropeway' ? (rideDir === 'up' ? 'ロープウェイに乗る（山頂へ）' : 'ロープウェイに乗る（山麓へ）')
      : a === 'deck' ? '展望台にのぼる'
      : a === 'pray' ? (koji.has(actionShop.name) ? `${actionShop.name}で手を合わせる` : `${actionShop.name}にお参りする`)
      : a === 'stand' && walker.seat && walker.seat.kind === 'deck' ? '展望台をおりる'
      : a === 'shop'
      ? { bakery: `${actionShop.name}に入る`, ramen: `${actionShop.name}で食べる`, vending: '自販機で買う', kamaboko: `${actionShop.name}に寄る`, sweets: `${actionShop.name}に寄る`, juice: 'みかんジュースを選ぶ', cafe: `${actionShop.name}でひとやすみ` }[actionShop.type]
      : a === 'talk' ? (people.talking ? (people.talking.i < people.talking.lines.length - 1 ? 'つづきを聞く' : 'またね') : `${nearPerson().label}に話しかける`)
      : { home: '家に入る', sit: 'ベンチに座る', stand: '立ちあがる', crouch: 'しゃがむ', rise: '立ちあがる' }[a] || '';
    renderActs(actions.slice(0, 3).map((a) => ({ id: a, label: label(a) })));
    walkBtn.hidden = mode !== 'walk' || !!walker.seat || walker.crouching || !!ride;
    markTime();
    const sl = $('sky-label');
    if (!skyShown && time.hour > 17.6 && time.hour < 19) {
      skyShown = true;
      sl.textContent = `今日の空　${time.mood.name}`;
      diary.sky(time.mood.name);
      sl.classList.add('show');
      setTimeout(() => sl.classList.remove('show'), 14000);
    }
  }

  if (DEBUG) {
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc > 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
    $('debug').textContent = [
      `fps      ${fps.toFixed(0)}`,
      `hour     ${time.clockLabel()} (${time.phase})`,
      `day      ${time.day}  sky: ${time.mood.name}`,
      `cat      Lv.${cat.level}  affection ${cat.affection.toFixed(2)}`,
      `outside  ${outside.toFixed(2)}  wind ${audio.wind.toFixed(2)}`,
      `idle     ${controls.idleSeconds.toFixed(1)}s`,
      `pos      ${mode} ${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}`,
      `calls    ${renderer.info.render.calls}`,
      `[1]+affection [2]reset cat [3]+1h [4]wake [5]bell [6]踏切 [7]電車`,
    ].join('\n');
  }

  if (!CAPTURE) requestAnimationFrame(loop);
}
// requestAnimationFrame は経過ミリ秒を引数に渡してくるので、frame の刻み幅として受け取らないよう包む
function loop() { frame(); }
if (CAPTURE) {
  $('title').style.display = 'none';
  Object.assign(window, { THREE, scene, camera, time, cat, audio, boats, controls, renderer, town, walker, strays, people, PLACES, food, diary, enterTown, enterRoom, goHome, getCandles: () => candles, startRide, ROADS, pointAlong, getRide: () => ride, view, festivals });
  window.captureStep = (dt) => frame(dt);
  window.captureReady = true;
} else {
  requestAnimationFrame(loop);
}
