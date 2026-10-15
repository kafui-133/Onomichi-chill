// 主観視点の見渡し：ドラッグでゆるやかに首を振る（慣性つき）。ホイールで少しだけ寄る。
// 猫の上で押すと「なでる」、短く離すと「触れる」。
import * as THREE from 'three';
import { clamp, damp } from './util.js';

export class LookControls {
  constructor(camera, dom, { pickables = () => [], onPoke, onStroke, onRelease, onHover } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.yaw = 0;
    this.pitch = -0.1;
    this.targetYaw = 0;
    this.targetPitch = -0.1;
    this.fov = 55;
    this.targetFov = 55;
    this.velYaw = 0;
    this.velPitch = 0;
    this.enabled = true;
    this.lastInput = performance.now();
    this.dragging = false;
    this.petting = false;
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.pickables = pickables;
    this.cb = { onPoke, onStroke, onRelease, onHover };
    this.basePos = camera.position.clone();
    camera.rotation.order = 'YXZ';

    this.activePointer = null; // 見渡しに使っている指（2本目の指＝「歩く」ボタンなどは無視する）
    dom.addEventListener('pointerdown', (e) => this._down(e));
    dom.addEventListener('contextmenu', (e) => e.preventDefault()); // 長押しでメニューを出さない
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointercancel', (e) => this._up(e));
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetFov = clamp(this.targetFov + e.deltaY * 0.02, 32, 62);
      this.touch();
    }, { passive: false });
    this.keyLook = true; // 歩いているときは矢印キーを移動に使う
    window.addEventListener('keydown', (e) => {
      if (!this.keyLook || !this.enabled) return;
      const step = 0.25;
      if (e.key === 'ArrowLeft') this.targetYaw += step;
      if (e.key === 'ArrowRight') this.targetYaw -= step;
      if (e.key === 'ArrowUp') this.targetPitch = clamp(this.targetPitch + step * 0.5, -1.0, 0.55);
      if (e.key === 'ArrowDown') this.targetPitch = clamp(this.targetPitch - step * 0.5, -1.0, 0.55);
    });
  }

  touch() { this.lastInput = performance.now(); }
  get idleSeconds() { return (performance.now() - this.lastInput) / 1000; }

  _hit(e) {
    const r = this.dom.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.pickables(), false)[0];
  }

  _down(e) {
    if (!this.enabled || this.activePointer !== null) return;
    this.activePointer = e.pointerId;
    this.touch();
    this.dom.setPointerCapture?.(e.pointerId);
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    const hit = this._hit(e);
    if (hit) {
      this.petting = true;
      this.petTarget = hit.object;
      return;
    }
    this.dragging = true;
    this.last = { x: e.clientX, y: e.clientY };
    document.body.classList.add('dragging');
  }

  _move(e) {
    if (this.activePointer !== null && e.pointerId !== this.activePointer) return;
    if (!this.enabled) return;
    if (this.dragging) {
      this.touch();
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      const k = 0.0032 * (this.fov / 55);
      this.targetYaw += dx * k;
      this.targetPitch = clamp(this.targetPitch + dy * k * 0.85, -1.0, 0.55);
      this.velYaw = dx * k;
      this.velPitch = dy * k * 0.85;
      return;
    }
    if (this.petting) {
      this.touch();
      // なでている途中で大きく動かしたら、見渡しに切り替える
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 40) {
        this.petting = false;
        this.cb.onRelease?.(this.petTarget);
        this.dragging = true;
        this.last = { x: e.clientX, y: e.clientY };
        document.body.classList.add('dragging');
      }
      return;
    }
    if (e.target === this.dom) {
      this.cb.onHover?.(!!this._hit(e));
    }
  }

  _up(e) {
    if (e && this.activePointer !== null && e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    if (this.petting) {
      const held = performance.now() - this.downAt.t;
      if (held < 350) this.cb.onPoke?.(this.petTarget);
      this.cb.onRelease?.(this.petTarget);
    } else if (this.dragging) {
      // 手を離したあと、すこしだけ慣性で流れる
      this.targetYaw += this.velYaw * 8;
      this.targetPitch = clamp(this.targetPitch + this.velPitch * 8, -1.0, 0.55);
    }
    this.petting = false;
    this.dragging = false;
    this.velYaw = this.velPitch = 0;
    document.body.classList.remove('dragging');
  }

  /** 視線のむき（窓の外を見ている度合いの計算などに使う） */
  forward(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }

  update(dt, elapsed) {
    if (this.petting) this.cb.onStroke?.(dt, this.petTarget);
    this.yaw = damp(this.yaw, this.targetYaw, 4, dt);
    this.pitch = damp(this.pitch, this.targetPitch, 4, dt);
    this.fov = damp(this.fov, this.targetFov, 4, dt);
    // 呼吸のようなごくわずかな揺れ
    const breath = Math.sin(elapsed * 0.9);
    this.camera.rotation.set(this.pitch + breath * 0.004, this.yaw + Math.sin(elapsed * 0.37) * 0.003, 0);
    this.camera.position.set(this.basePos.x, this.basePos.y + breath * 0.006, this.basePos.z);
    // 縦長の画面（スマホの縦持ち）でも左右の見える範囲が狭くなりすぎないよう、縦の画角を広げる
    const hWant = (this.fov / 55) * 72 * (Math.PI / 180);
    const vFromH = 2 * Math.atan(Math.tan(hWant / 2) / this.camera.aspect) * (180 / Math.PI);
    const vFov = Math.min(90, Math.max(this.fov, vFromH));
    if (Math.abs(this.camera.fov - vFov) > 0.01) {
      this.camera.fov = vFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
