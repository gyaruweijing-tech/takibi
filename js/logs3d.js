// 薪の見た目：割り薪・小枝の束・丸めた新聞紙の形を作り、燃え方（マス目の値）を頂点に流し込む
// 焦げ → 黒い炭（ワニ皮のひび）→ ひびの奥が赤く光る（黒体放射）→ 白い灰をかぶる、を1つのシェーダーで描く
import * as THREE from 'three';
import { pbr } from './scene.js';
import { P } from './burn/types.js';

export const shared = { uTime: { value: 0 } };

const GLSL_COMMON = /* glsl */`
uniform float uTime;
varying vec3 vLocal; varying float vChar; varying float vTemp; varying float vAsh;
vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453); }
// ワニ皮のひび：3D のボロノイの境目（木目に沿って長い区画）
float crackPattern(vec3 p){
  p *= vec3(38.0, 62.0, 62.0);
  vec3 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
  for (int z=-1; z<=1; z++) for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++){
    vec3 g = vec3(x,y,z); vec3 o = hash3(i+g); vec3 r = g + o - f; float d = dot(r,r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return 1.0 - smoothstep(0.0, 0.12, sqrt(d2) - sqrt(d1));
}
float vnoise(vec3 p){ return hash3(floor(p)).x; }
// 黒体放射の色（温度 K → 線形 RGB）
vec3 blackbody(float k){
  float t = k / 100.0; vec3 c;
  c.r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
  c.g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0) : clamp(1.129891 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
  c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432068 * log(t - 10.0) - 1.1962541, 0.0, 1.0));
  return pow(c, vec3(2.2));
}`;

function patch(mat, kind) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = GLSL_COMMON + '\nattribute float aChar; attribute float aTemp; attribute float aAsh; attribute float aShrink;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed -= objectNormal * aShrink;
        vLocal = position; vChar = aChar; vTemp = aTemp; vAsh = aAsh;`);
    sh.fragmentShader = GLSL_COMMON + '\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        ${kind === 'end' ? `
        // 木口：年輪（芯は割り薪の角）
        float rr = length(vLocal.yz - vec2(-0.03, 0.0)) * 260.0;
        float ring = smoothstep(0.35, 0.5, abs(fract(rr + vnoise(vLocal * 40.0) * 0.4) - 0.5));
        diffuseColor.rgb = mix(vec3(0.62, 0.46, 0.30), vec3(0.50, 0.34, 0.20), ring) * (0.85 + 0.3 * vnoise(vLocal * 300.0));` : ''}
        float crack = crackPattern(vLocal);
        float n = vnoise(vLocal * 140.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.36, 0.24), smoothstep(0.02, 0.35, vChar));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.02, 0.018) * (0.6 + 0.8 * n), smoothstep(0.3, 0.75, vChar));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.43, 0.40) * (0.7 + 0.5 * n), clamp(vAsh * (1.0 - crack * 0.85), 0.0, 1.0));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.97, smoothstep(0.3, 0.8, vChar));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float glow = pow(clamp((vTemp - 450.0) / 600.0, 0.0, 1.0), 2.2) * 2.6;
          float breathe = 0.75 + 0.5 * sin(uTime * (0.7 + n) + n * 30.0);
          float pat = mix(0.12, 1.0, crackPattern(vLocal)) * (1.0 - vAsh * 0.55) * breathe;
          totalEmissiveRadiance += blackbody(vTemp + 273.0) * glow * pat * smoothstep(0.4, 0.85, vChar);
        }`);
  };
  mat.customProgramCacheKey = () => 'log-' + kind;
  return mat;
}

let mats = null;
function materials() {
  if (mats) return mats;
  const plank = pbr('raw_plank_wall', 1);
  mats = {
    pine: patch(new THREE.MeshStandardMaterial({ ...pbr('pine_bark', 1) }), 'bark'),
    oak: patch(new THREE.MeshStandardMaterial({ ...pbr('bark_brown_02', 1) }), 'bark'),
    damp: patch(new THREE.MeshStandardMaterial({ ...pbr('bark_brown_02', 1), color: 0x8a8a80 }), 'bark'),
    split: patch(new THREE.MeshStandardMaterial({ ...plank }), 'split'),
    splitDamp: patch(new THREE.MeshStandardMaterial({ ...plank, color: 0x9a948a }), 'split'),
    end: patch(new THREE.MeshStandardMaterial({ roughness: 0.9 }), 'end'),
    paper: patch(new THREE.MeshStandardMaterial({ map: newsprint(), roughness: 0.95 }), 'paper'),
  };
  return mats;
}

// 新聞紙の柄（読めない細かい文字の並び）
function newsprint() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#dcd8cc'; x.fillRect(0, 0, 512, 512);
  x.fillStyle = '#4a4844';
  for (let col = 0; col < 6; col++) for (let row = 0; row < 70; row++) {
    if (Math.random() < 0.08) continue;
    const w = 50 + Math.random() * 25;
    x.globalAlpha = 0.35 + Math.random() * 0.3;
    x.fillRect(10 + col * 84, 8 + row * 7.2, w, 3);
  }
  x.globalAlpha = 0.8; x.fillRect(20, 120, 220, 16); x.fillRect(280, 300, 180, 12);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const rand = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// 割り薪：丸太を割った扇形の断面（芯が下の角、樹皮が上の弧）を長さ方向に伸ばす
function splitGeometry(log) {
  const { L, w, h } = log, r = rand(log.id * 7919 + 1);
  const sec = [];
  sec.push([0, -h / 2, 'split']);
  sec.push([-w / 2, h * 0.08, 'split']);
  const ARC = 9;
  for (let k = 0; k <= ARC; k++) {
    const a = k / ARC, z = -w / 2 + a * w;
    const y = h * 0.08 + (h / 2 - h * 0.08) * Math.sqrt(Math.max(0, 1 - (2 * z / w) ** 2));
    sec.push([z, y, 'bark']);
  }
  sec.push([0, -h / 2, 'split']);
  const NX = 16, roll = r() < 0.5 ? 1 : -1;
  const pos = [], uv = [], groups = { bark: [], split: [], end: [] };
  const verts = [];
  const bump = []; for (let i = 0; i <= NX; i++) bump.push(1 + (r() - 0.5) * 0.08);
  for (let i = 0; i <= NX; i++) {
    const x = -L / 2 + (i / NX) * L;
    for (let k = 0; k < sec.length; k++) {
      const [z, y] = sec[k];
      verts.push([x, y * bump[i], z * roll * bump[i]]);
    }
  }
  const S = sec.length;
  // 側面：同じ種類の辺ごとに四角形（つなぎ目は頂点を分けて、法線をとがらせる）
  for (let k = 0; k < S - 1; k++) {
    const type = sec[k][2] === 'bark' && sec[k + 1][2] === 'bark' ? 'bark' : 'split';
    for (let i = 0; i < NX; i++) {
      const a = verts[i * S + k], b = verts[(i + 1) * S + k], c = verts[(i + 1) * S + k + 1], d = verts[i * S + k + 1];
      const base = pos.length / 3;
      for (const v of [a, b, c, d]) pos.push(...v);
      const u0 = i / NX * L / 0.5, u1 = (i + 1) / NX * L / 0.5;
      const v0 = type === 'bark' ? k / S * 0.6 : 0.31 + k * 0.015, v1 = type === 'bark' ? (k + 1) / S * 0.6 : 0.31 + (k + 1) * 0.015 + 0.06;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      groups[type].push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // 両端（木口）
  for (const [i, sgn] of [[0, -1], [NX, 1]]) {
    const cx = verts[i * S][0];
    const base = pos.length / 3;
    pos.push(cx, 0, 0); uv.push(0.5, 0.5);
    for (let k = 0; k < S - 1; k++) { pos.push(...verts[i * S + k]); uv.push(0, 0); }
    for (let k = 0; k < S - 1; k++) {
      const a = base + 1 + k, b = base + 1 + ((k + 1) % (S - 1));
      if (sgn > 0) groups.end.push(base, a, b); else groups.end.push(base, b, a);
    }
  }
  return finish(pos, uv, groups, ['bark', 'split', 'end']);
}

// 小枝の束：細い枝を数本
function twigGeometry(log) {
  const r = rand(log.id * 131 + 7), pos = [], uv = [], groups = { bark: [], end: [] };
  const n = 7;
  for (let t = 0; t < n; t++) {
    const rad = 0.004 + r() * 0.004, z0 = (r() - 0.5) * log.w * 0.8, y0 = (r() - 0.5) * log.h * 0.7;
    const bend = (r() - 0.5) * 0.02, len = log.L * (0.8 + r() * 0.2), seg = 8, rs = 6;
    for (let i = 0; i < seg; i++) for (let k = 0; k < rs; k++) {
      const q = [[i, k], [i + 1, k], [i + 1, k + 1], [i, k + 1]];
      const base = pos.length / 3;
      for (const [ii, kk] of q) {
        const x = -len / 2 + ii / seg * len, a = kk / rs * Math.PI * 2, s = Math.sin((ii / seg) * Math.PI) * bend;
        pos.push(x, y0 + Math.sin(a) * rad + s, z0 + Math.cos(a) * rad);
        uv.push(ii / seg * 2, kk / rs * 0.15);
      }
      groups.bark.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return finish(pos, uv, groups, ['bark', 'end']);
}

// 丸めた新聞紙：くしゃくしゃの球
function paperGeometry(log) {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.attributes.position, r = rand(log.id * 17 + 3), seeds = [];
  for (let k = 0; k < 9; k++) seeds.push([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, 0.1 + r() * 0.25]);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    let d = 1;
    for (const [a, b, c, s] of seeds) d -= s * Math.max(0, v.x * a + v.y * b + v.z * c - 0.3);
    d += (Math.sin(v.x * 23 + v.y * 17) + Math.sin(v.z * 29 - v.y * 13)) * 0.04;
    p.setXYZ(i, v.x * d * log.L / 2, v.y * d * log.h / 2, v.z * d * log.w / 2);
  }
  g.computeVertexNormals();
  g.addGroup(0, Infinity, 0);
  return g;
}

function finish(pos, uv, groups, order) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const index = [];
  order.forEach((k, m) => { const s = index.length; index.push(...groups[k]); g.addGroup(s, groups[k].length, m); });
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export class LogView {
  constructor(log) {
    this.log = log;
    const m = materials(), t = log.t, key = log.key;
    let geo, list;
    if (t.kind === 'split') {
      geo = splitGeometry(log);
      list = [m[key], key === 'damp' ? m.splitDamp : m.split, m.end];
    } else if (t.kind === 'bundle') { geo = twigGeometry(log); list = [m.pine, m.end]; }
    else { geo = paperGeometry(log); list = [m.paper]; }
    geo.setAttribute('uv1', geo.attributes.uv);
    const n = geo.attributes.position.count;
    for (const a of ['aChar', 'aTemp', 'aAsh', 'aShrink']) geo.setAttribute(a, new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    this.mesh = new THREE.Mesh(geo, list);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.userData.logView = this;
    this.scorch = new Float32Array(log.n);
    this.bind();
  }
  // 頂点 → 近いマス8つと重み
  bind() {
    const log = this.log, p = this.mesh.geometry.attributes.position, n = p.count;
    this.ci = new Uint16Array(n * 8); this.cw = new Float32Array(n * 8);
    const cl = (v, m) => Math.min(m - 1, Math.max(0, v));
    for (let v = 0; v < n; v++) {
      const gx = (p.getX(v) + log.L / 2) / log.dx - 0.5, gy = (p.getY(v) + log.h / 2) / log.dy - 0.5, gz = (p.getZ(v) + log.w / 2) / log.dz - 0.5;
      const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz), fx = gx - x0, fy = gy - y0, fz = gz - z0;
      let k = 0;
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const ix = cl(x0 + dx, log.nx), iy = cl(y0 + dy, log.ny), iz = cl(z0 + dz, log.nz);
        this.ci[v * 8 + k] = ix + log.nx * (iy + log.ny * iz);
        this.cw[v * 8 + k] = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        k++;
      }
    }
  }
  update() {
    const log = this.log, n = log.n, geo = this.mesh.geometry;
    const C = new Float32Array(n), A = new Float32Array(n), S = new Float32Array(n);
    const thick = Math.min(log.h, log.w);
    for (let i = 0; i < n; i++) {
      this.scorch[i] = Math.max(this.scorch[i], Math.min(1, Math.max(0, (log.T[i] - 190) / 260)));
      const gone = 1 - log.vol[i] / log.vol0;
      C[i] = Math.min(1, Math.max(this.scorch[i] * 0.45, gone * 1.25));
      A[i] = gone > 0.9 ? Math.min(1, (1 - log.char[i] / log.char0) * 1.3) : 0;
      const left = (log.vol[i] + log.char[i]) / (log.vol0 + log.char0);
      S[i] = (1 - left) ** 0.8 * thick * (log.t.kind === 'ball' ? 0.6 : 0.42);
    }
    const aC = geo.attributes.aChar, aT = geo.attributes.aTemp, aA = geo.attributes.aAsh, aS = geo.attributes.aShrink;
    for (let v = 0; v < aC.count; v++) {
      let c = 0, t = 0, a = 0, s = 0;
      for (let k = 0; k < 8; k++) { const i = this.ci[v * 8 + k], w = this.cw[v * 8 + k]; c += C[i] * w; t += log.T[i] * w; a += A[i] * w; s += S[i] * w; }
      aC.array[v] = c; aT.array[v] = t; aA.array[v] = a; aS.array[v] = s;
    }
    aC.needsUpdate = aT.needsUpdate = aA.needsUpdate = aS.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.removeFromParent(); }
}

// 物理の当たり判定に使う形（凸包の点）
export function hullPoints(log) {
  const { L, w, h } = log;
  if (log.t.kind === 'split') {
    const pts = [];
    for (const x of [-L / 2, L / 2]) {
      pts.push(x, -h / 2, 0, x, h * 0.08, -w / 2, x, h * 0.08, w / 2, x, h / 2, 0, x, h * 0.4, -w * 0.3, x, h * 0.4, w * 0.3);
    }
    return new Float32Array(pts);
  }
  return null;
}
export { P };
