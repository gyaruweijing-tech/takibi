// 操作：棚で選んで、台の上でクリックして置く（落ちる場所に半透明の影を出す）。マッチ、火ばさみ、吹く、見回す
// 3D で拾って運ぶのはやめた：カーソルと薪がずれて不自然だったため。置いたあとは物理で落ちて転がる
import * as THREE from 'three';
import { makeLog } from './burn/log.js';
import { LogView } from './logs3d.js';
import { TRAY } from './burn/fire.js';

export function createInput({ canvas, camera, scene, physics, getLogByMesh, fireTargets, onPlace, onMatch, onToolChange }) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const view = { yaw: 0, pitch: 0.5, dist: 1.3, target: new THREE.Vector3(0, 0.36, 0) };
  const st = { tool: null, yaw: Math.random() * 6.28, down: null, look: null, sel: null, move: null, blowKey: false, blowMic: 0, last: null };

  // 落ちる場所の影（材料ごとに形を1回だけ作る）
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffe8c8, transparent: true, opacity: 0.28, depthWrite: false });
  const ghosts = {};
  function ghostFor(key) {
    if (ghosts[key]) return ghosts[key];
    let m;
    if (key === 'match') m = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb060 }));
    else { const v = new LogView(makeLog(key)); m = new THREE.Mesh(v.mesh.geometry, ghostMat); m.userData.dims = v.log; }
    m.visible = false; m.raycast = () => {}; m.renderOrder = 12;
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
  // 薪の形が占める範囲の真下で、いちばん高い物の上に載せる（めり込んで出すと、はじき飛ばされる）
  const down = new THREE.Raycaster(); down.far = 2;
  function landing(p, yaw, dims) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let top = TRAY.y;
    for (const a of [-0.5, -0.25, 0, 0.25, 0.5]) for (const b of [-0.5, 0, 0.5]) {
      const lx = a * dims.L, lz = b * dims.w;
      down.set(new THREE.Vector3(p.x + c * lx + s * lz, 1.2, p.z - s * lx + c * lz), new THREE.Vector3(0, -1, 0));
      const h = down.intersectObjects(fireTargets(), true)[0];
      if (h) top = Math.max(top, h.point.y);
    }
    return top + dims.h / 2 + 0.006;
  }
  const pickLog = () => {
    for (const h of ray.intersectObjects(fireTargets(), true)) { const lv = getLogByMesh(h.object); if (lv) return lv.log; }
    return null;
  };

  function setTool(k) {
    for (const g of Object.values(ghosts)) g.visible = false;
    st.tool = k; st.sel = null; marker.visible = false;
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
    const g = ghostFor(k);
    if (!g.visible) return;
    onPlace(k, g.position.clone().add(new THREE.Vector3(0, 0.01, 0)), g.quaternion.clone());
    st.yaw += (Math.random() - 0.5) * 0.6;   // 次の1本は少し向きを変えておく
  }

  return {
    st, view, setTool,
    get blowing() { return st.blowKey || st.blowMic > 0.5; },
    update(dt) {
      const c = Math.cos(view.pitch), s = Math.sin(view.pitch);
      camera.position.set(view.target.x + Math.sin(view.yaw) * c * view.dist, view.target.y + s * view.dist, view.target.z + Math.cos(view.yaw) * c * view.dist);
      camera.lookAt(view.target);
      if (st.last) setRay(st.last);
      // 落ちる場所の影
      for (const [key, g] of Object.entries(ghosts)) if (key !== st.tool) g.visible = false;
      if (st.tool && st.tool !== 'tongs' && !st.look) {
        const g = ghostFor(st.tool), p = placePoint();
        g.visible = !!p;
        if (p) {
          const dims = g.userData.dims;
          g.position.copy(p);
          g.position.y = dims ? landing(p, st.yaw, dims) : p.y + 0.012;
          g.quaternion.setFromEuler(new THREE.Euler(0, st.yaw, 0));
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
