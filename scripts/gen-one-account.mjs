// gen-one-account.mjs — generates ONE new Algorand account.
//
// Deliberately separate from gen-accounts.mjs, which creates the full set. This
// one adds a single account without touching anything that already works.
//
// The mnemonic is printed to the terminal and written nowhere. Copy it into
// ~/x402-probe/testnet-accounts.env by hand, which keeps it outside the repo.
//
// Run:  node scripts/gen-one-account.mjs

import algosdk from 'algosdk';

const account = algosdk.generateAccount();
const mnemonic = algosdk.secretKeyToMnemonic(account.sk);

console.log('');
console.log('='.repeat(72));
console.log('  NEW ALGORAND ACCOUNT');
console.log('='.repeat(72));
console.log('');
console.log('  ADDRESS');
console.log('  ' + account.addr);
console.log('');
console.log('  MNEMONIC — never commit this, never paste it anywhere public');
console.log('  ' + mnemonic);
console.log('');
console.log('='.repeat(72));
console.log('');
console.log('  NEXT STEPS');
console.log('');
console.log('  1. Save the mnemonic in ~/x402-probe/testnet-accounts.env');
console.log('     SVC_CARBON_MNEMONIC=<the 25 words above>');
console.log('');
console.log('  2. Fund it: https://bank.testnet.algorand.network/');
console.log('     Paste the address, request TestNet ALGO.');
console.log('');
console.log('  3. Opt it into the payment asset:');
console.log('     node scripts/optin-asset.mjs');
console.log('');
console.log('  4. Add the ADDRESS to .env:');
console.log('     SVC_CARBON_ADDRESS=' + account.addr);
console.log('');
console.log('='.repeat(72));
console.log('');