// 物理（Rapier）：薪は投げ入れると転がり、積み重なり、崩れる。火ばさみで押す・持ち上げる
import RAPIER from 'rapier';
import { TRAY } from './burn/fire.js';
import { hullPoints } from './logs3d.js';
import { remaining } from './burn/log.js';

export async function createPhysics() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const fixed = (hx, hy, hz, x, y, z, rot) => {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    if (rot) b.setRotation(rot, false);
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9), b);
  };
  fixed(20, 0.05, 20, 0, -0.05, 0);                                      // 地面
  fixed(TRAY.x + 0.01, 0.03, TRAY.z + 0.01, 0, TRAY.y + 0.009 - 0.03, 0);   // トレーの底（灰の厚みぶん高く。すり抜けないよう下に厚く）
  const rim = 0.035;
  // 縁（外側に厚く）
  fixed(TRAY.x + 0.03, rim / 2, 0.012, 0, TRAY.y + rim / 2, TRAY.z + 0.021);
  fixed(TRAY.x + 0.03, rim / 2, 0.012, 0, TRAY.y + rim / 2, -TRAY.z - 0.021);
  fixed(0.012, rim / 2, TRAY.z + 0.03, TRAY.x + 0.021, TRAY.y + rim / 2, 0);
  fixed(0.012, rim / 2, TRAY.z + 0.03, -TRAY.x - 0.021, TRAY.y + rim / 2, 0);
  fixed(0.7, 0.25, 0.25, -0.55, 0.2, -1.25);                               // 岩（おおよそ）

  const bodies = new Map(); // log.id → { body, collider, scale }

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
    add(log, vel = [0, 0, 0], spin = [0, 0, 0]) {
      const [x, y, z] = log.pose.p, q = log.pose.q;
      const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
        .setLinvel(...vel).setAngvel({ x: spin[0], y: spin[1], z: spin[2] }).setLinearDamping(0.05).setAngularDamping(log.t.kind === 'ball' ? 2 : 0.4)
        .setCcdEnabled(true);
      const body = world.createRigidBody(desc);
      const collider = world.createCollider(colliderFor(log, 1), body);
      bodies.set(log.id, { body, collider, scale: 1 });
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
    step() { world.step(); },
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
