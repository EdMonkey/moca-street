#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const world = fs.readFileSync(path.join(root, 'js/world.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');

assert.ok(world.includes('function makeSupplyMesh(kind)'), 'world should expose a supply mesh factory');
assert.ok(world.includes("'CoffeeBeanBag'"), 'bean supply should prefer the CoffeeBeanBag model');
assert.ok(world.includes('const supplyModels'), 'supply mesh model mapping should be explicit');
assert.ok(world.includes('makeSupplyMesh,'), 'WORLD should export makeSupplyMesh');
assert.ok(!world.includes("textLabel('?곗쑀', 96, 48"), 'milk carton should not show a milk text label');

assert.ok(!world.includes('makeBoxMesh(box.kind)'), 'warehouse shelf should not render storage inventory boxes');
assert.ok(!world.includes('const milkCols = Math.min(3, shown);'), 'milk cartons should be individual placed items');
assert.ok(!world.includes('const milkPose = box.items && box.items[i];'), 'milk shelf render should not depend on storage box pose data');
assert.ok(!world.includes('Number.isFinite(milkPose.storageX)'), 'milk shelf render should not use storage slot x position');
assert.ok(!game.includes('milkGroups[slotId].items.push(c)'), 'milk storage groups should not be rendered as boxes');
assert.ok(game.includes('restoreLooseMilkCartons'), 'saved milk cartons should restore as individual placed items');

assert.ok(game.includes("} else if (h.type === 'deliveryBox')"), 'delivery boxes should keep box rendering');
assert.ok(!game.includes("} else if (h.type === 'supply')"), 'loose supply hand state should be removed with storage slots');

assert.ok(world.includes('function makeMilkCartonFallback()'), 'milk fallback should use a carton-shaped mesh');
assert.ok(world.includes('new THREE.BufferGeometry()'), 'milk fallback should build custom gabled geometry');
assert.ok(world.includes('carton.userData.milkCartonFallback = true'), 'milk fallback should be identifiable as carton fallback');
assert.ok(world.includes("milk: ['MilkCarton']"), 'milk should use the MilkCarton GLB model');
assert.ok(main.includes('async () =>'), 'game bootstrap should be async');
assert.ok(main.includes('await window.Assets.ready'), 'game should wait for GLB assets before building world');
assert.ok(main.includes('btnNew.disabled = true'), 'new game button should be disabled while assets load');
assert.ok(main.includes('btnNew.disabled = false'), 'new game button should be enabled after assets load');

console.log('supply visual tests passed');
