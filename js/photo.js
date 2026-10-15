// 写真：レンダリング結果をフィルム風に現像する（色かぶり・粒子・周辺減光・光漏れ・日付写し込み）
import { clamp } from './util.js';

export function developFilm(sourceCanvas, { date = new Date(), warmth = 1 } = {}) {
  const maxW = 1400;
  const scale = Math.min(1, maxW / sourceCanvas.width);
  const w = Math.round(sourceCanvas.width * scale);
  const h = Math.round(sourceCanvas.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.drawImage(sourceCanvas, 0, 0, w, h);

  // トーン：黒を持ち上げ、ハイライトを少し丸め、暖色に寄せる（256段のLUTで高速化）
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    lut[i] = 0.06 + 0.9 * (v * v * (3 - 2 * v) * 0.6 + v * 0.4);
  }
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], gg = lut[d[i + 1]], b = lut[d[i + 2]];
    const lum = 0.3 * r + 0.59 * gg + 0.11 * b;
    // 色かぶり（シャドウは青緑、ハイライトは琥珀）と、少しだけ彩度を落とす
    r = (r + (lum * 0.06 - 0.01) * warmth) * 0.88 + lum * 0.12;
    gg = (gg + 0.01 * (1 - lum)) * 0.88 + lum * 0.12;
    b = (b + (0.03 * (1 - lum) - lum * 0.06) * warmth) * 0.88 + lum * 0.12;
    const grain = (Math.random() - 0.5) * 0.07;
    d[i] = clamp((r + grain) * 255, 0, 255);
    d[i + 1] = clamp((gg + grain) * 255, 0, 255);
    d[i + 2] = clamp((b + grain) * 255, 0, 255);
  }
  g.putImageData(img, 0, 0);

  // 周辺減光
  const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(20,10,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  // 光漏れ
  const leakX = Math.random() < 0.5 ? 0 : w;
  const leak = g.createRadialGradient(leakX, h * Math.random(), 0, leakX, h * 0.5, w * 0.45);
  leak.addColorStop(0, 'rgba(255,120,40,0.32)');
  leak.addColorStop(0.5, 'rgba(255,80,40,0.08)');
  leak.addColorStop(1, 'rgba(255,80,40,0)');
  g.globalCompositeOperation = 'screen';
  g.fillStyle = leak;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';

  // 日付の写し込み（オレンジの7セグ風）
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1);
  const dd = String(date.getDate());
  const stamp = `'${yy}  ${mm} ${dd}`;
  const fs = Math.round(h * 0.035);
  g.font = `bold ${fs}px "Courier New", ui-monospace, monospace`;
  g.textAlign = 'right';
  g.shadowColor = 'rgba(255,90,20,0.9)';
  g.shadowBlur = fs * 0.4;
  g.fillStyle = 'rgba(255,150,60,0.92)';
  g.fillText(stamp, w - fs * 1.4, h - fs * 1.2);
  g.shadowBlur = 0;

  return c.toDataURL('image/jpeg', 0.9);
}
