#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'js/player.js'), 'utf8');
const world = fs.readFileSync(path.join(root, 'js/world.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

[
  'STORAGE_SLOT_LEVELS',
  'STORAGE_RACKS',
  'const storageSurface = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.82)',
  'storageSurface.rotation.x = -Math.PI / 2',
  'storageSurface.userData.surfaceTopY = surfaceTopY',
  'storageSurface.userData.storageSurface = true',
  'storageSurface.userData.storageRack = r.rack',
  'storageSurface.userData.storageSlot = s.slot',
  'env.surfaces.push(storageSurface)',
].forEach(needle => assert.ok(world.includes(needle), `world missing: ${needle}`));

[
  "id: 'restock'",
  'env.storageSlots',
  'env.syncStorageBoxes',
  'env.setStoragePlacementMode',
  'env.setStoragePreview',
  'storagePlaceSlot',
  'storageBoxHitbox',
].forEach(needle => assert.ok(!world.includes(needle), `world should not contain storage slot behavior: ${needle}`));

[
  'function renderStorageBoxes() {',
  'env.clearStorageShelfVisuals',
  'function seedLooseMilkCartons()',
  'function restoreLooseMilkCartons()',
  'placeLooseItem(carton, point, { silent: true })',
  "item.location = point.fridgeSurface ? 'fridge' : 'placed'",
  'item.x = point.x',
  'item.y = point.y',
  'item.z = point.z',
  'item.rot = rot',
  "b.id !== (held && held.type === 'deliveryBox' ? held.id : null) && !b.surfacePlaced",
  "box.surfacePlaced = true",
].forEach(needle => assert.ok(game.includes(needle), `game missing: ${needle}`));

[
  "id === 'restock'",
  'placeHeldOnStorageSlot',
  'takeStorageSupply',
  'storageAimUsable',
  'storageSlotOccupied',
  'storageSlotBox',
  'storageBoxOutline',
  'storageBoxId',
  'Logistics.returnSupply(S, held.kind',
  'Logistics.takeSupply(S',
  'Logistics.storageSlotBox',
  'Logistics.storageTotal',
  'setStoragePlacementMode',
  'setStoragePreview',
].forEach(needle => assert.ok(!game.includes(needle), `game should not contain storage slot behavior: ${needle}`));

[
  'if (!d || h.object.userData.interactDisabled) continue;',
  'const normal = h.face.normal.clone().transformDirection(h.object.matrixWorld)',
  'if (normal.y > 0.7)',
  'if (h.object.userData.storageSurface)',
  'p.y = h.object.userData.surfaceTopY',
  'p.storageSurface = true',
].forEach(needle => assert.ok(player.includes(needle), `player missing: ${needle}`));

[
  'const st = S.stocks;',
  '!ui.includes(\'Logistics.storageTotal\')',
].forEach(() => {});
assert.ok(!ui.includes("case 'restock'"), 'ui prompt should not describe restock slots');
assert.ok(!ui.includes('Logistics.storageTotal'), 'hud should not show separate warehouse totals');
assert.ok(!ui.includes('Logistics.storageSlotBox'), 'ui should not inspect storage slots');

console.log('storage surface tests passed');
