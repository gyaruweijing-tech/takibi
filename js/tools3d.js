// 手に持つ道具の見た目：火ばさみとマッチ（本人の参考写真：黒い鍛造の鉄のはさみ型・白木の軸のマッチ）
// 道具の先がカーソルの指す所に来て、持ち手は画面の右下（手の方）へ伸びる。動かし方は input.js のまま
// 擦ったマッチは、火の中にマッチ棒として横たわり、だんだん焦げて消える（炎は燃焼モデルの炎の柱として出る）
// 手に持っている道具は実物より大きく見せる（FPS の手に持った武器と同じ。実物大だと 1.4m 先で数ピクセルになり見えない）
const HELD = 2.5, LYING = 1.6;
import * as THREE from 'three';

// 使い込んだ鉄：黒っぽい灰色に、錆の茶色と擦れた明るい筋
function ironTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#4a4744'; x.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 140; i++) {
    const px = Math.random() * 256, py = Math.random() * 64, r = 2 + Math.random() * 10;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, Math.random() < 0.4 ? 'rgba(110,70,40,0.5)' : 'rgba(30,28,26,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  for (let i = 0; i < 60; i++) { x.strokeStyle = `rgba(150,145,140,${0.1 + Math.random() * 0.2})`; x.lineWidth = 1; const py = Math.random() * 64; x.beginPath(); x.moveTo(Math.random() * 256, py); x.lineTo(Math.random() * 256, py + (Math.random() - 0.5) * 4); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// マッチの軸：白木の細かい木目
function matchWoodTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#eadcc0'; x.fillRect(0, 0, 128, 16);
  for (let i = 0; i < 24; i++) { x.strokeStyle = `rgba(170,140,100,${0.15 + Math.random() * 0.2})`; const y = Math.random() * 16; x.beginPath(); x.moveTo(0, y); x.lineTo(128, y + (Math.random() - 0.5) * 3); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 火ばさみ：長さ約34cm。2本の腕が真ん中の鋲で交差し、先は平たくギザギザ、持ち手は輪
function makeTongs() {
  const iron = new THREE.MeshStandardMaterial({ map: ironTexture(), metalness: 0.75, roughness: 0.55 });
  const rivet = new THREE.MeshStandardMaterial({ color: 0x9a9894, metalness: 1, roughness: 0.3 });
  const grp = new THREE.Group();
  const arms = [];
  for (const side of [1, -1]) {
    const arm = new THREE.Group();   // 原点＝鋲。ここを中心に開け閉めする
    // 腕：先（-X）から鋲を通って持ち手（+X）へ。先は +side 側、持ち手は -side 側（はさみと同じく交差する）
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.15, 0, 0.006 * side), new THREE.Vector3(-0.09, 0, 0.004 * side), new THREE.Vector3(0, 0.002 * side, 0),
      new THREE.Vector3(0.09, 0.004 * side, -0.012 * side), new THREE.Vector3(0.15, 0.004 * side, -0.026 * side),
    ]);
    const bar = new THREE.Mesh(new THREE.TubeGeometry(path, 40, 0.0042, 8), iron); bar.scale.set(1, 0.7, 1.35); arm.add(bar);   // 平たい鉄の帯
    // 先の平たい爪（内側がギザギザ）
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.0045, 0.011), iron);
    pad.position.set(-0.168, 0, 0.004 * side); arm.add(pad);
    for (let k = 0; k < 7; k++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0055, 0.004), iron);
      tooth.position.set(-0.185 + k * 0.0055, 0, -0.0005 * side); arm.add(tooth);
    }
    // 持ち手の輪
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0034, 8, 24), iron);
    ring.position.set(0.172, 0.004 * side, -0.036 * side); ring.rotation.x = Math.PI / 2; ring.scale.set(1.25, 1, 1);
    arm.add(ring);
    grp.add(arm); arms.push({ arm, side });
  }
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.014, 16), rivet);
  grp.add(pin);
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.raycast = () => {}; } });
  grp.userData.arms = arms;
  grp.userData.tip = new THREE.Vector3(-0.19, 0, 0);   // 鋲から見た先の位置
  return grp;
}
function setTongsOpen(tongs, open) {   // open：0 閉じる〜1 開く
  for (const { arm, side } of tongs.userData.arms) arm.rotation.y = side * (0.02 + open * 0.13);
}

// マッチ：長さ4.5cm・2.2mm角の白木の軸に、灰茶色の頭
const woodTex = matchWoodTexture();
function makeMatch() {
  const grp = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.0022, 0.0022), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8 }));
  stick.position.x = 0.0225; grp.add(stick);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.0021, 12, 8), new THREE.MeshStandardMaterial({ color: 0x7a5a48, roughness: 0.95 }));
  head.scale.set(1.6, 1.3, 1.3); head.position.x = -0.0012; grp.add(head);
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.raycast = () => {}; } });
  grp.userData.stick = stick; grp.userData.head = head;
  return grp;
}

export function createTools(scene, camera) {
  const tongs = makeTongs(), held = makeMatch();
  tongs.visible = held.visible = false;
  tongs.scale.setScalar(HELD); held.scale.setScalar(HELD);
  scene.add(tongs, held);
  let open = 1;
  const right = new THREE.Vector3(), up = new THREE.Vector3(), dir = new THREE.Vector3(), z = new THREE.Vector3(), y = new THREE.Vector3(), m = new THREE.Matrix4();
  // 先を p に置き、持ち手を画面の右下（手の方）へ向ける
  function aim(obj, p, reach) {
    right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
    dir.copy(camera.position).addScaledVector(right, 0.35).addScaledVector(up, -0.3).sub(p).normalize();   // 先 → 手
    z.crossVectors(dir, up).normalize(); y.crossVectors(z, dir).normalize();
    m.makeBasis(dir, y, z);
    obj.quaternion.setFromRotationMatrix(m);
    obj.position.copy(p).addScaledVector(dir, reach);
  }
  // 擦ったマッチ（火の中に横たわる軸）。fire.matches の1本ごとに1つ
  const lying = new Map();
  return {
    // tool：いま選んでいる道具、p：先を置く所、closed：火ばさみが薪をつかんでいるか
    update(tool, p, closed, dt) {
      tongs.visible = tool === 'tongs' && !!p; held.visible = tool === 'match' && !!p;
      if (tongs.visible) {
        open += ((closed ? 0 : 1) - open) * Math.min(1, dt * 12);
        setTongsOpen(tongs, open);
        aim(tongs, p, 0.19 * HELD);   // 先から鋲まで
      }
      if (held.visible) aim(held, p, 0);
    },
    updateMatches(matches) {
      const seen = new Set();
      for (const mt of matches) {
        seen.add(mt);
        let g = lying.get(mt);
        if (!g) {
          g = makeMatch(); g.scale.setScalar(LYING); g.position.set(mt.x, mt.y - 0.006, mt.z); g.rotation.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
          g.userData.stick.material = g.userData.stick.material.clone(); g.userData.head.material = g.userData.head.material.clone();
          scene.add(g); lying.set(mt, g);
        }
        // 頭の方から焦げていく（18秒）
        const burnt = 1 - Math.max(0, Math.min(1, mt.life / 18));
        g.userData.stick.material.color.setRGB(1 - burnt * 0.85, 1 - burnt * 0.88, 1 - burnt * 0.9);
        g.userData.head.material.color.setRGB(0.48 * (1 - burnt) + 0.05, 0.35 * (1 - burnt) + 0.04, 0.28 * (1 - burnt) + 0.04);
      }
      for (const [mt, g] of lying) if (!seen.has(mt)) { scene.remove(g); lying.delete(mt); }
    },
  };
}
