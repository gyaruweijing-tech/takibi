// 煙と湯気：6方向の光の絵を、焚き火・熾火・月の光の向きに合わせて混ぜる
// 煙の下側が焚き火で橙に照らされ、上側は夜の暗さに沈む
import * as THREE from 'three';

const MAX = 260;
const vert = /* glsl */`
attribute vec3 aPos; attribute vec4 aP; // x: 大きさ y: コマ z: 濃さ w: 回転
attribute float aKind;                  // 0 煙 1 湯気
varying vec2 vUv; varying vec4 vP; varying float vKind; varying vec3 vWorld; varying vec3 vR; varying vec3 vU; varying vec3 vF;
void main(){
  vUv = uv; vP = aP; vKind = aKind; vWorld = aPos;
  vec3 f = normalize(cameraPosition - aPos);
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f)); vec3 u = cross(f, r);
  float c = cos(aP.w), s = sin(aP.w);
  vec3 r2 = r * c + u * s, u2 = -r * s + u * c;
  vR = r2; vU = u2; vF = f;
  vec3 p = aPos + (r2 * position.x * 0.67 + u2 * position.y) * aP.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const frag = /* glsl */`
uniform sampler2D uA, uB; uniform vec4 uM;
uniform vec3 uFirePos, uFireCol, uEmberPos, uEmberCol, uMoonDir, uMoonCol, uAmb;
varying vec2 vUv; varying vec4 vP; varying float vKind; varying vec3 vWorld; varying vec3 vR; varying vec3 vU; varying vec3 vF;
vec2 cell(float n, vec2 uv){ float c = mod(n, uM.x), r = floor(n / uM.x); return vec2((c + uv.x) / uM.x, 1.0 - (r + 1.0 - uv.y) / uM.y); }
float six(vec4 a, vec4 b, vec3 L){
  // 光の向きを絵の向き（右・上・手前）に直して、6枚から拾う
  vec3 l = vec3(dot(L, vR), dot(L, vU), dot(L, vF));
  return (l.x > 0.0 ? a.r * l.x : b.r * -l.x) + (l.y > 0.0 ? a.g * l.y : b.g * -l.y) + (l.z > 0.0 ? a.b * l.z : b.b * -l.z);
}
void main(){
  float f = vP.y; float n = floor(f), t = fract(f);
  vec4 a = mix(texture2D(uA, cell(n, vUv)), texture2D(uA, cell(min(n + 1.0, uM.z - 1.0), vUv)), t);
  vec4 b = mix(texture2D(uB, cell(n, vUv)), texture2D(uB, cell(min(n + 1.0, uM.z - 1.0), vUv)), t);
  vec3 toF = uFirePos - vWorld; float dF = length(toF);
  vec3 toE = uEmberPos - vWorld; float dE = length(toE);
  vec3 light = uFireCol * six(a, b, toF / dF) / (dF * dF + 0.05)
             + uEmberCol * six(a, b, toE / dE) / (dE * dE + 0.05)
             + uMoonCol * six(a, b, uMoonDir) + uAmb;
  vec3 albedo = vKind > 0.5 ? vec3(0.75, 0.76, 0.78) : vec3(0.42, 0.40, 0.38);
  gl_FragColor = vec4(albedo * light, a.a * vP.z);
  #include <colorspace_fragment>
}`;

export async function createSmoke(scene) {
  const meta = await fetch('assets/smoke/smoke.json').then((r) => r.json());
  const tl = new THREE.TextureLoader();
  const [ta, tb] = await Promise.all(['a', 'b'].map((k) => tl.loadAsync(`assets/smoke/smoke-${k}.png`)));
  for (const t of [ta, tb]) { t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; }
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv;
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  const aKind = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
  for (const x of [aPos, aP, aKind]) x.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos); geo.setAttribute('aP', aP); geo.setAttribute('aKind', aKind);
  const u = {
    uA: { value: ta }, uB: { value: tb }, uM: { value: new THREE.Vector4(meta.cols, meta.rows, meta.frames, 0) },
    uFirePos: { value: new THREE.Vector3() }, uFireCol: { value: new THREE.Color() },
    uEmberPos: { value: new THREE.Vector3() }, uEmberCol: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(-0.4, 0.8, -0.3).normalize() }, uMoonCol: { value: new THREE.Color(0.006, 0.008, 0.014) },
    uAmb: { value: new THREE.Color(0.002, 0.002, 0.003) },
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: u, transparent: true, depthWrite: false }));
  mesh.frustumCulled = false; mesh.renderOrder = 9; mesh.raycast = () => {};
  scene.add(mesh);
  const parts = [];
  const order = [];
  return {
    count: () => parts.length,
    emit(pos, kind, amount) {
      if (parts.length >= MAX) return;
      parts.push({ p: [...pos], v: [(Math.random() - 0.5) * 0.05, 0.15 + Math.random() * 0.1, (Math.random() - 0.5) * 0.05], age: 0, life: kind ? 3 + Math.random() * 2 : 7 + Math.random() * 5, kind, amount, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.4, s0: 0.06 + Math.random() * 0.05 });
    },
    // lights: { fire:{pos,color(W相当)}, ember } / field：上昇気流 / wind
    update(dt, camera, lights, field, wind) {
      u.uFirePos.value.copy(lights.firePos); u.uFireCol.value.copy(lights.fireCol);
      u.uEmberPos.value.copy(lights.emberPos); u.uEmberCol.value.copy(lights.emberCol);
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i]; q.age += dt;
        const up = field(q.p[0], q.p[1], q.p[2]);
        q.v[1] += ((Math.max(0.12, up * 0.8)) - q.v[1]) * Math.min(1, dt * 1.5);
        q.v[0] += (wind[0] - q.v[0]) * Math.min(1, dt * 0.4); q.v[2] += (wind[1] - q.v[2]) * Math.min(1, dt * 0.4);
        for (let k = 0; k < 3; k++) q.p[k] += q.v[k] * dt;
        q.rot += q.spin * dt;
        if (q.age > q.life) parts.splice(i, 1);
      }
      // 奥から順に描く
      const cp = camera.position;
      order.length = 0; order.push(...parts);
      order.sort((a, b) => (Math.hypot(b.p[0] - cp.x, b.p[1] - cp.y, b.p[2] - cp.z) - Math.hypot(a.p[0] - cp.x, a.p[1] - cp.y, a.p[2] - cp.z)));
      order.forEach((q, i) => {
        const k = q.age / q.life;
        aPos.setXYZ(i, ...q.p);
        const fade = Math.min(1, q.age * 2) * (1 - k) ** 1.5;
        aP.setXYZW(i, q.s0 + k * (q.kind ? 0.35 : 0.7), Math.min(meta.frames - 1.001, 4 + k * (meta.frames - 6)), Math.min(1, q.amount) * fade * (q.kind ? 0.5 : 0.8), q.rot);
        aKind.setX(i, q.kind);
      });
      geo.instanceCount = order.length;
      aPos.needsUpdate = aP.needsUpdate = aKind.needsUpdate = true;
    },
  };
}
