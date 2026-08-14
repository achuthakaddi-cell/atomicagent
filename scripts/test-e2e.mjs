// test-e2e.mjs — drives a complete run without a frontend.
//
//   1. POST /api/runs/quote          get the unsigned group
//   2. sign slots 1-4 locally        stands in for Pera Wallet
//   3. POST /api/runs/:id/verify     fan out to all three checks
//   4. POST /api/runs/:id/settle     settle once, if all passed
//
// Slot 0 is left UNSIGNED. The facilitator signs it at settlement. That is the
// fee abstraction: the buyer never signs an ALGO spend.
//
// Run:  node scripts/test-e2e.mjs
//       node scripts/test-e2e.mjs SKU-4472    (force an availability failure)
//       node scripts/test-e2e.mjs SKU-9002    (force a price failure)

import algosdk from 'algosdk';
import fs from 'node:fs';
import path from 'node:path';

const ORCHESTRATOR = 'http://localhost:4100';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const bar = () => console.log('='.repeat(72));
const rule = () => console.log('-'.repeat(72));

// ---------------------------------------------------------------------------
// Test cases. Each targets a specific outcome so both paths are demonstrable.
// ---------------------------------------------------------------------------
const CASES = {
  'SKU-4471': {
    label: 'all three checks pass',
    quantity: 500,
    maxUnitPriceAtomic: '5000000',
    supplierId: 'SUP-BLR-011',
    expect: 'settle',
  },
  'SKU-4472': {
    label: 'availability fails, only 400 units free',
    quantity: 500,
    maxUnitPriceAtomic: '5000000',
    supplierId: 'SUP-BLR-011',
    expect: 'abort',
  },
  'SKU-9002': {
    label: 'price fails, quoted 82.00 above 5.00 ceiling',
    quantity: 10,
    maxUnitPriceAtomic: '5000000',
    supplierId: 'SUP-PUN-004',
    expect: 'abort',
  },
};

const sku = process.argv[2] ?? 'SKU-4471';
const testCase = CASES[sku];

if (!testCase) {
  console.log('Unknown SKU. Choose one of: ' + Object.keys(CASES).join(', '));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load the buyer's key. Stands in for Pera Wallet.
// ---------------------------------------------------------------------------
const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
const accountsPath = path.join(home, 'x402-probe', 'testnet-accounts.env');

if (!fs.existsSync(accountsPath)) {
  console.log('ERROR: could not find ' + accountsPath);
  process.exit(1);
}

let buyerAddress = null;
let buyerSecretKey = null;

for (const raw of fs.readFileSync(accountsPath, 'utf8').split('\n')) {
  const line = raw.trim();
  if (line.startsWith('MSME_BUYER_ADDRESS=')) {
    buyerAddress = line.slice(19).trim();
  } else if (line.startsWith('MSME_BUYER_SK_B64=')) {
    buyerSecretKey = new Uint8Array(Buffer.from(line.slice(18).trim(), 'base64'));
  }
}

if (!buyerAddress || !buyerSecretKey) {
  console.log('ERROR: could not load MSME_BUYER');
  process.exit(1);
}

/**
 * POSTs JSON to the orchestrator.
 *
 * @param pathname - route to call
 * @param body - JSON body
 * @returns status and parsed body
 */
async function post(pathname, body) {
  const response = await fetch(ORCHESTRATOR + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  return { status: response.status, body: parsed };
}

/**
 * Formats atomic units as a decimal string.
 *
 * @param atomic - digit string in atomic units
 * @param decimals - decimal places
 * @returns human-readable amount
 */
function human(atomic, decimals) {
  const padded = String(atomic).padStart(decimals + 1, '0');
  const cut = padded.length - decimals;
  return padded.slice(0, cut) + '.' + padded.slice(cut);
}

console.log('');
bar();
console.log('  ATOMICAGENT END-TO-END TEST');
console.log('  sku      : ' + sku);
console.log('  scenario : ' + testCase.label);
console.log('  expecting: ' + testCase.expect.toUpperCase());
console.log('  buyer    : ' + buyerAddress);
bar();

// ---------------------------------------------------------------------------
// 1. Quote
// ---------------------------------------------------------------------------
console.log('');
console.log('1. QUOTE  ' + DIM + '(collect three 402 challenges, build the group)' + RESET);
rule();

const quote = await post('/api/runs/quote', {
  request: {
    sku,
    quantity: testCase.quantity,
    maxUnitPriceAtomic: testCase.maxUnitPriceAtomic,
    requiredBy: '2026-09-15',
    supplierId: testCase.supplierId,
  },
  buyerAddress,
});

if (quote.status !== 200 || !quote.body.ok) {
  console.log('  ' + RED + 'FAILED' + RESET + ' HTTP ' + quote.status);
  console.log('  ' + JSON.stringify(quote.body));
  process.exit(1);
}

const data = quote.body.data;
const decimals = data.asset.decimals;

console.log('  runId        : ' + data.runId);
console.log('  group size   : ' + data.unsignedGroup.length + ' transactions');
console.log('  check fees   : ' + human(data.totalFeesAtomic, decimals) + ' ' + data.asset.symbol);
console.log('  order total  : ' + human(data.orderTotalAtomic, decimals) + ' ' + data.asset.symbol);
console.log('  grand total  : ' + CYAN + human(data.grandTotalAtomic, decimals) + ' ' + data.asset.symbol + RESET);
console.log('');
console.log('  ' + GREEN + 'unsigned group built' + RESET);

// ---------------------------------------------------------------------------
// 2. Sign slots 1 to 4
// ---------------------------------------------------------------------------
console.log('');
console.log('2. SIGN  ' + DIM + '(stands in for Pera Wallet)' + RESET);
rule();

const signedGroup = data.unsignedGroup.map((encoded, index) => {
  // Slot 0 belongs to the facilitator. Passing it through unsigned is what
  // lets the facilitator sign it at settlement and cover every fee.
  if (index === 0) {
    console.log('  slot 0 ' + YELLOW + 'left unsigned' + RESET + '  facilitator will sign');
    return encoded;
  }

  const txn = algosdk.decodeUnsignedTransaction(Buffer.from(encoded, 'base64'));
  const signed = txn.signTxn(buyerSecretKey);

  console.log('  slot ' + index + ' ' + GREEN + 'signed' + RESET + '         by the buyer');
  return Buffer.from(signed).toString('base64');
});

// ---------------------------------------------------------------------------
// 3. Verify
// ---------------------------------------------------------------------------
console.log('');
console.log('3. VERIFY  ' + DIM + '(same group, three payment indices, no settlement)' + RESET);
rule();

const verify = await post('/api/runs/' + data.runId + '/verify', { signedGroup });

if (verify.status !== 200 || !verify.body.ok) {
  console.log('  ' + RED + 'FAILED' + RESET + ' HTTP ' + verify.status);
  console.log('  ' + JSON.stringify(verify.body, null, 2));
  process.exit(1);
}

const verifyData = verify.body.data;

for (const verdict of verifyData.verdicts ?? []) {
  const mark = verdict.passed ? GREEN + 'PASS' + RESET : RED + 'FAIL' + RESET;
  console.log('  ' + mark + '  ' + verdict.checkId.padEnd(14) + verdict.reason);
}

// ---------------------------------------------------------------------------
// 4a. Abort path
// ---------------------------------------------------------------------------
if (verifyData.nothingSettled === true) {
  console.log('');
  bar();
  console.log('  ' + YELLOW + 'RUN ABORTED' + RESET);
  console.log('');
  console.log('  failed checks : ' + verifyData.failedChecks.join(', '));
  console.log('  reason        : ' + verifyData.reason);
  console.log('');
  console.log('  ' + GREEN + 'NOTHING WAS SETTLED' + RESET);
  console.log('  The signed group was never submitted. No transaction exists on');
  console.log('  Algorand for this run, so there is nothing to reverse.');
  bar();
  console.log('');

  process.exitCode = testCase.expect === 'abort' ? 0 : 1;

  if (testCase.expect !== 'abort') {
    console.log('  ' + RED + 'UNEXPECTED: this case was supposed to settle.' + RESET);
  }

  process.exit(process.exitCode);
}

// ---------------------------------------------------------------------------
// 4b. Settle path
// ---------------------------------------------------------------------------
console.log('');
console.log('  ' + GREEN + 'all three passed, settlement may proceed' + RESET);
console.log('');
console.log('4. SETTLE  ' + DIM + '(one submission, five transactions)' + RESET);
rule();

const settle = await post('/api/runs/' + data.runId + '/settle', {});

if (settle.status !== 200 || !settle.body.ok) {
  console.log('  ' + RED + 'FAILED' + RESET + ' HTTP ' + settle.status);
  console.log('  ' + JSON.stringify(settle.body, null, 2));
  process.exit(1);
}

const settleData = settle.body.data;

console.log('  txId     : ' + settleData.txId);
console.log('  paid     : ' + human(settleData.totalPaidAtomic, decimals) + ' ' + data.asset.symbol);
console.log('');
bar();
console.log('  ' + GREEN + 'SETTLED' + RESET);
console.log('');
console.log('  Five transactions committed as one group. Three service fees and');
console.log('  the order payment moved together, or would not have moved at all.');
console.log('');
console.log('  ' + CYAN + settleData.explorerUrl + RESET);
bar();
console.log('');

process.exitCode = testCase.expect === 'settle' ? 0 : 1;