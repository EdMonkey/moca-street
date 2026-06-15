#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const world = fs.readFileSync(path.join(root, 'js/world.js'), 'utf8');

assert.ok(world.includes('function makeSupplyMesh(kind)'), 'world should expose a supply mesh factory');
assert.ok(world.includes("'CoffeeBeanBag'"), 'bean supply should prefer the CoffeeBeanBag model');
assert.ok(world.includes('const supplyModels'), 'supply mesh model mapping should be explicit');
assert.ok(world.includes('makeBoxMesh(box.kind)'), 'warehouse shelf should render storage boxes');
assert.ok(world.includes('makeSupplyMesh,'), 'WORLD should export makeSupplyMesh');

assert.ok(game.includes("} else if (h.type === 'deliveryBox')"), 'delivery boxes should keep box rendering');
assert.ok(game.includes("} else if (h.type === 'supply')"), 'held rendering should branch supply separately');
assert.ok(game.includes('WORLD.makeSupplyMesh(h.kind)'), 'held supply should use the supply mesh factory');

console.log('supply visual tests passed');
