// 操作：棚で選ぶと、その材料がカーソルにくっついてくる。クリックでその場に置く。マッチ、火ばさみ、吹く、見回す
// 持っている物の中心はいつもカーソルの光線の上にあり、高さは「そこに置いたら止まる高さ」（物理と同じ形を真下に落として求める）
// → 画面の上で、カーソルと物がずれない。石の囲いの上では、囲いの内側に収まる所まで寄せる（見えない壁に当たる）
import * as THREE from 'three';
import { makeLog } from './burn/log.js';
import { LogView } from './logs3d.js';
import { TRAY, PIT } from './burn/fire.js';

export function createInput({ canvas, camera, scene, physics, getLogByMesh, fireTargets, onPlace, onMiss, onMatch, onToolChange }) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const view = { yaw: 0, pitch: 0.5, dist: 1.3, target: new THREE.Vector3(0, 0.36, 0) };
  const st = { tool: null, yaw: Math.random() * 6.28, down: null, look: null, sel: null, move: null, blowKey: false, blowMic: 0, last: null };

  // 持っている物（材料ごとに1回だけ作る）：囲いの上では本物の見た目、外では半透明
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffe8c8, transparent: true, opacity: 0.28, depthWrite: false });
  const ghosts = {};
  function ghostFor(key) {
    if (ghosts[key]) return ghosts[key];
    let m;
    if (key === 'match') m = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb060 }));
    else {
      const log = makeLog(key), v = new LogView(log); v.update();
      m = v.mesh; m.castShadow = true; m.userData.logView = null; m.userData.log = log;
      const dim = new THREE.Mesh(m.geometry, ghostMat); dim.raycast = () => {}; dim.renderOrder = 12; dim.visible = false;
      scene.add(dim); m.userData.dim = dim;
    }
    m.visible = false; m.raycast = () => {};
    scene.add(m);
    return (ghosts[key] = m);
  }
  const marker = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.004, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffe8c8, transparent: true, opacity: 0.6, depthWrite: false }));
  marker.rotation.x = Math.PI / 2; marker.visible = false; marker.raycast = () => {};
  scene.add(marker);

  function setRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  // 台の上の、置ける所（熾火の床・台・火の中の薪）。外れていれば台の高さの面で受ける
  function placePoint() {
    const h = ray.intersectObjects(fireTargets(), true)[0];
    let p;
    if (h) p = h.point.clone();
    else {
      const o = ray.ray.origin, d = ray.ray.direction;
      if (d.y > -1e-3) return null;
      p = o.clone().addScaledVector(d, (TRAY.y - o.y) / d.y);
    }
    if (Math.abs(p.x) > TRAY.x + 0.12 || Math.abs(p.z) > TRAY.z + 0.12) return null;
    return p;
  }
  // 持っている物の置き場所
  const OX = TRAY.x + 0.033 + PIT.stone, OZ = TRAY.z + 0.033 + PIT.stone;   // 石の囲いの外周
  const foot = (yaw, L, w) => { const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); return [c * L / 2 + s * w / 2, s * L / 2 + c * w / 2]; };
  // 長い薪が囲いの奥行きに入らない向きなら、入る所まで長い辺の向きへ回す（最小限）
  function fitYaw(yaw, L, w) {
    if (foot(yaw, L, w)[1] <= TRAY.z - 0.004) return yaw;
    const to = Math.round(yaw / Math.PI) * Math.PI;
    let a = to, b = yaw;
    for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (foot(m, L, w)[1] <= TRAY.z - 0.004) a = m; else b = m; }
    return a;
  }
  function poseAt(t, log, yaw0, inside) {
    const o = ray.ray.origin, d = ray.ray.direction;
    let x = o.x + d.x * t, z = o.z + d.z * t, yaw = yaw0;
    if (inside) {
      yaw = fitYaw(yaw0, log.L, log.w);
      const [ex, ez] = foot(yaw, log.L, log.w), mx = Math.max(0, TRAY.x - 0.004 - ex), mz = Math.max(0, TRAY.z - 0.004 - ez);
      x = clamp(x, -mx, mx); z = clamp(z, -mz, mz);
    }
    const y = physics.restY(log, x, z, yaw) ?? log.h / 2;
    return { x, y, z, yaw };
  }
  // カーソルの光線をたどって、「光線の高さ ＝ そこに置いたら止まる高さ」になる所を二分法で探す
  function holdPose(log, yaw) {
    const o = ray.ray.origin, d = ray.ray.direction;
    const t1 = d.y < -1e-3 ? Math.min(4, -o.y / d.y) : 4;
    // 囲いを狙っているか：カーソルが囲いの底の高さで指す所で決める（長い薪の先が手前の石にかかっても、囲いの中に入れる）
    const tf = d.y < -1e-3 ? (TRAY.y - o.y) / d.y : -1;
    const inside = tf > 0 && Math.abs(o.x + d.x * tf) < OX && Math.abs(o.z + d.z * tf) < OZ;
    const f = (t) => o.y + d.y * t - poseAt(t, log, yaw, inside).y;
    // 手前から順に見て、最初に「置いたら止まる高さ」を下回った区間を二分法で詰める
    let a = 0.05, b = t1;
    for (let i = 1; i <= 24; i++) { const m = a + (t1 - 0.05) / 24; if (f(m) <= 0) { b = m; break; } a = m; }
    if (f(b) <= 0) for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
    // 手の位置（いつもカーソルの光線の上）と、置かれる所。壁で止まったときだけ2つが離れる
    const P = poseAt(b, log, yaw, inside); P.inside = inside;
    P.hand = new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
    P.apart = P.hand.distanceTo(new THREE.Vector3(P.x, P.y, P.z)) > 0.015;
    return P;
  }
  const hold = { pose: null, key: '', since: 0, pred: null, predKey: '' };
  const pickLog = () => {
    for (const h of ray.intersectObjects(fireTargets(), true)) { const lv = getLogByMesh(h.object); if (lv) return lv.log; }
    return null;
  };

  function setTool(k) {
    for (const g of Object.values(ghosts)) { g.visible = false; if (g.userData.dim) g.userData.dim.visible = false; }
    st.tool = k; hold.pose = null; st.sel = null; marker.visible = false;
    onToolChange(k, false);
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    setRay(e);
    if (e.button === 2) { if (st.tool) setTool(null); else st.blowKey = true; return; }
    canvas.setPointerCapture(e.pointerId);
    st.down = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch };
  });
  canvas.addEventListener('pointermove', (e) => {
    setRay(e); st.last = e;
    const d = st.down;
    if (d && !st.look && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) st.look = d;
    if (st.look) {
      view.yaw = clamp(st.look.yaw - (e.clientX - st.look.x) * 0.004, -0.75, 0.75);
      view.pitch = clamp(st.look.pitch + (e.clientY - st.look.y) * 0.003, 0.18, 0.8);
    }
  });
  const up = (e) => {
    if (e.button === 2) { st.blowKey = false; return; }
    const wasLook = !!st.look; st.look = null; st.down = null;
    if (wasLook || e.type === 'pointercancel') return;
    setRay(e);
    click();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (st.tool && st.tool !== 'match' && st.tool !== 'tongs') st.yaw += e.deltaY * 0.004;   // 向きを回す
    else view.dist = clamp(view.dist + e.deltaY * 0.0012, 0.55, 2.4);
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) { st.blowKey = true; e.preventDefault(); }
    if (e.code === 'Escape') setTool(null);
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space') st.blowKey = false; });

  function click() {
    const k = st.tool;
    if (!k) return;
    if (k === 'match') { const p = placePoint(); if (p) onMatch(p.add(new THREE.Vector3(0, 0.012, 0))); return; }
    if (k === 'tongs') {
      if (!st.sel) { const l = pickLog(); if (l) { st.sel = l; onToolChange('tongs', true); } return; }
      const p = placePoint(); if (!p) return;
      st.move = { log: st.sel, to: p, t: 0 };
      st.sel = null; onToolChange('tongs', false);
      return;
    }
    const P = hold.pose;
    if (!P) return;
    if (!P.inside) { onMiss?.(); return; }
    onPlace(k, new THREE.Vector3(P.x, P.y + 0.003, P.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, P.yaw, 0)));
    st.yaw += (Math.random() - 0.5) * 0.6;   // 次の1本は少し向きを変えておく
  }

  return {
    st, view, setTool, hold, ghosts,
    get blowing() { return st.blowKey || st.blowMic > 0.5; },
    update(dt) {
      const c = Math.cos(view.pitch), s = Math.sin(view.pitch);
      camera.position.set(view.target.x + Math.sin(view.yaw) * c * view.dist, view.target.y + s * view.dist, view.target.z + Math.cos(view.yaw) * c * view.dist);
      camera.lookAt(view.target);
      if (st.last) setRay(st.last);
      // 持っている物：カーソルにくっつける（囲いの上では、置いたら止まる所の1cm上に浮かせる）
      for (const [key, g] of Object.entries(ghosts)) if (key !== st.tool) { g.visible = false; if (g.userData.dim) g.userData.dim.visible = false; }
      hold.pose = null;
      if (st.tool && st.tool !== 'tongs' && st.last && !st.look) {
        const g = ghostFor(st.tool), log = g.userData.log;
        if (!log) { const p = placePoint(); g.visible = !!p; if (p) g.position.set(p.x, p.y + 0.012, p.z); }
        else {
          // 囲いの上：手に持った本物＋（離れたときだけ）置かれる所に薄い影。外：半透明で手についてくるだけ（置けない）
          const P = hold.pose = holdPose(log, st.yaw), dim = g.userData.dim;
          if (P.apart) g.position.copy(P.hand); else g.position.set(P.x, P.y + 0.01, P.z);
          g.quaternion.setFromEuler(new THREE.Euler(0, P.yaw, 0));
          g.visible = P.inside; dim.visible = !P.inside;
          if (!P.inside) { dim.position.copy(P.hand); dim.quaternion.copy(g.quaternion); }
          else {
            // 止まる所の先回り：カーソルが 0.08 秒止まったら1回だけ計算（動かしている間は計算しない＝カクつかない）
            const key = `${st.tool}|${P.x.toFixed(3)}|${P.z.toFixed(3)}|${P.y.toFixed(3)}|${P.yaw.toFixed(2)}|${fireTargets().length}`;
            const now = performance.now();
            if (key !== hold.key) { hold.key = key; hold.since = now; }
            else if (hold.predKey !== key && now - hold.since > 80) { hold.pred = physics.predict(log, P.x, P.y + 0.003, P.z, P.yaw); hold.predKey = key; }
            // 止まる所が、手の位置から 1.5cm 以上か 10° 以上ずれるときだけ、そこに薄い影を出す
            if (hold.predKey === key && hold.pred) {
              const q = new THREE.Quaternion().fromArray(hold.pred.q);
              const far = Math.hypot(hold.pred.p[0] - P.x, hold.pred.p[1] - P.y, hold.pred.p[2] - P.z) > 0.015 || q.angleTo(g.quaternion) > 0.17;
              if (far || P.apart) { dim.visible = true; dim.position.fromArray(hold.pred.p); dim.quaternion.copy(q); }
            } else if (P.apart) { dim.visible = true; dim.position.set(P.x, P.y, P.z); dim.quaternion.copy(g.quaternion); }
          }
        }
      }
      // 火ばさみ：選んだ薪の上に輪、動かしている間は押して運ぶ
      marker.visible = !!st.sel;
      if (st.sel) { const p = st.sel.pose.p; marker.position.set(p[0], p[1] + 0.06, p[2]); }
      if (st.move) {
        const m = st.move, body = physics.body(m.log);
        m.t += dt;
        if (!body || m.t > 1.2) { if (body) { body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true); } st.move = null; }
        else {
          const p = body.translation(), lift = m.t < 0.9 ? 0.05 : 0;
          let vx = (m.to.x - p.x) * 8, vy = (m.to.y + lift - p.y) * 8, vz = (m.to.z - p.z) * 8;
          const sp = Math.hypot(vx, vy, vz); if (sp > 1.2) { vx *= 1.2 / sp; vy *= 1.2 / sp; vz *= 1.2 / sp; }
          body.setLinvel({ x: vx, y: vy, z: vz }, true);
          const w = body.angvel(); body.setAngvel({ x: w.x * 0.8, y: w.y * 0.8, z: w.z * 0.8 }, true);
        }
      }
    },
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// マイクで吹く：低い音の大きさ（息のゴーッという音）を拾う
export async function startMic(st) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
  const ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
  an.fftSize = 1024; src.connect(an);
  const buf = new Float32Array(an.frequencyBinCount);
  const tick = () => {
    an.getFloatFrequencyData(buf);
    let e = 0; for (let i = 1; i < 24; i++) e += Math.pow(10, buf[i] / 10);
    const db = 10 * Math.log10(e + 1e-12);
    st.blowMic = Math.max(0, Math.min(1, (db + 38) / 14));
    requestAnimationFrame(tick);
  };
  tick();
}
