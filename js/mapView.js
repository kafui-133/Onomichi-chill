// 手帳の地図：実データ（OpenStreetMap＋国土地理院の標高）から、海・陸・道・線路・名所を描く。
// 名所の印か名前を押すと、その場所へ移動できる。
import { drawCatFace } from './zukan.js';
import { DATA, SEA_Y, ROADS, OTHER_ROADS, RAILS, PLACES, ARCADE_ROADS, FERRY_PIERS, ATTRIBUTION, KOJI } from './townMap.js';

// 表示する範囲（尾道駅〜長江口、尾道水道まで）。西を左に描く
const X_WEST = 640, X_EAST = -720;
const Z_NORTH = 270, Z_SOUTH = -760;

const STYLE = {
  stone: { color: '#8a6a4a', dash: [3, 2], min: 1.2 },
  tile: { color: '#b07038', dash: [], min: 2 },
  asphalt: { color: '#8d8f94', dash: [], min: 1.4 },
};

/** 標高から陸と海の下絵を1回だけ作る */
function baseImage() {
  const { nx, nz, b64 } = DATA.dem;
  const c = document.createElement('canvas');
  c.width = nx;
  c.height = nz;
  const g = c.getContext('2d');
  const img = g.createImageData(nx, nz);
  const bin = atob(b64);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const v = ((bin.charCodeAt(k * 2) | (bin.charCodeAt(k * 2 + 1) << 8)) << 16 >> 16) / 10;
      const above = v - SEA_Y;
      // 画像は左が西（x が大きい）、上が北（z が大きい）
      const px = (nx - 1 - i), py = (nz - 1 - j);
      const o = (py * nx + px) * 4;
      if (above < 0.3) { img.data[o] = 201; img.data[o + 1] = 219; img.data[o + 2] = 224; }
      else {
        const t = Math.min(1, above / 140);
        img.data[o] = 241 - t * 60; img.data[o + 1] = 234 - t * 40; img.data[o + 2] = 219 - t * 80;
      }
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export class MapView {
  constructor({ canvas, list, onTravel, cats, onVisitCat, koji }) {
    this.canvas = canvas;
    this.koji = koji;
    this.onTravel = onTravel;
    this.cats = cats || (() => []);
    this.onVisitCat = onVisitCat;
    this.list = list;
    this.faces = new Map();
    this.player = { x: 0, z: 0, yaw: 0 };
    this.markers = [];
    this.base = null;
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (canvas.width / r.width);
      const my = (e.clientY - r.top) * (canvas.height / r.height);
      const hit = this.markers.find((m) => Math.hypot(m.sx - mx, m.sy - my) < 16 * this.dpr);
      if (hit?.cat) this.onVisitCat(hit.cat);
      else if (hit) this.onTravel(hit.place);
    });
    list.innerHTML = '';
    PLACES.forEach((p) => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.addEventListener('click', () => this.onTravel(p));
      list.appendChild(b);
    });
  }

  /** 描いて、現在地の画面上の x（CSS px）を返す */
  draw(player) {
    if (player) this.player = player;
    if (!this.base) this.base = baseImage();
    const spanX = X_WEST - X_EAST, spanZ = Z_NORTH - Z_SOUTH;
    // スマホでは画面より広く描いて横にスクロール
    const cssW = Math.max(760, Math.min(1000, window.innerWidth - 32, (window.innerHeight - 230) * (spanX / spanZ)));
    const k = cssW / spanX;
    const cssH = spanZ * k;
    const dpr = (this.dpr = Math.min(2, window.devicePixelRatio || 1));
    const c = this.canvas;
    c.width = cssW * dpr;
    c.height = cssH * dpr;
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = (x) => (X_WEST - x) * k;
    const sy = (z) => (Z_NORTH - z) * k;

    // 下絵（DEM のグリッドを地図の範囲に合わせて貼る）
    const { x0, z0, step, nx, nz } = DATA.dem;
    const xw = x0 + (nx - 1) * step, zn = z0 + (nz - 1) * step;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, sx(xw), sy(zn), (xw - x0) * k, (zn - z0) * k);

    // 道（見えるだけの道は細く薄く）
    const drawRoad = (road, alpha) => {
      const st = STYLE[road.surface];
      g.globalAlpha = alpha;
      g.strokeStyle = road.covered ? '#c0602a' : st.color;
      g.lineWidth = Math.max(st.min, road.width * k * 1.1);
      g.setLineDash(st.dash);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      road.pts.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z))));
      g.stroke();
    };
    OTHER_ROADS.forEach((r) => drawRoad(r, 0.35));
    ROADS.forEach((r) => drawRoad(r, 1));
    g.globalAlpha = 1;
    g.setLineDash([]);

    // 線路
    for (const rail of RAILS) {
      for (const [w, col, dash] of [[3, '#3a3a3a', []], [1.6, '#f1eadb', [5, 5]]]) {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.setLineDash(dash);
        g.beginPath();
        rail.pts.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z))));
        g.stroke();
      }
    }
    g.setLineDash([]);

    // 名前
    g.font = '11px "Shippori Mincho", serif';
    g.textAlign = 'center';
    g.fillStyle = '#6a3a1a';
    for (const r of ARCADE_ROADS) {
      if (!r.name) continue;
      const m = r.pts[Math.floor(r.pts.length / 2)];
      g.fillText(r.name, sx(m[0]), sy(m[1]) + 14);
    }
    g.fillStyle = '#4a6a76';
    g.font = '13px "Shippori Mincho", serif';
    g.fillText('尾道水道', sx(-60), sy(-500));
    g.font = '11px "Shippori Mincho", serif';
    g.fillText('向島', sx(150), sy(-735));
    FERRY_PIERS.forEach((p) => g.fillText('渡船', sx(p.x), sy(p.z) + 14));

    // 古寺めぐりの道（点線）と、お寺の印（お参りしたお寺は朱の印）
    g.save();
    g.strokeStyle = 'rgba(168,58,40,0.75)';
    g.lineWidth = 2;
    g.setLineDash([4, 4]);
    for (const t of KOJI) {
      if (t.route.length < 2) continue;
      g.beginPath();
      t.route.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z))));
      g.stroke();
    }
    g.restore();
    for (const t of KOJI) {
      const x = sx(t.x), y = sy(t.z), done = this.koji?.has(t.name);
      g.fillStyle = done ? '#b83a2a' : '#f6f0e4';
      g.strokeStyle = '#8a2a1e';
      g.lineWidth = 1.5;
      g.beginPath(); g.rect(x - 4, y - 4, 8, 8); g.fill(); g.stroke();
    }
    if (this.koji) {
      g.fillStyle = '#8a2a1e';
      g.font = '12px "Shippori Mincho", serif';
      g.textAlign = 'left';
      g.fillText(`古寺めぐり　${this.koji.count} / ${this.koji.total}`, 12, 22);
    }

    // 名所の印
    this.markers = [];
    g.textAlign = 'left';
    PLACES.forEach((p) => {
      const x = sx(p.x), y = sy(p.z);
      g.fillStyle = '#f1eadb';
      g.strokeStyle = '#2a2420';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
      this.markers.push({ sx: x * dpr, sy: y * dpr, place: p });
    });
    g.fillStyle = '#2a2420';
    g.font = '12px "Shippori Mincho", serif';
    g.fillText('空き家', sx(0) + 8, sy(4) - 6);

    // すっかり懐いた猫の居場所（押すと会いにいける）
    const friends = this.cats();
    g.font = '11px "Shippori Mincho", serif';
    for (const e of friends) {
      const p = e.cat.root.position;
      const x = sx(p.x), y = sy(p.z);
      if (!this.faces.has(e.coat)) {
        const fc = document.createElement('canvas');
        fc.width = fc.height = 64;
        drawCatFace(fc, e.coat);
        this.faces.set(e.coat, fc);
      }
      g.fillStyle = 'rgba(244,239,230,0.92)';
      g.strokeStyle = '#c0602a';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill(); g.stroke();
      g.drawImage(this.faces.get(e.coat), x - 11, y - 12, 22, 22);
      g.fillStyle = '#7a3a1a';
      g.fillText(e.name, x + 15, y + 4);
      this.markers.push({ sx: x * dpr, sy: y * dpr, cat: e });
    }
    // 名前の一覧にも、猫に会いにいくボタン
    this.list.querySelectorAll('.cat-go').forEach((b) => b.remove());
    for (const e of friends) {
      const b = document.createElement('button');
      b.className = 'cat-go';
      b.textContent = `🐾 ${e.name}`;
      b.addEventListener('click', () => this.onVisitCat(e));
      this.list.appendChild(b);
    }

    // 出典
    g.font = '9px sans-serif';
    g.fillStyle = 'rgba(40,40,40,0.75)';
    g.textAlign = 'right';
    g.fillText(ATTRIBUTION, cssW - 6, cssH - 6);

    // 現在地（yaw=0 は南、yaw が増えると東を向く）
    const px = sx(this.player.x), py = sy(this.player.z);
    g.save();
    g.translate(px, py);
    g.rotate(Math.PI - this.player.yaw);
    g.fillStyle = '#c23a2a';
    g.beginPath(); g.moveTo(0, -10); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill();
    g.restore();
    return px;
  }
}
