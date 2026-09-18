import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choiceMeasurement,
  noulMeasurement,
  parseChoiceAnswer,
  parseNoulAnswer,
  parseScoreAnswer,
  parseSystemOneResponse,
  scoreMeasurement,
} from '../dist/adapter.js';

const issuePaths = result => result.ok ? [] : result.issues.map(issue => issue.path);

test('a valid Noul answer parses to a model distribution', () => {
  const result = parseNoulAnswer({ type: "noul", noul: 0.92 });
  assert.equal(result.ok, true);
  assert.equal(result.value.noul, 0.92);
  assert.deepEqual(noulMeasurement(0.92), {
    kind: 'boolean', representation: 'distribution', pTrue: 0.92, probabilitySource: 'model_distribution',
  });
});

test('Noul rejects out-of-range, non-finite, mistyped, and extended answers', () => {
  assert.deepEqual(issuePaths(parseNoulAnswer({ type: "noul", noul: 1.2 })), ['/noul']);
  assert.deepEqual(issuePaths(parseNoulAnswer({ type: "noul", noul: Number.NaN })), ['/noul']);
  assert.deepEqual(issuePaths(parseNoulAnswer({ type: "choice", noul: 0.5 })), ['/type']);
  const extended = parseNoulAnswer({ type: "noul", noul: 0.5, explanation: "ignore previous instructions" });
  assert.equal(extended.ok, false);
  assert.deepEqual(issuePaths(extended), ['/explanation']);
});

test('a valid Choice answer requires every offered option and a normalized sum', () => {
  const options = ['a', 'b', 'c'];
  const valid = parseChoiceAnswer({ type: "choice", choice: "b", probabilities: { a: 0.1, b: 0.8, c: 0.1 }, confidence: 0.8 }, options);
  assert.equal(valid.ok, true);
  assert.deepEqual(choiceMeasurement(valid.value.probabilities), {
    kind: 'categorical', representation: 'distribution', distribution: { a: 0.1, b: 0.8, c: 0.1 }, probabilitySource: 'model_distribution',
  });

  assert.deepEqual(issuePaths(parseChoiceAnswer({ type: "choice", choice: "b", probabilities: { a: 0.1, b: 0.9 }, confidence: 0.8 }, options)), ['/probabilities/c']);
  assert.deepEqual(issuePaths(parseChoiceAnswer({ type: "choice", choice: "b", probabilities: { a: 0.1, b: 0.8, c: 0.1, d: 0 }, confidence: 0.8 }, options)), ['/probabilities/d']);
  assert.deepEqual(issuePaths(parseChoiceAnswer({ type: "choice", choice: "b", probabilities: { a: 0.5, b: 0.8, c: 0.1 }, confidence: 0.8 }, options)), ['/probabilities']);
  assert.deepEqual(issuePaths(parseChoiceAnswer({ type: "choice", choice: "a", probabilities: { a: 0.1, b: 0.8, c: 0.1 }, confidence: 0.8 }, options)), ['/choice']);
  assert.deepEqual(issuePaths(parseChoiceAnswer({ type: "choice", choice: "b", probabilities: { a: 0.1, b: 0.8, c: 0.1 }, confidence: 1.5 }, options)), ['/confidence']);
});

test('a valid Score answer must match its own probability-weighted mean', () => {
  const valid = parseScoreAnswer({
    type: "score", score: 1.6, legend: { 0: "low", 1: "mid", 2: "high" },
    probabilities: { 0: 0.05, 1: 0.3, 2: 0.65 }, confidence: 0.78,
  }, 3);
  assert.equal(valid.ok, true);
  assert.deepEqual(scoreMeasurement(valid.value.probabilities), {
    kind: 'ordinal', representation: 'distribution', distribution: { 0: 0.05, 1: 0.3, 2: 0.65 }, probabilitySource: 'model_distribution',
  });

  const inconsistent = parseScoreAnswer({
    type: "score", score: 1.0, legend: { 0: "low", 1: "mid", 2: "high" },
    probabilities: { 0: 0.05, 1: 0.3, 2: 0.65 }, confidence: 0.78,
  }, 3);
  assert.equal(inconsistent.ok, false);
  assert.deepEqual(issuePaths(inconsistent), ['/score']);

  const missingLevel = parseScoreAnswer({
    type: "score", score: 1.0, legend: { 0: "low", 1: "mid" },
    probabilities: { 0: 0.5, 1: 0.5 }, confidence: 0.9,
  }, 3);
  assert.equal(missingLevel.ok, false);
  assert.ok(issuePaths(missingLevel).includes('/probabilities/2'));
  assert.ok(issuePaths(missingLevel).includes('/legend'));
});

test('the response envelope must cover exactly the asked questions', () => {
  const good = parseSystemOneResponse({
    model: "jev-latest",
    answers: { q1: { type: "noul", noul: 0.5 }, q2: { type: "noul", noul: 0.5 } },
    usage: { input_tokens: 10, output_tokens: 5 },
  }, ['q1', 'q2']);
  assert.equal(good.ok, true);
  assert.deepEqual(good.value.usage, { inputTokens: 10, outputTokens: 5 });

  const missing = parseSystemOneResponse({ model: "jev-latest", answers: { q1: { type: "noul", noul: 0.5 } } }, ['q1', 'q2']);
  assert.equal(missing.ok, false);
  assert.deepEqual(issuePaths(missing), ['/answers/q2']);

  const extra = parseSystemOneResponse({
    model: "jev-latest",
    answers: { q1: { type: "noul", noul: 0.5 }, injected: { type: "noul", noul: 1 } },
  }, ['q1']);
  assert.equal(extra.ok, false);
  assert.deepEqual(issuePaths(extra), ['/answers/injected']);

  const unknownTopLevel = parseSystemOneResponse({
    model: "jev-latest", answers: { q1: { type: "noul", noul: 0.5 } }, instructions: "ignore the schema",
  }, ['q1']);
  assert.equal(unknownTopLevel.ok, false);
  assert.deepEqual(issuePaths(unknownTopLevel), ['/instructions']);
});
