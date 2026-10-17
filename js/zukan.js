// 出会った猫図鑑：町で出会った猫の毛色・居場所・懐き具合（親密度レベル）を記す。
// すっかり懐いた（Lv.4）猫は、地図にも居場所が載り、そこへすぐ行ける。
import { COATS, LEVEL_THRESHOLDS } from './cat.js';

const $ = (id) => document.getElementById(id);
const KEY = 'onomichi-zukan-met';

export const LEVEL_NAME = { 1: '警戒', 2: '関心', 3: '慣れ', 4: '信頼' };

// 猫ごとの、懐くにつれてわかってくること
const NOTES = {
  home: ['窓辺から、ずっと海を見ている', 'こちらをちらちら気にしている', '足もとでシッポがぺしぺし', '座布団の上で、安心しきって眠る'],
  hosomichi: ['石段の上から、じっと見下ろしてくる', '丸い石の猫の絵の横が、お気に入りらしい', '香箱を組んで、目を細める', '石段をのぼってくる足音を、覚えてくれた'],
  fukuishi: ['丸くなったまま、片目だけ開ける', '日だまりの石が、あたたかいらしい', '寝息が聞こえる', 'しゃがむと、そっと鼻先を寄せてくる'],
  ropeway: ['ゴンドラが出るたび、耳がぴくりと動く', '駅の人に、ごはんをもらっているらしい', 'ハチワレの顔で、ゆっくりまばたき', '山頂行きのゴンドラを、いっしょに見送る'],
  shotengai: ['店先の日よけの下で、昼寝中', 'パンの匂いがすると、顔を上げる', 'アーケードの足音には、もう慣れっこ', '商店街の、看板猫のような顔をしている'],
  umibe: ['ベンチの横で、渡船を見ている', '潮風に、ひげがそよぐ', '三毛の背中が、夕日に光る', 'となりに座ると、いっしょに海を見る'],
  ishidan: ['空き家の前の石段に、いつもいる', '戸口のほうを、気にしている', 'こちらの帰りを、待っていたような顔', 'ご近所づきあいの、はじまり'],
  bench: ['板張りのベンチの、まんなかを占領している', '後ろ足で、耳のうしろをかいている', 'ごろりと寝返りをうって、お腹を見せた', 'このベンチは、もうこの猫のもの'],
  senkoji: ['境内の石垣の上から、見張っている', '鐘の音に、少しだけ目を開ける', '参道の石段を、先に立って歩く', '千光寺山の、主のような猫'],
  tennei: ['三重塔の影に、黒い姿', '金色の目で、じっとこちらを見る', '塔のまわりを、ゆっくり一周する', '夕暮れの塔の下で、待っていてくれる'],
};

/** 猫の顔を小さな絵で描く（図鑑・地図の印に使う） */
export function drawCatFace(canvas, coatKey, { unknown = false } = {}) {
  const coat = COATS[coatKey] || COATS.chatora;
  const g = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.56, r = w * 0.34;
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const base = unknown ? '#3a3632' : coat.base;
  g.save();
  // 耳
  g.fillStyle = unknown ? base : hex(coat.plain);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + s * r * 0.95, cy - r * 0.2);
    g.lineTo(cx + s * r * 0.75, cy - r * 1.25);
    g.lineTo(cx + s * r * 0.15, cy - r * 0.8);
    g.closePath();
    g.fill();
  }
  // 顔
  g.beginPath();
  g.ellipse(cx, cy, r, r * 0.86, 0, 0, Math.PI * 2);
  g.fillStyle = base;
  g.fill();
  g.clip();
  if (!unknown) {
    if (coat.stripe) {
      g.strokeStyle = `rgba(${coat.stripe},0.7)`;
      g.lineWidth = w * 0.035;
      for (const dx of [-0.22, 0, 0.22]) {
        g.beginPath(); g.moveTo(cx + dx * r, cy - r); g.lineTo(cx + dx * r * 0.6, cy - r * 0.45); g.stroke();
      }
      for (const s of [-1, 1]) for (const dy of [0.05, 0.22]) {
        g.beginPath(); g.moveTo(cx + s * r, cy + dy * r); g.lineTo(cx + s * r * 0.62, cy + dy * r * 0.7); g.stroke();
      }
    }
    if (coat.patches) {
      g.fillStyle = coat.patches[0];
      g.beginPath(); g.ellipse(cx - r * 0.55, cy - r * 0.45, r * 0.55, r * 0.5, 0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = coat.patches[1];
      g.beginPath(); g.ellipse(cx + r * 0.6, cy - r * 0.55, r * 0.5, r * 0.45, -0.3, 0, Math.PI * 2); g.fill();
    }
    if (coat.belly) {
      // ハチワレ・口もとの白
      g.fillStyle = '#f2ebe0';
      g.beginPath();
      if (coat.whiteLegs && coat.label === 'ハチワレ') {
        g.moveTo(cx, cy - r * 0.55);
        g.lineTo(cx + r * 0.55, cy + r);
        g.lineTo(cx - r * 0.55, cy + r);
        g.closePath();
      } else g.ellipse(cx, cy + r * 0.5, r * 0.55, r * 0.42, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
  // 目と鼻
  if (unknown) {
    g.fillStyle = 'rgba(244,239,230,0.55)';
    g.font = `${Math.round(w * 0.32)}px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('?', cx, cy + r * 0.05);
    return;
  }
  const eye = coat.eye ? hex(coat.eye) : '#2a2a1e';
  for (const s of [-1, 1]) {
    g.fillStyle = coat.eye ? eye : '#c8b24a';
    g.beginPath(); g.ellipse(cx + s * r * 0.38, cy - r * 0.05, r * 0.15, r * 0.17, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#16120e';
    g.beginPath(); g.ellipse(cx + s * r * 0.38, cy - r * 0.05, r * 0.05, r * 0.14, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#d88a8a';
  g.beginPath(); g.moveTo(cx - r * 0.09, cy + r * 0.22); g.lineTo(cx + r * 0.09, cy + r * 0.22); g.lineTo(cx, cy + r * 0.33); g.closePath(); g.fill();
}

export class Zukan {
  /**
   * @param entries [{ id, name, coat, where, cat }]  図鑑にのる猫（cat は Cat）
   * @param onTravel (entry) => void  すっかり懐いた猫のところへ行く
   */
  constructor(entries, { onTravel }) {
    this.entries = entries;
    this.onTravel = onTravel;
    try { this.met = new Set(JSON.parse(localStorage.getItem(KEY)) || []); } catch { this.met = new Set(); }
    this.met.add('home');
    this._updateCount();
    $('btn-zukan').addEventListener('click', () => this.open());
    $('zukan-close').addEventListener('click', () => $('zukan-view').classList.add('hidden'));
    $('zukan-view').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('zukan-view').classList.add('hidden'); });
  }

  /** 出会った（そばまで来た）。はじめてなら true */
  meet(id) {
    if (this.met.has(id)) return false;
    this.met.add(id);
    try { localStorage.setItem(KEY, JSON.stringify([...this.met])); } catch { /* ignore */ }
    this._updateCount();
    return true;
  }

  /** すっかり懐いて、地図に載る猫 */
  friends() {
    return this.entries.filter((e) => this.met.has(e.id) && e.cat.level >= 4 && e.id !== 'home');
  }

  _updateCount() {
    const n = this.entries.filter((e) => this.met.has(e.id)).length;
    $('zukan-count').textContent = n > 1 ? n : '';
  }

  open() {
    const list = $('zukan-list');
    list.replaceChildren();
    const metN = this.entries.filter((e) => this.met.has(e.id)).length;
    $('zukan-note').textContent = `出会った猫　${metN} / ${this.entries.length}　　なでたり、しゃがんでそっと待ったりすると、懐いてきます。すっかり懐いた猫は、地図に居場所が載ります。`;
    for (const e of this.entries) {
      const known = this.met.has(e.id);
      const card = document.createElement('div');
      card.className = 'cat-card' + (known ? '' : ' unknown');
      const c = document.createElement('canvas');
      c.width = c.height = 120;
      drawCatFace(c, e.coat, { unknown: !known });
      const body = document.createElement('div');
      body.className = 'cat-body';
      const name = document.createElement('p');
      name.className = 'cat-name';
      const lv = e.cat.level;
      if (known) {
        name.textContent = `${e.name}　`;
        const coat = document.createElement('span');
        coat.className = 'cat-coat';
        coat.textContent = COATS[e.coat]?.label || '';
        name.append(coat);
        const lvRow = document.createElement('p');
        lvRow.className = 'cat-level';
        const next = LEVEL_THRESHOLDS[lv];
        const prev = LEVEL_THRESHOLDS[lv - 1];
        const frac = next === undefined ? 1 : Math.min(1, (e.cat.affection - prev) / (next - prev));
        lvRow.innerHTML = `<span class="hearts">${'●'.repeat(lv)}${'○'.repeat(4 - lv)}</span> Lv.${lv} ${LEVEL_NAME[lv]}`;
        const bar = document.createElement('span');
        bar.className = 'cat-bar';
        bar.style.setProperty('--f', lv >= 4 ? 1 : frac);
        lvRow.append(bar);
        const where = document.createElement('p');
        where.className = 'cat-where';
        where.textContent = e.where;
        const note = document.createElement('p');
        note.className = 'cat-note';
        note.textContent = (NOTES[e.id] || [])[lv - 1] || '';
        body.append(name, lvRow, where, note);
        if (lv >= 4 && e.id !== 'home') {
          const go = document.createElement('button');
          go.className = 'pill small';
          go.textContent = '会いにいく';
          go.addEventListener('click', () => { $('zukan-view').classList.add('hidden'); this.onTravel(e); });
          body.append(go);
        }
      } else {
        name.textContent = '？？？';
        const where = document.createElement('p');
        where.className = 'cat-where';
        where.textContent = `${e.hint}`;
        body.append(name, where);
      }
      card.append(c, body);
      list.append(card);
    }
    $('zukan-view').classList.remove('hidden');
  }
}
