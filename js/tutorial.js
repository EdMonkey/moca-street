/* ============================================================
 * tutorial.js — 신규 게임 인터랙티브 튜토리얼 (컨텐츠 + 진행 로직)
 * 자체 `tut` 상태를 소유. 게임 코어 상태는 init(ctx)로 받은 라이브 게터로 읽음.
 * 전역 Tutorial로 노출:
 *   Tutorial.init(ctx)   — { orders(), held(), env(), matchesRecipe, toast }
 *   Tutorial.start()     — 튜토리얼 시작 (1단계)
 *   Tutorial.event(name) — 이벤트 훅 ('served' 등)
 *   Tutorial.update()    — 매 프레임 단계 체크
 *   Tutorial.active()    — 진행 중 여부
 *   Tutorial.cancel()    — 중도 종료 ([T] 건너뛰기)
 * 튜토리얼 문구를 수정하려면 아래 STEPS만 고치면 됨.
 * ============================================================ */
const Tutorial = (() => {
  let ctx = null;
  let tut = null;     // { step, startPos } — 비활성 시 null
  let STEPS = null;

  function buildSteps() {
    const orders = ctx.orders, held = ctx.held, env = ctx.env, matchesRecipe = ctx.matchesRecipe;
    return [
      { text: '<b>W A S D</b>로 이동하고, 마우스로 주변을 둘러보세요',
        check: () => tut.startPos && Player.position.distanceTo(tut.startPos) > 2 },
      { text: '손님이 주문을 말하면 <b>ORDER</b> 팻말 아래 <b>POS 계산대</b>에서 <b>[E]</b>로 화면을 열고, 말한 메뉴를 직접 골라 <b>주문 확정</b>하세요',
        check: () => orders().length > 0 },
      { text: '<b>에스프레소 머신</b>에 빈손으로 다가가 <b>[E]</b>를 눌러 <b>포터필터</b>를 분리하세요',
        check: () => { const h = held(); return (h && h.type === 'portafilter') || env().machines.grinderJobs.some(j => j.busy); } },
      { text: '<b>그라인더</b>에 포터필터를 가져가 <b>[E]</b>로 분쇄하세요 (분쇄도는 빈손으로 <b>[E]</b>를 꾹 눌러 조정 — 초록=완벽 추출) — 완료 후 <b>[E]</b>로 꺼내기',
        check: () => { const h = held(); return env().machines.grinderJobs.some(j => j.busy) || (h && h.type === 'portafilter' && (h.state === 'filled' || h.state === 'tamped')); } },
      { text: '<b>탬핑 스테이션</b>에서 <b>[E]</b>를 꾹 눌러 게이지를 채워 원두를 다지세요 (퍼펙트 존에서 떼면 보너스)',
        check: () => { const h = held(); return (h && h.type === 'portafilter' && h.state === 'tamped') || env().machines.espressoSlots.some(s => s.pfState === 'tamped' || s.busy); } },
      { text: '탬핑된 포터필터를 들고 <b>에스프레소 머신</b>에 가서 <b>[E]</b>로 장착하세요',
        check: () => env().machines.espressoSlots.some(s => s.pfState === 'tamped' || s.busy) },
      { text: '컵 디스펜서에서 <b>머그컵</b>을 집어 머신에 올린 뒤, 빈손으로 <b>[E]</b>를 눌러 추출을 시작하세요',
        check: () => { const h = held(); return env().machines.espressoSlots.some(s => s.busy) || (h && h.type === 'drink' && !!h.drink.espresso); } },
      { text: '추출 완료! <b>[E]</b>로 컵을 꺼낸 뒤 주문표의 나머지 재료를 채우세요 — 모르면 <b>[R]</b> 레시피북',
        check: () => { const h = held(); return h && h.type === 'drink' && orders().some(o => o.items.some(it => !it.done && it.type === 'drink' && matchesRecipe(h.drink, it.recipeId))); } },
      { text: '음료 완성! <b>PICK UP</b> 팻말 아래 픽업대에서 <b>[E]</b>로 손님에게 서빙하세요', event: 'served' },
    ];
  }

  function init(c) { ctx = c; STEPS = buildSteps(); }

  function start() {
    tut = { step: 0, startPos: Player.position.clone() };
    show();
  }
  function show() {
    $('tutStep').textContent = `튜토리얼 ${tut.step + 1}/${STEPS.length}`;
    $('tutText').innerHTML = STEPS[tut.step].text;
    $('tutorial').classList.remove('hidden');
  }
  function advance() {
    tut.step++;
    AudioFX.ding();
    if (tut.step >= STEPS.length) { finish(true); return; }
    show();
  }
  function finish(completed) {
    tut = null;
    $('tutorial').classList.add('hidden');
    if (completed) { ctx.toast('🎓 튜토리얼 완료! 이제 진짜 영업 시작입니다', 'gold', 4000); AudioFX.levelup(); }
  }
  function event(name) {
    if (!tut) return;
    // 서빙 = 튜토리얼의 최종 목표 — 단계와 무관하게 완료 처리
    if (name === 'served') finish(true);
  }
  function update() {
    if (!tut) return;
    const st = STEPS[tut.step];
    if (st.check && st.check()) advance();
  }
  function active() { return !!tut; }
  function cancel() { if (tut) finish(false); }

  return { init, start, event, update, active, cancel };
})();
