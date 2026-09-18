import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCases, validateCases } from '../evaluation/validate-cases.mjs';

test('the evaluation corpus is complete, split, and lint-clean', () => {
  const cases = loadCases();
  assert.deepEqual(validateCases(cases), []);
  assert.equal(cases.length, 80);
  assert.equal(cases.filter(item => item.kind === 'defect').length, 55);
  assert.equal(cases.filter(item => item.kind === 'legitimate').length, 25);
  assert.equal(cases.filter(item => item.split === 'tuning').length, 30);
  assert.equal(cases.filter(item => item.split === 'eval').length, 30);
  assert.equal(cases.filter(item => item.split === 'eval2').length, 20);
});

test('base-corpus paraphrase groups bundle more than one case', () => {
  const groups = new Map();
  for (const item of loadCases().filter(entry => entry.split === 'tuning' || entry.split === 'eval')) {
    groups.set(item.groupId, (groups.get(item.groupId) ?? 0) + 1);
  }
  const singletons = [...groups.entries()].filter(([, count]) => count < 2);
  assert.deepEqual(singletons, []);
});
