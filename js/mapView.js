// 手帳の地図：道のつながりと名所を描き、行きたい場所を選ぶと移動できる。
import { ROADS, PLACES, QUAY_Z, RAIL_Z, ARCADE_SECTIONS, ARCADE_Z, FERRY_PIERS } from './townMap.js';

const X_WEST = 530, X_EAST = -660;   // 西（尾道駅）を左に
const Z_NORTH = 60, Z_SOUTH = -245;

const STYLE = {
  stone: { color: '#8a6a4a', dash: [4, 3] },
  tile: { color: '#b0773e', dash: [] },
  asphalt: { color: '#7d7f84', dash: [] },
};

export class MapView {
  constructor({ canvas, list, onTravel }) {
    this.canvas = canvas;
    this.list = list;
    this.onTravel = onTravel;
    this.player = { x: 0, z: 0, yaw: 0 };
    this.markers = [];
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (canvas.width / r.width);
      const my = (e.clientY - r.top) * (canvas.height / r.height);
      const hit = this.markers.find((m) => Math.hypot(m.sx - mx, m.sy - my) < 16 * this.dpr);
      if (hit) this.onTravel(hit.place);
    });
    list.innerHTML = '';
    PLACES.forEach((p) => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.addEventListener('click', () => this.onTravel(p));
      list.appendChild(b);
    });
  }

  draw(player) {
    if (player) this.player = player;
    const cssW = Math.min(980, window.innerWidth - 32);
    const k = cssW / (X_WEST - X_EAST);
    const cssH = (Z_NORTH - Z_SOUTH) * k;
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

    // 紙・山・海
    g.fillStyle = '#f1eadb';
    g.fillRect(0, 0, cssW, cssH);
    const hill = g.createLinearGradient(0, 0, 0, sy(RAIL_Z));
    hill.addColorStop(0, 'rgba(110,130,90,0.35)');
    hill.addColorStop(1, 'rgba(110,130,90,0.08)');
    g.fillStyle = hill;
    g.fillRect(0, 0, cssW, sy(RAIL_Z - 3));
    g.fillStyle = '#c9dbe0';
    g.fillRect(0, sy(QUAY_Z), cssW, cssH - sy(QUAY_Z));
    g.fillStyle = '#5a7a86';
    g.font = `${13}px "Shippori Mincho", serif`;
    g.textAlign = 'left';
    g.fillText('尾道水道　（この先、向島）', sx(300), sy(QUAY_Z) + 17);

    // 線路
    g.strokeStyle = '#3a3a3a';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, sy(RAIL_Z)); g.lineTo(cssW, sy(RAIL_Z)); g.stroke();
    g.strokeStyle = '#f1eadb';
    g.lineWidth = 1.6;
    g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(0, sy(RAIL_Z)); g.lineTo(cssW, sy(RAIL_Z)); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#3a3a3a';
    g.font = '11px "Shippori Mincho", serif';
    g.fillText('JR山陽本線', sx(-520), sy(RAIL_Z) - 5);

    // 道
    for (const road of ROADS) {
      const st = STYLE[road.surface];
      g.strokeStyle = road.id === 'arcade' ? '#c0602a' : st.color;
      g.lineWidth = Math.max(2, road.width * k * 1.2);
      g.setLineDash(st.dash);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      road.pts.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z))));
      g.stroke();
    }
    g.setLineDash([]);

    // 通りの名前
    g.fillStyle = '#6a3a1a';
    g.font = '11px "Shippori Mincho", serif';
    g.textAlign = 'center';
    ARCADE_SECTIONS.forEach((s) => g.fillText(s.name, sx((s.x0 + s.x1) / 2), sy(ARCADE_Z) + 13));
    g.fillStyle = '#555';
    g.fillText('国道2号', sx(-560), sy(-170) - 4);
    g.fillText('海岸通り', sx(-560), sy(-213.5) - 5);
    FERRY_PIERS.forEach((x) => { g.fillText('渡船', sx(x), sy(QUAY_Z) + 13); });
    g.fillStyle = '#5a4a2a';
    g.fillText('千光寺新道', sx(48) + 30, sy(-100));
    g.fillText('猫の細道', sx(-80), sy(-104));

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
    // 空き家
    g.fillStyle = '#2a2420';
    g.font = '12px "Shippori Mincho", serif';
    g.fillText('空き家', sx(-4) + 8, sy(2) - 6);

    // 現在地
    const px = sx(this.player.x), py = sy(this.player.z);
    g.save();
    g.translate(px, py);
    // yaw=0 は南（下）、yaw が増えると東（右）を向く
    g.rotate(Math.PI - this.player.yaw);
    g.fillStyle = '#c23a2a';
    g.beginPath(); g.moveTo(0, -10); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill();
    g.restore();
  }
}
