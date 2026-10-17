// 日記：その日に歩いた場所、出会った猫、食べたもの、撮った写真、空の色を書きとめておき、
// 「日記を書く」で下書きを作る。自分のことばに書きかえて、手帳にしまえる（ブラウザに保存）。
const $ = (id) => document.getElementById(id);
const KEY = 'onomichi-diary';
const MAX = 60;

export class Diary {
  /**
   * @param getDay () => ({ day, label, mood })  ゲーム内の日（ラベルは「十月十七日」など）
   */
  constructor({ getDay, toast }) {
    this.getDay = getDay;
    this.toast = toast;
    this.day = null;
    this.log = null;
    try { this.entries = JSON.parse(localStorage.getItem(KEY)) || []; } catch { this.entries = []; }
    this._reset();
    $('btn-diary').addEventListener('click', () => this.open());
    $('diary-close').addEventListener('click', () => $('diary-view').classList.add('hidden'));
    $('diary-view').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('diary-view').classList.add('hidden'); });
    $('diary-save').addEventListener('click', () => this.save());
    $('diary-redraft').addEventListener('click', () => { $('diary-text').value = this.draft(); });
  }

  _reset() {
    const d = this.getDay();
    this.day = d.day;
    this.log = { places: [], foods: [], cats: [], petted: [], friends: [], photos: 0, photo: null, ropeway: false, summit: false, sat: 0, eyes: 0, moods: [] };
  }

  _today() {
    if (this.getDay().day !== this.day) this._reset();
    return this.log;
  }

  // ---------- その日のできごと ----------
  place(name) { const l = this._today(); if (name && !l.places.includes(name)) l.places.push(name); }
  food(name) { const l = this._today(); if (!l.foods.includes(name)) l.foods.push(name); }
  metCat(name) { const l = this._today(); if (!l.cats.includes(name)) l.cats.push(name); }
  pettedCat(name) { const l = this._today(); if (!l.petted.includes(name)) l.petted.push(name); }
  catFriend(name) { const l = this._today(); if (!l.friends.includes(name)) l.friends.push(name); }
  sky(name) { const l = this._today(); if (name && !l.moods.includes(name)) l.moods.push(name); }
  ropeway() { this._today().ropeway = true; }
  summit() { this._today().summit = true; }
  sat() { this._today().sat++; }
  closedEyes() { this._today().eyes++; }
  /** 写真（data URL）。最初の1枚を小さくして日記に貼る */
  photo(url) {
    const l = this._today();
    l.photos++;
    if (l.photo) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = Math.round((img.height / img.width) * 320);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      l.photo = c.toDataURL('image/jpeg', 0.72);
    };
    img.src = url;
  }

  /** できごとから、下書きの文章を作る */
  draft() {
    const l = this._today();
    const join = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join('、') + 'と' + a[a.length - 1]);
    const lines = [];
    const places = l.places.filter((p) => p !== '坂の上の空き家').slice(0, 4);
    if (!places.length) lines.push('今日は、坂の上の空き家で、窓から海を眺めて過ごした。');
    else lines.push(`今日は、${join(places)}のあたりを歩いた。`);
    if (l.ropeway) lines.push(l.summit ? 'ロープウェイで千光寺山にのぼって、山頂から尾道水道を見わたした。' : 'ロープウェイに乗った。ゴンドラの窓の下を、町がゆっくり流れていった。');
    else if (l.summit) lines.push('千光寺山の頂上から、尾道水道を見わたした。');
    if (l.foods.length) lines.push(`${join(l.foods.slice(0, 3))}をいただいた。`);
    if (l.friends.length) lines.push(`${join(l.friends)}が、すっかり懐いてくれた。`);
    else if (l.petted.length) lines.push(`${join(l.petted.slice(0, 3))}を、そっとなでた。`);
    else if (l.cats.length) lines.push(`${join(l.cats.slice(0, 3))}に会った。`);
    if (l.sat) lines.push('海沿いのベンチに座って、渡船が行き来するのを眺めた。');
    if (l.eyes) lines.push('目を閉じて、波と風の音を聞いた。');
    if (l.moods.length) lines.push(`夕方の空は「${l.moods[l.moods.length - 1]}」。`);
    if (l.photos) lines.push(`写真を${l.photos}枚撮った。`);
    return lines.join('\n');
  }

  open() {
    const d = this.getDay();
    $('diary-date').textContent = d.label;
    const saved = this.entries.find((e) => e.day === d.day);
    $('diary-text').value = saved ? saved.text : this.draft();
    const img = $('diary-photo');
    const photo = saved?.photo || this._today().photo;
    img.hidden = !photo;
    if (photo) img.src = photo;
    this._renderPast();
    $('diary-view').classList.remove('hidden');
  }

  save() {
    const d = this.getDay();
    const text = $('diary-text').value.trim();
    if (!text) return;
    const entry = { day: d.day, label: d.label, text, photo: this._today().photo || this.entries.find((e) => e.day === d.day)?.photo || null, at: Date.now() };
    this.entries = [entry, ...this.entries.filter((e) => e.day !== d.day)].slice(0, MAX);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.entries));
    } catch {
      // 容量がいっぱいなら、古い日記の写真から外す
      this.entries.slice(10).forEach((e) => { e.photo = null; });
      try { localStorage.setItem(KEY, JSON.stringify(this.entries)); } catch { /* ignore */ }
    }
    this._renderPast();
    this.toast('日記を書きとめた', 2400);
  }

  _renderPast() {
    const box = $('diary-past');
    box.replaceChildren();
    const past = this.entries.filter((e) => e.day !== this.getDay().day);
    $('diary-past-title').hidden = !past.length;
    for (const e of past) {
      const item = document.createElement('details');
      item.className = 'diary-entry';
      const sum = document.createElement('summary');
      sum.textContent = e.label;
      const p = document.createElement('p');
      p.textContent = e.text;
      item.append(sum);
      if (e.photo) {
        const img = document.createElement('img');
        img.src = e.photo;
        img.alt = `${e.label}の写真`;
        item.append(img);
      }
      item.append(p);
      box.append(item);
    }
  }
}
