/* ============================================================
 * pitchers.js — 스팀피처 개별 상태와 우유 준비 흐름
 * ============================================================ */
const Pitchers = (() => {
  const MILK_SPOIL_DAYS = 5;
  let milkSeq = 1;

  function emptyPitcher(id, slot = 0) {
    return { id, rawMilk: 0, milk: 0, foam: 0, perfectFoam: false, slot };
  }

  function normalizePitcher(p, index = 0) {
    return {
      id: p.id || `pitcher_${index + 1}`,
      rawMilk: p.rawMilk ? 1 : 0,
      milk: p.milk ? 1 : 0,
      foam: p.foam ? 1 : 0,
      perfectFoam: !!p.perfectFoam,
      freshAt: p.freshAt,
      slot: Number.isFinite(p.slot) ? p.slot : index,
    };
  }

  function ensureState(S) {
    if (!S.pitchers) {
      S.pitchers = { nextId: 2, items: [emptyPitcher('pitcher_1', 0)] };
      return S;
    }
    const items = Array.isArray(S.pitchers.items) ? S.pitchers.items : [];
    S.pitchers.items = items.map(normalizePitcher);
    if (S.pitchers.items.length === 0 && !S.pitchers.wasInitialized) {
      S.pitchers.items.push(emptyPitcher('pitcher_1', 0));
    }
    const maxId = S.pitchers.items.reduce((max, p) => {
      const n = Number(String(p.id || '').match(/(\d+)$/)?.[1] || 0);
      return Math.max(max, n);
    }, 1);
    S.pitchers.nextId = Math.max(Number(S.pitchers.nextId) || 1, maxId + 1);
    S.pitchers.wasInitialized = true;
    return S;
  }

  function nextSlot(S) {
    ensureState(S);
    const used = new Set(S.pitchers.items.map(p => p.slot));
    for (let i = 0; i < 20; i++) if (!used.has(i)) return i;
    return S.pitchers.items.length;
  }

  function toHeld(p) {
    return Object.assign({ type: 'pitcher' }, normalizePitcher(p));
  }

  function fromHeld(p, slot) {
    const out = normalizePitcher(p);
    out.slot = Number.isFinite(slot) ? slot : out.slot;
    return out;
  }

  function takePitcher(S, id) {
    ensureState(S);
    const i = S.pitchers.items.findIndex(p => p.id === id);
    if (i < 0) return { ok: false, reason: 'missing' };
    const [p] = S.pitchers.items.splice(i, 1);
    return { ok: true, pitcher: toHeld(p) };
  }

  function placePitcher(S, pitcher, slot = null) {
    ensureState(S);
    if (!pitcher || pitcher.type !== 'pitcher') return { ok: false, reason: 'not_pitcher' };
    const targetSlot = Number.isFinite(slot) ? slot : nextSlot(S);
    if (S.pitchers.items.some(p => p.slot === targetSlot)) return { ok: false, reason: 'occupied' };
    const p = fromHeld(pitcher, targetSlot);
    S.pitchers.items.push(p);
    S.pitchers.items.sort((a, b) => a.slot - b.slot);
    return { ok: true, pitcher: p };
  }

  function addPitcher(S) {
    ensureState(S);
    const id = `pitcher_${S.pitchers.nextId++}`;
    const pitcher = emptyPitcher(id, nextSlot(S));
    S.pitchers.items.push(pitcher);
    S.pitchers.items.sort((a, b) => a.slot - b.slot);
    return { ok: true, pitcher };
  }

  function milkId() {
    return `milk_${Date.now().toString(36)}_${milkSeq++}`;
  }

  function newMilkCarton(extra = {}) {
    return normalizeMilkCarton(Object.assign({
      id: milkId(),
      type: 'milkCarton',
      location: 'storage',
      servings: 3,
      crumpled: false,
      cold: false,
      outsideDays: 0,
      spoiled: false,
    }, extra));
  }

  function normalizeMilkCarton(carton, index = 0) {
    const c = carton || {};
    const locations = ['storage', 'fridge', 'held', 'placed'];
    const location = locations.includes(c.location) ? c.location : 'storage';
    const servings = Number.isFinite(c.servings) ? c.servings : (c.crumpled ? 0 : 3);
    const out = Object.assign(c, {
      id: c.id || `milk_${index + 1}`,
      type: 'milkCarton',
      location,
      servings: Math.max(0, Math.min(3, Math.floor(servings))),
      crumpled: !!c.crumpled || servings <= 0,
      cold: location === 'fridge' || !!c.cold,
      outsideDays: location === 'fridge' ? 0 : Math.max(0, Number(c.outsideDays) || 0),
      spoiled: !!c.spoiled,
    });
    out.slotId = null;
    return out;
  }

  function syncMilkStock(S) {
    if (!S.stocks) S.stocks = {};
    if (!S.storage) S.storage = {};
    const usable = (S.milkCartons || []).filter(c => !c.crumpled && !c.spoiled).length;
    S.stocks.milk = usable;
    S.storage.milk = 0;
    return usable;
  }

  function ensureMilkState(S, opts = {}) {
    if (!S.stocks) S.stocks = {};
    if (!S.storage) S.storage = {};
    const legacyBoxes = S.storageBoxes && Array.isArray(S.storageBoxes.milk) ? S.storageBoxes.milk.slice() : [];
    if (!Array.isArray(S.milkCartons)) {
      const count = Number.isFinite(opts.starterMilk)
        ? opts.starterMilk
        : Math.max(0, Number(S.stocks.milk) || Number(S.storage.milk) || 0);
      S.milkCartons = Array.from({ length: count }, (_, i) => newMilkCarton({
        id: `milk_${i + 1}`,
        location: 'storage',
      }));
    }
    if (legacyBoxes.length) {
      legacyBoxes.forEach(box => {
        const amount = Math.max(0, Number(box.amount) || 0);
        for (let i = 0; i < amount; i++) {
          S.milkCartons.push(newMilkCarton({
            location: 'storage',
            outsideDays: 0,
          }));
        }
      });
    }
    S.milkCartons = S.milkCartons.map((c, i) => normalizeMilkCarton(c, i));
    if (S.storageBoxes && Array.isArray(S.storageBoxes.milk)) S.storageBoxes.milk = [];
    syncMilkStock(S);
    return S;
  }

  function milkLocationCount(S, location) {
    ensureMilkState(S);
    return S.milkCartons.filter(c => c.location === location && !c.crumpled && !c.spoiled).length;
  }

  function milkCartonsForLocation(S, location) {
    ensureMilkState(S);
    return S.milkCartons.filter(c => c.location === location && !c.crumpled);
  }

  function milkAtStorageSlot(S, slotId) {
    ensureMilkState(S);
    return S.milkCartons.find(c => c.location === 'storage' && !c.crumpled) || null;
  }

  function takeMilkFromStorage(S, slotId = null) {
    ensureMilkState(S);
    const carton = S.milkCartons.find(c =>
      c.location === 'storage' && !c.crumpled
    );
    if (!carton) return { ok: false, reason: 'empty' };
    carton.location = 'held';
    carton.slotId = null;
    syncMilkStock(S);
    return { ok: true, carton };
  }

  function putMilkInStorage(S, carton, slotId = null) {
    ensureMilkState(S);
    const c = carton && carton.id
      ? S.milkCartons.find(x => x.id === carton.id) || carton
      : carton;
    if (!c || c.type !== 'milkCarton') return { ok: false, reason: 'not_milk' };
    if (!S.milkCartons.some(x => x.id === c.id)) S.milkCartons.push(c);
    normalizeMilkCarton(c);
    c.location = 'storage';
    c.slotId = null;
    c.cold = false;
    syncMilkStock(S);
    return { ok: true, carton: c };
  }

  function putMilkInFridge(S, carton) {
    ensureMilkState(S);
    const c = carton && carton.id
      ? S.milkCartons.find(x => x.id === carton.id) || carton
      : carton;
    if (!c || c.type !== 'milkCarton') return { ok: false, reason: 'not_milk' };
    if (c.crumpled) return { ok: false, reason: 'empty_carton' };
    if (c.spoiled) return { ok: false, reason: 'spoiled' };
    if (!S.milkCartons.some(x => x.id === c.id)) S.milkCartons.push(c);
    normalizeMilkCarton(c);
    c.location = 'fridge';
    c.slotId = null;
    c.cold = true;
    c.outsideDays = 0;
    syncMilkStock(S);
    return { ok: true, carton: c };
  }

  function advanceMilkAging(S, days = 1) {
    ensureMilkState(S);
    const d = Math.max(0, Number(days) || 0);
    S.milkCartons.forEach(c => {
      if (c.crumpled || c.spoiled || c.location === 'fridge') return;
      c.outsideDays = Math.max(0, Number(c.outsideDays) || 0) + d;
      if (c.outsideDays >= MILK_SPOIL_DAYS) c.spoiled = true;
      if (c.location === 'storage' || c.location === 'placed') c.cold = false;
    });
    syncMilkStock(S);
    return S;
  }

  function takeMilkCarton(S) {
    ensureMilkState(S);
    const carton = S.milkCartons.find(c => c.location === 'fridge' && !c.crumpled && !c.spoiled);
    if (!carton) return { ok: false, reason: 'empty' };
    carton.location = 'held';
    carton.slotId = null;
    carton.cold = true;
    syncMilkStock(S);
    return { ok: true, carton };
  }

  function isEmpty(pitcher) {
    return !pitcher.rawMilk && !pitcher.milk && !pitcher.foam;
  }

  function normalizeCarton(carton) {
    if (!carton || carton.type !== 'milkCarton') return null;
    const servings = Number.isFinite(carton.servings) ? carton.servings : (carton.crumpled ? 0 : 3);
    carton.servings = Math.max(0, Math.min(3, Math.floor(servings)));
    carton.crumpled = !!carton.crumpled || carton.servings <= 0;
    carton.spoiled = !!carton.spoiled;
    return carton;
  }

  function pourCartonIntoPitcher(pitcher, carton = null) {
    if (!pitcher || pitcher.type !== 'pitcher') return { ok: false, reason: 'not_pitcher' };
    const milkCarton = normalizeCarton(carton);
    if (carton && (!milkCarton || milkCarton.crumpled || milkCarton.servings <= 0)) return { ok: false, reason: 'carton_empty' };
    if (milkCarton && milkCarton.spoiled) return { ok: false, reason: 'carton_spoiled' };
    if (!isEmpty(pitcher)) return { ok: false, reason: 'not_empty' };
    pitcher.rawMilk = 1;
    pitcher.milk = 0;
    pitcher.foam = 0;
    pitcher.perfectFoam = false;
    if (milkCarton) {
      milkCarton.servings = Math.max(0, milkCarton.servings - 1);
      milkCarton.crumpled = milkCarton.servings <= 0;
    }
    return { ok: true, pitcher, carton: milkCarton };
  }

  function steamPitcher(pitcher, perfect = false) {
    if (!pitcher || pitcher.type !== 'pitcher') return { ok: false, reason: 'not_pitcher' };
    if (pitcher.foam) return { ok: false, reason: 'done' };
    if (pitcher.rawMilk) {
      pitcher.rawMilk = 0;
      pitcher.milk = 1;
      pitcher.foam = 0;
      pitcher.perfectFoam = false;
      return { ok: true, stage: 'milk', pitcher };
    }
    if (pitcher.milk) {
      pitcher.foam = 1;
      pitcher.perfectFoam = !!perfect;
      return { ok: true, stage: 'foam', pitcher };
    }
    return { ok: false, reason: 'empty' };
  }

  function canPourToDrink(pitcher) {
    return !!(pitcher && !pitcher.rawMilk && (pitcher.milk || pitcher.foam));
  }

  function label(pitcher) {
    if (!pitcher || pitcher.type !== 'pitcher') return '';
    if (pitcher.foam) return '스팀피처 (우유+거품)';
    if (pitcher.milk) return '스팀피처 (스팀 우유)';
    if (pitcher.rawMilk) return '스팀피처 (차가운 우유)';
    return '스팀피처 (비어 있음)';
  }

  return {
    ensureState, takePitcher, placePitcher, addPitcher,
    ensureMilkState, newMilkCarton, milkLocationCount, milkCartonsForLocation, milkAtStorageSlot,
    takeMilkFromStorage, putMilkInStorage, putMilkInFridge, advanceMilkAging,
    takeMilkCarton, pourCartonIntoPitcher, steamPitcher, canPourToDrink,
    label,
  };
})();
