// 実写の炎の動画 → 炎だけのパラパラ漫画（フリップブック）
// 1) 手ぶれ補正（ffmpeg vidstab・最初のコマに合わせる）
// 2) 全コマの「いちばん暗い値」を背景とみなし、各コマから引く（炎はゆらいで消える瞬間があるので、背景だけが残る）
// 3) 指定した窓で切り出し、端をぼかし、最後と最初を重ねてつなぎ目のないループにする
// 4) 黒背景の JPG に並べる（ゲーム側は足し算で重ねるので、透明は要らない）
//
// 使い方: node tools/footage-flames.mjs <動画> <出力名> x,y,w,h [x,y,w,h ...]
//   座標は手ぶれ補正後・回転後のコマ（縦長）での画素。元の動画はリポジトリの外に置く
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [srcArg, name, ...cropArgs] = process.argv.slice(2);
const src = srcArg && resolve(srcArg);
// 環境変数 SEG=開始秒,長さ で区間だけ使う（手持ちの長い動画から、ぶれの少ない所を選ぶ）
const seg = process.env.SEG ? ['-ss', process.env.SEG.split(',')[0], '-t', process.env.SEG.split(',')[1]] : [];
if (!src || !name || !cropArgs.length) { console.error('使い方: node tools/footage-flames.mjs <動画> <出力名> x,y,w,h ...'); process.exit(1); }
const OUT = new URL('../assets/flames/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const FW = 192, FH = 288;   // 1コマの大きさ（縦長の炎）
const FADE = 18;            // ループのつなぎ目で重ねるコマ数
const tmp = join(tmpdir(), `takibi-${process.pid}`);
await mkdir(tmp, { recursive: true });
await mkdir(OUT, { recursive: true });

const ff = (args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit', cwd: tmp }); if (r.status) throw new Error('ffmpeg ' + args.join(' ')); };
const probe = (f) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', f]);
  const [w, h, fr] = r.stdout.toString().trim().split(',');
  const [a, b] = fr.split('/').map(Number);
  return { w: +w, h: +h, fps: a / b };
};

// 1) 手ぶれ補正
const trf = 't.trf'; // ffmpeg は tmp で動かす（Windows のドライブ名の : がフィルタの区切りとぶつかるため）
const stab = join(tmp, 'stab.mkv');
ff([...seg, '-i', src, '-an', '-vf', `vidstabdetect=shakiness=4:accuracy=15:tripod=1:result=${trf}`, '-f', 'null', '-']);
ff([...seg, '-i', src, '-an', '-vf', `vidstabtransform=input=${trf}:tripod=1:optzoom=0:interpol=bicubic:crop=black`, '-c:v', 'ffv1', stab]);
const { w: W, h: H, fps } = probe(stab);

// コマを生で読む（RGB）
function readFrames(file, onFrame) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const size = W * H * 3; let buf = Buffer.alloc(0), n = 0;
    p.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= size) { onFrame(buf.subarray(0, size), n++); buf = buf.subarray(size); }
    });
    p.on('close', (c) => (c ? rej(new Error('ffmpeg read')) : res(n)));
  });
}

// 2) 背景（全コマの最小値）。補正で黒くなった縁は背景ではないので除外する
const bg = new Uint8Array(W * H * 3).fill(255);
const frames = await readFrames(stab, (f) => { for (let i = 0; i < f.length; i++) if (f[i] < bg[i]) bg[i] = f[i]; });
console.log(`${W}x${H} ${fps}fps ${frames}コマ`);

const crops = cropArgs.map((s) => { const [x, y, w, h] = s.split(',').map(Number); return { x, y, w, h, out: [] }; });

// 3) 切り出し（背景を引き、縮小し、端をぼかす）
// 抜き方: 背景との差 KEY[0]→KEY[1] で 0→1、明るさ KEY[2]→KEY[3] で 0→1（環境変数 KEY で上書き）
const KEY = (process.env.KEY || '20,70,70,150').split(',').map(Number);
const soft = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));
await readFrames(stab, (f) => {
  for (const c of crops) {
    const o = new Float32Array(FW * FH * 3);
    const sx = c.w / FW, sy = c.h / FH;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      // 縮小は箱の平均
      let r = 0, g = 0, b = 0, k = 0;
      for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
        const X = c.x + xx, Y = c.y + yy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const i = (Y * W + X) * 3;
        if (f[i] + f[i + 1] + f[i + 2] === 0) continue; // 補正で入った黒
        // 炎＝背景より明るく、しかもそれ自体が明るい所。色は元のコマのまま残す（背景を引くと色が青くずれた）
        const L = f[i] * 0.3 + f[i + 1] * 0.59 + f[i + 2] * 0.11;
        const Lb = bg[i] * 0.3 + bg[i + 1] * 0.59 + bg[i + 2] * 0.11;
        const mk = soft(L - Lb, KEY[0], KEY[1]) * soft(L, KEY[2], KEY[3]);
        r += f[i] * mk; g += f[i + 1] * mk; b += f[i + 2] * mk; k++;
      }
      if (!k) continue;
      // 端：横と上は少し、下（炎の根元）は長めにぼかす
      const u = x / (FW - 1), v = y / (FH - 1);
      const edge = soft(u, 0, 0.12) * soft(1 - u, 0, 0.12) * soft(v, 0, 0.08) * soft(1 - v, 0, 0.32);
      const j = (y * FW + x) * 3, s = edge / k;
      o[j] = r * s; o[j + 1] = g * s; o[j + 2] = b * s;
    }
    c.out.push(o);
  }
});

// 4) ループにして並べる
for (const [ci, c] of crops.entries()) {
  const L = c.out.length, N = L - FADE;
  const loop = [];
  for (let i = 0; i < N; i++) {
    if (i >= FADE) { loop.push(c.out[i]); continue; }
    const a = i / FADE, A = c.out[i], B = c.out[N + i], o = new Float32Array(A.length);
    for (let j = 0; j < o.length; j++) o[j] = A[j] * a + B[j] * (1 - a);
    loop.push(o);
  }
  const cols = Math.ceil(Math.sqrt(N * FH / FW)), rows = Math.ceil(N / cols);
  const AW = cols * FW, AH = rows * FH;
  const atlas = Buffer.alloc(AW * AH * 3);
  const lum = [];
  loop.forEach((o, n) => {
    const ox = (n % cols) * FW, oy = Math.floor(n / cols) * FH;
    let sum = 0;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const j = (y * FW + x) * 3, i = ((oy + y) * AW + ox + x) * 3;
      atlas[i] = Math.min(255, o[j]); atlas[i + 1] = Math.min(255, o[j + 1]); atlas[i + 2] = Math.min(255, o[j + 2]);
      sum += o[j] * 0.2126 + o[j + 1] * 0.7152 + o[j + 2] * 0.0722;
    }
    lum.push(+(sum / (FW * FH * 255)).toFixed(5));
  });
  const raw = join(tmp, `a${ci}.rgb`);
  await writeFile(raw, atlas);
  const base = `${name}-${ci}`;
  ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${AW}x${AH}`, '-i', raw, '-q:v', '3', join(OUT, `${base}.jpg`)]);
  const meta = { frames: N, cols, rows, fw: FW, fh: FH, fps, lum };
  await writeFile(join(OUT, `${base}.json`), JSON.stringify(meta));
  console.log(`${base}: ${N}コマ ${cols}x${rows} → ${AW}x${AH} 明るさ平均 ${(lum.reduce((a, b) => a + b) / N).toFixed(4)}`);
}
await rm(tmp, { recursive: true, force: true });
