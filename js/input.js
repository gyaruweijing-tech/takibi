// 操作：棚で選ぶと、その材料がカーソルにくっついてくる。クリックでその場に置く。マッチ、火ばさみ、吹く、見回す
// 持っている物の中心はいつもカーソルの光線の上にあり、高さは「そこに置いたら止まる高さ」（物理と同じ形を真下に落として求める）
// → 画面の上で、カーソルと物がずれない。石の囲いの上では、囲いの内側に収まる所まで寄せる（見えない壁に当たる）
// ホイールで持ち上げると、その高さから落とせる（画面の限界まで）。止まる所の予告はしない（動物タワーバトルと同じ。読むのは人）
// 高さが分かるように、真下に丸い影だけ落とす（予測ではなく今の真下。毎コマ計算するのでワープしない）
import * as THREE from 'three';
import { makeLog } from './burn/log.js';
import { LogView } from './logs3d.js';
import { TRAY, PIT } from './burn/fire.js';

export function createInput({ canvas, camera, scene, physics, getLogByMesh, fireTargets, onPlace, onMiss, onMatch, onToolChange }) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const view = { yaw: 0, pitch: 0.5, dist: 1.55, target: new THREE.Vector3(0, TRAY.y + 0.12, 0) };
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
    if (Math.hypot(p.x, p.z) > TRAY.r + 0.12) return null;
    return p;
  }
  // 持っている物の置き場所
  const AIM = TRAY.r + 0.17;   // カーソルがここより内側を指していれば「囲いを狙っている」（縁の石の上を含む）
  // 薪の四隅が円の内側に収まるまで、中心を円の中心へ寄せる
  function fitIn(x, z, yaw, L, w) {
    const c = Math.cos(yaw), s = Math.sin(yaw), R = TRAY.r - 0.004;
    const far = (k) => Math.max(...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => Math.hypot(k * x + c * a * L / 2 + s * b * w / 2, k * z - s * a * L / 2 + c * b * w / 2)));
    if (far(1) <= R) return [x, z];
    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (far(m) <= R) lo = m; else hi = m; }
    return [x * lo, z * lo];
  }
  function poseAt(t, log, yaw0, inside) {
    const o = ray.ray.origin, d = ray.ray.direction;
    let x = o.x + d.x * t, z = o.z + d.z * t, yaw = yaw0;
    if (inside) [x, z] = fitIn(x, z, yaw, log.L, log.w);
    const y = physics.restY(log, x, z, yaw) ?? log.h / 2;
    return { x, y, z, yaw };
  }
  // カーソルの光線をたどって、「光線の高さ ＝ そこに置いたら止まる高さ」になる所を二分法で探す
  function holdPose(log, yaw, lift = 0) {
    const o = ray.ray.origin, d = ray.ray.direction;
    const t1 = d.y < -1e-3 ? Math.min(4, -o.y / d.y) : 4;
    // 囲いを狙っているか：カーソルが囲いの底の高さで指す所で決める（長い薪の先が手前の石にかかっても、囲いの中に入れる）
    const tf = d.y < -1e-3 ? (0 - o.y) / d.y : -1;
    const inside = tf > 0 && Math.hypot(o.x + d.x * tf, o.z + d.z * tf) < AIM;
    const f = (t) => o.y + d.y * t - poseAt(t, log, yaw, inside).y - lift;
    // 手前から順に見て、最初に「置いたら止まる高さ＋持ち上げた高さ」を下回った区間を二分法で詰める
    // 持ち上げすぎてカメラの目の前（35cm）まで来たら、そこが上の限界（画面の限界）
    const T0 = 0.35;
    let a = T0, b = t1;
    if (f(T0) <= 0) b = T0;
    else {
      for (let i = 1; i <= 24; i++) { const m = a + (t1 - T0) / 24; if (f(m) <= 0) { b = m; break; } a = m; }
      if (f(b) <= 0) for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
    }
    const P = poseAt(b, log, yaw, inside); P.inside = inside;
    P.hand = new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
    P.lift = Math.max(0, Math.min(lift, P.hand.y - P.y));   // 実際に持ち上がっている高さ（限界で頭打ち）
    return P;
  }
  const hold = { pose: null, lift: 0 };
  // 真下の丸い影（高いほど大きく薄い）
  const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, color: 0x000000, transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.visible = false; blob.raycast = () => {}; blob.renderOrder = 11; scene.add(blob);
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
    if (st.tool && st.tool !== 'match' && st.tool !== 'tongs') {
      if (e.shiftKey) st.yaw += (e.deltaY || e.deltaX) * 0.004;                      // Shift＋ホイール：向きを回す
      else hold.lift = clamp(hold.lift - e.deltaY * 0.0012, 0, 3);                   // ホイール：持ち上げる高さ（上は画面の限界で止まる）
    }
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
    const drop = P.lift > 0.015;   // 持ち上げていれば、その高さから落とす
    onPlace(k, new THREE.Vector3(P.x, P.y + (drop ? P.lift : 0.003), P.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, P.yaw, 0)), drop);
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
          // 囲いの上：本物を、落とす所（壁の内側に寄せた位置・持ち上げた高さ）に。外：半透明で手についてくるだけ（置けない）
          const P = hold.pose = holdPose(log, st.yaw, hold.lift), dim = g.userData.dim;
          hold.lift = Math.min(hold.lift, P.lift + 0.002);   // 限界より上にホイールを回しても溜めない
          g.quaternion.setFromEuler(new THREE.Euler(0, P.yaw, 0));
          g.visible = P.inside; dim.visible = !P.inside; blob.visible = false;
          if (!P.inside) { dim.position.copy(P.hand); dim.quaternion.copy(g.quaternion); }
          else {
            g.position.set(P.x, P.y + Math.max(0.01, P.lift), P.z);
            // 真下の丸い影：持ち上げているときだけ。高いほど大きく薄い
            if (P.lift > 0.02) {
              const gy = physics.floorY(P.x, g.position.y, P.z) ?? TRAY.y;
              const h = g.position.y - gy, size = Math.max(log.L, log.w) * 0.9 * (1 + h * 0.6);
              blob.visible = true; blob.position.set(P.x, gy + 0.004, P.z); blob.scale.set(size, size * Math.min(1, (log.w + 0.1) / log.L + 0.3), 1);
              blob.rotation.z = P.yaw; blob.material.opacity = 0.6 * Math.max(0.15, 1 - h / 1.5);
            }
          }
        }
      } else blob.visible = false;
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
