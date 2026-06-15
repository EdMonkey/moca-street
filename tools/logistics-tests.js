#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = {
  console,
  window: {},
};
vm.createContext(context);

const files = [
  ['js/data.js', 'this.DATA = DATA;'],
  ['js/logistics.js', 'this.Logistics = Logistics;'],
];
for (const [file, expose] of files) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(`${src}\n${expose}`, context, { filename: file });
}

const { DATA, Logistics } = context;

function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

function freshState() {
  return {
    money: 20000,
    day: 2,
    stocks: { beans: 1, milk: 2, cups: 3, dessert: 4 },
  };
}

function testInitialDeliveryStateHasFirstDayBeansOnlyAtDoorRight() {
  const S = Logistics.initialState({
    money: 20000,
    day: 1,
    stocks: { beans: 25, milk: 18, cups: 30, dessert: 8 },
    storage: { beans: 0, milk: 0, cups: 0, dessert: 0 },
  });

  assert.deepStrictEqual(plain(S.storage), { beans: 0, milk: 0, cups: 0, dessert: 0 });
  assert.strictEqual(S.deliveryBoxes.length, 1);
  assert.strictEqual(S.deliveryBoxes[0].kind, 'beans');
  assert.strictEqual(S.deliveryBoxes[0].amount, DATA.RESTOCK.beans.amount);
  assert.strictEqual(S.deliveryBoxes[0].x, Logistics.DOOR_RIGHT_SPOT.x);
  assert.strictEqual(S.deliveryBoxes[0].z, Logistics.DOOR_RIGHT_SPOT.z);
  assert.strictEqual(S.deliveryBoxes[0].rot, Logistics.DOOR_RIGHT_SPOT.rot);
}

function testEnsureState() {
  const S = freshState();
  Logistics.ensureState(S);
  assert.deepStrictEqual(plain(S.storage), { beans: 0, milk: 0, cups: 0, dessert: 0 });
  assert.deepStrictEqual(plain(S.pendingDeliveries), []);
  assert.deepStrictEqual(plain(S.deliveryBoxes), []);
}

function testScheduledDeliveriesMergeByKindOnArrival() {
  const S = freshState();
  Logistics.ensureState(S);
  Logistics.scheduleDelivery(S, 'beans', 2, 2);
  Logistics.scheduleDelivery(S, 'beans', 1, 2);
  Logistics.scheduleDelivery(S, 'milk', 1, 2);

  const created = Logistics.collectArrivals(S, 3);

  assert.strictEqual(created.length, 2);
  assert.deepStrictEqual(
    plain(S.deliveryBoxes.map(b => [b.kind, b.amount]).sort()),
    [['beans', DATA.RESTOCK.beans.amount * 3], ['milk', DATA.RESTOCK.milk.amount]]
  );
  S.deliveryBoxes.forEach(b => {
    assert.strictEqual(typeof b.x, 'number');
    assert.strictEqual(typeof b.z, 'number');
    assert.strictEqual(typeof b.rot, 'number');
  });
  assert.deepStrictEqual(plain(S.pendingDeliveries), []);
}

function testDeliverySpotsLineUpAlongDoorRightWall() {
  const spots = Array.from({ length: 6 }, (_, i) => Logistics.deliverySpot(i));

  assert.strictEqual(spots[0].x, Logistics.DOOR_RIGHT_SPOT.x);
  assert.strictEqual(spots[0].z, Logistics.DOOR_RIGHT_SPOT.z);
  spots.forEach((spot, i) => {
    assert.strictEqual(spot.z, Logistics.DOOR_RIGHT_SPOT.z);
    assert.strictEqual(spot.rot, 0);
    if (i > 0) assert.ok(spot.x - spots[i - 1].x >= 0.72, 'delivery boxes should not overlap');
  });
  assert.strictEqual(new Set(spots.map(s => `${s.x},${s.z}`)).size, spots.length);
}

function testAutoDeliveryBoxesUseLineSpots() {
  const S = freshState();
  Logistics.ensureState(S);
  Logistics.KINDS.forEach(kind => Logistics.addDeliveryBox(S, kind, DATA.RESTOCK[kind].amount, 'scheduled'));

  assert.strictEqual(S.deliveryBoxes.length, Logistics.KINDS.length);
  S.deliveryBoxes.forEach((box, i) => {
    const spot = Logistics.deliverySpot(i);
    assert.strictEqual(box.x, spot.x);
    assert.strictEqual(box.z, spot.z);
    assert.strictEqual(box.rot, spot.rot);
    assert.strictEqual(box.autoSpot, true);
  });
}

function testStoreDeliveryBoxMovesToStorage() {
  const S = freshState();
  Logistics.ensureState(S);
  const box = Logistics.addDeliveryBox(S, 'cups', 40, 'scheduled');

  const result = Logistics.storeDeliveryBox(S, box.id, 'r1s2');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(S.storage.cups, 40);
  assert.strictEqual(Logistics.storageTotal(S, 'cups'), 40);
  assert.strictEqual(S.storageBoxes.cups.length, 1);
  assert.strictEqual(S.storageBoxes.cups[0].slotId, 'r1s2');
  assert.strictEqual(S.storageBoxes.cups[0].amount, 40);
  assert.deepStrictEqual(plain(S.deliveryBoxes), []);
}

function testSingleUnitTransferFromStorageToStation() {
  const S = freshState();
  Logistics.ensureState(S);
  const box = Logistics.addDeliveryBox(S, 'beans', 2, 'scheduled');
  Logistics.storeDeliveryBox(S, box.id, 'r3s1');
  S.stocks.beans = 29;

  const take = Logistics.takeSupply(S, 'beans', 'r3s1');
  assert.strictEqual(take.ok, true);
  assert.strictEqual(take.kind, 'beans');
  assert.strictEqual(take.slotId, 'r3s1');
  assert.strictEqual(S.storage.beans, 1);
  assert.strictEqual(S.storageBoxes.beans[0].amount, 1);

  const put = Logistics.putSupplyToStation(S, 'beans');
  assert.deepStrictEqual(plain(put), { ok: true, kind: 'beans' });
  assert.strictEqual(S.stocks.beans, 30);

  const full = Logistics.putSupplyToStation(S, 'beans');
  assert.strictEqual(full.ok, false);
  assert.strictEqual(full.reason, 'full');
}

function testOccupiedShelfSlotRejectsSecondBox() {
  const S = freshState();
  Logistics.ensureState(S);
  const first = Logistics.addDeliveryBox(S, 'milk', 20, 'scheduled');
  Logistics.storeDeliveryBox(S, first.id, 'r0s1');
  const second = Logistics.addDeliveryBox(S, 'beans', 30, 'scheduled');

  const result = Logistics.storeDeliveryBox(S, second.id, 'r0s1');

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'occupied');
  assert.strictEqual(S.deliveryBoxes.length, 1);
  assert.strictEqual(S.storageBoxes.milk.length, 1);
  assert.strictEqual(S.storage.milk, 20);
  assert.strictEqual(S.storage.beans, 0);
}

function testEmptyShelfSlotDoesNotDrainAnotherShelf() {
  const S = freshState();
  Logistics.ensureState(S);
  const box = Logistics.addDeliveryBox(S, 'beans', 2, 'scheduled');
  Logistics.storeDeliveryBox(S, box.id, 'r0s1');

  const result = Logistics.takeSupply(S, 'beans', 'r0s2');

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'empty_slot');
  assert.strictEqual(S.storage.beans, 2);
  assert.strictEqual(S.storageBoxes.beans[0].slotId, 'r0s1');
  assert.strictEqual(S.storageBoxes.beans[0].amount, 2);
}

function testShelfBoxDisappearsWhenAmountIsZero() {
  const S = freshState();
  Logistics.ensureState(S);
  const box = Logistics.addDeliveryBox(S, 'beans', 2, 'scheduled');
  Logistics.storeDeliveryBox(S, box.id, 'r2s2');

  Logistics.takeSupply(S, 'beans', 'r2s2');
  const result = Logistics.takeSupply(S, 'beans', 'r2s2');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.remaining, 0);
  assert.strictEqual(S.storage.beans, 0);
  assert.deepStrictEqual(plain(S.storageBoxes.beans), []);
}

function testAnyShelfCanStoreAnyKind() {
  const S = freshState();
  Logistics.ensureState(S);
  const beans = Logistics.addDeliveryBox(S, 'beans', 30, 'scheduled');
  const milk = Logistics.addDeliveryBox(S, 'milk', 20, 'scheduled');

  const beansResult = Logistics.storeDeliveryBox(S, beans.id, 'r3s0');
  const milkResult = Logistics.storeDeliveryBox(S, milk.id, 'r0s2');

  assert.strictEqual(beansResult.ok, true);
  assert.strictEqual(beansResult.box.slotId, 'r3s0');
  assert.strictEqual(milkResult.ok, true);
  assert.strictEqual(milkResult.box.slotId, 'r0s2');
  assert.strictEqual(Logistics.storageSlotBox(S, 'r3s0').kind, 'beans');
  assert.strictEqual(Logistics.storageSlotBox(S, 'r0s2').kind, 'milk');
}

function testLegacyStorageTotalsMigrateToShelfBox() {
  const S = freshState();
  S.storage = { beans: 5, milk: 0, cups: 0, dessert: 0 };

  Logistics.ensureState(S);

  assert.strictEqual(S.storage.beans, 5);
  assert.strictEqual(S.storageBoxes.beans.length, 1);
  assert.strictEqual(S.storageBoxes.beans[0].slotId, 'r0s0');
  assert.strictEqual(S.storageBoxes.beans[0].amount, 5);
}

function testMoveDeliveryBoxStoresPositionAndQuarterTurns() {
  const S = freshState();
  Logistics.ensureState(S);
  const box = Logistics.addDeliveryBox(S, 'milk', DATA.RESTOCK.milk.amount, 'scheduled');

  const moved = Logistics.moveDeliveryBox(S, box.id, { x: 4.2, z: 8.8, rot: Math.PI / 2 });

  assert.strictEqual(moved.ok, true);
  assert.strictEqual(box.x, 4.2);
  assert.strictEqual(box.z, 8.8);
  assert.strictEqual(box.rot, Math.PI / 2);
  assert.strictEqual(box.autoSpot, false);
  Logistics.ensureState(S);
  assert.strictEqual(box.x, 4.2);
  assert.strictEqual(box.z, 8.8);
}

testInitialDeliveryStateHasFirstDayBeansOnlyAtDoorRight();
testEnsureState();
testScheduledDeliveriesMergeByKindOnArrival();
testDeliverySpotsLineUpAlongDoorRightWall();
testAutoDeliveryBoxesUseLineSpots();
testStoreDeliveryBoxMovesToStorage();
testSingleUnitTransferFromStorageToStation();
testOccupiedShelfSlotRejectsSecondBox();
testEmptyShelfSlotDoesNotDrainAnotherShelf();
testShelfBoxDisappearsWhenAmountIsZero();
testAnyShelfCanStoreAnyKind();
testLegacyStorageTotalsMigrateToShelfBox();
testMoveDeliveryBoxStoresPositionAndQuarterTurns();

console.log('logistics tests passed');
