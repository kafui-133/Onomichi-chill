// 季節のイベント（暦）。ゲーム内の日付は実際の日付と同じなので、その時期に遊ぶとイベントに出会える。
// 新しいイベントは、ここに1件足して、見た目は js/ の各モジュール（灯りなら candles.js、屋台や花火なら festivals.js）で作る。
// 音のメニューの「イベント」で、時期でなくても、いつでもそのイベントの尾道に切りかえられる（URL の ?event=hanabi でも）。
//
// 日にちは、毎年の決まり（「7月の最終土曜日」など）から計算する。実際の開催日は年によって変わることがある。

/** その年の m 月の、n 番目の曜日（wd: 0=日〜6=土）。n<0 なら最後から */
function nthWeekday(y, m, wd, n) {
  if (n > 0) {
    const first = new Date(y, m - 1, 1).getDay();
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const last = new Date(y, m, 0);
  return last.getDate() - ((last.getDay() - wd + 7) % 7);
}

export const EVENTS = [
  {
    id: 'sakura',
    name: '千光寺公園さくら祭り',
    // 例年3月下旬〜4月上旬。桜の下にぼんぼりがともり、山頂のまわりに屋台が出る
    days: () => [[3, 25], [4, 10]],
    hours: [18, 22.5],
    best: 19,
    note: '千光寺公園の桜の下に、ぼんぼりがともっている',
    diary: '千光寺公園のさくら祭り。ぼんぼりの灯りで、夜の桜がほんのり明るかった。',
  },
  {
    id: 'minato',
    name: '尾道みなと祭',
    // 4月の第4土曜日と日曜日。海岸通りに屋台と万国旗、踊りの行列が通る
    days: (y) => { const d = nthWeekday(y, 4, 6, 4); return [[4, d], [4, d + 1]]; },
    hours: [9, 20],
    best: 13,
    note: '海岸通りに屋台が並び、踊りの行列が通っていく',
    diary: '尾道みなと祭の日。海岸通りに屋台が並んで、踊りの行列がにぎやかに通っていった。',
  },
  {
    id: 'hanabi',
    name: 'おのみち住吉花火まつり',
    // 7月の最終土曜日。尾道水道に浮かべた台船から、夜の19時半から1時間
    days: (y) => { const d = nthWeekday(y, 7, 6, -1); return [[7, d], [7, d]]; },
    hours: [19.5, 20.5],
    best: 19.6,
    note: '尾道水道の上に花火が上がる。海岸通りには屋台と、浴衣の人',
    diary: '住吉花火まつりの夜。尾道水道の上に花火が上がって、音が山にこだましていた。',
  },
  {
    id: 'cosplay',
    name: '仮装・コスプレ オノミチフェスタ',
    // 例年9月下旬の日曜日。駅前の芝生の広場（東御所の緑地）に、仮装した人とマルシェ
    days: (y) => { const d = nthWeekday(y, 9, 0, -1); return [[9, d], [9, d]]; },
    hours: [10, 17],
    best: 13,
    note: '駅前の芝生の広場に、思い思いの仮装をした人たちが集まっている',
    diary: '駅前で仮装の祭り。いろんな姿の人が、海を背に写真を撮りあっていた。',
  },
  {
    id: 'akari',
    name: '尾道灯りまつり',
    // 例年10月中旬（第3土曜日のあたり）。前後の日もふくめて、灯りが並ぶようにしておく
    days: () => [[10, 12], [10, 22]],
    hours: [17.3, 22.6],           // 灯りがともる時刻（ゲーム内）
    best: 18.5,
    note: '商店街、駅前、坂道に、ろうそくの灯りが並ぶ',
    diary: '尾道灯りまつりの日。坂道にも商店街にも、ろうそくの灯りが並んでいた。',
  },
  {
    id: 'beccha',
    name: 'ベッチャー祭り',
    // 11月1日〜3日。吉備津彦神社（一宮神社）の祭り。面をつけた鬼（ソバ・ベタ・ショーキー）が町を歩き、
    // 祝い棒とササラで人をたたく（たたかれると、一年を元気にすごせるという）。神輿も通る
    days: () => [[11, 1], [11, 3]],
    hours: [9, 17],
    best: 11,
    note: '面をつけた鬼が、祝い棒とササラを手に商店街を歩いている',
    diary: 'ベッチャー祭り。商店街で鬼に祝い棒でたたかれた。これで一年、元気でいられるらしい。',
  },
];

// いつでも見られるように：音のメニューで選んだイベント（保存しておく）。URL の ?event= が優先
const urlEvent = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('event') : null;
let forced = urlEvent || (() => { try { return localStorage.getItem('onomichi-event') || null; } catch { return null; } })();
/** 選んだイベント（null = 暦どおり） */
export function forcedEvent() { return forced; }
export function setForcedEvent(id) {
  forced = id || null;
  try { if (forced) localStorage.setItem('onomichi-event', forced); else localStorage.removeItem('onomichi-event'); } catch { /* ignore */ }
}

/** ゲーム内の日（1970/1/1 からの日数）から、その日の年月日 */
export function dateOf(day) {
  const d = new Date(day * 86400000 + 12 * 3600000);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

function inRange({ m, d }, [m0, d0], [m1, d1]) {
  const v = m * 100 + d, a = m0 * 100 + d0, b = m1 * 100 + d1;
  return a <= b ? v >= a && v <= b : v >= a || v <= b; // 年をまたぐ期間（お正月など）にも対応
}

/** その日に開かれているイベント。イベントを選んでいるときは、そのイベントだけ */
export function eventsOn(day) {
  if (forced) return EVENTS.filter((e) => e.id === forced);
  const date = dateOf(day);
  return EVENTS.filter((e) => { const [a, b] = e.days(date.y); return inRange(date, a, b); });
}

/** その年の開催日（表示用、例：「7月25日」） */
export function whenLabel(ev, y) {
  const [[m0, d0], [m1, d1]] = ev.days(y);
  return m0 === m1 && d0 === d1 ? `${m0}月${d0}日` : m0 === m1 ? `${m0}月${d0}日〜${d1}日` : `${m0}月${d0}日〜${m1}月${d1}日`;
}

/** イベントの灯りの強さ（0〜1）。ともる時刻の前後でなめらかに */
export function eventGlow(ev, hour) {
  const [h0, h1] = ev.hours;
  const up = Math.min(1, Math.max(0, (hour - (h0 - 0.4)) / 0.8));
  const down = Math.min(1, Math.max(0, (h1 + 0.3 - hour) / 0.6));
  return up * down;
}
