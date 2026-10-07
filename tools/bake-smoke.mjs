// 煙のパラパラ漫画を焼く（EmberGen の代わり）。Gemini 設計書の「6-Way Lighting」：
// 3D の煙を計算し、右・上・手前（A）／左・下・奥（B）の6方向から光を当てたときの明るさを別々に記録する。
// ゲーム側は、焚き火や月の光の向きに合わせてこの6枚を混ぜるので、平面の絵なのに光の向きで陰影が変わる。
// node tools/bake-smoke.mjs  → assets/smoke/smoke-a.png, smoke-b.png, smoke.json
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NX = 40, NY = 72, NZ = 40, N = NX * NY * NZ;
const FRAMES = 48, SUB = 3, DT = 0.6;
const FW = 128, FH = 192, COLS = 8, ROWS = 6;
const OUT = new URL('../assets/smoke/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const I = (x, y, z) => x + NX * (y + NY * z);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const d = new Float32Array(N), t = new Float32Array(N), u = new Float32Array(N), v = new Float32Array(N), w = new Float32Array(N);
const tmp = new Float32Array(N), p = new Float32Array(N), div = new Float32Array(N);

function sample(f, x, y, z) {
  x = Math.max(0, Math.min(NX - 1.001, x)); y = Math.max(0, Math.min(NY - 1.001, y)); z = Math.max(0, Math.min(NZ - 1.001, z));
  const x0 = x | 0, y0 = y | 0, z0 = z | 0, fx = x - x0, fy = y - y0, fz = z - z0;
  const a = (i, j, k) => f[I(i, j, k)];
  const l = (a0, a1, s) => a0 + (a1 - a0) * s;
  return l(l(l(a(x0, y0, z0), a(x0 + 1, y0, z0), fx), l(a(x0, y0 + 1, z0), a(x0 + 1, y0 + 1, z0), fx), fy),
    l(l(a(x0, y0, z0 + 1), a(x0 + 1, y0, z0 + 1), fx), l(a(x0, y0 + 1, z0 + 1), a(x0 + 1, y0 + 1, z0 + 1), fx), fy), fz);
}
function advect(f) {
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = I(x, y, z);
    tmp[i] = sample(f, x - u[i] * DT, y - v[i] * DT, z - w[i] * DT);
  }
  f.set(tmp);
}
function project() {
  for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
    const i = I(x, y, z);
    div[i] = -0.5 * (u[i + 1] - u[i - 1] + v[i + NX] - v[i - NX] + w[i + NX * NY] - w[i - NX * NY]);
  }
  p.fill(0);
  for (let it = 0; it < 24; it++) for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
    const i = I(x, y, z);
    p[i] = (div[i] + p[i - 1] + p[i + 1] + p[i - NX] + p[i + NX] + p[i - NX * NY] + p[i + NX * NY]) / 6;
  }
  for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
    const i = I(x, y, z);
    u[i] -= 0.5 * (p[i + 1] - p[i - 1]); v[i] -= 0.5 * (p[i + NX] - p[i - NX]); w[i] -= 0.5 * (p[i + NX * NY] - p[i - NX * NY]);
  }
}
// 渦を保つ（数値計算で渦が消えすぎるのを戻す）
function vorticity(eps) {
  const cx = new Float32Array(N), cy = new Float32Array(N), cz = new Float32Array(N), m = new Float32Array(N);
  for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
    const i = I(x, y, z);
    cx[i] = 0.5 * ((w[i + NX] - w[i - NX]) - (v[i + NX * NY] - v[i - NX * NY]));
    cy[i] = 0.5 * ((u[i + NX * NY] - u[i - NX * NY]) - (w[i + 1] - w[i - 1]));
    cz[i] = 0.5 * ((v[i + 1] - v[i - 1]) - (u[i + NX] - u[i - NX]));
    m[i] = Math.hypot(cx[i], cy[i], cz[i]);
  }
  for (let z = 2; z < NZ - 2; z++) for (let y = 2; y < NY - 2; y++) for (let x = 2; x < NX - 2; x++) {
    const i = I(x, y, z);
    let nx = 0.5 * (m[i + 1] - m[i - 1]), ny = 0.5 * (m[i + NX] - m[i - NX]), nz = 0.5 * (m[i + NX * NY] - m[i - NX * NY]);
    const l = Math.hypot(nx, ny, nz) + 1e-6; nx /= l; ny /= l; nz /= l;
    u[i] += eps * (ny * cz[i] - nz * cy[i]) * DT; v[i] += eps * (nz * cx[i] - nx * cz[i]) * DT; w[i] += eps * (nx * cy[i] - ny * cx[i]) * DT;
  }
}

// 6方向の光の通りやすさ（軸に沿った積み上げなので速い）
function lightFields(sig) {
  const L = {}; for (const k of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) L[k] = new Float32Array(N);
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) {
    let a = 0; for (let x = NX - 1; x >= 0; x--) { const i = I(x, y, z); L.px[i] = Math.exp(-a); a += d[i] * sig; }
    a = 0; for (let x = 0; x < NX; x++) { const i = I(x, y, z); L.nx[i] = Math.exp(-a); a += d[i] * sig; }
  }
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    let a = 0; for (let y = NY - 1; y >= 0; y--) { const i = I(x, y, z); L.py[i] = Math.exp(-a); a += d[i] * sig; }
    a = 0; for (let y = 0; y < NY; y++) { const i = I(x, y, z); L.ny[i] = Math.exp(-a); a += d[i] * sig; }
  }
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    let a = 0; for (let z = NZ - 1; z >= 0; z--) { const i = I(x, y, z); L.pz[i] = Math.exp(-a); a += d[i] * sig; }
    a = 0; for (let z = 0; z < NZ; z++) { const i = I(x, y, z); L.nz[i] = Math.exp(-a); a += d[i] * sig; }
  }
  return L;
}

const atlasA = Buffer.alloc(FW * COLS * FH * ROWS * 4), atlasB = Buffer.alloc(FW * COLS * FH * ROWS * 4);
const SIG = 0.55;
for (let f = 0; f < FRAMES; f++) {
  for (let s = 0; s < SUB; s++) {
    // 最初だけ下から湧き出す（ふわっとした1つのかたまり）
    if (f < 14) for (let z = 0; z < NZ; z++) for (let y = 2; y < 12; y++) for (let x = 0; x < NX; x++) {
      const r = Math.hypot(x - NX / 2 + Math.sin(f * 0.7) * 1.5, (y - 6) * 1.4, z - NZ / 2);
      if (r < 6) { const i = I(x, y, z); const k = (1 - r / 6) * (rnd() < 0.35 ? 1.6 : 0.3); d[i] += 0.12 * k; t[i] += 0.25 * k; u[i] += (rnd() - 0.5) * 1.2; w[i] += (rnd() - 0.5) * 1.2; }
    }
    for (let i = 0; i < N; i++) { v[i] += (t[i] * 0.35 - d[i] * 0.02) * DT; t[i] *= 0.985; d[i] *= 0.997; }
    vorticity(0.9);
    // 細かい乱れ（ゆっくり変わる渦の種）
    for (let k = 0; k < 40; k++) { const x = 2 + Math.floor(rnd() * (NX - 4)), y = 2 + Math.floor(rnd() * (NY - 4)), z = 2 + Math.floor(rnd() * (NZ - 4)); const i = I(x, y, z); if (d[i] > 0.01) { u[i] += (rnd() - 0.5) * 2; w[i] += (rnd() - 0.5) * 2; } }
    project();
    advect(u); // 速度を自分自身で運ぶ（簡易）
    advect(v); advect(w); advect(d); advect(t);
  }
  const L = lightFields(SIG);
  const ox = (f % COLS) * FW, oy = Math.floor(f / COLS) * FH;
  // 手前から見て（z が大きい方が手前）光を積む
  for (let py = 0; py < FH; py++) for (let px = 0; px < FW; px++) {
    const gx = (px + 0.5) / FW * (NX - 1), gy = (1 - (py + 0.5) / FH) * (NY - 1);
    let T = 1; const c = [0, 0, 0, 0, 0, 0];
    for (let gz = NZ - 1; gz >= 0; gz -= 0.5) {
      const dd = sample(d, gx, gy, gz); if (dd < 1e-4) continue;
      const a = 1 - Math.exp(-dd * SIG * 0.5);
      const k = T * a;
      c[0] += k * sample(L.px, gx, gy, gz); c[1] += k * sample(L.py, gx, gy, gz); c[2] += k * sample(L.pz, gx, gy, gz);
      c[3] += k * sample(L.nx, gx, gy, gz); c[4] += k * sample(L.ny, gx, gy, gz); c[5] += k * sample(L.nz, gx, gy, gz);
      T *= 1 - a; if (T < 0.003) break;
    }
    const alpha = 1 - T;
    // 縁をぼかして窓の端で切れないように
    const ex = Math.min(1, px / 10, (FW - 1 - px) / 10, py / 10, (FH - 1 - py) / 10);
    const j = ((oy + py) * FW * COLS + ox + px) * 4;
    const q = (x) => Math.min(255, Math.round((alpha > 1e-3 ? x / alpha : 0) * 255));
    atlasA[j] = q(c[0]); atlasA[j + 1] = q(c[1]); atlasA[j + 2] = q(c[2]); atlasA[j + 3] = Math.round(alpha * ex * 255);
    atlasB[j] = q(c[3]); atlasB[j + 1] = q(c[4]); atlasB[j + 2] = q(c[5]); atlasB[j + 3] = Math.round(alpha * ex * 255);
  }
  process.stdout.write(`\r焼いています ${f + 1}/${FRAMES}`);
}
console.log();
await mkdir(OUT, { recursive: true });
const td = join(tmpdir(), `smoke-${process.pid}`); await mkdir(td, { recursive: true });
for (const [name, buf] of [['smoke-a', atlasA], ['smoke-b', atlasB]]) {
  const raw = join(td, name + '.rgba'); await writeFile(raw, buf);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${FW * COLS}x${FH * ROWS}`, '-i', raw, join(OUT, name + '.png')], { stdio: 'inherit' });
  if (r.status) throw new Error('ffmpeg');
}
await writeFile(join(OUT, 'smoke.json'), JSON.stringify({ frames: FRAMES, cols: COLS, rows: ROWS, fw: FW, fh: FH }));
await rm(td, { recursive: true, force: true });
console.log('assets/smoke に書き出しました');
