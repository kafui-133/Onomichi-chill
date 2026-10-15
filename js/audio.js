// 環境音（ASMR）エンジン：音源ファイルを使わず、Web Audio API ですべて合成する。
//
//   [外の音バス]  波のチャプチャプ / 風 / 船の引き波 / トンビ / スズメ / 鈴虫 / お寺の鐘 / 踏切 / 汽笛 / ポンポン船
//   [内の音バス]  部屋の静けさ / 柱時計 / 風鈴（＋部屋鳴りのリバーブ） / 猫のゴロゴロ・鳴き声
//
// 視線が窓の外を向くほど外の音が大きく、部屋の中を向くと内の音が前に出る。
// 「目を閉じる」と両方が開き、全体が少しだけ近くなる。
import { clamp, rand, smoothstep } from './util.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.timers = {};
    this.state = { outside: 1, hour: 17, night: 0, eyesClosed: false, yaw: 0, wind: 0 };
    this.wind = 0;          // 突風の強さ（演出側にも共有）
    this.windTarget = 0;
    this.lastHour = null;
  }

  async start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new Ctx());
    if (ctx.state === 'suspended') await ctx.resume();
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 2.5);

    this.outside = ctx.createGain();
    this.inside = ctx.createGain();
    this.outside.connect(this.master);
    this.inside.connect(this.master);

    // 部屋鳴り（簡易リバーブ）
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.8, 2.5);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.inside);

    this.noise = {
      white: this._noiseBuffer('white'),
      pink: this._noiseBuffer('pink'),
      brown: this._noiseBuffer('brown'),
    };

    this._buildBeds();
    this._resetTimers();
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.4);
  }

  // ---------- ユーティリティ ----------
  _noiseBuffer(type) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') d[i] = w;
      else if (type === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _loop(buffer, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * 3);
    return s;
  }

  /** 方角（ワールドのxz方向）→ ステレオ位置 */
  _pan(dirX, dirZ) {
    const yaw = this.state.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw); // カメラの右方向
    const len = Math.hypot(dirX, dirZ) || 1;
    return clamp((dirX * rx + dirZ * rz) / len, -1, 1) * 0.85;
  }

  _panner(pan, dest) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(dest);
    return p;
  }

  _noiseBurst({ type = 'white', freq = 800, q = 1, filter = 'bandpass', gain = 0.2, attack = 0.02, decay = 0.4, when = 0, pan = 0, dest = this.outside, rate = 1 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise[type];
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this._panner(pan, dest));
    src.start(t, Math.random() * 3);
    src.stop(t + attack + decay + 0.1);
    return { f, g, t };
  }

  _tone({ type = 'sine', freq = 440, gain = 0.1, attack = 0.005, decay = 1, when = 0, pan = 0, dest = this.outside, detune = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(this._panner(pan, dest));
    o.start(t);
    o.stop(t + attack + decay + 0.05);
    return { o, g, t };
  }

  // ---------- 常時鳴っている音（ベッド） ----------
  _buildBeds() {
    const ctx = this.ctx;

    // 波（低いうねり）
    const sea = this._loop(this.noise.brown, 0.8);
    const seaLP = ctx.createBiquadFilter();
    seaLP.type = 'lowpass';
    seaLP.frequency.value = 520;
    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0.18;
    sea.connect(seaLP).connect(this.seaGain).connect(this.outside);
    this.seaLP = seaLP;

    // 風
    const wind = this._loop(this.noise.pink, 1);
    this.windBP = ctx.createBiquadFilter();
    this.windBP.type = 'bandpass';
    this.windBP.frequency.value = 500;
    this.windBP.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    wind.connect(this.windBP).connect(this.windGain).connect(this.outside);
    // 風が軒を抜ける高い音
    const whistle = this._loop(this.noise.white, 1);
    this.whistleBP = ctx.createBiquadFilter();
    this.whistleBP.type = 'bandpass';
    this.whistleBP.frequency.value = 1800;
    this.whistleBP.Q.value = 6;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    whistle.connect(this.whistleBP).connect(this.whistleGain).connect(this.outside);

    // 遠い街のざわめき
    const city = this._loop(this.noise.brown, 1.3);
    const cityLP = ctx.createBiquadFilter();
    cityLP.type = 'lowpass';
    cityLP.frequency.value = 220;
    this.cityGain = ctx.createGain();
    this.cityGain.gain.value = 0.03;
    city.connect(cityLP).connect(this.cityGain).connect(this.outside);

    // 部屋の静けさ（ルームトーン）
    const room = this._loop(this.noise.brown, 0.5);
    const roomLP = ctx.createBiquadFilter();
    roomLP.type = 'lowpass';
    roomLP.frequency.value = 140;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.05;
    room.connect(roomLP).connect(roomGain).connect(this.inside);

    // 猫のゴロゴロ（低いパルスで振幅変調したノイズ）
    const purrSrc = this._loop(this.noise.brown, 1);
    const purrLP = ctx.createBiquadFilter();
    purrLP.type = 'lowpass';
    purrLP.frequency.value = 260;
    const purrAM = ctx.createGain();
    purrAM.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 26;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(purrAM.gain);
    lfo.start();
    this.purrGain = ctx.createGain();
    this.purrGain.gain.value = 0;
    this.purrPan = ctx.createStereoPanner();
    purrSrc.connect(purrLP).connect(purrAM).connect(this.purrGain).connect(this.purrPan).connect(this.inside);
  }

  _resetTimers() {
    this.timers = { lap: 0.5, gust: rand(4, 10), fuurin: rand(3, 8), bird: rand(2, 6), kite: rand(15, 40), cricket: 0.5, tick: 0, fumikiri: rand(40, 90), horn: rand(30, 80), bell: rand(60, 140), pompon: 0 };
    this.tickTock = 0;
  }

  // ---------- 毎フレーム ----------
  update(dt, s) {
    if (!this.started) return;
    Object.assign(this.state, s);
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const st = this.state;
    const day = 1 - st.night;

    // 視線による内外のミックス
    const out = st.eyesClosed ? 1 : 0.32 + 0.68 * st.outside;
    const inn = st.eyesClosed ? 1 : 1 - 0.55 * st.outside;
    this.outside.gain.setTargetAtTime(out * (st.eyesClosed ? 1.25 : 1), now, 0.4);
    this.inside.gain.setTargetAtTime(inn * (st.eyesClosed ? 1.2 : 1), now, 0.4);

    // 風と突風
    this.windTarget = Math.max(0, this.windTarget - dt * 0.12);
    this.wind += (this.windTarget - this.wind) * (1 - Math.exp(-dt * 1.5));
    const swell = 0.5 + 0.5 * Math.sin(now * 0.13) * Math.sin(now * 0.071 + 1);
    this.windGain.gain.setTargetAtTime(0.03 + swell * 0.03 + this.wind * 0.12, now, 0.3);
    this.windBP.frequency.setTargetAtTime(380 + swell * 250 + this.wind * 400, now, 0.5);
    this.whistleGain.gain.setTargetAtTime(this.wind * this.wind * 0.012, now, 0.5);

    // 波のうねり
    const waveSwell = 0.5 + 0.5 * Math.sin(now * 0.4) * Math.sin(now * 0.23 + 2);
    this.seaGain.gain.setTargetAtTime(0.1 + waveSwell * 0.12, now, 0.6);
    this.seaLP.frequency.setTargetAtTime(380 + waveSwell * 380, now, 0.6);
    this.cityGain.gain.setTargetAtTime(0.012 + day * 0.03, now, 1);

    // ---- 不定期なイベント ----
    const T = this.timers;
    const tick = (name, fn, next) => {
      T[name] -= dt;
      if (T[name] <= 0) { fn(); T[name] = next(); }
    };

    tick('lap', () => this.lap(0.5 + Math.random() * 0.5), () => rand(0.5, 2.2));
    tick('gust', () => this.gust(), () => rand(9, 26));
    tick('fuurin', () => { if (this.wind > 0.15 || Math.random() < 0.3) this.fuurin(0.4 + this.wind * 0.6); }, () => rand(2.5, 9) * (1.2 - this.wind));

    // 時刻で変わる生き物の音
    const h = st.hour;
    const morning = smoothstep(5.5, 6.5, h) * (1 - smoothstep(9.5, 11, h));
    tick('bird', () => { if (Math.random() < morning * 0.9 + day * 0.15) this.sparrow(); }, () => rand(1.5, 6));
    tick('kite', () => { if (h > 7 && h < 17.5) this.tonbi(); }, () => rand(25, 60));
    tick('cricket', () => { if (st.night > 0.35) this.cricket(st.night); }, () => rand(0.35, 1.1));
    tick('fumikiri', () => { if (h > 6 && h < 23) this.fumikiri(); }, () => rand(70, 150));
    tick('horn', () => this.horn(), () => rand(60, 140));
    tick('bell', () => { if (h > 16 || h < 7) this.templeBell(); }, () => rand(120, 260));

    // 夕方6時と朝6時、お寺の鐘
    if (this.lastHour !== null) {
      for (const ring of [6, 18]) {
        if (this.lastHour < ring && h >= ring && h - this.lastHour < 1) this.templeBell(true);
      }
    }
    this.lastHour = h;

    // 柱時計（部屋の中で静かに）
    T.tick -= dt;
    if (T.tick <= 0) {
      T.tick += 1;
      this.tickTock ^= 1;
      this._noiseBurst({ type: 'white', freq: this.tickTock ? 3200 : 2600, q: 8, gain: 0.025, attack: 0.001, decay: 0.04, pan: 0.6 * this._pan(1, 0) / 0.85, dest: this.inside });
    }

    // ポンポン船（近くの漁船のエンジン音）
    if (s.fishing && s.fishing.d < 500) {
      T.pompon -= dt;
      if (T.pompon <= 0) {
        T.pompon = 0.22;
        const g = 0.06 * (1 - s.fishing.d / 500);
        const pan = this._pan(s.fishing.boat.x, s.fishing.boat.z);
        this._noiseBurst({ type: 'brown', freq: 180, q: 2, filter: 'lowpass', gain: g, attack: 0.005, decay: 0.12, pan });
      }
    }

    // 猫のゴロゴロ
    const purr = s.purr || 0;
    this.purrGain.gain.setTargetAtTime(purr * 0.45, now, 0.3);
    if (s.catDir) this.purrPan.pan.setTargetAtTime(this._pan(s.catDir.x, s.catDir.z) * 0.6, now, 0.2);
  }

  // ---------- 音のパーツ ----------

  /** 波のチャプチャプ */
  lap(strength = 0.6, when = 0) {
    if (!this.started) return;
    const pan = (Math.random() - 0.5) * 0.8;
    this._noiseBurst({ type: 'pink', freq: rand(300, 700), q: 0.9, gain: 0.12 * strength, attack: rand(0.04, 0.12), decay: rand(0.3, 0.7), when, pan });
    // 泡のはじける小さな音
    for (let i = 0; i < 3; i++) {
      this._noiseBurst({ type: 'white', freq: rand(1200, 2600), q: 4, gain: 0.03 * strength, attack: 0.005, decay: rand(0.05, 0.15), when: when + 0.1 + Math.random() * 0.35, pan: pan + (Math.random() - 0.5) * 0.3 });
    }
  }

  /** 船の引き波が、少し遅れて岸に届く */
  wake(distance, dirX, dirZ) {
    if (!this.started) return;
    const delay = 4 + distance / 40;
    const n = 6 + Math.floor(Math.random() * 3);
    const pan = this._pan(dirX, dirZ) * 0.5;
    for (let i = 0; i < n; i++) {
      const env = Math.sin(((i + 0.5) / n) * Math.PI);
      const t = delay + i * rand(1.0, 1.6);
      this._noiseBurst({ type: 'pink', freq: rand(250, 520), q: 0.7, gain: 0.25 * env, attack: rand(0.12, 0.25), decay: rand(0.8, 1.4), when: t, pan });
      for (let k = 0; k < 4; k++) {
        this._noiseBurst({ type: 'white', freq: rand(1500, 3200), q: 3, gain: 0.04 * env, attack: 0.004, decay: rand(0.06, 0.18), when: t + 0.25 + Math.random() * 0.6, pan: pan + (Math.random() - 0.5) * 0.5 });
      }
    }
    return delay;
  }

  gust() {
    this.windTarget = rand(0.5, 1);
  }

  /** 風鈴：高い倍音が長く残る */
  fuurin(strength = 0.6) {
    if (!this.started) return;
    const f0 = rand(2350, 2650);
    const pan = this._pan(1, -1) * 0.6;
    const partials = [[1, 1], [2.76, 0.4], [5.4, 0.18], [8.93, 0.08]];
    const hits = Math.random() < 0.5 ? 1 : 2;
    for (let h = 0; h < hits; h++) {
      const when = h * rand(0.12, 0.3);
      partials.forEach(([ratio, amp]) => {
        const node = this._tone({ freq: f0 * ratio, gain: 0.05 * amp * strength, attack: 0.002, decay: rand(1.6, 3.2) / Math.sqrt(ratio), when, pan, dest: this.inside });
        node.g.connect(this.reverbSend);
      });
      this._noiseBurst({ type: 'white', freq: 6000, q: 2, gain: 0.02 * strength, attack: 0.001, decay: 0.03, when, pan, dest: this.inside });
    }
  }

  /** スズメのチュンチュン */
  sparrow() {
    const pan = (Math.random() - 0.5) * 1.4;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const when = i * rand(0.12, 0.22);
      const t = this.ctx.currentTime + when;
      const node = this._tone({ freq: 3600, gain: 0.025, attack: 0.005, decay: 0.07, when, pan });
      node.o.frequency.setValueAtTime(rand(3200, 3800), t);
      node.o.frequency.exponentialRampToValueAtTime(rand(4400, 5200), t + 0.05);
    }
  }

  /** トンビの「ピーヒョロロ」 */
  tonbi() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pan = (Math.random() - 0.5) * 1.2;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const vib = ctx.createOscillator();
    vib.frequency.value = 9;
    const vibG = ctx.createGain();
    vibG.gain.setValueAtTime(0, t);
    vib.connect(vibG).connect(o.frequency);
    const g = ctx.createGain();
    o.frequency.setValueAtTime(1900, t);
    o.frequency.linearRampToValueAtTime(2500, t + 0.45);
    o.frequency.linearRampToValueAtTime(2350, t + 0.7);
    o.frequency.linearRampToValueAtTime(1600, t + 1.9);
    vibG.gain.setValueAtTime(0, t + 0.7);
    vibG.gain.linearRampToValueAtTime(110, t + 0.9);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.1);
    g.gain.setValueAtTime(0.03, t + 0.55);
    g.gain.linearRampToValueAtTime(0.008, t + 0.68);
    g.gain.linearRampToValueAtTime(0.026, t + 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    o.connect(g).connect(this._panner(pan, this.outside));
    o.start(t); vib.start(t);
    o.stop(t + 2.1); vib.stop(t + 2.1);
  }

  /** 秋の夜の虫（鈴虫） */
  cricket(night) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pan = (Math.random() - 0.5) * 1.6;
    const o = ctx.createOscillator();
    o.frequency.value = rand(4100, 4600);
    const am = ctx.createGain();
    am.gain.value = 0;
    const trill = ctx.createOscillator();
    trill.type = 'square';
    trill.frequency.value = rand(38, 52);
    const trillG = ctx.createGain();
    trillG.gain.value = 0.5;
    trill.connect(trillG).connect(am.gain);
    const g = ctx.createGain();
    const len = rand(0.25, 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012 * night, t + 0.04);
    g.gain.setValueAtTime(0.012 * night, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + 0.06);
    o.connect(am).connect(g).connect(this._panner(pan, this.outside));
    o.start(t); trill.start(t);
    o.stop(t + len + 0.1); trill.stop(t + len + 0.1);
  }

  /** お寺の鐘（梵鐘）。うなりを含んだ長い余韻 */
  templeBell(loud = false) {
    if (!this.started) return;
    const pan = this._pan(-1, -0.6) * 0.7;
    const f0 = 98;
    const g = loud ? 0.09 : 0.05;
    const partials = [[0.5, 0.6, 14], [1, 1, 12], [2.0, 0.35, 8], [2.76, 0.3, 6], [3.95, 0.18, 4], [5.35, 0.1, 3]];
    partials.forEach(([r, a, d]) => {
      this._tone({ freq: f0 * r, gain: g * a, attack: 0.01, decay: d, pan });
      this._tone({ freq: f0 * r + 0.7, gain: g * a * 0.6, attack: 0.01, decay: d, pan }); // うなり
    });
    this._noiseBurst({ type: 'brown', freq: 300, q: 1, gain: g * 0.6, attack: 0.002, decay: 0.3, pan });
  }

  /** 遠くの踏切（JR山陽本線）と、通り過ぎる電車 */
  fumikiri() {
    const pan = this._pan(-0.3, -1) * 0.5;
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const bus = ctx.createGain();
    bus.gain.value = 0.35;
    lp.connect(bus).connect(this._panner(pan, this.outside));
    const dur = 9;
    for (let i = 0; i < dur * 2.2; i++) {
      const when = i / 2.2;
      const fade = Math.min(1, when / 1.5, (dur - when) / 2);
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = i % 2 ? 690 : 740;
      const g = ctx.createGain();
      const t = ctx.currentTime + when;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.02 * fade, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + 0.45);
    }
    // 電車のガタンゴトン
    const train = this._noiseBurst({ type: 'brown', freq: 260, q: 0.6, filter: 'lowpass', gain: 0.12, attack: 2.5, decay: 4, when: 3.5, pan });
    for (let i = 0; i < 10; i++) {
      this._noiseBurst({ type: 'brown', freq: 140, q: 1, filter: 'lowpass', gain: 0.07, attack: 0.01, decay: 0.12, when: 4 + i * 0.32 + (i % 2) * 0.12, pan });
    }
    return train;
  }

  /** 汽笛 */
  horn() {
    const pan = (Math.random() - 0.5) * 1.2;
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    lp.connect(this._panner(pan, this.outside));
    const t = ctx.currentTime;
    const len = rand(1.6, 2.6);
    [130.8, 196].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.3);
      g.gain.setValueAtTime(0.03, t + len);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 1.5);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + len + 1.6);
    });
  }

  // ---------- 猫 ----------
  meow(level, dirX = 0, dirZ = -1) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pan = this._pan(dirX, dirZ) * 0.6;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = level >= 3 ? 520 : 600;
    const len = level >= 3 ? 0.35 : 0.6;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.45, t + len * 0.35);
    o.frequency.linearRampToValueAtTime(base * 0.85, t + len);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 4;
    f1.frequency.setValueAtTime(700, t);
    f1.frequency.linearRampToValueAtTime(1500, t + len * 0.4);
    f1.frequency.linearRampToValueAtTime(900, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.05);
    g.gain.setValueAtTime(0.1, t + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.1);
    o.connect(f1).connect(g);
    const p = this._panner(pan, this.inside);
    g.connect(p);
    g.connect(this.reverbSend);
    o.start(t);
    o.stop(t + len + 0.15);
  }

  tailSlap(dirX, dirZ) {
    if (!this.started) return;
    this._noiseBurst({ type: 'brown', freq: 500, q: 0.8, filter: 'lowpass', gain: 0.12, attack: 0.002, decay: 0.08, pan: this._pan(dirX, dirZ) * 0.6, dest: this.inside });
  }

  land(dirX, dirZ) {
    if (!this.started) return;
    this._noiseBurst({ type: 'brown', freq: 300, q: 0.8, filter: 'lowpass', gain: 0.2, attack: 0.002, decay: 0.12, pan: this._pan(dirX, dirZ) * 0.6, dest: this.inside });
  }

  shutter() {
    if (!this.started) return;
    this._noiseBurst({ type: 'white', freq: 2500, q: 1.5, gain: 0.25, attack: 0.001, decay: 0.05, dest: this.inside });
    this._noiseBurst({ type: 'white', freq: 1800, q: 1.5, gain: 0.18, attack: 0.001, decay: 0.07, when: 0.09, dest: this.inside });
    this._noiseBurst({ type: 'brown', freq: 600, q: 1, filter: 'lowpass', gain: 0.15, attack: 0.01, decay: 0.25, when: 0.15, dest: this.inside });
  }
}
