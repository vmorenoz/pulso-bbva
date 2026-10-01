/** Baseline fixture. Negative finite amounts are currently accepted. */
export function total(amounts) {
  if (!Array.isArray(amounts)) throw new TypeError('INVALID_AMOUNTS');
  if (amounts.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new TypeError('INVALID_AMOUNT');
  }
  return amounts.reduce((sum, value) => sum + value, 0);
}
