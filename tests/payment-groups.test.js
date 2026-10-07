import assert from 'node:assert/strict';
import test from 'node:test';
import { groupPayments } from '../public/payment-groups.js';

test('groups multiple seats without mixing periods, people or pending payments', () => {
  const detail = {
    chain: { amount_cents: 10000 },
    members: [
      { user_id: 'a', state: 'active', quantity: 2, half_units: 3, contribution_cents: 15000 },
      { user_id: 'b', state: 'active', quantity: 1 },
      { user_id: 'c', state: 'pending', quantity: 1 },
    ],
    dues: [{ user_id: 'a', turn_number: 2, amount_cents: 14001 }],
    receipts: [
      { user_id: 'a', turn_number: 1, state: 'approved', amount_cents: 15000 },
      { user_id: 'a', turn_number: 2, state: 'approved', amount_cents: 9334 },
      { user_id: 'a', turn_number: 2, state: 'pending', amount_cents: 4667 },
      { user_id: 'b', turn_number: 2, state: 'approved', amount_cents: 10000 },
    ],
  };
  const snapshot = structuredClone(detail);
  const rows = groupPayments(detail, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].entries.length, 2);
  assert.equal(rows[0].expected, 14001);
  assert.equal(rows[0].paid, 9334);
  assert.equal(rows[0].state, 'pending');
  assert.equal(rows[1].state, 'approved');
  assert.equal(rows[1].paid, 10000);
  assert.deepEqual(detail, snapshot);
  const future = groupPayments(detail, 3);
  assert.equal(future[0].expected, 15000);
  assert.equal(future[0].state, 'missing');
  assert.equal(future[1].expected, 10000);
});

test('approved historical amounts and zero amounts are preserved exactly', () => {
  const rows = groupPayments(
    {
      chain: { amount_cents: 20000 },
      members: [{ user_id: 'a', state: 'active', quantity: 2 }],
      dues: [],
      receipts: [
        { user_id: 'a', turn_number: 1, state: 'approved', amount_cents: 0 },
        { user_id: 'a', turn_number: 1, state: 'approved', amount_cents: 9999 },
      ],
    },
    1,
  );
  assert.equal(rows[0].paid, 9999);
  assert.equal(rows[0].approvedCount, 2);
  assert.equal(rows[0].state, 'approved');
});
