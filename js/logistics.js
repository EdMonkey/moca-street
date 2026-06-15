/* ============================================================
 * logistics.js — 배송·창고·사용처 재고 규칙
 * ============================================================ */
const Logistics = (() => {
  const { RESTOCK } = DATA;
  const KINDS = Object.keys(RESTOCK);
  const CAPACITY = { beans: 30, milk: 20, cups: 40, dessert: 12 };
  let seq = 1;

  function emptyBag() {
    return { beans: 0, milk: 0, cups: 0, dessert: 0 };
  }

  function normalizeBag(bag) {
    const out = Object.assign(emptyBag(), bag || {});
    KINDS.forEach(k => { out[k] = Math.max(0, Number(out[k]) || 0); });
    return out;
  }

  function ensureState(S) {
    S.storage = normalizeBag(S.storage);
    S.stocks = normalizeBag(S.stocks);
    S.pendingDeliveries = Array.isArray(S.pendingDeliveries) ? S.pendingDeliveries : [];
    S.deliveryBoxes = Array.isArray(S.deliveryBoxes) ? S.deliveryBoxes : [];
    return S;
  }

  function deliveryPrice(kind, count = 1, quick = false) {
    const r = RESTOCK[kind];
    const base = r.price * count;
    return quick ? Math.round(base * 1.8 / 100) * 100 : base;
  }

  function boxId(kind) {
    return `delivery_${kind}_${Date.now().toString(36)}_${seq++}`;
  }

  function addDeliveryBox(S, kind, amount, source = 'scheduled') {
    ensureState(S);
    const prev = S.deliveryBoxes.find(b => b.kind === kind);
    if (prev) {
      prev.amount += amount;
      prev.source = prev.source === source ? source : 'mixed';
      return prev;
    }
    const box = { id: boxId(kind), kind, amount, source };
    S.deliveryBoxes.push(box);
    return box;
  }

  function scheduleDelivery(S, kind, count = 1, day = S.day) {
    ensureState(S);
    const amount = RESTOCK[kind].amount * count;
    S.pendingDeliveries.push({ kind, amount, arriveDay: day + 1, source: 'scheduled' });
  }

  function collectArrivals(S, day = S.day) {
    ensureState(S);
    const due = S.pendingDeliveries.filter(d => d.arriveDay <= day);
    if (!due.length) return [];
    S.pendingDeliveries = S.pendingDeliveries.filter(d => d.arriveDay > day);
    const byKind = {};
    due.forEach(d => { byKind[d.kind] = (byKind[d.kind] || 0) + d.amount; });
    return Object.keys(byKind).map(kind => addDeliveryBox(S, kind, byKind[kind], 'scheduled'));
  }

  function storeDeliveryBox(S, id) {
    ensureState(S);
    const idx = S.deliveryBoxes.findIndex(b => b.id === id);
    if (idx < 0) return { ok: false, reason: 'missing' };
    const [box] = S.deliveryBoxes.splice(idx, 1);
    S.storage[box.kind] += box.amount;
    return { ok: true, box };
  }

  function takeSupply(S, kind) {
    ensureState(S);
    if (S.storage[kind] <= 0) return { ok: false, reason: 'empty' };
    S.storage[kind]--;
    return { ok: true, kind };
  }

  function putSupplyToStation(S, kind) {
    ensureState(S);
    if (S.stocks[kind] >= CAPACITY[kind]) return { ok: false, reason: 'full' };
    S.stocks[kind]++;
    return { ok: true, kind };
  }

  return {
    KINDS, CAPACITY,
    ensureState, deliveryPrice, scheduleDelivery, collectArrivals,
    addDeliveryBox, storeDeliveryBox, takeSupply, putSupplyToStation,
  };
})();
