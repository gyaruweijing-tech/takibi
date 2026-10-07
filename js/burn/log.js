// 1本の薪＝小さなマス目の集まり（Gemini 設計書のセル・オートマトン）
// マスの状態：0 生 / 1 着火中（熱分解でガスが出始め）/ 2 燃焼中（ガスに火がついている）/ 3 炭（ガスが尽きた）
// 画面にも物理エンジンにも依存しない（node でも回せる）
import { TYPES, P } from './types.js';

let nextId = 1;

// ポアソン分布の乱数（平均 lam の個数）
function poisson(lam, rnd) {
  const L = Math.exp(-lam); let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L && k < 500);
  return k - 1;
}

export function makeLog(key, rnd = Math.random) {
  const t = TYPES[key];
  const j = () => 0.9 + rnd() * 0.2;
  const L = t.L * j(), w = t.w * j(), h = t.h * j();
  const [nx, ny, nz] = t.cells;
  const n = nx * ny * nz;
  const dx = L / nx, dy = h / ny, dz = w / nz;
  const vCell = dx * dy * dz;
  const dry = t.rho * vCell;
  const log = {
    id: nextId++, key, t, L, w, h, nx, ny, nz, n, dx, dy, dz,
    vol0: dry * P.volFrac, char0: dry * P.charFrac, water0: dry * t.moist * (0.85 + rnd() * 0.3),
    T: new Float32Array(n).fill(P.TA),
    vol: new Float32Array(n), char: new Float32Array(n), water: new Float32Array(n),
    area: new Float32Array(n),       // 空気に触れている面積
    state: new Uint8Array(n),
    pyro: new Float32Array(n),       // いまガスが出ている速さ kg/s
    flaming: new Uint8Array(n),
    glow: new Float32Array(n),       // 炭が燃えている強さ 0..1
    // 1マスあたりの見た目の値（燃えて痩せた割合など）は描画側が読む
    pos: new Float32Array(n * 3),    // 世界座標（毎ステップ更新）
    pose: { p: [0, 0, 0], q: [0, 0, 0, 1] },
    nodes: [],                       // 水分のたまり
    hrr: 0, smoke: 0, steam: 0, evap: 0,
    age: 0,
  };
  log.vol.fill(log.vol0); log.char.fill(log.char0);
  for (let i = 0; i < n; i++) log.water[i] = log.water0 * (0.8 + rnd() * 0.4);
  // 外に面している面の数 × 面積
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    let a = 0;
    if (ix === 0) a += dy * dz; if (ix === nx - 1) a += dy * dz;
    if (iy === 0) a += dx * dz; if (iy === ny - 1) a += dx * dz;
    if (iz === 0) a += dx * dy; if (iz === nz - 1) a += dx * dy;
    log.area[idx(log, ix, iy, iz)] = a * t.areaMul;
  }
  // 水分のたまり（ポアソン点過程）：湿った木ほど多い。大きさもばらつく
  const lit = L * w * h * 1000;
  const count = poisson(t.pockets * lit, rnd);
  for (let k = 0; k < count; k++) {
    log.nodes.push({
      cell: Math.floor(rnd() * n),
      size: 0.2 + rnd() ** 2 * 1.6,            // 大半は小さく、たまに大きい
      burst: 105 + rnd() * 70,                 // 何℃で破裂するか（木の強さのばらつき）
      done: false,
    });
  }
  return log;
}

export function idx(log, ix, iy, iz) { return ix + log.nx * (iy + log.ny * iz); }

// マスの中心（薪の中の座標。中心が原点、x が長さ方向）
export function localOf(log, i) {
  const ix = i % log.nx, iy = Math.floor(i / log.nx) % log.ny, iz = Math.floor(i / (log.nx * log.ny));
  return [(ix + 0.5) * log.dx - log.L / 2, (iy + 0.5) * log.dy - log.h / 2, (iz + 0.5) * log.dz - log.w / 2];
}

export function rotate(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

export function updatePositions(log) {
  const { p, q } = log.pose;
  for (let i = 0; i < log.n; i++) {
    const r = rotate(q, localOf(log, i));
    log.pos[i * 3] = p[0] + r[0]; log.pos[i * 3 + 1] = p[1] + r[1]; log.pos[i * 3 + 2] = p[2] + r[2];
  }
}

// 燃え残りの割合（0..1）
export function remaining(log) {
  let s = 0; for (let i = 0; i < log.n; i++) s += log.vol[i] + log.char[i];
  return s / (log.n * (log.vol0 + log.char0));
}
export function cellLeft(log, i) { return (log.vol[i] + log.char[i]) / (log.vol0 + log.char0); }

// 長さ方向の1切れ（ix）の燃え残り
export function sliceLeft(log, ix) {
  let s = 0, c = 0;
  for (let iz = 0; iz < log.nz; iz++) for (let iy = 0; iy < log.ny; iy++) { s += cellLeft(log, idx(log, ix, iy, iz)); c++; }
  return s / c;
}

// 折れる：ix の所で2本に分ける（それぞれが元の中身を引き継ぐ）
export function splitLog(log, cut) {
  const parts = [];
  for (const [a, b] of [[0, cut], [cut + 1, log.nx]]) {
    const nx = b - a; if (nx < 1) continue;
    const q = makeEmptyLike(log, nx);
    for (let iz = 0; iz < log.nz; iz++) for (let iy = 0; iy < log.ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const s = idx(log, a + ix, iy, iz), d = idx(q, ix, iy, iz);
      for (const f of ['T', 'vol', 'char', 'water', 'glow']) q[f][d] = log[f][s];
      q.state[d] = log.state[s];
    }
    q.nodes = log.nodes.filter((nd) => { const ix = nd.cell % log.nx; return ix >= a && ix < b; })
      .map((nd) => ({ ...nd, cell: idx(q, (nd.cell % log.nx) - a, Math.floor(nd.cell / log.nx) % log.ny, Math.floor(nd.cell / (log.nx * log.ny))) }));
    const off = ((a + b) / 2) * log.dx - log.L / 2;
    const r = rotate(log.pose.q, [off, 0, 0]);
    q.pose = { p: [log.pose.p[0] + r[0], log.pose.p[1] + r[1], log.pose.p[2] + r[2]], q: [...log.pose.q] };
    q.age = log.age;
    parts.push(q);
  }
  return parts;
}

function makeEmptyLike(log, nx) {
  const n = nx * log.ny * log.nz;
  const q = {
    ...log, id: nextId++, nx, n, L: nx * log.dx,
    T: new Float32Array(n), vol: new Float32Array(n), char: new Float32Array(n), water: new Float32Array(n),
    area: new Float32Array(n), state: new Uint8Array(n), pyro: new Float32Array(n), flaming: new Uint8Array(n),
    glow: new Float32Array(n), pos: new Float32Array(n * 3), nodes: [], hrr: 0, smoke: 0, steam: 0, evap: 0,
  };
  const { dx, dy, dz, ny, nz } = log;
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    let a = 0;
    if (ix === 0) a += dy * dz; if (ix === nx - 1) a += dy * dz;   // 折れ口も空気に触れる
    if (iy === 0) a += dx * dz; if (iy === ny - 1) a += dx * dz;
    if (iz === 0) a += dx * dy; if (iz === nz - 1) a += dx * dy;
    q.area[idx(q, ix, iy, iz)] = a * log.t.areaMul;
  }
  return q;
}

// 保存用：マスの中身を素の配列へ／戻す（大きさ・はぜの種も含めて元どおりにする）
const SAVE_FIELDS = ['T', 'vol', 'char', 'water', 'glow'];
export function serializeLog(log) {
  const o = { key: log.key, L: log.L, w: log.w, h: log.h, nx: log.nx, vol0: log.vol0, char0: log.char0, water0: log.water0, age: log.age, pose: log.pose, nodes: log.nodes };
  for (const f of SAVE_FIELDS) o[f] = Array.from(log[f], (v) => +v.toFixed(5));
  return o;
}
export function restoreLog(o) {
  const base = makeLog(o.key);
  const log = o.nx === base.nx ? base : makeEmptyLike(base, o.nx);
  Object.assign(log, { L: o.L, w: o.w, h: o.h, vol0: o.vol0, char0: o.char0, water0: o.water0, age: o.age, pose: o.pose, nodes: o.nodes });
  log.dx = o.L / log.nx; log.dy = o.h / log.ny; log.dz = o.w / log.nz;
  for (let iz = 0; iz < log.nz; iz++) for (let iy = 0; iy < log.ny; iy++) for (let ix = 0; ix < log.nx; ix++) {
    let a = 0;
    if (ix === 0) a += log.dy * log.dz; if (ix === log.nx - 1) a += log.dy * log.dz;
    if (iy === 0) a += log.dx * log.dz; if (iy === log.ny - 1) a += log.dx * log.dz;
    if (iz === 0) a += log.dx * log.dy; if (iz === log.nz - 1) a += log.dx * log.dy;
    log.area[idx(log, ix, iy, iz)] = a * log.t.areaMul;
  }
  for (const f of SAVE_FIELDS) log[f].set(o[f]);
  for (let i = 0; i < log.n; i++) log.state[i] = log.vol[i] < log.vol0 * 0.1 ? 3 : 0;
  return log;
}
