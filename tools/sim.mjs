// 燃焼だけを画面なしで回して、秒数を測る（数字の合わせ込みはここで）
// node tools/sim.mjs [シナリオ名] [乱数の種]
import { makeFire, stepFire, depositToBed, addMatch, TRAY, bedXZ } from '../js/burn/fire.js';
import { makeLog, splitLog } from '../js/burn/log.js';

const seed = +(process.argv[3] || 1);
let s = seed * 9301 + 49297;
const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);

const yaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const tilt = (a, r) => { // y 軸まわり r、そのあと長さ方向を a だけ持ち上げる
  const qy = yaw(r), qz = [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
  const [x1, y1, z1, w1] = qy, [x2, y2, z2, w2] = qz;
  return [w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2];
};
const put = (fire, key, x, y, z, q = [0, 0, 0, 1]) => { const l = makeLog(key, rnd); l.pose = { p: [x, y, z], q }; fire.logs.push(l); return l; };
const floor = TRAY.y;

function run(fire, seconds, onTime = () => {}) {
  const dt = 0.1, track = new Map();
  let maxLf = 0, peakKW = 0, maxSmoke = 0;
  const series = [];
  for (let k = 0; k * dt < seconds; k++) {
    const t = k * dt;
    onTime(t, fire);
    const ev = stepFire(fire, dt, rnd);
    for (const e of ev) {
      if (e.type === 'burnout') { depositToBed(fire, e.log); fire.logs = fire.logs.filter((l) => l !== e.log); mark(e.log, 'out', t); }
      if (e.type === 'break') { const parts = splitLog(e.log, e.cut); fire.logs = fire.logs.filter((l) => l !== e.log).concat(parts); for (const p of parts) track.set(p.id, { ...(track.get(e.log.id) || {}), name: (track.get(e.log.id)?.name || e.log.t.name) + '片' }); }
    }
    for (const l of fire.logs) {
      const r = track.get(l.id) || { name: l.t.name }; track.set(l.id, r);
      if (r.ign == null && l.flaming.some((f) => f)) r.ign = t;
      if (l.hrrFlame > 300) { r.flame = (r.flame || 0) + dt; r.lastFlame = t; }
      r.maxT = Math.max(r.maxT || 0, ...l.T);
    }
    for (const c of fire.columns) maxLf = Math.max(maxLf, c.Lf);
    peakKW = Math.max(peakKW, fire.hrr / 1000); maxSmoke = Math.max(maxSmoke, fire.smoke + fire.steam);
    if (k % 300 === 0) {
      let bedMax = 0, coal = 0; for (let b = 0; b < fire.bed.T.length; b++) { bedMax = Math.max(bedMax, fire.bed.T[b]); coal += fire.bed.coal[b]; }
      const lf = Math.max(0, ...fire.columns.map((c) => c.Lf));
      series.push(`${fmt(t)} ${(fire.hrr / 1000).toFixed(1)}kW 炎${(lf * 100).toFixed(0)}cm 床${bedMax.toFixed(0)}℃ 炭${(coal * 1000).toFixed(0)}g 薪${fire.logs.length}`);
    }
  }
  function mark(l, k, t) { const r = track.get(l.id); if (r) r[k] = t; }
  return { track, maxLf, peakKW, series, maxSmoke };
}
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function report(name, res, fire, extra = '') {
  console.log(`\n== ${name}（種${seed}） 最大の炎 ${(res.maxLf * 100).toFixed(0)}cm・最大 ${res.peakKW.toFixed(1)}kW ${extra}`);
  for (const [, r] of res.track) console.log(`  ${r.name}: 着火 ${r.ign == null ? 'しない' : fmt(r.ign)} / 炎 ${fmt(r.flame || 0)} / 燃え尽き ${r.out == null ? '-' : fmt(r.out)} / 最高 ${Math.round(r.maxT)}℃`);
  console.log('  はぜ', JSON.stringify(fire.stats));
}

const scen = {
  // マッチ1本：新聞紙はつく、割り薪はつかない
  match() {
    const f = makeFire();
    put(f, 'newspaper', -0.1, floor + 0.05, 0);
    put(f, 'pine', 0.08, floor + 0.035, 0);
    addMatch(f, -0.1, floor + 0.02, 0.04);
    addMatch(f, 0.08, floor + 0.01, 0.045);
    const r = run(f, 120); report('マッチだけ', r, f);
  },
  // 火おこし：新聞紙 → 小枝 → 針葉樹
  start() {
    const f = makeFire();
    put(f, 'newspaper', 0, floor + 0.05, 0);
    put(f, 'twig', 0, floor + 0.11, -0.02, yaw(0.3));
    put(f, 'twig', 0, floor + 0.11, 0.03, yaw(-0.4));
    put(f, 'pine', 0, floor + 0.16, 0, yaw(Math.PI / 2));
    addMatch(f, 0, floor + 0.02, 0.05);
    const r = run(f, 900, (t, fire) => {
      if (Math.abs(t - 240) < 0.05) put(fire, 'pine', 0.02, floor + 0.12, 0.04, yaw(0.2));
    });
    report('火おこし（新聞紙→小枝→針葉樹、4分で針葉樹をもう1本）', r, f);
    console.log(r.series.join('\n'));
  },
  // 焚き付けの横の床に、針葉樹が1本だけ寝ている（ゲームで転がり落ちたとき。2026-10-08 本人「針葉樹が燃え続かない」）
  beside() {
    const f = makeFire();
    put(f, 'newspaper', 0, floor + 0.05, 0);
    put(f, 'twig', 0, floor + 0.11, -0.02, yaw(0.3));
    put(f, 'twig', 0, floor + 0.11, 0.03, yaw(-0.4));
    put(f, 'pine', 0.09, floor + 0.03, 0, yaw(Math.PI / 2));
    addMatch(f, 0, floor + 0.02, 0.05);
    const r = run(f, 1200); report('焚き付けの横に針葉樹1本', r, f);
    console.log(r.series.filter((_, i) => i % 2 === 0).join('\n'));
  },
  // 熾火の上に1本ずつ（種類ごと）
  single() {
    for (const k of ['pine', 'oak', 'damp']) {
      const f = makeFire();
      for (let b = 0; b < f.bed.coal.length; b++) { f.bed.coal[b] = 0.004; f.bed.T[b] = 650; f.bed.ash[b] = 0.006; }
      put(f, k, 0, floor + 0.04, 0);
      const r = run(f, 1500);
      report(`熾火の上に ${k}`, r, f, `煙の最大 ${(r.maxSmoke * 1000).toFixed(2)}g/s`);
    }
  },
  // 10分に1本の広葉樹で1時間
  hour() {
    const f = makeFire();
    for (let b = 0; b < f.bed.coal.length; b++) { f.bed.coal[b] = 0.004; f.bed.T[b] = 650; f.bed.ash[b] = 0.006; }
    const r = run(f, 3600 + 1800, (t, fire) => {
      if (t < 3600 && Math.abs(t % 600) < 0.05) put(fire, 'oak', (rnd() - 0.5) * 0.1, floor + 0.04 + fire.logs.length * 0.03, (rnd() - 0.5) * 0.1, yaw(rnd() * 3));
    });
    report('10分に1本（広葉樹）で1時間＋放置30分', r, f);
    console.log(r.series.filter((_, i) => i % 4 === 0).join('\n'));
  },
};
const which = process.argv[2] || 'all';
for (const [k, fn] of Object.entries(scen)) if (which === 'all' || which === k) fn();
