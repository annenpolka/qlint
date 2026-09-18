import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const fixturePath = name => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const runCli = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const parseJson = result => JSON.parse(result.stdout);
const lineOf = (source, needle) => source.split('\n').findIndex(line => line.includes(needle)) + 1;
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('a clean suite exits 0 and the text report discloses what did not run', () => {
  const result = runCli('lint', fixturePath('valid.suite.json'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no violations in the checks that ran/);
  assert.match(result.stdout, /not run: semantic screening/);
  assert.match(result.stdout, /not semantic approval/);
});

test('--format json emits the full coverage map', () => {
  const result = runCli('lint', fixturePath('valid.suite.json'), '--format', 'json');
  assert.equal(result.status, 0, result.stderr);
  const report = parseJson(result);
  assert.equal(report.scope, 'static_lint_only');
  assert.equal(report.coverage.length, 33);
  assert.equal(report.summary.rulesChecked, 9);
  assert.equal(report.summary.rulesNotRun, 24);
  assert.equal(report.coverage.find(entry => entry.ruleId === 'QSM001').status, 'not_run');
});

test('a reference violation exits 1 and points at the offending line', () => {
  const path = fixturePath('unknown-reference.suite.json');
  const source = readFileSync(path, 'utf8');
  const result = runCli('lint', path, '--format', 'json');
  assert.equal(result.status, 1);
  const report = parseJson(result);
  const diagnostic = report.diagnostics.find(entry => entry.ruleId === 'QCT002');
  assert.ok(diagnostic, JSON.stringify(report.diagnostics));
  assert.equal(diagnostic.locations[0].pointer, '/questions/0/inputs/1');
  assert.equal(diagnostic.locations[0].line, lineOf(source, '"ghost_ref"'));
  assert.equal(diagnostic.locations[0].file, path);
});

test('a schema violation exits 1 and skips cross-reference checks', () => {
  const path = fixturePath('schema-extra-property.suite.json');
  const source = readFileSync(path, 'utf8');
  const result = runCli('lint', path, '--format', 'json');
  assert.equal(result.status, 1);
  const report = parseJson(result);
  assert.ok(report.diagnostics.every(entry => entry.ruleId === 'QCT001'));
  const diagnostic = report.diagnostics.find(entry => entry.locations[0].pointer === '/questions/0/confidence');
  assert.ok(diagnostic, JSON.stringify(report.diagnostics));
  assert.equal(diagnostic.locations[0].line, lineOf(source, '"confidence"'));
  assert.equal(report.coverage.find(entry => entry.ruleId === 'QCT001').status, 'flagged');
  assert.equal(report.coverage.find(entry => entry.ruleId === 'QCT002').status, 'not_run');
  assert.match(report.notExecuted[0], /failed JSON Schema validation/);
});

test('malformed JSON exits 1 with a located diagnostic', () => {
  const result = runCli('lint', fixturePath('malformed.json'));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Invalid JSON/);
  assert.match(result.stdout, /malformed\.json:2:1/);
});

test('I/O and usage failures exit 2', () => {
  const missing = runCli('lint', fixturePath('does-not-exist.json'));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read/);

  const unknownOption = runCli('lint', fixturePath('valid.suite.json'), '--bogus');
  assert.equal(unknownOption.status, 2);
  assert.match(unknownOption.stderr, /unknown option/);

  const missingCommand = runCli();
  assert.equal(missingCommand.status, 2);
});

test('--help and --version exit 0', () => {
  const help = runCli('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Exit codes/);

  const version = runCli('--version');
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), packageVersion);
});

test('capability checks change the outcome only when a profile is supplied', () => {
  const path = fixturePath('categorical.suite.json');
  const without = runCli('lint', path, '--format', 'json');
  assert.equal(without.status, 0, without.stderr);
  assert.equal(parseJson(without).coverage.find(entry => entry.ruleId === 'QBE002').status, 'not_run');

  const withCaps = runCli('lint', path, '--capabilities', fixturePath('capabilities-small.json'), '--format', 'json');
  assert.equal(withCaps.status, 1);
  const report = parseJson(withCaps);
  assert.ok(report.diagnostics.some(entry => entry.ruleId === 'QBE002'));
  assert.equal(report.coverage.find(entry => entry.ruleId === 'QBE002').status, 'flagged');
});

test('malformed capability profiles are a tool-configuration failure (exit 2)', () => {
  const result = runCli('lint', fixturePath('valid.suite.json'), '--capabilities', fixturePath('capabilities-invalid.json'));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /nativeDistribution/);
});

test('lint does not modify the input file', () => {
  const path = fixturePath('unknown-reference.suite.json');
  const digest = () => createHash('sha256').update(readFileSync(path)).digest('hex');
  const before = digest();
  runCli('lint', path);
  assert.equal(digest(), before);
});
