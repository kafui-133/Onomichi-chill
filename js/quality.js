// 画質の設定（高・中・低）。指で操作する端末ははじめ「中」、それ以外は「高」。
// 選んだ画質はブラウザに覚えておく。URL の ?quality=low|medium|high でも指定できる。
const KEY = 'onomichi-quality';
const COARSE = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export const QUALITY_LEVELS = {
  high: { label: '高', pixelRatio: 2, shadowSize: 2048, shadows: true, candles: 1, people: 1 },
  medium: { label: '中', pixelRatio: 1.5, shadowSize: 1024, shadows: true, candles: 0.55, people: 0.6 },
  low: { label: '低', pixelRatio: 1, shadowSize: 512, shadows: false, candles: 0.3, people: 0.35 },
};
export const QUALITY_ORDER = ['high', 'medium', 'low'];

function initial() {
  const p = new URLSearchParams(location.search).get('quality');
  if (p && QUALITY_LEVELS[p]) return p;
  try { const v = localStorage.getItem(KEY); if (QUALITY_LEVELS[v]) return v; } catch { /* ignore */ }
  return COARSE ? 'medium' : 'high';
}

export const quality = {
  name: initial(),
  get s() { return QUALITY_LEVELS[this.name]; },
  set(name) {
    if (!QUALITY_LEVELS[name]) return;
    this.name = name;
    try { localStorage.setItem(KEY, name); } catch { /* ignore */ }
  },
  next() { return QUALITY_ORDER[(QUALITY_ORDER.indexOf(this.name) + 1) % QUALITY_ORDER.length]; },
};
