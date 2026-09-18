import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSchemaValidators, loadSchemaSync } from '../dist/schema-validation.js';
import { LINT_NOTE, LINT_SCOPE, lintSuiteSource } from '../dist/lint-suite.js';

const root = new URL('..', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('rules/catalog.json', root), 'utf8'));
const catalogRuleIds = catalog.rules.map(rule => rule.id);
const validators = createSchemaValidators({
  suite: loadSchemaSync(new URL('schemas/question-suite.schema.json', root)),
  diagnostic: loadSchemaSync(new URL('schemas/diagnostic.schema.json', root)),
});

const readFixture = name => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const lineOf = (source, needle) => source.split('\n').findIndex(line => line.includes(needle)) + 1;
const lint = (name, options = {}) => lintSuiteSource({
  source: readFixture(name),
  file: name,
  catalogRuleIds,
  validators,
  version: 'test',
  ...options,
});

test('a valid fixture passes every executed rule and discloses what was not run', () => {
  const report = lint('valid.suite.json');
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.scope, LINT_SCOPE);
  assert.equal(report.suiteId, 'fixture_suite');
  assert.equal(report.coverage.length, catalogRuleIds.length);
  const status = id => report.coverage.find(entry => entry.ruleId === id)?.status;
  for (const ruleId of ['QCT001', 'QCT002', 'QCT003', 'QCT004', 'QCT005', 'QCT006', 'QCT007', 'QCT008', 'QCT009']) {
    assert.equal(status(ruleId), 'passed', `${ruleId} should have run`);
  }
  assert.equal(status('QSM001'), 'not_run');
  assert.equal(status('QPR001'), 'not_run');
  assert.ok(report.notExecuted.some(item => item.includes('semantic screening')));
  assert.ok(report.notExecuted.some(item => item.includes('backend capability checks')));
  assert.equal(report.note, LINT_NOTE);
  assert.equal(report.summary.rulesChecked, 9);
  assert.equal(report.summary.rulesNotRun, catalogRuleIds.length - 9);
});

test('a reference violation points at the exact input array item', () => {
  const source = readFixture('unknown-reference.suite.json');
  const report = lintSuiteSource({ source, file: 'unknown-reference.suite.json', catalogRuleIds, validators, version: 'test' });
  const diagnostic = report.diagnostics.find(entry => entry.ruleId === 'QCT002');
  assert.ok(diagnostic, JSON.stringify(report.diagnostics));
  assert.equal(diagnostic.locations[0].pointer, '/questions/0/inputs/1');
  assert.equal(diagnostic.locations[0].line, lineOf(source, '"ghost_ref"'));
  assert.equal(diagnostic.basis, 'static_proof');
  assert.equal(report.summary.errors, 1);
});

test('schema violations are reported and cross-reference checks are marked not_run', () => {
  const source = readFixture('schema-extra-property.suite.json');
  const report = lintSuiteSource({ source, file: 'schema-extra-property.suite.json', catalogRuleIds, validators, version: 'test' });
  assert.ok(report.diagnostics.length > 0);
  assert.ok(report.diagnostics.every(entry => entry.ruleId === 'QCT001'));
  const diagnostic = report.diagnostics.find(entry => entry.locations[0].pointer === '/questions/0/confidence');
  assert.ok(diagnostic, JSON.stringify(report.diagnostics));
  assert.equal(diagnostic.locations[0].line, lineOf(source, '"confidence"'));
  const status = id => report.coverage.find(entry => entry.ruleId === id)?.status;
  assert.equal(status('QCT001'), 'flagged');
  assert.equal(status('QCT002'), 'not_run');
  assert.ok(report.notExecuted[0].includes('failed JSON Schema validation'));
});

test('malformed JSON yields a located QCT001 diagnostic', () => {
  const source = readFixture('malformed.json');
  const report = lintSuiteSource({ source, file: 'malformed.json', catalogRuleIds, validators, version: 'test' });
  assert.equal(report.diagnostics.length, 1);
  assert.equal(report.diagnostics[0].ruleId, 'QCT001');
  assert.match(report.diagnostics[0].message, /Invalid JSON/);
  assert.equal(report.diagnostics[0].locations[0].line, 2);
  assert.equal(report.diagnostics[0].locations[0].column, 1);
});

test('capability checks run only when a capability profile is provided', () => {
  const source = readFixture('categorical.suite.json');
  const without = lintSuiteSource({ source, file: 'categorical.suite.json', catalogRuleIds, validators, version: 'test' });
  assert.deepEqual(without.diagnostics, []);
  const withoutStatus = id => without.coverage.find(entry => entry.ruleId === id)?.status;
  assert.equal(withoutStatus('QBE001'), 'not_run');
  assert.equal(withoutStatus('QBE002'), 'not_run');

  const withCaps = lintSuiteSource({
    source,
    file: 'categorical.suite.json',
    catalogRuleIds,
    validators,
    version: 'test',
    capabilities: { kinds: ['boolean', 'categorical'], nativeDistribution: true, nativeAbstention: false, maxCategoricalOptions: 1 },
  });
  assert.ok(withCaps.diagnostics.some(entry => entry.ruleId === 'QBE002'));
  assert.equal(withCaps.coverage.find(entry => entry.ruleId === 'QBE002')?.status, 'flagged');
  assert.equal(withCaps.coverage.find(entry => entry.ruleId === 'QBE001')?.status, 'passed');
});

test('every emitted diagnostic satisfies the Diagnostic schema', () => {
  for (const name of ['unknown-reference.suite.json', 'schema-extra-property.suite.json', 'malformed.json']) {
    const report = lint(name);
    assert.ok(report.diagnostics.length > 0, name);
    for (const diagnostic of report.diagnostics) {
      assert.deepEqual(validators.diagnostic(diagnostic), [], JSON.stringify(diagnostic));
    }
  }
});
