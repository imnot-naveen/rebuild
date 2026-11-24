const assert = require('node:assert/strict');
const { test } = require('node:test');
const { rankLots } = require('../dist/matching/rank');
const { snapshot, expected } = require('./fixtures/ranking-distance-first-v1.json');

test('distance-first ranking is deterministic and preserves the input snapshot', () => {
  const input = structuredClone(snapshot);
  assert.deepEqual(rankLots(input), expected);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(rankLots({ ...snapshot, candidates: snapshot.candidates.toReversed() }), expected);
});
