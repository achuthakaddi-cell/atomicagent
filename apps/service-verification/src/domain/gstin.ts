/**
 * GSTIN structural validation.
 *
 * WHY THIS IS REAL VERIFICATION, NOT A FIXTURE
 * --------------------------------------------
 * A GSTIN is not an arbitrary string. It is a structured identifier with a
 * check digit computed the same way a card number's Luhn digit is, extended to
 * base 36 so it covers letters. Change any single character of a valid GSTIN
 * and the check digit no longer matches.
 *
 * That property is what makes this tier genuinely useful rather than
 * decorative. Every typo is caught, and so is almost every invented number,
 * with no network call and no API key.
 *
 * WHAT IT CANNOT TELL YOU, AND WHY THAT MATTERS
 * ---------------------------------------------
 * Passing the structure check means the number COULD exist. It does not mean it
 * does, or that it is still in force. Registrations get surrendered when
 * businesses close, cancelled for prolonged non-filing, or suspended during
 * proceedings — and a determined fraudster can compute a valid check digit for
 * a number that was never issued.
 *
 * This is exactly the gap the tier ladder exists to price. The cheap check
 * tells you a number is well-formed; the expensive one tells you it is live.
 * The agent decides which answer is worth buying, and it can only make that
 * decision because the cheap answer is honest about its own limits.
 *
 * THE FORMAT
 * ----------
 *   positions 1-2    state code, 01 to 38
 *   positions 3-12   the holder's PAN
 *   position 13      entity number for that PAN within the state
 *   position 14      'Z' by default
 *   position 15      check digit
 */

/** Base-36 alphabet used by the check-digit algorithm. */
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** State codes, per the GST portal. Index is the numeric code. */
const STATE_CODES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

/**
 * The fourth character of a PAN encodes the holder's type.
 *
 * Worth surfacing: a supplier registered as an Individual when you expected a
 * Company is a real signal, and it costs nothing to read.
 */
const PAN_ENTITY_TYPES: Readonly<Record<string, string>> = {
  A: 'Association of Persons',
  B: 'Body of Individuals',
  C: 'Company',
  F: 'Firm or LLP',
  G: 'Government',
  H: 'Hindu Undivided Family',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  P: 'Individual',
  T: 'Trust',
};

/** What structural validation can establish. */
export interface GstinStructure {
  gstin: string;
  /** Whether every structural rule passed. */
  valid: boolean;
  /** Which rule failed, when one did. */
  failure: string | null;
  /** State the registration belongs to. */
  state: string | null;
  stateCode: string | null;
  /** The PAN embedded in positions 3 to 12. */
  pan: string | null;
  /** What the PAN's fourth character says the holder is. */
  entityType: string | null;
  /** Which registration this is for that PAN in that state. */
  entityNumber: string | null;
  /** The check digit as given. */
  checkDigit: string | null;
  /** The check digit as computed. Equal to the above when valid. */
  computedCheckDigit: string | null;
}

/**
 * Computes the GSTIN check digit.
 *
 * Base-36 Luhn: each of the first fourteen characters is converted to its
 * position in the alphabet, multiplied by an alternating factor of 1 and 2, and
 * the quotient and remainder of that product divided by 36 are both added to a
 * running total. The check digit is whatever brings that total to a multiple
 * of 36.
 *
 * @param first14 - the first fourteen characters of a GSTIN
 * @returns the expected fifteenth character
 */
export function computeCheckDigit(first14: string): string {
  let sum = 0;

  for (let index = 0; index < first14.length; index += 1) {
    const char = first14[index];
    if (char === undefined) continue;

    const value = CHARSET.indexOf(char);
    if (value === -1) return '';

    // Alternating weights, starting at 1 for position 0.
    const factor = index % 2 === 0 ? 1 : 2;
    const product = value * factor;

    // Both the carry and the remainder count, which is what extends Luhn
    // beyond single digits.
    sum += Math.floor(product / CHARSET.length) + (product % CHARSET.length);
  }

  const remainder = sum % CHARSET.length;
  const checkValue = (CHARSET.length - remainder) % CHARSET.length;

  return CHARSET[checkValue] ?? '';
}

/**
 * Validates a GSTIN's structure.
 *
 * Every rule is checked and the FIRST failure is reported, because a caller
 * fixing a number needs one clear problem rather than a list.
 *
 * @param raw - the GSTIN to check
 * @returns what could be established from the number alone
 */
export function validateGstinStructure(raw: string): GstinStructure {
  const gstin = raw.trim().toUpperCase();

  const empty: GstinStructure = {
    gstin,
    valid: false,
    failure: null,
    state: null,
    stateCode: null,
    pan: null,
    entityType: null,
    entityNumber: null,
    checkDigit: null,
    computedCheckDigit: null,
  };

  // ---- length ----
  if (gstin.length !== 15) {
    return {
      ...empty,
      failure:
        'A GSTIN is exactly 15 characters. This one is ' +
        String(gstin.length) + '.',
    };
  }

  // ---- character set ----
  if (!/^[0-9A-Z]+$/.test(gstin)) {
    return {
      ...empty,
      failure: 'A GSTIN contains only digits and uppercase letters.',
    };
  }

  // ---- state code ----
  const stateCode = gstin.slice(0, 2);
  const state = STATE_CODES[stateCode];

  if (!state) {
    return {
      ...empty,
      stateCode,
      failure:
        'State code ' + stateCode + ' is not assigned. Valid codes run 01 to 38.',
    };
  }

  // ---- embedded PAN ----
  //
  // A PAN is five letters, four digits, one letter. If the embedded PAN is
  // malformed the GSTIN cannot be genuine, whatever the check digit says.
  const pan = gstin.slice(2, 12);

  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    return {
      ...empty,
      stateCode,
      state,
      pan,
      failure:
        'Characters 3 to 12 must be a valid PAN — five letters, four digits, ' +
        'one letter. Found ' + pan + '.',
    };
  }

  const entityTypeChar = pan[3] ?? '';
  const entityType = PAN_ENTITY_TYPES[entityTypeChar] ?? null;

  const entityNumber = gstin[12] ?? null;

  // ---- position 14 ----
  //
  // 'Z' by default. Other values exist but are rare enough that flagging them
  // is more useful than silently accepting them.
  const fourteenth = gstin[13];

  if (fourteenth !== 'Z') {
    return {
      ...empty,
      stateCode,
      state,
      pan,
      entityType,
      entityNumber,
      failure:
        'The 14th character is normally Z. This one is ' + String(fourteenth) +
        ', which is unusual and worth confirming against the registry.',
    };
  }

  // ---- check digit ----
  const checkDigit = gstin[14] ?? '';
  const computedCheckDigit = computeCheckDigit(gstin.slice(0, 14));

  if (checkDigit !== computedCheckDigit) {
    return {
      ...empty,
      stateCode,
      state,
      pan,
      entityType,
      entityNumber,
      checkDigit,
      computedCheckDigit,
      failure:
        'Check digit mismatch. Expected ' + computedCheckDigit + ', found ' +
        checkDigit + '. This number has been mistyped or invented.',
    };
  }

  return {
    gstin,
    valid: true,
    failure: null,
    state,
    stateCode,
    pan,
    entityType,
    entityNumber,
    checkDigit,
    computedCheckDigit,
  };
}