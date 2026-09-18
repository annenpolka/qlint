import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationIndex, JsonScanError, positionAtOffset } from '../dist/locate.js';

const pick = (position) => position === undefined ? undefined : { line: position.line, column: position.column };

test('object members and array items resolve to exact positions', () => {
  const source = '{\n  "a": [\n    1,\n    { "b": true }\n  ]\n}';
  const index = buildLocationIndex(source);
  assert.deepEqual(pick(index.exact('')), { line: 1, column: 1 });
  assert.deepEqual(pick(index.exact('/a')), { line: 2, column: 8 });
  assert.deepEqual(pick(index.exact('/a/0')), { line: 3, column: 5 });
  assert.deepEqual(pick(index.exact('/a/1/b')), { line: 4, column: 12 });
});

test('escaped key segments use JSON Pointer escaping', () => {
  const index = buildLocationIndex('{"a/b": {"~x": 1}}');
  assert.deepEqual(pick(index.exact('/a~1b')), { line: 1, column: 9 });
  assert.deepEqual(pick(index.exact('/a~1b/~0x')), { line: 1, column: 16 });
  assert.equal(index.exact('/a/b'), undefined);
});

test('nearest falls back to the containing value, then to the root', () => {
  const index = buildLocationIndex('{"a": {"b": 1}}');
  assert.equal(index.exact('/a/b/c'), undefined);
  assert.deepEqual(pick(index.nearest('/a/b/c')), { line: 1, column: 13 });
  assert.deepEqual(pick(index.nearest('/missing/deep')), { line: 1, column: 1 });
  assert.deepEqual(pick(index.nearest('/')), { line: 1, column: 1 });
  assert.deepEqual(pick(index.nearest('')), { line: 1, column: 1 });
});

test('the scanner reports where malformed text stops', () => {
  assert.throws(
    () => buildLocationIndex('{"a": }'),
    (error) => error instanceof JsonScanError && error.offset === 6,
  );
  assert.throws(() => buildLocationIndex('{"a": "unterminated'), JsonScanError);
});

test('positionAtOffset counts from one and clamps to the source', () => {
  assert.deepEqual(positionAtOffset('ab\ncd', 4), { offset: 4, line: 2, column: 2 });
  assert.deepEqual(positionAtOffset('abc', 99), { offset: 3, line: 1, column: 4 });
});
