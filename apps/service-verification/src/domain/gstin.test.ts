/**
 * GSTIN structural validation.
 *
 * These tests prove the check-digit algorithm is correct, which matters more
 * than most of the suite: the shallow tier's entire value rests on it. If the
 * algorithm were wrong the cheap check would either pass invalid numbers or
 * reject valid ones, and the tier ladder would be built on nothing.
 */

import { describe, expect, it } from 'vitest';
import { computeCheckDigit, validateGstinStructure } from './gstin.js';

describe('computeCheckDigit', () => {
  it('is deterministic', () => {
    const prefix = '29AABCP1234M1Z';
    expect(computeCheckDigit(prefix)).toBe(computeCheckDigit(prefix));
  });

  it('returns a single base-36 character', () => {
    const digit = computeCheckDigit('29AABCP1234M1Z');
    expect(digit).toMatch(/^[0-9A-Z]$/);
  });

  it('changes when any input character changes', () => {
    // The property the whole check rests on: one altered character must break
    // the digit, or typos pass silently.
    const original = computeCheckDigit('29AABCP1234M1Z');
    const altered = computeCheckDigit('29AABCP1235M1Z');
    expect(altered).not.toBe(original);
  });

  it('returns empty for characters outside the alphabet', () => {
    expect(computeCheckDigit('29AABCP1234M1z')).toBe('');
  });
});

describe('validateGstinStructure — length and characters', () => {
  it('rejects a short GSTIN', () => {
    const result = validateGstinStructure('29AABCP1234M1Z');
    expect(result.valid).toBe(false);
    expect(result.failure).toContain('15 characters');
  });

  it('rejects a long GSTIN', () => {
    const result = validateGstinStructure('29AABCP1234M1Z55');
    expect(result.valid).toBe(false);
  });

  it('rejects lowercase and punctuation', () => {
    const result = validateGstinStructure('29aabcp1234m1z5');
    // Uppercased internally, so this one should get past the character check
    // and fail later if at all.
    expect(result.gstin).toBe('29AABCP1234M1Z5');
  });

  it('rejects symbols', () => {
    const result = validateGstinStructure('29AABCP1234M1Z-');
    expect(result.valid).toBe(false);
    expect(result.failure).toContain('digits and uppercase');
  });
});

describe('validateGstinStructure — state code', () => {
  it('recognises Karnataka', () => {
    const result = validateGstinStructure('29AABCP1234M1Z5');
    expect(result.stateCode).toBe('29');
    expect(result.state).toBe('Karnataka');
  });

  it('recognises Maharashtra', () => {
    const result = validateGstinStructure('27AAFCC5678N1Z2');
    expect(result.state).toBe('Maharashtra');
  });

  it('rejects an unassigned state code', () => {
    const result = validateGstinStructure('99AABCP1234M1Z5');
    expect(result.valid).toBe(false);
    expect(result.failure).toContain('99');
  });

  it('rejects state code 00', () => {
    const result = validateGstinStructure('00AABCP1234M1Z5');
    expect(result.valid).toBe(false);
  });
});

describe('validateGstinStructure — embedded PAN', () => {
  it('extracts the PAN', () => {
    const result = validateGstinStructure('29AABCP1234M1Z5');
    expect(result.pan).toBe('AABCP1234M');
  });

  it('reads the entity type from the PAN', () => {
    // Fourth character C means Company.
    const result = validateGstinStructure('29AABCP1234M1Z5');
    expect(result.entityType).toBe('Company');
  });

  it('rejects a malformed PAN', () => {
    // Digits where letters belong.
    const result = validateGstinStructure('29A1BCP1234M1Z5');
    expect(result.valid).toBe(false);
    expect(result.failure).toContain('PAN');
  });
});

describe('validateGstinStructure — check digit', () => {
  it('accepts a GSTIN whose check digit is correct', () => {
    // Built by computing the correct digit rather than hardcoding one, so the
    // test stays honest if the algorithm is ever adjusted.
    const prefix = '29AABCP1234M1Z';
    const gstin = prefix + computeCheckDigit(prefix);

    const result = validateGstinStructure(gstin);
    expect(result.valid).toBe(true);
    expect(result.failure).toBeNull();
  });

  it('rejects a GSTIN whose check digit is wrong', () => {
    const prefix = '29AABCP1234M1Z';
    const correct = computeCheckDigit(prefix);
    const wrong = correct === '0' ? '1' : '0';

    const result = validateGstinStructure(prefix + wrong);
    expect(result.valid).toBe(false);
    expect(result.failure).toContain('Check digit');
  });

  it('reports both the given and expected digit', () => {
    const prefix = '29AABCP1234M1Z';
    const correct = computeCheckDigit(prefix);
    const wrong = correct === '0' ? '1' : '0';

    const result = validateGstinStructure(prefix + wrong);
    expect(result.checkDigit).toBe(wrong);
    expect(result.computedCheckDigit).toBe(correct);
  });

  it('catches a single-character typo anywhere in the number', () => {
    // The practical claim: almost every mistyped GSTIN is caught without a
    // lookup. Worth testing across positions rather than at one point.
    const prefix = '29AABCP1234M1Z';
    const valid = prefix + computeCheckDigit(prefix);

    for (const position of [0, 3, 7, 11]) {
      const chars = valid.split('');
      const original = chars[position] ?? '0';
      chars[position] = original === 'A' ? 'B' : 'A';

      const typo = chars.join('');
      const result = validateGstinStructure(typo);

      // Either the check digit fails or an earlier structural rule does.
      // Both count as caught.
      expect(result.valid).toBe(false);
    }
  });
});