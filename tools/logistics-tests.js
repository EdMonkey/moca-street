#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = { console, window: {} };
vm.createContext(context);

for (const [file, expose] of [
  ['js/data.js', 'this.DATA = DATA;'],
  ['js/logistics.js', 'this.Logistics = Logistics;'],
]) {
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
    storage: { beans: 9, milk: 7, cups: 6, dessert: 5 },
  });

  assert.deepStrictEqual(plain(S.storage), { beans: 0, milk: 0, cups: 0, dessert: 0 });
  assert.deepStrictEqual(plain(S.storageBoxes), { beans: [], milk: [], cups: [], dessert: [] });
  assert.deepStrictEqual(plain(S.stocks), { beans: 34, milk: 25, cups: 36, dessert: 13 });
  assert.strictEqual(S.deliveryBoxes.length, 1);
  assert.strictEqual(S.deliveryBoxes[0].kind, 'beans');
  assert.strictEqual(S.deliveryBoxes[0].amount, DATA.RESTOCK.beans.amount);
  assert.strictEqual(S.deliveryBoxes[0].x, Logistics.DOOR_RIGHT_SPOT.x);
  assert.strictEqual(S.deliveryBoxes[0].z, Logistics.DOOR_RIGHT_SPOT.z);
  assert.strictEqual(S.deliveryBoxes[0].rot, Logistics.DOOR_RIGHT_SPOT.rot);
}

function testEnsureStateClearsLegacyShelfStorage() {
  const S = freshState();
  S.storage = { beans: 5, milk: 6, cups: 7, dessert: 8 };
  S.storageBoxes = {
    beans: [{ kind: 'beans', amount: 10, slotId: 'r0s0' }],
    milk: [],
    cups: [],
    dessert: [],
  };

  Logistics.ensureState(S);

  assert.deepStrictEqual(plain(S.storage), { beans: 0, milk: 0, cups: 0, dessert: 0 });
  assert.deepStrictEqual(plain(S.storageBoxes), { beans: [], milk: [], cups: [], dessert: [] });
  assert.deepStrictEqual(plain(S.stocks), { beans: 16, milk: 8, cups: 10, dessert: 12 });
  Logistics.ensureState(S);
  assert.deepStrictEqual(plain(S.stocks), { beans: 16, milk: 8, cups: 10, dessert: 12 });
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
}

function testStoreDeliveryBoxAddsGlobalStockOnly() {
  const S = freshState();
  Logistics.ensureState(S);
  const box = Logistics.addDeliveryBox(S, 'cups', 40, 'scheduled');

  const result = Logistics.storeDeliveryBox(S, box.id, 'r1s2');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.kind, 'cups');
  assert.strictEqual(result.amount, 40);
  assert.strictEqual(S.stocks.cups, 43);
  assert.deepStrictEqual(plain(S.storage), { beans: 0, milk: 0, cups: 0, dessert: 0 });
  assert.deepStrictEqual(plain(S.storageBoxes.cups), []);
  assert.deepStrictEqual(plain(S.deliveryBoxes), []);
}

function testStoreDeliveryBoxAllowsAnyCountWithoutShelfCapacity() {
  const S = freshState();
  Logistics.ensureState(S);
  const first = Logistics.addDeliveryBox(S, 'milk', 20, 'scheduled');
  Logistics.storeDeliveryBox(S, first.id, 'r0s1');
  const second = Logistics.addDeliveryBox(S, 'beans', 30, 'scheduled');

  const result = Logistics.storeDeliveryBox(S, second.id, 'r0s1');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(S.stocks.milk, 22);
  assert.strictEqual(S.stocks.beans, 31);
  assert.deepStrictEqual(plain(S.storageBoxes), { beans: [], milk: [], cups: [], dessert: [] });
}

function testTakeAndReturnSupplyUseGlobalStock() {
  const S = freshState();
  Logistics.ensureState(S);

  const take = Logistics.takeSupply(S, 'beans', 'r3s1');
  assert.strictEqual(take.ok, true);
  assert.strictEqual(take.kind, 'beans');
  assert.strictEqual(S.stocks.beans, 0);

  const empty = Logistics.takeSupply(S, 'beans', 'r3s1');
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.reason, 'empty');

  const put = Logistics.returnSupply(S, 'beans', null, 'r3s1');
  assert.strictEqual(put.ok, true);
  assert.strictEqual(S.stocks.beans, 1);
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
testEnsureStateClearsLegacyShelfStorage();
testScheduledDeliveriesMergeByKindOnArrival();
testDeliverySpotsLineUpAlongDoorRightWall();
testStoreDeliveryBoxAddsGlobalStockOnly();
testStoreDeliveryBoxAllowsAnyCountWithoutShelfCapacity();
testTakeAndReturnSupplyUseGlobalStock();
testMoveDeliveryBoxStoresPositionAndQuarterTurns();

console.log('logistics tests passed');
