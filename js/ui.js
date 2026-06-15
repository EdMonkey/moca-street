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
    } else if (h.type === 'shotglass') {
      const info = h.filled ? '에스프레소 — 컵에 따르세요' : '비어 있음 — 머신에서 샷을 받으세요';
      el.innerHTML = `<b style="color:var(--accent2)">샷잔</b><div class="ing">${info}</div>`;
    } else if (h.type === 'pitcher') {
      const info = h.foam ? '우유+거품 — 컵에 부으세요' : h.milk ? '데운 우유 — 컵에 부으세요' : '비어 있음 — 스티머에서 데우세요';
      el.innerHTML = `<b style="color:var(--accent2)">스팀 피처</b><div class="ing">${info}</div>`;
    } else if (h.type === 'deliveryBox') {
      const r = RESTOCK[h.kind];
      el.innerHTML = `<b style="color:var(--accent2)">${r.name} 택배박스</b><div class="ing">창고 ${r.name} 칸에 넣기 · ${h.amount}개</div>`;
    } else if (h.type === 'supply') {
      const r = RESTOCK[h.kind];
      el.innerHTML = `<b style="color:var(--accent2)">${r.name} 1개</b><div class="ing">사용처에 보충하세요</div>`;
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
    const target = { grinder: 'beans', pitcherrack: 'milk', cupHot: 'cups', cupIce: 'cups', cupEsp: 'cups', dessert: 'dessert' }[it.id];
    if (held && held.type === 'supply' && target) {
      const r = RESTOCK[target];
      return held.kind === target ? E + `${r.name} 사용처 보충` : `${RESTOCK[held.kind].name}은(는) 여기 보충할 수 없어요`;
    }
    switch (it.id) {
      case 'deliveryBox': {
        const box = S.deliveryBoxes.find(b => b.id === it.boxId);
        if (!box) return null;
        return held ? '손을 비우면 택배박스를 들 수 있어요' : E + `${RESTOCK[box.kind].name} 택배박스 들기 (${box.amount}개)`;
      }
      case 'register': return Customers.frontCustomer() ? E + '주문 받기' : '대기 중인 손님이 없습니다';
      case 'pickup': return held ? E + '서빙하기' : '완성된 음료를 들고 오세요';
      case 'door': return E + (env.door && env.door.open ? '문 닫기' : '문 열기');
      case 'placedItem': {
        const tgt = it.rec.item;
        if (held && held.type === 'shotglass') {
          if (!held.filled) return '샷잔이 비어 있어요 — 머신에서 샷을 받으세요';
          if (tgt.type !== 'drink' || tgt.drink.cup === 'shot') return '샷은 컵에만 따를 수 있어요';
          return tgt.drink.espresso ? '이미 샷이 들어 있는 컵이에요' : E + '샷 붓기 ☕';
        }
        if (held && held.type === 'pitcher') {
          if (!held.milk && !held.foam) return '피처가 비어 있어요 — 스티머에서 우유를 데우세요';
          if (tgt.type !== 'drink' || tgt.drink.cup === 'shot') return '우유는 컵에만 부을 수 있어요';
          return tgt.drink.milk ? '이미 우유가 들어 있는 컵이에요' : E + (held.foam ? '우유+거품 붓기 🥛' : '우유 붓기 🥛');
        }
        return held ? '손을 비우면 집을 수 있어요' : E + itemLabel(tgt) + ' 집기';
      }
      case 'cupHot': return E + '머그컵 잡기';
      case 'cupIce': return E + '아이스컵 잡기';
      case 'cupEsp': return E + '에스프레소 잔 잡기';
      case 'shotrack': {
        if (held && held.type === 'shotglass')
          return held.filled ? '샷이 들어있어요 — 컵에 따르세요' : E + '샷잔 반납';
        return held ? '손을 비우면 샷잔을 집을 수 있어요' : E + '샷잔 집기 (재사용 도구)';
      }
      case 'pitcherrack': {
        if (held && held.type === 'pitcher')
          return (held.milk || held.foam) ? '우유가 들어있어요 — 컵에 부으세요' : E + '스팀 피처 반납';
        return held ? '손을 비우면 피처를 집을 수 있어요' : E + '스팀 피처 집기 (재사용 도구)';
      }
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
      case 'espCup': {
        const slot = env.machines.espressoSlots[it.slot];
        if (slot.locked && !S.upgrades.dualHead) return '🔒 듀얼 그룹헤드 (업그레이드 필요)';
        const canPour = slot.cupMesh && slot.drink.cup !== 'shot' && !(slot.busy && !slot.done);
        if (canPour && held && held.type === 'shotglass')
          return !held.filled ? '샷잔이 비어 있어요' : slot.drink.espresso ? '이미 샷이 든 컵이에요' : E + '샷 붓기 ☕';
        if (canPour && held && held.type === 'pitcher')
          return (!held.milk && !held.foam) ? '피처가 비어 있어요' : slot.drink.milk ? '이미 우유가 든 컵이에요' : E + (held.foam ? '우유+거품 붓기 🥛' : '우유 붓기 🥛');
        if (slot.busy) return slot.done ? E + '에스프레소 꺼내기 ☕' : `추출 중… ${Math.ceil(slot.dur - slot.t)}s`;
        if (held && held.type === 'drink')
          return held.drink.espresso ? '이미 샷이 든 컵이에요' : slot.cupMesh ? '이미 컵이 올라가 있어요' : E + '컵 올리기';
        if (held && held.type === 'shotglass')
          return held.filled ? '샷이 든 샷잔 — 컵에 따르세요' : slot.cupMesh ? '이미 컵이 올라가 있어요' : E + '샷잔 올리기';
        if (held) return '컵이나 샷잔을 올리세요';
        return slot.cupMesh ? E + '컵 내리기' : '컵이나 샷잔을 올리세요';
      }
      case 'pfSlot': {
        const slot = env.machines.espressoSlots[it.slot];
        if (slot.locked && !S.upgrades.dualHead) return '🔒 듀얼 그룹헤드 (업그레이드 필요)';
        if (slot.busy) return '추출 중…';
        if (held && held.type === 'portafilter') return slot.pfState !== 'none' ? '이미 장착되어 있어요' : E + '포터필터 장착';
        if (held) return '포터필터를 들고 오세요';
        if (slot.pfState === 'none') return '포터필터 없음 — 그라인더에서 분쇄 후 장착하세요';
        return E + `포터필터 분리 (${slot.pfState === 'tamped' ? '탬핑 완료 ✓' : slot.pfState === 'used' ? '사용한 가루 — 넉박스에' : slot.pfState === 'empty' ? '비어 있음 — 분쇄' : '탬핑 필요'})`;
      }
      case 'brew': {
        const slot = env.machines.espressoSlots[it.slot];
        if (slot.locked && !S.upgrades.dualHead) return '🔒 듀얼 그룹헤드 (업그레이드 필요)';
        if (slot.busy) return slot.done ? '추출 완료 — 컵을 꺼내세요' : `추출 중… ${Math.ceil(slot.dur - slot.t)}s`;
        if (!slot.cupMesh) return '컵을 먼저 올리세요';
        if (slot.pfState !== 'tamped')
          return slot.pfState === 'none' ? '탬핑한 포터필터를 장착하세요'
            : slot.pfState === 'filled' ? '탬핑이 필요해요 (탬핑 스테이션)'
            : slot.pfState === 'used' ? '포터필터를 분리해 비우세요' : '포터필터를 분쇄하세요';
        return E + '에스프레소 추출 ▶';
      }
      case 'steamwand': {
        if (held && held.type === 'pitcher')
          return held.foam ? '이미 거품까지 만들었어요 — 컵에 부으세요' : held.milk ? E + '꾹 눌러 우유 거품(마이크로폼)' : E + '꾹 눌러 우유 스팀';
        if (held && held.type === 'drink') return '컵에 직접 스팀 불가 — 스팀 피처를 사용하세요';
        return held ? '스팀 피처를 들고 오세요' : E + '스팀 분사';
      }
      case 'steamknob': {
        if (held && held.type === 'pitcher') return '스팀봉에 대고 데우세요';
        return E + '스팀 분사 (노브)';
      }
      case 'waterHot': case 'waterCold': {
        const job = env.machines.waterJobs[it.id];
        const nm = it.id === 'waterHot' ? '온수' : '냉수';
        if (job.busy) {
          if (!job.done) return `${nm} 받는 중…`;
          if (held && held.type === 'shotglass')
            return !held.filled ? '샷잔이 비어 있어요' : job.drink.espresso ? '이미 샷이 든 컵이에요' : E + '샷 붓기 ☕';
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
        return '<b>[E]</b> 꾹 눌러 탬핑 (퍼펙트 존에서 떼면 보너스)';
      }
      case 'trash': {
        if (held && held.type === 'portafilter')
          return held.state === 'used' ? E + '사용한 가루 털어내기 (포터필터는 유지됩니다)' : '⛔ 포터필터는 버릴 수 없어요';
        return E + '버리기';
      }
      case 'restock': {
        const box = Logistics.storageSlotBox(S, it.slotId);
        const slotLabel = typeof it.slot === 'number' ? `선반 ${it.rack + 1} · 아래서 ${it.slot + 1}번째 칸` : '창고칸';
        if (held && held.type === 'deliveryBox') {
          const r = RESTOCK[held.kind];
          if (box) return `${slotLabel}에는 이미 박스가 있어요`;
          return E + `${r.name} 박스 ${slotLabel} 입고 +${held.amount}`;
        }
        if (held) return '손을 비우면 창고에서 꺼낼 수 있어요';
        if (box) {
          const r = RESTOCK[box.kind];
          const total = Logistics.storageTotal(S, box.kind);
          return E + `${r.name} 1개 꺼내기 (${slotLabel} ${box.amount} · 창고 ${total})`;
        }
        return `${slotLabel}은 비어있어요`;
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
    const wh = {
      beans: Logistics.storageTotal(S, 'beans'),
      milk: Logistics.storageTotal(S, 'milk'),
      cups: Logistics.storageTotal(S, 'cups'),
      dessert: Logistics.storageTotal(S, 'dessert'),
    };
    $('stocks').innerHTML =
      `<span class="${st.beans <= 5 ? 'low' : ''}">☕ 원두 <span class="val">${st.beans}</span></span> <span style="opacity:.55">창고 ${wh.beans || 0}</span><br>` +
      `<span class="${st.milk <= 4 ? 'low' : ''}">🥛 우유 <span class="val">${st.milk}</span></span> <span style="opacity:.55">창고 ${wh.milk || 0}</span><br>` +
      `<span class="${st.cups <= 6 ? 'low' : ''}">🥤 컵 <span class="val">${st.cups}</span></span> <span style="opacity:.55">창고 ${wh.cups || 0}</span><br>` +
      `<span class="${st.dessert <= 2 ? 'low' : ''}">🍰 디저트 <span class="val">${st.dessert}</span></span> <span style="opacity:.55">창고 ${wh.dessert || 0}</span>`;
  }

  function clock() {
    const os = $('openState');
    if (ctx.mode() === 'prep') {
      $('clock').textContent = '08:00';
      os.textContent = '● 영업 준비 중'; os.className = 'closed';
      return;
    }
    if (ctx.mode() === 'after') {
      $('clock').textContent = '18:00';
      os.textContent = '● 영업후 정리'; os.className = 'closed';
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
      `<li>탬핑된 포터필터를 머신에 <b>장착</b>하고, 컵(또는 <b>샷잔</b>)을 올린 뒤 <b>빈손으로 [E]</b>를 눌러 추출하세요</li>` +
      `<li>추출이 끝나면 <b>[E]</b>로 컵을 꺼내세요 — 포터필터는 머신에 남아요</li>` +
      `<li>💡 <b>샷잔</b>에 받은 샷은 컵을 바닥/카운터에 내려놓고 샷잔을 들어 <b>[E]</b>로 부을 수 있어요 (샷잔은 재사용)</li>` +
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
