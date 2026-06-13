/* ============================================================
 * ui.js — 표현(프레젠테이션) 레이어: 상태를 읽어 DOM/HUD를 그림
 * 순수 읽기→DOM. 상태를 변경하거나 구매/저장 로직을 직접 하지 않음.
 *   (구매 버튼이 있는 업그레이드/장비 패널은 로직과 묶여 있어 game.js에 남김)
 * 코어 상태는 init(ctx)로 받은 라이브 게터·헬퍼로 접근.
 * 전역 UI로 노출:
 *   UI.init(ctx)        — { S(),held(),orders(),mode(),env(),timeSec(),open(),
 *                           fmt, drinkPrice, matchesRecipe, drinkIngredients, itemLabel, itemName }
 *   UI.hud()            — 상단 HUD(돈/일차/평판/레벨/재고)
 *   UI.clock()          — 시계·영업 상태
 *   UI.held()           — 손에 든 것 표시
 *   UI.prompt(it)       — 조준 대상 프롬프트 텍스트(HTML) 반환 (DOM 미변경)
 *   UI.recipeBook()     — 레시피북 그리드
 *   UI.addTicket(o) / renderTicketItems(o) / removeTicket(o) / ticketBars()
 * ============================================================ */
const UI = (() => {
  const { RECIPES, DESSERTS, RESTOCK, LEVEL_XP, MAX_LVL, DAY_LEN } = DATA;
  let ctx = null;
  function init(c) { ctx = c; }

  /* ----- 손에 든 것 ----- */
  function held() {
    const el = $('held');
    const h = ctx.held();
    if (!h) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (h.type === 'drink') {
      const match = Object.keys(RECIPES).find(k => ctx.matchesRecipe(h.drink, k));
      const name = match ? `<b style="color:var(--accent2)">${RECIPES[match].name}</b>` : '제조 중인 음료';
      el.innerHTML = `${name}<div class="ing">${ctx.drinkIngredients(h.drink).join(' + ')}</div>`;
    } else if (h.type === 'portafilter') {
      const info = h.state === 'filled' ? '원두 채움 — 머신에 장착하세요'
        : h.state === 'used' ? '사용한 가루 — 넉박스에 비우세요'
        : '비어 있음 — 그라인더에서 분쇄하세요';
      el.innerHTML = `<b style="color:var(--accent2)">포터필터</b><div class="ing">${info}</div>`;
    } else {
      el.innerHTML = `<b style="color:var(--accent2)">${DESSERTS[h.kind].name}</b>`;
    }
  }

  /* ----- 주문표 티켓 ----- */
  function addTicket(o) {
    const div = document.createElement('div');
    div.className = 'ticket panel';
    div.innerHTML =
      `<div class="tname">주문 #${o.num}</div><div class="titems"></div>` +
      `<div class="tbar"><div style="width:100%"></div></div>`;
    o.el = div;
    o.itemsEl = div.querySelector('.titems');
    o.barEl = div.querySelector('.tbar div');
    renderTicketItems(o);
    $('tickets').appendChild(div);
  }
  function renderTicketItems(o) {
    const itemName = ctx.itemName;
    o.itemsEl.innerHTML = o.items.map(it => {
      const hint = (!it.done && it.type === 'drink')
        ? `<div class="thint">${RECIPES[it.recipeId].steps.join(' → ')}</div>` : '';
      return `<div class="${it.done ? 'done' : ''}">· ${itemName(it)}</div>${hint}`;
    }).join('');
  }
  function removeTicket(o) { if (o.el) { o.el.remove(); o.el = null; } }
  function ticketBars() {
    ctx.orders().forEach(o => {
      if (!o.el) return;
      const frac = Math.max(0, o.customer.patience / o.customer.patienceMax);
      o.barEl.style.width = (frac * 100) + '%';
      o.el.classList.toggle('angry', frac < 0.3);
    });
  }

  /* ----- 조준 프롬프트 (DOM 미변경, 문자열 반환) ----- */
  function prompt(it) {
    const held = ctx.held(), env = ctx.env(), S = ctx.S(), fmt = ctx.fmt, itemLabel = ctx.itemLabel;
    if (!it) return null;
    const E = '<b>[E]</b> ';
    switch (it.id) {
      case 'register': return Customers.frontCustomer() ? E + '주문 받기' : '대기 중인 손님이 없습니다';
      case 'pickup': return held ? E + '서빙하기' : '완성된 음료를 들고 오세요';
      case 'placedItem': return held ? '손을 비우면 집을 수 있어요' : E + itemLabel(it.rec.item) + ' 집기';
      case 'cupHot': return E + '머그컵 잡기';
      case 'cupIce': return E + '아이스컵 잡기';
      case 'cupEsp': return E + '에스프레소 잔 잡기';
      case 'ice': return E + '얼음 담기';
      case 'grinder': {
        const job = it.job;
        if (job.busy) {
          if (!job.done) return `분쇄 중… ${Math.ceil(job.dur - job.t)}s`;
          return held ? '손을 비우면 포터필터를 꺼낼 수 있어요' : E + '분쇄 완료 — 포터필터 꺼내기';
        }
        if (!held) return '머신에서 포터필터를 분리해 오세요';
        if (held.type !== 'portafilter') return '포터필터를 들고 오세요';
        if (held.state === 'used') return '넉박스에 가루를 먼저 비우세요';
        if (held.state === 'filled') return '이미 분쇄된 포터필터예요';
        if (held.state === 'tamped') return '이미 탬핑된 포터필터예요';
        if (S.stocks.beans <= 0) return '원두 없음 — 창고에서 보충하세요';
        return E + '원두 분쇄 시작';
      }
      case 'espresso': {
        const slot = env.machines.espressoSlots[it.slot];
        if (slot.locked && !S.upgrades.dualHead) return '🔒 듀얼 그룹헤드 (업그레이드 필요)';
        if (slot.busy) return slot.done ? E + '에스프레소 꺼내기 ☕' : `추출 중… ${Math.ceil(slot.dur - slot.t)}s`;
        // 컵을 들고 있으면 샷잔 올리기
        if (held && held.type === 'drink' && !held.drink.espresso)
          return slot.cupMesh ? '이미 컵이 올라가 있어요' : E + '샷잔 올리기';
        if (held && held.type === 'drink') return '이미 샷이 추출된 컵이에요';
        if (held && held.type === 'portafilter') return slot.pfState !== 'none' ? '이미 장착되어 있어요' : E + '포터필터 장착';
        // 빈손 + 컵이 올라가 있음 → 추출 버튼
        if (slot.cupMesh) {
          if (slot.pfState === 'tamped') return E + '에스프레소 추출 ▶';
          if (slot.pfState === 'filled') return E + '샷잔 내리기 (탬핑 필요)';
          if (slot.pfState === 'used') return E + '샷잔 내리기 (사용한 가루 비우기)';
          if (slot.pfState === 'empty') return E + '샷잔 내리기 (포터필터 분쇄 필요)';
          return E + '샷잔 내리기 (포터필터 장착·탬핑 필요)';
        }
        // 빈손 + 컵 없음 → 포터필터 분리
        if (slot.pfState === 'none') return '포터필터 없음 — 그라인더에서 분쇄 후 장착하세요';
        if (slot.pfState === 'tamped') return E + '포터필터 분리 (탬핑 완료 ✓ — 샷잔을 올리세요)';
        if (slot.pfState === 'filled') return E + '포터필터 분리 (탬핑 필요 — 탬핑 스테이션으로)';
        return E + `포터필터 분리 (${slot.pfState === 'used' ? '사용한 가루 — 넉박스에 비우세요' : '비어 있음 — 분쇄하세요'})`;
      }
      case 'steamer': {
        const job = it.job;
        if (job.busy) {
          if (!job.done) return `스팀 중… ${Math.ceil(job.dur - job.t)}s`;
          return held ? '손을 비우면 컵을 꺼낼 수 있어요' : E + '컵 꺼내기';
        }
        if (held && held.type === 'drink')
          return held.drink.milk ? E + '컵 올려 우유 거품 만들기' : E + '컵 올려 우유 스팀';
        return '컵을 들고 오세요';
      }
      case 'waterHot': case 'waterCold': {
        const job = env.machines.waterJobs[it.id];
        const nm = it.id === 'waterHot' ? '온수' : '냉수';
        if (job.busy) {
          if (!job.done) return `${nm} 받는 중…`;
          return held ? '손을 비우면 컵을 꺼낼 수 있어요' : E + '컵 꺼내기';
        }
        if (held && held.type === 'drink' && !held.drink.water) return E + `컵 올려 ${nm} 받기`;
        return '물이 없는 컵을 들고 오세요';
      }
      case 'syrup': return E + { vanilla: '바닐라', caramel: '카라멜', choco: '초코' }[it.kind] + ' 시럽 넣기';
      case 'whip': return E + '휘핑크림 올리기';
      case 'dessert': return E + DESSERTS[it.kind].name + ' 꺼내기 (' + fmt(DESSERTS[it.kind].price) + ')';
      case 'knockbox': {
        if (held && held.type === 'portafilter') {
          if (held.state === 'used') return E + '사용한 가루 털어내기';
          return (held.state === 'filled' || held.state === 'tamped') ? '추출 전이에요 — 머신에 장착하세요' : '비울 가루가 없어요';
        }
        return '사용한 포터필터를 들고 오세요';
      }
      case 'tamp': {
        if (!held || held.type !== 'portafilter') return '분쇄된 포터필터를 들고 오세요';
        if (held.state === 'empty') return '먼저 그라인더에서 원두를 분쇄하세요';
        if (held.state === 'used') return '사용한 가루예요 — 넉박스에 비우세요';
        if (held.state === 'tamped') return '이미 탬핑이 끝났어요 — 머신에 장착하세요';
        return '<b>[E]</b> 탬핑 시작 (이후 다시 누르고 있어 게이지 채우기)';
      }
      case 'trash': {
        if (held && held.type === 'portafilter')
          return held.state === 'used' ? E + '사용한 가루 털어내기 (포터필터는 유지됩니다)' : '⛔ 포터필터는 버릴 수 없어요';
        return E + '버리기';
      }
      case 'restock': {
        const r = RESTOCK[it.kind];
        return E + `${r.name} 보충 +${r.amount} (${fmt(r.price)})`;
      }
    }
    return null;
  }

  /* ----- HUD ----- */
  function hud() {
    const S = ctx.S(), fmt = ctx.fmt;
    $('money').textContent = fmt(S.money);
    $('dayLabel').textContent = 'DAY ' + S.day;
    const stars = Math.round(S.rep / 20);
    $('repRow').firstChild.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars) + ' ';
    $('repVal').textContent = `평판 ${S.rep}`;
    $('lvl').textContent = S.level;
    const prev = LEVEL_XP[S.level - 1], next = LEVEL_XP[S.level];
    if (S.level >= MAX_LVL) {
      $('xpBar').style.width = '100%';
      $('xpTxt').textContent = 'MAX · 마스터(팁+12%)';
    } else {
      $('xpBar').style.width = ((S.xp - prev) / (next - prev) * 100) + '%';
      $('xpTxt').textContent = `${S.xp}/${next} XP`;
    }
    const st = S.stocks;
    $('stocks').innerHTML =
      `<span class="${st.beans <= 5 ? 'low' : ''}">☕ 원두 <span class="val">${st.beans}</span></span><br>` +
      `<span class="${st.milk <= 4 ? 'low' : ''}">🥛 우유 <span class="val">${st.milk}</span></span><br>` +
      `<span class="${st.cups <= 6 ? 'low' : ''}">🥤 컵 <span class="val">${st.cups}</span></span><br>` +
      `<span class="${st.dessert <= 2 ? 'low' : ''}">🍰 디저트 <span class="val">${st.dessert}</span></span>`;
  }

  function clock() {
    const os = $('openState');
    if (ctx.mode() === 'prep') {
      $('clock').textContent = '08:00';
      os.textContent = '● 영업 준비 중'; os.className = 'closed';
      return;
    }
    const h = 9 + (ctx.timeSec() / DAY_LEN) * 9;
    const hh = Math.min(18, h) | 0;
    const mm = Math.min(59, ((h - hh) * 60) | 0);
    $('clock').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    if (ctx.open()) { os.textContent = '● 영업 중'; os.className = 'open'; }
    else { os.textContent = '● 마감 — 남은 손님 응대'; os.className = 'closed'; }
  }

  /* ----- 레시피북 ----- */
  function recipeBook() {
    const S = ctx.S(), fmt = ctx.fmt, drinkPrice = ctx.drinkPrice;
    const grid = $('recipeGrid');
    grid.innerHTML = '';
    // 에스프레소 샷 추출 과정 안내 카드
    const guide = document.createElement('div');
    guide.className = 'recipe';
    guide.style.gridColumn = '1 / -1';
    guide.innerHTML =
      `<div class="rname"><span>⚙️ 에스프레소 샷 내리는 법</span></div>` +
      `<ol class="rsteps"><li><b>에스프레소 머신</b>에서 <b>[E]</b>로 포터필터를 분리하세요</li>` +
      `<li><b>그라인더</b>에 가져가 <b>[E]</b>로 원두를 분쇄하고 꺼내세요</li>` +
      `<li><b>탬핑 스테이션</b>에서 <b>[E]</b>를 꾹 눌러 게이지를 채워 다지세요 (퍼펙트 존에서 떼면 팁 보너스)</li>` +
      `<li>탬핑된 포터필터를 머신에 <b>장착</b>하고, 샷잔을 올린 뒤 <b>빈손으로 [E]</b>를 눌러 추출하세요</li>` +
      `<li>추출이 끝나면 <b>[E]</b>로 컵을 꺼내세요 — 포터필터는 머신에 남아요</li>` +
      `<li>포터필터를 분리해 <b>넉박스</b>에서 <b>[E]</b>로 가루를 털어내면 다음 샷 준비 완료!</li></ol>`;
    grid.appendChild(guide);
    Object.keys(RECIPES).forEach(k => {
      const r = RECIPES[k];
      const locked = r.lvl > S.level;
      const div = document.createElement('div');
      div.className = 'recipe' + (locked ? ' locked' : '');
      div.innerHTML =
        `<div class="rname"><span>☕ ${r.name}</span><span>${locked ? `<span class="lockTag">🔒 Lv.${r.lvl}</span>` : fmt(drinkPrice(k))}</span></div>` +
        `<ol class="rsteps">${r.steps.map(s => `<li>${s}</li>`).join('')}</ol>`;
      grid.appendChild(div);
    });
    Object.keys(DESSERTS).forEach(k => {
      const d = DESSERTS[k];
      const locked = d.lvl > S.level;
      const div = document.createElement('div');
      div.className = 'recipe' + (locked ? ' locked' : '');
      div.innerHTML =
        `<div class="rname"><span>🍰 ${d.name}</span><span>${locked ? `<span class="lockTag">🔒 Lv.${d.lvl}</span>` : fmt(d.price)}</span></div>` +
        `<ol class="rsteps"><li>쇼케이스에서 꺼내 바로 서빙</li></ol>`;
      grid.appendChild(div);
    });
  }

  return { init, hud, clock, held, prompt, recipeBook, addTicket, renderTicketItems, removeTicket, ticketBars };
})();
