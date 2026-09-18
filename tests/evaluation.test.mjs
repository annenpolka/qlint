import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCases, validateCases } from '../evaluation/validate-cases.mjs';

test('the evaluation corpus is complete, split, and lint-clean', () => {
  const cases = loadCases();
  assert.deepEqual(validateCases(cases), []);
  assert.equal(cases.length, 60);
  assert.equal(cases.filter(item => item.kind === 'defect').length, 40);
  assert.equal(cases.filter(item => item.kind === 'legitimate').length, 20);
  assert.equal(cases.filter(item => item.split === 'tuning').length, 30);
  assert.equal(cases.filter(item => item.split === 'eval').length, 30);
});

test('paraphrase groups bundle more than one case', () => {
  const groups = new Map();
  for (const item of loadCases()) {
    groups.set(item.groupId, (groups.get(item.groupId) ?? 0) + 1);
  }
  const singletons = [...groups.entries()].filter(([, count]) => count < 2);
  assert.deepEqual(singletons, []);
});
