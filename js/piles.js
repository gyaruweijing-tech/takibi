// 手元の材料：右に薪の山（針葉樹・広葉樹・湿った薪）、左の台に新聞紙・小枝・マッチ
// 画面のボタンではなく、場面の中の物をつかむ（Gemini 設計書の Diegetic UI）
import * as THREE from 'three';
import { makeLog } from './burn/log.js';
import { LogView } from './logs3d.js';
import { pbr } from './scene.js';

export function buildPiles(scene) {
  const piece = (key, x, y, z, rx, ry, rz) => {
    const l = makeLog(key);
    const v = new LogView(l); v.update();
    v.mesh.userData.logView = null;           // 火の中の薪ではない
    v.mesh.position.set(x, y, z); v.mesh.rotation.set(rx, ry, rz);
    return v.mesh;
  };
  const pile = (key, list) => {
    const g = new THREE.Group(); g.userData.pile = key;
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
  pile('oak', stack(0.62, 0.02, [4, 3, 2]));
  pile('pine', stack(0.6, 0.36, [3, 3, 1]));
  pile('damp', stack(0.92, -0.22, [3, 2]));
  // 左の台（折りたたみの踏み台）
  const stool = new THREE.Group();
  const wood = pbr('raw_plank_wall', 1);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.24), new THREE.MeshStandardMaterial({ ...wood, color: 0xd8d2c8 }));
  top.position.y = 0.26;
  stool.add(top);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.26, 0.22), new THREE.MeshStandardMaterial({ color: 0xdcdcd8, roughness: 0.6 }));
    side.position.set(sx * 0.15, 0.13, 0); stool.add(side);
  }
  stool.position.set(-0.62, 0, 0.2); stool.rotation.y = 0.3;
  stool.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  scene.add(stool);
  const onStool = (x, z) => new THREE.Vector3(x, 0.275, z).applyEuler(new THREE.Euler(0, 0.3, 0)).add(new THREE.Vector3(-0.62, 0, 0.2));
  const paper = pile('newspaper', [[0, 0, 0, 0, 0, 0], [0.08, 0, 0.03, 0.4, 1, 0]]);
  paper.position.copy(onStool(-0.09, -0.04)).add(new THREE.Vector3(0, 0.04, 0));
  const twigs = pile('twig', [[0, 0, 0, 0, 0.2, 0], [0, 0.03, 0.01, 0, -0.1, 0]]);
  twigs.position.copy(onStool(0.06, 0.05)).add(new THREE.Vector3(0, 0.02, 0));
  // マッチ箱（無地）
  const box = new THREE.Group(); box.userData.pile = 'match';
  const mbox = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.016, 0.036), [
    new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0xc24a2e, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0xc24a2e, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 })]);
  mbox.castShadow = true; box.add(mbox);
  box.position.copy(onStool(0.1, -0.07)).add(new THREE.Vector3(0, 0.008, 0)); box.rotation.y = 0.5;
  scene.add(box);
}
