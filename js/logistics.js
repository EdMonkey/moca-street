/* ============================================================
 * logistics.js — 배송·창고·사용처 재고 규칙
 * ============================================================ */
const Logistics = (() => {
  const { RESTOCK } = DATA;
  const KINDS = Object.keys(RESTOCK);
  const CAPACITY = { beans: 30, milk: 20, cups: 40, dessert: 12 };
  const STORAGE_RACKS = [0, 1, 2, 3];
  const STORAGE_SLOTS = [0, 1, 2];
  const STORAGE_SLOT_IDS = STORAGE_RACKS.flatMap(r => STORAGE_SLOTS.map(s => `r${r}s${s}`));
  const DOOR_RIGHT_SPOT = { x: 6.75, z: 9.35, rot: 0 };
  const DELIVERY_BOX_SPACING = 0.76;
  let seq = 1;
  let storageSeq = 1;

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

  function storageId(kind) {
    return `storage_${kind}_${Date.now().toString(36)}_${storageSeq++}`;
  }

  function clampSlot(slot) {
    const n = Number(slot);
    return STORAGE_SLOTS.includes(n) ? n : null;
  }

  function legacySlotId(kind, slot) {
    const s = clampSlot(slot);
    if (s == null) return null;
    const rack = Math.max(0, KINDS.indexOf(kind));
    return `r${rack}s${s}`;
  }

  function normalizeSlotId(slotRef, kind = null) {
    if (typeof slotRef === 'string' && STORAGE_SLOT_IDS.includes(slotRef)) return slotRef;
    if (kind) return legacySlotId(kind, slotRef);
    return null;
  }

  function splitSlotId(slotId) {
    const m = /^r(\d+)s(\d+)$/.exec(slotId || '');
    return m ? { rack: Number(m[1]), slot: Number(m[2]) } : { rack: 0, slot: 0 };
  }

  function firstFreeSlotIdFromUsed(used) {
    return STORAGE_SLOT_IDS.find(id => !used.has(id)) || null;
  }

  function usedStorageSlotIds(S) {
    const used = new Set();
    KINDS.forEach(kind => {
      (S.storageBoxes[kind] || []).forEach(b => { if (b.slotId) used.add(b.slotId); });
    });
    return used;
  }

  function firstFreeStorageSlot(S) {
    ensureState(S);
    return firstFreeSlotIdFromUsed(usedStorageSlotIds(S));
  }

  function normalizeStorageBoxes(boxes, totals) {
    const out = emptyStorageBoxes();
    const used = new Set();
    KINDS.forEach(kind => {
      const raw = boxes && Array.isArray(boxes[kind]) ? boxes[kind] : [];
      raw.forEach(b => {
        const amount = Math.max(0, Number(b && b.amount) || 0);
        if (amount <= 0) return;
        let slotId = normalizeSlotId(b.slotId) || normalizeSlotId(b.slot, kind);
        if (!slotId || used.has(slotId)) slotId = firstFreeSlotIdFromUsed(used);
        if (!slotId) return;
        used.add(slotId);
        const pos = splitSlotId(slotId);
        out[kind].push({
          id: b.id || storageId(kind),
          kind,
          amount,
          slotId,
          rack: pos.rack,
          slot: pos.slot,
          source: b.source || 'stored',
        });
      });
      const total = Math.max(0, Number(totals && totals[kind]) || 0);
      if (!out[kind].length && total > 0) {
        const slotId = firstFreeSlotIdFromUsed(used);
        if (slotId) {
          used.add(slotId);
          const pos = splitSlotId(slotId);
          out[kind].push({ id: storageId(kind), kind, amount: total, slotId, rack: pos.rack, slot: pos.slot, source: 'legacy' });
        }
      }
    });
    return out;
  }

  function syncStorageTotals(S) {
    S.storage = emptyBag();
    KINDS.forEach(kind => {
      S.storage[kind] = S.storageBoxes[kind].reduce((sum, b) => sum + Math.max(0, Number(b.amount) || 0), 0);
    });
  }

  function ensureState(S) {
    const totals = normalizeBag(S.storage);
    S.storageBoxes = normalizeStorageBoxes(S.storageBoxes, totals);
    syncStorageTotals(S);
    S.stocks = normalizeBag(S.stocks);
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

  function storageTotal(S, kind) {
    ensureState(S);
    return S.storage[kind] || 0;
  }

  function storageSlotBox(S, slotRef, legacySlot = undefined) {
    ensureState(S);
    const slotId = legacySlot === undefined ? normalizeSlotId(slotRef) : normalizeSlotId(legacySlot, slotRef);
    if (!slotId) return null;
    for (const kind of KINDS) {
      const box = S.storageBoxes[kind].find(b => b.slotId === slotId);
      if (box) return box;
    }
    return null;
  }

  function storageSlotAmount(S, slotRef, legacySlot = undefined) {
    const box = storageSlotBox(S, slotRef, legacySlot);
    return box ? box.amount : 0;
  }

  function storageSlotOccupied(S, slotRef, legacySlot = undefined) {
    return !!storageSlotBox(S, slotRef, legacySlot);
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
    const targetSlotId = normalizeSlotId(slotRef, deliveryBox.kind);
    const freeSlotId = targetSlotId || firstFreeStorageSlot(S);
    if (!freeSlotId) return { ok: false, reason: 'full' };
    if (storageSlotOccupied(S, freeSlotId)) return { ok: false, reason: 'occupied' };
    S.deliveryBoxes.splice(idx, 1);
    const pos = splitSlotId(freeSlotId);
    const box = {
      id: storageId(deliveryBox.kind),
      kind: deliveryBox.kind,
      amount: deliveryBox.amount,
      slotId: freeSlotId,
      rack: pos.rack,
      slot: pos.slot,
      source: deliveryBox.source || 'stored',
    };
    S.storageBoxes[box.kind].push(box);
    syncStorageTotals(S);
    return { ok: true, box, deliveryBox };
  }

  function takeSupply(S, kind, slotRef = null) {
    ensureState(S);
    const targetSlotId = normalizeSlotId(slotRef, kind);
    let box = null;
    if (!targetSlotId) {
      box = S.storageBoxes[kind].find(b => b.amount > 0) || null;
    } else {
      box = storageSlotBox(S, targetSlotId);
      if (box && box.kind !== kind) return { ok: false, reason: 'wrong_kind', kind, slotId: targetSlotId, box };
      if (!box && storageTotal(S, kind) > 0) return { ok: false, reason: 'empty_slot', kind, slotId: targetSlotId };
    }
    if (!box) return { ok: false, reason: 'empty', kind };
    box.amount--;
    const remaining = box.amount;
    const boxId = box.id;
    const usedSlot = box.slot;
    const usedSlotId = box.slotId;
    if (box.amount <= 0) S.storageBoxes[kind] = S.storageBoxes[kind].filter(b => b.id !== boxId);
    syncStorageTotals(S);
    return { ok: true, kind, boxId, slot: usedSlot, slotId: usedSlotId, remaining };
  }

  function returnSupply(S, kind, preferredBoxId = null, preferredSlotRef = null) {
    ensureState(S);
    let box = preferredBoxId && S.storageBoxes[kind].find(b => b.id === preferredBoxId);
    const targetSlotId = normalizeSlotId(preferredSlotRef, kind);
    if (!box && targetSlotId && !storageSlotOccupied(S, targetSlotId)) {
      const pos = splitSlotId(targetSlotId);
      box = { id: storageId(kind), kind, amount: 0, slotId: targetSlotId, rack: pos.rack, slot: pos.slot, source: 'returned' };
      S.storageBoxes[kind].push(box);
    }
    if (!box) box = S.storageBoxes[kind].find(b => b.amount > 0) || null;
    if (!box) {
      const freeSlotId = firstFreeStorageSlot(S);
      if (!freeSlotId) return { ok: false, reason: 'full' };
      const pos = splitSlotId(freeSlotId);
      box = { id: storageId(kind), kind, amount: 0, slotId: freeSlotId, rack: pos.rack, slot: pos.slot, source: 'returned' };
      S.storageBoxes[kind].push(box);
    }
    box.amount++;
    syncStorageTotals(S);
    return { ok: true, kind, boxId: box.id, slot: box.slot, slotId: box.slotId, amount: box.amount };
  }

  function putSupplyToStation(S, kind) {
    ensureState(S);
    if (S.stocks[kind] >= CAPACITY[kind]) return { ok: false, reason: 'full' };
    S.stocks[kind]++;
    return { ok: true, kind };
  }

  return {
    KINDS, CAPACITY, STORAGE_RACKS, STORAGE_SLOTS, STORAGE_SLOT_IDS, DOOR_RIGHT_SPOT, DELIVERY_BOX_SPACING,
    ensureState, deliveryPrice, scheduleDelivery, collectArrivals,
    initialState, addDeliveryBox, deliverySpot, moveDeliveryBox, storeDeliveryBox, takeSupply, returnSupply,
    putSupplyToStation, storageTotal, storageSlotBox, storageSlotAmount, storageSlotOccupied, firstFreeStorageSlot,
  };
})();
