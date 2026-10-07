// 焚き火の音（録音ではなく、ノイズから合成）。Gemini 設計書の3層：
// ① ゴォー（低音）：燃えているガスの熱量に比例して大きく・低く
// ② シュー（中高音）：木の中の水分が沸いて噴き出す音。左右にゆっくり揺れる
// ③ パチッ／バチバチッ（高音）：単発。火の粉・振動と同じ瞬間に鳴らす
export function createAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ctx.destination);
  const len = ctx.sampleRate * 3;
  const white = ctx.createBuffer(1, len, ctx.sampleRate), brown = ctx.createBuffer(1, len, ctx.sampleRate);
  { const w = white.getChannelData(0), b = brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; } }

  function loop(buf, filters, pan = null) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    let node = s; const fs = [];
    for (const f of filters) { const bq = ctx.createBiquadFilter(); bq.type = f[0]; bq.frequency.value = f[1]; bq.Q.value = f[2] ?? 0.7; node.connect(bq); node = bq; fs.push(bq); }
    const g = ctx.createGain(); g.gain.value = 0; node.connect(g);
    if (pan) { g.connect(pan); pan.connect(master); } else g.connect(master);
    s.start(0, Math.random() * 2);
    return { g, fs };
  }
  const roar = loop(brown, [['lowpass', 380]]);
  const rumble = loop(brown, [['lowpass', 110]]);
  const flutter = loop(white, [['bandpass', 800, 0.6]]);
  const hissPan = ctx.createStereoPanner();
  const hiss = loop(white, [['highpass', 3200], ['bandpass', 6500, 0.9]], hissPan);
  const blowL = loop(white, [['bandpass', 420, 0.5]]);

  function burst({ dur, f, q, gain, pan = 0, at = 0, type = 'bandpass' }) {
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource(); s.buffer = white;
    const bq = ctx.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(bq); bq.connect(g); g.connect(p); p.connect(master);
    s.start(t, Math.random() * 2.5); s.stop(t + dur + 0.02);
  }
  let roarLevel = 0, hissPhase = Math.random() * 10;
  return {
    ctx,
    resume() { return ctx.resume(); },
    setMuted(m) { master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.1); },
    // kW：炎の熱量 / steam：湯気 kg/s / bed：熾火の明るさ / blow：吹いている
    update(kW, steam, bed, blow, dt) {
      const t = ctx.currentTime;
      roarLevel += (kW - roarLevel) * Math.min(1, dt * 2);
      const r = Math.min(1, roarLevel / 25), wob = 0.85 + 0.3 * Math.random();
      roar.g.gain.setTargetAtTime(r * 0.5 * wob, t, 0.08);
      roar.fs[0].frequency.setTargetAtTime(260 + 260 * r, t, 0.3);     // 大きい火ほど、こもった重い音が増える
      rumble.g.gain.setTargetAtTime(r * 0.55 + bed * 0.05, t, 0.2);
      flutter.g.gain.setTargetAtTime(r * 0.05 * (0.4 + Math.random()), t, 0.04);
      hissPhase += dt * (0.2 + Math.random() * 0.3);
      hissPan.pan.setTargetAtTime(Math.sin(hissPhase) * 0.6 + (Math.random() - 0.5) * 0.3, t, 0.2);
      hiss.g.gain.setTargetAtTime(Math.min(0.12, steam * 90), t, 0.25);
      blowL.g.gain.setTargetAtTime(blow ? 0.22 : 0, t, 0.06);
    },
    tick(s, pan) {
      burst({ dur: 0.004 + Math.random() * 0.012, f: 1800 + Math.random() * 4500, q: 1 + Math.random() * 3, gain: 0.22 * s, pan });
      if (Math.random() < 0.3) burst({ dur: 0.006, f: 2500 + Math.random() * 3000, q: 2, gain: 0.12 * s, pan, at: 0.01 + Math.random() * 0.04 });
    },
    crack(s, pan) {
      burst({ dur: 0.025, f: 1200 + Math.random() * 1500, q: 0.8, gain: 0.45 * s, pan });
      burst({ dur: 0.01, f: 4000, q: 0.6, gain: 0.3 * s, pan, type: 'highpass' });
    },
    pop(s, pan) {
      burst({ dur: 0.05, f: 900 + Math.random() * 900, q: 0.8, gain: 0.8 * Math.min(1.4, s), pan });
      burst({ dur: 0.02, f: 3000, q: 0.5, gain: 0.55 * Math.min(1.4, s), pan, type: 'highpass' });
      let at = 0.02; const n = 3 + Math.floor(Math.random() * 7);
      for (let i = 0; i < n; i++) { at += 0.012 + Math.random() * 0.06; burst({ dur: 0.004 + Math.random() * 0.015, f: 1500 + Math.random() * 5000, q: 1.5, gain: (0.15 + Math.random() * 0.3) * s, pan, at }); }
    },
    thud(impact, pan) {
      const t = ctx.currentTime, g = Math.min(0.7, impact * 0.12);
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(110 + Math.random() * 60, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.15);
      const og = ctx.createGain(); og.gain.setValueAtTime(g, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      const p = ctx.createStereoPanner(); p.pan.value = pan; o.connect(og); og.connect(p); p.connect(master); o.start(t); o.stop(t + 0.2);
      burst({ dur: 0.06, f: 700, q: 0.8, gain: g * 0.6, pan, type: 'lowpass' });
    },
    collapse(pan) { for (let i = 0; i < 14; i++) burst({ dur: 0.01 + Math.random() * 0.03, f: 600 + Math.random() * 3000, q: 1, gain: 0.12 + Math.random() * 0.18, pan, at: Math.random() * 0.35 }); },
    strike(pan) { burst({ dur: 0.12, f: 2500, q: 0.7, gain: 0.5, pan, type: 'highpass' }); burst({ dur: 0.5, f: 1200, q: 0.4, gain: 0.22, pan, at: 0.08 }); },
  };
}
