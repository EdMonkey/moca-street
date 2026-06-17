#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const index = read('index.html');
const data = read('js/data.js');
const game = read('js/game.js');
const ui = read('js/ui.js');
const world = read('js/world.js');

function includesAll(haystack, needles, label) {
  needles.forEach(n => assert.ok(haystack.includes(n), `${label} missing: ${n}`));
}

includesAll(index, [
  'js/pitchers.js',
  'js/logistics.js',
  'js/world.js',
], 'script order');
assert.ok(index.indexOf('js/pitchers.js') > index.indexOf('js/logistics.js'), 'pitchers should load after logistics');
assert.ok(index.indexOf('js/pitchers.js') < index.indexOf('js/world.js'), 'pitchers should load before world/game');

includesAll(data, [
  'pitcher:',
  '추가 스팀피처',
], 'pitcher equipment data');

includesAll(world, [
  'function makeMilkFridgeMesh(open)',
  'function makeMilkCartonMesh(state = {})',
  "textLabel('빈 우유'",
  'env.syncPitchers',
  "id: 'milkFridgeDoor'",
  "id: 'milkFridgeMilk'",
  "id: 'pitcherSpot'",
], 'world pitcher/fridge scene');

includesAll(game, [
  'Pitchers.ensureState(S)',
  'Pitchers.ensureMilkState(S',
  'S.milkCartons',
  'syncPitchers()',
  'syncMilkFridgeMilk(true)',
  "stocks: { beans: 25, milk: starter ? 2 : 0, cups: 30, dessert: 8 }",
  "storage: { beans: 0, milk: 0, cups: 0, dessert: 0 }",
  "milkFridgeOpen",
  "id === 'milkFridge'",
  "id === 'milkFridgeMilk'",
  "held.type === 'milkCarton'",
  'Pitchers.putMilkInFridge(S',
  "Pitchers.milkLocationCount(S, 'fridge')",
  'Pitchers.advanceMilkAging(S, 1)',
  'Pitchers.takeMilkCarton(S)',
  'Pitchers.pourCartonIntoPitcher',
  'Pitchers.steamPitcher',
  'Pitchers.canPourToDrink',
  'Pitchers.addPitcher(S)',
  'function seedLooseMilkCartons()',
  'function restoreLooseMilkCartons()',
  'placeLooseItem(carton, point, { silent: true })',
], 'game pitcher/fridge flow');

assert.ok(!game.includes("item.type === 'deliveryBox' || item.type === 'supply' || item.type === 'milkCarton'"), 'milk cartons should be placeable on surfaces');
includesAll(game, [
  "mesh = WORLD.makeMilkCartonMesh(item);",
  "WORLD.makeMilkCartonMesh(item)",
  "function refreshPlacedMilkCarton(rec)",
  "held && held.type === 'pitcher' && rec.item.type === 'milkCarton'",
  "Pitchers.pourCartonIntoPitcher(held, rec.item)",
  "Pitchers.pourCartonIntoPitcher(rec.item, held)",
  "item.type === 'milkCarton' || item.type === 'shotglass' || item.type === 'pitcher' || item.type === 'drink'",
  "resetStations({ keepPrepTools: true })",
  "held.crumpled",
  "구겨진 우유곽",
], 'placed milk carton flow');
assert.ok(game.includes("item.type !== 'deliveryBox' && item.type !== 'supply'"), 'milk carton should be placeable from prep/open/end modes');

includesAll(game, [
  'let itemPlaceRot = 0;',
  'let itemPlacePreview = null;',
  'function placedItemRadius(item)',
  'function isSurfacePlaceableItem(item)',
  'function makePlacedItemMesh(item)',
  'function updateItemPlacePreview(item, point, ok = true)',
  'function rotateHeldItemPreview()',
  'ghostMat',
  'mesh.rotation.y = itemPlaceRot;',
  'placeBlocked(pt, held)',
  "rec.item.type === 'milkCarton'",
], 'placed item pickup and preview flow');
assert.ok(!game.includes('env.placeIndicator.position.set(placePoint.x'), 'surface item placement should not show floor ring');
assert.ok(
  game.indexOf("if (id === 'placedItem')") < game.indexOf("if (mode === 'prep' || mode === 'after') {"),
  'placed items should be usable before prep/after interaction guard'
);
assert.ok(
  game.indexOf("else if (ev.code === 'KeyR' && rotateHeldItemPreview()) return;") <
  game.indexOf("else if (ev.code === 'KeyR') $('recipeBook').classList.toggle('hidden');"),
  'R should rotate held item preview before recipe book toggle'
);

assert.ok(!game.includes("pitcherrack: 'milk'"), 'milk restock target should be removed from pitcherrack');
assert.ok(!game.includes("milkFridge: 'milk'"), 'milk fridge should no longer be a numeric restock target');
assert.ok(!game.includes('const stationTargets'), 'station restock target map should be removed');

includesAll(ui, [
  'milkCarton',
  'milkFridge',
  'milkFridgeMilk',
  '차가운 우유',
], 'ui prompts');
assert.ok(ui.includes("tgt.type === 'milkCarton'"), 'ui should prompt pitcher pouring from placed milk carton');

console.log('steam pitcher integration tests passed');
