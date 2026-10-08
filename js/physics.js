// 物理（Rapier）：薪は投げ入れると転がり、積み重なり、崩れる。火ばさみで押す・持ち上げる
import RAPIER from 'rapier';
import { TRAY, PIT } from './burn/fire.js';
import { hullPoints } from './logs3d.js';
import { remaining } from './burn/log.js';

export async function createPhysics() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const fixed = (hx, hy, hz, x, y, z, rot) => {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    if (rot) b.setRotation(rot, false);
    return world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9), b);
  };
  fixed(20, 0.05, 20, 0, -0.05, 0);                                      // 地面
  fixed(TRAY.x + 0.01, 0.03, TRAY.z + 0.01, 0, TRAY.y + 0.009 - 0.03, 0);   // 囲いの底（灰の厚みぶん高く。すり抜けないよう下に厚く）
  // 石の囲いの内側の、見えない壁（スイカゲームの容器と同じ。石より高く、薪が縁を越えない）。影の計算からは外す
  const H = PIT.wall, walls = new Set();
  for (const c of [
    fixed(TRAY.x + 0.03, H / 2, 0.012, 0, TRAY.y + H / 2, TRAY.z + 0.021),
    fixed(TRAY.x + 0.03, H / 2, 0.012, 0, TRAY.y + H / 2, -TRAY.z - 0.021),
    fixed(0.012, H / 2, TRAY.z + 0.03, TRAY.x + 0.021, TRAY.y + H / 2, 0),
    fixed(0.012, H / 2, TRAY.z + 0.03, -TRAY.x - 0.021, TRAY.y + H / 2, 0),
  ]) walls.add(c.handle);
  // 石の囲いそのもの（壁の外に並ぶ石の帯）。地面から石の上の高さまで
  const S = PIT.stone, top = TRAY.y + 0.05, ox = TRAY.x + 0.033, oz = TRAY.z + 0.033;
  fixed(ox + S, top / 2, S / 2, 0, top / 2, oz + S / 2);
  fixed(ox + S, top / 2, S / 2, 0, top / 2, -oz - S / 2);
  fixed(S / 2, top / 2, oz, ox + S / 2, top / 2, 0);
  fixed(S / 2, top / 2, oz, -ox - S / 2, top / 2, 0);
  fixed(0.7, 0.25, 0.25, -0.55, 0.2, -1.25);                               // 岩（おおよそ）

  world.step();   // 一度進めないと、形を落とす計算（castShape）が何にも当たらない

  const bodies = new Map(); // log.id → { body, collider, scale, settle（残りコマ）, ld/ad（元のブレーキ） }

  function colliderFor(log, s) {
    const pts = hullPoints(log);
    let d;
    if (pts) {
      const q = new Float32Array(pts.length);
      for (let i = 0; i < pts.length; i += 3) { q[i] = pts[i] * (0.9 + 0.1 * s); q[i + 1] = pts[i + 1] * s; q[i + 2] = pts[i + 2] * s; }
      d = RAPIER.ColliderDesc.convexHull(q) || RAPIER.ColliderDesc.cuboid(log.L / 2, log.h / 2 * s, log.w / 2 * s);
    } else if (log.t.kind === 'ball') d = RAPIER.ColliderDesc.roundCuboid(log.L / 2 * 0.7 * Math.max(0.35, s), log.h / 2 * 0.7 * Math.max(0.35, s), log.w / 2 * 0.7 * Math.max(0.35, s), 0.012);   // くしゃくしゃの紙は転がらない
    else d = RAPIER.ColliderDesc.cuboid(log.L / 2, log.h / 2 * s, log.w / 2 * s);
    return d.setDensity(log.t.rho * (log.t.kind === 'ball' ? 3 : 1) * 0.001 * 1000).setFriction(log.t.kind === 'ball' ? 1.2 : 0.75).setRestitution(0.08);
  }

  return {
    world, RAPIER,
    // 置いたら転がりにくく：最初の1.5秒は強めにブレーキをかけ、そのあと元に戻す
    add(log, vel = [0, 0, 0], spin = [0, 0, 0], settle = false) {
      const [x, y, z] = log.pose.p, q = log.pose.q;
      const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
        .setLinvel(...vel).setAngvel({ x: spin[0], y: spin[1], z: spin[2] }).setLinearDamping(0.05).setAngularDamping(log.t.kind === 'ball' ? 2 : 0.4)
        .setCcdEnabled(true);
      const body = world.createRigidBody(desc);
      const collider = world.createCollider(colliderFor(log, 1), body);
      bodies.set(log.id, { body, collider, scale: 1, settle: settle ? 90 : 0, ld: 0.05, ad: log.t.kind === 'ball' ? 2 : 0.4 });
      if (settle) { body.setLinearDamping(4); body.setAngularDamping(10); }
      return body;
    },
    remove(log) {
      const b = bodies.get(log.id); if (!b) return;
      world.removeRigidBody(b.body); bodies.delete(log.id);
    },
    body(log) { return bodies.get(log.id)?.body; },
    // 燃えて痩せたら当たり判定を作り直す（毎回だとガタつくので、5%以上変わったときだけ）
    shrink(log) {
      const b = bodies.get(log.id); if (!b) return;
      const s = Math.max(0.45, Math.sqrt(remaining(log)));
      if (b.scale - s < 0.05) return;
      world.removeCollider(b.collider, true);
      b.collider = world.createCollider(colliderFor(log, s), b.body);
      b.scale = s;
    },
    step() {
      world.step();
      for (const b of bodies.values()) if (b.settle > 0 && --b.settle === 0) { b.body.setLinearDamping(b.ld); b.body.setAngularDamping(b.ad); }
    },
    // 置いたあとどこで止まるかを先回りして計算する（世界を丸ごと写して、写しの中で置いて2秒進める）。add(…, settle) と同じ設定で
    predict(log, x, y, z, yaw) {
      const w2 = RAPIER.World.restoreSnapshot(world.takeSnapshot());
      const b = w2.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(4).setAngularDamping(10).setCcdEnabled(true));
      w2.createCollider(colliderFor(log, 1), b);
      for (let i = 0; i < 120; i++) { if (i === 90) { b.setLinearDamping(0.05); b.setAngularDamping(log.t.kind === 'ball' ? 2 : 0.4); } w2.step(); }
      const t = b.translation(), r = b.rotation(), out = { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
      w2.free();
      return out;
    },
    // うそをつかない影：物理と同じ形を (x,z) の真上から真下へ落とし、最初に当たる高さ（中心の y）を返す
    restY(log, x, z, yaw) {
      const shape = colliderFor(log, 1).shape, q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
      const hit = world.castShape({ x, y: 1.4, z }, q, { x: 0, y: -1, z: 0 }, shape, 0, 1.6, true, undefined, undefined, undefined, undefined, (c) => !walls.has(c.handle));
      return hit ? 1.4 - hit.time_of_impact : null;
    },
    // 物理の姿勢 → 燃焼モデルへ
    syncPose(log) {
      const b = bodies.get(log.id); if (!b) return;
      const t = b.body.translation(), r = b.body.rotation();
      log.pose.p[0] = t.x; log.pose.p[1] = t.y; log.pose.p[2] = t.z;
      log.pose.q[0] = r.x; log.pose.q[1] = r.y; log.pose.q[2] = r.z; log.pose.q[3] = r.w;
    },
    // 光線が当たった薪（つかむため）
    pick(origin, dir, maxToi = 5) {
      const ray = new RAPIER.Ray(origin, dir);
      const hit = world.castRay(ray, maxToi, true, undefined, undefined, undefined, undefined, (c) => c.parent()?.isDynamic());
      if (!hit) return null;
      const body = hit.collider.parent();
      for (const [id, b] of bodies) if (b.body === body) return { id, toi: hit.timeOfImpact ?? hit.toi };
      return null;
    },
  };
}
