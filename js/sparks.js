// 火の粉：はぜた瞬間に飛び散り、熱い空気に乗って上がり、冷えて赤→暗くなって消える
// 動きの方向に少し伸ばして描く（シャッター速度ぶんの尾）
import * as THREE from 'three';

const MAX = 1500;
const vert = /* glsl */`
attribute vec3 aPos; attribute vec3 aVel; attribute float aTemp;
varying float vTemp; varying vec2 vUv;
void main(){
  vTemp = aTemp; vUv = uv;
  vec4 c = viewMatrix * vec4(aPos, 1.0);
  vec4 c2 = viewMatrix * vec4(aPos - aVel * 0.025, 1.0);   // 1/40 秒前の位置
  vec2 a = c.xy, b = c2.xy; vec2 d = a - b; float len = max(length(d), 1e-4);
  vec2 dir = d / len, nrm = vec2(-dir.y, dir.x);
  float w = 0.0011 + 0.0009 * clamp((aTemp - 500.0) / 600.0, 0.0, 1.0);
  vec2 p = mix(b, a, position.y + 0.5) + nrm * position.x * w * 2.0 + dir * (position.y) * w;
  gl_Position = projectionMatrix * vec4(p, c.z, 1.0);
}`;
const frag = /* glsl */`
varying float vTemp; varying vec2 vUv;
vec3 blackbody(float k){ float t = k / 100.0; vec3 c;
  c.r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
  c.g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0) : clamp(1.129891 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
  c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432068 * log(t - 10.0) - 1.1962541, 0.0, 1.0));
  return pow(c, vec3(2.2)); }
void main(){
  float e = 1.0 - smoothstep(0.2, 0.5, abs(vUv.x - 0.5));
  float I = pow(clamp((vTemp - 520.0) / 700.0, 0.0, 1.0), 1.6) * 40.0;
  gl_FragColor = vec4(blackbody(vTemp + 273.0) * I * e, 1.0);
}`;

export function createSparks(scene) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv;
  const P = new Float32Array(MAX * 3), V = new Float32Array(MAX * 3), T = new Float32Array(MAX);
  const aPos = new THREE.InstancedBufferAttribute(P, 3), aVel = new THREE.InstancedBufferAttribute(V, 3), aTemp = new THREE.InstancedBufferAttribute(T, 1);
  for (const a of [aPos, aVel, aTemp]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos); geo.setAttribute('aVel', aVel); geo.setAttribute('aTemp', aTemp);
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  mesh.frustumCulled = false; mesh.renderOrder = 11; mesh.raycast = () => {};
  scene.add(mesh);
  const parts = []; // {p:[], v:[], T, size}
  return {
    count: () => parts.length,
    emit(pos, n, speed = 1.5, hot = 1) {
      for (let i = 0; i < n && parts.length < MAX; i++) {
        const a = Math.random() * Math.PI * 2, up = 0.4 + Math.random() * 0.9;
        const s = speed * (0.3 + Math.random() ** 2 * 1.4);
        parts.push({
          p: [pos[0], pos[1], pos[2]],
          v: [Math.cos(a) * s * (1 - up * 0.5), up * s, Math.sin(a) * s * (1 - up * 0.5)],
          T: (850 + Math.random() * 350) * hot, size: 0.3 + Math.random() ** 3 * 2.5,
        });
      }
    },
    // field(x,y,z) → 上昇気流の速さ（燃焼モデルの熱い空気から）
    update(dt, field, wind) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        const up = field(q.p[0], q.p[1], q.p[2]);
        const drag = 2.2 / q.size;
        q.v[0] += ((wind[0] + Math.sin(q.p[1] * 9 + i) * 0.25) - q.v[0]) * Math.min(1, drag * dt);
        q.v[2] += ((wind[1] + Math.cos(q.p[1] * 7 + i) * 0.25) - q.v[2]) * Math.min(1, drag * dt);
        q.v[1] += ((up - q.v[1]) * Math.min(1, drag * dt)) - 9.81 * dt * 0.08 * q.size;
        for (let k = 0; k < 3; k++) q.p[k] += q.v[k] * dt;
        q.T -= dt * (q.T - 15) * (0.55 / q.size) * (0.6 + Math.random() * 0.8);
        if (q.T < 480 || q.p[1] < 0.01) parts.splice(i, 1);
      }
      parts.forEach((q, i) => { aPos.setXYZ(i, ...q.p); aVel.setXYZ(i, ...q.v); T[i] = q.T; });
      geo.instanceCount = parts.length;
      aPos.needsUpdate = aVel.needsUpdate = aTemp.needsUpdate = true;
    },
  };
}
