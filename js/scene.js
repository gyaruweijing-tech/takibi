// 場面：草の地面に掘った石囲炉（焚き火）、後ろに岩、奥に木。座って見下ろす目線（本人の写真の構図）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAY } from './burn/fire.js';

const HOLE_R = TRAY.r + 0.07;   // 地面に空けるくぼみの穴（縁の土の斜面ぶん、囲いより少し広い）

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
  // 地面には炉のくぼみの穴を空ける（模様の大きさは前と同じ：30m に 14 回）
  const outline = new THREE.Shape([[-15, -15], [15, -15], [15, 15], [-15, 15]].map(([x, y]) => new THREE.Vector2(x, y)));
  outline.holes.push(new THREE.Path().absarc(0, 0, HOLE_R, 0, Math.PI * 2, true));
  const gGeo = new THREE.ShapeGeometry(outline, 48);
  const uvA = gGeo.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, (uvA.getX(i) + 15) / 30, (uvA.getY(i) + 15) / 30);
  gGeo.setAttribute('uv1', gGeo.attributes.uv);
  const ground = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ ...g, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const grass = makeGrass(); grass.name = 'grass'; scene.add(grass);

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
  let rockMat = null; rockScene.traverse((o) => { if (o.isMesh && !rockMat) rockMat = o.material; });
  scene.userData.rockMat = rockMat;
  const stand = makeHearth(rockMat);
  scene.add(stand);

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

// 石囲炉：地面を10cm掘ったくぼみ（焦げた土のお椀形）と、縁に半分埋まった大きな石（本人の参考画像）
// 石は低い多面体を歪めた形。色は後ろの岩と同じ素材で、火に向いた上の方ほど煤で黒い。当たり判定は physics.js
export function makeStone(seed) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv')), p = g.attributes.position;
  const r = (k) => Math.sin(seed * 12.9898 + k * 78.233) * 0.5 + 0.5;
  // 割れた平たい面を6〜7枚（角ばった岩にする。丸いと枕やパンに見える）
  const cuts = [];
  for (let k = 0; k < 7; k++) { const th = r(20 + k) * Math.PI * 2, ph = Math.acos(r(30 + k) * 2 - 1); cuts.push([new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)), 0.62 + r(40 + k) * 0.25]); }
  cuts.push([new THREE.Vector3(0, -1, 0), 0.55]);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // 大きなうねり＋割れた平たい面（丸いパンに見えないように）
    const n = 1 + 0.12 * Math.sin(x * 2.3 + r(1) * 6) * Math.sin(y * 2.1 + r(2) * 6) + 0.08 * Math.sin(z * 3.7 + r(3) * 6) + 0.04 * Math.sin((x + y + z) * 11 + r(4) * 6);
    v.set(x, y, z).multiplyScalar(n);
    for (const [ax, k] of cuts) { const d = v.dot(ax); if (d > k) v.addScaledVector(ax, k - d); }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = Math.atan2(p.getZ(i), p.getX(i)) / (Math.PI * 2) + 0.5 + seed; uv[i * 2 + 1] = p.getY(i) * 0.5 + 0.5; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('uv1', g.attributes.uv);
  return g;
}
export function stoneMaterial(rockMat, sootToFire = true) {
  const mat = rockMat ? rockMat.clone() : new THREE.MeshStandardMaterial();
  mat.color = new THREE.Color(0x5e5a56); mat.roughness = 1; mat.metalness = 0;
  if (!sootToFire) return mat;
  // 火に向いた側の上ほど煤で黒い（面の向きと高さで決める）
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vWp; varying vec3 vWn;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);');
    sh.fragmentShader = 'varying vec3 vWp; varying vec3 vWn;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { float toFire = clamp(dot(normalize(-vec3(vWp.x, 0.0, vWp.z)), vWn) * 0.8 + vWn.y * 0.5, 0.0, 1.0);
        float soot = toFire * smoothstep(-0.06, 0.08, vWp.y);
        diffuseColor.rgb *= mix(1.0, 0.22, soot); }`);
  };
  return mat;
}
function makeHearth(rockMat) {
  const grp = new THREE.Group(); grp.name = 'hearth';
  const R = TRAY.r, D = -TRAY.y;
  // くぼみ：縁（地面の高さ）から斜めに下りて、底は平ら。焦げた土
  const earth = pbr('burned_ground_01', 2);
  const prof = [[0.001, TRAY.y - 0.002], [R, TRAY.y - 0.002], [R + 0.03, TRAY.y + D * 0.45], [HOLE_R, -0.004], [HOLE_R + 0.02, 0.0]].map(([x, y]) => new THREE.Vector2(x, y));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), new THREE.MeshStandardMaterial({ ...earth, color: 0x6e655c, roughness: 1, side: THREE.DoubleSide }));
  bowl.geometry.setAttribute('uv1', bowl.geometry.attributes.uv);
  grp.add(bowl);
  // まわりの焦げた土の輪（草が焼けて土が見える）
  const scorch = new THREE.Mesh(new THREE.RingGeometry(HOLE_R, R + 0.42, 64, 1), new THREE.MeshStandardMaterial({ ...earth, color: 0x5d564f, roughness: 1, transparent: true, depthWrite: false, alphaMap: ringFade(HOLE_R / (R + 0.42)) }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.002; scorch.geometry.setAttribute('uv1', scorch.geometry.attributes.uv);
  grp.add(scorch);
  // 縁の石：大きな石を1周（隙間に小さな石）。半分ほど土に埋める
  const mat = stoneMaterial(rockMat);
  const shapes = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => makeStone(k * 0.37 + 0.11));
  const place = [];
  const n = 19;
  for (let i = 0; i < n; i++) {
    const a = (i + (Math.random() - 0.5) * 0.35) / n * Math.PI * 2, big = 0.07 + Math.random() ** 1.5 * 0.07;
    place.push({ k: i % 8, r: R + 0.06 + big * 0.5 + Math.random() * 0.02, a, s: [big * (1 + Math.random() * 0.5), big * (0.7 + Math.random() * 0.4), big * (0.8 + Math.random() * 0.4)], y: big * (0.1 + Math.random() * 0.25) });
    if (Math.random() < 0.6) { const sm = 0.035 + Math.random() * 0.025; place.push({ k: (i + 3) % 8, r: R + 0.14 + Math.random() * 0.05, a: a + Math.PI / n, s: [sm * 1.2, sm, sm], y: sm * 0.3 }); }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  shapes.forEach((g, k) => {
    const list = place.filter((p) => p.k === k); if (!list.length) return;
    const im = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((p, i) => {
      e.set((Math.random() - 0.5) * 0.7, -p.a + (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.7); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(Math.cos(p.a) * p.r, p.y, Math.sin(p.a) * p.r), q, new THREE.Vector3(...p.s));
      im.setMatrixAt(i, m4);
      const v = 0.55 + Math.random() * 0.6, warm = Math.random() < 0.35 ? 0.25 + Math.random() * 0.2 : Math.random() * 0.08;   // 灰・黒っぽい・ときどき茶
      im.setColorAt(i, new THREE.Color(v * (1 + warm * 0.4), v, v * (1 - warm)));
    });
    grp.add(im);
  });
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = o !== scorch; o.receiveShadow = true; } });
  return grp;
}
// 焦げた土の輪の縁をぼかす（内側は濃く、外へ消える）
function ringFade(inner) {   // inner：外の半径を1とした内側の半径（輪の模様は平面に貼られるので、丸いぼかし）
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'), gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, '#fff'); gr.addColorStop(inner, '#fff'); gr.addColorStop(inner + (1 - inner) * 0.35, '#bbb'); gr.addColorStop(1, '#000');
  x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
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
    // 炉と、そのまわりの焦げた土には生えない（縁はぼかす）
    const rr = Math.hypot(x, z);
    if (rr < HOLE_R + 0.12 || Math.random() < 1.4 - (rr - HOLE_R) * 2.2) continue;
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
