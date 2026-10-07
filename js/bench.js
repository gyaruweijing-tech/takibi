// 重さの測定（?bench）：燃えている焚き火で、部品を1つずつ外して GPU の時間とコマの間隔を測る
// GPU は EXT_disjoint_timer_query_webgl2（描画にかかった本当の時間）。普段のコマ送りに乗って測る（画面が見えている必要がある）
export async function runBench(ctx) {
  const { renderer, cases } = ctx;
  const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const out = [];
  const el = document.getElementById('debug'); el.style.display = 'block';
  const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] || 0; };
  ctx.running = true;
  for (const c of cases) {
    c.on?.();
    const gpu = [], gaps = [], pending = [];
    let n = 0, last = 0, q = null;
    await new Promise((done) => {
      ctx.beforeRender = () => { if (ext && n >= 15) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } };
      ctx.afterRender = () => {
        if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); q = null; }
        const now = performance.now(); if (n >= 15 && last) gaps.push(now - last); last = now;
        for (let k = pending.length - 1; k >= 0; k--) {
          const p = pending[k];
          if (gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) {
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(p); pending.splice(k, 1);
          }
        }
        if (++n >= 75) done();
      };
    });
    c.off?.();
    const row = { name: c.name, gpu: +median(gpu).toFixed(1), frame: +median(gaps).toFixed(1), calls: renderer.info.render.calls };
    out.push(row);
    el.textContent = '重さの測定（GPU＝絵を描く時間 / コマ＝1コマの間隔）\n' + out.map((r) => `${r.name.padEnd(14, '　')} GPU ${String(r.gpu).padStart(5)}ms  コマ ${String(r.frame).padStart(5)}ms`).join('\n');
  }
  ctx.beforeRender = ctx.afterRender = null; ctx.running = false;
  console.log('BENCH', JSON.stringify(out));
  window.__bench = out;
  return out;
}
