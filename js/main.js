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
import { kanjiNumber, smoothstep, clamp } from './util.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const $ = (id) => document.getElementById(id);

// ---------- レンダラ・シーン ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
sun.shadow.mapSize.set(2048, 2048);
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
const cat = new Cat(scene);
const audio = new AudioEngine();

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
  pickables: () => [cat.hitbox],
  onPoke: () => cat.poke(),
  onStroke: (dt) => cat.stroke(dt),
  onRelease: () => cat.release(),
  onHover: (h) => document.body.classList.toggle('hover-cat', h),
});

// ---------- 猫と音をつなぐ ----------
const catDir = () => new THREE.Vector3().subVectors(cat.root.position, camera.position);
cat.on('levelup', (lv, text) => text && toast(text, 6000));
cat.on('notice', (text) => toast(text, 3500));
cat.on('meow', (lv) => { const d = catDir(); audio.meow(lv, d.x, d.z); });
cat.on('slap', () => { const d = catDir(); audio.tailSlap(d.x, d.z); });
cat.on('land', () => { const d = catDir(); audio.land(d.x, d.z); });
cat.on('flinch', () => toast('（びくっ）……そっとしておこう', 3000));

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
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 4500);
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
    if (e.key === 'l') cat.addAffection(2);
    if (e.key === 'r') cat.reset();
    if (e.key === 't') time.hour = (time.hour + 1) % 24;
    if (e.key === 'w') audio.wake(250, 0, -250);
    if (e.key === 'b') audio.templeBell(true);
    if (e.key === 'f') audio.fumikiri();
  });
  Object.assign(window, { THREE, scene, camera, time, cat, audio, boats, controls, renderer });
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
  sun.position.copy(sun.target.position).addScaledVector(time.lightDir, 12);
  scene.fog.color.copy(p.horizon).lerp(p.mid, 0.2);

  controls.update(dt, t);
  sky.update(time, camera, t);
  world.update(time, t);
  boats.update(dt, t, p.night);
  sea.update(time, scene.fog, t, boats.wakes(camera.position));
  room.update(time, t, dt, audio.wind);
  cat.update(dt, t, camera);

  // 何もしないで猫を眺めていると、少しずつ心を許してくれる
  if (!eyesClosed && controls.idleSeconds > 6) cat.patience(dt, cat.inView(camera));

  // 埃は日が差しているときだけ見える
  dust.rotation.y = t * 0.01;
  dust.position.y = Math.sin(t * 0.2) * 0.05;
  dust.material.opacity = clamp(p.light / 2.5, 0, 1) * 0.35 + p.lamp * 0.1;

  // 視線が窓の外に向いている度合い
  controls.forward(fwd);
  const outside = smoothstep(0.15, 0.85, -fwd.z) * (1 - smoothstep(0.35, 0.85, -fwd.y));
  const cd = catDir();
  audio.update(dt, {
    outside, hour: time.hour, night: p.night, eyesClosed, yaw: controls.yaw,
    purr: cat.purr, catDir: cd, fishing: boats.nearestFishing(camera.position),
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
      `calls    ${renderer.info.render.calls}`,
      `[l]+affection [r]reset cat [t]+1h [w]wake [b]bell [f]踏切`,
    ].join('\n');
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
