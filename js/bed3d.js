// 熾火の床：トレーの中の灰と炭。炭が多い所は黒く盛り上がり、熱い所はひびの奥が赤く光る
import * as THREE from 'three';
import { pbr } from './scene.js';
import { TRAY, BED_DIM, bedBin, bedDepth } from './burn/fire.js';
import { shared } from './logs3d.js';

const NX = 48, NZ = 34;

export function createBed(scene) {
  const W = TRAY.x * 2, D = TRAY.z * 2;
  const geo = new THREE.PlaneGeometry(W, D, NX, NZ);
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute('uv1', geo.attributes.uv);
  const n = geo.attributes.position.count;
  const aTemp = new THREE.Float32BufferAttribute(new Float32Array(n), 1);
  const aCoal = new THREE.Float32BufferAttribute(new Float32Array(n), 1);
  geo.setAttribute('aTemp', aTemp); geo.setAttribute('aCoal', aCoal);
  const base = geo.attributes.position.array.slice();
  const lump = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = base[i * 3], z = base[i * 3 + 2];
    lump[i] = (Math.sin(x * 160 + Math.sin(z * 90) * 2) * Math.sin(z * 140 + x * 40) * 0.5 + 0.5) * (0.6 + Math.random() * 0.8);
  }
  const ash = pbr('burned_ground_01', 1);
  const mat = new THREE.MeshStandardMaterial({ ...ash, color: 0x77736e, roughness: 1 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    const head = `uniform float uTime; varying float vTemp; varying float vCoal; varying vec3 vP;
      float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h1(i), h1(i+vec2(1,0)), f.x), mix(h1(i+vec2(0,1)), h1(i+vec2(1,1)), f.x), f.y); }
      vec3 blackbody(float k){ float t = k / 100.0; vec3 c;
        c.r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
        c.g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0) : clamp(1.129891 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
        c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432068 * log(t - 10.0) - 1.1962541, 0.0, 1.0));
        return pow(c, vec3(2.2)); }\n`;
    sh.vertexShader = head + 'attribute float aTemp; attribute float aCoal;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vTemp = aTemp; vCoal = aCoal; vP = position;');
    sh.fragmentShader = head + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        // 炭のかたまり（黒）と、そのすき間の白い灰
        float lumps = vn(vP.xz * 70.0) * 0.6 + vn(vP.xz * 190.0) * 0.4;
        float coal = smoothstep(0.15, 0.7, vCoal * (0.6 + lumps));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.028, 0.026), coal * 0.85);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float lumps2 = vn(vP.xz * 70.0 + 3.1) * 0.6 + vn(vP.xz * 220.0) * 0.4;
          float breathe = 0.7 + 0.45 * sin(uTime * (0.5 + lumps2) + lumps2 * 40.0) + 0.25 * vn(vP.xz * 30.0 + uTime * 0.15);
          float glow = pow(clamp((vTemp - 450.0) / 600.0, 0.0, 1.0), 2.2) * 2.2;
          // 炭のかたまりの縁ほど明るく、灰をかぶった所は暗い
          float m = smoothstep(0.3, 0.9, vCoal * (0.4 + lumps2)) * (0.15 + 0.85 * smoothstep(0.45, 0.8, lumps2));
          totalEmissiveRadiance += blackbody(vTemp + 273.0) * glow * m * breathe;
        }`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = TRAY.y + 0.002;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const at = (arr, x, z) => { // 床のマスを近い4つから
    const fx = (x + TRAY.x) / W * BED_DIM.nx - 0.5, fz = (z + TRAY.z) / D * BED_DIM.nz - 0.5;
    const x0 = Math.max(0, Math.min(BED_DIM.nx - 1, Math.floor(fx))), z0 = Math.max(0, Math.min(BED_DIM.nz - 1, Math.floor(fz)));
    const x1 = Math.min(BED_DIM.nx - 1, x0 + 1), z1 = Math.min(BED_DIM.nz - 1, z0 + 1);
    const ax = Math.min(1, Math.max(0, fx - x0)), az = Math.min(1, Math.max(0, fz - z0));
    const v = (i, j) => arr(i + BED_DIM.nx * j);
    return (v(x0, z0) * (1 - ax) + v(x1, z0) * ax) * (1 - az) + (v(x0, z1) * (1 - ax) + v(x1, z1) * ax) * az;
  };
  return {
    mesh,
    update(bed) {
      const p = geo.attributes.position.array;
      for (let i = 0; i < n; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        const edge = Math.min(1, (TRAY.x - Math.abs(x)) / 0.03, (TRAY.z - Math.abs(z)) / 0.03);
        const depth = at((b) => bedDepth(bed, b), x, z);
        const coal = at((b) => bed.coal[b], x, z);
        p[i * 3 + 1] = Math.max(0, edge) * (Math.min(0.012, depth * 0.6) + lump[i] * Math.min(0.008, depth * 0.4 + 0.002));
        aTemp.array[i] = at((b) => bed.T[b], x, z);
        aCoal.array[i] = Math.min(1, coal / 0.006);
      }
      geo.attributes.position.needsUpdate = true; aTemp.needsUpdate = aCoal.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}
export { bedBin };
