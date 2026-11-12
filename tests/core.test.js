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


test('normalizes Persian and Arabic numerals and separators', () => {
  assert.equal(C.normalizeSerial(' ۲k-۱۲۳۴۵ '), '2K12345');
  assert.equal(C.normalizeSerial('٣٠_١٢٣٤٥'), '3012345');
});

test('custom rules take precedence over built-in macro rules', () => {
  const result = C.analyze(['3012345'], [
    { enabled: true, brand: 'TESTBRAND', model: 'CUSTOM', type: 'prefix', a: '30' }
  ]);
  assert.equal(result.rows[0].brand, 'TESTBRAND');
  assert.equal(result.rows[0].model, 'CUSTOM');
  assert.equal(result.rows[0].status, 'ok');
});

test('reports duplicate serials without dropping rows', () => {
  const result = C.analyze(['3012345', '3012345'], []);
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.dup, 1);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1].dup, true);
});

test('reports overlapping custom rules as a conflict and selects the stronger prefix', () => {
  const result = C.analyze(['3012345'], [
    { enabled: true, brand: 'PAX', model: 'S90-A', type: 'prefix', a: '30' },
    { enabled: true, brand: 'PAX', model: 'S90-B', type: 'prefix', a: '301' }
  ]);
  assert.equal(result.rows[0].model, 'S90-B');
  assert.equal(result.rows[0].status, 'conflict');
  assert.equal(result.summary.conflict, 1);
});
