// 燃えるものの定義（単位は SI：m・kg・秒・℃）
// L,w,h = 長さ・幅・厚み / rho = 密度(kg/m³) / moist = 含水率（乾いた重さに対する水の割合）
// resin = やに（パチッという小さなはぜの出やすさ）/ pockets = 水分のたまりの密度（1L あたりの個数・大きなはぜ）
// areaMul = 表面積の倍率（くしゃくしゃの紙・葉は表面が大きい）/ kp = 熱分解の速さの倍率
// 薪3種は Gemini の設計書どおり：針葉樹＝速く高い火・広葉樹＝遅く熾火が育つ・湿った木＝煙とはぜ
export const TYPES = {
  newspaper: {
    name: '新聞紙', kind: 'ball', L: 0.11, w: 0.10, h: 0.09, rho: 22, moist: 0.05,
    resin: 0, pockets: 0, areaMul: 7, kp: 3, bark: false, cells: [3, 3, 3],
  },
  twig: {
    name: '小枝', kind: 'bundle', L: 0.30, w: 0.07, h: 0.035, rho: 180, moist: 0.10,
    resin: 1.2, pockets: 0.4, areaMul: 4, kp: 1.6, bark: true, cells: [8, 2, 1],
  },
  pine: {
    name: '針葉樹の割り薪', kind: 'split', L: 0.32, w: 0.075, h: 0.06, rho: 420, moist: 0.14,
    resin: 1.3, pockets: 6, areaMul: 1, kp: 1.35, bark: true, cells: [10, 3, 3],
  },
  oak: {
    name: '広葉樹の割り薪', kind: 'split', L: 0.32, w: 0.08, h: 0.065, rho: 680, moist: 0.15,
    resin: 0.35, pockets: 4, areaMul: 1, kp: 0.75, bark: true, cells: [10, 3, 3],
  },
  damp: {
    name: '湿った薪', kind: 'split', L: 0.31, w: 0.08, h: 0.065, rho: 560, moist: 0.48,
    resin: 0.6, pockets: 14, areaMul: 1, kp: 0.7, bark: true, cells: [10, 3, 3],
  },
};

// 物の性質（文献の代表値を丸めたもの。最後の合わせ込みは tools/sim.mjs の実測で）
export const P = {
  TA: 15,              // 夜の気温
  cpWood: 1500,        // 木の比熱 J/kgK
  cpWater: 4180,
  Lv: 2.26e6,          // 水の蒸発熱 J/kg
  kWood: 0.14,         // 木の熱伝導率 W/mK
  kChar: 0.07,         // 炭は熱を通しにくい（断熱層）
  volFrac: 0.78,       // 乾いた木のうち、ガスになって炎になる分
  charFrac: 0.20,      // 炭として残る分（残りは灰）
  dHvol: 13e6,         // ガスが燃えたときの熱 J/kg（燃え残りを差し引いた実効値）
  dHchar: 30e6,        // 炭が燃えたときの熱
  dHpyro: 0.25e6,      // 熱分解に食われる熱
  qFlame: 30e3,        // 炎に包まれた面が受ける熱 W/m²
  hConv: 12,           // 空気との熱のやりとり W/m²K
  sigma: 5.67e-8,
  Tpyro: 230,          // 熱分解が始まる温度
  Tpilot: 300,         // 近くに炎があれば着火する表面温度
  Tauto: 470,          // 炎がなくても自然に着火する温度
  Tchar: 330,          // 炭が燃え始める温度
};
