// 針葉樹が「燃え続けるか」を測る：表面のマスのうち炎が出ている割合を1分ごとに出す
// node tools/sustain.mjs  （2026-10-08 本人「針葉樹が最初だけ燃えて続かない」）
import { makeFire, stepFire, depositToBed, addMatch, TRAY } from '../js/burn/fire.js';
import { makeLog, splitLog } from '../js/burn/log.js';
let s = 7; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
const yaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const floor = TRAY.y;
const put = (f, k, x, y, z, q = [0, 0, 0, 1]) => { const l = makeLog(k, rnd); l.pose = { p: [x, y, z], q }; f.logs.push(l); return l; };
const scen = {
  '焚き付けの上に針葉樹1本': (f) => { put(f, 'newspaper', 0, floor + 0.05, 0); put(f, 'twig', 0, floor + 0.11, -0.02, yaw(0.3)); put(f, 'twig', 0, floor + 0.11, 0.03, yaw(-0.4)); return put(f, 'pine', 0, floor + 0.16, 0, yaw(Math.PI / 2)); },
  '焚き付けの横に針葉樹1本': (f) => { put(f, 'newspaper', 0, floor + 0.05, 0); put(f, 'twig', 0, floor + 0.11, -0.02, yaw(0.3)); put(f, 'twig', 0, floor + 0.11, 0.03, yaw(-0.4)); return put(f, 'pine', 0.09, floor + 0.03, 0, yaw(Math.PI / 2)); },
};
for (const [name, build] of Object.entries(scen)) {
  const f = makeFire(); const pine = build(f); addMatch(f, 0, floor + 0.02, 0.05);
  const row = [], left = []; let ign = null, sum = 0;
  for (let k = 0; k <= 12000; k++) {
    const ev = stepFire(f, 0.1, rnd);
    for (const e of ev) { if (e.type === 'burnout') { depositToBed(f, e.log); f.logs = f.logs.filter((l) => l !== e.log); } if (e.type === 'break') { const parts = splitLog(e.log, e.cut); f.logs = f.logs.filter((l) => l !== e.log).concat(parts); } }
    let surf = 0, fl = 0; for (let i = 0; i < pine.n; i++) if (pine.area[i] > 0) { surf++; if (pine.flaming[i]) fl++; }
    if (ign == null && fl) ign = k / 10;
    if (k % 600 === 0) { row.push(Math.round(fl / surf * 100)); let v = 0; for (let i = 0; i < pine.n; i++) v += pine.vol[i]; left.push(Math.round(v / (pine.vol0 * pine.n) * 100)); }
    if (fl / surf >= 0.3) sum += 0.1;
  }
  console.log(`${name}: 着火 ${ign == null ? 'しない' : (ign / 60).toFixed(1) + '分'} / 表面の3割以上が燃えていた時間 ${(sum / 60).toFixed(1)}分`);
  console.log('  1分ごとの燃えている割合% ' + row.join(' '));
  console.log('  1分ごとのガスになる燃料の残り% ' + left.join(' '));
}
