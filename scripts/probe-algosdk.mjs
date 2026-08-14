// probe-algosdk.mjs — verifies the exact algosdk 3.6.0 API we are about to use.
//
// algosdk v3 renamed transaction fields (from -> sender, to -> receiver) and
// changed several return shapes to BigInt. Every tutorial online still shows
// the v2 form. This script asks the installed package directly instead of
// trusting memory or docs.
//
// Run from the project root:  node scripts/probe-algosdk.mjs

import algosdk from 'algosdk';

const bar = () => console.log('='.repeat(72));
const rule = () => console.log('-'.repeat(72));

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let failures = 0;

const okLine = (label, detail) =>
  console.log('  ' + GREEN + 'OK  ' + RESET + label.padEnd(38) + DIM + (detail ?? '') + RESET);

const failLine = (label, detail) => {
  failures++;
  console.log('  ' + RED + 'FAIL' + RESET + ' ' + label.padEnd(38) + detail ?? '');
};

console.log('');
bar();
console.log('  ALGOSDK API PROBE');
bar();

// ---------------------------------------------------------------------------
// 1. Version and top-level surface
// ---------------------------------------------------------------------------
console.log('');
console.log('1. VERSION AND EXPORTS');
rule();

const REQUIRED_FUNCTIONS = [
  'makePaymentTxnWithSuggestedParamsFromObject',
  'makeAssetTransferTxnWithSuggestedParamsFromObject',
  'assignGroupID',
  'encodeUnsignedTransaction',
  'decodeUnsignedTransaction',
  'decodeSignedTransaction',
  'waitForConfirmation',
  'isValidAddress',
  'generateAccount',
  'mnemonicToSecretKey',
  'secretKeyToMnemonic',
];

for (const name of REQUIRED_FUNCTIONS) {
  if (typeof algosdk[name] === 'function') {
    okLine(name, 'function');
  } else {
    failLine(name, 'MISSING or not a function');
  }
}

for (const name of ['Algodv2', 'Indexer', 'Transaction', 'ABIContract']) {
  console.log('  ' + DIM + name.padEnd(42) + typeof algosdk[name] + RESET);
}

// ---------------------------------------------------------------------------
// 2. Payment transaction field names
// ---------------------------------------------------------------------------
console.log('');
console.log('2. PAYMENT TXN: sender/receiver (v3) or from/to (v2)?');
rule();

const account = algosdk.generateAccount();
const addr = String(account.addr);

// Minimal offline params. genesisHash must be 32 bytes.
const suggestedParams = {
  fee: 1000,
  firstValid: 1000,
  lastValid: 2000,
  genesisID: 'testnet-v1.0',
  genesisHash: new Uint8Array(32).fill(7),
  minFee: 1000,
  flatFee: true,
};

let paymentStyle = null;
let paymentTxn = null;

try {
  paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: addr,
    receiver: addr,
    amount: 1000,
    suggestedParams,
  });
  paymentStyle = 'v3';
  okLine('sender / receiver', 'ACCEPTED -> algosdk v3 style');
} catch (errV3) {
  console.log('  ' + DIM + 'v3 attempt: ' + String(errV3.message).split('\n')[0] + RESET);
  try {
    paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: addr,
      to: addr,
      amount: 1000,
      suggestedParams,
    });
    paymentStyle = 'v2';
    okLine('from / to', 'ACCEPTED -> algosdk v2 style');
  } catch (errV2) {
    failLine('payment txn', 'NEITHER style worked');
    console.log('  ' + DIM + 'v2 attempt: ' + String(errV2.message).split('\n')[0] + RESET);
  }
}

// ---------------------------------------------------------------------------
// 3. Asset transfer field names — this is the one we actually need
// ---------------------------------------------------------------------------
console.log('');
console.log('3. ASSET TRANSFER TXN (axfer) FIELD NAMES');
rule();

let axferStyle = null;
let axferTxn = null;

try {
  axferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: addr,
    receiver: addr,
    amount: 10000,
    assetIndex: 10458941,
    suggestedParams,
  });
  axferStyle = 'v3';
  okLine('sender / receiver / assetIndex', 'ACCEPTED -> v3 style');
} catch (errV3) {
  console.log('  ' + DIM + 'v3 attempt: ' + String(errV3.message).split('\n')[0] + RESET);
  try {
    axferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: addr,
      to: addr,
      amount: 10000,
      assetIndex: 10458941,
      suggestedParams,
    });
    axferStyle = 'v2';
    okLine('from / to / assetIndex', 'ACCEPTED -> v2 style');
  } catch (errV2) {
    failLine('axfer txn', 'NEITHER style worked');
    console.log('  ' + DIM + 'v2 attempt: ' + String(errV2.message).split('\n')[0] + RESET);
  }
}

// ---------------------------------------------------------------------------
// 4. Transaction object shape
// ---------------------------------------------------------------------------
console.log('');
console.log('4. TRANSACTION OBJECT PROPERTIES');
rule();

if (axferTxn) {
  const keys = Object.keys(axferTxn).sort();
  console.log('  own keys: ' + keys.join(', '));
  console.log('');
  for (const prop of ['type', 'sender', 'from', 'group', 'fee', 'firstValid', 'lastValid']) {
    const value = axferTxn[prop];
    const shown =
      value instanceof Uint8Array
        ? 'Uint8Array(' + value.length + ')'
        : typeof value === 'object' && value !== null
          ? String(value)
          : String(value);
    console.log('  ' + DIM + ('.' + prop).padEnd(20) + typeof value + '  ' + shown + RESET);
  }

  console.log('');
  for (const method of ['txID', 'signTxn', 'toByte', 'get_obj_for_encoding']) {
    console.log('  ' + DIM + ('.' + method + '()').padEnd(28) + typeof axferTxn[method] + RESET);
  }
}

// ---------------------------------------------------------------------------
// 5. assignGroupID behaviour — the heart of the atomic group
// ---------------------------------------------------------------------------
console.log('');
console.log('5. assignGroupID — DOES IT MUTATE OR RETURN?');
rule();

if (paymentTxn && axferTxn) {
  const build = (style) =>
    style === 'v3'
      ? algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: addr, receiver: addr, amount: 1, assetIndex: 10458941, suggestedParams,
        })
      : algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: addr, to: addr, amount: 1, assetIndex: 10458941, suggestedParams,
        });

  const group = [build(axferStyle), build(axferStyle), build(axferStyle)];

  console.log('  before: group[0].group = ' + String(group[0].group));

  const returned = algosdk.assignGroupID(group);

  console.log('  after : group[0].group = ' +
    (group[0].group instanceof Uint8Array
      ? 'Uint8Array(' + group[0].group.length + ')'
      : String(group[0].group)));
  console.log('  returns: ' + (Array.isArray(returned) ? 'array of ' + returned.length : typeof returned));
  console.log('');

  const mutated = group[0].group instanceof Uint8Array;
  if (mutated) {
    okLine('mutates in place', 'original array now carries group ids');
  } else {
    failLine('mutates in place', 'group id NOT set on the original objects');
  }

  // All three must share one identical group id, or the group is invalid.
  if (mutated && group[1].group && group[2].group) {
    const a = Buffer.from(group[0].group).toString('base64');
    const b = Buffer.from(group[1].group).toString('base64');
    const c = Buffer.from(group[2].group).toString('base64');
    if (a === b && b === c) {
      okLine('group ids identical', a.slice(0, 24) + '...');
    } else {
      failLine('group ids identical', 'MISMATCH between transactions');
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Encoding round-trip — how we move txns over HTTP
// ---------------------------------------------------------------------------
console.log('');
console.log('6. ENCODE / DECODE ROUND TRIP');
rule();

if (axferTxn) {
  try {
    const encoded = algosdk.encodeUnsignedTransaction(axferTxn);
    const b64 = Buffer.from(encoded).toString('base64');
    okLine('encodeUnsignedTransaction', 'Uint8Array(' + encoded.length + ') -> ' + b64.length + ' b64 chars');

    const decoded = algosdk.decodeUnsignedTransaction(Buffer.from(b64, 'base64'));
    okLine('decodeUnsignedTransaction', 'type = ' + String(decoded.type));

    const reEncoded = algosdk.encodeUnsignedTransaction(decoded);
    const identical = Buffer.from(encoded).equals(Buffer.from(reEncoded));
    if (identical) {
      okLine('round trip is lossless', 'bytes identical');
    } else {
      failLine('round trip is lossless', 'BYTES DIFFER — group id would break');
    }
  } catch (err) {
    failLine('encode/decode', String(err.message).split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
// 7. Live algod response shapes — Number or BigInt?
// ---------------------------------------------------------------------------
console.log('');
console.log('7. LIVE ALGOD RESPONSE TYPES');
rule();

try {
  const client = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
  const params = await client.getTransactionParams().do();

  console.log('  getTransactionParams() keys: ' + Object.keys(params).sort().join(', '));
  console.log('');
  for (const key of Object.keys(params)) {
    const value = params[key];
    const shown = value instanceof Uint8Array ? 'Uint8Array(' + value.length + ')' : String(value);
    console.log('  ' + DIM + key.padEnd(22) + typeof value + '  ' + shown + RESET);
  }
} catch (err) {
  failLine('algod reachable', String(err.message).split('\n')[0]);
}

// ---------------------------------------------------------------------------
bar();
console.log('  SUMMARY');
bar();
console.log('  payment txn style : ' + (paymentStyle ?? 'UNKNOWN'));
console.log('  axfer txn style   : ' + (axferStyle ?? 'UNKNOWN'));
console.log('');
if (failures === 0) {
  console.log('  ' + GREEN + 'ALL CHECKS PASSED' + RESET + ' — safe to write transaction-building code.');
} else {
  console.log('  ' + RED + failures + ' FAILURE(S)' + RESET + ' — do not write code until resolved.');
}
bar();
console.log('');

process.exitCode = failures === 0 ? 0 : 1;