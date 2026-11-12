'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

test('generates explicitly marked TEST identifiers', () => {
  assert.deepEqual(C.generateTestSerials('PAX', 'S90', 2, 1), [
    'TEST-PAX-S90-000001',
    'TEST-PAX-S90-000002'
  ]);
});

test('normalizes labels and pads sequence consistently', () => {
  assert.deepEqual(C.generateTestSerials('pax tech', 's-90', 2, 12), [
    'TEST-PAX-TECH-S-90-000012',
    'TEST-PAX-TECH-S-90-000013'
  ]);
});

test('rejects invalid counts and unsafe empty labels', () => {
  assert.throws(() => C.generateTestSerials('PAX', 'S90', 0, 1));
  assert.throws(() => C.generateTestSerials('', 'S90', 1, 1));
  assert.throws(() => C.generateTestSerials('PAX', 'S90', 10001, 1));
});

test('matches macro prefixes without case sensitivity', () => {
  const result = C.macroDetect('2k12345');
  assert.equal(result && result.model, 'S80');
});
