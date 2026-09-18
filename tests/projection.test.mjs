import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlan } from '../dist/plan.js';
import { projectQuestion, resolvePointer } from '../dist/projection.js';
import { replayPlan } from '../dist/replay.js';

const readFixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const twoQuestions = buildPlan(readFixture('two-questions.suite.json'), { version: 'test' });
const [qTask, qDiff] = twoQuestions.questions;

test('each question projects only its own inputs, never the union', () => {
  const state = { task: "t", diff: "d", outcome: "done", gold_label: true, expectedDiagnostics: ["QCT001"] };
  const task = projectQuestion(qTask, state);
  const diff = projectQuestion(qDiff, state);
  assert.equal(task.status, 'projected');
  assert.equal(diff.status, 'projected');
  assert.deepEqual(Object.keys(task.payload.inputs), ['task']);
  assert.deepEqual(Object.keys(diff.payload.inputs), ['diff']);
  const serialized = JSON.stringify([task.payload, diff.payload]);
  assert.ok(!serialized.includes('outcome'), serialized);
  assert.ok(!serialized.includes('gold_label'), serialized);
  assert.ok(!serialized.includes('expectedDiagnostics'), serialized);
});

test('policy references travel separately from evidence inputs', () => {
  const suite = JSON.parse(readFileSync(new URL('../examples/scope-monitor.suite.json', import.meta.url), 'utf8'));
  const plan = buildPlan(suite, { version: 'test' });
  const question = plan.questions[0];
  const outcome = projectQuestion(question, {
    task: "t", diff: "d", scope_policy: "p", final_outcome: "accepted",
  });
  assert.equal(outcome.status, 'projected');
  assert.deepEqual(Object.keys(outcome.payload.inputs), ['task', 'diff']);
  assert.deepEqual(Object.keys(outcome.payload.policyRefs), ['scope_policy']);
  assert.ok(!JSON.stringify(outcome.payload).includes('final_outcome'));
});

test('missing inputs abstain and nulls abstain unless declared nullable', () => {
  assert.deepEqual(projectQuestion(qTask, { diff: "d" }), {
    status: 'abstained', reason: 'missing_input', fieldIds: ['task'],
  });
  assert.deepEqual(projectQuestion(qTask, { task: null, diff: "d" }), {
    status: 'abstained', reason: 'null_value', fieldIds: ['task'],
  });
  const nullable = {
    ...qTask,
    inputs: [{ ...qTask.inputs[0], nullable: true }],
  };
  const outcome = projectQuestion(nullable, { task: null });
  assert.equal(outcome.status, 'projected');
  assert.equal(outcome.payload.inputs.task, null);
});

test('type violations stop the request instead of being smoothed over', () => {
  const outcome = projectQuestion(qTask, { task: 42, diff: "d" });
  assert.equal(outcome.status, 'invalid');
  assert.equal(outcome.problems[0].fieldId, 'task');
  assert.equal(outcome.problems[0].kind, 'type_mismatch');
});

test('a hand-made plan that projects a target is rejected at projection time', () => {
  const hostile = {
    ...qTask,
    inputs: [{ ...qTask.inputs[0], fieldId: 'outcome', role: 'target' }],
  };
  const outcome = projectQuestion(hostile, { outcome: "accepted" });
  assert.equal(outcome.status, 'invalid');
  assert.equal(outcome.problems[0].kind, 'target_role');
});

test('pointer resolution handles escaping, arrays, and missing paths', () => {
  const state = { a: { "b/c": [10, { "~d": 5 }] } };
  assert.deepEqual(resolvePointer(state, '/a/b~1c/1/~0d'), { found: true, value: 5 });
  assert.deepEqual(resolvePointer(state, '/a/b~1c/2'), { found: false });
  assert.deepEqual(resolvePointer(state, '/a/b~1c/01'), { found: false });
  assert.deepEqual(resolvePointer(state, '/a/missing'), { found: false });
  assert.deepEqual(resolvePointer(state, '/a/b~1c/0/x'), { found: false });
});

test('replay leaves uncovered requests not_run and records payloads', () => {
  const cases = [{ caseId: 'c1', state: { task: "t", diff: "d" } }];
  const report = replayPlan(twoQuestions, cases, [], 'test');
  assert.equal(report.summary.notRun, 2);
  assert.equal(report.summary.replayed, 0);
  assert.ok(report.results.every(result => result.requestDigest?.startsWith('sha256:')));
  assert.ok(report.results.every(result => !JSON.stringify(result.payload).includes('outcome')));
});

test('replay refuses duplicate recordings for one request digest', () => {
  const cases = [{ caseId: 'c1', state: { task: "t", diff: "d" } }];
  const first = replayPlan(twoQuestions, cases, [], 'test').results[0].requestDigest;
  assert.throws(
    () => replayPlan(twoQuestions, cases, [{ requestDigest: first, response: 1 }, { requestDigest: first, response: 2 }], 'test'),
    /duplicate recorded response/,
  );
});
