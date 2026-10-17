import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { withdrawalAmounts } from './withdrawal-math.ts';
const reiss = { id: 'reiss', grossCents: 125000, unpaidCents: 125000, feesCents: 3686, expensesCents: 30000 };
test('Lorenzen keeps gross ownership and excludes the test payment from withdrawal', () => {
  const [r] = withdrawalAmounts([reiss], 91381);
  assert.equal(r.grossCents, 125000);
  assert.equal(r.availableCents, 91314);
});
test('expenses are not deducted twice from cash; paid withdrawals reduce the claim', () => {
  assert.equal(withdrawalAmounts([{ ...reiss, unpaidCents: 75000 }], 41381)[0].availableCents, 41314);
});
test('shared account cash cannot be promised in full to multiple people', () => {
  const rows = withdrawalAmounts([reiss, { ...reiss, id: 'josh' }], 50000);
  assert.equal(rows.reduce((s, r) => s + r.availableCents!, 0), 50000);
});
test('missing Stripe data never becomes an optimistic available balance', () => {
  assert.equal(withdrawalAmounts([reiss], null)[0].availableCents, null);
  assert.equal(withdrawalAmounts([{ ...reiss, feesCents: null }], 91381)[0].availableCents, null);
});
test('deductions cannot yield a negative withdrawal', () => {
  assert.equal(withdrawalAmounts([{ ...reiss, unpaidCents: 100 }], 91381)[0].availableCents, 0);
});
