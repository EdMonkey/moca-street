#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const world = fs.readFileSync(path.join(root, 'js/world.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

[
  'STORAGE_SLOT_LEVELS',
  "{ id: 'restock', kind: k, slot: s.slot }",
  'env.setStoragePreview = function (kind, slot',
  'syncStorageBoxes',
  'makeBoxMesh(box.kind)',
].forEach(needle => assert.ok(world.includes(needle), `world missing: ${needle}`));

[
  'storeHeldDelivery(it.kind, it.slot)',
  'takeStorageSupply(it.kind, it.slot)',
  'Logistics.storageSlotOccupied(S, aimData.kind, aimData.slot)',
  'held.storageBoxId',
  'Logistics.returnSupply(S, held.kind',
].forEach(needle => assert.ok(game.includes(needle), `game missing: ${needle}`));

[
  'Logistics.storageSlotAmount',
  'Logistics.storageTotal',
].forEach(needle => assert.ok(ui.includes(needle), `ui missing: ${needle}`));

console.log('storage slot tests passed');
