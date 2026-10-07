// 画面の部品：下の棚（材料・マッチ・火ばさみを選ぶ）と、左上の薄いメニュー
// 拾って運ぶ所は3Dにせず「選ぶ」にした（火そのものに手間と処理を回すため）
export const SHELF = [
  { key: 'newspaper', label: '新聞紙' },
  { key: 'twig', label: '小枝' },
  { key: 'pine', label: '針葉樹' },
  { key: 'oak', label: '広葉樹' },
  { key: 'damp', label: '湿った薪' },
  { key: 'match', label: 'マッチ', gap: true },
  { key: 'tongs', label: '火ばさみ' },
];

const CSS = `
#shelf { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 6px; z-index: 5; padding: 6px; border-radius: 16px; background: #fbfaf722; backdrop-filter: blur(6px); max-width: calc(100vw - 32px); overflow-x: auto; }
#shelf button { border: 0; border-radius: 12px; padding: 8px 12px; font: 13px/1 inherit; font-family: inherit; color: #2a2622; background: #fbfaf7c8; cursor: pointer; white-space: nowrap; }
#shelf button.gap { margin-left: 10px; }
#shelf button.on { background: #b4582a; color: #fff; }
#hint { position: fixed; left: 50%; bottom: 64px; transform: translateX(-50%); color: #fbfaf7cc; font-size: 12px; z-index: 5; pointer-events: none; text-shadow: 0 1px 3px #000; white-space: nowrap; }
#menuBtn { position: fixed; left: 14px; top: 12px; z-index: 7; width: 36px; height: 36px; border-radius: 10px; border: 0; background: #fbfaf722; color: #fbfaf7aa; font-size: 18px; cursor: pointer; }
#menuBtn:hover { background: #fbfaf755; color: #fff; }
#menu { position: fixed; left: 14px; top: 56px; z-index: 7; background: #fbfaf7; color: #2a2622; border-radius: 14px; padding: 10px; width: 230px; box-shadow: 0 12px 40px #0008; display: none; }
#menu button { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 10px 10px; border-radius: 8px; font-size: 14px; font-family: inherit; color: inherit; cursor: pointer; }
#menu button:hover { background: #efe9df; }
#menu hr { border: 0; border-top: 1px solid #e6e0d6; margin: 6px 4px; }
#menu .help { font-size: 12px; color: #6d655c; line-height: 1.7; padding: 4px 10px 6px; display: none; }
`;

const HINTS = {
  none: '材料を選ぶ ・ 何もない所をドラッグで見回す ・ ホイールで近づく ・ スペースで吹く',
  wood: 'クリックで置く ・ ホイールで向きを回す ・ 右クリックでやめる',
  match: 'クリックで擦って、その場所に置く',
  tongs: '動かす薪をクリック → 動かしたい先をクリック',
  tongs2: '動かしたい先をクリック（右クリックでやめる）',
};

export function createUI({ onSelect, onMode, onSound }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const shelf = document.createElement('div'); shelf.id = 'shelf';
  const hint = document.createElement('div'); hint.id = 'hint';
  const btns = {};
  for (const s of SHELF) {
    const b = document.createElement('button'); b.textContent = s.label; if (s.gap) b.className = 'gap';
    b.onclick = (e) => { e.stopPropagation(); onSelect(cur === s.key ? null : s.key); };
    shelf.append(b); btns[s.key] = b;
  }
  const menuBtn = document.createElement('button'); menuBtn.id = 'menuBtn'; menuBtn.textContent = '≡'; menuBtn.title = 'メニュー';
  const menu = document.createElement('div'); menu.id = 'menu';
  const item = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { fn(); }; menu.append(b); return b; };
  item('最初から（火をおこす）', () => { close(); onMode('new'); });
  item('燃えている焚き火から', () => { close(); onMode('lit'); });
  menu.append(document.createElement('hr'));
  const sound = item('音を消す', () => { sound.textContent = onSound() ? '音を出す' : '音を消す'; });
  const helpBtn = item('操作の説明', () => { help.style.display = help.style.display === 'block' ? 'none' : 'block'; });
  const help = document.createElement('div'); help.className = 'help';
  help.innerHTML = '下の棚で材料を選び、台の上でクリックすると置ける（ホイールで向き）。<br>マッチ：選んでクリックで擦って置く。<br>火ばさみ：薪をクリック→動かす先をクリック。<br>スペース長押しで吹く（V でマイク）。<br>何もない所をドラッグで見回す。';
  menu.append(help);
  const close = () => { menu.style.display = 'none'; };
  menuBtn.onclick = (e) => { e.stopPropagation(); menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; };
  addEventListener('pointerdown', (e) => { if (!menu.contains(e.target) && e.target !== menuBtn) close(); });
  let cur = null;
  return {
    mount() { document.body.append(shelf, hint, menuBtn, menu); this.setTool(null); },
    setTool(k, stage) {
      cur = k;
      for (const [key, b] of Object.entries(btns)) b.classList.toggle('on', key === k);
      hint.textContent = HINTS[!k ? 'none' : k === 'match' ? 'match' : k === 'tongs' ? (stage ? 'tongs2' : 'tongs') : 'wood'];
    },
  };
}
