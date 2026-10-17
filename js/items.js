// 食べもの・飲みもの：品書き、持ち物（かばん）、品物の絵（Canvas で描く）。お金の概念はない。

export const ITEMS = {
  // パン屋
  melonpan: { name: 'メロンパン', kind: 'bread', desc: '外はさくさく、なかはふんわり', bites: 4, after: 'クッキー生地の甘さが、口のなかでほどける' },
  anpan: { name: 'あんぱん', kind: 'bread', desc: '粒あんたっぷり、てっぺんに桜の塩漬け', bites: 4, after: 'あんこの甘さに、桜の塩気がちょうどいい' },
  creampan: { name: 'クリームパン', kind: 'bread', desc: 'とろりとしたカスタード', bites: 4, after: 'まだ少しあたたかいカスタードが、とろり' },
  shiopan: { name: '塩パン', kind: 'bread', desc: '瀬戸内の塩とバターの香り', bites: 3, after: 'じゅわっとバター、あとから塩の香り' },
  currypan: { name: 'カレーパン', kind: 'bread', desc: '揚げたて、ざくざくの衣', bites: 4, after: 'ざくっ。中のカレーは、ほどよい辛さ' },
  hassaku: { name: 'はっさくデニッシュ', kind: 'bread', desc: '因島のはっさくをのせて', bites: 4, after: 'はっさくのほろ苦さと、デニッシュのバター' },
  // 坂の途中の小さなパン屋
  nikukyu: { name: '肉球パン', kind: 'bread', desc: '猫の手のかたち。中はミルククリーム', bites: 4, after: 'ふわふわの肉球。ミルクの甘さがやさしい' },
  sakamichi: { name: '坂道カスタード', kind: 'bread', desc: '石段をのぼったごほうびに', bites: 3, after: 'のぼってきた甲斐があった、とろりとした甘さ' },
  // かまぼこ屋
  itakama: { name: '紅白の板かまぼこ', kind: 'snack', desc: '瀬戸内の魚のすり身、ぷりっと弾む', bites: 4, after: 'ぷりぷり。噛むほど魚の旨みがひろがる' },
  tenpura: { name: '揚げたて天ぷら', kind: 'snack', desc: 'すり身を揚げた、尾道のおやつ', bites: 3, after: 'あつあつ、ふんわり。ほんのり甘い' },
  chikuwa: { name: '焼きちくわ', kind: 'snack', desc: 'こんがり焼き目', bites: 3, after: '香ばしい焼き目と、もちっとした歯ごたえ' },
  gyoroke: { name: '魚のコロッケ', kind: 'snack', desc: 'すり身とじゃがいも、ぴりっとカレー風味', bites: 4, after: 'ざくっ、ほくほく。ちょっとカレーの香り' },
  // 喫茶店（お店で食べる）
  waffle: { name: 'ワッフル', kind: 'waffle', desc: '丸く焼いた厚いワッフルに、バターをひとさじ', bites: 6, after: 'ごちそうさまでした。外はかりっと、なかはしっとり。バターの塩気がちょうどいい' },
  // 駅前のおやつの店
  purin: { name: '尾道プリン', kind: 'purin', desc: '小さな瓶入り。レモンソースつき', bites: 4, after: 'なめらかで、たまごの味がやさしい', afterLemon: 'ほろ苦いカラメルに、瀬戸内レモンの酸味がきゅっと' },
  // 自販機
  coffeeHot: { name: '缶コーヒー（あったか〜い）', kind: 'drink', desc: '手のひらがじんわり温まる', bites: 4, tap: true, after: 'ふう、と息がこぼれる。手があたたかい', color: '#5a3a24', band: '#d8b070', hot: true },
  coffeeCold: { name: '缶コーヒー（つめた〜い）', kind: 'drink', desc: 'すっきり微糖', bites: 4, tap: true, after: 'ひんやり、すっきり', color: '#2a3a5a', band: '#c8a060' },
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
  hillBakery: ['nikukyu', 'sakamichi', 'anpan', 'hassaku'],
  kamaboko: ['itakama', 'tenpura', 'chikuwa', 'gyoroke'],
  sweets: ['purin'],
  cafe: ['waffle'],
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
  } else if (id === 'nikukyu') {
    // 猫の手：大きな肉球と、指の4つの丸
    g.fillStyle = shade('#f6dcb0', '#d6a466', s * 0.34);
    g.beginPath(); g.ellipse(0, s * 0.06, s * 0.3, s * 0.26, 0, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(-s * 0.21 + k * s * 0.14, -s * 0.2 - (k % 3 ? s * 0.04 : 0), s * 0.085, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#eba0a4';
    g.beginPath(); g.ellipse(0, s * 0.1, s * 0.12, s * 0.09, 0, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(-s * 0.21 + k * s * 0.14, -s * 0.2 - (k % 3 ? s * 0.04 : 0), s * 0.04, 0, Math.PI * 2); g.fill(); }
  } else if (id === 'sakamichi') {
    g.fillStyle = shade('#f0c070', '#b07a30', s * 0.34);
    g.beginPath(); g.arc(0, 0, s * 0.32, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f8e2a0';
    g.beginPath(); g.arc(0, 0, s * 0.15, 0, Math.PI * 2); g.fill();
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

function snack(g, id, s) {
  g.save();
  g.translate(s / 2, s / 2);
  if (id === 'itakama') {
    // 板の上に、かまぼこ形（白い身に紅の皮）
    g.fillStyle = '#c89a62';
    g.fillRect(-s * 0.38, s * 0.08, s * 0.76, s * 0.08);
    g.fillStyle = '#e46a80';
    g.beginPath(); g.moveTo(-s * 0.36, s * 0.08); g.quadraticCurveTo(0, -s * 0.42, s * 0.36, s * 0.08); g.closePath(); g.fill();
    g.fillStyle = '#f8f4ec';
    g.beginPath(); g.moveTo(-s * 0.31, s * 0.08); g.quadraticCurveTo(0, -s * 0.33, s * 0.31, s * 0.08); g.closePath(); g.fill();
  } else if (id === 'chikuwa') {
    g.rotate(-0.35);
    const gr = g.createLinearGradient(0, -s * 0.12, 0, s * 0.12);
    gr.addColorStop(0, '#f0d8a8'); gr.addColorStop(0.5, '#a8622a'); gr.addColorStop(1, '#e8cc98');
    g.fillStyle = gr;
    g.fillRect(-s * 0.36, -s * 0.11, s * 0.72, s * 0.22);
    g.fillStyle = '#f2e6cc';
    g.beginPath(); g.ellipse(s * 0.36, 0, s * 0.05, s * 0.11, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a2a1e';
    g.beginPath(); g.ellipse(s * 0.36, 0, s * 0.025, s * 0.05, 0, 0, Math.PI * 2); g.fill();
  } else if (id === 'tenpura') {
    const gr = g.createRadialGradient(-s * 0.1, -s * 0.1, s * 0.05, 0, 0, s * 0.34);
    gr.addColorStop(0, '#e8b868'); gr.addColorStop(1, '#a8682a');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(0, 0, s * 0.34, s * 0.22, -0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(90,60,30,0.35)';
    for (let k = 0; k < 30; k++) g.fillRect(Math.sin(k * 5.1) * s * 0.26, Math.cos(k * 3.7) * s * 0.15, s * 0.012, s * 0.012);
  } else {
    // 魚のコロッケ：パン粉の衣
    const gr = g.createRadialGradient(-s * 0.1, -s * 0.1, s * 0.05, 0, 0, s * 0.32);
    gr.addColorStop(0, '#d8a050'); gr.addColorStop(1, '#8a5420');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(0, 0, s * 0.32, s * 0.26, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,228,170,0.65)';
    for (let k = 0; k < 70; k++) g.fillRect(Math.sin(k * 12.9) * s * 0.26, Math.cos(k * 7.3) * s * 0.2, s * 0.014, s * 0.01);
  }
  g.restore();
}

/** 小さな瓶入りのプリン（茶色のふた、赤い帯）。lemon でレモンソース */
function purinJar(g, s, eaten, lemon) {
  const w = s * 0.4, h = s * 0.46;
  const x = (s - w) / 2, y = s * 0.3;
  const left = 1 - eaten;
  // ふた（食べはじめたら横に置く）
  g.fillStyle = '#6a3f22';
  if (eaten === 0) { g.fillRect(x - s * 0.01, y - s * 0.06, w + s * 0.02, s * 0.07); }
  else { g.beginPath(); g.ellipse(s * 0.84, s * 0.8, s * 0.1, s * 0.04, 0, 0, Math.PI * 2); g.fill(); }
  // 瓶の中身：底のカラメル、たまご色のプリン、上にレモンソース
  const fillTop = y + s * 0.03 + (h - s * 0.1) * (1 - left);
  const bottom = y + h - s * 0.03;
  g.fillStyle = '#7a3a12';
  g.fillRect(x + s * 0.02, bottom - s * 0.06, w - s * 0.04, s * 0.06);
  if (left > 0) {
    g.fillStyle = '#f2d27a';
    g.fillRect(x + s * 0.02, fillTop, w - s * 0.04, Math.max(0, bottom - s * 0.06 - fillTop));
    if (lemon) {
      g.fillStyle = 'rgba(250,236,90,0.9)';
      g.fillRect(x + s * 0.02, fillTop, w - s * 0.04, s * 0.035);
    }
  }
  // ガラス
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = s * 0.012;
  g.strokeRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(x + s * 0.03, y + s * 0.03, s * 0.035, h - s * 0.06);
  // 赤い横の帯
  g.fillStyle = '#c8302a';
  g.fillRect(x, y + h * 0.42, w, h * 0.16);
  g.fillStyle = '#fff4e4';
  g.font = `600 ${Math.round(s * 0.05)}px "Shippori Mincho", serif`;
  g.textAlign = 'center';
  g.fillText('尾道プリン', s / 2, y + h * 0.535);
  // スプーン
  if (eaten > 0 && eaten < 1) {
    g.strokeStyle = '#d8d8dc'; g.lineWidth = s * 0.02;
    g.beginPath(); g.moveTo(s * 0.62, y - s * 0.02); g.lineTo(s * 0.8, y - s * 0.22); g.stroke();
  }
}

/** 白い皿に、丸い厚焼きワッフルとバター。食べたぶんだけ扇形に減っていく */
function waffle(g, s, eaten) {
  const c = s / 2, R = s * 0.45;
  g.fillStyle = '#f6f4ef';
  g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a4a8a'; g.lineWidth = s * 0.006;
  g.beginPath(); g.arc(c, c, R * 0.93, -2.2, -1.4); g.stroke();
  const r = R * 0.74;
  const left = 1 - eaten;
  if (left <= 0) return;
  g.save();
  // 残っているぶん（扇形）
  g.beginPath(); g.moveTo(c, c); g.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); g.closePath();
  g.clip();
  const gr = g.createRadialGradient(c, c, r * 0.2, c, c, r);
  gr.addColorStop(0, '#c88a4e'); gr.addColorStop(0.85, '#b57638'); gr.addColorStop(1, '#8a5424');
  g.fillStyle = gr;
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  // 格子のくぼみ（4つに区切った十字の溝）
  const cell = r / 4.2;
  g.fillStyle = 'rgba(120,70,30,0.45)';
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
    if (i === 0 || j === 0) continue;
    const x = c + i * cell - cell * 0.4 * Math.sign(i), y = c + j * cell - cell * 0.4 * Math.sign(j);
    if (Math.hypot(x - c, y - c) > r * 0.86) continue;
    g.fillRect(x - cell * 0.32, y - cell * 0.32, cell * 0.64, cell * 0.64);
  }
  g.restore();
  // バター（とけていく）
  if (eaten < 0.7) {
    g.fillStyle = 'rgba(250,230,150,0.55)';
    g.beginPath(); g.ellipse(c, c, r * (0.22 + eaten * 0.3), r * (0.17 + eaten * 0.25), 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fbf1c8';
    g.beginPath(); g.ellipse(c, c - r * 0.02, r * 0.15 * (1 - eaten), r * 0.12 * (1 - eaten), 0, 0, Math.PI * 2); g.fill();
  }
}

/** 品物を描く。progress: 0（手つかず）〜1（食べ終わり） */
export function drawItem(canvas, id, progress = 0, opts = {}) {
  const s = canvas.width;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, s, s);
  const item = ITEMS[id];
  if (item.kind === 'ramen') { ramenBowl(g, s, progress); return; }
  if (item.kind === 'drink') { can(g, item, s, Math.round(progress * item.bites)); return; }
  if (item.kind === 'purin') { purinJar(g, s, progress, opts.lemon); return; }
  if (item.kind === 'waffle') { waffle(g, s, progress); return; }
  if (item.kind === 'snack') snack(g, id, s);
  else bread(g, id, s);
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
