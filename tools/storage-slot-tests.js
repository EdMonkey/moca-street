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
  'STORAGE_RACKS',
  '{ slot: 0, y: 0.56 }',
  '{ slot: 1, y: 1.12 }',
  '{ slot: 2, y: 1.68 }',
  'slotId',
  "{ id: 'restock', rack: r.rack, slot: s.slot, slotId }",
  'env.setStoragePreview = function (slotId',
  'syncStorageBoxes',
  'makeBoxMesh(box.kind)',
].forEach(needle => assert.ok(world.includes(needle), `world missing: ${needle}`));

[
  'storeHeldDelivery(it.slotId)',
  'takeStorageSupply(it.slotId)',
  'Logistics.storageSlotOccupied(S, aimData.slotId)',
  'Logistics.storageSlotBox(S, slotId)',
  'held.storageBoxId',
  'Logistics.returnSupply(S, held.kind',
].forEach(needle => assert.ok(game.includes(needle), `game missing: ${needle}`));

[
  'Logistics.storageSlotBox',
  'Logistics.storageTotal',
].forEach(needle => assert.ok(ui.includes(needle), `ui missing: ${needle}`));

console.log('storage slot tests passed');
