// 町歩き：道の上だけを歩ける一人称の移動。
//   W / ↑ 前へ　S / ↓ うしろへ　A・D 横へ　← → 向きを変える　（画面の「歩く」ボタン長押しでも前へ）
import { clampToRoads, walkable, surfaceY, surfaceAt, upperAt, HOUSE_DOOR, BENCHES } from './townMap.js';
import { damp } from './util.js';

const EYE = 1.55;
const EYE_CROUCH = 0.68; // しゃがんだときの目の高さ
const SPEED = 1.8;      // ゆっくり歩く（m/s）
const STRIDE = 0.68;    // 足音の間隔（m）

export class Walker {
  constructor(controls) {
    this.controls = controls;
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.enabled = false;
    this.paused = false;
    this.keys = new Set();
    this.touchForward = false;
    this.seat = null;
    this.crouching = false;
    this.stepDist = 0;
    this.bobPhase = 0;
    this.moving = 0;
    this.onStep = null;
    this.upper = null;   // 歩道橋・駅のテラスなど、上の階にいるときの足もとの高さ

    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea')) return; // 日記を書いているあいだは操作しない
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  enter(x, z, yaw, pitch = -0.04) {
    const p = walkable(x, z) ? { x, z } : clampToRoads(x, z);
    this.x = p.x;
    this.z = p.z;
    this.vx = this.vz = 0;
    this.seat = null;
    this.upper = null;
    this.crouching = false;
    this.enabled = true;
    this.controls.keyLook = false;
    this.controls.yaw = this.controls.targetYaw = yaw;
    this.controls.pitch = this.controls.targetPitch = pitch;
    this._place(0);
  }

  exit() {
    this.enabled = false;
    this.seat = null;
    this.keys.clear();
    this.controls.keyLook = true;
  }

  sit(bench) {
    this.seat = bench;
    // ベンチの向き（海の方）を、いまの向きからいちばん近い回り方で向く
    const c = this.controls;
    c.targetYaw = c.yaw + ((((bench.yaw - c.yaw) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    c.targetPitch = -0.06;
  }

  /** しゃがむ／立ちあがる。しゃがんでいるあいだは歩かず、見回すだけ */
  setCrouch(on) {
    this.crouching = on;
    this.vx = this.vz = 0;
    if (on) this.controls.targetPitch = Math.min(this.controls.targetPitch, -0.28);
    else this.controls.targetPitch = Math.max(this.controls.targetPitch, -0.06);
  }

  stand() {
    if (!this.seat) return;
    // ベンチの後ろ（陸側）の道に立つ
    const p = clampToRoads(this.seat.x + Math.sin(this.seat.yaw) * 1.2, this.seat.z + Math.cos(this.seat.yaw) * 1.2);
    this.x = p.x;
    this.z = p.z;
    this.seat = null;
    this.upper = null;
  }

  nearDoor() {
    return Math.hypot(this.x - HOUSE_DOOR.x, this.z - HOUSE_DOOR.z) < 2.2;
  }

  nearBench() {
    return BENCHES.find((b) => Math.hypot(this.x - b.x, this.z - b.z) < 2.2) || null;
  }

  _place(dt) {
    const bob = Math.sin(this.bobPhase) * 0.035 * this.moving;
    const y = (this.upper ?? surfaceY(this.x, this.z)) + (this.crouching ? EYE_CROUCH : EYE) + bob;
    const base = this.controls.basePos;
    // 石段の上り下りで視点がガクガクしないように、高さだけなめらかにする
    base.y = dt > 0 ? damp(base.y, y, 12, dt) : y;
    base.x = this.x;
    base.z = this.z;
  }

  /** (x, z) へ進めるか。進めるなら、そこでの上の階の高さ（地面なら null）を返す */
  _step(x, z) {
    if (this.upper != null) {
      const u = upperAt(x, z, this.upper);
      if (u && Math.abs(u.y - this.upper) < 0.6) return { upper: u.y };
      // 階段を降りきったところから、地面へ
      if (this.upper - surfaceY(x, z) < 0.3 && walkable(x, z)) return { upper: null };
      return null;   // 手すりの外へは出ない
    }
    const g = surfaceY(x, z);
    const u = upperAt(x, z, g);
    if (u && u.stair) return Math.abs(u.y - g) < 0.3 ? { upper: u.y } : null;   // 階段の下の段から上の階へ。階段の横・下はくぐれない
    return walkable(x, z) ? { upper: null } : null;
  }

  update(dt) {
    if (!this.enabled) return;
    const c = this.controls;
    if (this.seat) {
      c.basePos.set(this.seat.x, this.seat.y + 1.12, this.seat.z);
      return;
    }
    const k = this.keys;
    if (!this.paused) {
      if (k.has('ArrowLeft') || k.has('KeyQ')) c.targetYaw += 1.5 * dt;
      if (k.has('ArrowRight')) c.targetYaw -= 1.5 * dt;
    }
    let f = 0, s = 0;
    if (!this.paused && !this.crouching) {
      if (k.has('KeyW') || k.has('ArrowUp') || this.touchForward) f += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
      if (k.has('KeyD')) s += 1;
      if (k.has('KeyA')) s -= 1;
    }
    const yaw = c.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let tx = fx * f + rx * s, tz = fz * f + rz * s;
    const len = Math.hypot(tx, tz);
    if (len > 0) { tx /= len; tz /= len; }
    this.vx = damp(this.vx, tx * SPEED, 6, dt);
    this.vz = damp(this.vz, tz * SPEED, 6, dt);

    const prevX = this.x, prevZ = this.z;
    // 進めるならそのまま、ぶつかるなら壁ぞいに滑らせる、どちらも無理なら道の端に寄せる
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const go = (x, z) => {
      const st = this._step(x, z);
      if (!st) return false;
      this.x = x; this.z = z; this.upper = st.upper;
      return true;
    };
    if (go(nx, nz) || go(nx, this.z) || go(this.x, nz)) { /* 進めた */ }
    else if (this.upper == null) {
      const p = clampToRoads(nx, nz);
      if (Math.hypot(p.x - this.x, p.z - this.z) < 0.6) { this.x = p.x; this.z = p.z; }
    }
    const moved = Math.hypot(this.x - prevX, this.z - prevZ);
    this.moving = damp(this.moving, moved / dt > 0.3 ? 1 : 0, 8, dt);
    this.bobPhase += moved * (Math.PI * 2 / (STRIDE * 2)) * 2;
    this.stepDist += moved;
    if (this.stepDist > STRIDE) {
      this.stepDist = 0;
      this.onStep?.(surfaceAt(this.x, this.z));
    }
    if (moved > 0) c.touch();
    this._place(dt);
  }
}
