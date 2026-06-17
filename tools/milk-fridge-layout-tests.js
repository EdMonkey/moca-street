#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const world = fs.readFileSync(path.join(root, 'js/world.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'js/player.js'), 'utf8');
const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');

function includesAll(haystack, needles, label) {
  needles.forEach(n => assert.ok(haystack.includes(n), `${label} missing: ${n}`));
}

includesAll(world, [
  'function makeMilkFridgeMesh(open)',
  'milkFridgeLeftDoor',
  'milkFridgeRightDoor',
  'milkFridgeInterior',
  'milkFridgeShelf',
  'milkFridgeSupportLeft',
  'milkFridgeSupportRight',
  'milkFridgeCustomerFace',
  'const counterPanelZ = -0.57',
  'const counterBackingZ = -0.625',
  'fridgeCx, 0.475, counterBackingZ',
  'px, 0.5, counterPanelZ',
  'const fridgePos = new THREE.Vector3(cx, 0.08, -1.08)',
  "staffSideOnly: true",
  "staffSideZ: -1.2",
  "const leftDoorHb = addI(hitbox(0.74, 0.82, 0.14",
  "const rightDoorHb = addI(hitbox(0.74, 0.82, 0.14",
  "id: 'milkFridgeDoor'",
  "side: 'left'",
  "side: 'right'",
  'syncMilkFridgeDoorHitboxes()',
  "const milkHb = addI(hitbox(1.35, 0.6, 0.24, cx, 0.55, -1.43",
  'const milkLevels = [',
  'level: 0.10',
  'level: 0.50',
  'const milkCartons = []',
  'milkCartons.push(milk)',
  'env.setMilkFridgeMilkCount = function (count)',
  'milk.visible = i < visibleCount',
  'fridgeSurface.userData.fridgeSurface = true',
  'fridgeSurface.userData.fridgeLevel = level',
  'env.surfaces.push(fridgeSurface)',
], 'milk fridge fitted two-door layout');

assert.ok(!world.includes('const fridgePos = new THREE.Vector3(cx, 0.08, -1.53)'), 'fridge should not protrude toward barista side');
assert.ok(!world.includes('if (px > gapL + 0.15 && px < gapR - 0.15) continue;'), 'customer-facing counter decoration should continue across milk fridge');
includesAll(player, [
  'd.staffSideOnly',
  'pos.z > (d.staffSideZ ?? -1.2)',
  'h.object.userData.fridgeSurface',
  '!env.machines.milkFridge.open',
  'p.fridgeSurface = true',
], 'player staff-side-only interaction gate');

includesAll(game, [
  'function fitPlacedSpecToSurface(spec)',
  'spec.yOff = 0.004 - box.min.y',
  "item.location = point.fridgeSurface ? 'fridge' : 'placed'",
  'point.fridgeSurface',
  "carton.location !== 'placed' && carton.location !== 'fridge'",
  'Math.abs(py - point.y) > 0.24',
  "id === 'milkFridgeDoor'",
], 'milk fridge loose placement flow');

assert.ok(!world.includes("const fridgeHb = addI(hitbox(1.6, 0.85, 0.22"), 'milk fridge body should not be the open/close hitbox');

console.log('milk fridge layout tests passed');
