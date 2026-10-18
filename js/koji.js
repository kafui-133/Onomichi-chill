// 古寺めぐり：お参りしたお寺（御朱印）を覚えておく。ブラウザに保存（保存できなくても遊べる）
const KEY = 'onomichi-koji';

export class Koji {
  constructor(total) {
    this.total = total;
    this.visited = new Set();
    try { this.visited = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { /* 保存できない環境 */ }
  }
  get count() { return this.visited.size; }
  has(name) { return this.visited.has(name); }
  /** お参りする。はじめてなら true（御朱印をいただく） */
  visit(name) {
    if (this.visited.has(name)) return false;
    this.visited.add(name);
    try { localStorage.setItem(KEY, JSON.stringify([...this.visited])); } catch { /* 保存できない環境 */ }
    return true;
  }
}
