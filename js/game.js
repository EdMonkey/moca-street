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
    ART_TIP_PERFECT, ART_TIP_GOOD,
    DOSE_DUR, DOSE_MIN, DOSE_TIP_PERFECT,
    GRIND_DUR, GRIND_IDEAL_MIN, GRIND_IDEAL_MAX, GRIND_TIP_PERFECT,
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
  let doseGame = null;            // 시럽/휘핑 도징 미니게임 상태 (비활성 시 null)
  let grindGame = null;           // 분쇄도 다이얼 미니게임 상태 (비활성 시 null)
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
    if (FRESH_KEYS.includes(key)) stampFresh(drink);   // 신선도 시계 시작(첫 액체 추가 시)
  }

  /* ===== 신선도(spoilage) ===== 받아진 뜨거운 물·에스프레소·얼음·스팀우유는 시간이 지나면 신선도 하락 */
  const FRESH_KEYS = ['ice', 'water', 'espresso', 'milk', 'foam'];
  const FRESH_FULL = 30, FRESH_DEAD = 90;   // 30초까지 신선 → 90초에 최저
  function stampFresh(obj) { if (obj && obj.freshAt == null) obj.freshAt = timeSec; }   // 첫 내용물 시점만 기록(이후 유지)
  function carryFresh(dst, src) {            // 부을 때 더 오래된(상한) 쪽을 인계
    if (src && src.freshAt != null) dst.freshAt = (dst.freshAt == null) ? src.freshAt : Math.min(dst.freshAt, src.freshAt);
  }
  function freshness01(obj) {                 // 1(신선) ~ 0(최저)
    if (!obj || obj.freshAt == null) return 1;
    const age = timeSec - obj.freshAt;
    if (age <= FRESH_FULL) return 1;
    if (age >= FRESH_DEAD) return 0;
    return 1 - (age - FRESH_FULL) / (FRESH_DEAD - FRESH_FULL);
  }
  function heldFreshObj() {                   // 들고 있는 것 중 신선도 대상 객체
    if (!held) return null;
    if (held.type === 'drink') return held.drink;
    if (held.type === 'shotglass') return held.filled ? held : null;
    if (held.type === 'pitcher') return (held.milk || held.foam) ? held : null;
    return null;
  }
  // 뜨거운 음료: 얼음컵이 아니고 에스프레소/온수/데운우유 중 하나가 들어간 것
  function isHotDrink(d) { return d && d.cup !== 'ice' && (d.espresso || d.water === 'hot' || d.milk || d.foam); }
  function isSteaming(obj) { return obj && obj.freshAt != null && (timeSec - obj.freshAt) < FRESH_FULL; }   // 30초 내에만 김
  // 김을 피울 용기들의 월드 위치(컵 위) — 들고 있는 것 + 내려놓은 것 + 머신 컵 + 잡 컵
  const STEAM_RIM_Y = 0.14;
  function steamSources() {
    const out = [];
    const addMesh = m => { if (m) out.push(m.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, STEAM_RIM_Y, 0))); };
    const vesselHot = v =>
      v.type === 'drink' ? (isHotDrink(v.drink) && isSteaming(v.drink))
        : v.type === 'shotglass' ? (v.filled && isSteaming(v))
          : v.type === 'pitcher' ? ((v.milk || v.foam) && isSteaming(v)) : false;
    if (held && vesselHot(held)) { const p = Player.heldWorldPos(); if (p) out.push(p.add(new THREE.Vector3(0, STEAM_RIM_Y, 0))); }
    placedItems.forEach(rec => { if (vesselHot(rec.item)) addMesh(rec.mesh); });
    env.machines.espressoSlots.forEach(s => { if (s.cupMesh && isHotDrink(s.drink) && isSteaming(s.drink)) addMesh(s.cupMesh); });
    machineJobs().forEach(job => {
      if (!job || !job.cupMesh) return;
      if (job.drink && isHotDrink(job.drink) && isSteaming(job.drink)) addMesh(job.cupMesh);
      else if (job.pitcher && (job.pitcher.milk || job.pitcher.foam) && isSteaming(job.pitcher)) addMesh(job.cupMesh);
    });
    return out;
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
    const equip = !held && !!h;   // 빈손 → 물건: 새로 집은 경우만 끌어당기는 연출(재료 추가 등 갱신엔 X)
    held = h;
    if (!h) { Player.setHeld(null); }
    else if (h.type === 'drink') {
      const m = WORLD.makeDrinkMesh(h.drink);
      m.scale.setScalar(1.35);
      Player.setHeld(m, equip);
    } else if (h.type === 'dessert') {
      const m = WORLD.makeDessertMesh(h.kind);
      m.scale.setScalar(1.3);
      Player.setHeld(m, equip);
    } else if (h.type === 'portafilter') {
      const m = WORLD.makePortafilterMesh(h.state || 'empty');
      m.scale.setScalar(1.3);
      Player.setHeld(m, equip);
    } else if (h.type === 'shotglass') {
      const m = WORLD.makeDrinkMesh({ cup: 'shot', espresso: h.filled ? 1 : 0, perfect: h.perfect });
      m.scale.setScalar(1.5);
      Player.setHeld(m, equip);
    } else if (h.type === 'pitcher') {
      const m = WORLD.makePitcherMesh(h.milk ? 1 : 0, h.foam ? 1 : 0);
      m.scale.setScalar(1.3);
      Player.setHeld(m, equip);
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
      ? { type: 'shotglass', filled: !!drink.espresso, perfect: !!drink.perfect, grindPerfect: !!drink.grindPerfect, freshAt: drink.freshAt }
      : { type: 'drink', drink };   // 일반 컵은 같은 객체 → freshAt 자동 유지
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

  // 컵(drink)에 우유(+거품)를 확정해 붓는다 — 즉시 붓기와 라떼아트 미니게임 완료가 공유.
  // refresh: 컵 메시를 다시 그리는 콜백(놓인 컵/머신 컵 공용). artTier: 'perfect'|'good'|'plain'|null
  function commitMilkPour(drink, refresh, h, artTier) {
    drink.milk = 1;
    addStep(drink, 'milk');
    if (h.foam) { drink.foam = 1; addStep(drink, 'foam'); }
    carryFresh(drink, h);   // 피처가 오래됐으면 컵도 그만큼 상함
    if (h.perfectFoam) drink.foamPerfect = 1;            // 퍼펙트 마이크로폼 보너스 인계
    if (artTier && artTier !== 'plain') drink.artTier = artTier;   // 라떼아트 등급 인계
    refresh();
    setHeld({ type: 'pitcher', milk: 0, foam: 0 });  // 피처 비움(재사용)
    AudioFX.pourWater(0.5);
    if (artTier === 'perfect') toast('🎨 멋진 라떼아트! 팁 보너스 ✨', 'gold', 2200);
    else if (artTier === 'good') toast('🎨 라떼아트 완성 — 제법인데요 🥛', 'good');
    else toast(h.foam ? '우유와 거품을 부었어요 🥛' : '데운 우유를 부었어요 🥛');
  }
  // 머신 슬롯에 올라간 컵의 메시 다시 그림 (붓기 후 색/크레마 갱신)
  function refreshSlotCup(slot) {
    slot.st.root.remove(slot.cupMesh);
    const cm = WORLD.makeDrinkMesh(slot.drink);
    cm.position.copy(slot.localPos);
    slot.st.root.add(cm);
    slot.cupMesh = cm;
  }
  // 들고 있는 샷잔/피처를 대상 컵(drink)에 붓는다 (refresh로 메시 갱신). 라떼아트 분기 공용.
  function pourHeldInto(drink, refresh) {
    if (held.type === 'shotglass') {
      if (!held.filled) { toast('샷잔이 비어 있어요 — 머신에서 샷을 받으세요', 'bad'); AudioFX.err(); return; }
      if (drink.espresso) { toast('이미 샷이 들어 있는 컵이에요'); return; }
      drink.espresso = 1; addStep(drink, 'espresso'); drink.perfect = !!held.perfect; drink.grindPerfect = !!held.grindPerfect;
      carryFresh(drink, held);   // 샷잔이 오래됐으면 컵도 그만큼 상함
      refresh();
      setHeld({ type: 'shotglass', filled: false, perfect: false });
      AudioFX.pourWater(0.5); toast('샷을 부었어요 ☕');
      return;
    }
    // pitcher
    if (!held.milk && !held.foam) { toast('피처가 비어 있어요 — 스티머에서 우유를 데우세요', 'bad'); AudioFX.err(); return; }
    if (drink.milk) { toast('이미 우유가 들어 있는 컵이에요'); return; }
    const h = { milk: held.milk, foam: held.foam, perfectFoam: held.perfectFoam, freshAt: held.freshAt };
    if (drink.cup === 'hot' && drink.espresso && !drink.foam && held.milk) {   // 라떼아트 가능
      LatteArt.start({ pattern: artPatternFor(), onDone: (tier) => commitMilkPour(drink, refresh, h, tier) });
      return;
    }
    commitMilkPour(drink, refresh, h, null);
  }

  // 레벨이 오를수록 더 어려운 패턴에 도전 (채점 방식은 동일 — 연출/동기부여용)
  function artPatternFor() {
    if (S.level >= 5) return '튤립';
    if (S.level >= 3) return '로제타';
    return '하트';
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

  /* 손님 영어 음성 주문 */
  const EN_NAMES = {
    espresso: 'espresso', americano: 'americano', iceAmericano: 'iced americano',
    latte: 'latte', iceLatte: 'iced latte', vanillaLatte: 'vanilla latte',
    cappuccino: 'cappuccino', mocha: 'mocha', caramelMac: 'caramel macchiato',
    croissant: 'croissant', muffin: 'chocolate muffin', cake: 'cheesecake',
  };
  function englishItemName(it) { return EN_NAMES[it.type === 'drink' ? it.recipeId : it.kind] || 'coffee'; }
  function orderPhrase(items) {
    const list = items.map(it => {
      const n = englishItemName(it);
      return `${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n}`;
    }).join(' and ');
    const cap = list.charAt(0).toUpperCase() + list.slice(1);
    const t = [`Can I get ${list}, please?`, `I'll have ${list}, please.`, `${cap}, please.`, `Could I get ${list}?`];
    return t[Math.floor(Math.random() * t.length)];
  }
  const ORDER_RATE = 1.0;   // 재생 속도(피치 유지). 속도는 생성 단계(speed)에 반영됨 — 더 늦추려면 <1.0
  let ORDER_VOICES = [];   // Audio/voices/manifest.json 에서 로드 (gen-voices.ps1 가 생성)
  fetch('Audio/voices/manifest.json')
    .then(r => r.ok ? r.json() : null)
    .then(m => { if (m && Array.isArray(m.voices)) ORDER_VOICES = m.voices; })
    .catch(() => {});   // 없으면 브라우저 TTS 폴백
  function orderVoiceKey(items) {
    const drink = items.find(i => i.type === 'drink');
    if (!drink) return null;
    const dessert = items.find(i => i.type === 'dessert');
    return dessert ? `${drink.recipeId}__${dessert.kind}` : drink.recipeId;
  }
  function speakOrder(items) {
    const key = orderVoiceKey(items);
    const fallback = orderPhrase(items);   // 클립이 없으면 브라우저 TTS로 읽음
    if (!key || !ORDER_VOICES.length) { AudioFX.speak(fallback); return; }
    const v = ORDER_VOICES[Math.floor(Math.random() * ORDER_VOICES.length)];   // 손님마다 랜덤 보이스
    AudioFX.playVoice(`Audio/voices/${v}/${key}.mp3`, 1, fallback,
      { rate: 0.96 + Math.random() * 0.18, pitch: 0.8 + Math.random() * 0.6 }, ORDER_RATE);
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
    // 출입문 여닫기 — 밖으로 나가거나 들어올 때(준비·영업 모두 가능)
    if (id === 'door') {
      if (env.door) { env.door.toggle(); AudioFX.bell(); toast(env.door.open ? '🚪 문을 열었어요' : '🚪 문을 닫았어요'); }
      return;
    }
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
      speakOrder(order.items);   // 손님이 영어로 주문을 말함
      toast(`주문 #${order.num} — ${order.items.map(itemName).join(', ')}`, 'gold');
      return;
    }

    /* --- 서빙 --- */
    if (id === 'pickup') { tryServe(); return; }

    /* --- 내려놓은 아이템: 가득 찬 샷잔으로 샷 붓기 / 집기 --- */
    if (id === 'placedItem') {
      const rec = it.rec;
      // 가득 찬 샷잔/피처를 들고 놓인 컵을 조준 → 붓기 (붓기는 샷잔·피처만 가능)
      if (held && (held.type === 'shotglass' || held.type === 'pitcher')) {
        if (rec.item.type !== 'drink' || rec.item.drink.cup === 'shot') { toast('컵에만 부을 수 있어요', 'bad'); AudioFX.err(); return; }
        pourHeldInto(rec.item.drink, () => refreshPlacedDrink(rec));
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
        const grind = job.grind;   // 분쇄도를 포터필터에 인계 (추출에 영향)
        resetJob(job);
        setHeld({ type: 'portafilter', state: 'filled', grind });
        AudioFX.metalClack();
        return;
      }
      // 빈 포터필터를 들고 있으면 → 현재 설정된 분쇄도로 즉시 분쇄 시작
      if (held && held.type === 'portafilter') {
        if (held.state === 'used') { toast('넉박스에 가루를 먼저 털어내세요', 'bad'); AudioFX.err(); return; }
        if (held.state === 'filled') { toast('이미 분쇄된 포터필터예요'); return; }
        if (held.state === 'tamped') { toast('이미 탬핑된 포터필터예요 — 머신에 장착하세요'); return; }
        if (S.stocks.beans <= 0) { toast('원두가 떨어졌어요! 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
        S.stocks.beans--;
        setHeld(null);
        job.busy = true; job.done = false; job.t = 0; job.dur = 1.6; job.hasPf = true; job.grind = job.grindSetting;
        WORLD.setPortafilterState(job.pfMesh, 'empty');
        job.sound = AudioFX.grind(job.dur);
        AudioFX.metalClack();
        UI.hud();
        return;
      }
      // 포터필터를 들지 않았으면 → 분쇄도 다이얼 조정 (소지 여부와 무관하게 가능)
      if (!grindGame) startGrindGame(job);
      return;
    }

    /* --- 에스프레소 머신: 컵 자리 (컵/샷잔 올리기·꺼내기) --- */
    if (id === 'espCup') {
      const slot = env.machines.espressoSlots[it.slot];
      if (slot.locked && !S.upgrades.dualHead) { toast('🔒 듀얼 그룹헤드 업그레이드가 필요합니다'); return; }
      // 머신 위 일반 컵(샷잔 제외)에 그 자리에서 바로 붓기 — 추출 중만 아니면 (예: 샷 추출된 컵에 우유)
      if (slot.cupMesh && slot.drink.cup !== 'shot' && !(slot.busy && !slot.done)
          && held && (held.type === 'shotglass' || held.type === 'pitcher')) {
        pourHeldInto(slot.drink, () => refreshSlotCup(slot));
        return;
      }
      if (slot.busy) {
        if (!slot.done) { toast('추출 중입니다…'); return; }
        if (held) { toast('손이 비어있어야 컵을 꺼낼 수 있어요'); return; }
        slot.st.root.remove(slot.cupMesh);
        slot.busy = slot.done = false; slot.stream.visible = false;
        const drink = slot.drink; slot.cupMesh = null; slot.drink = null; slot.progress.hide();
        setHeld(vesselToHand(drink));
        AudioFX.cupClink(0.5);
        return;
      }
      if (held && held.type === 'drink') {
        if (held.drink.espresso) { toast('이미 샷이 추출된 컵이에요'); return; }
        if (slot.cupMesh) { toast('이미 컵이 올라가 있어요'); return; }
        const drink = held.drink; setHeld(null);
        const cm = WORLD.makeDrinkMesh(drink); cm.position.copy(slot.localPos);
        slot.st.root.add(cm); slot.cupMesh = cm; slot.drink = drink; AudioFX.cupClink(0.4);
        return;
      }
      if (held && held.type === 'shotglass') {
        if (held.filled) { toast('이미 샷이 들어있는 샷잔이에요 — 컵에 따르세요', 'bad'); AudioFX.err(); return; }
        if (slot.cupMesh) { toast('이미 컵이 올라가 있어요'); return; }
        setHeld(null);
        const drink = { cup: 'shot' };
        const cm = WORLD.makeDrinkMesh(drink); cm.position.copy(slot.localPos);
        slot.st.root.add(cm); slot.cupMesh = cm; slot.drink = drink; AudioFX.cupClink(0.4);
        return;
      }
      if (held) { toast('컵이나 샷잔을 올리세요'); return; }
      if (slot.cupMesh) {   // 빈손 + 컵 있음(추출 전) → 컵 회수
        slot.st.root.remove(slot.cupMesh);
        const drink = slot.drink; slot.cupMesh = null; slot.drink = null;
        setHeld(vesselToHand(drink)); AudioFX.cupClink(0.4);
        return;
      }
      toast('컵이나 샷잔을 올리세요');
      return;
    }

    /* --- 에스프레소 머신: 포터필터 (장착·분리) --- */
    if (id === 'pfSlot') {
      const slot = env.machines.espressoSlots[it.slot];
      if (slot.locked && !S.upgrades.dualHead) { toast('🔒 듀얼 그룹헤드 업그레이드가 필요합니다'); return; }
      if (slot.busy) { toast('추출 중입니다…'); return; }
      if (held && held.type === 'portafilter') {
        if (slot.pfState !== 'none') { toast('이미 포터필터가 장착되어 있어요'); return; }
        slot.pfState = held.state || 'empty';
        slot.tampPerfect = !!held.tampPerfect;
        slot.grind = held.grind;   // 분쇄도 인계 (추출 시 줄기/시간/품질에 반영)
        WORLD.setPortafilterState(slot.pf, slot.pfState);
        slot.pf.rotation.y = PF_MOUNT_TWIST;   // 왼쪽으로 틀어진 채 시작 → updateSlots가 잠금 회전
        slot.mountT = 0;
        setHeld(null); AudioFX.metalClack();
        return;
      }
      if (held) { toast('포터필터를 들고 오세요'); return; }
      if (slot.pfState === 'none') { toast('포터필터가 없어요'); return; }
      const state = slot.pfState;     // 빈손 → 분리
      slot.pfState = 'none';
      WORLD.setPortafilterState(slot.pf, 'none');
      setHeld({ type: 'portafilter', state, tampPerfect: slot.tampPerfect, grind: slot.grind });
      slot.tampPerfect = false; slot.grind = undefined; AudioFX.metalClack();
      return;
    }

    /* --- 에스프레소 머신: 추출 버튼 --- */
    if (id === 'brew') {
      const slot = env.machines.espressoSlots[it.slot];
      if (slot.locked && !S.upgrades.dualHead) { toast('🔒 듀얼 그룹헤드 업그레이드가 필요합니다'); return; }
      if (slot.busy) { toast(slot.done ? '추출 완료 — 컵을 꺼내세요' : '추출 중입니다…'); return; }
      if (!slot.cupMesh) { toast('먼저 컵을 올리세요', 'bad'); AudioFX.err(); return; }
      if (slot.pfState !== 'tamped') {
        toast(slot.pfState === 'none' ? '탬핑한 포터필터를 장착하세요'
          : slot.pfState === 'used' ? '사용한 가루 — 포터필터를 분리해 넉박스에 비우세요'
          : slot.pfState === 'empty' ? '빈 포터필터 — 분리해 그라인더에서 분쇄하세요'
          : '탬핑이 안 됐어요 — 포터필터를 분리해 탬핑하세요', 'bad');
        AudioFX.err();
        return;
      }
      // 분쇄도 → 추출 속도(시간), 탬핑 → 채널링(물총). 둘 다 추출 줄기 비주얼에 반영
      const grind = (slot.grind == null) ? (GRIND_IDEAL_MIN + GRIND_IDEAL_MAX) / 2 : slot.grind;
      const idealGrind = grind >= GRIND_IDEAL_MIN && grind <= GRIND_IDEAL_MAX;
      slot.grindPerfect = idealGrind && slot.grind != null;
      // 물총(채널링): 탬핑이 완벽하지 않으면 퍽이 고르지 않아 줄기가 비스듬히 튄다(분쇄도와 무관)
      slot.extractMode = !slot.tampPerfect ? 'channel'
        : idealGrind ? 'ideal' : (grind < GRIND_IDEAL_MIN ? 'fine' : 'coarse');
      let dur = S.upgrades.fastShot ? 2.0 : 3.4;
      if (grind < GRIND_IDEAL_MIN) dur *= 1 + (GRIND_IDEAL_MIN - grind) * 1.5;     // 가늚: 추출 지연(과다)
      else if (grind > GRIND_IDEAL_MAX) dur *= 1 - (grind - GRIND_IDEAL_MAX) * 0.8;  // 굵음: 추출 단축(부족)
      slot.busy = true; slot.done = false; slot.t = 0;
      slot.dur = dur;
      slot.stream.visible = true;
      slot.stream.scale.set(1, 1, 1);
      slot.stream.rotation.set(0, 0, 0);
      slot.brewLiquid = WORLD.makeBrewLiquid(slot.drink.cup);
      slot.cupMesh.add(slot.brewLiquid);
      AudioFX.metalClack();
      slot.sound = AudioFX.brewing(slot.dur);
      return;
    }

    /* --- 스팀봉: 피처를 들고 [E]를 꾹 눌러 스팀 미니게임 (빈손은 퍼지) --- */
    if (id === 'steamwand') {
      const job = it.job;
      if (!held) {                       // 빈손 → 스팀봉 끝에서 스팀 분사 (퍼지)
        job.steamT = Math.max(job.steamT || 0, 1.2);
        AudioFX.steam(1.2); AudioFX.metalClack();
        return;
      }
      if (held.type === 'drink') { toast('컵에 직접 스팀할 수 없어요 — 스팀 피처에 우유를 데우세요', 'bad'); AudioFX.err(); return; }
      if (held.type !== 'pitcher') { toast('스팀 피처를 들고 오세요', 'bad'); AudioFX.err(); return; }
      if (held.foam) { toast('이미 거품까지 만든 피처예요 — 컵에 부으세요'); return; }
      if (S.stocks.milk <= 0) { toast('우유가 떨어졌어요! 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
      if (!steamGame) startSteamGame(job);
      return;
    }

    /* --- 스팀 노브: [E]로 스팀 분사(퍼지). 피처를 들었으면 스팀봉으로 안내 --- */
    if (id === 'steamknob') {
      const job = it.job;
      if (held && held.type === 'pitcher') { toast('스팀봉(아래)에 대고 [E]를 꾹 눌러 데우세요'); return; }
      job.steamT = Math.max(job.steamT || 0, 1.2);
      AudioFX.steam(1.2); AudioFX.metalClack();
      return;
    }

    /* --- 온수/냉수: 컵 올려두기 → 물 받기 → 완료되면 꺼내기 --- */
    if (id === 'waterHot' || id === 'waterCold') {
      const job = env.machines.waterJobs[id];
      if (job.busy) {
        if (!job.done) { toast('물 받는 중입니다…'); return; }
        // 물 완료된 컵에 그 자리에서 바로 샷 붓기 (꺼내 옮길 필요 없이)
        if (held && held.type === 'shotglass') {
          if (!held.filled) { toast('샷잔이 비어 있어요 — 머신에서 샷을 받으세요', 'bad'); AudioFX.err(); return; }
          if (job.drink.espresso) { toast('이미 샷이 들어 있는 컵이에요'); return; }
          job.drink.espresso = 1;
          addStep(job.drink, 'espresso');
          job.drink.perfect = !!held.perfect;
          job.drink.grindPerfect = !!held.grindPerfect;
          swapJobCup(job);                                   // 컵 메시 갱신(크레마 표시)
          setHeld({ type: 'shotglass', filled: false, perfect: false });
          AudioFX.pourWater(0.5);
          toast('샷을 부었어요 ☕');
          return;
        }
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

    /* --- 시럽: 컵을 들고 [E]를 꾹 눌러 정량 도징 미니게임 --- */
    if (id === 'syrup') {
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.syrup) { toast('이미 시럽이 들어있어요'); return; }
      if (!doseGame) startDoseGame('syrup', it.kind);
      return;
    }

    /* --- 휘핑크림: 컵을 들고 [E]를 꾹 눌러 정량 도징 미니게임 --- */
    if (id === 'whip') {
      if (!held || held.type !== 'drink') { toast('컵을 먼저 들고 오세요'); return; }
      if (held.drink.whip) { toast('이미 휘핑크림을 올렸어요'); return; }
      if (!doseGame) startDoseGame('whip', null);
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
    // 라떼아트(자유 푸어) 보너스 — perfect +15% / good +8%, perfect는 평판 +1
    const artTier = servedDrink && servedDrink.artTier;
    if (artTier === 'perfect') tip += Math.round(o.total * ART_TIP_PERFECT / 100) * 100;
    else if (artTier === 'good') tip += Math.round(o.total * ART_TIP_GOOD / 100) * 100;
    // 정량 도징(시럽/휘핑 미니게임) 보너스 — 각 +8%
    const syrupPerfect = !!(servedDrink && servedDrink.syrupPerfect);
    if (syrupPerfect) tip += Math.round(o.total * DOSE_TIP_PERFECT / 100) * 100;
    const whipPerfect = !!(servedDrink && servedDrink.whipPerfect);
    if (whipPerfect) tip += Math.round(o.total * DOSE_TIP_PERFECT / 100) * 100;
    // 이상 분쇄도 추출 보너스 — +10%
    const grindPerfect = !!(servedDrink && servedDrink.grindPerfect);
    if (grindPerfect) tip += Math.round(o.total * GRIND_TIP_PERFECT / 100) * 100;
    // 추출 컨디션 → 손님 만족도: 채널링(물총=탬핑 불균일)·과/부족 추출(분쇄도)이면 감점
    let extractQ = 1;
    if (servedDrink && servedDrink.espresso) {
      if (!perfect) extractQ -= 0.2;        // 물총(채널링) — 고르지 않은 추출
      if (!grindPerfect) extractQ -= 0.15;  // 과/부족 추출 (분쇄도 빗나감)
    }
    if (extractQ < 1) tip = Math.round(tip * extractQ / 100) * 100;
    // 신선도: 오래된 음료는 팁/평판 감소 (30초까지 신선 → 90초 최저)
    const fresh = freshness01(servedDrink);
    if (fresh < 1) tip = Math.round(tip * (0.4 + 0.6 * fresh) / 100) * 100;   // 상해도 최소 40%
    S.money += o.total + tip;
    dayStats.revenue += o.total;
    dayStats.tips += tip;
    dayStats.served++;
    let repDelta = (frac > 0.5 ? 2 : 1) + (orderOk ? 1 : 0) + (artTier === 'perfect' ? 1 : 0);
    if (extractQ < 0.7) repDelta -= 1;     // 추출 컨디션 나쁨(채널링+분쇄 빗나감): 평판 손해
    if (fresh < 0.5) repDelta -= 2;        // 많이 상함: 평판 손해
    else if (fresh < 1) repDelta -= 1;     // 약간 상함: 평판 이득 감소
    S.rep = Math.max(0, Math.min(100, S.rep + repDelta));
    if (extractQ <= 0.8) toast('☕ 추출 컨디션 미흡 — 손님 만족도 하락', 'bad', 2000);
    if (fresh < 1) toast(`⏳ 신선도 ${Math.round(fresh * 100)}% — 팁·평판 감소`, 'bad', 2200);
    gainXP(Math.round(o.total / 100));
    UI.removeTicket(o);
    orders.splice(orders.indexOf(o), 1);
    // 컵은 픽업대 연출에서 사라지므로 손님은 빈손으로 만족하며 떠남
    Customers.serve(c, null);
    const anyPerfect = perfect || foamPerfect || artTier === 'perfect' || syrupPerfect || whipPerfect || grindPerfect;
    toast(`주문 #${o.num} 완료! +${fmt(o.total)}${tip > 0 ? ` (팁 +${fmt(tip)})` : ''}${anyPerfect ? ' · 퍼펙트 ✨' : ''}`, 'good');
    if (orderOk) toast('✨ 정확한 제조 순서! 팁 +15% · 평판 +1', 'gold', 2200);
    if (foamPerfect) toast('🥛 퍼펙트 마이크로폼! 팁 +15%', 'gold', 2200);
    if (artTier === 'perfect') toast('🎨 라떼아트 퍼펙트! 팁 +15% · 평판 +1', 'gold', 2200);
    if (syrupPerfect || whipPerfect) toast('✨ 정량 도징! 팁 보너스', 'gold', 2200);
    if (grindPerfect) toast('⚙️ 완벽한 분쇄·추출! 팁 +10%', 'gold', 2200);
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
      if (!job) return;
      if (job.kind === 'water' && job.stream) job.stream.visible = job.busy && !job.done;   // 물 받는 동안 물줄기 표시
      if (!job.busy) return;
      if (!job.done) {
        job.t += dt;
        if (job.kind === 'grinder' && job.hasPf) WORLD.setPortafilterFill(job.pfMesh, job.t / job.dur);   // 분쇄 중 가루 차오름
        if (job.t >= job.dur) {
          job.done = true;
          if (job.sound) { job.sound.stop(); job.sound = null; }
          if (job.kind === 'steamer') {
            // 피처에 데운 우유/거품을 채움 (순서 기록은 컵에 부을 때)
            if (job.makingFoam) job.pitcher.foam = 1; else job.pitcher.milk = 1;
            stampFresh(job.pitcher);   // 데운 우유 신선도 시계 시작
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
  const PF_MOUNT_DUR = 0.5;     // 체결 트위스트 지속(초)
  const PF_MOUNT_TWIST = -0.95; // 시작 시 핸들이 틀어진 각도(rad) → 0으로 돌며 잠김(왼→오)
  function updateSlots(dt) {
    env.machines.espressoSlots.forEach(slot => {
      // 포터필터 체결 애니메이션: 왼쪽으로 틀어 끼웠다 → 오른쪽으로 돌려 잠김
      if (slot.mountT != null) {
        slot.mountT += dt;
        const e = 1 - Math.pow(1 - Math.min(1, slot.mountT / PF_MOUNT_DUR), 3);   // easeOutCubic
        slot.pf.rotation.y = PF_MOUNT_TWIST * (1 - e);
        if (slot.mountT >= PF_MOUNT_DUR) { slot.pf.rotation.y = 0; slot.mountT = null; }
      }
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
        slot.drink.grindPerfect = !!slot.grindPerfect;   // 이상 분쇄도 → 추출 품질 보너스
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
        // 커피 줄기 — 탬핑 불균일이면 물총(channel), 분쇄도로 빠름(coarse)/꾸준(ideal)/뚝뚝(fine)
        const s = slot.stream;
        const mode = slot.extractMode || 'ideal';
        const bx = slot.localPos.x;
        if (mode === 'channel') {
          // 물총(스프릿징): 채널링으로 가는 줄기가 비스듬히 사방으로 튐 — 각도/위치가 들쭉날쭉
          s.visible = true;
          const ang = Math.sin(slot.t * 57) * 0.5 + Math.sin(slot.t * 31) * 0.22;   // 좌우로 휘는 분출 각
          s.scale.set(0.7, 1.05 + Math.sin(slot.t * 40) * 0.15, 0.7);                // 가늘게(굵은 분수 아님)
          s.rotation.z = ang;
          s.rotation.x = Math.sin(slot.t * 46) * 0.28;
          s.position.x = bx - ang * 0.06 + Math.sin(slot.t * 63) * 0.01;             // 추출구(상단) 고정하듯 보정 + 떨림
          s.position.y = 0.115 + Math.sin(slot.t * 44) * 0.008;
        } else if (mode === 'coarse') {
          // 빠른 추출: 곧게 떨어지되 조금 굵고 빠르게 출렁이는 줄기(부족 추출)
          s.visible = true;
          s.rotation.set(0, 0, 0); s.position.x = bx;
          s.scale.set(1.25, 1.1 + Math.sin(slot.t * 38) * 0.14, 1.25);
          s.position.y = 0.115 + Math.sin(slot.t * 34) * 0.006;
        } else if (mode === 'fine') {
          // 뚝뚝: 가는 줄기가 주기적으로 끊기며 방울이 떨어짐(과다 추출)
          const phase = (slot.t * 2.4) % 1;
          s.visible = phase < 0.42;
          s.rotation.set(0, 0, 0); s.position.x = bx;
          s.scale.set(0.55, 0.5 + phase * 0.5, 0.55);
          s.position.y = 0.13 - phase * 0.05;
        } else {
          // 이상: 꾸준한 줄기 (압력 느낌의 미세한 흔들림)
          s.visible = true;
          s.rotation.set(0, 0, 0); s.position.x = bx;
          s.position.y = 0.115 + Math.sin(slot.t * 30) * 0.005;   // 올라간 추출구에 맞춘 줄기 중심
          s.scale.set(1, 1 + Math.sin(slot.t * 22) * 0.08, 1);
        }
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
  // 게이지(#tampGame) 채움 방향/색 설정 — 탬핑·스팀은 아래→위(기본 앰버), 도징은 위→아래(재료색)
  function gaugeBottomUp(lo, w = TAMP_PERF_W, fillBg = '') {
    $('tampGame').classList.remove('dose');
    $('tgFill').style.background = fillBg;   // '' = CSS 기본 앰버 그라데이션
    const band = document.querySelector('#tampGame .tgPerfect');
    if (band) { band.style.top = 'auto'; band.style.bottom = (lo * 100) + '%'; band.style.height = (w * 100) + '%'; }
    $('tgFill').style.height = '0%';
  }
  function gaugeTopDown(lo, fillBg) {
    $('tampGame').classList.add('dose');
    $('tgFill').style.background = fillBg;
    const band = document.querySelector('#tampGame .tgPerfect');
    if (band) { band.style.bottom = 'auto'; band.style.top = (lo * 100) + '%'; band.style.height = (TAMP_PERF_W * 100) + '%'; }
    $('tgFill').style.height = '0%';
  }
  // 시럽/휘핑 게이지 색 (위가 밝고 아래가 진하게 — 부어 넣는 느낌)
  function doseFillColor(kind, syrupKind) {
    if (kind === 'whip') return 'linear-gradient(180deg,#ffffff,#e7e3d6)';
    const c = ({ vanilla: ['#f6ecc4', '#e3c97e'], caramel: ['#d59a55', '#a5662a'], choco: ['#7c4c30', '#492a18'] })[syrupKind]
      || ['#e6cd84', '#c08a3e'];
    return `linear-gradient(180deg,${c[0]},${c[1]})`;
  }
  function startTampGame() {
    // 퍼펙트 존 시작 위치를 매번 살짝 랜덤화 (외워지지 않도록)
    const lo = TAMP_PERF_MIN + Math.random() * (TAMP_PERF_MAX - TAMP_PERF_MIN);
    // 누르는 즉시 채워지는 press-and-hold (떼면 그 지점으로 판정)
    tampGame = { fill: 0, locked: null, perfect: [lo, lo + TAMP_PERF_W], sound: AudioFX.tampHold(TAMP_DUR) };
    gaugeBottomUp(lo);
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
  // 손을 뗀(또는 가득 찬) 순간 즉시 판정·확정 — 히트스톱(시간 지연) 없음.
  // 연출 대기 중 시선이 탬핑대를 벗어나면 취소되던 문제를 없애기 위해 떼는 즉시 상태 커밋.
  function lockTampGame(fill) {
    if (tampGame.locked) return;
    tampGame.locked = true;
    stopTampSound();
    const pz = tampGame.perfect;
    const result = (fill >= pz[0] && fill <= pz[1]) ? 'perfect'
      : (fill >= TAMP_MIN) ? 'good' : 'weak';
    if (result === 'weak') {
      AudioFX.err();
      toast('약하게 눌렀어요 — 다시 꾹 눌러 다지세요', 'bad', 1500);
      endTampGame();
    } else {
      pressTamper();
      AudioFX.tampDone();
      if (result === 'perfect') AudioFX.tampPerfectSfx();
      finishTamp(result === 'perfect', result === 'perfect' ? '✨ 퍼펙트 탬핑! 크레마 보너스' : '탬핑 성공 — 약간 불균일(추출 시 물총 주의)', result === 'perfect' ? 'gold' : 'good');
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
    // 누르는 동안 게이지 상승, 손을 떼면 그 지점으로 즉시 판정·확정
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
    gaugeBottomUp(lo);
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
    steamGame.locked = true;
    stopSteamSound();
    const pz = steamGame.perfect;
    const result = (fill >= pz[0] && fill <= pz[1]) ? 'perfect'
      : (fill >= TAMP_MIN) ? 'good' : 'weak';
    if (result === 'weak') {
      AudioFX.err();
      toast('스팀이 약해요 — 다시 꾹 눌러 데우세요', 'bad', 1500);
      endSteamGame();
    } else {
      AudioFX.tampDone();
      if (result === 'perfect') AudioFX.tampPerfectSfx();
      finishSteam(result === 'perfect',
        result === 'perfect' ? '✨ 퍼펙트 마이크로폼! (팁 보너스)' : (steamGame.makingFoam ? '우유 거품 완성!' : '우유 스팀 완성!'),
        result === 'perfect' ? 'gold' : 'good');
    }
  }
  function finishSteam(perfect, msg, cls) {
    S.stocks.milk--;                          // 성공 시 우유 1 소모
    if (steamGame.makingFoam) held.foam = 1; else held.milk = 1;
    held.perfectFoam = perfect;               // 마이크로폼 — 컵에 부을 때 보너스 인계
    stampFresh(held);                         // 데운 우유 신선도 시계 시작
    setHeld(held);
    toast(msg, cls);
    UI.hud();
    endSteamGame();
  }
  function updateSteamGame(dt, aimData) {
    if (!steamGame) return false;
    const ok = aimData && aimData.id === 'steamwand' && held && held.type === 'pitcher' && !held.foam;
    if (!ok) { endSteamGame(); return false; }   // 시선을 돌리거나 상태가 바뀌면 취소
    // 누르는 동안 폼 게이지 상승 + 스팀봉 증기, 손 떼면 그 지점으로 즉시 판정·확정
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

  /* ===== 시럽/휘핑 도징 미니게임 — 탬핑·스팀과 같은 게이지를 공유, 컵을 든 채 진행 =====
   * 시럽 펌프대/휘핑기를 보며 컵을 들고 [E]로 시작 → [E]를 꾹 눌러 도징 게이지 상승 →
   * 퍼펙트 존(정량)에서 떼면 팁 보너스, 일반 성공도 재료 추가. 너무 적으면 재시도. */
  function startDoseGame(kind, syrupKind) {
    const lo = TAMP_PERF_MIN + Math.random() * (TAMP_PERF_MAX - TAMP_PERF_MIN);
    const part = kind === 'syrup'
      ? (env.machines.syrup && env.machines.syrup.pumps[syrupKind])
      : (env.machines.whip && env.machines.whip.nozzle);
    // 누르는 즉시 채워지는 press-and-hold (떼면 그 지점으로 판정)
    doseGame = { fill: 0, locked: null, perfect: [lo, lo + TAMP_PERF_W], kind, syrupKind,
      drink: held.drink, field: kind === 'syrup' ? 'syrup' : 'whip', tickT: 0,
      part, partBaseY: part ? part.position.y : 0 };
    gaugeTopDown(lo, doseFillColor(kind, syrupKind));   // 위→아래로 차오르는 재료색 게이지
    setGaugeText(kind === 'syrup' ? '🍯 시럽 — <b>[E]</b>를 누르고 있어 펌프' : '🍦 휘핑 — <b>[E]</b>를 누르고 있어 짜기',
      '퍼펙트 존(초록)에서 손을 떼면 정량 도징(팁) 보너스 · 끝까지 눌러도 성공');
    clearHitFx();
    $('tampGame').classList.remove('hidden');
  }
  // 펌프 헤드/노즐을 살짝 눌렀다 떼는 연출 (펌프질·분사 반복)
  function pulseDosePart() {
    const g = doseGame;
    if (!g || !g.part) return;
    const part = g.part, base = g.partBaseY;
    part.position.y = base - 0.03;
    setTimeout(() => { part.position.y = base; }, 120);
  }
  function endDoseGame() {
    if (doseGame && doseGame.part) doseGame.part.position.y = doseGame.partBaseY;   // 진행 중 종료 시 원위치
    doseGame = null;
    clearHitFx();
    $('tampGame').classList.remove('dose');
    $('tgFill').style.background = '';
    $('tampGame').classList.add('hidden');
  }
  function lockDoseGame(fill) {
    if (doseGame.locked) return;
    doseGame.locked = true;
    const pz = doseGame.perfect;
    const result = (fill >= pz[0] && fill <= pz[1]) ? 'perfect'
      : (fill >= DOSE_MIN) ? 'good' : 'weak';
    if (result === 'weak') {
      AudioFX.err();
      toast(doseGame.kind === 'syrup' ? '시럽이 너무 적어요 — 다시 [E]로 펌프하세요' : '휘핑이 부족해요 — 다시 [E]로 짜세요', 'bad', 1500);
      endDoseGame();
    } else {
      finishDose(result === 'perfect');
    }
  }
  function finishDose(perfect) {
    const d = doseGame.drink;
    if (doseGame.kind === 'syrup') {
      d.syrup = doseGame.syrupKind;
      addStep(d, 'syrup');
      d.syrupPerfect = perfect;
      AudioFX.syrupPump();
    } else {
      d.whip = 1;
      addStep(d, 'whip');
      d.whipPerfect = perfect;
      AudioFX.whipSpray();
    }
    if (perfect) AudioFX.tampPerfectSfx();
    setHeld(held);   // 컵 메시·라벨 갱신
    toast(perfect ? (doseGame.kind === 'syrup' ? '✨ 퍼펙트 시럽 도징! (팁 보너스)' : '✨ 완벽한 휘핑! (팁 보너스)')
      : (doseGame.kind === 'syrup' ? '시럽을 넣었어요' : '휘핑크림을 올렸어요'), perfect ? 'gold' : 'good');
    endDoseGame();
  }
  function updateDoseGame(dt, aimData) {
    if (!doseGame) return false;
    const g = doseGame;
    const ok = aimData && aimData.id === g.kind && held && held.type === 'drink' && !held.drink[g.field];
    if (!ok) { endDoseGame(); return false; }   // 시선을 돌리거나 상태가 바뀌면 취소
    // 누르는 동안 도징 게이지 상승(펌프/스프레이 사운드 반복), 손 떼면 그 지점으로 즉시 판정·확정
    if (useDown) {
      g.fill = Math.min(1, g.fill + dt / DOSE_DUR);
      $('tgFill').style.height = (g.fill * 100) + '%';
      g.tickT += dt;
      if (g.tickT >= 0.22) { g.tickT = 0; (g.kind === 'syrup' ? AudioFX.syrupPump : AudioFX.whipSpray)(); pulseDosePart(); }
      if (g.fill >= 1) lockDoseGame(1);
    } else {
      lockDoseGame(g.fill);
    }
    return true;
  }

  /* ===== 분쇄도 다이얼 — 그라인더에서 [E]로 분쇄도를 조정(머신에 저장) =====
   * 포터필터 소지와 무관하게 조정 가능. [E]를 꾹 누르면 게이지가 차오르고(아래=가늚, 위=굵음),
   * 떼는 위치가 분쇄도 설정이 된다. 이후 빈 포터필터를 들고 [E]로 그 설정대로 분쇄한다. */
  function startGrindGame(job) {
    grindGame = { fill: 0, locked: null, job };
    gaugeBottomUp(GRIND_IDEAL_MIN, GRIND_IDEAL_MAX - GRIND_IDEAL_MIN, 'linear-gradient(0deg,#3a241a,#8a5636)');
    setGaugeText('⚙️ 분쇄도 조정 — <b>[E]</b>를 누르고 있어 굵게',
      '초록(이상)에서 떼면 완벽 추출 · 가늘면 뚝뚝(과다), 굵으면 분사(부족)');
    clearHitFx();
    $('tampGame').classList.remove('hidden');
  }
  function endGrindGame() {
    grindGame = null;
    clearHitFx();
    $('tampGame').classList.add('hidden');
  }
  function lockGrindGame(fill) {
    if (grindGame.locked) return;
    grindGame.locked = true;
    const job = grindGame.job;
    job.grindSetting = fill;   // 0 가늚 ~ 1 굵음 — 머신에 저장(분쇄 시 포터필터로 인계)
    if (job.dialMark) WORLD.setGrinderDial(job.dialMark, fill);
    const ideal = fill >= GRIND_IDEAL_MIN && fill <= GRIND_IDEAL_MAX;
    if (ideal) { toast('⚙️ 분쇄도 설정: 이상적 — 균형 잡힌 추출', 'good', 1600); AudioFX.tampPerfectSfx(); }
    else { toast(fill < GRIND_IDEAL_MIN ? '⚙️ 분쇄도: 가늚 — 추출이 느려 뚝뚝(과다)' : '⚙️ 분쇄도: 굵음 — 추출이 빨라요(부족)', '', 1700); AudioFX.metalClack(); }
    endGrindGame();
  }
  function updateGrindGame(dt, aimData) {
    if (!grindGame) return false;
    // 조정 중엔 그라인더를 계속 보고만 있으면 됨(소지 무관). 단 빈 포터필터를 들면 분쇄 의도로 보고 취소
    const ok = aimData && aimData.id === 'grinder' && !(held && held.type === 'portafilter');
    if (!ok) { endGrindGame(); return false; }
    if (useDown) {
      grindGame.fill = Math.min(1, grindGame.fill + dt / GRIND_DUR);
      $('tgFill').style.height = (grindGame.fill * 100) + '%';
      if (grindGame.fill >= 1) lockGrindGame(1);
    } else {
      lockGrindGame(grindGame.fill);
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
    // 탬핑/스팀/도징/분쇄 미니게임 초기화
    useDown = false;
    endTampGame();
    endSteamGame();
    endDoseGame();
    endGrindGame();
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
    if (env.doorSign) env.doorSign.setOpen(false);             // 영업 전 = CLOSE 팻말
    if (env.door) env.door.open = false;                       // 영업 전 = 문 닫힘
    if (typeof Weather !== 'undefined') {                      // 오늘 바깥 날씨 결정 + 실외 분위기 갱신
      const w = Weather.setForDay(S.day);
      Weather.setClock(8);                                     // 준비 단계 = 아침 08시(해 낮게)
      if (w) toast(`${w.icon} 오늘 바깥 날씨: ${w.label}`, '', 3200);
    }
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
    if (env.doorSign) env.doorSign.setOpen(true);   // 영업 중 = OPEN 팻말
    if (env.door) env.door.open = true;             // 영업 시작 = 문 열림
    if (typeof Weather !== 'undefined') Weather.setClock(9);   // 영업 시작 = 09시
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
    let base = 20 - S.day * 0.6;
    base *= earlyEaseFactor();      // 초반 적응 구간 완화
    if (S.upgrades.ads) base *= 0.72;
    base *= S.rep >= 70 ? 0.85 : S.rep <= 30 ? 1.3 : 1;
    base = Math.max(8, base);
    return base * (0.7 + Math.random() * 0.6);
  }

  function endDay() {
    mode = 'dayEnd';
    Player.enabled = false;
    if (env.doorSign) env.doorSign.setOpen(false);   // 마감 = CLOSE 팻말
    if (env.door) env.door.open = false;             // 마감 = 문 닫힘
    if (typeof Weather !== 'undefined') Weather.setClock(18);   // 마감 = 18시(해 지는 시각)
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
  /* 조준 대상 아웃라인 — 후처리(OutlinePass) 기반 외곽선.
   * 모델 메시를 OutlinePass.selectedObjects에 올려 두께가 균일한 깔끔한 엣지 외곽선을 그린다.
   * (composer는 main.js가 만들어 Game.setOutlinePass로 주입 — 준비 전이면 박스로 폴백)
   * 모델을 못 찾는 일부(계산대·픽업대 등)는 히트박스 박스로 폴백. */
  let _outlinePass = null;     // main.js가 후처리 컴포저 준비 후 주입
  let _outlineSrc = null;      // 현재 외곽선 대상 키(재선택 판단)
  function clearOutline() {
    if (_outlinePass) _outlinePass.selectedObjects = [];
    _outlineSrc = null;
  }
  function meshVisible(o) {     // 부모까지 따라가 실제로 보이는 메시인지
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }
  // srcList의 루트들을 순회해 외곽선을 그릴 실제 메시만 수집(라벨 평면·히트박스·숨김 제외)
  function collectOutlineTargets(srcList) {
    const out = [];
    for (const s of srcList) s.traverse(o => {
      if (!o.isMesh || o.userData.isHitbox) return;
      if (o.geometry && o.geometry.type === 'PlaneGeometry') return;   // 라벨 텍스트 평면 제외
      if (!meshVisible(o)) return;                                     // 숨겨진 메시(예: 분리된 포터필터)는 제외
      out.push(o);
    });
    return out;
  }
  // 조준한 히트박스 → 외곽선을 그릴 대상 { key(재생성 판단), srcList(외곽선 만들 루트들) }
  function aimOutlineSpec(aimMesh) {
    if (!aimMesh) return null;
    const it = aimMesh.userData.interact;
    // 에스프레소 머신 컵 자리: 올라간 컵 → 컵에, 비어 있으면 받침판(EspressoPlateL/R)에 외곽선
    if (it && it.id === 'espCup') {
      const slot = env.machines.espressoSlots[it.slot];
      if (slot.cupMesh) return { key: slot.cupMesh, srcList: [slot.cupMesh] };
      if (slot.plateMesh) return { key: slot.plateMesh, srcList: [slot.plateMesh] };
      return null;
    }
    // 포터필터/추출버튼 등 특정 부품만 (히트박스에 지정된 메시들 — 후처리 외곽선은 작은 버튼도 잘 보임)
    if (aimMesh.userData.outlineMeshes) return { key: aimMesh, srcList: aimMesh.userData.outlineMeshes };
    if (aimMesh.userData.station) return { key: aimMesh.userData.station.root, srcList: [aimMesh.userData.station.root] };
    if (aimMesh.userData.outlineRoot) return { key: aimMesh.userData.outlineRoot, srcList: [aimMesh.userData.outlineRoot] };
    if (it && it.id === 'placedItem' && it.rec) return { key: it.rec.mesh, srcList: [it.rec.mesh] };
    return null;
  }
  function updateAimHighlight(aimMesh) {
    const box = env.aimHighlight;
    const spec = aimOutlineSpec(aimMesh);
    if (spec && _outlinePass) {             // 모델 메시 → 후처리 외곽선
      if (box) box.visible = false;
      if (_outlineSrc !== spec.key) { _outlinePass.selectedObjects = collectOutlineTargets(spec.srcList); _outlineSrc = spec.key; }
      return;
    }
    if (_outlineSrc !== null) clearOutline();
    if (!box) return;                      // 모델 매핑 불가(또는 컴포저 준비 전) → 히트박스 박스 폴백
    const g = aimMesh && aimMesh.geometry && aimMesh.geometry.parameters;
    if (g) {
      aimMesh.updateWorldMatrix(true, false);
      aimMesh.matrixWorld.decompose(box.position, box.quaternion, box.scale);
      box.scale.set(box.scale.x * g.width, box.scale.y * g.height, box.scale.z * g.depth).multiplyScalar(1.04);
      box.visible = true;
    } else {
      box.visible = false;
    }
  }

  function updatePrep() {
    // 준비 단계: 재고 보충 프롬프트만 표시 (손님·시계 정지)
    const pr = $('prompt');
    if (prepPanelOpen) { pr.classList.add('hidden'); $('crosshair').classList.remove('active'); updateAimHighlight(null); return; }
    const aimData = Player.aim();
    const usable = aimData && (aimData.id === 'restock' || aimData.id === 'door');   // 준비 단계에 쓸 수 있는 것만
    updateAimHighlight(usable ? Player.aimedObject : null);
    if (usable) {
      pr.innerHTML = UI.prompt(aimData);
      pr.classList.remove('hidden'); $('crosshair').classList.add('active');
    } else {
      pr.classList.add('hidden'); $('crosshair').classList.remove('active');
    }
  }

  function updateFreshnessHUD() {
    const el = $('freshness');
    const obj = heldFreshObj();
    if (!obj || obj.freshAt == null) { el.classList.add('hidden'); return; }
    const f = freshness01(obj), pct = Math.round(f * 100);
    let color, label;
    if (f >= 0.999) { color = '#7ec98a'; label = '신선함'; }
    else if (f >= 0.5) { color = '#e8c46d'; label = '신선도 저하'; }
    else if (f > 0) { color = '#e08a4b'; label = '상하는 중'; }
    else { color = '#d9534f'; label = '상함'; }
    el.textContent = `🌡 신선도 ${pct}% · ${label}`;
    el.style.color = color; el.style.borderColor = color;
    el.classList.remove('hidden');
  }

  function update(dt) {
    if (mode === 'prep') { updatePrep(); return; }
    if (mode !== 'playing') { updateAimHighlight(null); $('freshness').classList.add('hidden'); return; }

    // 시간
    timeSec += dt;
    if (open && timeSec >= DAY_LEN) {
      open = false;
      toast('영업 마감! 남은 손님을 응대하세요', 'gold', 3500);
      AudioFX.bell();
    }
    UI.clock();
    if (typeof Weather !== 'undefined')                         // 시각에 맞춰 해 고도·하늘빛 갱신(일출→정오→일몰)
      Weather.setClock(Math.min(18, 9 + (timeSec / DAY_LEN) * 9));

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
    updateFreshnessHUD();

    // 라떼아트 미니게임 — 진행 중엔 다른 조준/상호작용을 모두 잠그고 단독 처리
    if (LatteArt.update(dt, useDown)) {
      $('prompt').classList.add('hidden');
      $('crosshair').classList.remove('active');
      env.placeIndicator.visible = false;
      updateAimHighlight(null);
      barTimer -= dt;
      if (barTimer <= 0) { UI.ticketBars(); barTimer = 0.25; }
      Tutorial.update();
      return;
    }

    // 조준 & 프롬프트 (+ 내려놓기 파란 표시, 조준 대상 아웃라인)
    const aimData = Player.aim();
    updateAimHighlight(aimData ? Player.aimedObject : null);
    const tamping = updateTampGame(dt, aimData);
    const steaming = updateSteamGame(dt, aimData);
    const dosing = updateDoseGame(dt, aimData);
    const grinding = updateGrindGame(dt, aimData);
    let p = UI.prompt(aimData);
    if (tamping || steaming || dosing || grinding) p = null;   // 미니게임 중엔 안내 텍스트를 숨겨 게이지 바를 가리지 않게
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
    LatteArt.init();
    if (hasSave()) $('btnContinue').classList.remove('hidden');
    UI.recipeBook();

    // E/클릭: 스테이션 상호작용 → 없으면 표면에 내려놓기
    function onUse() {
      if (LatteArt.active) return;   // 라떼아트 진행 중엔 입력이 푸어(useDown)에만 쓰임
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
    setOutlinePass(p) { _outlinePass = p; },   // main.js가 후처리 OutlinePass 주입

    get mode() { return mode; },
    set mode(v) { mode = v; },
    get prepPanelOpen() { return prepPanelOpen; },
    get inTutorial() { return Tutorial.active(); },
    notifyEditMode(on) {
      if (on) {
        // 내려놓기 표시·레시피북·조준 아웃라인 숨김 (머신 작업은 계속 표시되며 시간만 정지)
        env.placeIndicator.visible = false;
        if (env.aimHighlight) env.aimHighlight.visible = false;
        clearOutline();
        $('prompt').classList.add('hidden');
        $('recipeBook').classList.add('hidden');
      }
    },
    isBrewing: () => env.machines.espressoSlots.some(s => s.busy && !s.done),
    steamSources,
    _debug: { closeNow() { timeSec = DAY_LEN + 1; open = false; Customers.clear(); orders = []; $('tickets').innerHTML = ''; } },
  };
})();
