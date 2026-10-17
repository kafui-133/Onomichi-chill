// 時間の移り変わり：時刻キーフレーム間を補間してパレットを作る。
// 夕暮れ（17〜20時）のキーフレームは「日替わり」でゆらぎ、二度と同じ空にはならない。
import * as THREE from 'three';
import { clamp, easeInOut, seededRandom, pick } from './util.js';

const COLOR_KEYS = ['zenith', 'mid', 'horizon', 'sun', 'cloudBase', 'cloudLit', 'sea', 'hemiSky', 'hemiGround'];
const NUM_KEYS = ['hemi', 'light', 'lamp', 'night', 'glow', 'cloud'];

// prettier-ignore
const BASE_KEYFRAMES = [
  { h: 0,    zenith: '#04060f', mid: '#0a1129', horizon: '#18213f', sun: '#9fb4e0', cloudBase: '#0f1528', cloudLit: '#28324f', sea: '#03081a', hemiSky: '#22345a', hemiGround: '#0b0b12', hemi: 0.45, light: 0.35, lamp: 1, night: 1, glow: 0, cloud: 0 },
  { h: 4.8,  zenith: '#0b1331', mid: '#252a57', horizon: '#5e4568', sun: '#9fb4e0', cloudBase: '#1b1d3d', cloudLit: '#4a3d63', sea: '#070c22', hemiSky: '#2a3561', hemiGround: '#100e18', hemi: 0.45, light: 0.2, lamp: 0.8, night: 0.75, glow: 0.2, cloud: 0 },
  { h: 6.0,  zenith: '#2a3d77', mid: '#8778a6', horizon: '#f0a682', sun: '#ffae78', cloudBase: '#76698e', cloudLit: '#ffc29c', sea: '#28385a', hemiSky: '#8a86ad', hemiGround: '#2c2430', hemi: 0.6, light: 0.0, lamp: 0.35, night: 0.2, glow: 1.0, cloud: 0 },
  { h: 7.5,  zenith: '#5d8dcf', mid: '#a8c5e5', horizon: '#f4dcc1', sun: '#ffe1b6', cloudBase: '#b3bfd3', cloudLit: '#fff3e4', sea: '#2d5d84', hemiSky: '#c4d6ec', hemiGround: '#5a5148', hemi: 0.95, light: 1.9, lamp: 0, night: 0, glow: 0.55, cloud: 0 },
  { h: 12,   zenith: '#3b7bd5', mid: '#8ebce8', horizon: '#d5e7f2', sun: '#fff6ea', cloudBase: '#c3cfdd', cloudLit: '#ffffff', sea: '#1d5b89', hemiSky: '#cfe2f5', hemiGround: '#6a604f', hemi: 1.1, light: 2.6, lamp: 0, night: 0, glow: 0.3, cloud: 0 },
  { h: 16,   zenith: '#4a7ec7', mid: '#a1c0df', horizon: '#eee0c6', sun: '#ffdfa6', cloudBase: '#c7c5cc', cloudLit: '#fff0d5', sea: '#265a7f', hemiSky: '#d2d8e2', hemiGround: '#6a5a46', hemi: 1.0, light: 2.2, lamp: 0, night: 0, glow: 0.5, cloud: 0 },
  { h: 17.4, zenith: '#4769ab', mid: '#c8a68c', horizon: '#ffc077', sun: '#ffb25a', cloudBase: '#a597a4', cloudLit: '#ffd397', sea: '#385777', hemiSky: '#d9b8a0', hemiGround: '#5a4434', hemi: 0.9, light: 1.9, lamp: 0.15, night: 0, glow: 1.0, cloud: 0 },
  { h: 18.2, zenith: '#2c3979', mid: '#bf6889', horizon: '#ff873b', sun: '#ff772c', cloudBase: '#6a4977', cloudLit: '#ff9858', sea: '#393a61', hemiSky: '#b77d8a', hemiGround: '#3c2a30', hemi: 0.75, light: 1.25, lamp: 0.55, night: 0.05, glow: 1.5, cloud: 0 },
  { h: 18.8, zenith: '#19205f', mid: '#683d89', horizon: '#df5e79', sun: '#ff5a48', cloudBase: '#38295a', cloudLit: '#ff7888', sea: '#212549', hemiSky: '#6b4f84', hemiGround: '#221a28', hemi: 0.6, light: 0.35, lamp: 0.9, night: 0.3, glow: 1.0, cloud: 0 },
  { h: 19.5, zenith: '#0b133f', mid: '#29296a', horizon: '#784979', sun: '#a96aa0', cloudBase: '#1d1f47', cloudLit: '#664877', sea: '#0d132f', hemiSky: '#353c70', hemiGround: '#120f1a', hemi: 0.5, light: 0.0, lamp: 1, night: 0.75, glow: 0.3, cloud: 0 },
  { h: 21,   zenith: '#05081a', mid: '#0c1430', horizon: '#1d2748', sun: '#9fb4e0', cloudBase: '#111830', cloudLit: '#2b3655', sea: '#040a1c', hemiSky: '#22345a', hemiGround: '#0b0b12', hemi: 0.45, light: 0.35, lamp: 1, night: 1, glow: 0, cloud: 0 },
];

// 日替わりの夕暮れの「性格」
const DUSK_MOODS = [
  { name: '茜空',     hue: -0.025, sat: 0.12,  light: 0.0,   purple: 0.0,  clouds: 0.45 },
  { name: '金色の凪', hue: 0.03,   sat: 0.05,  light: 0.04,  purple: -0.6, clouds: 0.2 },
  { name: '藤色の宵', hue: -0.05,  sat: 0.0,   light: 0.0,   purple: 0.8,  clouds: 0.35 },
  { name: '桃色の雲', hue: -0.04,  sat: 0.08,  light: 0.03,  purple: 0.35, clouds: 0.65 },
  { name: '薄雲の夕凪', hue: 0.0,  sat: -0.18, light: -0.02, purple: 0.2,  clouds: 0.75 },
  { name: '燃える夕焼け', hue: -0.015, sat: 0.2, light: 0.02, purple: -0.2, clouds: 0.55 },
];

export const TIME_PRESETS = { morning: 7.2, day: 12.5, evening: 18.15, night: 21.5 };

function buildKeyframes(day) {
  const r = seededRandom('onomichi-sky-' + day);
  const mood = pick(DUSK_MOODS, r);
  const jitter = (r() - 0.5) * 0.03;
  const baseCloud = 0.12 + r() * 0.35;
  const purple = new THREE.Color('#7a3a9a');

  const frames = BASE_KEYFRAMES.map((src) => {
    const f = { h: src.h };
    for (const k of COLOR_KEYS) f[k] = new THREE.Color(src[k]);
    for (const k of NUM_KEYS) f[k] = src[k];
    const isDusk = src.h >= 17 && src.h <= 19.6;
    f.cloud = isDusk ? mood.clouds : baseCloud * (src.night > 0.5 ? 0.5 : 1);
    if (isDusk) {
      const strength = src.h >= 17.9 && src.h <= 19 ? 1 : 0.5;
      for (const k of ['mid', 'horizon', 'cloudLit', 'sun', 'cloudBase']) {
        f[k].offsetHSL((mood.hue + jitter) * strength, mood.sat * strength, mood.light * strength);
      }
      if (mood.purple !== 0) {
        const amt = Math.abs(mood.purple) * 0.35 * strength;
        if (mood.purple > 0) {
          f.mid.lerp(purple, amt);
          f.cloudBase.lerp(purple, amt * 0.6);
        } else {
          f.mid.lerp(f.horizon, amt);
        }
      }
    }
    return f;
  });
  // 0時と24時をつなぐ
  const last = { ...frames[0], h: 24 };
  frames.push(last);
  return { frames, mood };
}

export class TimeSystem {
  constructor(state) {
    this.day = state.day ?? 0;
    this.hour = state.hour ?? 17.2;
    this.flow = true;            // 自動で時が流れるか
    this.speed = 1 / 60;         // 1分でゲーム内1時間
    this.transition = null;      // ボタンでの時刻移動
    this.listeners = [];
    this._rebuild();

    // 補間結果（毎フレーム使い回す）
    this.p = {};
    for (const k of COLOR_KEYS) this.p[k] = new THREE.Color();
    for (const k of NUM_KEYS) this.p[k] = 0;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3(-0.45, 0.32, -1).normalize();
    this.lightDir = new THREE.Vector3();
    this.sample();
  }

  _rebuild() {
    const { frames, mood } = buildKeyframes(this.day);
    this.frames = frames;
    this.mood = mood;
    // 秋の尾道によく出る、うろこ雲（いわし雲）の日
    const r = seededRandom('onomichi-uroko-' + this.day);
    this.uroko = r() < 0.45 ? 0.55 + r() * 0.45 : 0;
  }

  onDayChange(fn) { this.listeners.push(fn); }

  /** ボタンから：常に「先へ」進みながら目的の時刻へゆっくり移る */
  goTo(targetHour) {
    let delta = targetHour - this.hour;
    if (delta <= 0.05) delta += 24;
    const duration = 3.5 + Math.min(delta, 12) * 0.45;
    this.transition = { from: this.hour, delta, t: 0, duration };
  }

  get phase() {
    const h = this.hour;
    if (h >= 5 && h < 10) return 'morning';
    if (h >= 10 && h < 16.5) return 'day';
    if (h >= 16.5 && h < 19.5) return 'evening';
    return 'night';
  }

  update(dt) {
    let next = this.hour;
    if (this.transition) {
      const tr = this.transition;
      tr.t += dt / tr.duration;
      next = tr.from + tr.delta * easeInOut(clamp(tr.t, 0, 1));
      if (tr.t >= 1) this.transition = null;
    } else if (this.flow) {
      // 夕暮れどきは時間がゆっくり流れる
      const slow = this.hour > 17 && this.hour < 19.6 ? 0.45 : 1;
      next = this.hour + dt * this.speed * slow;
    }
    if (next >= 24) {
      next -= 24;
      if (this.transition) this.transition.from -= 24;
      this.day += 1;
      this._rebuild();
      this.listeners.forEach((fn) => fn(this.day));
    }
    this.hour = next;
    this.sample();
  }

  sample() {
    const h = this.hour;
    const fr = this.frames;
    let i = 0;
    while (i < fr.length - 2 && fr[i + 1].h <= h) i++;
    const a = fr[i], b = fr[i + 1];
    const t = clamp((h - a.h) / (b.h - a.h), 0, 1);
    const s = t * t * (3 - 2 * t);
    for (const k of COLOR_KEYS) this.p[k].copy(a[k]).lerp(b[k], s);
    for (const k of NUM_KEYS) this.p[k] = a[k] + (b[k] - a[k]) * s;

    // 太陽：東（左）から昇り、南の海の上を通って西（右）の島影に沈む
    const ang = ((h - 6) / 12.4) * Math.PI;
    const elev = Math.sin(ang) * 0.95 - 0.02;
    const hx = -Math.cos(ang) * 0.68;
    const hz = -(0.74 + Math.max(0, Math.sin(ang)) * 0.26);
    const ce = Math.cos(elev);
    this.sunDir.set(hx * ce, Math.sin(elev), hz * ce).normalize();

    // 6〜19時は太陽、それ以外は月が主光源（切替時は強度≒0）
    const sunUp = h >= 6.0 && h < 19.0;
    this.lightDir.copy(sunUp ? this.sunDir : this.moonDir);
    this.lightDir.y = Math.max(this.lightDir.y, 0.04);
    this.lightDir.normalize();
    this.sunUp = sunUp;
  }

  clockLabel() {
    const hh = Math.floor(this.hour);
    const mm = Math.floor((this.hour - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
