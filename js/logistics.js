/* ============================================================
 * logistics.js — 배송·창고·사용처 재고 규칙
 * ============================================================ */
const Logistics = (() => {
  const { RESTOCK } = DATA;
  const KINDS = Object.keys(RESTOCK);
  const DOOR_RIGHT_SPOT = { x: 6.75, z: 9.35, rot: 0 };
  const DELIVERY_BOX_SPACING = 0.76;
  let seq = 1;

  function emptyBag() {
    return { beans: 0, milk: 0, cups: 0, dessert: 0 };
  }

  function deliverySpot(index = 0) {
    const i = Math.max(0, Number(index) || 0);
    return {
      x: Math.round((DOOR_RIGHT_SPOT.x + DELIVERY_BOX_SPACING * i) * 100) / 100,
      z: DOOR_RIGHT_SPOT.z,
      rot: DOOR_RIGHT_SPOT.rot,
    };
  }

  function normalizeBag(bag) {
    const out = Object.assign(emptyBag(), bag || {});
    KINDS.forEach(k => { out[k] = Math.max(0, Number(out[k]) || 0); });
    return out;
  }

  function emptyStorageBoxes() {
    return { beans: [], milk: [], cups: [], dessert: [] };
  }

  function normalizeStorageBoxes(boxes, totals) {
    const out = emptyStorageBoxes();
    KINDS.forEach(kind => {
      const raw = boxes && Array.isArray(boxes[kind]) ? boxes[kind] : [];
      raw.forEach(b => {
        const amount = Math.max(0, Number(b && b.amount) || 0);
        if (amount <= 0) return;
        out[kind].push({
          id: b.id || `legacy_${kind}`,
          kind,
          amount,
          source: b.source || 'stored',
        });
      });
    });
    return out;
  }

  function syncStorageTotals(S) {
    S.storage = emptyBag();
  }

  function ensureState(S) {
    const totals = normalizeBag(S.storage);
    S.stocks = normalizeBag(S.stocks);
    const legacyBoxes = normalizeStorageBoxes(S.storageBoxes, totals);
    if (!S.globalStockMigrated) {
      KINDS.forEach(kind => {
        const boxed = legacyBoxes[kind].reduce((sum, b) => sum + Math.max(0, Number(b.amount) || 0), 0);
        S.stocks[kind] += totals[kind] + boxed;
      });
      S.globalStockMigrated = true;
    }
    S.storageBoxes = emptyStorageBoxes();
    syncStorageTotals(S);
    S.pendingDeliveries = Array.isArray(S.pendingDeliveries) ? S.pendingDeliveries : [];
    S.deliveryBoxes = Array.isArray(S.deliveryBoxes) ? S.deliveryBoxes : [];
    S.deliveryBoxes.forEach((b, i) => {
      const spot = deliverySpot(i);
      if (b.autoSpot !== false) {
        b.x = spot.x;
        b.z = spot.z;
        b.rot = spot.rot;
        b.autoSpot = true;
      } else {
        if (typeof b.x !== 'number') b.x = spot.x;
        if (typeof b.z !== 'number') b.z = spot.z;
        if (typeof b.rot !== 'number') b.rot = spot.rot;
      }
    });
    return S;
  }

  function initialState(base) {
    const S = ensureState(base || {});
    S.deliveryBoxes = [];
    addDeliveryBox(S, 'beans', RESTOCK.beans.amount, 'starter');
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
    const spot = deliverySpot(S.deliveryBoxes.length);
    const box = { id: boxId(kind), kind, amount, source, x: spot.x, z: spot.z, rot: spot.rot, autoSpot: true };
    S.deliveryBoxes.push(box);
    return box;
  }

  function moveDeliveryBox(S, id, pose) {
    ensureState(S);
    const box = S.deliveryBoxes.find(b => b.id === id);
    if (!box) return { ok: false, reason: 'missing' };
    box.x = Number(pose.x);
    box.z = Number(pose.z);
    box.rot = Number(pose.rot) || 0;
    box.autoSpot = false;
    return { ok: true, box };
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

  function storeDeliveryBox(S, id, slotRef = null) {
    ensureState(S);
    const idx = S.deliveryBoxes.findIndex(b => b.id === id);
    if (idx < 0) return { ok: false, reason: 'missing' };
    const deliveryBox = S.deliveryBoxes[idx];
    S.deliveryBoxes.splice(idx, 1);
    S.stocks[deliveryBox.kind] += Math.max(0, Number(deliveryBox.amount) || 0);
    syncStorageTotals(S);
    return { ok: true, kind: deliveryBox.kind, amount: deliveryBox.amount, deliveryBox };
  }

  function takeSupply(S, kind, slotRef = null) {
    ensureState(S);
    if ((S.stocks[kind] || 0) <= 0) return { ok: false, reason: 'empty', kind };
    S.stocks[kind]--;
    syncStorageTotals(S);
    return { ok: true, kind, remaining: S.stocks[kind] };
  }

  function returnSupply(S, kind, preferredBoxId = null, preferredSlotRef = null) {
    ensureState(S);
    S.stocks[kind] = (S.stocks[kind] || 0) + 1;
    syncStorageTotals(S);
    return { ok: true, kind, amount: S.stocks[kind] };
  }

  function putSupplyToStation(S, kind) {
    ensureState(S);
    S.stocks[kind]++;
    return { ok: true, kind };
  }

  return {
    KINDS, DOOR_RIGHT_SPOT, DELIVERY_BOX_SPACING,
    ensureState, deliveryPrice, scheduleDelivery, collectArrivals,
    initialState, addDeliveryBox, deliverySpot, moveDeliveryBox, storeDeliveryBox, takeSupply, returnSupply,
    putSupplyToStation,
  };
})();
