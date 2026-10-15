// 『坂道の空き家、尾道にて』技術検証プロトタイプ：エントリポイント
import * as THREE from 'three';
import { TimeSystem, TIME_PRESETS } from './timeOfDay.js';
import { Sky, Sea } from './sky.js';
import { World, SEA_LEVEL } from './world.js';
import { Room } from './room.js';
import { Boats } from './boats.js';
import { Cat } from './cat.js';
import { AudioEngine } from './audio.js';
import { LookControls } from './controls.js';
import { developFilm } from './photo.js';
import { Town } from './town.js';
import { Walker } from './walker.js';
import { MapView } from './mapView.js';
import { PLACES, CROSSINGS, ROADS, BENCHES, ROPEWAY, groundY, placeName, zoneWeights, pointAlong, clampToRoads } from './townMap.js';
import { kanjiNumber, smoothstep, clamp } from './util.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const $ = (id) => document.getElementById(id);

// ---------- レンダラ・シーン ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// スマホ・タブレット（指で操作する端末）では描画を少し軽くする
const COARSE = window.matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, COARSE ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // 空のグラデーションを狙いどおりの色で出す
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x88aacc, 420, 3200);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.03, 7000);
camera.position.set(0, 1.08, 0.78); // 座布団に座った目の高さ

// ---------- 時間 ----------
const todayIndex = Math.floor(Date.now() / 86400000);
const startHour = params.has('hour') ? parseFloat(params.get('hour')) : 16.9;
const time = new TimeSystem({ day: todayIndex, hour: startHour });

// ---------- ライト ----------
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
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
const STRAYS = [
  { ...onRoad('猫の細道', 0.62, 1), pose: 'loaf', level: 3 },                         // 猫の細道
  { ...onRoad('猫の細道', 0.25, -1), pose: 'curl', level: 4 },                        // 猫の細道の下のほう
  { x: nearRopeway.x, z: nearRopeway.z, heading: 0.4, pose: 'sit', level: 2 },       // ロープウェイ山麓駅のそば
  { ...onRoad('本町センター街', 0.4, 1), pose: 'loaf', level: 3 },                   // 商店街の店先
  bench && { x: bench.x + Math.cos(bench.yaw) * 1.4, z: bench.z - Math.sin(bench.yaw) * 1.4, heading: bench.yaw + Math.PI, pose: 'sit', level: 2 }, // 海沿いのベンチ
  { ...onRoad('空き家への石段', 0.8), pose: 'sit', level: 2 },                        // 家の前の石段
].filter((c) => c && c.x !== undefined);
const strays = STRAYS.map((c) => new Cat(scene, { fixed: { pos: new THREE.Vector3(c.x, groundY(c.x, c.z), c.z), pose: c.pose, heading: c.heading, level: c.level } }));
const allCats = [cat, ...strays];
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
  onPoke: (h) => catByHitbox.get(h)?.poke(),
  onStroke: (dt, h) => catByHitbox.get(h)?.stroke(dt),
  onRelease: (h) => catByHitbox.get(h)?.release(),
  onHover: (h) => document.body.classList.toggle('hover-cat', h),
});

// ---------- 猫と音をつなぐ ----------
const catDir = (c = cat) => new THREE.Vector3().subVectors(c.root.position, camera.position);
const audible = (c) => (mode === 'room' ? c === cat : c !== cat && catDir(c).length() < 14);
cat.on('levelup', (lv, text) => text && toast(text, 6000));
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
}
sun.userData.dist = 12;

let lastPlace = '';
function enterTown(place) {
  mode = 'walk';
  document.body.classList.add('walking');
  walker.enter(place.x, place.z, place.yaw);
  controls.targetFov = 60;
  setShadowRange(28, 45);
  lastPlace = '';
}

function goHome() {
  fadeTo(() => {
    mode = 'room';
    document.body.classList.remove('walking');
    walker.exit();
    controls.basePos.set(0, 1.08, 0.78);
    controls.yaw = controls.targetYaw = 0;
    controls.pitch = controls.targetPitch = -0.1;
    controls.targetFov = 55;
    sun.target.position.set(0, 0.6, 0.4);
    setShadowRange(4.5, 12);
    toast('ただいま', 2500);
  });
}

function travel(place) {
  $('map-view').classList.add('hidden');
  if (place.id === 'house' && mode === 'room') return;
  fadeTo(() => enterTown(place));
}

const mapView = new MapView({ canvas: $('map-canvas'), list: $('map-list'), onTravel: travel });
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
let action = null;
function doAction() {
  if (action === 'home') goHome();
  else if (action === 'sit') { walker.sit(walker.nearBench()); toast('ベンチに腰をおろす', 2500); }
  else if (action === 'stand') walker.stand();
  else if (action === 'crouch') { walker.setCrouch(true); toast('そっと、しゃがむ', 2000); }
  else if (action === 'rise') walker.setCrouch(false);
}
// 近くの猫（しゃがむボタンを出す距離）
const nearStray = () => (mode === 'walk' ? strays.find((c) => Math.hypot(c.root.position.x - walker.x, c.root.position.z - walker.z) < 2.6) : null);
$('btn-act').addEventListener('click', doAction);
const walkBtn = $('btn-walk');
const holdWalk = (on) => { walker.touchForward = on; walkBtn.classList.toggle('held', on); };
walkBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); walkBtn.setPointerCapture?.(e.pointerId); holdWalk(true); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => walkBtn.addEventListener(ev, () => holdWalk(false)));
window.addEventListener('keydown', (e) => {
  if (e.repeat || eyesClosed) return;
  if ((e.code === 'KeyE' || e.code === 'Enter') && action) doAction();
  if (e.code === 'KeyC' && mode === 'walk' && !walker.seat) walker.setCrouch(!walker.crouching);
  if (e.code === 'KeyM') ($('map-view').classList.contains('hidden') ? openMap() : $('map-view').classList.add('hidden'));
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
function dateLabel() {
  const d = new Date((time.day) * 86400000 + 12 * 3600000);
  return `${kanjiNumber(d.getMonth() + 1)}月${kanjiNumber(d.getDate())}日　${PHASE_LABEL[time.phase]}`;
}

document.querySelectorAll('[data-time]').forEach((btn) => {
  btn.addEventListener('click', () => {
    time.goTo(TIME_PRESETS[btn.dataset.time]);
  });
});
$('btn-flow').addEventListener('click', (e) => {
  time.flow = !time.flow;
  e.currentTarget.setAttribute('aria-pressed', String(time.flow));
  toast(time.flow ? '時の流れに任せる' : '時を止める', 2000);
});
$('btn-sound').addEventListener('click', (e) => {
  audio.setMuted(!audio.muted);
  e.currentTarget.setAttribute('aria-pressed', String(!audio.muted));
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
$('btn-eyes').addEventListener('click', () => setEyes(true));
$('eyes').addEventListener('click', () => setEyes(false));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && eyesClosed) setEyes(false); });

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
  idleTimer = setTimeout(() => document.body.classList.add('idle'), COARSE ? 8000 : 4500);
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
    if (e.key === '1') cat.addAffection(2);
    if (e.key === '2') cat.reset();
    if (e.key === '3') time.hour = (time.hour + 1) % 24;
    if (e.key === '4') audio.wake(250, 0, -250);
    if (e.key === '5') audio.templeBell(true);
    if (e.key === '6') audio.fumikiri({ gain: 0.6, near: 0.5 });
    if (e.key === '7') town.train.timer = 0;
  });
  Object.assign(window, { THREE, scene, camera, time, cat, audio, boats, controls, renderer, town, walker, strays, travel, PLACES });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- ループ ----------
const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
let fpsAcc = 0, fpsFrames = 0, fps = 0;
let labelTimer = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  time.update(dt);
  const p = time.p;

  // ライト
  hemi.color.copy(p.hemiSky);
  hemi.groundColor.copy(p.hemiGround);
  hemi.intensity = p.hemi;
  sun.color.copy(time.sunUp ? p.sun : new THREE.Color(0x9fb4e0));
  sun.intensity = p.light;
  if (mode === 'walk') sun.target.position.set(walker.x, controls.basePos.y - 1.5, walker.z);
  sun.position.copy(sun.target.position).addScaledVector(time.lightDir, sun.userData.dist);
  scene.fog.color.copy(p.horizon).lerp(p.mid, 0.2);

  walker.update(dt);
  controls.update(dt, t);
  sky.update(time, camera, t);
  world.update(time, t);
  boats.update(dt, t, p.night);
  sea.update(time, scene.fog, t, boats.wakes(camera.position));
  room.update(time, t, dt, audio.wind);
  cat.update(dt, t, camera);
  strays.forEach((c) => {
    const near = mode === 'walk' && c.root.position.distanceTo(camera.position) < 60;
    c.root.visible = near || mode === 'room';
    if (near) c.update(dt, t, camera);
    // しゃがんで静かに待っていると、猫のほうから気にかけてくれる
    if (near && walker.crouching && c.root.position.distanceTo(camera.position) < 3) c.crouchedNear(dt, controls.idleSeconds);
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

  renderer.render(scene, camera);

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
      if (head !== lastPlace.split('　')[0]) toast(head, 2600);
      lastPlace = name;
      action = walker.seat ? 'stand' : walker.crouching ? 'rise' : walker.nearDoor() ? 'home' : walker.nearBench() ? 'sit' : nearStray() ? 'crouch' : null;
    } else {
      $('place-label').textContent = '';
      action = null;
    }
    const act = $('btn-act');
    act.hidden = !action;
    act.textContent = { home: '家に入る', sit: 'ベンチに座る', stand: '立ちあがる', crouch: 'しゃがむ', rise: '立ちあがる' }[action] || '';
    walkBtn.hidden = mode !== 'walk' || !!walker.seat || walker.crouching;
    document.querySelectorAll('[data-time]').forEach((b) => b.classList.toggle('active', b.dataset.time === time.phase));
    const sl = $('sky-label');
    if (!skyShown && time.hour > 17.6 && time.hour < 19) {
      skyShown = true;
      sl.textContent = `今日の空　${time.mood.name}`;
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

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
