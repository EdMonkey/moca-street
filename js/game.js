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
  const BAL = DATA.BALANCE;   // 밸런스 단일 표 (data.js)

  /* ===== 상태 ===== */
  let env = null, scene = null;
  let mode = 'menu';              // menu | prep | playing | closing | after | gameover
  let S = null;                   // 저장되는 상태
  let held = null;                // {type:'drink',drink:{...}} | {type:'dessert',kind}
  let orders = [];                // {customer, items:[{type,recipeId|kind,done}], total}
  let spawnTimer = 3;
  let dayStats = null;
  let orderSeq = 0;
  let barTimer = 0;
  let placedItems = [];           // 표면에 내려놓은 아이템들 {item, mesh, hb}
  let indPulse = 0;
  let itemPlaceRot = 0;
  let itemPlacePreview = null;
  let itemPlacePreviewKey = null;
  let tampGame = null;            // 탬핑 게이지 상태 {fill, locked, sound} (비활성 시 null)
  let steamGame = null;           // 스팀 미니게임 상태 (비활성 시 null)
  let doseGame = null;            // 시럽/휘핑 도징 미니게임 상태 (비활성 시 null)
  let grindGame = null;           // 분쇄도 다이얼 미니게임 상태 (비활성 시 null)
  let useDown = false;            // [E]/좌클릭을 누르고 있는 중
  let deliveryPlaceRot = 0;       // 택배박스 바닥 배치 회전(90도 단위)
  let milkFridgeOpen = false;      // 디저트 쇼케이스 아래 우유 냉장고 문 상태
  let milkFridgeVisibleCount = null;
  // 머신 위 재사용 샷잔 수량 제한 — 거치대에 있는(가용) 개수. grab시 --, 반납시 ++
  const SHOT_MAX = 2;
  let shotAvail = SHOT_MAX;
  // POS 주문 입력(모니터 확대 메뉴 선택)
  let posOpen = false;            // POS 메뉴 화면이 열려 있는가
  let posCustomer = null;         // 현재 주문 입력 중인 손님
  let posCart = [];               // 선택한 메뉴 [{type:'drink',recipeId,extraShot}|{type:'dessert',kind}]
  function updateRackVisuals() {
    if (env && env.shotRack) env.shotRack.glasses.forEach((g, i) => { g.visible = i < shotAvail; });
  }

  function freshState(starter = true) {
    const base = {
      money: 20000, day: 1, rep: 50, level: 1, xp: 0,
      stocks: { beans: 25, milk: starter ? 2 : 0, cups: 30, dessert: 8 },
      storage: { beans: 0, milk: 0, cups: 0, dessert: 0 },
      pendingDeliveries: [],
      deliveryBoxes: [],
      upgrades: {},
      equip: {},          // 구매한 추가 장비 개수 { grinder, espresso, steamer }
    };
    const state = starter ? Logistics.initialState(base) : Logistics.ensureState(base);
    Pitchers.ensureState(state);
    if (starter) Pitchers.ensureMilkState(state, { starterMilk: 2 });
    return state;
  }
  function freshDayStats() {
    return { revenue: 0, tips: 0, served: 0, angry: 0, spent: 0 };
  }
  const supplyNames = { beans: '원두', milk: '우유', cups: '컵', dessert: '디저트' };
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

  function renderDeliveryBoxes() {
    if (!env || !env.syncDeliveryBoxes) return;
    Logistics.ensureState(S);
    env.syncDeliveryBoxes(S.deliveryBoxes.filter(b => b.id !== (held && held.type === 'deliveryBox' ? held.id : null) && !b.surfacePlaced));
  }

  function renderStorageBoxes() {
    if (!env || !env.clearStorageShelfVisuals) return;
    Logistics.ensureState(S);
    Pitchers.ensureMilkState(S);
    env.clearStorageShelfVisuals();
  }

  function syncPitchers() {
    if (!env || !env.syncPitchers) return;
    Pitchers.ensureState(S);
    const hiddenId = held && held.type === 'pitcher' ? held.id : null;
    env.syncPitchers(S.pitchers.items.filter(p => p.id !== hiddenId));
  }

  function syncMilkFridgeMilk(reset = false) {
    if (!env || !env.setMilkFridgeMilkCount) return;
    Pitchers.ensureMilkState(S);
    const looseFridgeCount = (S.milkCartons || []).filter(c =>
      c && c.location === 'fridge' && !c.crumpled && !c.spoiled &&
      Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)
    ).length;
    const stock = Math.max(0, Pitchers.milkLocationCount(S, 'fridge') - looseFridgeCount);
    const maxVisible = 6;
    if (reset || milkFridgeVisibleCount === null) milkFridgeVisibleCount = Math.min(stock, maxVisible);
    milkFridgeVisibleCount = Math.max(0, Math.min(milkFridgeVisibleCount, stock, maxVisible));
    env.setMilkFridgeMilkCount(milkFridgeVisibleCount);
  }

  function renderDeliveryOrders() {
    const list = $('deliveryOrderList');
    if (!list) return;
    Logistics.ensureState(S);
    const money = $('deliveryMoney');
    if (money) money.innerHTML = `보유 금액 <b>${fmt(S.money)}</b>`;
    list.innerHTML = '';
    Logistics.KINDS.forEach(kind => {
      const r = RESTOCK[kind];
      const pending = S.pendingDeliveries
        .filter(d => d.kind === kind)
        .reduce((sum, d) => sum + d.amount, 0);
      const div = document.createElement('div');
      div.className = 'upg';
      div.innerHTML =
        `<div><div class="un">${r.name} 주문</div>` +
        `<div class="ud">내일 아침 문앞 도착 +${r.amount}${pending ? ` · 대기 ${pending}` : ''}</div></div>` +
        `<button class="btn" data-delivery="${kind}" ${S.money < r.price ? 'disabled' : ''}>${fmt(r.price)}</button>`;
      list.appendChild(div);
    });
    list.querySelectorAll('button[data-delivery]').forEach(b => {
      b.onclick = () => orderScheduledDelivery(b.dataset.delivery);
    });
  }

  function orderScheduledDelivery(kind) {
    const r = RESTOCK[kind];
    if (S.money < r.price) { toast('돈이 부족해요!', 'bad'); AudioFX.err(); return; }
    S.money -= r.price;
    Logistics.scheduleDelivery(S, kind, 1, S.day - 1);   // 마감 후엔 S.day가 이미 다음날
    AudioFX.cash();
    toast(`${r.name} 주문 완료 — 다음날 아침 문앞 도착`, 'good');
    renderDeliveryOrders();
    UI.hud();
    save();
  }

  function orderQuickDelivery(kind) {
    const r = RESTOCK[kind];
    const price = Logistics.deliveryPrice(kind, 1, true);
    if (S.money < price) { toast('퀵 배송비가 부족해요!', 'bad'); AudioFX.err(); return; }
    S.money -= price;
    if (dayStats) dayStats.spent += price;
    Logistics.addDeliveryBox(S, kind, r.amount, 'quick');
    renderDeliveryBoxes();
    AudioFX.cash();
    toast(`퀵 배송 도착! 문앞 ${r.name} 박스를 창고에 넣으세요`, 'gold', 4200);
    UI.hud();
    save();
  }

  function storeHeldDelivery() {
    if (!held || held.type !== 'deliveryBox') return false;
    const res = Logistics.storeDeliveryBox(S, held.id);
    if (!res.ok) {
      toast('?? ??? ????', 'bad'); AudioFX.err();
      if (res.reason === 'missing') { setHeld(null); renderDeliveryBoxes(); }
      return true;
    }
    if (res.kind === 'milk') {
      Pitchers.ensureMilkState(S);
      for (let i = 0; i < res.amount; i++) S.milkCartons.push(Pitchers.newMilkCarton({ location: 'storage' }));
      Pitchers.ensureMilkState(S);
      seedLooseMilkCartons();
      restoreLooseMilkCartons();
      syncMilkFridgeMilk(true);
    }
    setHeld(null);
    renderDeliveryBoxes();
    UI.hud();
    save();
    toast(`${supplyNames[res.kind]} ?? +${res.amount}`, 'good');
    AudioFX.put();
    return true;
  }

  function returnHeldLogistics(notify = false) {
    if (!held || held.type !== 'deliveryBox') return false;
    setHeld(null);
    if (env.setDeliveryPreview) env.setDeliveryPreview(null);
    renderDeliveryBoxes();
    if (notify) toast('????? ??????');
    return true;
  }

  /* ===== 음료 비교 ===== */
  function canonical(d) {   // 정확 비교 — 샷 수 포함 (주문 매칭)
    const shots = (d.shots != null) ? d.shots : (d.espresso ? 1 : 0);
    return [d.cup, +!!d.ice, shots, d.water || '', +!!d.milk, +!!d.foam, d.syrup || '', +!!d.whip].join('|');
  }
  function baseCanonical(d) {   // 느슨 비교 — 샷 수 무시 (음료 종류 식별용)
    return [d.cup, +!!d.ice, +(!!d.espresso || (d.shots || 0) > 0), d.water || '', +!!d.milk, +!!d.foam, d.syrup || '', +!!d.whip].join('|');
  }
  function matchesRecipe(drink, recipeId) {   // 음료 종류 식별 (샷 수 무시)
    return baseCanonical(drink) === baseCanonical(RECIPES[recipeId].target);
  }
  function matchesOrderItem(drink, item) {    // 주문 정확 매칭 — '샷 추가' 반영
    const t = RECIPES[item.recipeId].target;
    const shots = (t.espresso ? 1 : 0) + (item.extraShot ? 1 : 0);
    return canonical(drink) === canonical(Object.assign({}, t, { shots }));
  }

  /* ===== 제조 순서 ===== */
  // 컵에 재료를 넣은 순서를 기록 (크레마 표시 + 순서 보너스 판정에 사용)
  function addStep(drink, key) {
    (drink.order || (drink.order = [])).push(key);
    if (FRESH_KEYS.includes(key)) stampFresh(drink);   // 신선도 시계 시작(첫 액체 추가 시)
  }

  /* ===== 신선도(spoilage) ===== 받아진 뜨거운 물·에스프레소·얼음·스팀우유는 시간이 지나면 신선도 하락 */
  const FRESH_KEYS = ['ice', 'water', 'espresso', 'milk', 'foam'];
  const FRESH_FULL = BAL.freshness.full, FRESH_DEAD = BAL.freshness.dead;   // 신선 유지 → 최저(초)
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
    const seen = new Set();   // 중복(샷 추가로 'espresso' 2번 등) 제거 — 첫 등장 순서로 판정
    const order = (drink.order || []).filter(k => seq.includes(k) && !seen.has(k) && seen.add(k));
    return order.length === seq.length && order.every((k, i) => k === seq[i]);
  }

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
      const m = WORLD.makePitcherMesh(h.rawMilk || h.milk ? 1 : 0, h.foam ? 1 : 0);
      m.scale.setScalar(1.3);
      Player.setHeld(m, equip);
    } else if (h.type === 'milkCarton') {
      const m = WORLD.makeMilkCartonMesh ? WORLD.makeMilkCartonMesh(h) : WORLD.makeSupplyMesh('milk');
      m.scale.setScalar(1.25);
      Player.setHeld(m, equip);
    } else if (h.type === 'deliveryBox') {
      const m = WORLD.makeBoxMesh(h.kind);
      m.scale.setScalar(1.35);
      Player.setHeld(m, equip);
    }
    syncPitchers();
    clearItemPlacePreview();
    UI.held();
  }
  function drinkIngredients(d) {
    const out = [];
    out.push(d.cup === 'ice' ? '아이스컵' : d.cup === 'espresso' ? '에스프레소 잔' : '머그컵');
    if (d.ice) out.push('얼음');
    if (d.espresso) out.push((d.shots || 1) >= 2 ? '샷 ×2' : '샷');
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
    if (h.type === 'pitcher') return Pitchers.label(h);
    if (h.type === 'milkCarton') return h.crumpled ? '구겨진 우유곽' : h.spoiled ? '상한 우유' : `우유 카톤 (${h.servings ?? 3}/3)`;
    if (h.type === 'deliveryBox') return `${supplyNames[h.kind]} 택배박스 x${h.amount}`;
    return DESSERTS[h.kind].name;
  }

  // 내려놓기 충돌 반경 — 실측 footprint(손잡이·주둥이 제외한 몸통) 기준으로 좁혀 서로 바짝 붙여 놓을 수 있게.
  function placedItemRadius(item) {
    if (!item) return 0.07;
    if (item.type === 'milkCarton') return item.crumpled ? 0.06 : 0.05;   // 몸통 ~0.04, 찌그러짐 ~0.053
    if (item.type === 'shotglass') return 0.055;                          // 잔 몸통 ~0.035 (나무 손잡이 제외)
    if (item.type === 'pitcher') return 0.075;                            // 컵 ~0.063 (손잡이 제외)
    if (item.type === 'drink') return 0.07;                               // 컵 몸통 ~0.05~0.056
    if (item.type === 'dessert') return 0.09;                             // 접시 ~0.085
    if (item.type === 'deliveryBox') return 0.2;                          // 박스 ~0.21
    return 0.07;                                                          // 포터필터 등
  }

  function placeBlocked(point, item = held) {
    const r = placedItemRadius(item);
    return placedItems.some(p => {
      const py = p.item && Number.isFinite(p.item.y) ? p.item.y : p.mesh.position.y;
      if (Math.abs(py - point.y) > 0.24) return false;
      const pr = placedItemRadius(p.item);
      const dx = p.mesh.position.x - point.x;
      const dz = p.mesh.position.z - point.z;
      return Math.hypot(dx, dz) < r + pr;
    });
  }

  function isSurfacePlaceableItem(item) {
    if (!item) return false;
    const legacySurfaceRule = item.type !== 'deliveryBox' && item.type !== 'supply';
    return item.type === 'deliveryBox' || legacySurfaceRule;
  }

  function fitPlacedSpecToSurface(spec) {
    if (!spec || !spec.mesh) return spec;
    spec.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(spec.mesh);
    if (box.isEmpty() || !Number.isFinite(box.min.y) || !Number.isFinite(box.max.y)) return spec;
    const size = box.getSize(new THREE.Vector3());
    spec.yOff = 0.004 - box.min.y;
    spec.hb = {
      w: Math.max(spec.hb.w, size.x + 0.04),
      h: Math.max(spec.hb.h, size.y + 0.04),
      d: Math.max(spec.hb.d, size.z + 0.04),
      y: 0.004 + size.y / 2,
    };
    return spec;
  }

  function makePlacedItemMesh(item) {
    let mesh, yOff = 0.004, hb = { w: 0.24, h: 0.3, d: 0.24, y: 0.15 };
    if (item.type === 'drink') mesh = WORLD.makeDrinkMesh(item.drink);
    else if (item.type === 'dessert') mesh = WORLD.makeDessertMesh(item.kind);
    else if (item.type === 'shotglass') mesh = WORLD.makeDrinkMesh({ cup: 'shot', espresso: item.filled ? 1 : 0, perfect: item.perfect });
    else if (item.type === 'pitcher') mesh = WORLD.makePitcherMesh(item.rawMilk || item.milk ? 1 : 0, item.foam ? 1 : 0);
    else if (item.type === 'deliveryBox') {
      mesh = WORLD.makeBoxMesh(item.kind);
      hb = { w: 0.48, h: 0.34, d: 0.38, y: 0.17 };
    }
    else if (item.type === 'milkCarton') {
      mesh = WORLD.makeMilkCartonMesh(item);
      hb = item.crumpled ? { w: 0.2, h: 0.16, d: 0.2, y: 0.08 } : { w: 0.18, h: 0.34, d: 0.18, y: 0.17 };
    } else {
      mesh = WORLD.makePortafilterMesh(item.state || 'empty');
      yOff = 0.03;
    }
    return fitPlacedSpecToSurface({ mesh, yOff, hb });
  }

  function itemPlacePreviewKeyFor(item) {
    if (!item) return '';
    if (item.type === 'drink') return `drink:${item.drink.cup}:${!!item.drink.espresso}:${!!item.drink.milk}:${!!item.drink.foam}`;
    if (item.type === 'shotglass') return `shotglass:${!!item.filled}:${!!item.perfect}`;
    if (item.type === 'pitcher') return `pitcher:${!!item.rawMilk}:${!!item.milk}:${!!item.foam}`;
    if (item.type === 'milkCarton') return `milkCarton:${item.servings ?? 3}:${!!item.crumpled}:${!!item.spoiled}`;
    if (item.type === 'deliveryBox') return `deliveryBox:${item.kind}:${item.amount}:${item.id}`;
    if (item.type === 'dessert') return `dessert:${item.kind}`;
    if (item.type === 'portafilter') return `portafilter:${item.state || 'empty'}`;
    return item.type;
  }

  function ghostMat(ok = true) {
    return new THREE.MeshBasicMaterial({
      color: ok ? 0x66d9a8 : 0xff7466,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
  }

  function ghostPlacedMesh(root, ok = true) {
    const mat = ghostMat(ok);
    root.traverse(o => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(() => mat.clone()) : mat.clone();
      o.castShadow = false;
      o.receiveShadow = false;
      o.renderOrder = 5;
    });
    return root;
  }

  function clearItemPlacePreview() {
    if (itemPlacePreview) scene.remove(itemPlacePreview.mesh);
    itemPlacePreview = null;
    itemPlacePreviewKey = null;
  }

  function updateItemPlacePreview(item, point, ok = true) {
    if (!isSurfacePlaceableItem(item) || !point) {
      clearItemPlacePreview();
      return null;
    }
    const key = itemPlacePreviewKeyFor(item);
    if (!itemPlacePreview || itemPlacePreviewKey !== key) {
      clearItemPlacePreview();
      const spec = makePlacedItemMesh(item);
      itemPlacePreview = spec;
      itemPlacePreview.mesh = ghostPlacedMesh(spec.mesh, ok);
      itemPlacePreviewKey = key;
      scene.add(itemPlacePreview.mesh);
    }
    itemPlacePreview.mesh.position.set(point.x, point.y + itemPlacePreview.yOff, point.z);
    const previewRot = Number.isFinite(point.rot) ? point.rot : itemPlaceRot;
    itemPlacePreview.mesh.rotation.y = itemPlaceRot;
    if (previewRot !== itemPlaceRot) itemPlacePreview.mesh.rotation.y = previewRot;
    itemPlacePreview.mesh.visible = true;
    return itemPlacePreview;
  }

  function rotateHeldItemPreview() {
    if (!isSurfacePlaceableItem(held)) return false;
    const pt = Player.aimSurface();
    if (!pt) return false;
    itemPlaceRot = (itemPlaceRot + Math.PI / 2) % (Math.PI * 2);
    updateItemPlacePreview(held, pt, !placeBlocked(pt, held));
    return true;
  }

  function returnPitcherToCounter(pitcher) {
    if (!pitcher || pitcher.type !== 'pitcher' || !pitcher.id) return false;
    Pitchers.ensureState(S);
    if (S.pitchers.items.some(p => p.id === pitcher.id)) return false;
    const res = Pitchers.placePitcher(S, pitcher);
    return !!res.ok;
  }

  function deliveryPlacePreview() {
    if (!held || held.type !== 'deliveryBox') {
      if (env && env.setDeliveryPreview) env.setDeliveryPreview(null);
      return null;
    }
    const surface = Player.aimSurface && Player.aimSurface();
    if (surface && isSurfacePlaceableItem(held)) {
      if (env.setDeliveryPreview) env.setDeliveryPreview(null);
      return null;
    }
    const pt = Player.aimGround && Player.aimGround();
    if (!pt) {
      if (env.setDeliveryPreview) env.setDeliveryPreview(null);
      return null;
    }
    const ok = !env.canPlaceDeliveryBox || env.canPlaceDeliveryBox(pt, held.id);
    const spec = { x: pt.x, z: pt.z, rot: deliveryPlaceRot, kind: held.kind, ok };
    if (env.setDeliveryPreview) env.setDeliveryPreview(spec);
    return spec;
  }

  function moveHeldDeliveryBox() {
    if (!held || held.type !== 'deliveryBox') return false;
    const spec = deliveryPlacePreview();
    if (!spec) { toast('바닥을 바라보면 박스를 내려놓을 수 있어요'); return true; }
    if (!spec.ok) { toast('여기엔 박스를 놓을 공간이 없어요', 'bad'); AudioFX.err(); return true; }
    const res = Logistics.moveDeliveryBox(S, held.id, spec);
    if (res.ok) delete res.box.surfacePlaced;
    if (!res.ok) { toast('박스 위치를 찾지 못했어요', 'bad'); AudioFX.err(); setHeld(null); renderDeliveryBoxes(); return true; }
    setHeld(null);
    if (env.setDeliveryPreview) env.setDeliveryPreview(null);
    renderDeliveryBoxes();
    save();
    AudioFX.put();
    toast(`${supplyNames[res.box.kind]} 박스를 내려놓았어요`, 'good');
    return true;
  }

  function rotateDeliveryBoxPreview() {
    if (!held || held.type !== 'deliveryBox') return false;
    deliveryPlaceRot = (deliveryPlaceRot + Math.PI / 2) % (Math.PI * 2);
    held.rot = deliveryPlaceRot;
    deliveryPlacePreview();
    return true;
  }

  function shelfPointForIndex(index) {
    const levels = [0.61, 1.17, 1.73];
    const racks = [-4.32, -3.22, -2.12, -1.02];
    const i = Math.max(0, Number(index) || 0);
    return {
      x: -8.7 + ((i % 3) - 1) * 0.18,
      y: levels[Math.floor(i / 12) % levels.length],
      z: racks[Math.floor(i / 3) % racks.length] + ((Math.floor(i / 36) % 2) - 0.5) * 0.18,
      rot: Math.PI / 2,
    };
  }

  function fridgePointForIndex(index) {
    const levels = [0.18, 0.58];
    const xs = [-5.14, -4.8, -4.46];
    const i = Math.max(0, Number(index) || 0);
    return {
      x: xs[i % xs.length],
      y: levels[Math.floor(i / xs.length) % levels.length],
      z: -1.18,
      rot: Math.PI,
      fridgeSurface: true,
    };
  }

  function seedLooseMilkCartons() {
    Pitchers.ensureMilkState(S);
    let n = 0;
    (S.milkCartons || []).forEach(c => {
      if (!c || c.crumpled || c.location === 'held' || c.location === 'fridge') return;
      if (c.location === 'storage' || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) {
        const p = shelfPointForIndex(n++);
        c.location = 'placed';
        c.slotId = null;
        c.x = p.x; c.y = p.y; c.z = p.z; c.rot = p.rot;
      }
    });
    Pitchers.ensureMilkState(S);
  }

  function placeLooseItem(item, point, opts = {}) {
    if (!isSurfacePlaceableItem(item) || !point) return false;
    const rot = Number.isFinite(opts.rotationY) ? opts.rotationY : Number.isFinite(point.rot) ? point.rot : itemPlaceRot;
    if (item.type === 'milkCarton') {
      item.location = point.fridgeSurface ? 'fridge' : 'placed';
      item.slotId = null;
      item.cold = !!point.fridgeSurface;
      if (point.fridgeSurface) item.outsideDays = 0;
      item.x = point.x;
      item.y = point.y;
      item.z = point.z;
      item.rot = rot;
      Pitchers.ensureMilkState(S);
    }
    if (item.type === 'deliveryBox') {
      const box = S.deliveryBoxes.find(b => b.id === item.id);
      if (box) {
        box.surfacePlaced = true;
        box.x = point.x;
        box.z = point.z;
        box.rot = rot;
        box.autoSpot = false;
      }
      item.rot = rot;
    }
    const spec = makePlacedItemMesh(item);
    const mesh = spec.mesh;
    mesh.position.set(point.x, point.y + spec.yOff, point.z);
    mesh.rotation.y = rot;
    scene.add(mesh);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(spec.hb.w, spec.hb.h, spec.hb.d),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hb.position.set(point.x, point.y + spec.hb.y, point.z);
    hb.rotation.y = rot;
    hb.castShadow = hb.receiveShadow = false;
    const rec = { item, mesh, hb };
    hb.userData.interact = { id: 'placedItem', rec };
    hb.userData.outlineRoot = mesh;
    scene.add(hb);
    mesh.updateMatrixWorld(true);
    hb.updateMatrixWorld(true);
    env.interactables.push(hb);
    placedItems.push(rec);
    if (!opts.keepPreview) clearItemPlacePreview();
    if (!opts.keepHeld && held === item) setHeld(null);
    if (item.type === 'milkCarton') syncMilkFridgeMilk(true);
    if (item.type === 'deliveryBox') renderDeliveryBoxes();
    if (!opts.silent) {
      UI.hud();
      if (item.type === 'milkCarton') save();
      if (item.type === 'drink' || item.type === 'shotglass' || item.type === 'pitcher') AudioFX.cupClink(0.4); else AudioFX.put();
    }
    return true;
  }

  function restoreLooseMilkCartons() {
    Pitchers.ensureMilkState(S);
    let fridgeIndex = 0;
    (S.milkCartons || []).forEach((carton, i) => {
      if (!carton || carton.crumpled || (carton.location !== 'placed' && carton.location !== 'fridge')) return;
      if (placedItems.some(rec => rec.item && rec.item.id === carton.id)) return;
      const point = Number.isFinite(carton.x) && Number.isFinite(carton.y) && Number.isFinite(carton.z)
        ? { x: carton.x, y: carton.y, z: carton.z, rot: Number.isFinite(carton.rot) ? carton.rot : (carton.location === 'fridge' ? Math.PI : Math.PI / 2), fridgeSurface: carton.location === 'fridge' }
        : carton.location === 'fridge'
          ? fridgePointForIndex(fridgeIndex++)
          : shelfPointForIndex(i);
      placeLooseItem(carton, point, { silent: true });
    });
  }

  function placeItem(point, opts = {}) {
    const item = held;
    if (!isSurfacePlaceableItem(item)) {
      toast('여기에 내려놓을 수 없어요');
      return false;
    }
    return placeLooseItem(item, point, opts);
  }

  function removePlaced(rec) {
    scene.remove(rec.mesh);
    scene.remove(rec.hb);
    const i = env.interactables.indexOf(rec.hb);
    if (i >= 0) env.interactables.splice(i, 1);
    const j = placedItems.indexOf(rec);
    if (j >= 0) placedItems.splice(j, 1);
  }

  function isPrepPlacedTool(item) {
    return item && (item.type === 'milkCarton' || item.type === 'shotglass' || item.type === 'pitcher' || item.type === 'drink');
  }

  function clearPlacedItems(opts = {}) {
    for (let i = placedItems.length - 1; i >= 0; i--) {
      const rec = placedItems[i];
      if (opts.keepPrepTools && isPrepPlacedTool(rec.item)) continue;
      if (rec.item && rec.item.type === 'deliveryBox') {
        const box = S.deliveryBoxes.find(b => b.id === rec.item.id);
        if (box) delete box.surfacePlaced;
      }
      returnPitcherToCounter(rec.item);
      removePlaced(rec);
    }
    renderDeliveryBoxes();
    syncPitchers();
  }

  // 슬롯/표면에서 손으로 되돌릴 때: 샷잔(cup:'shot')은 도구 타입으로, 일반 컵은 음료로 환원
  function vesselToHand(drink) {
    return drink.cup === 'shot'
      ? { type: 'shotglass', filled: !!drink.espresso, perfect: !!drink.perfect, grindPerfect: !!drink.grindPerfect, grindQ: drink.grindQ, freshAt: drink.freshAt }
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

  function refreshPlacedPitcher(rec) {
    const pos = rec.mesh.position.clone(), roty = rec.mesh.rotation.y;
    scene.remove(rec.mesh);
    const m = WORLD.makePitcherMesh(rec.item.rawMilk || rec.item.milk ? 1 : 0, rec.item.foam ? 1 : 0);
    m.position.copy(pos); m.rotation.y = roty;
    scene.add(m);
    rec.mesh = m;
    rec.hb.userData.outlineRoot = m;
  }

  function refreshPlacedMilkCarton(rec) {
    const pos = rec.mesh.position.clone(), roty = rec.mesh.rotation.y;
    scene.remove(rec.mesh);
    const m = WORLD.makeMilkCartonMesh(rec.item);
    m.position.copy(pos); m.rotation.y = roty;
    scene.add(m);
    rec.mesh = m;
    rec.hb.userData.outlineRoot = m;
  }

  function interactPlacedItem(it) {
    const rec = it.rec;
    if (!rec) return;
    if (held && held.type === 'milkCarton') {
      if (rec.item.type === 'drink' && rec.item.drink.cup !== 'shot') {   // 우유곽을 컵에 바로 붓기
        pourCartonIntoDrink(rec.item.drink, () => refreshPlacedDrink(rec));
        return;
      }
      if (rec.item.type !== 'pitcher') { toast('우유는 피처나 컵에 부을 수 있어요', 'bad'); AudioFX.err(); return; }
      const res = Pitchers.pourCartonIntoPitcher(rec.item, held);
      if (!res.ok) { toast(res.reason === 'carton_spoiled' ? '상한 우유라 부을 수 없어요' : res.reason === 'carton_empty' ? '구겨진 우유곽이라 부을 수 없어요' : '피처에 이미 내용물이 있어요', 'bad'); AudioFX.err(); return; }
      setHeld(res.carton || held);
      refreshPlacedPitcher(rec);
      AudioFX.pourWater(0.45);
      toast(held.crumpled ? '우유를 다 써서 구겨진 우유곽만 남았어요' : `피처에 차가운 우유를 부었어요 (${held.servings}/3 남음)`);
      return;
    }
    if (held && held.type === 'pitcher' && rec.item.type === 'milkCarton') {
      const res = Pitchers.pourCartonIntoPitcher(held, rec.item);
      if (!res.ok) { toast(res.reason === 'carton_spoiled' ? '상한 우유라 부을 수 없어요' : res.reason === 'carton_empty' ? '구겨진 우유곽이라 부을 수 없어요' : '피처에 이미 내용물이 있어요', 'bad'); AudioFX.err(); return; }
      refreshPlacedMilkCarton(rec);
      setHeld(held);
      AudioFX.pourWater(0.45);
      toast(rec.item.crumpled ? '우유를 다 써서 구겨진 우유곽만 남았어요' : `피처에 차가운 우유를 부었어요 (${rec.item.servings}/3 남음)`);
      return;
    }
    if (held && (held.type === 'shotglass' || held.type === 'pitcher')) {
      if (rec.item.type !== 'drink' || rec.item.drink.cup === 'shot') { toast('컵에만 부을 수 있어요', 'bad'); AudioFX.err(); return; }
      pourHeldInto(rec.item.drink, () => refreshPlacedDrink(rec));
      return;
    }
    if (held) { toast('손이 비어있어야 집을 수 있어요'); return; }
    removePlaced(rec);
    if (rec.item.type === 'deliveryBox') {
      const box = S.deliveryBoxes.find(b => b.id === rec.item.id);
      if (box) delete box.surfacePlaced;
    }
    if (rec.item.type === 'milkCarton') {
      rec.item.location = 'held';
      rec.item.slotId = null;
      Pitchers.ensureMilkState(S);
      renderStorageBoxes();
      syncMilkFridgeMilk(true);
      save();
    }
    setHeld(rec.item);
    if (rec.item.type === 'deliveryBox') renderDeliveryBoxes();
    if (rec.item.type === 'drink' || rec.item.type === 'shotglass' || rec.item.type === 'pitcher') AudioFX.cupClink(0.4); else AudioFX.pick();
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
    const emptyPitcher = Object.assign({}, h, { rawMilk: 0, milk: 0, foam: 0, perfectFoam: false });
    delete emptyPitcher.freshAt;
    setHeld(emptyPitcher);  // 피처 비움(재사용)
    AudioFX.pourWater(0.5);
    if (artTier === 'perfect') toast('🎨 멋진 라떼아트! 팁 보너스 ✨', 'gold', 2200);
    else if (artTier === 'good') toast('🎨 라떼아트 완성 — 제법인데요 🥛', 'good');
    else if (h.rawMilk && !h.milk && !h.foam) toast('차가운 우유를 부었어요 🥛');
    else toast(h.foam ? '우유와 거품을 부었어요 🥛' : '데운 우유를 부었어요 🥛');
  }
  // 우유곽을 컵(drink)에 직접 부어 찬 우유 1회분을 더한다 (피처를 거치지 않음). held는 우유곽.
  function pourCartonIntoDrink(drink, refresh) {
    if (held.spoiled) { toast('상한 우유라 부을 수 없어요', 'bad'); AudioFX.err(); return; }
    if (held.crumpled || (held.servings ?? 0) <= 0) { toast('구겨진 우유곽이라 부을 수 없어요', 'bad'); AudioFX.err(); return; }
    if (drink.milk) { toast('이미 우유가 들어 있는 컵이에요'); return; }
    drink.milk = 1; addStep(drink, 'milk');
    held.servings = Math.max(0, (held.servings ?? 3) - 1);   // 우유곽 1회 소비
    held.crumpled = held.servings <= 0;
    refresh();
    setHeld(held);                       // 우유곽 메시 갱신(소진 시 찌그러진 모델)
    Pitchers.ensureMilkState(S); syncMilkFridgeMilk(true); save();
    AudioFX.pourWater(0.5);
    toast(held.crumpled ? '우유를 다 부어서 우유곽이 비었어요 🥛' : `차가운 우유를 부었어요 (${held.servings}/3 남음) 🥛`);
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
      if ((drink.shots || 0) >= 2) { toast('샷은 최대 2잔까지예요'); return; }
      drink.espresso = 1; drink.shots = (drink.shots || 0) + 1; addStep(drink, 'espresso'); drink.perfect = !!held.perfect; drink.grindPerfect = !!held.grindPerfect; drink.grindQ = held.grindQ;
      carryFresh(drink, held);   // 샷잔이 오래됐으면 컵도 그만큼 상함
      refresh();
      setHeld({ type: 'shotglass', filled: false, perfect: false });
      AudioFX.pourWater(0.5); toast('샷을 부었어요 ☕');
      return;
    }
    // pitcher — 차가운 우유/스팀 우유/거품 모두 부을 수 있다(canPourToDrink). 비어 있을 때만 차단.
    if (!Pitchers.canPourToDrink(held)) {
      toast('피처가 비어 있어요 — 냉장고 우유를 붓고 오세요', 'bad');
      AudioFX.err();
      return;
    }
    if (drink.milk) { toast('이미 우유가 들어 있는 컵이에요'); return; }
    const h = Object.assign({}, held);
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
    if (RECIPES[recipeId].target.espresso && Math.random() < BAL.order.extraShotChance) {   // 에스프레소 음료에 가끔 '샷 추가'
      items[0].extraShot = true;
      total += BAL.order.extraShotPrice;
    }
    const dPool = unlockedDesserts();
    if (dPool.length && Math.random() < BAL.order.dessertChance) {
      const kind = dPool[(Math.random() * dPool.length) | 0];
      items.push({ type: 'dessert', kind, done: false });
      total += DESSERTS[kind].price;
    }
    return { num: ++orderSeq, customer, items, total };
  }

  function itemName(it) {
    if (it.type !== 'drink') return DESSERTS[it.kind].name;
    return RECIPES[it.recipeId].name + (it.extraShot ? ' + 샷 추가' : '');
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

  /* ===== POS 주문 입력 (모니터 확대 → 메뉴 직접 선택) ===== */
  // 손님이 대기열 맨 앞에 서면 주문을 '말한다'(음성). 이후 플레이어가 POS에서 직접 입력한다.
  function updatePendingOrders() {
    const c = Customers.frontCustomer();
    if (c && !c.pendingOrder) {
      c.pendingOrder = generateOrder(c);
      speakOrder(c.pendingOrder.items);   // 손님이 영어로 주문을 말함
    }
  }
  // 손님이 말한 주문을 화면에 적어줄 문구(음성과 동일한 영어 메뉴명)
  function posSayText(order) {
    return order.items.map(it => {
      const n = englishItemName(it);
      return it.type === 'drink' && it.extraShot ? `${n} (extra shot)` : n;
    }).join(' + ');
  }
  // 주문/선택을 정규화한 서명 — 순서 무관 비교용
  function orderSig(items) {
    return items.map(it => it.type === 'drink'
      ? `d:${it.recipeId}${it.extraShot ? '+shot' : ''}`
      : `s:${it.kind}`).sort().join('|');
  }
  function posCartTotal() {
    let total = 0;
    posCart.forEach(it => {
      if (it.type === 'drink') total += drinkPrice(it.recipeId) + (it.extraShot ? BAL.order.extraShotPrice : 0);
      else total += DESSERTS[it.kind].price;
    });
    return total;
  }
  function renderPosMenu() {
    let html = '<div class="posSec">☕ 음료</div><div class="posGrid">';
    unlockedRecipes().forEach(k => {
      html += `<button class="posTile" data-kind="drink" data-id="${k}">` +
        `<span class="ptName">${RECIPES[k].name}</span>` +
        `<span class="ptPrice">${fmt(drinkPrice(k))}</span></button>`;
    });
    html += '</div>';
    const desserts = unlockedDesserts();
    if (desserts.length) {
      html += '<div class="posSec">🍰 디저트</div><div class="posGrid">';
      desserts.forEach(k => {
        html += `<button class="posTile" data-kind="dessert" data-id="${k}">` +
          `<span class="ptName">${DESSERTS[k].name}</span>` +
          `<span class="ptPrice">${fmt(DESSERTS[k].price)}</span></button>`;
      });
      html += '</div>';
    }
    const wrap = $('posMenu');
    wrap.innerHTML = html;
    wrap.querySelectorAll('.posTile').forEach(b =>
      b.onclick = () => addPosItem(b.dataset.kind, b.dataset.id));
  }
  function addPosItem(kind, id) {
    if (kind === 'drink') posCart.push({ type: 'drink', recipeId: id, extraShot: false });
    else posCart.push({ type: 'dessert', kind: id });
    AudioFX.pick();
    renderPosCart();
  }
  function renderPosCart() {
    const el = $('posCart');
    if (!posCart.length) {
      el.innerHTML = '<div class="posEmpty">메뉴를 눌러<br>손님 주문을 입력하세요</div>';
    } else {
      el.innerHTML = posCart.map((it, i) => {
        if (it.type === 'drink') {
          const esp = !!RECIPES[it.recipeId].target.espresso;
          const shot = esp ? `<button class="posShot ${it.extraShot ? 'on' : ''}" data-i="${i}">+ 샷</button>` : '';
          return `<div class="posLine"><span>${RECIPES[it.recipeId].name}${it.extraShot ? ' +샷' : ''}</span>` +
            `<span class="posLineR">${shot}<button class="posDel" data-i="${i}">✕</button></span></div>`;
        }
        return `<div class="posLine"><span>${DESSERTS[it.kind].name}</span>` +
          `<span class="posLineR"><button class="posDel" data-i="${i}">✕</button></span></div>`;
      }).join('');
      el.querySelectorAll('.posDel').forEach(b =>
        b.onclick = () => { posCart.splice(+b.dataset.i, 1); renderPosCart(); });
      el.querySelectorAll('.posShot').forEach(b =>
        b.onclick = () => { const it = posCart[+b.dataset.i]; it.extraShot = !it.extraShot; AudioFX.pick(); renderPosCart(); });
    }
    $('posTotal').innerHTML = `합계 <b>${fmt(posCartTotal())}</b>`;
  }
  function openPos(c) {
    posCustomer = c;
    posCart = [];
    posOpen = true;
    $('posOrderNo').textContent = `#${c.pendingOrder.num}`;
    $('posSayText').textContent = `"${posSayText(c.pendingOrder)}"`;
    renderPosMenu();
    renderPosCart();
    $('posScreen').classList.remove('hidden');
    Player.enabled = false;
    useDown = false;
    // 주문 음성은 손님이 맨 앞에 설 때 이미 말함 — 여기선 '🔊 다시 듣기' 버튼으로 재생
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }
  function closePos(relock = true) {
    posOpen = false;
    posCustomer = null;
    posCart = [];
    $('posScreen').classList.add('hidden');
    if (relock) {   // 다시 1인칭 조작으로 (포인터 락 복귀)
      const cv = $('c');
      if (cv && cv.requestPointerLock) cv.requestPointerLock();
    }
  }
  function confirmPos() {
    if (!posOpen || !posCustomer) return;
    if (!posCart.length) { toast('메뉴를 선택하세요', 'bad'); AudioFX.err(); return; }
    const c = posCustomer;
    // 손님이 말한 주문과 선택한 메뉴가 일치해야 접수된다
    if (orderSig(posCart) !== orderSig(c.pendingOrder.items)) {
      const mon = $('posMonitor');
      mon.classList.remove('shake'); void mon.offsetWidth; mon.classList.add('shake');
      toast('주문이 손님 요청과 달라요 — 다시 확인하세요', 'bad');
      AudioFX.err();
      return;
    }
    // 일치 → 접수 (실제 주문은 손님이 말한 pendingOrder를 그대로 사용)
    const order = c.pendingOrder;
    c.pendingOrder = null;
    orders.push(order);
    Customers.takeOrder(c, order);
    UI.addTicket(order);
    AudioFX.cash();
    toast(`주문 #${order.num} 접수 — ${order.items.map(itemName).join(', ')}`, 'gold');
    closePos();
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
  function putHeldMilkInFridge() {
    if (!held || held.type !== 'milkCarton') return false;
    if (!milkFridgeOpen) { toast('냉장고를 먼저 열어주세요', 'bad'); AudioFX.err(); return true; }
    const fridgePt = Player.aimSurface && Player.aimSurface();
    if (fridgePt && fridgePt.fridgeSurface && !placeBlocked(fridgePt, held)) {
      placeItem(fridgePt);
      return true;
    }
    toast('냉장고 안쪽 선반을 보고 내려놓으세요', 'bad');
    AudioFX.err();
    return true;
    /*
    const res = Pitchers.putMilkInFridge(S, held);
    if (!res.ok) {
      const msg = res.reason === 'spoiled' ? '상한 우유는 냉장고에 넣어도 쓸 수 없어요'
        : res.reason === 'empty_carton' ? '빈 우유곽은 냉장고에 넣을 필요가 없어요'
        : '우유를 냉장고에 넣을 수 없어요';
      toast(msg, 'bad'); AudioFX.err();
      return true;
    }
    setHeld(null);
    renderStorageBoxes();
    syncMilkFridgeMilk(true);
    UI.hud();
    save();
    AudioFX.put();
    toast('우유를 냉장고에 넣었어요', 'good');
    return true;
    */
  }

  function patienceForNew() {
    let p = BAL.patience.base - S.day * BAL.patience.dayStep;
    if (S.upgrades.interior) p *= BAL.patience.interiorBonus;
    return Math.max(BAL.patience.floor, p);
  }

  function interact(it) {
    if (!it) return;
    const id = it.id;
    // 출입문 여닫기 — 밖으로 나가거나 들어올 때(준비·영업 모두 가능)
    if (id === 'door') {
      if (env.door) { env.door.toggle(); AudioFX.bell(); toast(env.door.open ? '🚪 문을 열었어요' : '🚪 문을 닫았어요'); }
      return;
    }

    if (id === 'deliveryBox') {
      if (held) { toast('손이 비어있어야 택배박스를 들 수 있어요'); return; }
      const box = S.deliveryBoxes.find(b => b.id === it.boxId);
      if (!box) { renderDeliveryBoxes(); return; }
      deliveryPlaceRot = typeof box.rot === 'number' ? box.rot : 0;
      setHeld({ type: 'deliveryBox', id: box.id, kind: box.kind, amount: box.amount, rot: deliveryPlaceRot });
      renderDeliveryBoxes();
      AudioFX.pick();
      return;
    }

    if (id === 'milkFridgeDoor' || id === 'milkFridge') {
      if (held && held.type === 'milkCarton') { putHeldMilkInFridge(); return; }
      if (held) { toast('손을 비우면 냉장고를 열 수 있어요'); return; }
      milkFridgeOpen = !milkFridgeOpen;
      if (env.setMilkFridgeOpen) env.setMilkFridgeOpen(milkFridgeOpen);
      AudioFX.metalClack();
      toast(milkFridgeOpen ? '우유 냉장고를 열었어요' : '우유 냉장고를 닫았어요');
      return;
    }

    if (id === 'milkFridgeMilk') {
      if (held && held.type === 'milkCarton') { putHeldMilkInFridge(); return; }
      if (held) { toast('손을 비우면 우유를 집을 수 있어요'); return; }
      const res = Pitchers.takeMilkCarton(S);
      if (!res.ok) { toast('냉장고 우유가 없어요 — 창고에서 보충하세요', 'bad'); AudioFX.err(); return; }
      syncMilkFridgeMilk(true);
      setHeld(res.carton);
      AudioFX.pick();
      UI.hud();
      save();
      return;
    }

    if (id === 'pitcherSpot') {
      if (held && held.type === 'milkCarton') {
        const p = S.pitchers.items.find(x => x.id === it.pitcherId);
        if (!p) { syncPitchers(); return; }
        const target = Object.assign({ type: 'pitcher' }, p);
        const res = Pitchers.pourCartonIntoPitcher(target, held);
        if (!res.ok) { toast(res.reason === 'carton_spoiled' ? '상한 우유라 부을 수 없어요' : res.reason === 'carton_empty' ? '구겨진 우유곽이라 부을 수 없어요' : '이 피처에는 이미 내용물이 있어요', 'bad'); AudioFX.err(); return; }
        Object.assign(p, { rawMilk: target.rawMilk, milk: target.milk, foam: target.foam, perfectFoam: target.perfectFoam });
        setHeld(res.carton || held);
        syncPitchers();
        AudioFX.pourWater(0.45);
        toast(held.crumpled ? '우유를 다 써서 구겨진 우유곽만 남았어요' : `피처에 차가운 우유를 부었어요 (${held.servings}/3 남음)`);
        return;
      }
      if (held) { toast('손을 비우면 피처를 집을 수 있어요'); return; }
      const res = Pitchers.takePitcher(S, it.pitcherId);
      if (!res.ok) { syncPitchers(); return; }
      setHeld(res.pitcher);
      AudioFX.cupClink(0.45);
      return;
    }

    if (id === 'placedItem') {
      interactPlacedItem(it);
      return;
    }

    // 준비/영업후엔 물류·문·배치만, 제조·서빙은 영업 중에
    if (mode === 'prep' || mode === 'after') {
      toast(mode === 'prep' ? '영업을 시작하면 사용할 수 있어요 — 지금은 물류와 [B] 배치' : '영업후 정리 시간 — 주문·입고·보충을 마치고 다음날로 넘어가세요');
      return;
    }

    /* --- 주문 받기: POS 모니터를 열어 메뉴를 직접 선택 --- */
    if (id === 'register') {
      const c = Customers.frontCustomer();
      if (!c) { toast('주문할 손님이 없습니다'); return; }
      if (!c.pendingOrder) c.pendingOrder = generateOrder(c);   // 안전장치(아직 생성 전이면 즉석 생성)
      openPos(c);
      return;
    }

    /* --- 서빙 --- */
    if (id === 'pickup') { tryServe(); return; }

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
        shotAvail = Math.min(SHOT_MAX, shotAvail + 1); updateRackVisuals();   // 반납
        AudioFX.cupClink(0.4);
        return;
      }
      if (held) { toast('손이 비어있어야 샷잔을 집을 수 있어요'); return; }
      if (shotAvail <= 0) { toast(`샷잔이 모두 사용 중이에요 (최대 ${SHOT_MAX}개) — 다 쓴 샷잔을 거치대에 반납하세요`, 'bad'); AudioFX.err(); return; }
      shotAvail--; updateRackVisuals();
      setHeld({ type: 'shotglass', filled: false, perfect: false });
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
      if (slot.cupMesh && slot.drink.cup !== 'shot' && !(slot.busy && !slot.done) && held) {
        if (held.type === 'milkCarton') { pourCartonIntoDrink(slot.drink, () => refreshSlotCup(slot)); return; }
        if (held.type === 'shotglass' || held.type === 'pitcher') { pourHeldInto(slot.drink, () => refreshSlotCup(slot)); return; }
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
      if (slot.busy && !slot.done) { toast('추출 중입니다…'); return; }   // 추출 완료 후엔 컵을 안 빼도 포터필터 분리 가능
      if (held && held.type === 'portafilter') {
        if (slot.pfState !== 'none') { toast('이미 포터필터가 장착되어 있어요'); return; }
        slot.pfState = held.state || 'empty';
        slot.tampPerfect = !!held.tampPerfect;
        slot.tampSpeed = held.tampSpeed != null ? held.tampSpeed : 1;   // 탬핑 강도 단계 인계(추출 속도)
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
      setHeld({ type: 'portafilter', state, tampPerfect: slot.tampPerfect, tampSpeed: slot.tampSpeed, grind: slot.grind });
      slot.tampPerfect = false; slot.tampSpeed = 1; slot.grind = undefined; AudioFX.metalClack();
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
      // 분쇄도 + 탬핑 강도 → 추출 속도(시간)·줄기 비주얼
      const grind = (slot.grind == null) ? (GRIND_IDEAL_MIN + GRIND_IDEAL_MAX) / 2 : slot.grind;
      const idealGrind = grind >= GRIND_IDEAL_MIN && grind <= GRIND_IDEAL_MAX;
      slot.grindPerfect = idealGrind && slot.grind != null;
      slot.grindQ = grindQuality(grind);   // 빗나간 정도(1 이상 ~ 0 최악) — 만족도 비례 감점용
      const tampSpeed = slot.tampSpeed != null ? slot.tampSpeed : 1;   // 탬핑 강도 단계 배율(>1 느림 / <1 빠름)
      let speed = 1;   // 추출 시간 배율(>1 느림 / <1 빠름)
      if (grind < GRIND_IDEAL_MIN) speed *= 1 + (GRIND_IDEAL_MIN - grind) * BAL.grind.speedFine;        // 가늚: 과다(느림)
      else if (grind > GRIND_IDEAL_MAX) speed *= 1 - (grind - GRIND_IDEAL_MAX) * BAL.grind.speedCoarse; // 굵음: 부족(빠름)
      speed *= tampSpeed;                  // 강한 탬핑=느림(2단계) / 약한 탬핑=빠름(2단계)
      speed = Math.max(BAL.extract.speedFloor, speed);
      let dur = (S.upgrades.fastShot ? BAL.extract.fastDur : BAL.extract.baseDur) * speed;
      // 줄기 비주얼: 퍼펙트 탬핑이면 분쇄도 기준, 아니면 종합 속도(느림=뚝뚝/빠름=분사, 강도차 작으면 물총)
      slot.extractMode = slot.tampPerfect
        ? (idealGrind ? 'ideal' : grind < GRIND_IDEAL_MIN ? 'fine' : 'coarse')
        : (speed > 1.12 ? 'fine' : speed < 0.88 ? 'coarse' : 'channel');
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
      if (!held.rawMilk && !held.milk) { toast('피처가 비어 있어요 — 냉장고에서 우유를 붓고 오세요', 'bad'); AudioFX.err(); return; }
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
          if ((job.drink.shots || 0) >= 2) { toast('샷은 최대 2잔까지예요'); return; }
          job.drink.espresso = 1; job.drink.shots = (job.drink.shots || 0) + 1;
          addStep(job.drink, 'espresso');
          job.drink.perfect = !!held.perfect;
          job.drink.grindPerfect = !!held.grindPerfect;
          job.drink.grindQ = held.grindQ;
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
      if (!held || held.type !== 'portafilter') { toast('포터필터를 들고 오세요'); return; }
      if (!held.state || held.state === 'empty' || held.state === 'none') { toast('비울 가루가 없어요'); return; }
      held.state = 'empty';   // 담긴 원두는 상태 무관(분쇄·탬핑·사용)하고 모두 털어냄
      held.tampPerfect = false; held.tampSpeed = 1; held.grindPerfect = false; held.grindQ = undefined; held.grind = undefined;
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

  }

  /* ===== 서빙 ===== */

  function tryServe() {
    if (!held) { toast('서빙할 음료나 디저트를 들고 오세요'); return; }
    for (const o of orders) {
      if (o.customer.state !== 'waitDrink' && o.customer.state !== 'toPickup') continue;
      for (const item of o.items) {
        if (item.done) continue;
        let match = false, shotMismatch = false;
        if (held.type === 'drink' && item.type === 'drink') {
          if (matchesOrderItem(held.drink, item)) match = true;
          else if (matchesRecipe(held.drink, item.recipeId)) { match = true; shotMismatch = true; }   // 종류는 맞고 샷 수만 다름 → 서빙은 되되 평판 페널티
        }
        if (held.type === 'dessert' && item.type === 'dessert') match = held.kind === item.kind;
        if (!match) continue;
        // 서빙 성공
        if (held.type === 'drink') { held.drink.orderOk = !shotMismatch && correctOrder(held.drink, item.recipeId); held.drink.shotMismatch = shotMismatch; }
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

  // 분쇄도 품질: 이상 구간이면 1, 멀어질수록 0으로 (만족도 비례 감점)
  function grindQuality(grind) {
    if (grind == null) return 1;
    if (grind >= GRIND_IDEAL_MIN && grind <= GRIND_IDEAL_MAX) return 1;
    const d = grind < GRIND_IDEAL_MIN ? GRIND_IDEAL_MIN - grind : grind - GRIND_IDEAL_MAX;
    return Math.max(0, 1 - d / BAL.grind.qualityFalloff);   // 이상에서 이만큼 벗어나면 0
  }
  function completeOrder(o, servedDrink) {
    const c = o.customer;
    const frac = Math.max(0, c.patience / c.patienceMax);
    const masterBonus = S.level >= MAX_LVL ? BAL.tip.masterBonus : 1;   // 마스터 바리스타 팁 보너스
    let tip = Math.floor(o.total * BAL.tip.base * frac * (0.7 + S.rep / BAL.tip.repCoef) * masterBonus / 100) * 100;
    // 퍼펙트 탬핑 보너스 — 음료에 크레마가 살아 팁 보너스
    const perfect = !!(servedDrink && servedDrink.perfect);
    if (perfect) tip += Math.round(o.total * BAL.tip.perfect / 100) * 100;
    // 정확한 제조 순서 보너스 — 팁 + 평판
    const orderOk = !!(servedDrink && servedDrink.orderOk);
    if (orderOk) tip += Math.round(o.total * BAL.tip.order / 100) * 100;
    // 퍼펙트 마이크로폼(스팀 미니게임) 보너스 — 팁
    const foamPerfect = !!(servedDrink && servedDrink.foamPerfect);
    if (foamPerfect) tip += Math.round(o.total * BAL.tip.foam / 100) * 100;
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
      if (!perfect) extractQ -= BAL.extract.channelPenalty;   // 물총(채널링) — 고르지 않은 추출
      const grindQ = servedDrink.grindQ == null ? 1 : servedDrink.grindQ;
      extractQ -= (1 - grindQ) * BAL.extract.grindPenalty;    // 분쇄도 빗나간 정도에 비례
    }
    if (extractQ < 1) tip = Math.round(tip * extractQ / 100) * 100;
    // 신선도: 오래된 음료는 팁/평판 감소 (30초까지 신선 → 90초 최저)
    const fresh = freshness01(servedDrink);
    if (fresh < 1) tip = Math.round(tip * (0.4 + 0.6 * fresh) / 100) * 100;   // 상해도 최소 40%
    const shotMismatch = !!(servedDrink && servedDrink.shotMismatch);   // 주문과 샷 수가 다름(실수로 1↔2샷)
    if (shotMismatch) tip = Math.round(tip * BAL.tip.shotMismatch / 100) * 100;   // 팁 대폭 감소
    S.money += o.total + tip;
    dayStats.revenue += o.total;
    dayStats.tips += tip;
    dayStats.served++;
    // === 종합 만족도(0~1) — 표정과 평판을 같은 기준으로 ===
    // 추출 컨디션 × 신선도 기반, 샷 불일치·대기 시간 반영
    const SAT = BAL.satisfaction;
    let sat = extractQ * (SAT.freshBase + (1 - SAT.freshBase) * fresh);
    if (shotMismatch) sat -= SAT.shotMismatch;   // 주문과 샷 수가 다름 — 큰 불만
    if (frac < SAT.waitFrac) sat -= SAT.waitPenalty;       // 거의 다 기다리게 함
    else if (frac > SAT.fastFrac) sat += SAT.fastBonus;    // 빠른 응대 — 약간 가산
    sat = Math.max(0, Math.min(1, sat));
    const mood = sat >= SAT.moodGreat ? 'great' : sat >= SAT.moodOk ? 'ok' : 'bad';
    // 평판: 만족도와 같은 방향(만족=+, 보통=+, 불만=−) + 정확 순서·라떼아트 보너스
    let repDelta = sat >= SAT.moodGreat ? SAT.repGreat : sat >= SAT.moodOk ? SAT.repOk : sat >= SAT.repTerribleAt ? SAT.repBad : SAT.repTerrible;
    if (orderOk) repDelta += SAT.repBonusOrder;
    if (artTier === 'perfect') repDelta += SAT.repBonusArt;
    S.rep = Math.max(0, Math.min(100, S.rep + repDelta));
    if (mood === 'bad')
      toast(shotMismatch ? '⚠️ 주문과 샷 수가 달라요 — 손님 불만 · 평판 하락' : '😖 손님 불만 — 평판 하락', 'bad', 2200);
    else if (fresh < 1) toast(`⏳ 신선도 ${Math.round(fresh * 100)}% — 팁 감소`, 'bad', 1800);
    gainXP(Math.round(o.total / 100));
    UI.removeTicket(o);
    orders.splice(orders.indexOf(o), 1);
    // 컵은 픽업대 연출에서 사라지므로 손님은 빈손으로 떠남
    Customers.serve(c, null, mood);
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
        slot.drink.espresso = 1; slot.drink.shots = (slot.drink.shots || 0) + 1;
        addStep(slot.drink, 'espresso');
        slot.drink.perfect = !!slot.tampPerfect;   // 퍼펙트 탬핑 → 이 샷에 크레마 보너스
        slot.drink.grindPerfect = !!slot.grindPerfect;   // 이상 분쇄도 → 추출 품질 보너스
        slot.drink.grindQ = slot.grindQ;                 // 빗나간 정도 인계(만족도 비례 감점)
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
          // 세찬 분출: 압력으로 굵고 빠르게 뿜어져 나옴 — 좌우로 흔들리며 출렁(부족 추출)
          s.visible = true;
          s.rotation.z = Math.sin(slot.t * 72) * 0.13;                       // 세찬 분출로 좌우로 휨
          s.rotation.x = Math.sin(slot.t * 84) * 0.09;
          s.position.x = bx + Math.sin(slot.t * 95) * 0.007;                 // 빠른 떨림
          s.scale.set(1.7, 1.35 + Math.sin(slot.t * 58) * 0.25, 1.7);        // 더 굵고 길게, 빠르게 출렁
          s.position.y = 0.12 + Math.sin(slot.t * 52) * 0.01;
        } else if (mode === 'fine') {
          // 뚝뚝: 작은 물방울이 추출구에서 컵으로 똑…똑 떨어짐(과다 추출)
          const period = 0.5;                            // 방울 간격(초)
          const ph = (slot.t % period) / period;
          s.visible = ph < 0.72;                         // 낙하 후 잠깐 끊김(뚝…뚝)
          const fall = Math.min(1, ph / 0.72);
          s.rotation.set(0, 0, 0); s.position.x = bx;
          s.scale.set(0.5 + fall * 0.12, 0.34, 0.5 + fall * 0.12);   // 짧고 둥근 방울 (떨어지며 살짝 커짐)
          s.position.y = 0.142 - fall * 0.092;           // 추출구 → 컵 바닥으로 낙하
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
    // 탬핑 전용: 좁은 퍼펙트 존을 중앙 부근에서 랜덤 배치 (스팀·도징과 별개)
    const TW = BAL.tamp.zoneW, lo = BAL.tamp.zoneMin + Math.random() * (BAL.tamp.zoneMax - BAL.tamp.zoneMin);   // 좁은 중앙 존
    tampGame = { fill: 0, locked: null, perfect: [lo, lo + TW], sound: AudioFX.tampHold(TAMP_DUR) };
    gaugeBottomUp(lo, TW);
    setGaugeText('🔧 탬핑 — <b>[E]</b>를 누르고 있어 다지기', '초록 존=크레마 보너스 · 위로 갈수록 강하게(추출 느림) / 아래일수록 약하게(추출 빠름)');
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
      : (fill >= BAL.tamp.fail) ? 'good' : 'weak';
    if (result === 'weak') {
      AudioFX.err();
      toast('너무 약해요 — 더 꾹 눌러 다지세요', 'bad', 1500);
      endTampGame();
    } else {
      pressTamper();
      AudioFX.tampDone();
      if (result === 'perfect') AudioFX.tampPerfectSfx();
      // 추출 속도 배율 — 존 밖은 강/약 각각 2단계 (조금만 넘으면 1단계로 완만하게)
      let tampSpeed = 1, sMsg = '✨ 퍼펙트 탬핑! 크레마 보너스';
      if (result !== 'perfect') {
        if (fill > pz[1]) {                 // 강함(over)
          const over = fill - pz[1];
          if (over > BAL.tamp.strong2Over) { tampSpeed = BAL.tamp.strong2; sMsg = '강하게 다짐 — 추출이 많이 느려져요'; }
          else { tampSpeed = BAL.tamp.strong1; sMsg = '살짝 강하게 — 추출이 조금 느려져요'; }
        } else {                            // 약함(under)
          const under = pz[0] - fill;
          if (under > BAL.tamp.weak2Under) { tampSpeed = BAL.tamp.weak2; sMsg = '약하게 다짐 — 추출이 많이 빨라져요'; }
          else { tampSpeed = BAL.tamp.weak1; sMsg = '살짝 약하게 — 추출이 조금 빨라져요'; }
        }
      }
      finishTamp(result === 'perfect', tampSpeed, sMsg, result === 'perfect' ? 'gold' : 'good');
    }
  }
  function finishTamp(perfect, tampSpeed, msg, cls) {
    held.tampPerfect = perfect;
    held.tampSpeed = tampSpeed;   // 추출 속도 배율(>1 느림 / <1 빠름)
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
    const res = Pitchers.steamPitcher(held, perfect);
    if (!res.ok) { toast('스팀할 우유가 없어요', 'bad'); AudioFX.err(); endSteamGame(); return; }
    stampFresh(held);                         // 데운 우유 신선도 시계 시작
    setHeld(held);
    toast(msg, cls);
    UI.hud();
    endSteamGame();
  }
  function updateSteamGame(dt, aimData) {
    if (!steamGame) return false;
    const ok = aimData && aimData.id === 'steamwand' && held && held.type === 'pitcher' && (held.rawMilk || held.milk) && !held.foam;
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

  /* ===== 분쇄도 다이얼 — 그라인더에서 [E] 누른 채 마우스로 다이얼을 직접 돌려 맞춘다 =====
   * 게이지가 아니라 실제 다이얼 회전. [E]를 누르면 시점이 잠기고 마우스 좌우로 바늘(1~7)을 돌림.
   * 초록(이상, 숫자 4 부근)에 맞추면 완벽 추출. [E]에서 손을 떼면 그 분쇄도로 확정(머신에 저장). */
  function startGrindGame(job) {
    grindGame = { job, set: job.grindSetting };
    Player.setLook(false);                                  // 시점 잠금 — 마우스를 다이얼 회전에 양보
    if (job.dialMark) WORLD.setGrinderDial(job.dialMark, grindGame.set);
    buildGrindTicks();                                      // 눈금·숫자 1회 생성
    $('grindDial').classList.remove('hidden');              // 중앙 다이얼 비주얼 표시
    updateGrindDial();
  }
  // 다이얼 눈금(마이너/메이저) + 숫자 1~7 생성 (한 번만)
  function buildGrindTicks() {
    const g = document.getElementById('gdTicks');
    if (!g || g.childElementCount) return;
    const NS = 'http://www.w3.org/2000/svg', cx = 100, cy = 100;
    const tick = (set, r1, r2, w, col) => {
      const th = (set - 0.5) * 270 * Math.PI / 180, s = Math.sin(th), c = Math.cos(th);
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', (cx + r1 * s).toFixed(1)); l.setAttribute('y1', (cy - r1 * c).toFixed(1));
      l.setAttribute('x2', (cx + r2 * s).toFixed(1)); l.setAttribute('y2', (cy - r2 * c).toFixed(1));
      l.setAttribute('stroke', col); l.setAttribute('stroke-width', w); l.setAttribute('stroke-linecap', 'round');
      g.appendChild(l);
    };
    for (let i = 0; i < 6; i++) tick((i + 0.5) / 6, 90, 84, 2, 'rgba(232,184,109,.3)');   // 마이너 눈금
    for (let i = 0; i <= 6; i++) {
      tick(i / 6, 90, 78, 3, 'rgba(232,184,109,.7)');                                     // 메이저 눈금
      const th = (i / 6 - 0.5) * 270 * Math.PI / 180;
      const tx = document.createElementNS(NS, 'text');
      tx.setAttribute('x', (cx + 64 * Math.sin(th)).toFixed(1));
      tx.setAttribute('y', (cy - 64 * Math.cos(th)).toFixed(1));
      tx.setAttribute('fill', '#e8d8c0'); tx.setAttribute('font-size', '15'); tx.setAttribute('font-weight', '700');
      tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('dominant-baseline', 'central');
      tx.textContent = String(i + 1);
      g.appendChild(tx);
    }
  }
  function updateGrindDial() {                              // 중앙 다이얼: 바늘 회전 + 분쇄도 읽기
    if (!grindGame) return;
    const set = grindGame.set;
    const needle = document.getElementById('gdNeedle');
    if (needle) needle.setAttribute('transform', `rotate(${((set - 0.5) * 270).toFixed(1)} 100 100)`);   // 0.5=정중앙(위)
    $('gdReadout').innerHTML = `분쇄도 <b>${(1 + set * 6).toFixed(1)}</b>`;
  }
  function turnGrindDial(dx) {                              // 마우스 좌우 이동 → 다이얼 회전
    if (!grindGame) return;
    grindGame.set = Math.max(0, Math.min(1, grindGame.set - dx * 0.0016));
    if (grindGame.job.dialMark) WORLD.setGrinderDial(grindGame.job.dialMark, grindGame.set);
    updateGrindDial();
  }
  function endGrindGame() {
    grindGame = null;
    Player.setLook(true);
    $('grindDial').classList.add('hidden');
  }
  function confirmGrind() {
    const set = grindGame.set;
    grindGame.job.grindSetting = set;   // 머신에 저장(분쇄 시 포터필터로 인계)
    const ideal = set >= GRIND_IDEAL_MIN && set <= GRIND_IDEAL_MAX;
    if (ideal) { toast('⚙️ 분쇄도: 이상적 — 균형 잡힌 추출', 'good', 1600); AudioFX.tampPerfectSfx(); }
    else { toast(set < GRIND_IDEAL_MIN ? '⚙️ 분쇄도: 가늚 — 추출이 느려 뚝뚝(과다)' : '⚙️ 분쇄도: 굵음 — 추출이 빨라요(부족)', '', 1700); AudioFX.metalClack(); }
    endGrindGame();
  }
  function updateGrindGame(dt, aimData) {
    if (!grindGame) return false;
    // [E]를 떼거나 그라인더에서 시선/위치가 벗어나면 현재 분쇄도로 확정. (회전은 mousemove에서)
    const ok = aimData && aimData.id === 'grinder' && !(held && held.type === 'portafilter');
    if (!ok || !useDown) { confirmGrind(); return false; }
    return true;
  }




  /* ===== 하루 사이클 (준비 → 영업 → 정산) ===== */
  let timeSec = 0, open = false;
  let prepPanelOpen = false;
  let pendingTutorial = false;

  // 매장(머신·들고있는것·연출) 초기화 — 준비/영업 진입 시 공용
  function resetStations(opts = {}) {
    returnHeldLogistics(false);
    returnPitcherToCounter(held);
    setHeld(null);
    clearPlacedItems({ keepPrepTools: !!opts.keepPrepTools });
    Effects.clear();
    shotAvail = SHOT_MAX; updateRackVisuals();   // 모든 샷잔 거치대로 복귀
    env.placeIndicator.visible = false;
    clearItemPlacePreview();
    if (env.setDeliveryPreview) env.setDeliveryPreview(null);
    milkFridgeOpen = false;
    if (env.setMilkFridgeOpen) env.setMilkFridgeOpen(false);
    syncMilkFridgeMilk(true);
    env.machines.espressoSlots.forEach(s => {
      if (s.cupMesh) s.st.root.remove(s.cupMesh);
      if (s.sound) { s.sound.stop(); s.sound = null; }
      s.busy = s.done = false; s.cupMesh = null; s.drink = null; s.brewLiquid = null; s.stream.visible = false;
      s.pfState = 'empty'; s.tampPerfect = false; s.tampSpeed = 1; WORLD.setPortafilterState(s.pf, 'empty');
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
    syncPitchers();
  }

  /* --- 영업 준비 단계: 손님 없음 · 시간 정지 · 배치/구매/보충 --- */
  function startPrep() {
    mode = 'prep';
    open = false; timeSec = 0;
    Logistics.ensureState(S);
    Pitchers.ensureMilkState(S);
    const arrivals = Logistics.collectArrivals(S, S.day);
    dayStats = freshDayStats();        // 준비~영업 지출이 누적되도록 여기서 1회 초기화
    orders = []; orderSeq = 0;
    $('tickets').innerHTML = '';
    Tutorial.cancel();
    Customers.clear();
    resetStations();
    seedLooseMilkCartons();
    restoreLooseMilkCartons();
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
    renderDeliveryBoxes();
    renderStorageBoxes();
    syncPitchers();
    syncMilkFridgeMilk(true);
    UI.hud(); UI.clock();
    if (arrivals.length) { save(); toast(`문앞에 택배 ${arrivals.length}개 도착 — 창고에 입고하세요`, 'gold', 4500); }
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
    resetStations({ keepPrepTools: true });
    mode = 'playing';
    Player.enabled = true;
    syncPitchers();
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
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
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
    let base = BAL.flow.spawnBase - S.day * BAL.flow.spawnDayStep;
    base *= earlyEaseFactor();      // 초반 적응 구간 완화
    if (S.upgrades.ads) base *= BAL.flow.spawnAds;
    base *= S.rep >= 70 ? BAL.flow.spawnRepHigh : S.rep <= 30 ? BAL.flow.spawnRepLow : 1;
    base = Math.max(BAL.flow.spawnFloor, base);
    return base * (BAL.flow.spawnRandMin + Math.random() * BAL.flow.spawnRandSpan);
  }

  function endDay() {
    returnHeldLogistics(false);
    mode = 'after';
    Player.enabled = false;
    open = false;
    if (env.doorSign) env.doorSign.setOpen(false);   // 마감 = CLOSE 팻말
    if (env.door) env.door.open = false;             // 마감 = 문 닫힘
    if (typeof Weather !== 'undefined') Weather.setClock(18);   // 마감 = 18시(해 지는 시각)
    env.placeIndicator.visible = false;
    clearItemPlacePreview();
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
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
    Pitchers.advanceMilkAging(S, 1);
    S.day++;
    renderDeliveryOrders();
    save();
  }

  function closeDayEndPanel() {
    if (mode !== 'after') return;
    $('dayEnd').classList.add('hidden');
    $('hud').classList.remove('hidden');
    Player.enabled = true;
    UI.hud();
    UI.clock();
    renderDeliveryBoxes();
  }

  function clearDebugOverlays() {
    ['menuScreen', 'pauseScreen', 'prepPanel', 'dayEnd', 'gameOver'].forEach(id => {
      const el = $(id);
      if (el) el.classList.add('hidden');
    });
    $('hud').classList.remove('hidden');
    prepPanelOpen = false;
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }

  function goPrep() {
    if (typeof Editor !== 'undefined' && Editor.active) Editor.toggle();
    clearDebugOverlays();
    startPrep();
    save();
    toast('디버그: 영업전으로 이동', 'gold');
  }

  function goOpen() {
    if (mode !== 'prep') goPrep();
    beginOpen();
    save();
    toast('디버그: 영업중으로 이동', 'gold');
  }

  function goAfter() {
    if (typeof Editor !== 'undefined' && Editor.active) Editor.toggle();
    returnHeldLogistics(false);
    mode = 'after';
    open = false;
    Customers.clear();
    orders = []; orderSeq = 0;
    $('tickets').innerHTML = '';
    clearDebugOverlays();
    $('prepBar').classList.add('hidden');
    if (env.doorSign) env.doorSign.setOpen(false);
    if (env.door) env.door.open = false;
    if (typeof Weather !== 'undefined') Weather.setClock(18);
    Player.enabled = true;
    renderDeliveryBoxes();
    UI.hud(); UI.clock();
    save();
    toast('디버그: 영업후로 이동', 'gold');
  }

  function endDayNow() {
    if (!dayStats) dayStats = freshDayStats();
    Customers.clear();
    orders = []; orderSeq = 0;
    $('tickets').innerHTML = '';
    if (mode === 'after') {
      $('hud').classList.add('hidden');
      $('dayEnd').classList.remove('hidden');
      Player.enabled = false;
      return;
    }
    endDay();
  }

  function addMoney(amount) {
    const n = Math.max(0, Math.round(Number(amount) || 0));
    if (!n) { toast('추가할 금액을 입력하세요', 'bad'); AudioFX.err(); return; }
    S.money += n;
    refreshPrepMoney();
    UI.hud();
    save();
    toast(`디버그: ${fmt(n)} 추가`, 'gold');
  }

  function debugState() {
    return { mode, day: S.day, money: S.money, open };
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
      if (kind === 'pitcher') return;
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
    if (kind === 'pitcher') {
      S.money -= e.price;
      if (dayStats) dayStats.spent += e.price;
      S.equip[kind] = owned + 1;
      Pitchers.addPitcher(S);
      syncPitchers();
      save();
      AudioFX.cash();
      renderEquipment();
      refreshPrepMoney();
      UI.hud();
      toast(`${e.name} 구매 완료! 카운터에 피처가 추가됐어요`, 'good', 3500);
      return;
    }
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
  function cleanSaveState() {
    const out = JSON.parse(JSON.stringify(S));
    (out.deliveryBoxes || []).forEach(b => delete b.surfacePlaced);
    return out;
  }
  function save() { localStorage.setItem(SAVE_KEY, JSON.stringify(cleanSaveState())); }
  function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d && d.money !== undefined) { S = Object.assign(freshState(false), d); Logistics.ensureState(S); Pitchers.ensureState(S); Pitchers.ensureMilkState(S); return true; }
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
      _outlinePass.visibleEdgeColor.setHex(spec.color || 0xffa000);
      _outlinePass.hiddenEdgeColor.setHex(spec.hiddenColor || 0x6b4200);
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
      box.material.color.setHex((spec && spec.color) || 0xffffff);
      box.visible = true;
    } else {
      box.visible = false;
    }
  }

  function updatePrep() {
    // 준비/영업후: 물류 프롬프트만 표시 (손님·시계 정지)
    const pr = $('prompt');
    if (prepPanelOpen) {
      pr.classList.add('hidden'); $('crosshair').classList.remove('active');
      if (env.placeIndicator) env.placeIndicator.visible = false;
      clearItemPlacePreview();
      updateAimHighlight(null);
      return;
    }
    const aimData = Player.aim();
    const usable = aimData && (aimData.id === 'door' || aimData.id === 'deliveryBox' || aimData.id === 'placedItem');
    let dprev = null;
    let placePoint = null;
    let placePrompt = null;
    const prepSurfacePt = isSurfacePlaceableItem(held) ? Player.aimSurface() : null;
    if (prepSurfacePt && (prepSurfacePt.fridgeSurface || (!usable && !aimData))) {
      const pt = prepSurfacePt;
      if (pt) {
        if (placeBlocked(pt, held)) placePrompt = '여기엔 공간이 없어요';
        else { placePoint = pt; placePrompt = '<b>[E]</b> 내려놓기 · <b>[R]</b> 회전'; }
      }
    }
    if (!usable && !placePoint && !placePrompt) dprev = deliveryPlacePreview();
    else if (env.setDeliveryPreview) env.setDeliveryPreview(null);
    if (usable && env.setDeliveryPreview) env.setDeliveryPreview(null);
    updateAimHighlight(usable && !placePoint ? Player.aimedObject : null);
    if (usable && !placePoint) {
      pr.innerHTML = UI.prompt(aimData);
      pr.classList.remove('hidden'); $('crosshair').classList.add('active');
    } else if (dprev) {
      pr.innerHTML = dprev.ok ? '<b>[E]</b> 박스 내려놓기 · <b>[R]</b> 회전' : '여기엔 박스를 놓을 공간이 없어요 · <b>[R]</b> 회전';
      pr.classList.remove('hidden'); $('crosshair').classList.add('active');
    } else if (placePrompt) {
      pr.innerHTML = placePrompt;
      pr.classList.remove('hidden'); $('crosshair').classList.add('active');
    } else {
      pr.classList.add('hidden'); $('crosshair').classList.remove('active');
    }
    if (placePoint) {
      env.placeIndicator.visible = false;
      updateItemPlacePreview(held, placePoint, true);
    } else {
      env.placeIndicator.visible = false;
      clearItemPlacePreview();
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
    if (mode === 'prep' || mode === 'after') { updatePrep(); $('freshness').classList.add('hidden'); return; }
    if (mode !== 'playing' && mode !== 'closing') {
      if (env.setDeliveryPreview) env.setDeliveryPreview(null);
      if (env.placeIndicator) env.placeIndicator.visible = false;
      clearItemPlacePreview();
      updateAimHighlight(null); $('freshness').classList.add('hidden'); return;
    }

    // 시간
    if (mode === 'playing') {
      timeSec += dt;
      if (open && timeSec >= DAY_LEN) {
        open = false;
        mode = 'closing';
        toast('영업 마감! 남은 손님을 응대하세요', 'gold', 3500);
        AudioFX.bell();
      }
    }
    if (mode === 'closing' && Customers.list.length === 0) {
      endDay();
      return;
    }
    if (mode === 'closing' && open) {
      open = false;
      toast('영업 마감! 남은 손님을 응대하세요', 'gold', 3500);
      AudioFX.bell();
    }
    UI.clock();
    if (typeof Weather !== 'undefined')                         // 시각에 맞춰 해 고도·하늘빛 갱신(일출→정오→일몰)
      Weather.setClock(Math.min(18, 9 + (timeSec / DAY_LEN) * 9));

    // 손님 스폰
    if (mode === 'playing' && open) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = spawnInterval();
        Customers.spawn(patienceForNew());
      }
    } else if (mode === 'playing' && Customers.list.length === 0) {
      endDay();
      return;
    }

    Customers.update(dt);
    updatePendingOrders();   // 맨 앞 손님이 주문을 말하도록(음성) — POS 입력 전 단계
    updateSlots(dt);
    updateJobs(dt);
    Effects.update(dt);
    updateFreshnessHUD();

    // 라떼아트 미니게임 — 진행 중엔 다른 조준/상호작용을 모두 잠그고 단독 처리
    if (LatteArt.update(dt, useDown)) {
      $('prompt').classList.add('hidden');
      $('crosshair').classList.remove('active');
      env.placeIndicator.visible = false;
      clearItemPlacePreview();
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
    const playSurfacePt = isSurfacePlaceableItem(held) ? Player.aimSurface() : null;
    const surfaceOverridesAim = !!(playSurfacePt && playSurfacePt.fridgeSurface);
    if (surfaceOverridesAim) { p = null; updateAimHighlight(null); }
    const dprev = !aimData && !surfaceOverridesAim ? deliveryPlacePreview() : null;
    if ((aimData || surfaceOverridesAim) && env.setDeliveryPreview) env.setDeliveryPreview(null);
    if (dprev) {
      p = dprev.ok ? '<b>[E]</b> 박스 내려놓기 · <b>[R]</b> 회전' : '여기엔 박스를 놓을 공간이 없어요 · <b>[R]</b> 회전';
    } else if (playSurfacePt && (surfaceOverridesAim || !aimData)) {
      const pt = playSurfacePt;
      if (pt) {
        if (placeBlocked(pt, held)) p = '여기엔 공간이 없어요';
        else { placePoint = pt; p = '<b>[E]</b> 내려놓기 · <b>[R]</b> 회전'; }
      }
    }
    // 고스트 표시 — 표면 배치(placePoint) 또는 상호작용 위치(ghostInteract)
    const ind = env.placeIndicator;
    if (placePoint) {
      ind.visible = false;
      updateItemPlacePreview(held, placePoint, true);
    } else {
      ind.visible = false;
      clearItemPlacePreview();
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
      if (held && isSurfacePlaceableItem(held)) {
        const fridgePt = Player.aimSurface();
        if (fridgePt && fridgePt.fridgeSurface) {
          if (!placeBlocked(fridgePt, held)) { placeItem(fridgePt); return; }
          toast('여기에는 놓을 공간이 없어요', 'bad'); AudioFX.err(); return;
        }
      }
      if (aimData) { interact(aimData); return; }
      if (held) {
        const pt = Player.aimSurface();
        if (pt && isSurfacePlaceableItem(held)) {
          if (!placeBlocked(pt, held)) { placeItem(pt); return; }
          toast('여기는 공간이 없어요', 'bad'); AudioFX.err(); return;
        }
        if (moveHeldDeliveryBox()) return;
      }
    }
    function dropOrReturnHeld() {
      if (!held) return false;
      if (returnHeldLogistics(true)) return true;
      if (held.type === 'portafilter') { toast('⛔ 포터필터는 버릴 수 없어요', 'bad'); }
      else if (held.type === 'shotglass') { toast('⛔ 샷잔은 버릴 수 없어요 — 거치대에 반납하거나 컵에 따르세요', 'bad'); }
      else if (held.type === 'pitcher') { toast('⛔ 스팀 피처는 버릴 수 없어요 — 거치대에 반납하거나 컵에 부으세요', 'bad'); }
      else { setHeld(null); toast('버렸습니다'); }
      return true;
    }
    // const Editor는 window 속성이 아니므로 typeof로 확인해야 게이트가 작동함
    const editing = () => typeof Editor !== 'undefined' && Editor.active;
    document.addEventListener('keydown', ev => {
      if (mode !== 'playing' && mode !== 'prep' && mode !== 'closing' && mode !== 'after') return;
      if (editing()) return;   // 편집 모드 중엔 에디터가 입력 처리
      if (posOpen) {           // POS 메뉴 입력 중 — [E]/Enter 확정, [Esc] 취소
        if (ev.code === 'KeyE' || ev.code === 'Enter') confirmPos();
        else if (ev.code === 'Escape') closePos();
        return;
      }
      if (ev.repeat) return;   // 키 오토리피트 무시 — 단발 입력만 처리
      // 준비/영업후 전용 조작
      if (mode === 'prep' || mode === 'after') {
        if (prepPanelOpen) return;                       // 패널은 버튼으로 조작
        if (ev.code === 'KeyQ' && dropOrReturnHeld()) return;
        if (ev.code === 'KeyE') onUse();                 // 물류/문
        else if (mode === 'prep' && ev.code === 'KeyO') beginOpen();        // 영업 시작
        else if (mode === 'prep' && ev.code === 'KeyM') openPrepPanel();    // 관리·업그레이드
        else if (mode === 'after' && ev.code === 'KeyM') { renderDeliveryOrders(); $('hud').classList.add('hidden'); $('dayEnd').classList.remove('hidden'); Player.enabled = false; if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); }
        else if (ev.code === 'KeyR' && rotateHeldItemPreview()) return;
        else if (ev.code === 'KeyR' && rotateDeliveryBoxPreview()) return;
        else if (ev.code === 'KeyR') $('recipeBook').classList.toggle('hidden');
        return;
      }
      // 영업 중 조작
      if (ev.code === 'KeyE') { useDown = true; onUse(); }
      if (ev.code === 'KeyQ') dropOrReturnHeld();
      if (ev.code === 'KeyR' && rotateHeldItemPreview()) return;
      if (ev.code === 'KeyR' && rotateDeliveryBoxPreview()) return;
      if (ev.code === 'KeyR') $('recipeBook').classList.toggle('hidden');
      if (ev.code === 'KeyT') Tutorial.cancel();
    });
    $('recipeBtn').onclick = () => { if (!editing()) $('recipeBook').classList.toggle('hidden'); };
    $('recipeBook').addEventListener('click', ev => {
      if (ev.target === $('recipeBook')) $('recipeBook').classList.add('hidden'); // 바깥 클릭으로 닫기
    });
    // POS 주문 입력 화면 버튼
    $('btnPosConfirm').onclick = confirmPos;
    $('btnPosClear').onclick = () => { posCart = []; AudioFX.pick(); renderPosCart(); };
    $('btnPosCancel').onclick = () => closePos();
    $('btnPosReplay').onclick = () => { if (posCustomer && posCustomer.pendingOrder) speakOrder(posCustomer.pendingOrder.items); };
    document.addEventListener('mousedown', ev => {
      if ((mode === 'playing' || mode === 'closing' || mode === 'after') && document.pointerLockElement && ev.button === 0 && !editing()) {
        useDown = true; onUse();
      }
    });
    // 탬핑 홀드 해제: [E]/좌클릭에서 손을 떼면 게이지 판정
    document.addEventListener('keyup', ev => { if (ev.code === 'KeyE') useDown = false; });
    document.addEventListener('mouseup', ev => { if (ev.button === 0) useDown = false; });
    // 분쇄도 다이얼 회전 — [E] 누른 채 마우스 좌우로 돌림 (시점은 잠겨 있음)
    document.addEventListener('mousemove', ev => { if (grindGame && useDown) turnGrindDial(ev.movementX); });
    // 포커스/포인터락이 풀리면 keyup·mouseup이 안 와 useDown이 눌린 채로 남는다 → 강제 해제
    window.addEventListener('blur', () => { useDown = false; });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) useDown = false; });
  }

  function newGame() {
    S = freshState();
    Logistics.ensureState(S);
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
    beginOpen, openPrepPanel, closePrepPanel, closeDayEndPanel,
    setOutlinePass(p) { _outlinePass = p; },   // main.js가 후처리 OutlinePass 주입

    get mode() { return mode; },
    set mode(v) { mode = v; },
    get prepPanelOpen() { return prepPanelOpen; },
    get posOpen() { return posOpen; },
    get inTutorial() { return Tutorial.active(); },
    notifyEditMode(on) {
      if (on) {
        // 내려놓기 표시·레시피북·조준 아웃라인 숨김 (머신 작업은 계속 표시되며 시간만 정지)
        env.placeIndicator.visible = false;
        clearItemPlacePreview();
        if (env.aimHighlight) env.aimHighlight.visible = false;
        clearOutline();
        $('prompt').classList.add('hidden');
        $('recipeBook').classList.add('hidden');
      }
    },
    isBrewing: () => env.machines.espressoSlots.some(s => s.busy && !s.done),
    steamSources,
    _debug: {
      goPrep, goOpen, goAfter, endDayNow, addMoney,
      state: debugState,
      closeNow: endDayNow,
    },
  };
})();
