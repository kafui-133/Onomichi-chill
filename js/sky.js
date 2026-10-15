// 空（グラデーション＋雲＋太陽）と尾道水道の海面シェーダー
import * as THREE from 'three';
import { glowTexture } from './util.js';

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i+vec2(1.,0.)), c = hash(i+vec2(0.,1.)), d = hash(i+vec2(1.,1.));
    vec2 u = f*f*(3.-2.*f);
    return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
  }
  float fbm(vec2 p){
    float v = 0., a = .5;
    for(int i=0;i<5;i++){ v += a*noise(p); p = p*2.03 + vec2(17.1, 9.2); a *= .5; }
    return v;
  }
`;

// 空と海で共有するグラデーション関数
const SKY_GRAD_GLSL = /* glsl */ `
  uniform vec3 uZenith, uMid, uHorizon, uSunColor, uSunDir;
  uniform float uGlow;
  vec3 skyGradient(vec3 d){
    float t = clamp(d.y, 0., 1.);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, t));
    col = mix(col, uZenith, smoothstep(0.16, 0.75, t));
    // 太陽方向の水平線だけが強く焼ける
    vec2 dh = normalize(d.xz + 1e-5), sh = normalize(uSunDir.xz + 1e-5);
    float az = pow(max(dot(dh, sh), 0.), 3.);
    float low = 1. - smoothstep(0., 0.32, t);
    col += uSunColor * az * low * uGlow * 0.35;
    float sd = max(dot(d, uSunDir), 0.);
    col += uSunColor * (pow(sd, 6.) * 0.22 + pow(sd, 48.) * 0.45) * uGlow;
    return col;
  }
`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uGlow: { value: 1 },
      uCloud: { value: 0.3 },
      uCloudBase: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() },
      uSunVis: { value: 1 },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        ${SKY_GRAD_GLSL}
        uniform float uCloud, uSunVis, uTime;
        uniform vec3 uCloudBase, uCloudLit;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec3 col = skyGradient(d);
          float sd = max(dot(d, uSunDir), 0.);
          // 太陽の円盤（水平線の下に沈むと消える）
          float disc = smoothstep(0.99955, 0.99975, sd) * uSunVis * smoothstep(-0.01, 0.01, d.y);
          col = mix(col, uSunColor * 1.6 + vec3(0.25), disc);
          // 雲：天球を平面に投影した fbm。夕方は下から照らされる
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.12) * 0.55 + vec2(uTime * 0.006, uTime * 0.002);
            float n = fbm(uv * 1.3 + fbm(uv * 0.6) * 0.6);
            float thr = 1. - uCloud;
            float c = smoothstep(thr * 0.82, thr * 0.82 + 0.28, n);
            c *= smoothstep(0.0, 0.1, d.y) * (1. - smoothstep(0.55, 0.95, d.y) * 0.5);
            float lit = 0.35 + 0.65 * pow(sd, 3.0) + 0.25 * (1. - smoothstep(0.0, 0.3, d.y));
            vec3 cc = mix(uCloudBase, uCloudLit, clamp(lit, 0., 1.));
            // 雲の縁の明るさ
            float edge = smoothstep(thr * 0.82, thr * 0.82 + 0.1, n) - smoothstep(thr * 0.82 + 0.1, thr * 0.82 + 0.3, n);
            cc += uCloudLit * edge * 0.25 * pow(sd, 2.);
            col = mix(col, cc, c * 0.92);
          }
          gl_FragColor = vec4(col, 1.);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4500, 48, 24), mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // 星
    const starGeo = new THREE.BufferGeometry();
    const pos = [];
    for (let i = 0; i < 1400; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(1 - Math.random() * 0.95);
      const r = 4200;
      pos.push(Math.sin(v) * Math.cos(u) * r, Math.cos(v) * r, Math.sin(v) * Math.sin(u) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xfff8ee, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    // 月
    this.moonMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff2d8, transparent: true, depthWrite: false, fog: false });
    this.moon = new THREE.Sprite(this.moonMat);
    this.moon.scale.setScalar(150);
    this.moon.renderOrder = -8;
    scene.add(this.moon);
    const discMat = new THREE.MeshBasicMaterial({ color: 0xfff6e2, transparent: true, fog: false, depthWrite: false });
    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(26, 32), discMat);
    this.moonDisc.renderOrder = -7;
    scene.add(this.moonDisc);
  }

  update(time, camera, elapsed) {
    const p = time.p;
    const u = this.uniforms;
    u.uZenith.value.copy(p.zenith);
    u.uMid.value.copy(p.mid);
    u.uHorizon.value.copy(p.horizon);
    u.uSunColor.value.copy(p.sun);
    u.uSunDir.value.copy(time.sunDir);
    u.uGlow.value = p.glow;
    u.uCloud.value = p.cloud;
    u.uCloudBase.value.copy(p.cloudBase);
    u.uCloudLit.value.copy(p.cloudLit);
    u.uSunVis.value = time.sunDir.y > -0.05 ? 1 : 0;
    u.uTime.value = elapsed;

    this.mesh.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.stars.rotation.y = elapsed * 0.002;
    this.starMat.opacity = Math.max(0, p.night - 0.25) * 1.2;

    const mp = time.moonDir.clone().multiplyScalar(3600).add(camera.position);
    this.moon.position.copy(mp);
    this.moonDisc.position.copy(mp);
    this.moonDisc.lookAt(camera.position);
    this.moonMat.opacity = p.night * 0.55;
    this.moonDisc.material.opacity = Math.min(1, p.night * 1.3);
  }
}

export class Sea {
  constructor(scene, seaLevel) {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() },
      uGlow: { value: 1 },
      uDeep: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFogNear: { value: 200 },
      uFogFar: { value: 3000 },
      uTime: { value: 0 },
      uSpec: { value: 1 },
      uMoonDir: { value: new THREE.Vector3() },
      uNight: { value: 0 },
      uWakes: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        ${SKY_GRAD_GLSL}
        uniform vec3 uDeep, uFogColor, uMoonDir;
        uniform float uFogNear, uFogFar, uTime, uSpec, uNight;
        uniform vec4 uWakes[6]; // xy=位置(xz), z=強さ, w=進行方向の角度
        varying vec3 vWorld;

        float waveH(vec2 p){
          float t = uTime;
          float h = 0.;
          h += sin(dot(p, vec2(0.021, 0.034)) + t*0.9) * 0.6;
          h += sin(dot(p, vec2(-0.043, 0.027)) + t*1.3) * 0.35;
          h += sin(dot(p, vec2(0.08, -0.05)) + t*1.9) * 0.18;
          h += (noise(p*0.09 + t*0.12) - .5) * 0.9;
          h += (noise(p*0.31 - t*0.2) - .5) * 0.35;
          return h;
        }
        void main(){
          vec3 toCam = cameraPosition - vWorld;
          float dist = length(toCam);
          vec3 V = toCam / dist;
          vec2 p = vWorld.xz;
          // 遠いほど波を細かく見せない
          float e = 0.6 + dist * 0.004;
          float hC = waveH(p);
          float dx = (waveH(p + vec2(e, 0.)) - hC) / e;
          float dz = (waveH(p + vec2(0., e)) - hC) / e;
          float amp = 0.35 / (1. + dist * 0.0025);
          vec3 N = normalize(vec3(-dx * amp, 1., -dz * amp));

          vec3 R = reflect(-V, N);
          R.y = abs(R.y);
          vec3 sky = skyGradient(R);
          float fres = 0.04 + 0.96 * pow(1. - max(dot(V, N), 0.), 5.);
          vec3 col = mix(uDeep, sky, clamp(fres * 1.1, 0., 1.));

          // 太陽・月のきらめき（光の道）
          float sp = pow(max(dot(R, uSunDir), 0.), 260.) * 3.0 + pow(max(dot(R, uSunDir), 0.), 30.) * 0.25;
          col += uSunColor * sp * uSpec;
          float mp = pow(max(dot(R, uMoonDir), 0.), 220.) * 1.6;
          col += vec3(1.0, 0.93, 0.8) * mp * uNight;

          // 船の引き波（白い筋）
          for (int i = 0; i < 6; i++) {
            vec4 w = uWakes[i];
            if (w.z <= 0.) continue;
            vec2 d = p - w.xy;
            vec2 dv = vec2(cos(w.w), sin(w.w));
            float behind = -dot(d, dv);         // 進行方向の後ろ側
            if (behind < -2.) continue;
            behind = max(behind, 0.);
            float spread = 2.0 + behind * 0.22;  // V字に広がる
            float lat = abs(d.x * dv.y - d.y * dv.x);
            float ridge = exp(-pow((lat - spread * 0.55) / (1.2 + behind * 0.04), 2.));
            float core = exp(-pow(lat / (1.5 + behind * 0.03), 2.));
            float fade = exp(-behind / 140.);
            float foam = (ridge * 0.7 + core * 0.5) * fade * w.z;
            foam *= 0.55 + 0.45 * noise(p * 0.6 + uTime);
            col = mix(col, mix(sky, vec3(1.), 0.6), clamp(foam, 0., 0.85));
          }

          float f = smoothstep(uFogNear, uFogFar, dist);
          col = mix(col, uFogColor, f);
          gl_FragColor = vec4(col, 1.);
          #include <colorspace_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(9000, 6000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, seaLevel, -2900);
    scene.add(this.mesh);
  }

  update(time, fog, elapsed, wakes, sky) {
    const u = this.uniforms;
    const p = time.p;
    u.uZenith.value.copy(p.zenith);
    u.uMid.value.copy(p.mid);
    u.uHorizon.value.copy(p.horizon);
    u.uSunColor.value.copy(p.sun);
    u.uSunDir.value.copy(time.sunDir);
    u.uGlow.value = p.glow;
    u.uDeep.value.copy(p.sea);
    u.uFogColor.value.copy(fog.color);
    u.uFogNear.value = fog.near;
    u.uFogFar.value = fog.far;
    u.uTime.value = elapsed;
    u.uSpec.value = time.sunDir.y > -0.03 ? 1 : 0;
    u.uMoonDir.value.copy(time.moonDir);
    u.uNight.value = p.night;
    for (let i = 0; i < 6; i++) {
      const w = wakes[i];
      if (w) u.uWakes.value[i].set(w.x, w.z, w.strength, w.angle);
      else u.uWakes.value[i].set(0, 0, 0, 0);
    }
  }
}
