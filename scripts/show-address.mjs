// show-address.mjs — prints the address for a mnemonic.
//
// Addresses get mangled by terminal wrapping and clipboard truncation. This
// derives it from the mnemonic, which is the authoritative source.
//
// Run:  node scripts/show-address.mjs "the 25 words in quotes"

import algosdk from 'algosdk';

const mnemonic = process.argv[2];

if (!mnemonic) {
  console.log('Usage: node scripts/show-address.mjs "word1 word2 ... word25"');
  process.exit(1);
}

try {
  const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
  console.log('');
    // algosdk v3 returns an Address object, not a string. toString() gives the
  // 58-character base32 form that faucets and .env files expect.
  const address = account.addr.toString();

  console.log('ADDRESS (' + address.length + ' chars, should be 58)');
  console.log(address);
  console.log('');
} catch (err) {
  console.log('Invalid mnemonic: ' + err.message);
  process.exit(1);
}