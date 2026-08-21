/**
 * Signed group validation.
 *
 * WHY THIS IS TESTED SEPARATELY FROM ASSEMBLY
 * -------------------------------------------
 * buildAtomicGroup talks to algod for suggested params and checks the buyer's
 * asset holding, so testing it properly means mocking a chain client. The value
 * of doing that is low: the evidence that assembly works is a settled group on
 * the explorer with the right amounts in the right slots.
 *
 * validateSignedGroup is different. It is pure, it runs on data returned from
 * the user's browser, and it is the last gate before a group is sent for
 * verification. A browser can return anything — a shorter group, a longer one,
 * an array of nulls — and this function is what refuses it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not verify signatures or amounts. The facilitator re-checks every
 * one of those independently during verify, and duplicating that here would be
 * a second implementation to keep in step with the first. This is a fast shape
 * check, not the only defence.
 */

import { describe, expect, it } from 'vitest';
import { validateSignedGroup } from './groupBuilder.js';

describe('validateSignedGroup — shape', () => {
  it('accepts a well-formed group of the expected size', () => {
    const group = ['aaa', 'bbb', 'ccc', 'ddd', 'eee'];
    const result = validateSignedGroup(group, 5);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('rejects anything that is not an array', () => {
    for (const notAnArray of [null, undefined, 'string', 42, {}, true]) {
      const result = validateSignedGroup(notAnArray, 5);
      expect(result.valid).toBe(false);
    }
  });

  it('rejects a group that is too short', () => {
    // A wallet returning fewer transactions than it was given means a slot went
    // unsigned, which fails at settlement after the user has already approved.
    const result = validateSignedGroup(['a', 'b', 'c'], 5);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('3');
    expect(result.reason).toContain('5');
  });

  it('rejects a group that is too long', () => {
    const result = validateSignedGroup(['a', 'b', 'c', 'd', 'e', 'f'], 5);
    expect(result.valid).toBe(false);
  });

  it('rejects null entries', () => {
    // signTransactions returns null for slots it was told not to sign. Passing
    // that array through unchanged is an easy mistake and produces a group the
    // facilitator cannot read.
    const result = validateSignedGroup(['a', null, 'c', 'd', 'e'], 5);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('1');
  });

  it('rejects empty strings', () => {
    const result = validateSignedGroup(['a', '', 'c', 'd', 'e'], 5);
    expect(result.valid).toBe(false);
  });

  it('rejects non-string entries', () => {
    const result = validateSignedGroup(['a', 42, 'c', 'd', 'e'], 5);
    expect(result.valid).toBe(false);
  });

  it('names the offending slot', () => {
    const result = validateSignedGroup(['a', 'b', 'c', null, 'e'], 5);

    // The slot number matters: "something is wrong" is not actionable, and a
    // presenter debugging this live needs to know which one.
    expect(result.reason).toContain('3');
  });
});

describe('validateSignedGroup — variable group sizes', () => {
  it('accepts a six-slot group when six are expected', () => {
    // The group grows when an external service registers. A hardcoded expected
    // size would reject every run with a registered service — which was a real
    // bug caught by testing the deployed app rather than the code.
    const group = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(validateSignedGroup(group, 6).valid).toBe(true);
  });

  it('rejects a five-slot group when six are expected', () => {
    const group = ['a', 'b', 'c', 'd', 'e'];
    expect(validateSignedGroup(group, 6).valid).toBe(false);
  });

  it('handles the largest group Algorand permits', () => {
    const group = Array.from({ length: 16 }, (_, i) => 'txn' + String(i));
    expect(validateSignedGroup(group, 16).valid).toBe(true);
  });
});

describe('validateSignedGroup — always explains itself', () => {
  it('gives a reason for every rejection', () => {
    const cases: Array<[unknown, number]> = [
      [null, 5],
      [['a'], 5],
      [['a', 'b', 'c', 'd', 'e', 'f'], 5],
      [['a', null, 'c', 'd', 'e'], 5],
      [['a', '', 'c', 'd', 'e'], 5],
    ];

    for (const [group, size] of cases) {
      const result = validateSignedGroup(group, size);
      expect(result.valid).toBe(false);
      expect(result.reason).toBeTruthy();
      expect(result.reason?.length).toBeGreaterThan(10);
    }
  });
});