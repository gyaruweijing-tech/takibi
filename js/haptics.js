// 振動（ゲームパッドがあるときだけ）。Gemini 設計書の2種類：
// ① ずっと続く弱いうなり：炎の熱量に合わせて 0.1〜0.2 の弱さで
// ② はぜた瞬間の鋭い一撃：短く強く（ブラウザでは「鋭さ」は選べないので、短さで鋭く感じさせる）
export function createHaptics() {
  let last = 0, hum = 0;
  const pad = () => [...(navigator.getGamepads?.() || [])].find((g) => g && g.vibrationActuator);
  const play = (dur, strong, weak) => {
    const g = pad(); if (!g) return false;
    g.vibrationActuator.playEffect('dual-rumble', { duration: dur, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
    return true;
  };
  return {
    get connected() { return !!pad(); },
    // 毎フレーム：うなり（0.25秒ごとに更新）
    update(kW, now) {
      hum = 0.1 + Math.min(0.1, kW / 250);
      if (kW < 0.5 || now - last < 250) return;
      last = now;
      play(300, 0, hum * (0.85 + Math.random() * 0.3));
    },
    pop(s) { last = performance.now(); play(40 + s * 30, 0.6 + s * 0.3, 0.2); },
    crack(s) { last = performance.now(); play(25, 0.35 * s + 0.2, 0.1); },
    thud(i) { play(60, Math.min(0.6, i * 0.1), 0.2); },
  };
}
