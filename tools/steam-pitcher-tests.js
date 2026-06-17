#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const pitcherPath = path.join(root, 'js/pitchers.js');

assert.ok(fs.existsSync(pitcherPath), 'js/pitchers.js should exist');

const context = { console, window: {} };
vm.createContext(context);
const src = fs.readFileSync(pitcherPath, 'utf8');
vm.runInContext(`${src}\nthis.Pitchers = Pitchers;`, context, { filename: 'js/pitchers.js' });

const { Pitchers } = context;

function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

function freshState(milk = 3, location = 'fridge') {
  return {
    day: 1,
    stocks: { milk },
    storage: { milk: 0 },
    milkCartons: Array.from({ length: milk }, (_, i) => ({
      id: `milk_${i + 1}`,
      type: 'milkCarton',
      location,
      slotId: location === 'storage' ? 'r0s0' : null,
      servings: 3,
      crumpled: false,
      cold: location === 'fridge',
      outsideDays: location === 'fridge' ? 0 : 1,
      spoiled: false,
    })),
  };
}

function testInitialPitcherIsOnCounter() {
  const S = freshState();
  Pitchers.ensureState(S);

  assert.strictEqual(S.pitchers.items.length, 1);
  assert.strictEqual(S.pitchers.items[0].id, 'pitcher_1');
  assert.strictEqual(S.pitchers.items[0].rawMilk, 0);
  assert.strictEqual(S.pitchers.items[0].milk, 0);
  assert.strictEqual(S.pitchers.items[0].foam, 0);
}

function testTakeAndPlacePitcherPreservesContents() {
  const S = freshState();
  Pitchers.ensureState(S);

  const take = Pitchers.takePitcher(S, 'pitcher_1');
  assert.strictEqual(take.ok, true);
  assert.strictEqual(take.pitcher.type, 'pitcher');
  assert.strictEqual(S.pitchers.items.length, 0);

  take.pitcher.rawMilk = 1;
  const place = Pitchers.placePitcher(S, take.pitcher);
  assert.strictEqual(place.ok, true);
  assert.strictEqual(S.pitchers.items.length, 1);
  assert.strictEqual(S.pitchers.items[0].rawMilk, 1);
}

function testMilkFridgeCartonConsumesStock() {
  const S = freshState(2);
  const res = Pitchers.takeMilkCarton(S);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.carton.type, 'milkCarton');
  assert.strictEqual(res.carton.servings, 3);
  assert.strictEqual(res.carton.crumpled, false);
  assert.strictEqual(res.carton.location, 'held');
  assert.strictEqual(res.carton.cold, true);
  assert.strictEqual(S.stocks.milk, 2);
}

function testMilkFridgeBlocksWhenEmpty() {
  const S = freshState(2, 'storage');
  const res = Pitchers.takeMilkCarton(S);

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'empty');
  assert.strictEqual(S.stocks.milk, 2);
}

function testStarterMilkBeginsOnStorageShelfNotFridge() {
  const S = { day: 1, stocks: { milk: 0 }, storage: { milk: 0 } };
  Pitchers.ensureMilkState(S, { starterMilk: 2 });

  assert.strictEqual(S.milkCartons.length, 2);
  assert.strictEqual(S.milkCartons.every(c => c.location === 'storage'), true);
  assert.strictEqual(Pitchers.milkLocationCount(S, 'fridge'), 0);
  assert.strictEqual(S.stocks.milk, 2);
  assert.strictEqual(S.storage.milk, 0);
}

function testMilkMovesStorageToFridgeWithoutChangingTotalStock() {
  const S = freshState(2, 'storage');
  const take = Pitchers.takeMilkFromStorage(S, 'r0s0');
  assert.strictEqual(take.ok, true);
  assert.strictEqual(take.carton.location, 'held');
  assert.strictEqual(S.stocks.milk, 2);

  const store = Pitchers.putMilkInFridge(S, take.carton);
  assert.strictEqual(store.ok, true);
  assert.strictEqual(take.carton.location, 'fridge');
  assert.strictEqual(take.carton.cold, true);
  assert.strictEqual(Pitchers.milkLocationCount(S, 'fridge'), 1);
  assert.strictEqual(S.stocks.milk, 2);

  const out = Pitchers.takeMilkCarton(S);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.carton.id, take.carton.id);
  assert.strictEqual(out.carton.location, 'held');
  assert.strictEqual(out.carton.cold, true);
  assert.strictEqual(S.stocks.milk, 2);
}

function testMilkSpoilsAfterFiveOutsideDaysButNotInFridge() {
  const S = {
    day: 1,
    stocks: { milk: 2 },
    storage: { milk: 0 },
    milkCartons: [
      { id: 'outside', type: 'milkCarton', location: 'storage', slotId: 'r0s0', servings: 3, crumpled: false, cold: false, outsideDays: 0, spoiled: false },
      { id: 'cold', type: 'milkCarton', location: 'fridge', servings: 3, crumpled: false, cold: true, outsideDays: 0, spoiled: false },
    ],
  };

  Pitchers.advanceMilkAging(S, 4);
  assert.strictEqual(S.milkCartons.find(c => c.id === 'outside').spoiled, false);
  assert.strictEqual(S.stocks.milk, 2);

  Pitchers.advanceMilkAging(S, 1);
  assert.strictEqual(S.milkCartons.find(c => c.id === 'outside').spoiled, true);
  assert.strictEqual(S.milkCartons.find(c => c.id === 'cold').spoiled, false);
  assert.strictEqual(S.stocks.milk, 1);
}

function testSpoiledMilkCannotBePoured() {
  const pitcher = { type: 'pitcher', rawMilk: 0, milk: 0, foam: 0 };
  const carton = { type: 'milkCarton', servings: 3, crumpled: false, spoiled: true };
  const res = Pitchers.pourCartonIntoPitcher(pitcher, carton);

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'carton_spoiled');
  assert.strictEqual(pitcher.rawMilk, 0);
}

function testPourCartonIntoEmptyPitcherOnly() {
  const pitcher = { type: 'pitcher', rawMilk: 0, milk: 0, foam: 0 };
  const res = Pitchers.pourCartonIntoPitcher(pitcher);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(pitcher.rawMilk, 1);

  const second = Pitchers.pourCartonIntoPitcher(pitcher);
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reason, 'not_empty');
}

function testMilkCartonTurnsCrumpledAfterThreePours() {
  const carton = { type: 'milkCarton', servings: 3, crumpled: false };

  for (let i = 2; i >= 0; i--) {
    const pitcher = { type: 'pitcher', rawMilk: 0, milk: 0, foam: 0 };
    const res = Pitchers.pourCartonIntoPitcher(pitcher, carton);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(pitcher.rawMilk, 1);
    assert.strictEqual(carton.servings, i);
    assert.strictEqual(carton.crumpled, i === 0);
  }

  const emptyPitcher = { type: 'pitcher', rawMilk: 0, milk: 0, foam: 0 };
  const fourth = Pitchers.pourCartonIntoPitcher(emptyPitcher, carton);
  assert.strictEqual(fourth.ok, false);
  assert.strictEqual(fourth.reason, 'carton_empty');
  assert.strictEqual(carton.crumpled, true);
}

function testSteamRequiresRawMilkThenCreatesFoam() {
  const empty = { type: 'pitcher', rawMilk: 0, milk: 0, foam: 0 };
  assert.strictEqual(Pitchers.steamPitcher(empty).reason, 'empty');

  const pitcher = { type: 'pitcher', rawMilk: 1, milk: 0, foam: 0 };
  const steamed = Pitchers.steamPitcher(pitcher, false);
  assert.strictEqual(steamed.ok, true);
  assert.strictEqual(steamed.stage, 'milk');
  assert.strictEqual(pitcher.rawMilk, 0);
  assert.strictEqual(pitcher.milk, 1);
  assert.strictEqual(Pitchers.canPourToDrink(pitcher), true);

  const foam = Pitchers.steamPitcher(pitcher, true);
  assert.strictEqual(foam.ok, true);
  assert.strictEqual(foam.stage, 'foam');
  assert.strictEqual(pitcher.foam, 1);
  assert.strictEqual(pitcher.perfectFoam, true);
}

function testRawMilkCannotPourToCup() {
  const raw = { type: 'pitcher', rawMilk: 1, milk: 0, foam: 0 };
  const steamed = { type: 'pitcher', rawMilk: 0, milk: 1, foam: 0 };

  assert.strictEqual(Pitchers.canPourToDrink(raw), false);
  assert.strictEqual(Pitchers.canPourToDrink(steamed), true);
}

function testAddPitcherCreatesAnotherCounterPitcher() {
  const S = freshState();
  Pitchers.ensureState(S);

  const res = Pitchers.addPitcher(S);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.pitcher.id, 'pitcher_2');
  assert.strictEqual(S.pitchers.items.length, 2);
}

testInitialPitcherIsOnCounter();
testTakeAndPlacePitcherPreservesContents();
testMilkFridgeCartonConsumesStock();
testMilkFridgeBlocksWhenEmpty();
testStarterMilkBeginsOnStorageShelfNotFridge();
testMilkMovesStorageToFridgeWithoutChangingTotalStock();
testMilkSpoilsAfterFiveOutsideDaysButNotInFridge();
testSpoiledMilkCannotBePoured();
testPourCartonIntoEmptyPitcherOnly();
testMilkCartonTurnsCrumpledAfterThreePours();
testSteamRequiresRawMilkThenCreatesFoam();
testRawMilkCannotPourToCup();
testAddPitcherCreatesAnotherCounterPitcher();

console.log('steam pitcher tests passed');
