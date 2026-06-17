#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const world = fs.readFileSync(path.join(root, 'js/world.js'), 'utf8');

function includesAll(haystack, needles, label) {
  needles.forEach(n => assert.ok(haystack.includes(n), `${label} missing: ${n}`));
}

includesAll(index, [
  'id="deliveryMoney"',
  '보유 금액',
], 'delivery order visibility');

includesAll(game, [
  'deliveryPlaceRot',
  'deliveryPlacePreview',
  'moveHeldDeliveryBox',
  'rotateDeliveryBoxPreview',
  "ev.code === 'KeyR' && rotateDeliveryBoxPreview()",
], 'delivery placement controls');

includesAll(world, [
  'env.deliveryPreview',
  'setDeliveryPreview',
  'canPlaceDeliveryBox',
  'DOOR_RIGHT_SPOT',
  'deliverySpot',
  'boxes.forEach((b, i)',
  'typeof b.rot',
], 'delivery placement world API');

[
  'env.storagePreview',
  'setStoragePreview',
  'previewSlot',
].forEach(needle => assert.ok(!world.includes(needle), `storage preview should be removed: ${needle}`));

assert.ok(!world.includes('boxes.slice(0, spots.length)'), 'delivery renderer should not cap visible boxes to fixed spots');

const deliveryPreviewBlock = world.slice(
  world.indexOf('env.setDeliveryPreview = function'),
  world.indexOf('/* ---------- 장식 ---------- */')
);
assert.ok(!deliveryPreviewBlock.includes('EdgesGeometry'), 'delivery preview should not draw wireframe edges');
assert.ok(!deliveryPreviewBlock.includes('LineSegments'), 'delivery preview should not draw line wireframe');

[
  'showStoragePreview',
  'setStoragePreview',
  "aimData.id !== 'restock'",
].forEach(needle => assert.ok(!game.includes(needle), `storage shelf preview controls should be removed: ${needle}`));

includesAll(game, [
  "item.type === 'deliveryBox'",
  "box.surfacePlaced = true",
], 'delivery boxes can be placed on surfaces');

console.log('delivery placement tests passed');
