// 焚き火全体：薪のマス目・炎の場・熾火の床をまとめて1ステップ進める
// 炎の大きさは「出た熱の量」から Heskestad の式（炎の高さ L = 0.235·Q^0.4 − 1.02·D）で決める。
// 炎の上の熱い空気は McCaffrey/Heskestad の煙突の式（ΔT ≈ 25·Q^(2/3)·z^(−5/3)）。風で傾く。
// 薪が密集した所は酸素が足りず燃えにくい・隙間があると燃えやすい（Gemini 設計書の「風の通り道」）
import { P } from './types.js';
import { updatePositions, remaining, sliceLeft, cellLeft, idx } from './log.js';

export const TRAY = { x: 0.21, z: 0.15, y: 0.30 };   // 焚き火台の内側（半分の幅）と底の高さ
export const PIT = { wall: 0.35, stone: 0.07 };      // 石の囲い：見えない壁の高さ（底から）と、壁の外に並ぶ石の幅
const B = 0.04;                                     // 炎の場の1マス
const GX = 24, GZ = 18, GY = 32, X0 = -GX * B / 2, Z0 = -GZ * B / 2, Y0 = 0.22;
const BED = { nx: 10, nz: 7 };
const soft = (v) => Math.min(1, Math.max(0, v));
const K4 = (T) => (T + 273.15) ** 4;

export function makeFire() {
  const nb = BED.nx * BED.nz;
  return {
    logs: [],
    F: new Float32Array(GX * GY * GZ),       // 炎に包まれている度合い 0..1
    Tg: new Float32Array(GX * GY * GZ).fill(P.TA),
    Qb: new Float32Array(GX * GZ),           // 柱ごとの炎の熱 W
    Qh: new Float32Array(GX * GZ),           // 炎にならない熱（熾火の床から上がる熱い空気）
    base: new Float32Array(GX * GZ),
    solid: new Float32Array(GX * GZ),
    O2: new Float32Array(GX * GZ).fill(1),
    columns: [],                             // 描画用：炎の柱
    bed: { coal: new Float32Array(nb), ash: new Float32Array(nb).fill(0.004), T: new Float32Array(nb).fill(P.TA), hrr: 0 },
    wind: [0, 0], blow: 0, matches: [],
    time: 0, hrr: 0, smoke: 0, steam: 0,
    stats: { pop: 0, crack: 0, tick: 0, break: 0, burnout: 0 },
  };
}

const bin = (x, z) => {
  const ix = Math.floor((x - X0) / B), iz = Math.floor((z - Z0) / B);
  return ix < 0 || iz < 0 || ix >= GX || iz >= GZ ? -1 : ix + GX * iz;
};
const gIdx = (b, y) => { const iy = Math.floor((y - Y0) / B); return iy < 0 || iy >= GY ? -1 : b + GX * GZ * iy; };
export const bedBin = (x, z) => {
  const ix = Math.floor((x + TRAY.x) / (2 * TRAY.x) * BED.nx), iz = Math.floor((z + TRAY.z) / (2 * TRAY.z) * BED.nz);
  return ix < 0 || iz < 0 || ix >= BED.nx || iz >= BED.nz ? -1 : ix + BED.nx * iz;
};
export const BED_DIM = BED;
const bedArea = (2 * TRAY.x / BED.nx) * (2 * TRAY.z / BED.nz);

// dt 秒進める。戻り値は出来事の配列
export function stepFire(fire, dt, rnd = Math.random) {
  const ev = [];
  fire.time += dt;
  const { F, Tg, O2, bed } = fire;
  fire.Qb.fill(0); fire.Qh.fill(0); fire.base.fill(9); fire.solid.fill(0);
  let hrrAll = 0, smokeAll = 0, steamAll = 0;
  for (const log of fire.logs) updatePositions(log);

  // 酸素：柱の中の薪の詰まり具合（下 15cm）
  for (const log of fire.logs) {
    const v = log.dx * log.dy * log.dz;
    for (let i = 0; i < log.n; i++) {
      const b = bin(log.pos[i * 3], log.pos[i * 3 + 2]); if (b < 0) continue;
      if (log.pos[i * 3 + 1] < TRAY.y + 0.15) fire.solid[b] += v * cellLeft(log, i);
    }
  }
  for (let b = 0; b < GX * GZ; b++) {
    const s = fire.solid[b] / (B * B * 0.12);
    O2[b] = Math.min(1.1, Math.max(0.3, 1.15 - 1.3 * s));
  }

  // 1) 薪のマス
  for (const log of fire.logs) {
    const t = log.t, n = log.n;
    log.age += dt;
    let hrr = 0, hrrF = 0, smoke = 0, steam = 0, heated = 0;
    // 湿った木：出てくる湯気がガスより多いと、炎が薄まって付かない（煙ばかり出る）
    let wl = 0; for (let i = 0; i < n; i++) wl += log.water[i];
    const wet = wl / (n * (log.vol0 + log.char0) / (P.volFrac + P.charFrac));   // いまの含水率
    const quench = Math.min(1, Math.max(0, (wet - 0.2) / 0.2));
    const T0 = log.T.slice();
    for (let i = 0; i < n; i++) {
      const x = log.pos[i * 3], y = log.pos[i * 3 + 1], z = log.pos[i * 3 + 2];
      const b = bin(x, z), g = b < 0 ? -1 : gIdx(b, y);
      const Fc = g < 0 ? 0 : F[g], Tgas = g < 0 ? P.TA : Tg[g], o2 = b < 0 ? 1 : O2[b] * (1 + fire.blow * 0.6);
      const A = log.area[i];
      const T = T0[i];
      let q = 0, pilot = false;
      if (A > 0) {
        q += A * (Fc * P.qFlame + P.hConv * (Tgas - T));
        q -= A * 0.9 * P.sigma * (K4(T) - K4(P.TA)) * (1 - 0.75 * Fc);
        // 熾火の床から（近いほど強く）
        const bb = bedBin(x, z);
        if (bb >= 0 && bed.T[bb] > T) {
          const d = Math.max(0, y - TRAY.y - bedDepth(bed, bb));
          q += A * 0.5 * 0.85 * P.sigma * (K4(bed.T[bb]) - K4(T)) * Math.exp(-d / 0.035);
          if (bed.T[bb] > 560 && d < 0.025) pilot = true;   // 真っ赤な熾火は種火になる
        }
        // マッチ
        for (const m of fire.matches) {
          const d = Math.hypot(x - m.x, (y - m.y - 0.02) * 0.6, z - m.z) - Math.min(log.dy, log.dz) / 2;
          q += A * P.qFlame * Math.exp(-((Math.max(0, d) / 0.018) ** 2)) * m.power;
        }
      }
      // 隣のマスとの熱の伝わり（炭は熱を通しにくい＝断熱層）
      const ix = i % log.nx, iy = Math.floor(i / log.nx) % log.ny, iz = Math.floor(i / (log.nx * log.ny));
      const kc = (j) => (log.vol[j] < log.vol0 * 0.15 || log.vol[i] < log.vol0 * 0.15 ? P.kChar : P.kWood);
      const nb = (j, area, dist) => { q += kc(j) * area / dist * (T0[j] - T); };
      if (ix > 0) nb(i - 1, log.dy * log.dz, log.dx); if (ix < log.nx - 1) nb(i + 1, log.dy * log.dz, log.dx);
      if (iy > 0) nb(i - log.nx, log.dx * log.dz, log.dy); if (iy < log.ny - 1) nb(i + log.nx, log.dx * log.dz, log.dy);
      const sz = log.nx * log.ny;
      if (iz > 0) nb(i - sz, log.dx * log.dy, log.dz); if (iz < log.nz - 1) nb(i + sz, log.dx * log.dy, log.dz);

      // 熱分解：ガスが出る（温度が高いほど速い）
      let mdot = 0;
      if (T > P.Tpyro && log.vol[i] > 0) {
        const r = 0.008 * t.kp * soft((T - P.Tpyro) / (540 - P.Tpyro)) ** 1.3;
        mdot = Math.min(log.vol[i] / dt, log.vol[i] * r + log.vol0 * r * 0.15);
        log.vol[i] -= mdot * dt;
        q -= mdot * P.dHpyro;
      }
      log.pyro[i] = mdot;
      // 着火：近くに炎があれば低い温度で、無ければ高い温度で
      const flux = A > 0 ? mdot / (A / Math.sqrt(t.areaMul)) : 0;   // 紙のしわの奥まで面積に数えると、炎が付かない計算になる
      const can = A > 0 && (T > P.Tauto || (T > P.Tpilot && (Fc > 0.15 || log.flaming[i] || pilot)) || (T > P.Tpilot && nearMatch(fire, x, y, z)));
      log.flaming[i] = can && flux * (1 - quench * 0.95) > (log.flaming[i] ? 0.6e-3 : 1.4e-3) ? 1 : 0;
      if (log.flaming[i]) {
        const burn = Math.min(1, o2);
        hrr += mdot * P.dHvol * burn; hrrF += mdot * P.dHvol * burn;
        smoke += mdot * (1 - burn) * 0.5;
      } else smoke += mdot;

      // 炭が燃える（ガスが出ている間は炎が酸素を奪うので燃えない。空気に触れている面だけ）
      let glowQ = 0;
      if (log.char[i] > 0 && T > P.Tchar && mdot < log.vol0 * 0.004) {
        const expo = A > 0 ? Math.sqrt(t.areaMul) : 0.04;   // 紙や葉は表面が大きく、すぐ灰になる
        const r = 0.0028 * soft((T - P.Tchar) / 420) * Math.min(1.6, o2) * expo;
        const dm = Math.min(log.char[i], log.char[i] * r * dt + log.char0 * r * 0.1 * dt);
        log.char[i] -= dm;
        glowQ = dm / dt * P.dHchar;
        q += glowQ * 0.7;
        hrr += glowQ * 0.3;
      }
      log.glow[i] = log.char[i] > 0 ? soft((T - 420) / 480) : 0;

      // 温度と水分
      const C = (log.vol[i] + log.char[i] + log.char0 * 0.08) * P.cpWood + log.water[i] * P.cpWater;
      let Tn = T + q * dt / C, ev = 0;
      if (log.water[i] > 0 && Tn > 100) {
        const excess = (Tn - Math.max(100, T)) * C;
        ev = Math.min(log.water[i], excess / P.Lv);
        log.water[i] -= ev;
        Tn = Math.max(100, T) + (excess - ev * P.Lv) / C;
      }
      log.T[i] = Math.min(1150, Math.max(P.TA - 5, Tn));
      steam += ev / dt;
      if (T > 150 && A > 0) heated++;
      log.state[i] = log.vol[i] < log.vol0 * 0.1 ? 3 : log.flaming[i] ? 2 : mdot > 0 ? 1 : 0;

      // 炎を柱へ
      if (log.flaming[i] && b >= 0) {
        const qf = mdot * P.dHvol * Math.min(1, o2);
        fire.Qb[b] += qf;
        if (y < fire.base[b]) fire.base[b] = y;
      }
    }
    // 水分のたまりが破裂する（大きいほど激しい）
    for (const nd of log.nodes) {
      if (nd.done || log.T[nd.cell] < nd.burst) continue;
      nd.done = true;
      const big = nd.size > 0.9;
      fire.stats[big ? 'pop' : 'crack']++;
      ev.push({ type: big ? 'pop' : 'crack', log, cell: nd.cell, strength: nd.size, pos: cellPos(log, nd.cell) });
    }
    // やにの小さなはぜ（パチッ）
    const hf = heated / Math.max(1, n);
    if (rnd() < t.resin * 0.3 * hf * dt) {
      const c = Math.floor(rnd() * n);
      fire.stats.tick++;
      ev.push({ type: 'tick', log, cell: c, strength: 0.3 + rnd() * 0.7, pos: cellPos(log, c) });
    }
    log.hrr = hrr; log.hrrFlame = hrrF; log.smoke = smoke; log.steam = steam;
    log.pyroAll = 0; for (let i = 0; i < n; i++) log.pyroAll += log.pyro[i];
    hrrAll += hrr; smokeAll += smoke; steamAll += steam;

    // 折れる：途中の1切れが痩せたら
    if (log.nx >= 6 && log.t.kind !== 'ball' && remaining(log) < 0.5) {
      for (let ix = 2; ix < log.nx - 2; ix++) {
        if (sliceLeft(log, ix) < 0.12 && rnd() < dt / 40) { fire.stats.break++; ev.push({ type: 'break', log, cut: ix }); break; }
      }
    }
    // 燃え尽き → 床へ
    const rem = remaining(log);
    let volLeft = 0; for (let i = 0; i < n; i++) volLeft += log.vol[i];
    if (rem < 0.05 || (volLeft < log.vol0 * n * 0.03 && rem < 0.12)) {
      fire.stats.burnout++; ev.push({ type: 'burnout', log });
    }
  }

  // 2) 熾火の床
  bedStep(fire, dt);
  for (let b = 0; b < BED.nx * BED.nz; b++) {
    const [x, z] = bedXZ(b);
    const c = bin(x, z); if (c < 0) continue;
    const ox = fire.bed._ox[b];
    // 床の熾火：炎は立たず、熱い空気だけが上がる
    fire.Qh[c] += ox * 0.25;
  }
  hrrAll += bed.hrr;

  // 3) マッチ
  for (const m of fire.matches) { m.life -= dt; const c = bin(m.x, m.z); if (c >= 0) { fire.Qb[c] += 60 * m.power; fire.base[c] = Math.min(fire.base[c], m.y); } }
  fire.matches = fire.matches.filter((m) => m.life > 0);

  buildField(fire);
  fire.hrr = hrrAll; fire.smoke = smokeAll; fire.steam = steamAll;
  return ev;
}

function nearMatch(fire, x, y, z) {
  for (const m of fire.matches) if (Math.hypot(x - m.x, y - m.y, z - m.z) < 0.05) return true;
  return false;
}
export function cellPos(log, i) { return [log.pos[i * 3], log.pos[i * 3 + 1], log.pos[i * 3 + 2]]; }

// 炎の場を作り直す：柱ごとに炎の高さを出し、上に熱い空気を伸ばす
function buildField(fire) {
  const { F, Tg, Qb, base } = fire;
  F.fill(0); Tg.fill(P.TA);
  fire.columns = [];
  const [wx, wz] = fire.wind;
  // 熾火の熱い空気（炎の無い柱）
  for (let b = 0; b < GX * GZ; b++) {
    if (fire.Qh[b] <= 0 || Qb[b] > 0) continue;
    const Q = fire.Qh[b] / 1000;
    for (let iy = Math.max(0, Math.floor((TRAY.y - Y0) / B)); iy < GY; iy++) {
      const h = Y0 + (iy + 0.5) * B - TRAY.y;
      const dT = Math.min(500, 25 * Q ** (2 / 3) * Math.max(0.04, h) ** (-5 / 3));
      if (dT < 3) break;
      const g = b + GX * GZ * iy; if (P.TA + dT > Tg[g]) Tg[g] = P.TA + dT;
    }
  }
  for (let iz = 0; iz < GZ; iz++) for (let ix = 0; ix < GX; ix++) {
    const b = ix + GX * iz;
    if (Qb[b] <= 0) continue;
    // 隣の炎とつながると高くなる
    let qn = 0, nn = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const jx = ix + dx, jz = iz + dz; if (jx < 0 || jz < 0 || jx >= GX || jz >= GZ) continue;
      const q = Qb[jx + GX * jz]; if (q > 0) { qn += q; nn++; }
    }
    const Q = (Qb[b] + 0.45 * qn) / 1000;          // kW
    const D = B * Math.sqrt(1 + nn);
    const Lf = Math.max(0, 0.235 * Q ** 0.4 - 1.02 * D * 0.5);
    const y0 = base[b];
    const x = X0 + (ix + 0.5) * B, z = Z0 + (iz + 0.5) * B;
    fire.columns.push({ x, y: y0, z, Lf, Q: Qb[b] / 1000, b });
    for (let iy = Math.max(0, Math.floor((y0 - Y0) / B)); iy < GY; iy++) {
      const y = Y0 + (iy + 0.5) * B, h = y - y0; if (h < -B) continue;
      // 風で傾く
      const sx = Math.round(wx * Math.max(0, h) * 1.5 / B), sz = Math.round(wz * Math.max(0, h) * 1.5 / B);
      const cx = ix + sx, cz = iz + sz; if (cx < 0 || cz < 0 || cx >= GX || cz >= GZ) break;
      const s = Lf > 0 ? Math.max(0, h) / Lf : 9;
      const f = s < 0.4 ? 1 : s < 1 ? (1 - s) / 0.6 : 0;
      const dT = f > 0 ? 300 + 600 * f : Math.min(800, 25 * Q ** (2 / 3) * Math.max(0.05, h) ** (-5 / 3));
      if (f <= 0 && dT < 5) break;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const jx = cx + dx, jz = cz + dz; if (jx < 0 || jz < 0 || jx >= GX || jz >= GZ) continue;
        const w = dx || dz ? 0.45 : 1;
        const g = jx + GX * jz + GX * GZ * iy;
        if (f * w > F[g]) F[g] = f * w;
        const T = P.TA + dT * w; if (T > Tg[g]) Tg[g] = T;
      }
    }
  }
}

// 熾火の床
export function bedXZ(b) {
  const ix = b % BED.nx, iz = Math.floor(b / BED.nx);
  return [-TRAY.x + (ix + 0.5) * 2 * TRAY.x / BED.nx, -TRAY.z + (iz + 0.5) * 2 * TRAY.z / BED.nz];
}
export function bedDepth(bed, b) { return (bed.coal[b] / 180 + bed.ash[b] / 300) / bedArea; }

function bedStep(fire, dt) {
  const { bed } = fire, nb = BED.nx * BED.nz;
  if (!bed._ox) bed._ox = new Float32Array(nb);
  let hrr = 0;
  const T0 = bed.T.slice();
  for (let b = 0; b < nb; b++) {
    const [x, z] = bedXZ(b);
    const c = bin(x, z), g = c < 0 ? -1 : gIdx(c, TRAY.y + 0.02);
    const Fc = g < 0 ? 0 : fire.F[g];
    const cover = bed.ash[b] / (bed.ash[b] + 0.012);            // 灰の布団
    const blow = fire.blow;
    const o2 = (c < 0 ? 1 : fire.O2[c]) * (1 + blow * 1.4);
    const T = T0[b];
    const r = 0.0016 * soft((T - 330) / 420) * o2 * (1 - 0.8 * cover * (1 - blow * 0.6));
    const ox = Math.min(bed.coal[b] / dt, bed.coal[b] * r + 0.002 * r);
    bed.coal[b] -= ox * dt; bed.ash[b] += ox * dt * 0.06;
    const Q = ox * P.dHchar;
    bed._ox[b] = Q; hrr += Q * 0.25;
    let q = Q * 0.75 + Fc * P.qFlame * bedArea * 0.25;
    q -= bedArea * 0.85 * P.sigma * (K4(T) - K4(P.TA)) * (1 - 0.85 * cover);
    q -= bedArea * 6 * (T - P.TA);
    // 隣へ熱が回る
    const ix = b % BED.nx, iz = Math.floor(b / BED.nx);
    let s = 0, k = 0;
    if (ix > 0) { s += T0[b - 1]; k++; } if (ix < BED.nx - 1) { s += T0[b + 1]; k++; }
    if (iz > 0) { s += T0[b - BED.nx]; k++; } if (iz < BED.nz - 1) { s += T0[b + BED.nx]; k++; }
    const C = bed.coal[b] * 1000 + bed.ash[b] * 800 + 15;
    q += (s / k - T) * 0.6 * (bed.coal[b] > 0.001 ? 1 : 0.2);
    bed.T[b] = Math.min(1000, Math.max(P.TA, T + q * dt / C));
  }
  bed.hrr = hrr;
}

// 燃え尽きた薪の炭と灰を床へ
export function depositToBed(fire, log) {
  const { bed } = fire;
  for (let i = 0; i < log.n; i++) {
    const b = bedBin(log.pos[i * 3], log.pos[i * 3 + 2]);
    if (b < 0) continue;
    const m = log.char[i] + log.vol[i] * 0.3;
    if (log.T[i] > bed.T[b]) bed.T[b] += (log.T[i] - bed.T[b]) * Math.min(0.6, m / (bed.coal[b] + m + 1e-6));
    bed.coal[b] += m;
    bed.ash[b] += (log.vol0 + log.char0) / (P.volFrac + P.charFrac) * 0.01;
  }
}

export function addMatch(fire, x, y, z) { fire.matches.push({ x, y, z, life: 18, power: 1 }); }
export const FIELD = { B, GX, GY, GZ, X0, Y0, Z0, gIdx, bin };
export { idx };
