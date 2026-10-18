// 食べる・飲む・買う：パン屋と自販機のお品書き、持ち物、食べ歩き、ベンチでのひとやすみ、ラーメン屋。
import { ITEMS, MENUS, Bag, drawItem } from './items.js';

const $ = (id) => document.getElementById(id);

export class Food {
  /**
   * @param audio   AudioEngine
   * @param toast   (text, ms) => void
   * @param context () => ({ seated, walking, place })  いまの状況（食べ終わりのひとことに使う）
   */
  constructor({ audio, toast, context, onEat }) {
    this.onEat = onEat || (() => {});
    this.audio = audio;
    this.toast = toast;
    this.context = context;
    this.bag = new Bag();
    this.eating = null;
    this._updateCount();

    $('shop-close').addEventListener('click', () => this.closeShop());
    $('shop-view').addEventListener('click', (e) => { if (e.target === e.currentTarget) this.closeShop(); });
    $('btn-bag').addEventListener('click', () => this.openBag());
    $('bag-close').addEventListener('click', () => $('bag-view').classList.add('hidden'));
    $('bag-view').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('bag-view').classList.add('hidden'); });
    // 缶コーヒーは、タップ（クリック）ひとつでひとくち
    $('eat').addEventListener('pointerdown', (e) => {
      if (!this.eating?.tap) return;
      e.preventDefault();
      e.stopPropagation();
      this.eating.tap();
    });
  }

  get busy() { return !!this.eating; }

  _updateCount() {
    $('bag-count').textContent = this.bag.items.length || '';
  }

  _goodsButton(id, onPick, sub) {
    const item = ITEMS[id];
    const b = document.createElement('button');
    b.className = 'goods';
    const c = document.createElement('canvas');
    c.width = c.height = 144;
    drawItem(c, id, 0);
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = item.name;
    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = sub || item.desc;
    b.append(c, n, d);
    b.addEventListener('click', onPick);
    return b;
  }

  // ---------- お店 ----------
  /** shop: { type: 'bakery' | 'vending' | 'ramen', name } */
  openShop(shop) {
    if (shop.type === 'ramen') { this.eatRamen(shop); return; }
    if (shop.type === 'cafe') { this.eatIn(shop, 'waffle', 'いらっしゃいませ。窓ぎわの席へどうぞ'); return; }
    this.audio.chime && shop.type !== 'vending' && this.audio.chime();
    $('shop-title').textContent = shop.type === 'vending' ? '自販機' : shop.name;
    $('shop-note').textContent = {
      vending: 'ボタンを押すと、ガコン。持ち物に入れて、好きなときに飲めます。',
      bakery: shop.menu === 'hillBakery'
        ? '坂の途中の、小さなパン屋。窓から猫の細道が見える。選んだパンは紙袋に入れて持ち物へ。'
        : '焼きたての匂い。選んだパンは紙袋に入れて持ち物へ。歩きながらでも、ベンチでも。',
      kamaboko: '瀬戸内の魚のすり身。揚げたてを紙に包んでもらって、食べ歩きにも。',
      juice: '瀬戸内の島ごとの、しぼりたてのみかんジュース。品種で甘さと酸っぱさがちがいます。飲みくらべてみる？',
      sweets: '小さな瓶に入った、尾道のプリン。食べるときに、レモンソースをかけるか選べます。',
    }[shop.type] || '';
    const list = $('shop-list');
    list.innerHTML = '';
    MENUS[shop.menu || shop.type].forEach((id) => {
      list.appendChild(this._goodsButton(id, () => this.buy(id, shop.type)));
    });
    $('shop-view').classList.remove('hidden');
  }

  closeShop() { $('shop-view').classList.add('hidden'); }

  buy(id, type) {
    if (!this.bag.add(id)) {
      this.toast('持ち物がいっぱい。どこかで食べてから、また来よう', 3000);
      return;
    }
    if (type === 'vending') this.audio.vendDrop();
    this._updateCount();
    this.toast(`${ITEMS[id].name}を、持ち物に入れた`, 2600);
  }

  // ---------- 持ち物 ----------
  openBag() {
    const list = $('bag-list');
    list.innerHTML = '';
    this.bag.items.forEach((id, i) => {
      const verb = ['drink', 'juice'].includes(ITEMS[id].kind) ? '飲む' : '食べる';
      list.appendChild(this._goodsButton(id, () => {
        $('bag-view').classList.add('hidden');
        this.consume(i);
      }, verb));
    });
    $('bag-empty').style.display = this.bag.items.length ? 'none' : '';
    $('bag-view').classList.remove('hidden');
  }

  /** 持ち物の i 番目を食べる／飲む。歩きながらでもよい（食べ歩き） */
  consume(i) {
    if (this.eating) { this.toast('いま食べているところ', 1600); return; }
    if (ITEMS[this.bag.items[i]]?.kind === 'purin') { this._choosePurin(i); return; }
    const id = this.bag.take(i);
    this._updateCount();
    this._eat(id, false);
  }

  /** 尾道プリン：レモンソースをかけるか、かけないか */
  _choosePurin(i) {
    const id = this.bag.items[i];
    $('shop-title').textContent = ITEMS[id].name;
    $('shop-note').textContent = 'ふたを開けると、カラメルの香り。添えてあるレモンソース、どうしよう。';
    const list = $('shop-list');
    list.innerHTML = '';
    for (const lemon of [true, false]) {
      const b = this._goodsButton(id, () => {
        $('shop-view').classList.add('hidden');
        this.bag.take(i);
        this._updateCount();
        this._eat(id, false, { lemon });
      }, lemon ? 'レモンソースをかける' : 'そのまま食べる');
      drawItem(b.querySelector('canvas'), id, 0.0001, { lemon });
      list.appendChild(b);
    }
    $('shop-view').classList.remove('hidden');
  }

  // ---------- 尾道ラーメン（お店で食べる） ----------
  eatRamen(shop) { this.eatIn(shop, 'ramen', 'いらっしゃい'); }

  /** お店の中で食べる（ラーメン、喫茶店のワッフル） */
  eatIn(shop, id, greeting) {
    if (this.eating) return;
    this.audio.chime && this.audio.chime();
    this.toast(`${shop.name}　「${greeting}」`, 2600);
    setTimeout(() => this._eat(id, true), 1400);
  }

  _eat(id, big, opts = {}) {
    const item = ITEMS[id];
    const canvas = $('eat-canvas');
    const box = $('eat');
    box.classList.toggle('big', big);
    drawItem(canvas, id, 0, opts);
    const ctx = this.context();
    $('eat-text').textContent = item.kind === 'ramen' || item.kind === 'waffle' ? `${item.name}。${item.desc}` : item.kind === 'purin' ? `${item.name}${opts.lemon ? '（レモンソースがけ）' : ''}` : item.name;
    box.classList.add('show');
    const steps = item.bites;
    const interval = item.kind === 'ramen' || item.kind === 'waffle' ? 1600 : item.kind === 'drink' || item.kind === 'juice' ? 1500 : 1300;
    let k = 0;
    if (item.kind === 'drink') this.audio.canOpen();
    this.eating = { id };
    const tick = () => {
      k++;
      if (item.kind === 'ramen') this.audio.slurp();
      else if (item.kind === 'drink' || item.kind === 'juice') this.audio.sip();
      else this.audio.bite(id === 'currypan' || id === 'melonpan' || id === 'gyoroke' ? 1.3 : item.kind === 'purin' ? 0.35 : 0.8);
      drawItem(canvas, id, k / steps, opts);
      if (k < steps) {
        if (item.tap) $('eat-text').textContent = `タップでひとくち（あと${steps - k}口）`;
        else this.eating.timer = setTimeout(tick, interval * (0.85 + Math.random() * 0.3));
        return;
      }
      if (this.eating) this.eating.tap = null;
      box.classList.remove('tap');
      this.onEat(id);
      // 食べ終わり：場所や状況でひとことが変わる
      const where = ctx.seated ? 'ベンチで海を見ながら。' : ctx.walking && !big ? '歩きながら、ひとくちずつ。' : '';
      setTimeout(() => {
        box.classList.remove('show');
        this.toast(`${where}${opts.lemon && item.afterLemon ? item.afterLemon : item.after}`, 5200);
        this.eating = null;
      }, 900);
    };
    if (item.tap) {
      // プシュッと開けてから、タップのたびにひとくち
      box.classList.add('tap');
      $('eat-text').textContent = `${item.name}　タップでひとくち（あと${steps}口）`;
      let ready = false;
      this.eating.timer = setTimeout(() => { ready = true; }, 500);
      this.eating.tap = () => { if (ready && k < steps) tick(); };
    } else {
      this.eating.timer = setTimeout(tick, item.kind === 'drink' || item.kind === 'juice' ? 900 : 700);
    }
  }
}
