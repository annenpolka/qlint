import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildScreeningRequests, screenLive } from '../dist/screening.js';

const readJson = url => JSON.parse(readFileSync(url, 'utf8'));
const pack = readJson(new URL('../rules/screening-pack.json', import.meta.url));
const suite = readJson(new URL('fixtures/two-questions.suite.json', import.meta.url));

const answerFor = (request, violationFor) => ({
  model: "jev-latest",
  answers: Object.fromEntries(request.rules.flatMap(rule => {
    const ids = rule.subQuestionIds;
    const violation = violationFor(rule.ruleId);
    return [
      [ids.applicability, { type: "noul", noul: 0.95 }],
      [ids.sufficiency, { type: "noul", noul: 0.9 }],
      [ids.violation, { type: "noul", noul: violation }],
    ];
  })),
  usage: { input_tokens: 100, output_tokens: 20 },
});

const fakeTransport = (behaviour) => {
  const sent = [];
  return {
    sent,
    async send(request) {
      sent.push(request);
      const index = sent.length - 1;
      const outcome = behaviour(index, request);
      if (outcome === "failure") {
        return { ok: false, latencyMs: 7, failure: { kind: "http", status: 529, message: "HTTP 529: overloaded" } };
      }
      return { ok: true, response: outcome, latencyMs: 7 };
    },
  };
};

test('live screening sends only the built requests and records usage', async () => {
  const requests = buildScreeningRequests(suite, pack);
  const transport = fakeTransport(index => answerFor(requests[index], ruleId => ruleId === 'QSM001' ? 0.9 : 0.05));
  const recorded = [];
  const { report, failures } = await screenLive(suite, pack, transport, 'test', {
    onRecord: recording => recorded.push(recording),
  });
  assert.equal(failures.length, 0);
  assert.equal(transport.sent.length, requests.length);
  assert.equal(transport.sent[0].model, 'jev-latest');
  assert.equal(report.provider, 'typesafe');
  assert.equal(report.model, 'jev-latest');
  assert.equal(report.usage.requests, requests.length);
  assert.equal(report.usage.inputTokens, 100 * requests.length);
  assert.equal(report.usage.outputTokens, 20 * requests.length);
  assert.equal(report.summary.signals, 2);
  assert.equal(recorded.length, requests.length);
  assert.deepEqual(recorded.map(recording => recording.requestDigest), requests.map(request => request.requestDigest));
});

test('a budget limits sends and leaves the rest not_run', async () => {
  const requests = buildScreeningRequests(suite, pack);
  const transport = fakeTransport(index => answerFor(requests[index], () => 0.9));
  const { report } = await screenLive(suite, pack, transport, 'test', { maxRequests: 1 });
  assert.equal(transport.sent.length, 1);
  assert.equal(report.usage.requests, 1);
  assert.ok(report.summary.notRun > 0);
  assert.ok(report.notExecuted.some(item => item.includes('budget')));
});

test('backend failures become backend_error observations, not signals', async () => {
  const transport = fakeTransport(() => "failure");
  const { report, failures } = await screenLive(suite, pack, transport, 'test');
  assert.equal(failures.length, transport.sent.length);
  assert.equal(report.summary.backendErrors, report.observations.length);
  assert.equal(report.summary.signals, 0);
  assert.deepEqual(report.diagnostics, []);
  assert.ok(report.observations.every(observation => observation.status === 'backend_error'));
});

test('a model override changes the request digest bound to recordings', async () => {
  const defaultRequests = buildScreeningRequests(suite, pack);
  const transport = fakeTransport(index => answerFor(defaultRequests[index], () => 0.05));
  const { report } = await screenLive(suite, pack, transport, 'test', { model: 'jev-test' });
  assert.equal(transport.sent[0].model, 'jev-test');
  assert.equal(report.model, 'jev-test');
  const overridden = report.observations;
  assert.ok(overridden.every(observation => observation.status === 'no_signal'));
});
