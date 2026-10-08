// 手元の材料：右に薪の山（針葉樹・広葉樹・湿った薪）、左の平たい岩に新聞紙・小枝・マッチ。その奥に地面に刺したたいまつ
// 画面のボタンではなく、場面の中の物をつかむ（Gemini 設計書の Diegetic UI）
import * as THREE from 'three';
import { makeLog } from './burn/log.js';
import { LogView } from './logs3d.js';
import { pbr, makeStone, stoneMaterial } from './scene.js';

export function buildPiles(scene) {
  const piece = (key, x, y, z, rx, ry, rz) => {
    const l = makeLog(key);
    const v = new LogView(l); v.update();
    v.mesh.userData.logView = null;           // 火の中の薪ではない
    v.mesh.position.set(x, y, z); v.mesh.rotation.set(rx, ry, rz);
    return v.mesh;
  };
  const pile = (key, list) => {
    const g = new THREE.Group(); g.userData.pile = key; g.name = 'pile';
    for (const a of list) g.add(piece(key, ...a));
    scene.add(g);
    return g;
  };
  // 薪の山（地面に、種類ごとに少し離して積む）
  const stack = (x0, z0, rows) => {
    const out = [];
    rows.forEach((n, r) => { for (let i = 0; i < n; i++) out.push([x0 + (i - (n - 1) / 2) * 0.085 + (r % 2) * 0.04, 0.03 + r * 0.062, z0 + (Math.random() - 0.5) * 0.02, 0, Math.PI / 2 + (Math.random() - 0.5) * 0.12, Math.random() < 0.5 ? 0 : Math.PI]); });
    return out;
  };
  pile('oak', stack(0.86, 0.12, [4, 3, 2]));
  pile('pine', stack(0.82, 0.5, [3, 3, 1]));
  pile('damp', stack(1.12, -0.18, [3, 2]));
  // 左の平たい岩（机の代わり。上が平らに割れた大きな石）
  const stool = new THREE.Group(); stool.name = 'stool';
  const slab = new THREE.Mesh(makeStone(0.73), stoneMaterial(scene.userData.rockMat, false));
  slab.material.color.set(0x5e5a56);   // 平たい岩は炉の石より暗いまま
  slab.scale.set(0.2, 0.09, 0.15); slab.position.y = 0.055;
  stool.add(slab);
  stool.position.set(-0.74, 0, 0.46); stool.rotation.y = 0.3;
  stool.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  scene.add(stool);
  stool.updateMatrixWorld(true);
  // 岩の上面の高さを測って、その上に材料を載せる
  const rc = new THREE.Raycaster();
  const onStool = (x, z) => {
    const p = new THREE.Vector3(x, 0, z).applyEuler(new THREE.Euler(0, 0.3, 0)).add(new THREE.Vector3(-0.74, 0, 0.46));
    rc.set(new THREE.Vector3(p.x, 1, p.z), new THREE.Vector3(0, -1, 0));
    const h = rc.intersectObject(slab)[0];
    return p.setY(h ? h.point.y : 0.1);
  };
  const paper = pile('newspaper', [[0, 0, 0, 0, 0, 0], [0.08, 0, 0.03, 0.4, 1, 0]]);
  paper.position.copy(onStool(-0.07, -0.03)).add(new THREE.Vector3(0, 0.04, 0));
  const twigs = pile('twig', [[0, 0, 0, 0, 0.2, 0], [0, 0.03, 0.01, 0, -0.1, 0]]);
  twigs.position.copy(onStool(0.05, 0.04)).add(new THREE.Vector3(0, 0.02, 0));
  // たいまつ（ランタンの代わり。地面に斜めに刺した棒の先に、縄で巻いた布。光の色・強さはランタンと同じ）
  const torch = new THREE.Group(); torch.name = 'torch';
  const barkTex = pbr('bark_brown_02', 1);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.021, 0.44, 10, 6), new THREE.MeshStandardMaterial({ ...barkTex, color: 0x9a8a78, roughness: 1 }));
  { const pp = stick.geometry.attributes.position; for (let i = 0; i < pp.count; i++) pp.setX(i, pp.getX(i) + Math.sin(pp.getY(i) * 5) * 0.006); stick.geometry.computeVertexNormals(); }
  stick.geometry.setAttribute('uv1', stick.geometry.attributes.uv);
  stick.position.y = 0.22;
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.11, 14, 4), new THREE.MeshStandardMaterial({ map: wrapTexture(), roughness: 1 }));
  { const pp = wrap.geometry.attributes.position; for (let i = 0; i < pp.count; i++) { const k = 1 + (Math.sin(i * 7.1) * 0.5 + 0.5) * 0.15; pp.setX(i, pp.getX(i) * k); pp.setZ(i, pp.getZ(i) * k); } wrap.geometry.computeVertexNormals(); }
  wrap.position.y = 0.4;
  const charTop = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 1, emissive: 0xff5a1e, emissiveIntensity: 0.6 }));
  charTop.position.y = 0.455; charTop.scale.y = 0.6;
  torch.add(stick, wrap, charTop);
  torch.position.set(-0.84, -0.03, 0.08); torch.rotation.set(0.1, 0, -0.16);   // カメラの画角に頭と炎が収まる高さ・位置
  torch.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(torch);
  torch.updateMatrixWorld(true);
  const head = new THREE.Vector3(0, 0.47, 0).applyMatrix4(torch.matrixWorld);
  const lamp = new THREE.PointLight(0xffc48a, 0.45, 0, 2); lamp.name = 'torchLight';
  lamp.position.copy(head).add(new THREE.Vector3(0, 0.06, 0));
  scene.add(lamp);
  // 画面の外・左上のもう1つの明かり（ポールに吊るしたもう1本のたいまつのつもり）。場面全体をやわらかく照らす
  const hang = new THREE.PointLight(0xffd2a0, 2.6, 0, 2); hang.name = 'hang';
  hang.position.set(-0.55, 1.25, 0.55);
  scene.add(hang);
  // マッチ箱（無地）
  const box = new THREE.Group(); box.userData.pile = 'match';
  const mbox = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.016, 0.036), [
    new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0xc24a2e, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0xc24a2e, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 })]);
  mbox.castShadow = true; box.add(mbox);
  box.position.copy(onStool(0.09, -0.06)).add(new THREE.Vector3(0, 0.008, 0)); box.rotation.y = 0.5;
  scene.add(box);
  return { torch: { head, lamp } };
}

// たいまつの巻き布：茶色の毛羽立った布に、縄の帯が数本。上の方は焦げて黒い
function wrapTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#6b5136'; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 900; i++) {   // 毛羽
    const px = Math.random() * 256, py = Math.random() * 128, l = 3 + Math.random() * 7;
    x.strokeStyle = `rgba(${150 + Math.random() * 60},${110 + Math.random() * 40},${70 + Math.random() * 30},${0.25 + Math.random() * 0.35})`;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + (Math.random() - 0.5) * 3, py + l); x.stroke();
  }
  for (const y0 of [22, 48, 76, 100]) {   // 縄
    x.strokeStyle = '#3e2c1c'; x.lineWidth = 7; x.beginPath(); x.moveTo(0, y0); x.lineTo(256, y0 + 10); x.stroke();
    x.strokeStyle = 'rgba(160,125,85,0.6)'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, y0 - 2); x.lineTo(256, y0 + 8); x.stroke();
  }
  const gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(15,10,6,0.85)'); gr.addColorStop(0.35, 'rgba(15,10,6,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}
