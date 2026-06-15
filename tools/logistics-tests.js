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

function testStoreDeliveryBoxMovesToStorage() {
  const S = freshState();
  Logistics.ensureState(S);
  const box = Logistics.addDeliveryBox(S, 'cups', 40, 'scheduled');

  const result = Logistics.storeDeliveryBox(S, box.id);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(S.storage.cups, 40);
  assert.deepStrictEqual(plain(S.deliveryBoxes), []);
}

function testSingleUnitTransferFromStorageToStation() {
  const S = freshState();
  Logistics.ensureState(S);
  S.storage.beans = 2;
  S.stocks.beans = 29;

  const take = Logistics.takeSupply(S, 'beans');
  assert.deepStrictEqual(plain(take), { ok: true, kind: 'beans' });
  assert.strictEqual(S.storage.beans, 1);

  const put = Logistics.putSupplyToStation(S, 'beans');
  assert.deepStrictEqual(plain(put), { ok: true, kind: 'beans' });
  assert.strictEqual(S.stocks.beans, 30);

  const full = Logistics.putSupplyToStation(S, 'beans');
  assert.strictEqual(full.ok, false);
  assert.strictEqual(full.reason, 'full');
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
}

testInitialDeliveryStateHasFirstDayBeansOnlyAtDoorRight();
testEnsureState();
testScheduledDeliveriesMergeByKindOnArrival();
testStoreDeliveryBoxMovesToStorage();
testSingleUnitTransferFromStorageToStation();
testMoveDeliveryBoxStoresPositionAndQuarterTurns();

console.log('logistics tests passed');
