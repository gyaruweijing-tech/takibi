// カメラの癖：陽炎（炎の上の空気のゆらぎ）・光のにじみ（ブルーム）・露出の追従・粒子・周辺の暗さ
import * as THREE from 'three';
import { TRAY } from './burn/fire.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const Haze = {
  uniforms: { tDiffuse: { value: null }, uC: { value: new THREE.Vector2() }, uS: { value: new THREE.Vector2() }, uK: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uC, uS; uniform float uK, uTime, uAspect; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main(){
      // 炎の上の縦長の楕円の中だけ、上へ流れるゆらぎで像をずらす
      vec2 d = (vUv - uC) / uS; d.y = max(d.y - 0.2, 0.0) * 0.6 + min(d.y, 0.0) * 2.5;
      float m = exp(-dot(d, d) * 2.0) * uK;
      vec2 q = vec2(vUv.x * uAspect, vUv.y) * 60.0 - vec2(0.0, uTime * 6.0);
      vec2 off = vec2(n(q) - 0.5, n(q + 17.3) - 0.5) * 0.004 * m;
      gl_FragColor = texture2D(tDiffuse, vUv + off);
    }`,
};
const Final = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.035 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uGrain; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      // 端ほど色が少しずれる（レンズの色収差）
      vec3 col; float ca = dot(c, c) * 0.004;
      col.r = texture2D(tDiffuse, vUv - c * ca).r; col.g = texture2D(tDiffuse, vUv).g; col.b = texture2D(tDiffuse, vUv + c * ca).b;
      col *= vec3(0.96, 1.0, 1.07);                 // スマホの自動ホワイトバランス（焚き火の橙を少し戻す）
      col *= 1.0 - smoothstep(0.35, 0.95, length(c * vec2(1.0, 0.85))) * 0.55;          // 周辺が暗い
      // 暗い所ほど目立つ粒子（夜のスマホ写真のノイズ）
      float g = h(vUv * vec2(1931.0, 1177.0) + fract(uTime * 7.31)) - 0.5;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += g * uGrain * (1.0 - smoothstep(0.0, 0.5, lum)) * (0.4 + col);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 0 }));   // MSAA は Iris Xe で約9ms。代わりに軽い FXAA
  composer.addPass(new RenderPass(scene, camera));
  const haze = new ShaderPass(Haze); composer.addPass(haze);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.6, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa);
  const fin = new ShaderPass(Final); composer.addPass(fin);
  // 解像度は重さに合わせて自動で上下する（scale：0.6〜1）
  let scale = 1;
  const resize = () => {
    const pr = Math.min(2, devicePixelRatio) * scale;
    renderer.setPixelRatio(pr); composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
    fxaa.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
  };
  addEventListener('resize', resize); resize();
  const v = new THREE.Vector3(), v2 = new THREE.Vector3();
  let exposure = 1;
  return {
    composer, bloom, haze, fin, fxaa,
    get scale() { return scale; },
    setScale(s) { s = Math.min(1, Math.max(0.6, s)); if (Math.abs(s - scale) < 0.04) return; scale = s; resize(); },
    // h: 炎の上端までの高さ。light: 炎の明るさ（露出をスマホのように追従させる）
    update(t, hz, light, dt) {
      haze.uniforms.uTime.value = t; fin.uniforms.uTime.value = t;
      haze.uniforms.uAspect.value = innerWidth / innerHeight;
      if (hz.h > 0.02) {
        v.set(hz.x, hz.y + hz.h * 0.9, hz.z).project(camera);
        v2.set(hz.x + 0.12, hz.y + hz.h * 1.8, hz.z).project(camera);
        haze.uniforms.uC.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
        haze.uniforms.uS.value.set(Math.max(0.03, Math.abs(v2.x - v.x) * 0.5), Math.max(0.05, Math.abs(v2.y - v.y) * 0.5));
        haze.uniforms.uK.value += (Math.min(1.2, hz.h * 3) - haze.uniforms.uK.value) * Math.min(1, dt * 2);
      } else haze.uniforms.uK.value *= 0.95;
      // 明るい炎が大きいと少し絞る（ゆっくり）
      // 近づくほど画面の中が明るい所ばかりになるので、スマホのように絞る
      const near = Math.min(1, Math.max(0.4, (camera.position.distanceTo(v.set(0, TRAY.y + 0.05, 0)) / 1.3) ** 0.8));
      const goal = 1.15 / (1 + light * 0.9) * near;
      exposure += (Math.max(0.35, goal) - exposure) * Math.min(1, dt * 0.8);
      renderer.toneMappingExposure = exposure;
    },
    render() { composer.render(); },
  };
}
