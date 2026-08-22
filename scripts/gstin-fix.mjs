// gstin-fix.mjs — computes correct GSTIN check digits.
//
// The fixture GSTINs were written by hand and their check digits are probably
// wrong, which would make the shallow tier refuse every supplier. This computes
// the correct fifteenth character for each.
//
// Run:  node scripts/gstin-fix.mjs

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Computes the GSTIN check digit.
 *
 * @param {string} first14 - first fourteen characters
 * @returns {string} the expected fifteenth character
 */
function computeCheckDigit(first14) {
  let sum = 0;

  for (let index = 0; index < first14.length; index += 1) {
    const value = CHARSET.indexOf(first14[index]);
    if (value === -1) return '?';

    const factor = index % 2 === 0 ? 1 : 2;
    const product = value * factor;

    sum += Math.floor(product / 36) + (product % 36);
  }

  return CHARSET[(36 - (sum % 36)) % 36];
}

const prefixes = [
  ['SUP-BLR-011', '29AABCP1234M1Z'],
  ['SUP-CHN-330', '33AAHCC3456Q1Z'],
  ['SUP-PUN-004', '27AAFCC5678N1Z'],
  ['SUP-DEL-902', '07AAGCN9012P1Z'],
  ['SUP-HYD-517', '36AAJCD7890R1Z'],
];

console.log('');
console.log('='.repeat(60));
console.log('  CORRECT GSTINs FOR THE FIXTURE');
console.log('='.repeat(60));
console.log('');

for (const [supplier, prefix] of prefixes) {
  console.log('  ' + supplier.padEnd(14) + prefix + computeCheckDigit(prefix));
}

console.log('');
console.log('  Paste these into SUPPLIER_HISTORY in sellerRegistry.ts');
console.log('');