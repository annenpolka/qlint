import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, digestOf } from '../dist/digest.js';

test('canonical JSON sorts object keys and keeps array order', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: null, c: "x" }] }), '{"a":[2,{"c":"x","d":null}],"b":1}');
  assert.equal(digestOf({ a: 1 }), 'sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
  assert.equal(digestOf("hello"), 'sha256:5aa762ae383fbb727af3c7a36d4940a5b8c40a989452d2304fc958ff3f354e7a');
});

test('digests are independent of key order', () => {
  assert.equal(digestOf({ a: 1, b: [true, null] }), digestOf({ b: [true, null], a: 1 }));
});

test('non-JSON values are rejected rather than silently dropped', () => {
  assert.throws(() => canonicalJson(undefined), TypeError);
  assert.throws(() => canonicalJson(Number.NaN), TypeError);
});
