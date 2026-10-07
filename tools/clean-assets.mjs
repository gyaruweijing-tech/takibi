// 公開前の素材の掃除
// 1) JPEG から Exif/XMP（撮影地の位置情報など）を取り除く。画像の中身は再圧縮しない（劣化なし）
// 2) glTF の .bin（またはbase64）を、数字だけの JSON（.bytes.json）に置き換える（検査できる形にする。base64 は偶然ほかの言葉と一致しうる）
// node tools/clean-assets.mjs
import { readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join, dirname, extname, basename } from 'node:path';

const ROOT = new URL('../assets/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
async function* walk(d) { for (const e of await readdir(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else yield p; } }

function stripJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out = [buf.subarray(0, 2)];
  let i = 2, removed = 0;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xda) { out.push(buf.subarray(i)); break; }          // 画像データの始まり：残りはそのまま
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    if (m === 0xe1 || m === 0xed) removed++; else out.push(seg);  // APP1（Exif/XMP）・APP13（IPTC）を捨てる
    i += 2 + len;
  }
  return removed ? Buffer.concat(out) : null;
}

let jpg = 0, gltf = 0;
for await (const f of walk(ROOT)) {
  const ext = extname(f).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    const b = stripJpeg(await readFile(f));
    if (b) { await writeFile(f, b); jpg++; }
  } else if (ext === '.gltf') {
    const j = JSON.parse(await readFile(f, 'utf8'));
    let changed = false;
    for (const buf of j.buffers || []) {
      if (buf.uri && buf.uri.endsWith('.bytes.json')) { if (buf.uri !== basename(buf.uri)) { buf.uri = basename(buf.uri); changed = true; } continue; }
      if (!buf.uri) continue;
      let bytes;
      if (buf.uri.startsWith('data:')) bytes = Buffer.from(buf.uri.split(',')[1], 'base64');
      else { const bin = join(dirname(f), buf.uri); bytes = await readFile(bin); await rm(bin); }
      const name = f.replace(/\.gltf$/, '') + '.' + (j.buffers.indexOf(buf)) + '.bytes.json';
      await writeFile(name, JSON.stringify(Array.from(bytes)));
      buf.uri = basename(name); changed = true;   // PC の中の場所を書き込まない
    }
    if (changed) { await writeFile(f, JSON.stringify(j)); gltf++; }
  }
}
console.log(`位置情報を消した JPEG ${jpg} 枚・.bin を埋め込んだ glTF ${gltf} 個`);
