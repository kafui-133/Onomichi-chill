// 食べもの・飲みもの：品書き、持ち物（かばん）、品物の絵（Canvas で描く）。お金の概念はない。

export const ITEMS = {
  // パン屋
  melonpan: { name: 'メロンパン', kind: 'bread', desc: '外はさくさく、なかはふんわり', bites: 4, after: 'クッキー生地の甘さが、口のなかでほどける' },
  anpan: { name: 'あんぱん', kind: 'bread', desc: '粒あんたっぷり、てっぺんに桜の塩漬け', bites: 4, after: 'あんこの甘さに、桜の塩気がちょうどいい' },
  creampan: { name: 'クリームパン', kind: 'bread', desc: 'とろりとしたカスタード', bites: 4, after: 'まだ少しあたたかいカスタードが、とろり' },
  shiopan: { name: '塩パン', kind: 'bread', desc: '瀬戸内の塩とバターの香り', bites: 3, after: 'じゅわっとバター、あとから塩の香り' },
  currypan: { name: 'カレーパン', kind: 'bread', desc: '揚げたて、ざくざくの衣', bites: 4, after: 'ざくっ。中のカレーは、ほどよい辛さ' },
  hassaku: { name: 'はっさくデニッシュ', kind: 'bread', desc: '因島のはっさくをのせて', bites: 4, after: 'はっさくのほろ苦さと、デニッシュのバター' },
  // 自販機
  coffeeHot: { name: '缶コーヒー（あったか〜い）', kind: 'drink', desc: '手のひらがじんわり温まる', bites: 4, after: 'ふう、と息がこぼれる。手があたたかい', color: '#5a3a24', band: '#d8b070', hot: true },
  coffeeCold: { name: '缶コーヒー（つめた〜い）', kind: 'drink', desc: 'すっきり微糖', bites: 4, after: 'ひんやり、すっきり', color: '#2a3a5a', band: '#c8a060' },
  mikan: { name: 'みかんジュース', kind: 'drink', desc: '瀬戸内のみかん100%', bites: 4, after: '甘酸っぱい。島のみかんの味がする', color: '#f08a1c', band: '#fff2c8' },
  ocha: { name: '緑茶', kind: 'drink', desc: 'すっきり、ほんのり渋い', bites: 4, after: 'すうっと、のどがうるおう', color: '#3f7a3a', band: '#e8f0d0' },
  ramune: { name: 'ラムネ', kind: 'drink', desc: 'しゅわしゅわ、ビー玉入り', bites: 4, after: 'しゅわっ。からん、とビー玉が鳴る', color: '#7ac8e8', band: '#ffffff' },
  milktea: { name: 'ミルクティー', kind: 'drink', desc: 'やさしい甘さ', bites: 4, after: 'まろやかで、ほっとする甘さ', color: '#b88a5a', band: '#f6ead8', hot: true },
  // ラーメン（お店で食べる）
  ramen: { name: '尾道ラーメン', kind: 'ramen', desc: '鶏ガラと魚介の醤油スープ、豚の背脂、平打ちの細麺', bites: 8, after: 'ごちそうさまでした。背脂の甘みが、あとをひく' },
};

export const MENUS = {
  bakery: ['melonpan', 'anpan', 'creampan', 'shiopan', 'currypan', 'hassaku'],
  vending: ['coffeeHot', 'coffeeCold', 'mikan', 'ocha', 'ramune', 'milktea'],
  ramen: ['ramen'],
};

// ---------- 持ち物 ----------
const KEY = 'onomichi-bag';
export class Bag {
  constructor() {
    this.items = [];
    try { this.items = JSON.parse(localStorage.getItem(KEY) || '[]').filter((id) => ITEMS[id]); } catch { this.items = []; }
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.items)); } catch { /* 保存できなくても遊べる */ } }
  add(id) {
    if (this.items.length >= 12) return false;
    this.items.push(id);
    this.save();
    return true;
  }
  take(index) {
    const [id] = this.items.splice(index, 1);
    this.save();
    return id;
  }
}

// ---------- 品物の絵 ----------
function bread(g, id, s) {
  g.save();
  g.translate(s / 2, s / 2);
  const shade = (c1, c2, r) => { const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r); gr.addColorStop(0, c1); gr.addColorStop(1, c2); return gr; };
  if (id === 'melonpan') {
    g.fillStyle = shade('#f8dc8a', '#d9a446', s * 0.36);
    g.beginPath(); g.arc(0, 0, s * 0.36, 0, Math.PI * 2); g.fill();
    g.clip();
    g.strokeStyle = 'rgba(150,100,30,0.55)'; g.lineWidth = s * 0.012;
    for (let k = -3; k <= 3; k++) {
      g.beginPath(); g.moveTo(-s * 0.36, k * s * 0.09 - s * 0.2); g.lineTo(s * 0.36, k * s * 0.09 + s * 0.2); g.stroke();
      g.beginPath(); g.moveTo(-s * 0.36, k * s * 0.09 + s * 0.2); g.lineTo(s * 0.36, k * s * 0.09 - s * 0.2); g.stroke();
    }
  } else if (id === 'anpan') {
    g.fillStyle = shade('#c98a4a', '#7a4a22', s * 0.34);
    g.beginPath(); g.arc(0, 0, s * 0.34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8a0a8';
    g.beginPath(); g.arc(0, -s * 0.02, s * 0.05, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(250,240,220,0.8)';
    for (let k = 0; k < 9; k++) { const a = k * 0.7; g.fillRect(Math.cos(a) * s * 0.14, Math.sin(a) * s * 0.14, s * 0.012, s * 0.02); }
  } else if (id === 'creampan') {
    g.fillStyle = shade('#e8b46a', '#a8702e', s * 0.36);
    g.beginPath();
    g.moveTo(-s * 0.34, s * 0.16);
    g.quadraticCurveTo(-s * 0.36, -s * 0.24, -s * 0.18, -s * 0.22);
    for (let k = 0; k < 4; k++) g.quadraticCurveTo(-s * 0.1 + k * s * 0.13, -s * 0.36, s * 0.0 + k * s * 0.12, -s * 0.2);
    g.quadraticCurveTo(s * 0.4, -s * 0.05, s * 0.34, s * 0.16);
    g.closePath(); g.fill();
  } else if (id === 'shiopan') {
    g.rotate(-0.2);
    g.fillStyle = shade('#f0c070', '#b07a30', s * 0.36);
    g.beginPath(); g.ellipse(0, 0, s * 0.36, s * 0.17, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(120,70,20,0.45)'; g.lineWidth = s * 0.015;
    for (let k = -2; k <= 2; k++) { g.beginPath(); g.ellipse(k * s * 0.11, 0, s * 0.05, s * 0.16, 0.3, -1.2, 1.2); g.stroke(); }
    g.fillStyle = '#fff';
    for (let k = 0; k < 14; k++) g.fillRect((Math.sin(k * 7) * 0.28) * s, (Math.cos(k * 3) * 0.08) * s, s * 0.01, s * 0.01);
  } else if (id === 'currypan') {
    g.fillStyle = shade('#d8963e', '#8a5a1e', s * 0.36);
    g.beginPath(); g.ellipse(0, 0, s * 0.36, s * 0.24, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,230,170,0.6)';
    for (let k = 0; k < 60; k++) g.fillRect(Math.sin(k * 12.9) * s * 0.3, Math.cos(k * 7.3) * s * 0.19, s * 0.012, s * 0.012);
  } else {
    // はっさくデニッシュ
    g.fillStyle = shade('#f2c878', '#b8823a', s * 0.34);
    g.beginPath();
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.lineTo(Math.cos(a) * s * 0.34, Math.sin(a) * s * 0.34); }
    g.closePath(); g.fill();
    g.fillStyle = '#f7a83a';
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      g.beginPath(); g.ellipse(Math.cos(a) * s * 0.12, Math.sin(a) * s * 0.12, s * 0.09, s * 0.04, a, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}

function can(g, item, s, sips) {
  const w = s * 0.34, h = s * 0.62;
  const x = (s - w) / 2, y = (s - h) / 2 + s * 0.04;
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, item.color); gr.addColorStop(0.35, '#ffffff55'); gr.addColorStop(0.5, item.color); gr.addColorStop(1, '#00000066');
  g.fillStyle = item.color;
  g.fillRect(x, y, w, h);
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  g.fillStyle = item.band;
  g.fillRect(x, y + h * 0.35, w, h * 0.3);
  g.fillStyle = '#c8c8cc';
  g.beginPath(); g.ellipse(s / 2, y, w / 2, w * 0.14, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = item.color;
  g.font = `600 ${Math.round(s * 0.06)}px "Shippori Mincho", serif`;
  g.textAlign = 'center';
  const short = item.name.replace(/（.*）/, '');
  g.fillText(short.length > 5 ? short.slice(0, 5) : short, s / 2, y + h * 0.53);
  // 飲んだぶんだけ、上にしるし
  for (let k = 0; k < sips; k++) {
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath(); g.arc(s / 2 - w * 0.3 + k * w * 0.2, y - s * 0.07, s * 0.012, 0, Math.PI * 2); g.fill();
  }
  if (item.hot) {
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = s * 0.012;
    for (let k = -1; k <= 1; k++) {
      g.beginPath(); g.moveTo(s / 2 + k * s * 0.06, y - s * 0.1);
      g.bezierCurveTo(s / 2 + k * s * 0.06 + s * 0.03, y - s * 0.16, s / 2 + k * s * 0.06 - s * 0.03, y - s * 0.2, s / 2 + k * s * 0.06, y - s * 0.26);
      g.stroke();
    }
  }
}

function ramenBowl(g, s, eaten) {
  const c = s / 2, R = s * 0.44;
  g.fillStyle = '#e8e2d6';
  g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#b8322a'; g.lineWidth = s * 0.02;
  g.beginPath(); g.arc(c, c, R * 0.93, 0, Math.PI * 2); g.stroke();
  // 雷紋
  g.lineWidth = s * 0.008;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    g.beginPath(); g.arc(c + Math.cos(a) * R * 0.97, c + Math.sin(a) * R * 0.97, s * 0.012, 0, Math.PI * 1.5); g.stroke();
  }
  // スープ
  const soup = g.createRadialGradient(c - R * 0.2, c - R * 0.2, R * 0.1, c, c, R * 0.85);
  soup.addColorStop(0, '#b8742e'); soup.addColorStop(1, '#6a3412');
  g.fillStyle = soup;
  g.beginPath(); g.arc(c, c, R * 0.85, 0, Math.PI * 2); g.fill();
  const left = 1 - eaten;
  // 麺
  g.strokeStyle = '#f0d890'; g.lineWidth = s * 0.012;
  const strands = Math.round(26 * left);
  for (let k = 0; k < strands; k++) {
    g.beginPath();
    const y0 = c - R * 0.4 + (k / 26) * R * 0.8;
    g.moveTo(c - R * 0.6, y0);
    g.bezierCurveTo(c - R * 0.2, y0 - R * 0.12, c + R * 0.2, y0 + R * 0.12, c + R * 0.6, y0);
    g.stroke();
  }
  // 背脂
  g.fillStyle = 'rgba(255,250,235,0.85)';
  for (let k = 0; k < 70 * Math.max(0.3, left); k++) {
    const a = k * 2.399, r = Math.sqrt(k / 70) * R * 0.8;
    g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, s * 0.007, 0, Math.PI * 2); g.fill();
  }
  if (eaten < 0.6) {
    // チャーシュー
    g.fillStyle = '#c88a6a'; g.strokeStyle = '#8a4a2a'; g.lineWidth = s * 0.006;
    for (const [dx, dy] of [[0.35, -0.25], [0.45, 0.05]]) {
      g.beginPath(); g.ellipse(c + dx * R, c + dy * R, R * 0.2, R * 0.15, 0.4, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
  if (eaten < 0.85) {
    // メンマとねぎ
    g.fillStyle = '#c8a050';
    for (let k = 0; k < 4; k++) g.fillRect(c - R * 0.55 + k * R * 0.08, c + R * 0.3, R * 0.05, R * 0.22);
    g.fillStyle = '#5aa04a';
    for (let k = 0; k < 18; k++) { const a = k * 1.3; g.beginPath(); g.arc(c - R * 0.15 + Math.cos(a) * R * 0.12, c - R * 0.35 + Math.sin(a) * R * 0.08, s * 0.012, 0, Math.PI * 2); g.fill(); }
  }
}

/** 品物を描く。progress: 0（手つかず）〜1（食べ終わり） */
export function drawItem(canvas, id, progress = 0) {
  const s = canvas.width;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, s, s);
  const item = ITEMS[id];
  if (item.kind === 'ramen') { ramenBowl(g, s, progress); return; }
  if (item.kind === 'drink') { can(g, item, s, Math.round(progress * item.bites)); return; }
  bread(g, id, s);
  // かじったあと（右上から）
  const bites = Math.round(progress * item.bites);
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < bites; k++) {
    const a = -0.6 + k * 0.55;
    const r = s * 0.13;
    for (let j = -1; j <= 1; j++) {
      g.beginPath(); g.arc(s / 2 + Math.cos(a + j * 0.18) * s * 0.36, s / 2 + Math.sin(a + j * 0.18) * s * 0.36, r, 0, Math.PI * 2); g.fill();
    }
  }
  g.globalCompositeOperation = 'source-over';
}
