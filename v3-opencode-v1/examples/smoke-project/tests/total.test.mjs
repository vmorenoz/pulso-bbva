import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/total.mjs';
test('Sums positive values', () => assert.equal(total([2, 3, 5]), 10));
test('Empty array returns zero', () => assert.equal(total([]), 0));
test('Rejects non-finite input', () => assert.throws(() => total([NaN]), /INVALID_AMOUNT/));
