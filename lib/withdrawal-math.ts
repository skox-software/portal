export type WithdrawalInput = {
  id: string;
  grossCents: number;
  unpaidCents: number;
  feesCents: number | null;
  expensesCents: number;
};

/** Cash is already net of spending: cap claims against it, never deduct expenses twice. */
export function withdrawalAmounts(rows: WithdrawalInput[], cashCents: number | null) {
  const claims = rows.map(r => Math.max(0, r.unpaidCents - (r.feesCents ?? 0) - r.expensesCents));
  const total = claims.reduce((a, b) => a + b, 0);
  // An unknown claim could reserve cash that another person would otherwise withdraw.
  const known = cashCents !== null && rows.every(r => r.feesCents !== null);
  const cash = Math.max(0, cashCents ?? 0);
  return rows.map((row, i) => ({
    ...row,
    availableCents: known ? (total <= cash ? claims[i] : Math.floor(claims[i] * cash / total)) : null,
  }));
}
