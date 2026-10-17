// 季節のイベント（暦）。ゲーム内の日付は実際の日付と同じなので、その時期に遊ぶとイベントに出会える。
// 新しいイベントは、ここに1件足して、見た目は js/ の各モジュール（灯りなら candles.js）で作る。
// URL の ?event=akari で、時期でなくてもイベントを見られる（確認用）。

export const EVENTS = [
  {
    id: 'akari',
    name: '尾道灯りまつり',
    // 例年10月中旬。前後の日もふくめて、灯りが並ぶようにしておく
    from: [10, 12], to: [10, 22],
    hours: [17.3, 22.6],           // 灯りがともる時刻（ゲーム内）
    note: '商店街、駅前、坂道に、ろうそくの灯りが並ぶ',
    diary: '尾道灯りまつりの日。坂道にも商店街にも、ろうそくの灯りが並んでいた。',
  },
];

const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('event') : null;

/** ゲーム内の日（1970/1/1 からの日数）から、その日の月日 */
export function dateOf(day) {
  const d = new Date(day * 86400000 + 12 * 3600000);
  return { m: d.getMonth() + 1, d: d.getDate() };
}

function inRange({ m, d }, [m0, d0], [m1, d1]) {
  const v = m * 100 + d, a = m0 * 100 + d0, b = m1 * 100 + d1;
  return a <= b ? v >= a && v <= b : v >= a || v <= b; // 年をまたぐ期間（お正月など）にも対応
}

/** その日に開かれているイベント */
export function eventsOn(day) {
  const date = dateOf(day);
  return EVENTS.filter((e) => e.id === forced || inRange(date, e.from, e.to));
}

/** イベントの灯りの強さ（0〜1）。ともる時刻の前後でなめらかに */
export function eventGlow(ev, hour) {
  const [h0, h1] = ev.hours;
  const up = Math.min(1, Math.max(0, (hour - (h0 - 0.4)) / 0.8));
  const down = Math.min(1, Math.max(0, (h1 + 0.3 - hour) / 0.6));
  return up * down;
}
