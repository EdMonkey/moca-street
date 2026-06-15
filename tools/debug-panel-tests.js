#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');

function includesAll(haystack, needles, label) {
  needles.forEach(n => assert.ok(haystack.includes(n), `${label} missing: ${n}`));
}

includesAll(index, [
  'id="debugToggle"',
  'id="debugPanel"',
  'data-debug="prep"',
  'data-debug="open"',
  'data-debug="after"',
  'data-debug="closeDay"',
  'data-debug="addMoney"',
  'js/debug.js',
], 'debug panel markup');

includesAll(game, [
  'goPrep()',
  'goOpen()',
  'goAfter()',
  'endDayNow()',
  'addMoney(amount)',
  'debugState()',
], 'Game._debug API');

console.log('debug panel tests passed');
