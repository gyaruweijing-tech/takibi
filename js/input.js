// 操作：つかむ・投げる（薪の山から）、火ばさみ（火の中の薪）、マッチ、吹く、見回す
import * as THREE from 'three';

export function createInput({ canvas, camera, scene, physics, getLogByMesh, onSpawn, onStrike, onPlaceMatch, onToast }) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const view = { yaw: 0, pitch: 0.5, dist: 1.3, target: new THREE.Vector3(0, 0.36, 0) };
  const st = { grab: null, match: null, look: null, blowKey: false, blowMic: 0, hover: null };
  const tmp = new THREE.Vector3();

  function setRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function hitScene() {
    const hits = ray.intersectObjects(scene.children, true).filter((h) => h.object.visible && !h.object.userData.noPick && h.object.type === 'Mesh' && !h.object.isInstancedMesh);
    return hits[0] || null;
  }
  // 手の届く場所：指している物（台・熾火・薪・地面）の少し上。火を指して離せば、そのまま中に落ちる
  function handPoint(lift, skip) {
    const hits = ray.intersectObjects(scene.children, true).filter((x) => x.object.type === 'Mesh' && !x.object.isInstancedMesh && !x.object.userData.noPick && !isPart(x.object, skip));
    if (hits[0] && hits[0].distance < 3) return hits[0].point.clone().add(new THREE.Vector3(0, lift, 0));
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = d.y < -1e-3 ? (lift + 0.3 - o.y) / d.y : 1.2;
    t = clamp(t, 0.3, 2.2);
    tmp.copy(o).addScaledVector(d, t);
    tmp.x = clamp(tmp.x, -1.2, 1.2); tmp.z = clamp(tmp.z, -0.9, 1.0);
    tmp.y = Math.max(0.05, tmp.y);
    return tmp.clone();
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    setRay(e);
    if (e.button === 2) { st.blowKey = true; return; }
    // マッチを持っているとき：もう一度クリックで、その場に置く
    if (st.match) { onPlaceMatch(st.match); st.match = null; return; }
    // つかめる物（材料の山・火の中の薪）を、地面や台より優先して拾う
    const hs = ray.intersectObjects(scene.children, true).filter((x) => x.object.type === 'Mesh' && !x.object.isInstancedMesh && !x.object.userData.noPick);
    const h = hs.find((x) => findUp(x.object, (o) => o.userData.pile || o.userData.logView)) || null;
    const pile = h && findUp(h.object, (o) => o.userData.pile);
    if (pile?.userData.pile === 'match') { st.match = onStrike(); return; }
    if (pile) {
      const p = h.point.clone().add(new THREE.Vector3(0, 0.12, 0));
      const log = onSpawn(pile.userData.pile, p);
      if (!log) return;
      st.grab = { log, h: 0.1, tongs: false };
      return;
    }
    const lv = h && getLogByMesh(h.object);
    if (lv) { st.grab = { log: lv.log, h: 0.04, tongs: true }; onToast(lv.log.T.some((t) => t > 120) ? '火ばさみでつかんだ' : ''); return; }
    st.look = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch };
  });
  canvas.addEventListener('pointermove', (e) => {
    setRay(e);
    st.lastEvent = e;
    if (st.look) {
      view.yaw = clamp(st.look.yaw - (e.clientX - st.look.x) * 0.004, -0.75, 0.75);
      view.pitch = clamp(st.look.pitch + (e.clientY - st.look.y) * 0.003, 0.18, 0.8);
    }
  });
  const up = (e) => {
    if (e.button === 2) { st.blowKey = false; return; }
    st.look = null;
    // ゆっくり離したら「置く」（勢いを消す）。速く振って離したら「投げる」
    if (st.grab) { const b = physics.body(st.grab.log); if (b && st.speed < 0.8) { b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); } st.grab = null; }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (st.grab) st.grab.h = clamp(st.grab.h - e.deltaY * 0.0003, 0.0, 0.5);   // つかんだまま上げ下げ
    else view.dist = clamp(view.dist + e.deltaY * 0.0012, 0.55, 2.4);
  }, { passive: false });
  addEventListener('keydown', (e) => { if (e.code === 'Space') { st.blowKey = true; e.preventDefault(); } if (e.code === 'Escape' && st.match) { st.match.life = 0; st.match = null; } });
  addEventListener('keyup', (e) => { if (e.code === 'Space') st.blowKey = false; });

  return {
    st, view,
    get blowing() { return st.blowKey || st.blowMic > 0.5; },
    // 毎フレーム：カメラと、つかんでいる物を動かす
    update(dt) {
      const c = Math.cos(view.pitch), s = Math.sin(view.pitch);
      camera.position.set(view.target.x + Math.sin(view.yaw) * c * view.dist, view.target.y + s * view.dist, view.target.z + Math.cos(view.yaw) * c * view.dist);
      camera.lookAt(view.target);
      if (st.lastEvent) setRay(st.lastEvent);
      if (st.grab) {
        const body = physics.body(st.grab.log);
        if (!body) { st.grab = null; return; }
        const goal = handPoint(st.grab.h, st.grab.log), p = body.translation();
        // 手で運ぶ間は台の縁より高く持つ（台の下をくぐらせない）
        if (!st.grab.tongs) goal.y = Math.max(goal.y, 0.46);
        let vx = (goal.x - p.x) * 14, vy = (goal.y - p.y) * 14, vz = (goal.z - p.z) * 14;
        const sp = Math.hypot(vx, vy, vz), max = st.grab.tongs ? 1.6 : 4.5;
        if (sp > max) { vx *= max / sp; vy *= max / sp; vz *= max / sp; }
        body.setLinvel({ x: vx, y: vy, z: vz }, true);
        st.speed = Math.hypot(vx, vy, vz);
        const w = body.angvel(); body.setAngvel({ x: w.x * 0.85, y: w.y * 0.85, z: w.z * 0.85 }, true);
      }
      if (st.match) {
        const h = hitScene();
        const p = h && h.distance < 2.5 ? h.point.clone().add(new THREE.Vector3(0, 0.012, 0)) : handPoint(0.4);
        st.match.x = p.x; st.match.y = p.y; st.match.z = p.z;
        if (st.match.life <= 0) st.match = null;
      }
    },
  };
}

// つかんでいる薪自身には当てない
function isPart(o, log) { if (!log) return false; while (o) { if (o.userData.logView?.log === log) return true; o = o.parent; } return false; }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function findUp(o, f) { while (o) { if (f(o)) return o; o = o.parent; } return null; }

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
