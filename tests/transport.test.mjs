import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTransport } from '../dist/transport.js';

test('success returns the parsed response and sends the bearer header', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ model: "jev-latest", answers: {} }), text: async () => "{}" };
  };
  const transport = createHttpTransport({ apiKey: "test-key", fetchImpl });
  const result = await transport.send({ model: "jev-latest", state: "hello", questions: {} });
  assert.equal(result.ok, true);
  assert.equal(result.response.model, 'jev-latest');
  assert.equal(seen.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(seen.init.headers.authorization, 'Bearer test-key');
  assert.equal(JSON.parse(seen.init.body).state, 'hello');
});

test('HTTP errors are classified without leaking the key', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    text: async () => '{"error":"rate limited"}',
    json: async () => ({}),
  });
  const transport = createHttpTransport({ apiKey: "secret-value-that-must-not-appear", fetchImpl });
  const result = await transport.send({ model: "jev-latest", state: "x", questions: {} });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, 'http');
  assert.equal(result.failure.status, 429);
  assert.ok(!JSON.stringify(result.failure).includes('secret-value'));
});

test('aborts become timeout failures and network errors are classified', async () => {
  const aborting = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  const timeout = await createHttpTransport({ apiKey: 'k', fetchImpl: aborting })
    .send({ model: 'm', state: 's', questions: {} });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.failure.kind, 'timeout');

  const failing = async () => { throw new Error('ECONNREFUSED'); };
  const network = await createHttpTransport({ apiKey: 'k', fetchImpl: failing })
    .send({ model: 'm', state: 's', questions: {} });
  assert.equal(network.ok, false);
  assert.equal(network.failure.kind, 'network');
});

test('a non-object response body is an HTTP failure', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => [1, 2], text: async () => "[1,2]" });
  const result = await createHttpTransport({ apiKey: 'k', fetchImpl }).send({ model: 'm', state: 's', questions: {} });
  assert.equal(result.ok, false);
  assert.match(result.failure.message, /not a JSON object/);
});
