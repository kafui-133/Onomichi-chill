// 絵作り（ルック）：アニメ調の見た目にするための、陰影・輪郭線・光のにじみ・色調。
//   'anime'   … トゥーン調の陰影（光の当たる面と陰の面をくっきり分ける）、建物や屋根のふちの輪郭線、
//               灯りや夕日のブルーム（光のにじみ）、色調補正（少し鮮やかに、陰は青く、光はあたたかく、四隅を少し暗く）
//   'classic' … 以前の見た目のまま（何も足さない）
// 切りかえは設定（音量の横）か、URL の ?look=classic / ?look=anime。選んだものはブラウザに覚えておく。
// トゥーン調の陰影はシェーダーの組み立て前に入れるので、切りかえたあとはページを読みなおして反映する。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const KEY = 'onomichi-look';
export const LOOKS = { anime: '新しい絵', classic: '元の絵' };

function initial() {
  const p = new URLSearchParams(location.search).get('look');
  if (p && LOOKS[p]) return p;
  try { const v = localStorage.getItem(KEY); if (LOOKS[v]) return v; } catch { /* ignore */ }
  return 'anime';
}

export const look = {
  name: initial(),
  get label() { return LOOKS[this.name]; },
  toggle() {
    this.name = this.name === 'anime' ? 'classic' : 'anime';
    try { localStorage.setItem(KEY, this.name); } catch { /* ignore */ }
  },
};

/**
 * トゥーン調の陰影：光の当たりぐあい（法線と光の向きの内積）を、なだらかな2段に丸める。
 * three.js の Lambert（町のほとんど）と Standard（猫など）の直接光の計算だけを差しかえる。
 */
export function applyToonShading() {
  if (look.name !== 'anime') return;
  const fn = `
float toonStep( float x ) {
  float lit = smoothstep( 0.04, 0.16, x );
  return mix( 0.32, 0.9 + 0.1 * x, lit );
}
`;
  // Lambert（町のほとんど）：直接光の当たりぐあいを丸める
  const from = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
  const to = 'float dotNL = toonStep( saturate( dot( geometryNormal, directLight.direction ) ) );';
  const lam = THREE.ShaderChunk.lights_lambert_pars_fragment;
  if (lam && lam.includes(from) && !lam.includes('toonStep')) THREE.ShaderChunk.lights_lambert_pars_fragment = fn + lam.replace(from, to);
  // Standard（猫や部屋）：丸めるのは拡散光だけ。照り返しまで丸めると、影の側のふち（輪郭）で照り返しが強く出て、
  // 光る線のように見えてしまう
  const diff = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
  const phy = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (phy && phy.includes(diff) && !phy.includes('toonStep')) {
    THREE.ShaderChunk.lights_physical_pars_fragment = fn + phy.replace(diff, 'reflectedLight.directDiffuse += toonStep( dotNL ) * directLight.color * BRDF_Lambert( material.diffuseColor );');
  }
}

/** 輪郭線と色調補正を、1枚の画面にまとめてかける */
class InkGradePass extends Pass {
  constructor(camera, { outline }) {
    super();
    this.camera = camera;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uNear: { value: camera.near }, uFar: { value: camera.far },
        uOutline: { value: outline ? 1 : 0 },
        uInk: { value: new THREE.Color(0x24202a) },
        uNight: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tDiffuse, tDepth;
        uniform vec2 uResolution;
        uniform float uNear, uFar, uOutline, uNight;
        uniform vec3 uInk;
        varying vec2 vUv;
        float lin(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          return perspectiveDepthToViewZ(d, uNear, uFar) * -1.0;
        }
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          vec3 col = c.rgb;
          // 輪郭線：まわりより手前にある（奥行きが急に変わる）ところに、細い墨の線
          if (uOutline > 0.5) {
            vec2 px = 1.0 / uResolution;
            float d0 = lin(vUv);
            // 左右・上下の奥行きの曲がりぐあい（2階差分）。平らな面（地面・壁）は奥行きがなだらかに変わるだけなので
            // ほぼ0になり、線が出ない。ふちの手前側（まわりより近い）だけに線を引く
            float l = lin(vUv - vec2(px.x, 0.0)), r = lin(vUv + vec2(px.x, 0.0));
            float dn = lin(vUv - vec2(0.0, px.y)), up = lin(vUv + vec2(0.0, px.y));
            float e = (max(max(l, r), max(dn, up)) - d0) / max(d0, 0.05);
            float bend = max(l + r - 2.0 * d0, dn + up - 2.0 * d0) / max(d0, 0.05);
            // 遠くほど奥行きの細かさが落ちるので、しきい値も少しずつ上げる
            float th = 0.025 + d0 * 0.00012;
            float edge = smoothstep(th, th * 2.8, e) * smoothstep(th * 0.5, th * 1.4, bend);
            // 遠くは細かい家が多くてうるさくなるので、だんだん薄く。空（いちばん奥）は対象外
            edge *= (1.0 - smoothstep(180.0, 900.0, d0)) * step(d0, uFar * 0.6);
            col = mix(col, uInk * (0.5 + 0.5 * col), edge * 0.78);
          }
          // 色調補正：少し鮮やかに、ゆるいS字のコントラスト、陰は青紫に、光はあたたかく
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, 1.14);
          // S字は0〜1の範囲だけにかける（灯りなど1をこえる明るさは、そのまま光のにじみへ。こえた分にかけると色が反転する）
          vec3 cc = clamp(col, 0.0, 1.0);
          col = mix(col, cc * cc * (3.0 - 2.0 * cc) + max(col - 1.0, 0.0), 0.22);
          vec3 shadowTint = mix(vec3(0.93, 0.95, 1.08), vec3(0.9, 0.92, 1.12), uNight);
          vec3 lightTint = vec3(1.04, 1.0, 0.95);
          col *= mix(shadowTint, lightTint, smoothstep(0.15, 0.75, l));
          // 四隅を少し暗く
          vec2 q = vUv - 0.5;
          col *= 1.0 - dot(q, q) * 0.38;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
        }`,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  setSize(w, h) { this.material.uniforms.uResolution.value.set(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
}

/**
 * 描画の流れ。'classic' か画質「低」では、これまでどおり renderer.render だけ。
 * @param q 画質（quality.s）
 */
export class Look {
  constructor(renderer, scene, camera, q) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = look.name === 'anime' && q.post !== false;
    if (!this.enabled) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const isWebGL2 = renderer.capabilities.isWebGL2;
    const makeTarget = (w = size.x, h = size.y) => {
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: isWebGL2 ? q.msaa : 0 });
      rt.depthTexture = new THREE.DepthTexture(w, h);
      // 奥行きは32bitの浮動小数で（スマホの24bit・16bitでは、平らな地面に縞の輪郭線が出る）
      rt.depthTexture.type = isWebGL2 ? THREE.FloatType : THREE.UnsignedIntType;
      return rt;
    };
    this.makeTarget = makeTarget;
    this.composer = new EffectComposer(renderer, makeTarget());
    this.composer.renderTarget2.dispose();
    this.composer.renderTarget2 = makeTarget();
    this.composer.addPass(new RenderPass(scene, camera));
    this.ink = new InkGradePass(camera, { outline: q.outline });
    this.composer.addPass(this.ink);
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * q.bloom, size.y * q.bloom), 0.3, 0.5, 0.88);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this._rtW = this.composer.renderTarget1.width;
    this._rtH = this.composer.renderTarget1.height;
    this.setSize(window.innerWidth, window.innerHeight);
  }

  /** night: 0〜1（夜ほど陰を青く、灯りのにじみを強く） */
  render(night = 0) {
    if (!this.enabled) { this.renderer.render(this.scene, this.camera); return; }
    this.ink.material.uniforms.uNight.value = night;
    if (this.bloom) {
      // にじむのは、ほんとうに明るいところ（灯り・夕日）だけ。夜は少し強く
      this.bloom.strength = 0.28 + night * 0.22;
      this.bloom.threshold = 0.88 - night * 0.06;
    }
    this.composer.render();
  }

  setSize(w, h) {
    if (!this.enabled) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    // 大きさが変わったら、描く先（奥行きのテクスチャつき）を作りなおす。
    // 作りなおさずに大きさだけ変えると、スマホで奥行きの大きさがずれて、画面が真っ暗になる
    const c = this.composer;
    const bs = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (c.renderTarget1.width !== this._rtW || c.renderTarget1.height !== this._rtH) {
      for (const rt of [c.renderTarget1, c.renderTarget2]) { rt.depthTexture?.dispose(); rt.dispose(); }
      c.renderTarget1 = this.makeTarget(bs.x, bs.y);
      c.renderTarget2 = this.makeTarget(bs.x, bs.y);
      c.writeBuffer = c.renderTarget1;
      c.readBuffer = c.renderTarget2;
      this._rtW = c.renderTarget1.width;
      this._rtH = c.renderTarget1.height;
    }
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.ink.setSize(s.x, s.y);
  }
}
