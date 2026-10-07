// 焚き火：全部をつなぐ
import * as THREE from 'three';
import { createRenderer, buildScene } from './scene.js';
import { createPhysics } from './physics.js';
import { makeFire, stepFire, depositToBed, addMatch, TRAY, FIELD, bedXZ } from './burn/fire.js';
import { makeLog, splitLog, serializeLog, restoreLog } from './burn/log.js';
import { LogView, shared } from './logs3d.js';
import { createFlames } from './flames.js';
import { createSparks } from './sparks.js';
import { createSmoke } from './smoke.js';
import { createBed } from './bed3d.js';
import { createPost } from './post.js';
import { createAudio } from './audio.js';
import { createHaptics } from './haptics.js';
import { createInput, startMic } from './input.js';
import { buildPiles } from './piles.js';
import { createUI } from './ui.js';

const DEBUG = new URLSearchParams(location.search).has('debug') || new URLSearchParams(location.search).has('bench');
const bench = {};
const $ = (id) => document.getElementById(id);
const toast = (msg, ms = 2600) => { if (!msg) return; const t = $('toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.opacity = 0), ms); };

// 画面の大きさが付くまで待つ（大きさ0で始めると真っ黒になる）
while (innerWidth < 2 || innerHeight < 2) await new Promise((r) => setTimeout(r, 100));

const canvas = document.createElement('canvas');
document.body.prepend(canvas);
const renderer = createRenderer(canvas);
renderer.setSize(innerWidth, innerHeight);
addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));
const { scene, camera, fireLight, emberLight, stand } = await buildScene(renderer);
const physics = await createPhysics();
const flames = await createFlames(scene);
const sparks = createSparks(scene);
const smoke = await createSmoke(scene);
const bedView = createBed(scene);
const post = createPost(renderer, scene, camera);
for (const m of [flames.mesh]) m.userData.noPick = true;
buildPiles(scene);
const haptics = createHaptics();
let audio = null;

let fire = makeFire();
const views = new Map();
if (DEBUG) window.__t = { renderer, scene, camera, physics, get fire() { return fire; }, views, flames, post };
const byMesh = (o) => { while (o) { if (o.userData.logView) return o.userData.logView; o = o.parent; } return null; };

function addLog(log, vel, spin) {
  fire.logs.push(log);
  physics.add(log, vel, spin);
  const v = new LogView(log); views.set(log.id, v); scene.add(v.mesh); v.update();
  return log;
}
function removeLog(log) {
  fire.logs = fire.logs.filter((l) => l !== log);
  physics.remove(log);
  views.get(log.id)?.dispose(); views.delete(log.id);
}

const ui = createUI({
  onSelect: (k) => input.setTool(k),
  onMode: (m) => { resetWorld(); begin(m); },
  onSound: () => { if (!audio) return false; audio.muted = !audio.muted; audio.setMuted(audio.muted); return audio.muted; },
});
const input = createInput({
  canvas, camera, scene, physics, getLogByMesh: byMesh,
  fireTargets: () => [bedView.mesh, stand, ...[...views.values()].map((v) => v.mesh)],
  onPlace(key, p, q) {
    if (fire.logs.length >= 40) { toast('台がいっぱい'); return; }
    const log = makeLog(key);
    log.pose = { p: [p.x, p.y, p.z], q: q.toArray() };
    addLog(log);
  },
  onMatch(p) {
    fire.matches.push({ x: p.x, y: p.y, z: p.z, life: 18, power: 1 });
    audio?.strike(panOf([p.x, p.y, p.z]));
  },
  onToolChange: (k, stage) => ui.setTool(k, stage),
});

// 最初からやり直す（モードを選び直す）
function resetWorld() {
  for (const l of [...fire.logs]) removeLog(l);
  fire = makeFire();
  input.setTool(null);
}

if (DEBUG) window.__t.input = input;

// 燃えている焚き火から始める：熾火を敷き、薪を組んで、1分ぶん先に燃やしておく
function prebuilt() {
  for (let b = 0; b < fire.bed.coal.length; b++) { fire.bed.coal[b] = 0.0035 + Math.random() * 0.002; fire.bed.T[b] = 620 + Math.random() * 120; fire.bed.ash[b] = 0.006; }
  const put = (key, x, y, z, yaw) => { const l = makeLog(key); l.pose = { p: [x, y, z], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)).toArray() }; addLog(l); };
  put('oak', 0, TRAY.y + 0.045, -0.04, 0.15);
  put('pine', 0.02, TRAY.y + 0.045, 0.06, -0.1);
  put('oak', -0.01, TRAY.y + 0.11, 0.01, 1.45);
  for (let i = 0; i < 300; i++) physics.step();
  for (const l of fire.logs) physics.syncPose(l);
  for (let i = 0; i < 2400; i++) handle(stepFire(fire, 0.1), true);
}

// 保存と再開（離れていた時間も、熾火はゆっくり燃え続ける）
const SAVE = 'takibi-save-v1';
function save() {
  try {
    const b = fire.bed;
    localStorage.setItem(SAVE, JSON.stringify({ at: Date.now(), time: fire.time, bed: { coal: [...b.coal], ash: [...b.ash], T: [...b.T] }, logs: fire.logs.map(serializeLog) }));
  } catch {}
}
function load() {
  let s; try { s = JSON.parse(localStorage.getItem(SAVE)); } catch { return false; }
  if (!s || !s.bed) return false;
  fire.bed.coal.set(s.bed.coal); fire.bed.ash.set(s.bed.ash); fire.bed.T.set(s.bed.T); fire.time = s.time;
  for (const o of s.logs) addLog(restoreLog(o));
  const away = Math.min(3 * 3600, (Date.now() - s.at) / 1000);
  for (let t = 0; t < away; t += 1) handle(stepFire(fire, 1), true);
  if (away > 60) {
    let hot = 0; for (const T of fire.bed.T) hot = Math.max(hot, T);
    toast(`${Math.round(away / 60)}分ぶり。` + (hot > 380 ? '灰の下に熾火が残っている' : 'すっかり冷えている'), 5000);
  }
  return true;
}

// 燃焼の出来事 → 火の粉・音・振動・物理
const v3 = new THREE.Vector3();
const panOf = (p) => { v3.set(p[0], p[1], p[2]).project(camera); return Math.max(-1, Math.min(1, v3.x)); };
function handle(events, quiet = false) {
  for (const e of events) {
    if (e.type === 'burnout') { depositToBed(fire, e.log); removeLog(e.log); if (!quiet) { audio?.collapse(panOf(e.log.pose.p)); sparks.emit(e.log.pose.p, 14, 0.8); } continue; }
    if (e.type === 'break') {
      const body = physics.body(e.log); const lv = body?.linvel() || { x: 0, y: 0, z: 0 };
      const parts = splitLog(e.log, e.cut);
      removeLog(e.log);
      for (const p of parts) addLog(p, [lv.x, lv.y, lv.z], [(Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2]);
      if (!quiet) { audio?.collapse(panOf(e.log.pose.p)); sparks.emit(e.log.pose.p, 35, 1.4); toast('薪が折れて崩れた'); }
      continue;
    }
    if (quiet) continue;
    const pan = panOf(e.pos);
    if (e.type === 'pop') { audio?.pop(e.strength, pan); haptics.pop(Math.min(1, e.strength)); sparks.emit(e.pos, 18 + Math.floor(e.strength * 20), 1.8 + e.strength); smoke.emit(e.pos, 1, 0.5); }
    else if (e.type === 'crack') { audio?.crack(e.strength, pan); haptics.crack(e.strength); sparks.emit(e.pos, 4 + Math.floor(e.strength * 6), 1.3); }
    else if (e.type === 'tick') { audio?.tick(e.strength, pan); if (Math.random() < 0.35) sparks.emit(e.pos, 1, 0.9); }
  }
}

// 熱い空気の上向きの速さ（火の粉と煙を運ぶ）
function updraft(x, y, z) {
  const b = FIELD.bin(x, z); if (b < 0) return 0.05;
  const g = FIELD.gIdx(b, y); if (g < 0) return y > 1 ? 0.25 : 0.05;
  return 0.08 + Math.sqrt(Math.max(0, fire.Tg[g] - 15) / 300) * 1.6;
}

// ── ループ
let last = performance.now(), acc = 0, burnAcc = 0, speed = 1, saveT = 0, started = false;
const prevVel = new Map();
let blow = 0, fps = 60, frames = 0, fpsT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; autoScale(); }
  shared.uTime.value = now / 1000;
  input.update(dt);
  if (started) {
    acc += dt;
    let n = 0;
    while (acc >= 1 / 60 && n++ < 3) { physics.step(); acc -= 1 / 60; }
    if (n >= 3) acc = 0;
    for (const l of fire.logs) {
      physics.syncPose(l);
      const v = views.get(l.id), b = physics.body(l);
      if (v && b) { const t = b.translation(), r = b.rotation(); v.mesh.position.set(t.x, t.y, t.z); v.mesh.quaternion.set(r.x, r.y, r.z, r.w); }
      // ぶつかった音（速さが急に変わった）
      if (b) {
        const lv = b.linvel(), pv = prevVel.get(l.id);
        if (pv) { const dv = Math.hypot(lv.x - pv.x, lv.y - pv.y, lv.z - pv.z); if (dv > 0.9) { const p = l.pose.p; audio?.thud(dv, panOf(p)); haptics.thud(dv); if (p[1] < TRAY.y + 0.12 && Math.abs(p[0]) < TRAY.x && Math.abs(p[2]) < TRAY.z) { sparks.emit(p, Math.floor(dv * 6 * hotBed()), dv * 0.5); smoke.emit([p[0], p[1], p[2]], 0, 0.35); } } }
        prevVel.set(l.id, { x: lv.x, y: lv.y, z: lv.z });
        if (p0below(l)) { removeLog(l); }
      }
    }
    blow += ((input.blowing ? 1 : 0) - blow) * Math.min(1, dt * 6);
    fire.blow = blow;
    burnAcc += dt * speed;
    let k = 0;
    while (burnAcc >= 0.1 && k++ < 40) {
      handle(stepFire(fire, 0.1));
      burnAcc -= 0.1;
      for (const l of fire.logs) if (Math.random() < 0.05) physics.shrink(l);
    }
    if (k) { for (const v of views.values()) v.update(); bedView.update(fire.bed); }
    emitAmbient(dt);
    saveT += dt; if (saveT > 10) { saveT = 0; save(); }
  }
  flames.update(fire.columns, dt);
  lightFire(dt);
  sparks.update(dt, updraft, fire.wind);
  smoke.update(dt, camera, lightState, updraft, fire.wind);
  audio?.update(fire.hrr / 1000, fire.steam, emberLight.intensity / 20, blow > 0.3, dt);
  haptics.update(fire.hrr / 1000, now);
  post.update(now / 1000, flames.haze, flames.light * 12, dt);
  renderer.shadowMap.needsUpdate = (frames & 1) === 0 || !started;
  bench.beforeRender?.(); post.render(); bench.afterRender?.();
  if (DEBUG && !bench.running) debugPanel();
}
// 重い PC では解像度を少し下げ、余裕があれば戻す（35fps 未満で下げ、55fps 超で上げる）
let slow = 0;
function autoScale() {
  if (bench.running || !started) return;
  if (fps < 35) slow++; else if (fps > 55) slow--; else slow = 0;
  if (slow >= 2) { post.setScale(post.scale - 0.1); slow = 0; }
  if (slow <= -4) { post.setScale(post.scale + 0.1); slow = 0; }
}
const p0below = (l) => l.pose.p[1] < -1;
function hotBed() { let m = 0; for (const T of fire.bed.T) m = Math.max(m, T); return Math.min(1, Math.max(0, (m - 350) / 400)); }

// 炎の映像の明るさ（コマごとに測ってある）で焚き火の光を揺らす → 炎と照り返しのゆらぎが一致する
let lightAvg = 0;
const lightState = { firePos: new THREE.Vector3(), fireCol: new THREE.Color(), emberPos: new THREE.Vector3(0, TRAY.y + 0.03, 0), emberCol: new THREE.Color() };
function lightFire(dt) {
  const hz = flames.haze;
  // 明るさは炎の熱量に比例し、ゆらぎは映像のコマの明るさ（いま／ならし）で付ける
  lightAvg += (flames.light - lightAvg) * Math.min(1, dt * 0.8);
  const flick = lightAvg > 1e-6 ? Math.min(1.8, flames.light / lightAvg) : 1;
  let kWf = 0; for (const c of fire.columns) kWf += c.Q;
  const I = 0.1 * kWf * flick;
  fireLight.intensity += (I - fireLight.intensity) * Math.min(1, dt * 20);
  const bounce = fireLight.userData.bounce;
  bounce.intensity = fireLight.intensity * 0.22; bounce.position.copy(fireLight.position).setY(TRAY.y + 0.15);
  // 光は炎の中ほどの高さから（低いと台の影が手前に長く伸びてしまう）
  if (hz.h > 0) fireLight.position.lerp(v3.set(hz.x, Math.max(TRAY.y + 0.38, hz.y + hz.h * 0.45), hz.z), Math.min(1, dt * 3));
  let glow = 0, gx = 0, gz = 0;
  for (let b = 0; b < fire.bed.T.length; b++) {
    const g = Math.max(0, (fire.bed.T[b] - 420) / 500) ** 2 * Math.min(1, fire.bed.coal[b] / 0.003);
    const [x, z] = bedXZ(b); glow += g; gx += x * g; gz += z * g;
  }
  for (const l of fire.logs) for (let i = 0; i < l.n; i++) glow += l.glow[i] * 0.05;
  emberLight.intensity = glow * 0.03;
  if (glow > 0) emberLight.position.set(gx / glow, TRAY.y + 0.06, gz / glow);
  lightState.firePos.copy(fireLight.position); lightState.fireCol.setRGB(1, 0.55, 0.22).multiplyScalar(fireLight.intensity * 0.02);
  lightState.emberPos.copy(emberLight.position); lightState.emberCol.setRGB(1, 0.3, 0.08).multiplyScalar(emberLight.intensity * 0.02);
}

// 絶えず出るもの：炎の先の火の粉・くすぶりの煙・湯気
function emitAmbient(dt) {
  for (const c of fire.columns) if (Math.random() < c.Q * 0.12 * dt) sparks.emit([c.x, c.y + c.Lf * 0.4, c.z], 1, 0.5);
  for (const l of fire.logs) {
    const top = l.pose.p;
    if (Math.random() < l.smoke * 3500 * dt) smoke.emit([top[0] + (Math.random() - 0.5) * 0.1, top[1] + 0.04, top[2] + (Math.random() - 0.5) * 0.06], 0, Math.min(1, 0.3 + l.smoke * 800));
    if (Math.random() < l.steam * 2500 * dt) smoke.emit([top[0] + (Math.random() - 0.5) * 0.1, top[1] + 0.03, top[2]], 1, Math.min(1, 0.3 + l.steam * 900));
  }
  if (Math.random() < fire.hrr / 1000 * 0.06 * dt) { const c = fire.columns[Math.floor(Math.random() * fire.columns.length)]; if (c) smoke.emit([c.x, c.y + c.Lf * 1.1, c.z], 0, 0.25); }
  // 風はゆっくり向きと強さが変わる
  const t = fire.time;
  fire.wind[0] = Math.sin(t * 0.05) * 0.12 + Math.sin(t * 0.31) * 0.05;
  fire.wind[1] = Math.cos(t * 0.04) * 0.06;
}

function debugPanel() {
  const d = $('debug'); d.style.display = 'block';
  let bedMax = 0; for (const T of fire.bed.T) bedMax = Math.max(bedMax, T);
  d.textContent = [`fps ${fps.toFixed(0)}  燃焼 ×${speed}（f）`, `経過 ${(fire.time / 60).toFixed(1)}分`, `熱 ${(fire.hrr / 1000).toFixed(1)}kW  床 ${bedMax.toFixed(0)}℃`,
    `薪 ${fire.logs.length}  炎の柱 ${fire.columns.length}`, `火の粉 ${sparks.count()}  煙 ${smoke.count()}`,
    `パチ ${fire.stats.tick}  ピシッ ${fire.stats.crack}  バチッ ${fire.stats.pop}`, `折れ ${fire.stats.break}  燃え尽き ${fire.stats.burnout}`,
    `光 ${fireLight.intensity.toFixed(0)}/${emberLight.intensity.toFixed(1)}  露出 ${renderer.toneMappingExposure.toFixed(2)}  解像度 ${post.scale.toFixed(1)}`, `吹く ${blow.toFixed(2)}  振動 ${haptics.connected ? 'あり' : 'なし'}`].join('\n');
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyF' && DEBUG) speed = speed === 1 ? 10 : 1;
  if (e.code === 'KeyM' && audio) { audio.muted = !audio.muted; audio.setMuted(audio.muted); toast(audio.muted ? '音を消した' : '音を出した'); }
  if (e.code === 'KeyV') startMic(input.st).then(() => toast('マイクで吹けます（息を吹きかける）')).catch(() => toast('マイクが使えなかった。スペースで吹けます'));
});
addEventListener('beforeunload', save);

// ── 開始画面
const go = $('go');
let hasSave = false; try { hasSave = !!localStorage.getItem(SAVE); } catch {}
go.textContent = hasSave ? '続きから' : '火をおこすところから';
go.disabled = false;
const card = go.parentElement;
const b2 = document.createElement('button'); b2.textContent = '燃えている焚き火から'; b2.style.cssText = 'margin-top:8px;background:#fbfaf7;color:#b4582a;border:1.5px solid #b4582a';
card.insertBefore(b2, $('note'));
if (hasSave) { const b3 = document.createElement('button'); b3.textContent = '最初から（火をおこす）'; b3.style.cssText = b2.style.cssText; card.insertBefore(b3, $('note')); b3.onclick = () => begin('new'); }
go.onclick = () => begin(hasSave ? 'load' : 'new');
b2.onclick = () => begin('lit');
function begin(mode) {
  if (!audio) { audio = createAudio(); audio.resume(); }
  if (mode === 'load') load();
  else if (mode === 'lit') prebuilt();
  else toast('新聞紙を置き、小枝をのせ、マッチで火をつける', 6000);
  $('start')?.remove();
  if (!started) ui.mount();
  started = true;
}
if (new URLSearchParams(location.search).has('autostart')) begin(new URLSearchParams(location.search).get('autostart') || 'lit');
requestAnimationFrame(frame);
// 検証用：画面が隠れていても進める（?tick）
if (new URLSearchParams(location.search).has('tick')) { const h = setInterval(() => { if (document.hidden) frame(performance.now()); }, 33); setTimeout(() => clearInterval(h), (+new URLSearchParams(location.search).get('tick') || 600) * 1000); }
// 重さの測定（?bench）：燃えている焚き火で、部品を1つずつ外して測る
if (new URLSearchParams(location.search).has('bench')) {
  const { runBench } = await import('./bench.js');
  if (!started) begin('lit');
  const named = (n) => { const a = []; scene.traverse((o) => { if (o.name === n) a.push(o); }); return a; };
  const hide = (name, ...ns) => ({ name, on: () => ns.forEach((n) => named(n).forEach((o) => (o.visible = false))), off: () => ns.forEach((n) => named(n).forEach((o) => (o.visible = true))) });
  const flag = (name, get, set, v) => { let old; return { name, on: () => { old = get(); set(v); }, off: () => set(old) }; };
  const hang = named('hang')[0];
  const msaa = (n) => () => { for (const rt of [post.composer.renderTarget1, post.composer.renderTarget2]) { rt.samples = n; rt.dispose(); } };
  const cases = [
    { name: '全部入り' },
    flag('炎の影なし', () => fireLight.castShadow, (v) => (fireLight.castShadow = v), false),
    flag('ランタンの影なし', () => hang.castShadow, (v) => (hang.castShadow = v), false),
    hide('草なし', 'grass'), hide('岩なし', 'rock'), hide('奥の木なし', 'tree'), hide('薪の山と台なし', 'pile', 'stool'),
    flag('ブルームなし', () => post.bloom.enabled, (v) => (post.bloom.enabled = v), false),
    flag('陽炎なし', () => post.haze.enabled, (v) => (post.haze.enabled = v), false),
    flag('仕上げなし', () => post.fin.enabled, (v) => (post.fin.enabled = v), false),
    flag('炎の絵なし', () => flames.mesh.visible, (v) => (flames.mesh.visible = v), false),
    flag('FXAAなし', () => post.fxaa.enabled, (v) => (post.fxaa.enabled = v), false),
    { name: '解像度0.8倍', on: () => post.setScale(0.8), off: () => post.setScale(1) },
    { name: '全部入り(確認)' },
  ];
  await runBench(Object.assign(bench, { renderer, frame, scene, post, cases }));
}
