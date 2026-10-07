// Poly Haven（CC0）から素材を落とす。使う素材はここに並べる。結果は assets/polyhaven/ に入り、CREDITS.md に載せる
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ROOT = new URL('../assets/polyhaven/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const UA = { 'User-Agent': 'takibi-dev-asset-fetch' };
const TEXTURES = ['pine_bark', 'bark_brown_02', 'burned_ground_01', 'forrest_ground_03', 'raw_plank_wall', 'grass_ground'];   // 落としたあと tools/clean-assets.mjs を回す
const TEX_MAPS = { Diffuse: 'diff', nor_gl: 'nor_gl', arm: 'arm', Displacement: 'disp' };
const MODELS = ['namaqualand_boulder_05'];
const HDRIS = [];

const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r; };
const save = async (url, path) => {
  try { await stat(path); return 0; } catch {}
  await mkdir(dirname(path), { recursive: true });
  const buf = Buffer.from(await (await get(url)).arrayBuffer());
  await writeFile(path, buf);
  return buf.length;
};

let total = 0, count = 0;
for (const id of TEXTURES) {
  const f = await (await get(`https://api.polyhaven.com/files/${id}`)).json();
  for (const [key, short] of Object.entries(TEX_MAPS)) {
    const e = f[key]?.['2k']?.jpg; if (!e) { console.log('なし', id, key); continue; }
    total += await save(e.url, join(ROOT, 'textures', id, `${id}_${short}_2k.jpg`)); count++;
  }
}
for (const id of MODELS) {
  const g = (await (await get(`https://api.polyhaven.com/files/${id}`)).json()).gltf['1k'].gltf;
  total += await save(g.url, join(ROOT, 'models', id, `${id}_1k.gltf`)); count++;
  for (const [rel, e] of Object.entries(g.include)) { total += await save(e.url, join(ROOT, 'models', id, rel)); count++; }
}
for (const id of HDRIS) {
  const e = (await (await get(`https://api.polyhaven.com/files/${id}`)).json()).hdri['1k'].hdr;
  total += await save(e.url, join(ROOT, 'hdri', `${id}_1k.hdr`)); count++;
}
console.log(`ファイル ${count} 個・新規 ${(total / 1e6).toFixed(1)} MB`);
