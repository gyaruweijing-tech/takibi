// 場面：草の上の焚き火台、後ろに岩、奥に木。座って見下ろす目線（本人の写真の構図）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TRAY } from './burn/fire.js';

const TEX = 'assets/polyhaven/textures/';
const loader = new THREE.TextureLoader();
export const texCache = {};

// Poly Haven の1組（色・法線・AO/粗さ/金属）を読み込む
export function pbr(id, repeat = 1) {
  const key = id + repeat;
  if (texCache[key]) return texCache[key];
  const t = (map, color) => {
    const x = loader.load(`${TEX}${id}/${id}_${map}_2k.jpg`);
    x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(repeat, repeat);
    x.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    x.anisotropy = 8;
    return x;
  };
  return (texCache[key] = { map: t('diff', true), normalMap: t('nor_gl'), aoMap: t('arm'), roughnessMap: t('arm') });
}

export function createRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio));
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;   // VSM はぼかしの計算が重かった（Iris Xe で約20ms）
  r.shadowMap.autoUpdate = false;             // 影は2コマに1回だけ描き直す（main.js）
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

export async function buildScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020203);
  scene.fog = new THREE.FogExp2(0x020203, 0.09);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.03, 60);
  camera.position.set(0, 0.95, 1.55);

  // 夜空の光（ほんのわずか）。月のない夜なので、ほぼ焚き火の光だけになる
  scene.add(new THREE.HemisphereLight(0x2a3a58, 0x0c0a08, 0.3));
  const moon = new THREE.DirectionalLight(0x8aa0d0, 0.08);
  moon.position.set(-3, 6, -2);
  scene.add(moon);

  // 焚き火の光（影を落とす）と、熾火の赤い光（影なし）
  const fireLight = new THREE.PointLight(0xffc088, 10, 0, 2);
  fireLight.position.set(0, TRAY.y + 0.18, 0);
  fireLight.castShadow = true;
  fireLight.shadow.mapSize.set(512, 512);
  fireLight.shadow.camera.near = 0.05; fireLight.shadow.camera.far = 12;
  fireLight.shadow.bias = -0.0005; fireLight.shadow.radius = 14; fireLight.shadow.blurSamples = 16;
  scene.add(fireLight);
  // 照り返し（草・岩・台に跳ね返った光）：影を作らない弱い光で、影の中を真っ暗にしない
  const bounce = new THREE.PointLight(0xffb070, 0, 0, 2);
  scene.add(bounce);
  fireLight.userData.bounce = bounce;
  // 熾火の光は上にだけ届く（トレーの下は照らさない）
  const emberLight = new THREE.SpotLight(0xff5a1e, 0, 3, Math.PI / 2 * 0.98, 0.6, 2);
  emberLight.position.set(0, TRAY.y + 0.05, 0);
  emberLight.target.position.set(0, 2, 0);
  scene.add(emberLight, emberLight.target);

  // 地面：草と土
  const g = pbr('grass_ground', 14);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30, 1, 1), new THREE.MeshStandardMaterial({ ...g, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) }));
  ground.geometry.setAttribute('uv1', ground.geometry.attributes.uv);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const grass = makeGrass(); grass.name = 'grass'; scene.add(grass);

  const stand = makeStand();
  scene.add(stand);

  // 後ろの岩（本人の写真では横長の岩）
  const gl = new GLTFLoader();
  const rockScene = (await loadGltf(gl, 'assets/polyhaven/models/namaqualand_boulder_05/', 'namaqualand_boulder_05_1k.gltf')).scene;
  const box = new THREE.Box3().setFromObject(rockScene), size = box.getSize(new THREE.Vector3());
  const s = 1.5 / Math.max(size.x, size.z);
  rockScene.scale.set(s * 1.2, s * 1.6, s * 0.8);
  rockScene.position.set(-0.55, -box.min.y * s * 1.6 - 0.05, -1.25);
  rockScene.rotation.y = 0.25;
  rockScene.name = 'rock';
  rockScene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(rockScene);

  // 奥の木（幹だけ。上は闇に消える）
  const bark = pbr('bark_brown_02', 1);
  for (const [x, z, r, lean] of [[-2.2, -3.2, 0.13, 0.05], [1.6, -3.8, 0.11, -0.08], [2.6, -2.6, 0.16, 0.03], [-0.6, -5.5, 0.1, 0], [3.8, -5, 0.14, 0.1]]) {
    const geo = new THREE.CylinderGeometry(r * 0.8, r, 9, 18, 8);
    const mat = new THREE.MeshStandardMaterial({ ...bark, roughness: 1 });
    const tr = new THREE.Mesh(geo, mat);
    tr.geometry.setAttribute('uv1', tr.geometry.attributes.uv);
    tr.position.set(x, 4.5, z); tr.rotation.z = lean; tr.name = 'tree';
    tr.castShadow = true; tr.receiveShadow = true;
    scene.add(tr);
  }

  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  return { scene, camera, fireLight, emberLight, stand };
}

// glTF の形のデータは公開前の検査を通すため数字の JSON にしてある（tools/clean-assets.mjs）。読むときに元のバイト列へ戻す
async function loadGltf(gl, base, file) {
  const j = await (await fetch(base + file)).json();
  for (const b of j.buffers) {
    if (!b.uri?.endsWith('.bytes.json')) continue;
    const bytes = new Uint8Array(await (await fetch(base + b.uri)).json());
    b.uri = URL.createObjectURL(new Blob([bytes]));
  }
  return gl.parseAsync(JSON.stringify(j), base);
}

// 焚き火台：ステンレスの四角いトレー＋X字の脚
function makeStand() {
  const grp = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9b6b0, metalness: 1, roughness: 0.38 });
  const soot = sootTexture();
  const trayMat = new THREE.MeshStandardMaterial({ color: 0xb9b6b0, metalness: 1, roughness: 0.45, map: soot, roughnessMap: soot });
  const W = TRAY.x * 2 + 0.02, D = TRAY.z * 2 + 0.02, rim = 0.035, t = 0.002;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, t, D), trayMat);
  floor.position.y = TRAY.y - t / 2;
  grp.add(floor);
  // 縁は少し外に開く
  for (const [w, d, x, z, rx, rz] of [[W, t, 0, D / 2, -0.25, 0], [W, t, 0, -D / 2, 0.25, 0], [t, D, W / 2, 0, 0, 0.25], [t, D, -W / 2, 0, 0, -0.25]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, rim, d), trayMat);
    m.position.set(x, TRAY.y + rim / 2 - 0.002, z); m.rotation.set(rx, 0, rz);
    grp.add(m);
  }
  // 脚：X 字に交差する細い棒
  const leg = (a, b) => {
    const v = new THREE.Vector3().subVectors(b, a), len = v.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, 8), steel);
    m.position.copy(a).addScaledVector(v, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
    grp.add(m);
  };
  const y = TRAY.y - 0.01, fx = TRAY.x * 0.85, fz = TRAY.z * 0.85;
  leg(new THREE.Vector3(-fx, y, fz), new THREE.Vector3(fx * 0.9, 0, -fz * 0.6));
  leg(new THREE.Vector3(fx, y, fz), new THREE.Vector3(-fx * 0.9, 0, -fz * 0.6));
  leg(new THREE.Vector3(-fx, y, -fz), new THREE.Vector3(fx * 0.9, 0, fz * 0.6));
  leg(new THREE.Vector3(fx, y, -fz), new THREE.Vector3(-fx * 0.9, 0, fz * 0.6));
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

// 使い込んだトレーの煤（すす）と焼け色
function sootTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#d8d6d2'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const r = 10 + Math.random() * 60, px = 128 + (Math.random() - 0.5) * 200, py = 128 + (Math.random() - 0.5) * 160;
    const gr = x.createRadialGradient(px, py, 0, px, py, r);
    const col = Math.random() < 0.3 ? '120,95,70' : '40,36,32';
    gr.addColorStop(0, `rgba(${col},0.12)`); gr.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = gr; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 草：細い葉を何万本も（風で少し揺れる）
function makeGrass() {
  const blade = new THREE.PlaneGeometry(0.008, 1, 1, 4);
  blade.translate(0, 0.5, 0);
  const pos = blade.attributes.position;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setX(i, pos.getX(i) * (1 - y * 0.9)); pos.setZ(i, y * y * 0.25); }
  blade.computeVertexNormals();
  const N = 20000;   // 6万本だと Iris Xe で1コマ約40ms。暗くて見えない遠くを減らして手前に集めた
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });   // 草は光沢が要らないので軽い計算に
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 };
    mat.userData.shader = sh;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float sway = sin(uTime * 1.3 + instanceMatrix[3].x * 3.0 + instanceMatrix[3].z * 2.0) * 0.05 * position.y * position.y;
      transformed.x += sway;`);
  };
  const mesh = new THREE.InstancedMesh(blade, mat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  let k = 0;
  while (k < N) {
    const r = 0.12 + Math.random() ** 0.85 * 2.0, a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 1.1 - 0.4;
    // 台の真下は熱で草が枯れて薄い（縁はぼかす）
    const el = Math.hypot(x / 0.3, z / 0.24);
    if (Math.random() < 1.2 - el * 0.8) continue;
    const h = 0.04 + Math.random() ** 2 * 0.12;
    e.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5); q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1 + Math.random(), h, 1));
    mesh.setMatrixAt(k, m);
    const dry = Math.random();
    c.setRGB(0.16 + dry * 0.25, 0.22 + dry * 0.12, 0.06 + dry * 0.04);
    mesh.setColorAt(k, c);
    k++;
  }
  mesh.receiveShadow = true;
  return mesh;
}
