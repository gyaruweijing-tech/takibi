// 炎：本人が撮った焚き火の動画から切り抜いたパラパラ漫画を、燃焼モデルの「炎の柱」ごとに立てる
// 炎は光そのものなので、黒背景の映像を足し算で重ねる（透明の切り抜きは要らない）
// 柱の高さ＝Heskestad の炎の高さ。映像は柱ごとに、どの素材・どのコマから・どの速さで・左右反転かを変える
import * as THREE from 'three';

const ATLASES = ['f196-0', 'f186a-0'];
const MAX = 64;

const vert = /* glsl */`
attribute vec4 aSprite;   // x: 素材番号 y: コマ(小数) z: 左右反転 w: 明るさ
attribute vec3 aCenter;   // 炎の根元
attribute vec2 aSize;     // 幅・高さ
varying vec2 vUv; varying vec4 vS;
void main(){
  vUv = uv; vS = aSprite;
  // 縦軸だけカメラに向ける（炎は上に伸びる）
  vec3 toCam = cameraPosition - aCenter; toCam.y = 0.0;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 p = aCenter + right * (position.x * aSize.x) + vec3(0.0, 1.0, 0.0) * (position.y * aSize.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const frag = /* glsl */`
uniform sampler2D uA0, uA1; uniform vec4 uM0, uM1; // 列数・行数・コマ数・未使用
uniform float uGain;
varying vec2 vUv; varying vec4 vS;
vec3 frame(sampler2D t, vec4 m, float f, vec2 uv){
  float n = mod(floor(f), m.z); float c = mod(n, m.x), r = floor(n / m.x);
  vec2 cell = vec2(1.0 / m.x, 1.0 / m.y);
  return texture2D(t, vec2((c + uv.x) * cell.x, 1.0 - (r + 1.0 - uv.y) * cell.y)).rgb;
}
void main(){
  vec2 uv = vec2(vS.z > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
  float f = vS.y, a = fract(f);
  vec3 c;
  // コマの間をなめらかに（速さを変えてもカクつかない）
  if (vS.x < 0.5) c = mix(frame(uA0, uM0, f, uv), frame(uA0, uM0, f + 1.0, uv), a);
  else c = mix(frame(uA1, uM1, f, uv), frame(uA1, uM1, f + 1.0, uv), a);
  c = max(c - 0.035, 0.0) / 0.965;       // 映像に残った薄い灰色（背景の名残）を切る
  c = pow(c, vec3(2.2));                 // 映像（sRGB）→ 光の量
  c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 1.7);    // 色の薄い所（炎の縁）の橙を戻す
  c = max(c, 0.0) * vec3(1.0, 0.5, 0.2);            // スマホの白飛びを焚き火の橙へ（2026-10-08 本人「白っぽい」→ 橙寄りに）
  gl_FragColor = vec4(c * vS.w * uGain, 1.0);
}`;

export async function createFlames(scene) {
  const tl = new THREE.TextureLoader();
  const metas = await Promise.all(ATLASES.map((n) => fetch(`assets/flames/${n}.json`).then((r) => r.json())));
  const texs = await Promise.all(ATLASES.map((n) => tl.loadAsync(`assets/flames/${n}.jpg`)));
  for (const t of texs) { t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }

  const base = new THREE.PlaneGeometry(1, 1); base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv;
  const aSprite = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  const aCenter = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  const aSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
  for (const a of [aSprite, aCenter, aSize]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aSprite', aSprite); geo.setAttribute('aCenter', aCenter); geo.setAttribute('aSize', aSize);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: {
      uA0: { value: texs[0] }, uA1: { value: texs[1] },
      uM0: { value: new THREE.Vector4(metas[0].cols, metas[0].rows, metas[0].frames, 0) },
      uM1: { value: new THREE.Vector4(metas[1].cols, metas[1].rows, metas[1].frames, 0) },
      uGain: { value: 1.3 },
    },
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.raycast = () => {};   // 見た目だけ。つかむ判定に入れない
  scene.add(mesh);

  const sprites = new Map();   // 柱の番号 → 状態
  let light = 0, haze = { x: 0, y: 0, z: 0, h: 0 };

  return {
    mesh, uniforms: mat.uniforms,
    get light() { return light; },
    get haze() { return haze; },
    // columns: 燃焼モデルの炎の柱。dt は実時間
    update(columns, dt) {
      // 近い柱（9cm 四方）をまとめて1つの炎にする。高さはまとめた熱量で Heskestad の式から出し直す
      const groups = new Map();
      for (const c of columns) {
        if (c.Lf < 0.01) continue;
        const k = Math.floor(c.x / 0.09) * 1000 + Math.floor(c.z / 0.09);
        let g = groups.get(k);
        if (!g) { g = { b: k, Q: 0, x: 0, y: 9, z: 0, n: 0, w: 0 }; groups.set(k, g); }
        g.Q += c.Q; g.x += c.x * c.Q; g.z += c.z * c.Q; g.w += c.Q; g.y = Math.min(g.y, c.y); g.n++;
        g.Lf = Math.max(g.Lf || 0, c.Lf);
      }
      columns = [];
      for (const g of groups.values()) {
        if (g.w <= 0) continue;
        g.x /= g.w; g.z /= g.w;
        g.Lf = Math.max(g.Lf, 0.235 * g.Q ** 0.4 - 0.04);
        columns.push(g);
      }
      const seen = new Set();
      for (const c of columns) {
        if (c.Lf < 0.015) continue;
        let s = sprites.get(c.b);
        if (!s) {
          const src = c.Lf > 0.28 && Math.random() < 0.55 ? 1 : 0;
          s = { src, f: Math.random() * metas[src].frames, rate: 0.8 + Math.random() * 0.45, flip: Math.random() < 0.5 ? 1 : 0, h: 0, x: c.x, y: c.y, z: c.z, a: 0, jx: (Math.random() - 0.5) * 0.02, jz: (Math.random() - 0.5) * 0.02 };
          sprites.set(c.b, s);
        }
        s.target = c; seen.add(c.b);
      }
      for (const [k, s] of sprites) {
        const t = seen.has(k) ? s.target : null;
        const goal = t ? t.Lf : 0;
        // 炎の伸び縮みは速く、根元の移動はゆっくり
        s.h += (goal - s.h) * Math.min(1, dt * (goal > s.h ? 5 : 2.5));
        s.a += ((t ? 1 : 0) - s.a) * Math.min(1, dt * 3);
        if (t) { s.x += (t.x - s.x) * Math.min(1, dt * 4); s.y += (t.y - s.y) * Math.min(1, dt * 4); s.z += (t.z - s.z) * Math.min(1, dt * 4); }
        s.f += dt * metas[s.src].fps * s.rate * (0.8 + Math.min(0.6, s.h));
        if (!t && s.a < 0.02) sprites.delete(k);
      }
      // 背の高い順に（数が多いときは低いものから捨てる）
      const list = [...sprites.values()].sort((a, b) => b.h - a.h).slice(0, MAX);
      let L = 0, sx = 0, sy = 0, sz = 0, sw = 0, top = 0;
      list.forEach((s, i) => {
        const m = metas[s.src];
        // 映像の炎は窓の高さの約8割。重なりで明るくなりすぎないよう、高さの平方根で薄める
        const H = s.h * 1.3 + 0.03, W = H * (m.fw / m.fh) * 1.15;
        const fi = Math.floor(s.f) % m.frames;
        const gain = s.a * Math.min(1, 0.35 + s.h * 2.5) / Math.sqrt(1 + list.length * 0.25);
        aSprite.setXYZW(i, s.src, s.f % m.frames, s.flip, gain);
        aCenter.setXYZ(i, s.x + s.jx, s.y - 0.01, s.z + s.jz);
        aSize.setXY(i, W, H);
        const l = m.lum[fi] * gain * W * H;
        L += l; sx += s.x * l; sy += (s.y + H * 0.35) * l; sz += s.z * l; sw += l; top = Math.max(top, s.y + H);
      });
      geo.instanceCount = list.length;
      aSprite.needsUpdate = aCenter.needsUpdate = aSize.needsUpdate = true;
      light = L;
      if (sw > 0) haze = { x: sx / sw, y: sy / sw, z: sz / sw, h: top - sy / sw, w: Math.sqrt(sw) };
      else haze = { ...haze, h: 0 };
    },
  };
}
