/* ============================================================
 * game.js — 게임 상태 · 주문/제조/서빙 · 하루 사이클 · 경제 · UI
 * ============================================================ */
const $ = id => document.getElementById(id);

/* ---------------- 게임 본체 ---------------- */
const Game = (() => {

  /* ===== 정적 데이터 · 밸런스 (data.js의 DATA에서) ===== */
  const {
    RECIPES, DESSERTS, LEVEL_XP, MAX_LVL, UPGRADES, EQUIPMENT, RESTOCK,
    DAY_LEN, SAVE_KEY, BANKRUPT_LIMIT, rentFor, dailyGoalFor,
    TAMP_DUR, TAMP_MIN, TAMP_PERF_W, TAMP_PERF_MIN, TAMP_PERF_MAX,
  } = DATA;

  /* ===== 상태 ===== */
  let env = null, scene = null;
  let mode = 'menu';              // menu | playing | dayEnd
  let S = null;                   // 저장되는 상태
  let held = null;                // {type:'drink',drink:{...}} | {type:'dessert',kind}
  let orders = [];                // {customer, items:[{type,recipeId|kind,done}], total}
  let spawnTimer = 3;
  let dayStats = null;
  let orderSeq = 0;
  let barTimer = 0;
  let placedItems = [];           // 표면에 내려놓은 아이템들 {item, mesh, hb}
  let indPulse = 0;
  let tampGame = null;            // 탬핑 게이지 상태 {fill, locked, sound} (비활성 시 null)
  let steamGame = null;           // 스팀 미니게임 상태 (비활성 시 null)
  let useDown = false;            // [E]/좌클릭을 누르고 있는 중

  function freshState() {
    return {
      money: 20000, day: 1, rep: 50, level: 1, xp: 0,
      stocks: { beans: 25, milk: 18, cups: 30, dessert: 8 },
      upgrades: {},
      equip: {},          // 구매한 추가 장비 개수 { grinder, espresso, steamer }
    };
  }
  function freshDayStats() {
    return { revenue: 0, tips: 0, served: 0, angry: 0, spent: 0 };
  }

  /* ===== 유틸 ===== */
  const fmt = n => '₩ ' + n.toLocaleString('ko-KR');
  function toast(msg, cls = '', dur = 2600) {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), dur);
    setTimeout(() => el.remove(), dur + 600);
  }
  function drinkPrice(id) {
    const p = RECIPES[id].price;
    return S.upgrades.grinder ? Math.round(p * 1.15 / 100) * 100 : p;
  }
  function unlockedRecipes() { return Object.keys(RECIPES).filter(k => RECIPES[k].lvl <= S.level); }
  function unlockedDesserts() { return Object.keys(DESSERTS).filter(k => DESSERTS[k].lvl <= S.level); }

  /* ===== 음료 비교 ===== */
  function canonical(d) {
    return [d.cup, +!!d.ice, +!!d.espresso, d.water || '', +!!d.milk, +!!d.foam, d.syrup || '', +!!d.whip].join('|');
  }
  function matchesRecipe(drink, recipeId) {
    return canonical(drink) === canonical(RECIPES[recipeId].target);
  }

  /* ===== 제조 순서 ===== */
  // 컵에 재료를 넣은 순서를 기록 (크레마 표시 + 순서 보너스 판정에 사용)
  function addStep(drink, key) {
    (drink.order || (drink.order = [])).push(key);
  }
  // 레시피의 정답 순서(seq)와 정확히 일치하게 만들었는지
  function correctOrder(drink, recipeId) {
    const seq = RECIPES[recipeId].seq;
    if (!seq) return false;
    const order = (drink.order || []).filter(k => seq.includes(k));
    return order.length === seq.length && order.every((k, i) => k === seq[i]);
  }

  /* ===== 손에 든 것 ===== */
  function setHeld(h) {
    held = h;
    if (!h) { Player.setHeld(null); }
    else if (h.type === 'drink') {
      const m = WORLD.makeDrinkMesh(h.drink);
      m.scale.setScalar(1.35);
      Player.setHeld(m);
    } else if (h.type === 'dessert') {
      const m = WORLD.makeDessertMesh(h.kind);
      m.scale.setScalar(1.3);
      Player.setHeld(m);
    } else if (h.type === 'portafilter') {
      const m = WORLD.makePortafilterMesh(h.state || 'empty');
      m.scale.setScalar(1.3);
      Player.setHeld(m);
    } else if (h.type === 'shotglass') {
      const m = WORLD.makeDrinkMesh({ cup: 'shot', espresso: h.filled ? 1 : 0, perfect: h.perfect });
      m.scale.setScalar(1.5);
      Player.setHeld(m);
    } else if (h.type === 'pitcher') {
      const m = WORLD.makePitcherMesh(h.milk ? 1 : 0, h.foam ? 1 : 0);
      m.scale.setScalar(1.3);
      Player.setHeld(m);
    }
    UI.held();
  }
  function drinkIngredients(d) {
    const out = [];
    out.push(d.cup === 'ice' ? '아이스컵' : d.cup === 'espresso' ? '에스프레소 잔' : '머그컵');
    if (d.ice) out.push('얼음');
    if (d.espresso) out.push('샷');
    if (d.water) out.push(d.water === 'hot' ? '온수' : '냉수');
    if (d.milk) out.push('우유');
    if (d.foam) out.push('거품');
    if (d.syrup) out.push({ vanilla: '바닐라', caramel: '카라멜', choco: '초코' }[d.syrup]);
    if (d.whip) out.push('휘핑');
    return out;
  }

  /* ===== 아이템 내려놓기 / 집기 ===== */
  function itemLabel(h) {
    if (h.type === 'drink') {
      const m = Object.keys(RECIPES).find(k => matchesRecipe(h.drink, k));
      return m ? RECIPES[m].name : '제조 중인 음료';
    }
    if (h.type === 'portafilter') {
      return h.state === 'filled' ? '포터필터 (원두 채움)'
        : h.state === 'used' ? '포터필터 (사용한 가루)'
        : '포터필터 (비어 있음)';
    }
    if (h.type === 'shotglass') return h.filled ? '샷잔 (에스프레소 ☕)' : '샷잔 (비어 있음)';
    if (h.type === 'pitcher') return h.foam ? '스팀 피처 (우유+거품)' : h.milk ? '스팀 피처 (데운 우유)' : '스팀 피처 (비어 있음)';
    return DESSERTS[h.kind].name;
  }

  function placeBlocked(point) {
    return placedItems.some(p => p.mesh.position.distanceTo(point) < 0.2);
  }

  function placeItem(point) {
    const item = held;
    let mesh, yOff = 0.004;
    if (item.type === 'drink') mesh = WORLD.makeDrinkMesh(item.drink);
    else if (item.type === 'dessert') mesh = WORLD.makeDessertMesh(item.kind);
    else if (item.type === 'shotglass') mesh = WORLD.makeDrinkMesh({ cup: 'shot', espresso: item.filled ? 1 : 0, perfect: item.perfect });
    else if (item.type === 'pitcher') mesh = WORLD.makePitcherMesh(item.milk ? 1 : 0, item.foam ? 1 : 0);
    else { mesh = WORLD.makePortafilterMesh(item.state || 'empty'); yOff = 0.03; }
    mesh.position.set(point.x, point.y + yOff, point.z);
    // 손잡이/컵이 플레이어 쪽을 향하도록
    mesh.rotation.y = Math.atan2(Player.position.x - point.x, Player.position.z - point.z);
    scene.add(mesh);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.24),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hb.position.set(point.x, point.y + 0.15, point.z);
    hb.castShadow = hb.receiveShadow = false;
    const rec = { item, mesh, hb };
    hb.userData.interact = { id: 'placedItem', rec };
    scene.add(hb);
    mesh.updateMatrixWorld(true);
    hb.updateMatrixWorld(true); // 같은 프레임에 바로 집을 수 있도록 행렬 즉시 갱신
    env.interactables.push(hb);
    placedItems.push(rec);
    setHeld(null);
    if (item.type === 'drink' || item.type === 'shotglass' || item.type === 'pitcher') AudioFX.cupClink(0.4); else AudioFX.put();
  }

  function removePlaced(rec) {
    scene.remove(rec.mesh);
    scene.remove(rec.hb);
    const i = env.interactables.indexOf(rec.hb);
    if (i >= 0) env.interactables.splice(i, 1);
    const j = placedItems.indexOf(rec);
    if (j >= 0) placedItems.splice(j, 1);
  }

  function clearPlacedItems() {
    while (placedItems.length) removePlaced(placedItems[0]);
  }

  // 슬롯/표면에서 손으로 되돌릴 때: 샷잔(cup:'shot')은 도구 타입으로, 일반 컵은 음료로 환원
  function vesselToHand(drink) {
    return drink.cup === 'shot'
      ? { type: 'shotglass', filled: !!drink.espresso, perfect: !!drink.perfect }
      : { type: 'drink', drink };
  }
  // 내려놓은 음료 컵의 메시를 현재 내용물로 다시 그림 (샷을 부은 뒤 색/크레마 갱신)
  function refreshPlacedDrink(rec) {
    const pos = rec.mesh.position.clone(), roty = rec.mesh.rotation.y;
    scene.remove(rec.mesh);
    const m = WORLD.makeDrinkMesh(rec.item.drink);
    m.position.copy(pos); m.rotation.y = roty;
    scene.add(m);
    rec.mesh = m;
  }

  /* ===== 주문 ===== */
  function generateOrder(customer) {
    // 튜토리얼 중에는 가장 단순한 메뉴(아메리카노)로 고정
    if (Tutorial.active()) {
      return { num: ++orderSeq, customer, items: [{ type: 'drink', recipeId: 'americano', done: false }], total: drinkPrice('americano') };
    }
    const pool = unlockedRecipes();
    const recipeId = pool[(Math.random() * pool.length) | 0];
    const items = [{ type: 'drink', recipeId, done: false }];
    let total = drinkPrice(recipeId);
    const dPool = unlockedDesserts();
    if (dPool.length && Math.random() < 0.32) {
      const kind = dPool[(Math.random() * dPool.length) | 0];
      items.push({ type: 'dessert', kind, done: false });
      total += DESSERTS[kind].price;
    }
    return { num: ++orderSeq, customer, items, total };
  }

  function itemName(it) {
    return it.type === 'drink' ? RECIPES[it.recipeId].name : DESSERTS[it.kind].name;
  }

  /* ===== 손님 훅 ===== */
  function onAngryLeave(c) {
    const i = orders.findIndex(o => o.customer === c);
    if (i >= 0) { UI.removeTicket(orders[i]); orders.splice(i, 1); }
    S.rep = Math.max(0, S.rep - 4);
    dayStats.angry++;
    toast('손님이 화나서 떠났어요… (평판 -4)', 'bad');
    AudioFX.err();
    UI.hud();
  }

  /* ===== 상호작용 ===== */
  function patienceForNew() {
    let p = 80 - S.day * 1.5;
    if (S.upgrades.interior) p *= 1.35;
    return Math.max(45, p);
  }

  function interact(it) {
    if (!it) return;
    const id = it.id;
    // 준비 단계엔 재고 보충만 (제조·서빙은 영업 중에)
    if (mode === 'prep' && id !== 'restock') {
      toast('영업을 시작하면 사용할 수 있어요 — 지금은 재고 보충과 [B] 배치');
      return;
    }

    /* --- 주문 받기 --- */
    if (id === 'register') {
      const c = Customers.frontCustomer();
      if (!c) { toast('주문할 손님이 없습니다'); return; }
      const order = generateOrder(c);
      orders.push(order);
      Customers.takeOrder(c, order);
      UI.addTicket(order);
      AudioFX.ding();
      toast(`주문 #${order.num} — ${order.items.map(itemName).join(', ')}`, 'gold');
      return;
    }

    /* --- 서빙 --- */
    if (id === 'pickup') { tryServe(); return; }

    /* --- 내려놓은 아이템: 가득 찬 샷잔으로 샷 붓기 / 집기 --- */
    if (id === 'placedItem') {
      const rec = it.rec;
      // 가득 찬 샷잔을 들고 놓인 컵을 조준 → 샷 붓기
      if (held && held.type === 'shotglass') {
        if (!held.filled) { toast('샷잔이 비어 있어요 — 머신에서 샷을 받으세요', 'bad'); AudioFX.err(); return; }
        if (rec.item.type !== 'drink' || rec.item.drink.cup === 'shot') { toast('샷은 컵에만 따를 수 있어요', 'bad'); AudioFX.err(); return; }
        if (rec.item.drink.espresso) { toast('이미 샷이 들어 있는 컵이에요'); return; }
        rec.item.drink.espresso = 1;
        addStep(rec.item.drink, 'espresso');
        rec.item.drink.perfect = !!held.perfect;
        refreshPlacedDrink(rec);
        setHeld({ type: 'shotglass', filled: false, perfect: false });   // 샷잔 비움(재사용)
        AudioFX.pourWater(0.5);
        toast('샷을 부었어요 ☕');
        return;
      }
      // 우유가 담긴 스팀 피처를 들고 놓인 컵을 조준 → 우유(+거품) 붓기
      if (held && held.type === 'pitcher') {
        if (!held.milk && !held.foam) { toast('피처가 비어 있어요 — 스티머에서 우유를 데우세요', 'bad'); AudioFX.err(); return; }
        if (rec.item.type !== 'drink' || rec.item.drink.cup === 'shot') { toast('우유는 컵에만 부을 수 있어요', 'bad'); AudioFX.err(); return; }
        if (rec.item.drink.milk) { toast('이미 우유가 들어 있는 컵이에요'); return; }
        rec.item.drink.milk = 1;
        addStep(rec.item.drink, 'milk');
        if (held.foam) { rec.item.drink.foam = 1; addStep(rec.item.drink, 'foam'); }
        if (held.perfectFoam) rec.item.drink.foamPerfect = 1;   // 퍼펙트 마이크로폼 보너스 인계
        refreshPlacedDrink(rec);
        setHeld({ type: 'pitcher', milk: 0, foam: 0 });   // 피처 비움(재사용)
        AudioFX.pourWater(0.5);
        toast(held.foam ? '우유와 거품을 부었어요 🥛' : '데운 우유를 부었어요 🥛');
        return;
      }
      if (held) { toast('손이 비어있어야 집을 수 있어요'); return; }
      removePlaced(rec);
      setHeld(rec.item);
      if (rec.item.type === 'drink' || rec.item.type === 'shotglass') AudioFX.cupClink(0.4); else AudioFX.pick();
      return;
    }

    /* --- 컵 --- */
    if (id === 'cupHot' || id === 'cupIce' || id === 'cupEsp') {
      if (held) { toast('손이 비어있어야 컵을 잡을 수 있어요'); return; }
      if (S.stocks.cups <= 0) { toast('컵이 떨어졌어요! 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
      S.stocks.cups--;
      const cupType = id === 'cupHot' ? 'hot' : id === 'cupIce' ? 'ice' : 'espresso';
      setHeld({ type: 'drink', drink: { cup: cupType, order: [] } });
      AudioFX.cupClink(0.55);
      UI.hud();
      return;
    }

    /* --- 샷잔 거치대: 빈 샷잔 집기 / 반납 (재사용 무료 도구) --- */
    if (id === 'shotrack') {
      if (held && held.type === 'shotglass') {
        if (held.filled) { toast('샷이 들어있어요 — 컵에 따른 뒤 반납하세요', 'bad'); AudioFX.err(); return; }
        setHeld(null);
        AudioFX.cupClink(0.4);
        return;
      }
      if (held) { toast('손이 비어있어야 샷잔을 집을 수 있어요'); return; }
      setHeld({ type: 'shotglass', filled: false, perfect: false });
      AudioFX.cupClink(0.45);
      return;
    }

    /* --- 스팀 피처 거치대: 빈 피처 집기 / 반납 (재사용 무료 도구) --- */
    if (id === 'pitcherrack') {
      if (held && held.type === 'pitcher') {
        if (held.milk || held.foam) { toast('우유가 들어있어요 — 컵에 부은 뒤 반납하세요', 'bad'); AudioFX.err(); return; }
        setHeld(null);
        AudioFX.cupClink(0.4);
        return;
      }
      if (held) { toast('손이 비어있어야 피처를 집을 수 있어요'); return; }
      setHeld({ type: 'pitcher', milk: 0, foam: 0 });
      AudioFX.cupClink(0.45);
      return;
    }

    /* --- 얼음 --- */
    if (id === 'ice') {
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.cup !== 'ice') { toast('아이스컵에만 얼음을 담을 수 있어요'); AudioFX.err(); return; }
      if (held.drink.ice) { toast('이미 얼음이 들어있어요'); return; }
      held.drink.ice = 1;
      addStep(held.drink, 'ice');
      setHeld(held);
      AudioFX.ice();
      return;
    }

    /* --- 그라인더: 빈 포터필터 삽입 → 분쇄 → 완료되면 채워진 포터필터 꺼내기 --- */
    if (id === 'grinder') {
      const job = it.job;
      if (job.busy) {
        if (!job.done) { toast('분쇄 중입니다…'); return; }
        if (held) { toast('손이 비어있어야 포터필터를 꺼낼 수 있어요'); return; }
        resetJob(job);
        setHeld({ type: 'portafilter', state: 'filled' });
        AudioFX.metalClack();
        return;
      }
      // 빈손으로 유휴 그라인더 — 더 이상 무에서 포터필터 생성 금지
      if (!held) { toast('머신에서 포터필터를 분리해 가져오세요', 'bad'); AudioFX.err(); return; }
      if (held.type !== 'portafilter') { toast('포터필터를 들고 오세요'); return; }
      if (held.state === 'used') { toast('넉박스에 가루를 먼저 털어내세요', 'bad'); AudioFX.err(); return; }
      if (held.state === 'filled') { toast('이미 분쇄된 포터필터예요'); return; }
      if (held.state === 'tamped') { toast('이미 탬핑된 포터필터예요 — 머신에 장착하세요'); return; }
      if (S.stocks.beans <= 0) { toast('원두가 떨어졌어요! 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
      // 빈 포터필터 삽입 + 분쇄 시작
      S.stocks.beans--;
      setHeld(null);
      job.busy = true; job.done = false; job.t = 0; job.dur = 1.6; job.hasPf = true;
      WORLD.setPortafilterState(job.pfMesh, 'empty');
      job.sound = AudioFX.grind(job.dur);
      AudioFX.metalClack();
      UI.hud();
      return;
    }

    /* --- 에스프레소 머신: 포터필터 분리/장착 → 컵 올려 추출 → 꺼내기 --- */
    if (id === 'espresso') {
      const slot = env.machines.espressoSlots[it.slot];
      if (slot.locked && !S.upgrades.dualHead) { toast('🔒 듀얼 그룹헤드 업그레이드가 필요합니다'); return; }
      if (slot.busy) {
        if (!slot.done) { toast('추출 중입니다…'); return; }
        // 완료된 샷 꺼내기 — 포터필터(used)는 머신에 남는다
        if (held) { toast('손이 비어있어야 컵을 꺼낼 수 있어요'); return; }
        slot.st.root.remove(slot.cupMesh);
        slot.busy = slot.done = false;
        slot.stream.visible = false;
        const drink = slot.drink;
        slot.cupMesh = null; slot.drink = null;
        slot.progress.hide();
        setHeld(vesselToHand(drink));
        AudioFX.cupClink(0.5);
        return;
      }
      // 포터필터를 들고 빈 슬롯에 장착 (상태 유지)
      if (held && held.type === 'portafilter') {
        if (slot.pfState !== 'none') { toast('이미 포터필터가 장착되어 있어요'); return; }
        slot.pfState = held.state || 'empty';
        slot.tampPerfect = !!held.tampPerfect;   // 퍼펙트 탬핑 보너스 인계
        WORLD.setPortafilterState(slot.pf, slot.pfState);
        setHeld(null);
        AudioFX.metalClack();
        return;
      }
      // 샷잔(컵) 올리기 — 추출은 빈손 [E]로 시작
      if (held && held.type === 'drink') {
        if (held.drink.espresso) { toast('이미 샷이 추출된 컵이에요'); return; }
        if (slot.cupMesh) { toast('이미 컵이 올라가 있어요'); return; }
        const drink = held.drink;
        setHeld(null);
        const cm = WORLD.makeDrinkMesh(drink);
        cm.position.copy(slot.localPos);
        slot.st.root.add(cm);
        slot.cupMesh = cm;
        slot.drink = drink;
        AudioFX.cupClink(0.4);
        return;
      }
      // 샷잔(재사용 도구) 올리기 — 내부적으로 cup:'shot' 음료로 다룬다
      if (held && held.type === 'shotglass') {
        if (held.filled) { toast('이미 샷이 들어있는 샷잔이에요 — 컵에 따르세요', 'bad'); AudioFX.err(); return; }
        if (slot.cupMesh) { toast('이미 컵이 올라가 있어요'); return; }
        setHeld(null);
        const drink = { cup: 'shot' };
        const cm = WORLD.makeDrinkMesh(drink);
        cm.position.copy(slot.localPos);
        slot.st.root.add(cm);
        slot.cupMesh = cm;
        slot.drink = drink;
        AudioFX.cupClink(0.4);
        return;
      }
      // 빈손 + 컵이 올라가 있음 → 추출 버튼(탬핑 완료 시) 또는 컵 회수
      if (slot.cupMesh) {
        if (slot.pfState === 'tamped') {
          slot.busy = true; slot.done = false; slot.t = 0;
          slot.dur = S.upgrades.fastShot ? 2.0 : 3.4;
          slot.stream.visible = true;
          slot.brewLiquid = WORLD.makeBrewLiquid(slot.drink.cup);
          slot.cupMesh.add(slot.brewLiquid);
          AudioFX.metalClack();
          slot.sound = AudioFX.brewing(slot.dur);
          return;
        }
        // 추출 불가 — 컵을 다시 손에 돌려주고 안내
        slot.st.root.remove(slot.cupMesh);
        const drink = slot.drink;
        slot.cupMesh = null; slot.drink = null;
        setHeld(vesselToHand(drink));
        AudioFX.cupClink(0.4);
        toast(slot.pfState === 'none' ? '먼저 탬핑한 포터필터를 장착하세요'
          : slot.pfState === 'used' ? '사용한 가루 — 포터필터를 분리해 넉박스에 비우세요'
          : slot.pfState === 'empty' ? '빈 포터필터 — 분리해 그라인더에서 분쇄하세요'
          : '탬핑이 안 됐어요 — 포터필터를 분리해 탬핑하세요', 'bad');
        return;
      }
      // 빈손 + 컵 없음 → 포터필터 분리
      if (slot.pfState === 'none') { toast('포터필터가 없어요'); return; }
      const state = slot.pfState;
      slot.pfState = 'none';
      WORLD.setPortafilterState(slot.pf, 'none');
      setHeld({ type: 'portafilter', state, tampPerfect: slot.tampPerfect });
      slot.tampPerfect = false;
      AudioFX.metalClack();
      return;
    }

    /* --- 밀크 스티머: 피처를 들고 [E]를 꾹 눌러 스팀 미니게임 (퍼펙트=마이크로폼 보너스) --- */
    if (id === 'steamer') {
      const job = it.job;
      if (!held) {
        // 빈손으로 노브 조작 → 스팀봉 끝에서 스팀 분사 (퍼지)
        job.steamT = Math.max(job.steamT || 0, 1.2);
        AudioFX.steam(1.2);
        AudioFX.metalClack();
        return;
      }
      if (held.type === 'drink') { toast('컵에 직접 스팀할 수 없어요 — 스팀 피처에 우유를 데우세요', 'bad'); AudioFX.err(); return; }
      if (held.type !== 'pitcher') { toast('스팀 피처를 들고 오세요', 'bad'); AudioFX.err(); return; }
      if (held.foam) { toast('이미 거품까지 만든 피처예요 — 컵에 부으세요'); return; }
      if (S.stocks.milk <= 0) { toast('우유가 떨어졌어요! 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
      // [E]를 꾹 눌러 진행하는 스팀 미니게임 시작
      if (!steamGame) startSteamGame(job);
      return;
    }

    /* --- 온수/냉수: 컵 올려두기 → 물 받기 → 완료되면 꺼내기 --- */
    if (id === 'waterHot' || id === 'waterCold') {
      const job = env.machines.waterJobs[id];
      if (job.busy) {
        if (!job.done) { toast('물 받는 중입니다…'); return; }
        if (held) { toast('손이 비어있어야 컵을 꺼낼 수 있어요'); return; }
        const drink = job.drink;
        resetJob(job);
        setHeld({ type: 'drink', drink });
        AudioFX.cupClink(0.5);
        return;
      }
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.water) { toast('이미 물이 들어있어요'); return; }
      const drink = held.drink;
      setHeld(null);
      job.busy = true; job.done = false; job.t = 0; job.dur = 1.2;
      job.drink = drink;
      const cm = WORLD.makeDrinkMesh(drink);
      cm.position.copy(job.localPos);
      job.st.root.add(cm);
      job.cupMesh = cm;
      job.sound = AudioFX.pourWater(job.dur);
      AudioFX.cupClink(0.35);
      return;
    }

    /* --- 시럽 --- */
    if (id === 'syrup') {
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.syrup) { toast('이미 시럽이 들어있어요'); return; }
      held.drink.syrup = it.kind;
      addStep(held.drink, 'syrup');
      setHeld(held);
      AudioFX.syrupPump();
      return;
    }

    /* --- 휘핑크림 --- */
    if (id === 'whip') {
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.whip) { toast('이미 휘핑크림을 올렸어요'); return; }
      held.drink.whip = 1;
      addStep(held.drink, 'whip');
      setHeld(held);
      AudioFX.whipSpray();
      return;
    }

    /* --- 디저트 꺼내기 --- */
    if (id === 'dessert') {
      if (held) { toast('손이 비어있어야 디저트를 꺼낼 수 있어요'); return; }
      if (S.stocks.dessert <= 0) { toast('디저트가 떨어졌어요! 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
      S.stocks.dessert--;
      setHeld({ type: 'dessert', kind: it.kind });
      AudioFX.pick();
      UI.hud();
      return;
    }

    /* --- 넉박스: 사용한 포터필터 가루 비우기 --- */
    if (id === 'knockbox') {
      if (!held || held.type !== 'portafilter') { toast('사용한 포터필터를 들고 오세요'); return; }
      if (held.state !== 'used') {
        toast((held.state === 'filled' || held.state === 'tamped') ? '아직 추출 전이에요 — 머신에 장착해 사용하세요' : '비울 가루가 없어요');
        return;
      }
      held.state = 'empty';
      setHeld(held);
      toast('가루를 털어냈어요 — 다시 분쇄할 수 있어요');
      AudioFX.knock();
      return;
    }

    /* --- 탬핑 스테이션: 분쇄된 포터필터를 [E] 타이밍 미니게임으로 다짐 --- */
    if (id === 'tamp') {
      if (!held || held.type !== 'portafilter') { toast('분쇄된 포터필터를 들고 오세요'); return; }
      if (held.state === 'empty') { toast('먼저 그라인더에서 원두를 분쇄하세요', 'bad'); AudioFX.err(); return; }
      if (held.state === 'used') { toast('사용한 가루예요 — 넉박스에 비우세요', 'bad'); AudioFX.err(); return; }
      if (held.state === 'tamped') { toast('이미 탬핑이 끝났어요 — 머신에 장착하세요'); return; }
      // filled: [E]를 누르고 있으면 게이지가 차오르고, 떼면 그 지점으로 판정
      if (!tampGame) startTampGame();
      return;
    }

    /* --- 쓰레기통 --- */
    if (id === 'trash') {
      if (!held) { toast('버릴 것이 없어요'); return; }
      // 포터필터는 영구 도구 — 버릴 수 없음 (used면 가루만 비움)
      if (held.type === 'portafilter') {
        if (held.state === 'used') {
          held.state = 'empty';
          setHeld(held);
          toast('가루를 털어냈어요 — 다시 분쇄할 수 있어요');
          AudioFX.trashThud();
        } else {
          toast('⛔ 포터필터는 버릴 수 없어요 — 넉박스에 가루만 비우세요', 'bad');
          AudioFX.err();
        }
        return;
      }
      if (held.type === 'shotglass') {
        toast('⛔ 샷잔은 버릴 수 없어요 — 거치대에 반납하거나 컵에 따르세요', 'bad');
        AudioFX.err();
        return;
      }
      if (held.type === 'pitcher') {
        toast('⛔ 스팀 피처는 버릴 수 없어요 — 거치대에 반납하거나 컵에 부으세요', 'bad');
        AudioFX.err();
        return;
      }
      setHeld(null);
      toast('버렸습니다');
      AudioFX.trashThud();
      return;
    }

    /* --- 재고 보충 (준비=정상가 / 영업중=비상 웃돈) --- */
    if (id === 'restock') {
      const r = RESTOCK[it.kind];
      const emergency = mode === 'playing';
      const price = emergency ? Math.round(r.price * 1.8 / 100) * 100 : r.price;
      if (S.money < price) { toast('돈이 부족해요!', 'bad'); AudioFX.err(); return; }
      S.money -= price;
      if (dayStats) dayStats.spent += price;
      S.stocks[it.kind] += r.amount;
      toast(`${r.name} +${r.amount} (${fmt(price)})${emergency ? ' · 비상 보충 ⚡' : ''}`, emergency ? 'bad' : 'good');
      AudioFX.cash();
      UI.hud();
      save();   // 구매(장비·업그레이드)와 동일하게 즉시 저장 — 새로고침 시 되돌아가는 불일치 방지
      return;
    }
  }

  /* ===== 서빙 ===== */

  function tryServe() {
    if (!held) { toast('서빙할 음료나 디저트를 들고 오세요'); return; }
    for (const o of orders) {
      if (o.customer.state !== 'waitDrink' && o.customer.state !== 'toPickup') continue;
      for (const item of o.items) {
        if (item.done) continue;
        let match = false;
        if (held.type === 'drink' && item.type === 'drink') match = matchesRecipe(held.drink, item.recipeId);
        if (held.type === 'dessert' && item.type === 'dessert') match = held.kind === item.kind;
        if (!match) continue;
        // 서빙 성공
        if (held.type === 'drink') held.drink.orderOk = correctOrder(held.drink, item.recipeId);
        item.done = true;
        const servedDrink = held.type === 'drink' ? held.drink : null;
        // 픽업대에 컵/디저트를 내려놓는 연출용 메시
        let fxMesh = null;
        if (held.type === 'drink') fxMesh = WORLD.makeDrinkMesh(held.drink);
        else if (held.type === 'dessert') fxMesh = WORLD.makeDessertMesh(held.kind);
        setHeld(null);
        if (fxMesh) {
          const px = env.pickupPos.x + (Math.random() - 0.5) * 0.5;
          Effects.spawnServe(new THREE.Vector3(px, env.machines.pickupTrayY || 1.07, env.pickupPos.z), fxMesh);
        }
        UI.renderTicketItems(o);
        if (o.items.every(i => i.done)) completeOrder(o, servedDrink);
        else toast(`${itemName(item)} 전달! 나머지 항목도 준비하세요`, 'good');
        return;
      }
    }
    if (held.type === 'drink') {
      const match = Object.keys(RECIPES).find(k => matchesRecipe(held.drink, k));
      toast(match ? `${RECIPES[match].name}을(를) 기다리는 손님이 없어요` : '레시피와 일치하지 않는 음료예요. 쓰레기통에 버리세요', 'bad');
    } else if (held.type === 'portafilter') {
      toast('포터필터는 에스프레소 머신에 장착하세요 ☕', 'bad');
    } else if (held.type === 'shotglass') {
      toast('샷잔은 서빙할 수 없어요 — 컵에 샷을 따르세요', 'bad');
    } else if (held.type === 'pitcher') {
      toast('스팀 피처는 서빙할 수 없어요 — 컵에 우유를 부으세요', 'bad');
    } else {
      toast('이 디저트를 기다리는 손님이 없어요', 'bad');
    }
    AudioFX.err();
  }

  function completeOrder(o, servedDrink) {
    const c = o.customer;
    const frac = Math.max(0, c.patience / c.patienceMax);
    const masterBonus = S.level >= MAX_LVL ? 1.12 : 1;   // 마스터 바리스타 팁 +12%
    let tip = Math.floor(o.total * 0.3 * frac * (0.7 + S.rep / 250) * masterBonus / 100) * 100;
    // 퍼펙트 탬핑 보너스 — 음료에 크레마가 살아 팁 +15%
    const perfect = !!(servedDrink && servedDrink.perfect);
    if (perfect) tip += Math.round(o.total * 0.15 / 100) * 100;
    // 정확한 제조 순서 보너스 — 팁 +15% + 평판 +1
    const orderOk = !!(servedDrink && servedDrink.orderOk);
    if (orderOk) tip += Math.round(o.total * 0.15 / 100) * 100;
    // 퍼펙트 마이크로폼(스팀 미니게임) 보너스 — 팁 +15%
    const foamPerfect = !!(servedDrink && servedDrink.foamPerfect);
    if (foamPerfect) tip += Math.round(o.total * 0.15 / 100) * 100;
    S.money += o.total + tip;
    dayStats.revenue += o.total;
    dayStats.tips += tip;
    dayStats.served++;
    S.rep = Math.min(100, S.rep + (frac > 0.5 ? 2 : 1) + (orderOk ? 1 : 0));
    gainXP(Math.round(o.total / 100));
    UI.removeTicket(o);
    orders.splice(orders.indexOf(o), 1);
    // 컵은 픽업대 연출에서 사라지므로 손님은 빈손으로 만족하며 떠남
    Customers.serve(c, null);
    toast(`주문 #${o.num} 완료! +${fmt(o.total)}${tip > 0 ? ` (팁 +${fmt(tip)})` : ''}${perfect || foamPerfect ? ' · 퍼펙트 ✨' : ''}`, 'good');
    if (orderOk) toast('✨ 정확한 제조 순서! 팁 +15% · 평판 +1', 'gold', 2200);
    if (foamPerfect) toast('🥛 퍼펙트 마이크로폼! 팁 +15%', 'gold', 2200);
    AudioFX.cash();
    UI.hud();
    Tutorial.event('served');
  }

  function gainXP(amount) {
    S.xp += amount;
    while (S.level < MAX_LVL && S.xp >= LEVEL_XP[S.level]) {
      S.level++;
      const newR = Object.keys(RECIPES).filter(k => RECIPES[k].lvl === S.level).map(k => RECIPES[k].name);
      const newD = Object.keys(DESSERTS).filter(k => DESSERTS[k].lvl === S.level).map(k => DESSERTS[k].name);
      const names = [...newR, ...newD];
      toast(`🎉 레벨 업! Lv.${S.level}${names.length ? ' — 신메뉴: ' + names.join(', ') : ''}`, 'gold', 4500);
      AudioFX.levelup();
      UI.recipeBook();
    }
    UI.hud();
  }

  /* ===== 머신 비동기 작업 (그라인더·스티머·온수/냉수) =====
   * 컵/재료를 올려두고 자리를 떠나도 진행되며, 머신 위 프로그레스 바로 상태 표시 */
  function machineJobs() {
    return [...env.machines.grinderJobs, ...env.machines.steamerJobs,
      env.machines.waterJobs.waterHot, env.machines.waterJobs.waterCold];
  }
  function swapJobCup(job) {
    job.st.root.remove(job.cupMesh);
    const cm = job.kind === 'steamer'
      ? WORLD.makePitcherMesh(job.pitcher.milk ? 1 : 0, job.pitcher.foam ? 1 : 0)
      : WORLD.makeDrinkMesh(job.drink);
    cm.position.copy(job.localPos);
    job.st.root.add(cm);
    job.cupMesh = cm;
  }
  function updateJobs(dt) {
    machineJobs().forEach(job => {
      if (!job || !job.busy) return;
      if (!job.done) {
        job.t += dt;
        if (job.t >= job.dur) {
          job.done = true;
          if (job.sound) { job.sound.stop(); job.sound = null; }
          if (job.kind === 'steamer') {
            // 피처에 데운 우유/거품을 채움 (순서 기록은 컵에 부을 때)
            if (job.makingFoam) job.pitcher.foam = 1; else job.pitcher.milk = 1;
            swapJobCup(job);
          } else if (job.kind === 'water') {
            job.drink.water = job.waterType;
            addStep(job.drink, 'water');
            swapJobCup(job);
          } else if (job.kind === 'grinder') {
            WORLD.setPortafilterState(job.pfMesh, 'filled');
          }
          AudioFX.ding();
        }
      }
      job.progress.draw(job.t / job.dur, job.done);
    });
  }
  function resetJob(job) {
    if (job.sound) { job.sound.stop(); job.sound = null; }
    if (job.cupMesh) { job.st.root.remove(job.cupMesh); job.cupMesh = null; }
    if (job.pfMesh) { WORLD.setPortafilterState(job.pfMesh, 'none'); job.hasPf = false; }
    job.busy = job.done = false;
    job.drink = null;
    job.pitcher = null;
    job.progress.hide();
  }

  /* ===== 에스프레소 슬롯 업데이트 ===== */
  function updateSlots(dt) {
    env.machines.espressoSlots.forEach(slot => {
      if (!slot.busy || slot.done) return;
      slot.t += dt;
      slot.progress.draw(slot.t / slot.dur, false);
      if (slot.brewLiquid) WORLD.setBrewFill(slot.brewLiquid, slot.t / slot.dur);   // 컵에 에스프레소가 차오름
      if (slot.t >= slot.dur) {
        slot.done = true;
        if (slot.sound) { slot.sound.stop(); slot.sound = null; }
        slot.progress.draw(1, true);
        slot.stream.visible = false;
        slot.drink.espresso = 1;
        addStep(slot.drink, 'espresso');
        slot.drink.perfect = !!slot.tampPerfect;   // 퍼펙트 탬핑 → 이 샷에 크레마 보너스
        // 추출 완료 — 포터필터는 사용한 가루(used) 상태가 됨
        slot.pfState = 'used';
        WORLD.setPortafilterState(slot.pf, 'used');
        // 컵 메시를 채워진 버전으로 교체 (차오르던 액체는 컵과 함께 제거됨)
        slot.st.root.remove(slot.cupMesh);
        slot.brewLiquid = null;
        const cm = WORLD.makeDrinkMesh(slot.drink);
        cm.position.copy(slot.localPos);
        slot.st.root.add(cm);
        slot.cupMesh = cm;
        AudioFX.bell();
      } else {
        // 커피 줄기 애니메이션 (위치 떨림 + 압력 느낌의 길이 흔들림)
        const s = slot.stream;
        s.position.y = 0.1 + Math.sin(slot.t * 30) * 0.005;
        s.scale.y = 1 + Math.sin(slot.t * 22) * 0.08;
      }
    });
  }

  /* ===== 탬핑 미니게임 (타이밍) =====
   * 탬핑 스테이션을 보며 분쇄된(filled) 포터필터를 들고 [E]로 시작 → 바늘이 좌우로 움직임 →
   * 다시 [E]로 멈춰 퍼펙트/성공 존에 맞추면 다져짐. 빗나가면 계속 움직이며 재시도. */
  // 게이지(#tampGame) 제목/힌트 텍스트 — 탬핑·스팀이 같은 UI를 공유하므로 시작 시 갱신
  function setGaugeText(title, hint) {
    const t = document.querySelector('#tampGame .tgTitle');
    const h = document.querySelector('#tampGame .tgHint');
    if (t) t.innerHTML = title;
    if (h) h.textContent = hint;
  }
  function startTampGame() {
    // 퍼펙트 존 시작 위치를 매번 살짝 랜덤화 (외워지지 않도록)
    const lo = TAMP_PERF_MIN + Math.random() * (TAMP_PERF_MAX - TAMP_PERF_MIN);
    // 누르는 즉시 채워지는 press-and-hold (떼면 그 지점으로 판정)
    tampGame = { fill: 0, locked: null, perfect: [lo, lo + TAMP_PERF_W], sound: AudioFX.tampHold(TAMP_DUR) };
    const band = document.querySelector('#tampGame .tgPerfect');
    if (band) { band.style.bottom = (lo * 100) + '%'; band.style.height = (TAMP_PERF_W * 100) + '%'; }
    $('tgFill').style.height = '0%';
    setGaugeText('🔧 탬핑 — <b>[E]</b>를 누르고 있어 다지기', '퍼펙트 존(초록)에서 손을 떼면 크레마(팁) 보너스 · 끝까지 눌러도 성공');
    clearHitFx();
    $('tampGame').classList.remove('hidden');
  }
  function clearHitFx() {
    $('tampGame').classList.remove('hitPerfect', 'hitGood', 'hitMiss');
  }
  function stopTampSound() { if (tampGame && tampGame.sound) { tampGame.sound.stop(); tampGame.sound = null; } }
  function endTampGame() {
    stopTampSound();
    tampGame = null;
    clearHitFx();
    $('tampGame').classList.add('hidden');
  }
  // 탬퍼가 쿵 눌리는 연출
  function pressTamper() {
    const t = env.machines.tamp && env.machines.tamp.tamper;
    if (t) { t.position.y = 0.012; setTimeout(() => { t.position.y = 0.04; }, 180); }
  }
  // 손을 뗀(또는 가득 찬) 순간 판정 — 짧은 히트스톱 후 확정
  function lockTampGame(fill) {
    if (tampGame.locked) return;
    stopTampSound();
    const pz = tampGame.perfect;
    const result = (fill >= pz[0] && fill <= pz[1]) ? 'perfect'
      : (fill >= TAMP_MIN) ? 'good' : 'weak';
    tampGame.locked = { result, t: 0 };
    if (result === 'weak') {
      AudioFX.err(); Player.punch(0.3);
      $('tampGame').classList.add('hitMiss');
    } else {
      pressTamper();
      AudioFX.tampDone();
      Player.punch(result === 'perfect' ? 1.0 : 0.6);
      if (result === 'perfect') AudioFX.tampPerfectSfx();
      $('tampGame').classList.add(result === 'perfect' ? 'hitPerfect' : 'hitGood');
    }
  }
  function finishTamp(perfect, msg, cls) {
    held.tampPerfect = perfect;
    held.state = 'tamped';
    setHeld(held);
    toast(msg, cls);
    endTampGame();
  }
  function updateTampGame(dt, aimData) {
    if (!tampGame) return false;
    const ok = aimData && aimData.id === 'tamp' && held && held.type === 'portafilter' && held.state === 'filled';
    if (!ok) { endTampGame(); return false; }   // 시선을 돌리거나 상태가 바뀌면 취소
    // 판정 후 히트스톱: 게이지를 멈춘 채 결과 연출을 보여주고 확정
    if (tampGame.locked) {
      tampGame.locked.t += dt;
      const r = tampGame.locked.result;
      if (tampGame.locked.t >= (r === 'weak' ? 0.16 : 0.24)) {
        if (r === 'weak') { toast('약하게 눌렀어요 — 다시 꾹 눌러 다지세요', 'bad', 1500); endTampGame(); }
        else finishTamp(r === 'perfect', r === 'perfect' ? '✨ 퍼펙트 탬핑! 크레마 보너스' : '탬핑 성공!', r === 'perfect' ? 'gold' : 'good');
      }
      return true;
    }
    // 누르는 동안 게이지 상승, 손을 떼면 그 지점으로 판정
    if (useDown) {
      tampGame.fill = Math.min(1, tampGame.fill + dt / TAMP_DUR);
      $('tgFill').style.height = (tampGame.fill * 100) + '%';
      if (tampGame.fill >= 1) lockTampGame(1);     // 끝까지 누르면 자동 성공(일반)
    } else {
      lockTampGame(tampGame.fill);
    }
    return true;
  }

  /* ===== 스팀(스티밍) 미니게임 — 탬핑과 동일 메커니즘, 스팀 피처를 든 채 진행 =====
   * 스티머를 보며 피처를 들고 [E]로 시작 → [E]를 꾹 눌러 폼 게이지 상승 →
   * 퍼펙트 존에서 떼면 마이크로폼(팁 보너스), 일반 성공도 우유/거품 완성. */
  function startSteamGame(job) {
    const lo = TAMP_PERF_MIN + Math.random() * (TAMP_PERF_MAX - TAMP_PERF_MIN);
    const makingFoam = !!held.milk;   // 이미 우유가 있으면 이번엔 거품(마이크로폼)
    const dur = S.upgrades.fastSteam ? 1.4 : 2.4;
    // 누르는 즉시 채워지는 press-and-hold (탬핑식 armed/ready 2단계 없음)
    steamGame = { fill: 0, locked: null, perfect: [lo, lo + TAMP_PERF_W], job, makingFoam, dur, sound: AudioFX.steam(dur) };
    const band = document.querySelector('#tampGame .tgPerfect');
    if (band) { band.style.bottom = (lo * 100) + '%'; band.style.height = (TAMP_PERF_W * 100) + '%'; }
    $('tgFill').style.height = '0%';
    setGaugeText('🥛 스티밍 — <b>[E]</b>를 누르고 있어 ' + (makingFoam ? '우유 거품 만들기' : '우유 데우기'),
      '퍼펙트 존(초록)에서 손을 떼면 마이크로폼(팁) 보너스 · 끝까지 눌러도 성공');
    clearHitFx();
    $('tampGame').classList.remove('hidden');
  }
  function stopSteamSound() { if (steamGame && steamGame.sound) { steamGame.sound.stop(); steamGame.sound = null; } }
  function endSteamGame() {
    stopSteamSound();
    if (steamGame && steamGame.job) steamGame.job.steamT = 0;
    steamGame = null;
    clearHitFx();
    $('tampGame').classList.add('hidden');
  }
  function lockSteamGame(fill) {
    if (steamGame.locked) return;
    stopSteamSound();
    const pz = steamGame.perfect;
    const result = (fill >= pz[0] && fill <= pz[1]) ? 'perfect'
      : (fill >= TAMP_MIN) ? 'good' : 'weak';
    steamGame.locked = { result, t: 0 };
    if (result === 'weak') {
      AudioFX.err();
      $('tampGame').classList.add('hitMiss');
    } else {
      AudioFX.tampDone();
      if (result === 'perfect') AudioFX.tampPerfectSfx();
      $('tampGame').classList.add(result === 'perfect' ? 'hitPerfect' : 'hitGood');
    }
  }
  function finishSteam(perfect, msg, cls) {
    S.stocks.milk--;                          // 성공 시 우유 1 소모
    if (steamGame.makingFoam) held.foam = 1; else held.milk = 1;
    held.perfectFoam = perfect;               // 마이크로폼 — 컵에 부을 때 보너스 인계
    setHeld(held);
    toast(msg, cls);
    UI.hud();
    endSteamGame();
  }
  function updateSteamGame(dt, aimData) {
    if (!steamGame) return false;
    const ok = aimData && aimData.id === 'steamer' && held && held.type === 'pitcher' && !held.foam;
    if (!ok) { endSteamGame(); return false; }   // 시선을 돌리거나 상태가 바뀌면 취소
    if (steamGame.locked) {
      steamGame.locked.t += dt;
      const r = steamGame.locked.result;
      if (steamGame.locked.t >= (r === 'weak' ? 0.16 : 0.24)) {
        if (r === 'weak') { toast('스팀이 약해요 — 다시 꾹 눌러 데우세요', 'bad', 1500); endSteamGame(); }
        else finishSteam(r === 'perfect',
          r === 'perfect' ? '✨ 퍼펙트 마이크로폼! (팁 보너스)' : (steamGame.makingFoam ? '우유 거품 완성!' : '우유 스팀 완성!'),
          r === 'perfect' ? 'gold' : 'good');
      }
      return true;
    }
    // 누르는 동안 폼 게이지 상승 + 스팀봉 증기, 손 떼면 그 지점으로 판정
    if (useDown) {
      steamGame.fill = Math.min(1, steamGame.fill + dt / steamGame.dur);
      $('tgFill').style.height = (steamGame.fill * 100) + '%';
      if (steamGame.job) steamGame.job.steamT = 0.25;   // 스팀봉 증기 분출 유지
      if (steamGame.fill >= 1) lockSteamGame(1);
    } else {
      lockSteamGame(steamGame.fill);
    }
    return true;
  }




  /* ===== 하루 사이클 (준비 → 영업 → 정산) ===== */
  let timeSec = 0, open = false;
  let prepPanelOpen = false;
  let pendingTutorial = false;

  // 매장(머신·들고있는것·연출) 초기화 — 준비/영업 진입 시 공용
  function resetStations() {
    setHeld(null);
    clearPlacedItems();
    Effects.clear();
    env.placeIndicator.visible = false;
    env.machines.espressoSlots.forEach(s => {
      if (s.cupMesh) s.st.root.remove(s.cupMesh);
      if (s.sound) { s.sound.stop(); s.sound = null; }
      s.busy = s.done = false; s.cupMesh = null; s.drink = null; s.brewLiquid = null; s.stream.visible = false;
      s.pfState = 'empty'; s.tampPerfect = false; WORLD.setPortafilterState(s.pf, 'empty');
      s.progress.hide();
    });
    machineJobs().forEach(j => j && resetJob(j));
    // 탬핑/스팀 미니게임 초기화
    useDown = false;
    endTampGame();
    endSteamGame();
    if (env.machines.tamp && env.machines.tamp.tamper) env.machines.tamp.tamper.position.y = 0.04;
  }

  /* --- 영업 준비 단계: 손님 없음 · 시간 정지 · 배치/구매/보충 --- */
  function startPrep() {
    mode = 'prep';
    open = false; timeSec = 0;
    dayStats = freshDayStats();        // 준비~영업 지출이 누적되도록 여기서 1회 초기화
    orders = []; orderSeq = 0;
    $('tickets').innerHTML = '';
    Tutorial.cancel();
    Customers.clear();
    resetStations();
    prepPanelOpen = false;
    $('prepPanel').classList.add('hidden');
    $('prepBar').classList.remove('hidden');
    $('hud').classList.remove('hidden');
    mode = 'prep';
    Player.enabled = true;
    UI.hud(); UI.clock();
    toast(`DAY ${S.day} 영업 준비 — 재고·배치를 마치고 [O]로 영업 시작 ☕`, 'gold', 4500);
  }

  /* --- 영업 시작: 손님 입장 · 시계 진행 --- */
  function beginOpen() {
    if (mode !== 'prep') return;
    if (typeof Editor !== 'undefined' && Editor.active) Editor.toggle();   // 편집 중이면 종료
    prepPanelOpen = false;
    $('prepPanel').classList.add('hidden');
    $('prepBar').classList.add('hidden');
    open = true; timeSec = 0;
    orders = []; orderSeq = 0;
    $('tickets').innerHTML = '';
    spawnTimer = S.day <= 3 ? [7, 4.5, 3][S.day - 1] : 2.5;   // 초반일수록 첫 손님 입장까지 여유
    resetStations();
    mode = 'playing';
    Player.enabled = true;
    UI.hud(); UI.clock();
    toast(`DAY ${S.day} — 영업 시작! 오늘 목표 순이익 ${fmt(dailyGoalFor(S.day))} 이상 ☕`, 'gold', 4000);
    AudioFX.bell();
    if (pendingTutorial) { pendingTutorial = false; Tutorial.start(); }
  }

  function openPrepPanel() {
    if (mode !== 'prep') return;
    prepPanelOpen = true;
    $('ppTitle').textContent = `DAY ${S.day} 영업 준비`;
    $('ppMoney').innerHTML = `보유 금액 <b>${fmt(S.money)}</b>`;
    $('ppInfo').innerHTML = `오늘 임대료 <b>${fmt(rentFor(S.day))}</b> · 목표 순이익 <b>${fmt(dailyGoalFor(S.day))}</b> 이상`;
    renderEquipment();
    renderUpgrades();
    $('prepPanel').classList.remove('hidden');
    Player.enabled = false;
    document.exitPointerLock && document.exitPointerLock();
  }
  function closePrepPanel() {
    prepPanelOpen = false;
    $('prepPanel').classList.add('hidden');
  }

  // 초반 며칠은 점진적으로 바빠지도록 완화 (1일차 가장 한산 → 4일차부터 정상)
  function earlyEaseFactor() {
    return S.day <= 3 ? [1.6, 1.3, 1.12][S.day - 1] : 1;
  }

  function spawnInterval() {
    let base = 15 - S.day * 0.6;
    base *= earlyEaseFactor();      // 초반 적응 구간 완화
    if (S.upgrades.ads) base *= 0.72;
    base *= S.rep >= 70 ? 0.85 : S.rep <= 30 ? 1.3 : 1;
    base = Math.max(5.5, base);
    return base * (0.7 + Math.random() * 0.6);
  }

  function endDay() {
    mode = 'dayEnd';
    Player.enabled = false;
    env.placeIndicator.visible = false;
    document.exitPointerLock && document.exitPointerLock();
    // 임대료 차감 → 순이익/목표 산정
    const rent = rentFor(S.day);
    S.money -= rent;
    const grossNet = dayStats.revenue + dayStats.tips - dayStats.spent;
    const net = grossNet - rent;
    const goal = dailyGoalFor(S.day);
    const goalMet = net >= goal;
    if (goalMet) S.rep = Math.min(100, S.rep + 3);

    $('prepBar').classList.add('hidden');
    $('hud').classList.add('hidden');

    // 폐업 (소프트 실패)
    if (S.money < BANKRUPT_LIMIT) {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem('mochaLayout_v1');
      mode = 'gameover';
      $('goDays').textContent = S.day;
      $('gameOver').classList.remove('hidden');
      AudioFX.err();
      return;
    }

    const crisis = S.money < 0;
    $('deTitle').textContent = `DAY ${S.day} 마감`;
    $('deSub').innerHTML =
      (crisis ? `<span style="color:var(--red)">⚠ 경영 위기 — 잔액이 마이너스예요! 내일 반드시 흑자를 내세요</span><br>` : '') +
      (goalMet
        ? `🎉 일일 목표 달성! (목표 순이익 ${fmt(goal)} 이상) <span style="color:var(--green)">평판 +3</span>`
        : `오늘 목표 미달 (목표 ${fmt(goal)}) — 장비를 늘려 처리량을 키워보세요`) +
      `<br><span style="opacity:.7;font-size:13px">서빙 ${dayStats.served}명 · 화난 손님 ${dayStats.angry}명</span>`;
    $('statGrid').innerHTML = [
      [fmt(dayStats.revenue), '매출'],
      [fmt(dayStats.tips), '팁'],
      ['−' + fmt(dayStats.spent), '지출(재고·장비)'],
      ['−' + fmt(rent), '임대료'],
      [(net >= 0 ? '+' : '−') + fmt(Math.abs(net)), '순이익'],
      [fmt(S.money), '보유 금액'],
    ].map(([v, l]) => `<div class="stat"><div class="sv">${v}</div><div class="sl">${l}</div></div>`).join('');
    $('dayEnd').classList.remove('hidden');
    if (crisis) AudioFX.err();
    S.day++;
    save();
  }

  function renderUpgrades() {
    const list = $('upgradeList');
    list.innerHTML = '';
    Object.keys(UPGRADES).forEach(k => {
      const u = UPGRADES[k];
      const owned = !!S.upgrades[k];
      const div = document.createElement('div');
      div.className = 'upg' + (owned ? ' owned' : '');
      div.innerHTML =
        `<div><div class="un">${u.name}</div><div class="ud">${u.desc}</div></div>` +
        (owned ? `<span class="ownedTag">보유 중 ✓</span>`
               : `<button class="btn" data-upg="${k}" ${S.money < u.price ? 'disabled' : ''}>${fmt(u.price)}</button>`);
      list.appendChild(div);
    });
    list.querySelectorAll('button[data-upg]').forEach(b => {
      b.onclick = () => {
        const k = b.dataset.upg;
        if (S.money < UPGRADES[k].price) return;
        S.money -= UPGRADES[k].price;
        S.upgrades[k] = true;
        AudioFX.cash();
        save();
        renderUpgrades();
        refreshPrepMoney();
        UI.hud();
      };
    });
  }

  /* ===== 장비 상점 (구매 → 빈 카운터에 새 머신 배치) ===== */
  function refreshPrepMoney() {
    const pm = $('ppMoney'); if (pm) pm.innerHTML = `보유 금액 <b>${fmt(S.money)}</b>`;
  }
  function spawnEquipment(kind, id, x, z) {
    if (kind === 'grinder') env.builders.grinder(id, x, z);
    else if (kind === 'steamer') env.builders.steamer(id, x, z);
    else if (kind === 'espresso') env.builders.espresso(id, x, z, false);   // 구매 머신은 두 슬롯 모두 개방
  }
  function recreateEquipment() {
    // 저장된 구매 장비를 매장에 다시 생성 (위치는 이후 applyLayout이 복원)
    const eq = S.equip || {};
    Object.keys(EQUIPMENT).forEach(kind => {
      const n = eq[kind] || 0;
      for (let i = 0; i < n; i++) {
        const id = kind + '_' + (i + 2);
        const spot = env.findFreeSpot(EQUIPMENT[kind].w, EQUIPMENT[kind].d) || { x: 0, z: -4.3 };
        spawnEquipment(kind, id, spot.x, spot.z);
      }
    });
    if (typeof Editor !== 'undefined') Editor.applyLayout();   // 저장된 배치 복원
  }
  function buyEquipment(kind) {
    const e = EQUIPMENT[kind];
    const owned = (S.equip[kind] || 0);
    if (owned >= e.max) { toast('이 장비는 더 들일 수 없어요'); return; }
    if (S.money < e.price) { toast('돈이 부족해요!', 'bad'); AudioFX.err(); return; }
    const spot = env.findFreeSpot(e.w, e.d);
    if (!spot) { toast('배치할 빈 공간이 없어요 — 기구를 정리하세요', 'bad'); AudioFX.err(); return; }
    S.money -= e.price;
    if (dayStats) dayStats.spent += e.price;
    S.equip[kind] = owned + 1;
    const id = kind + '_' + (owned + 2);
    spawnEquipment(kind, id, spot.x, spot.z);
    if (typeof Editor !== 'undefined') Editor.saveLayout();    // 새 머신 위치 즉시 저장
    save();
    AudioFX.cash();
    renderEquipment();
    refreshPrepMoney();
    UI.hud();
    toast(`${e.name} 구매 완료! [B] 편집 모드로 위치를 옮길 수 있어요`, 'good', 4500);
  }
  function renderEquipment() {
    const list = $('equipList');
    if (!list) return;
    list.innerHTML = '';
    Object.keys(EQUIPMENT).forEach(k => {
      const e = EQUIPMENT[k];
      const owned = (S.equip[k] || 0);
      const full = owned >= e.max;
      const div = document.createElement('div');
      div.className = 'upg' + (full ? ' owned' : '');
      div.innerHTML =
        `<div><div class="un">${e.name}${owned ? ` <span style="color:var(--green)">×${owned}</span>` : ''}</div>` +
        `<div class="ud">${e.desc}</div></div>` +
        (full ? `<span class="ownedTag">최대 ✓</span>`
              : `<button class="btn" data-equip="${k}" ${S.money < e.price ? 'disabled' : ''}>${fmt(e.price)}</button>`);
      list.appendChild(div);
    });
    list.querySelectorAll('button[data-equip]').forEach(b => {
      b.onclick = () => buyEquipment(b.dataset.equip);
    });
  }

  /* ===== 저장 ===== */
  function save() { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }
  function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d && d.money !== undefined) { S = Object.assign(freshState(), d); return true; }
    } catch (e) { /* 손상된 저장 무시 */ }
    return false;
  }

  /* ===== 메인 업데이트 ===== */
  function updatePrep() {
    // 준비 단계: 재고 보충 프롬프트만 표시 (손님·시계 정지)
    const pr = $('prompt');
    if (prepPanelOpen) { pr.classList.add('hidden'); $('crosshair').classList.remove('active'); return; }
    const aimData = Player.aim();
    if (aimData && aimData.id === 'restock') {
      pr.innerHTML = UI.prompt(aimData);
      pr.classList.remove('hidden'); $('crosshair').classList.add('active');
    } else {
      pr.classList.add('hidden'); $('crosshair').classList.remove('active');
    }
  }

  function update(dt) {
    if (mode === 'prep') { updatePrep(); return; }
    if (mode !== 'playing') return;

    // 시간
    timeSec += dt;
    if (open && timeSec >= DAY_LEN) {
      open = false;
      toast('영업 마감! 남은 손님을 응대하세요', 'gold', 3500);
      AudioFX.bell();
    }
    UI.clock();

    // 손님 스폰
    if (open) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = spawnInterval();
        Customers.spawn(patienceForNew());
      }
    } else if (Customers.list.length === 0) {
      endDay();
      return;
    }

    Customers.update(dt);
    updateSlots(dt);
    updateJobs(dt);
    Effects.update(dt);

    // 조준 & 프롬프트 (+ 내려놓기 파란 표시)
    const aimData = Player.aim();
    const tamping = updateTampGame(dt, aimData);
    const steaming = updateSteamGame(dt, aimData);
    let p = UI.prompt(aimData);
    if (tamping || steaming) p = null;   // 미니게임 중엔 안내 텍스트를 숨겨 게이지 바를 가리지 않게
    let placePoint = null;
    if (!aimData && held) {
      const pt = Player.aimSurface();
      if (pt) {
        if (placeBlocked(pt)) p = '여기엔 공간이 없어요';
        else { placePoint = pt; p = '<b>[E]</b> 내려놓기'; }
      }
    }
    const ind = env.placeIndicator;
    if (placePoint) {
      indPulse += dt * 5;
      ind.position.set(placePoint.x, placePoint.y + 0.012, placePoint.z);
      ind.scale.setScalar(1 + Math.sin(indPulse) * 0.07);
      ind.visible = true;
    } else {
      ind.visible = false;
    }
    const pr = $('prompt');
    if (p) { pr.innerHTML = p; pr.classList.remove('hidden'); $('crosshair').classList.add('active'); }
    else { pr.classList.add('hidden'); $('crosshair').classList.remove('active'); }

    // 인내심 바만 주기적으로 갱신 (티켓 DOM은 재생성하지 않음)
    barTimer -= dt;
    if (barTimer <= 0) { UI.ticketBars(); barTimer = 0.25; }

    Tutorial.update();
  }

  /* ===== 외부 API ===== */
  function init(s, e) {
    scene = s; env = e;
    S = freshState();
    Effects.init(scene);
    // 표현/튜토리얼 모듈에 코어 상태 라이브 게터 + 헬퍼 주입
    UI.init({
      S: () => S, held: () => held, orders: () => orders, mode: () => mode,
      env: () => env, timeSec: () => timeSec, open: () => open,
      fmt, drinkPrice, matchesRecipe, drinkIngredients, itemLabel, itemName,
    });
    Tutorial.init({
      orders: () => orders, held: () => held, env: () => env, matchesRecipe, toast,
    });
    if (hasSave()) $('btnContinue').classList.remove('hidden');
    UI.recipeBook();

    // E/클릭: 스테이션 상호작용 → 없으면 표면에 내려놓기
    function onUse() {
      const aimData = Player.aim();
      if (aimData) { interact(aimData); return; }
      if (held) {
        const pt = Player.aimSurface();
        if (pt && !placeBlocked(pt)) placeItem(pt);
      }
    }
    // const Editor는 window 속성이 아니므로 typeof로 확인해야 게이트가 작동함
    const editing = () => typeof Editor !== 'undefined' && Editor.active;
    document.addEventListener('keydown', ev => {
      if (mode !== 'playing' && mode !== 'prep') return;
      if (editing()) return;   // 편집 모드 중엔 에디터가 입력 처리
      if (ev.repeat) return;   // 키 오토리피트 무시 — 단발 입력만 처리
      // 준비 단계 전용 조작
      if (mode === 'prep') {
        if (prepPanelOpen) return;                       // 패널은 버튼으로 조작
        if (ev.code === 'KeyE') onUse();                 // 재고 보충
        else if (ev.code === 'KeyO') beginOpen();        // 영업 시작
        else if (ev.code === 'KeyM') openPrepPanel();    // 관리·업그레이드
        else if (ev.code === 'KeyR') $('recipeBook').classList.toggle('hidden');
        return;
      }
      // 영업 중 조작
      if (ev.code === 'KeyE') { useDown = true; onUse(); }
      if (ev.code === 'KeyQ' && held) {
        if (held.type === 'portafilter') { toast('⛔ 포터필터는 버릴 수 없어요', 'bad'); }
        else if (held.type === 'shotglass') { toast('⛔ 샷잔은 버릴 수 없어요 — 거치대에 반납하거나 컵에 따르세요', 'bad'); }
        else if (held.type === 'pitcher') { toast('⛔ 스팀 피처는 버릴 수 없어요 — 거치대에 반납하거나 컵에 부으세요', 'bad'); }
        else { setHeld(null); toast('버렸습니다'); }
      }
      if (ev.code === 'KeyR') $('recipeBook').classList.toggle('hidden');
      if (ev.code === 'KeyT') Tutorial.cancel();
    });
    $('recipeBtn').onclick = () => { if (!editing()) $('recipeBook').classList.toggle('hidden'); };
    $('recipeBook').addEventListener('click', ev => {
      if (ev.target === $('recipeBook')) $('recipeBook').classList.add('hidden'); // 바깥 클릭으로 닫기
    });
    document.addEventListener('mousedown', ev => {
      if (mode === 'playing' && document.pointerLockElement && ev.button === 0 && !editing()) {
        useDown = true; onUse();
      }
    });
    // 탬핑 홀드 해제: [E]/좌클릭에서 손을 떼면 게이지 판정
    document.addEventListener('keyup', ev => { if (ev.code === 'KeyE') useDown = false; });
    document.addEventListener('mouseup', ev => { if (ev.button === 0) useDown = false; });
    // 포커스/포인터락이 풀리면 keyup·mouseup이 안 와 useDown이 눌린 채로 남는다 → 강제 해제
    window.addEventListener('blur', () => { useDown = false; });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) useDown = false; });
  }

  function newGame() {
    S = freshState();
    UI.recipeBook();
    pendingTutorial = true;      // 튜토리얼은 첫 영업 시작 때 시작
    startPrep();
  }
  function continueGame() {
    load();
    recreateEquipment();   // 저장된 구매 장비 복원 (위치 포함)
    UI.recipeBook();
    startPrep();
  }
  function nextDay() {
    $('dayEnd').classList.add('hidden');
    $('hud').classList.remove('hidden');
    startPrep();
  }

  return {
    init, update, newGame, continueGame, nextDay, hasSave, onAngryLeave,
    beginOpen, openPrepPanel, closePrepPanel,
    get mode() { return mode; },
    set mode(v) { mode = v; },
    get prepPanelOpen() { return prepPanelOpen; },
    get inTutorial() { return Tutorial.active(); },
    notifyEditMode(on) {
      if (on) {
        // 내려놓기 표시·레시피북 숨김 (머신 작업은 계속 표시되며 시간만 정지)
        env.placeIndicator.visible = false;
        $('prompt').classList.add('hidden');
        $('recipeBook').classList.add('hidden');
      }
    },
    isBrewing: () => env.machines.espressoSlots.some(s => s.busy && !s.done),
    _debug: { closeNow() { timeSec = DAY_LEN + 1; open = false; Customers.clear(); orders = []; $('tickets').innerHTML = ''; } },
  };
})();
