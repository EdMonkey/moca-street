/* ============================================================
 * debug.js — 개발용 상태 전환 패널
 * ============================================================ */
const DebugPanel = (() => {
  function el(id) { return document.getElementById(id); }

  function refresh() {
    const box = el('debugStatus');
    if (!box || !window.Game && typeof Game === 'undefined') return;
    const s = Game._debug.state();
    const labels = {
      prep: '영업전',
      playing: '영업중',
      after: '영업후',
      dayEnd: '정산',
      gameOver: '폐업',
    };
    box.innerHTML =
      `상태 <b>${labels[s.mode] || s.mode}</b> · DAY ${s.day}<br>` +
      `돈 ${s.money.toLocaleString('ko-KR')} · 문 ${s.open ? 'OPEN' : 'CLOSE'}`;
  }

  function run(action) {
    if (!Game || !Game._debug) return;
    if (action === 'prep') Game._debug.goPrep();
    else if (action === 'open') Game._debug.goOpen();
    else if (action === 'after') Game._debug.goAfter();
    else if (action === 'closeDay') Game._debug.endDayNow();
    else if (action === 'addMoney') Game._debug.addMoney(el('debugMoneyAmount').value);
    refresh();
  }

  function init() {
    const toggle = el('debugToggle');
    const panel = el('debugPanel');
    if (!toggle || !panel) return;
    toggle.onclick = () => {
      panel.classList.toggle('hidden');
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
      refresh();
    };
    panel.querySelectorAll('[data-debug]').forEach(btn => {
      btn.onclick = () => run(btn.dataset.debug);
    });
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { init, refresh };
})();
