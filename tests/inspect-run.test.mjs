import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSchemaValidators, loadSchemaSync } from '../dist/schema-validation.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const root = new URL('..', import.meta.url);
const fixturePath = name => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const examplePath = name => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
const runCli = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const validators = createSchemaValidators({
  suite: loadSchemaSync(new URL('schemas/question-suite.schema.json', root)),
  diagnostic: loadSchemaSync(new URL('schemas/diagnostic.schema.json', root)),
  executionPlan: loadSchemaSync(new URL('schemas/execution-plan.schema.json', root)),
});

test('inspect displays request count, fields, provider, redaction, and limit rationale', () => {
  const result = runCli('inspect', examplePath('scope-monitor.suite.json'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /provider: replay; network: no/);
  assert.match(result.stdout, /requests: 2/);
  assert.match(result.stdout, /inputs: task, diff/);
  assert.match(result.stdout, /policyRefs: scope_policy/);
  assert.match(result.stdout, /redaction: explicit-projection-v0\.1/);
  assert.match(result.stdout, /excluded: final_outcome/);
  assert.match(result.stdout, /limits: .*--max-bytes/);
});

test('the generated plan satisfies the ExecutionPlan schema and verifies its digest', () => {
  const result = runCli('inspect', fixturePath('two-questions.suite.json'), '--format', 'json');
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(validators.executionPlan(plan), []);
  assert.equal(plan.requestCount, 2);
  assert.match(plan.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(plan.provider.network, false);
});

test('inspect refuses a suite whose lint has errors (target leak)', () => {
  const result = runCli('inspect', examplePath('target-leak.suite.json'));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /QCT005/);
});

test('restricted fields require explicit approval', () => {
  const path = fixturePath('restricted.suite.json');
  const denied = runCli('inspect', path);
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /--allow-restricted/);

  const allowed = runCli('inspect', path, '--allow-restricted', '--format', 'json');
  assert.equal(allowed.status, 0, allowed.stderr);
  const plan = JSON.parse(allowed.stdout);
  assert.deepEqual(plan.questions[0].redaction.restrictedFieldIds, ['task']);
});

test('run detects plan edits through the digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qlint-digest-'));
  try {
    const planPath = join(dir, 'plan.json');
    assert.equal(runCli('inspect', fixturePath('two-questions.suite.json'), '--out', planPath).status, 0);
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    plan.questions[0].inputs[0].fieldId = 'changed_after_review';
    const tamperedPath = join(dir, 'tampered.json');
    writeFileSync(tamperedPath, JSON.stringify(plan));
    const result = runCli('run', tamperedPath, '--cases', fixturePath('scope-cases.jsonl'), '--replay', fixturePath('scope-cases.jsonl'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /plan digest mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replay reproduces recorded responses without network and exits 3 without them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qlint-replay-'));
  try {
    const planPath = join(dir, 'plan.json');
    assert.equal(runCli('inspect', examplePath('scope-monitor.suite.json'), '--out', planPath).status, 0);
    const emptyReplay = join(dir, 'empty.jsonl');
    writeFileSync(emptyReplay, '');
    const cases = fixturePath('scope-cases.jsonl');

    const uncovered = runCli('run', planPath, '--cases', cases, '--replay', emptyReplay, '--format', 'json');
    assert.equal(uncovered.status, 3);
    const uncoveredReport = JSON.parse(uncovered.stdout);
    assert.equal(uncoveredReport.summary.notRun, 2);
    assert.equal(uncoveredReport.summary.abstained, 2);

    const recordings = uncoveredReport.results
      .filter(result => result.status === 'not_run')
      .map(result => JSON.stringify({ requestDigest: result.requestDigest, response: { answerId: result.questionId, pTrue: 0.6 } }))
      .join('\n') + '\n';
    const replayPath = join(dir, 'recorded.jsonl');
    writeFileSync(replayPath, recordings);

    const first = runCli('run', planPath, '--cases', cases, '--replay', replayPath, '--format', 'json');
    const second = runCli('run', planPath, '--cases', cases, '--replay', replayPath, '--format', 'json');
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0);
    assert.equal(first.stdout, second.stdout);

    const report = JSON.parse(first.stdout);
    assert.equal(report.summary.replayed, 2);
    assert.equal(report.summary.requestsSent, 0);
    const payloadText = JSON.stringify(report.results.map(result => result.payload));
    assert.ok(!payloadText.includes('final_outcome'), payloadText);
    assert.match(report.digest, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(report.notExecuted, [
      'adapter normalization (responses stay raw)',
      'gate runtime',
      'live provider execution (network)',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live providers are rejected with a clear message', () => {
  const result = runCli('run', 'plan.json', '--cases', 'cases.jsonl', '--replay', 'recorded.jsonl', '--allow-provider', 'typesafe');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /live providers are not implemented/);
});
