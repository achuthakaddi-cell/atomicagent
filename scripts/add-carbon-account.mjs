// add-carbon-account.mjs — converts a mnemonic into the format optin-asset.mjs
// expects, and appends it to the probe accounts file.
//
// optin-asset.mjs reads ROLE_ADDRESS and ROLE_SK_B64 pairs. A mnemonic is not
// enough on its own, so this derives the secret key and writes both.
//
// Run:  node scripts/add-carbon-account.mjs "word1 word2 ... word25"

import algosdk from 'algosdk';
import fs from 'node:fs';
import path from 'node:path';

const mnemonic = process.argv[2];

if (!mnemonic || mnemonic.trim().split(/\s+/).length !== 25) {
  console.log('');
  console.log('Usage: node scripts/add-carbon-account.mjs "the 25 words in quotes"');
  console.log('');
  process.exit(1);
}

let account;

try {
  account = algosdk.mnemonicToSecretKey(mnemonic.trim());
} catch (err) {
  console.log('');
  console.log('That mnemonic is not valid: ' + err.message);
  console.log('  SVC_CARBON_ADDRESS=' + account.addr.toString());
  console.log('');
  process.exit(1);
}

const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
const accountsPath = path.join(home, 'x402-probe', 'testnet-accounts.env');

if (!fs.existsSync(accountsPath)) {
  console.log('');
  console.log('ERROR: could not find ' + accountsPath);
  console.log('');
  process.exit(1);
}

const existing = fs.readFileSync(accountsPath, 'utf8');

if (existing.includes('SVC_CARBON_ADDRESS=')) {
  console.log('');
  console.log('SVC_CARBON is already in that file. Nothing to do.');
  console.log('');
  process.exit(0);
}

const secretKeyB64 = Buffer.from(account.sk).toString('base64');

const block =
  '\n' +
  '# carbon service — added for the pluggable-service demonstration\n' +
  'SVC_CARBON_ADDRESS=' + account.addr.toString() + '\n' +
  'SVC_CARBON_SK_B64=' + secretKeyB64 + '\n';

fs.appendFileSync(accountsPath, block, 'utf8');

console.log('');
console.log('='.repeat(72));
console.log('  ADDED TO ' + accountsPath);
console.log('='.repeat(72));
console.log('');
console.log('  SVC_CARBON_ADDRESS=' + account.addr);
console.log('  SVC_CARBON_SK_B64=' + '*'.repeat(40) + ' (written, not shown)');
console.log('');
console.log('  Next:  node scripts/optin-asset.mjs');
console.log('');