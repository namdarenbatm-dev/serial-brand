'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

test('generates TEST IDs with serial fixtures accepted by the exact BrandPAX rules', () => {
  const rows = C.generateTestSerials('PAX', 'S90', 2, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].testId, 'TEST-PAX-S90-00000001');
  assert.notEqual(rows[0].testId, rows[1].testId);
  for (const row of rows) {
    assert.match(row.testId, /^TEST-/);
    const detected = C.macroRaw(row.patchSerial);
    assert.equal(detected.brand.toUpperCase(), 'PAX');
    assert.equal(detected.model, 'S90');
    assert.equal(row.patchSerial.length, row.length);
    assert.ok(row.patchSerial.startsWith(row.prefix));
  }
});

test('refuses to invent a brand when the patch only identifies the model', () => {
  assert.throws(() => C.generateTestSerials('Newland', 'SP600', 2, 1), /برند/);
});

test('rejects invalid counts and models absent from patch rules', () => {
  assert.throws(() => C.generateTestSerials('PAX', 'S90', 0, 1));
  assert.throws(() => C.generateTestSerials('', 'S90', 1, 1));
  assert.throws(() => C.generateTestSerials('PAX', 'NOT-A-PATCH-MODEL', 1, 1));
  assert.throws(() => C.generateTestSerials('PAX', 'S90', 10001, 1));
});

test('preserves case-sensitive matching from the BrandPAX VBA patch', () => {
  assert.equal(C.macroDetect('2K12345').model, 'S80');
  assert.equal(C.macroDetect('2k12345'), null);
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


test('matches the BrandPAX VBA serial functions exactly (length, prefix, order)', () => {
  assert.deepEqual(C.macroRaw('30ABCDE'), { brand: 'Pax', model: 'S90' });
  assert.deepEqual(C.macroRaw('2KABCDE'), { brand: '', model: 'S80' });
  assert.deepEqual(C.macroRaw('2kABCDE'), { brand: '', model: '' });
  assert.deepEqual(C.macroRaw('0800123456'), { brand: 'Pax', model: 'Q80' });
  assert.deepEqual(C.macroRaw('51000000000000000'), { brand: '', model: 'D210' });
  assert.deepEqual(C.macroRaw('20123456789'), { brand: 'Verifone', model: 'Verifone' });
});

test('does not infer a missing brand or model beyond the VBA patch', () => {
  const result = C.analyze(['51000000000000000'], []);
  assert.equal(result.rows[0].brand, '');
  assert.equal(result.rows[0].model, 'D210');
  assert.equal(result.rows[0].status, 'ok');
});

test('does not uppercase or strip punctuation before exact VBA matching', () => {
  assert.equal(C.macroDetect('2kABCDE'), null);
  assert.equal(C.macroDetect('2K-ABCDE').model, 'S80');
  assert.equal(C.macroDetect('2k-ABCDE').brand, 'PAX');
  assert.equal(C.macroDetect('2k-ABCDE').model, '');
  assert.equal(C.macroDetect(' 30ABCDE ' ).model, 'S90');
});
