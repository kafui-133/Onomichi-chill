// 小さな共通ユーティリティ
import * as THREE from 'three';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** フレームレート非依存の指数減衰補間 */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** 文字列からのシード付き乱数 (mulberry32) */
export function seededRandom(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (min, max) => min + Math.random() * (max - min);
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];

/** Canvas で手続き的テクスチャを作る */
export function canvasTexture(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 粒状ノイズを重ねる */
export function speckle(g, w, h, amount, alpha, r = Math.random) {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(r() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/** 放射状のやわらかい光の点（スプライト用） */
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  glowTex = canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  glowTex.wrapS = glowTex.wrapT = THREE.ClampToEdgeWrapping;
  return glowTex;
}

const KANJI_NUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export function kanjiNumber(n) {
  if (n <= 10) return KANJI_NUM[n];
  if (n < 20) return '十' + KANJI_NUM[n - 10];
  const t = Math.floor(n / 10), o = n % 10;
  return KANJI_NUM[t] + '十' + (o ? KANJI_NUM[o] : '');
}
