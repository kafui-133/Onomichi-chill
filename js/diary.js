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
    this.entries.sort((a, b) => b.day - a.day);
    this.unsaved = null;     // とじたときの書きかけ
    this.lastDraft = null;   // いま表示している自動の下書き（書きかえたかどうかの判定に使う）
    this.armed = false;
    this.page = 0;
    $('btn-diary').addEventListener('click', () => this.open());
    $('diary-close').addEventListener('click', () => this.close());
    $('diary-view').addEventListener('click', (e) => { if (e.target === e.currentTarget) this.close(); });
    $('diary-save').addEventListener('click', () => this.save());
    $('diary-redraft').addEventListener('click', () => this.redraft());
    $('diary-tab-write').addEventListener('click', () => this.open());
    $('diary-tab-read').addEventListener('click', () => this._showTab('read'));
    $('book-prev').addEventListener('click', () => this._openBook(this.page + 1));
    $('book-next').addEventListener('click', () => this._openBook(this.page - 1));
    $('book-list').addEventListener('click', () => this._renderList());
  }

  _reset() {
    const d = this.getDay();
    this.day = d.day;
    this.log = { events: [], places: [], foods: [], cats: [], petted: [], friends: [], photos: 0, photo: null, ropeway: false, summit: false, sat: 0, eyes: 0, moods: [] };
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
  /** 季節のイベントの日（日記のはじめに一行） */
  event(text) { const l = this._today(); if (text && !l.events.includes(text)) l.events.push(text); }
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
    const lines = [...(l.events || [])];
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

  // ---------- 書く ----------
  open() {
    this._showTab('write');
    const d = this.getDay();
    $('diary-date').textContent = d.label;
    const saved = this.entries.find((e) => e.day === d.day);
    // 書きかけ（まだ書きとめていない文章）があれば、それを続きから
    const text = this.unsaved && this.unsaved.day === d.day ? this.unsaved.text : saved ? saved.text : this.draft();
    $('diary-text').value = text;
    this.lastDraft = saved || this.unsaved ? null : text;
    const img = $('diary-photo');
    const photo = saved?.photo || this._today().photo;
    img.hidden = !photo;
    if (photo) img.src = photo;
    this._status(saved ? `${d.label}の日記は書きとめてあります。書きかえて、もう一度「書きとめる」こともできます` : '');
    this._updateCount();
    $('diary-view').classList.remove('hidden');
  }

  close() {
    // とじても、書きかけは消さない
    const d = this.getDay();
    const text = $('diary-text').value;
    const saved = this.entries.find((e) => e.day === d.day);
    if (!$('diary-write').hidden && text.trim() && text !== saved?.text && text !== this.lastDraft) this.unsaved = { day: d.day, text };
    $('diary-view').classList.add('hidden');
  }

  redraft() {
    const text = $('diary-text').value;
    const draft = this.draft();
    if (text === draft) { this._status('新しいできごとは、まだありません。歩いたり、食べたり、猫に会ったりすると、下書きにふえます'); return; }
    // 自分で書いた文章を消してしまわないよう、書きかえてあるときは2回押してもらう
    const edited = text.trim() && text !== this.lastDraft;
    if (edited && !this.armed) {
      this.armed = true;
      clearTimeout(this.armTimer);
      this.armTimer = setTimeout(() => { this.armed = false; }, 4000);
      this._status('いま書いてある文章は消えます。もう一度押すと、今日のできごとから下書きしなおします');
      return;
    }
    this.armed = false;
    $('diary-text').value = draft;
    this.lastDraft = draft;
    this.unsaved = null;
    this._status('今日のできごとから、下書きしなおしました');
  }

  save() {
    const d = this.getDay();
    const text = $('diary-text').value.trim();
    if (!text) { this._status('なにか書いてから、書きとめてください'); return; }
    const old = this.entries.find((e) => e.day === d.day);
    const entry = { day: d.day, label: d.label, text, photo: this._today().photo || old?.photo || null, at: Date.now() };
    this.entries = [entry, ...this.entries.filter((e) => e.day !== d.day)].sort((a, b) => b.day - a.day).slice(0, MAX);
    let ok = this._store();
    if (!ok) {
      // 容量がいっぱいなら、古い日記の写真から外す
      this.entries.slice(10).forEach((e) => { e.photo = null; });
      ok = this._store();
    }
    this.unsaved = null;
    this.lastDraft = null;
    this._updateCount();
    this._status(ok ? `${d.label}の日記を書きとめました。「見返す」から読み返せます` : '保存できませんでした（ブラウザの保存領域がいっぱいか、使えない設定になっています）');
    this.toast('日記を書きとめた', 2400);
  }

  _store() {
    try { localStorage.setItem(KEY, JSON.stringify(this.entries)); return true; } catch { return false; }
  }

  _status(text) {
    const el = $('diary-status');
    el.textContent = text;
    el.classList.remove('flash');
    void el.offsetWidth;
    if (text) el.classList.add('flash');
  }

  _updateCount() {
    $('diary-n').textContent = this.entries.length ? `（${this.entries.length}）` : '';
  }

  // ---------- 見返す ----------
  _showTab(tab) {
    $('diary-write').hidden = tab !== 'write';
    $('diary-read').hidden = tab !== 'read';
    $('diary-tab-write').classList.toggle('active', tab === 'write');
    $('diary-tab-read').classList.toggle('active', tab === 'read');
    if (tab === 'read') this._renderList();
  }

  _renderList() {
    const list = $('diary-list');
    list.replaceChildren();
    $('diary-book').hidden = true;
    list.hidden = false;
    $('diary-none').hidden = this.entries.length > 0;
    this.entries.forEach((e, i) => {
      const b = document.createElement('button');
      b.className = 'diary-item';
      if (e.photo) {
        const img = document.createElement('img');
        img.src = e.photo;
        img.alt = '';
        b.append(img);
      }
      const t = document.createElement('span');
      t.className = 'diary-item-text';
      const date = document.createElement('span');
      date.className = 'diary-item-date';
      date.textContent = e.label + (e.day === this.getDay().day ? '（今日）' : '');
      const first = document.createElement('span');
      first.className = 'diary-item-line';
      first.textContent = e.text.split('\n')[0];
      t.append(date, first);
      b.append(t);
      b.addEventListener('click', () => this._openBook(i));
      list.append(b);
    });
  }

  /** 日記帳のように、1日ずつ読む（i=0 がいちばん新しい日） */
  _openBook(i) {
    const e = this.entries[i];
    if (!e) return;
    this.page = i;
    $('diary-list').hidden = true;
    $('diary-book').hidden = false;
    $('book-date').textContent = e.label;
    $('book-text').textContent = e.text;
    const img = $('book-photo');
    img.hidden = !e.photo;
    if (e.photo) img.src = e.photo;
    $('book-prev').disabled = i >= this.entries.length - 1;
    $('book-next').disabled = i <= 0;
  }
}
