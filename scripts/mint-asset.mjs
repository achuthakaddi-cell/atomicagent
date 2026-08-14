// mint-asset.mjs — creates the AtomicAgent demo payment asset on TestNet.
//
// WHY WE MINT OUR OWN
// -------------------
// TestNet USDC faucets dispense roughly 10-100 units. A realistic MSME order
// in this demo is 500 units at 5.00 each, or 2,500. No faucet covers that, and
// shrinking the demo to a 25-unit order weakens a pitch that is specifically
// about MSMEs losing meaningful money.
//
// So we mint an ASA with the SAME 6 decimals as USDC and a supply we choose.
// Nothing in the codebase changes: PAYMENT_ASSET_ID is one environment
// variable, and the x402 protocol only ever compares asset ids.
//
// All five accounts are already opted into real USDC, so switching back is a
// single env edit with no on-chain work.
//
// Run from the project root:  node scripts/mint-asset.mjs

import algosdk from 'algosdk';
import fs from 'node:fs';
import path from 'node:path';

const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const ALGOD_PORT = 443;

// ---------------------------------------------------------------------------
// Asset parameters
// ---------------------------------------------------------------------------
const ASSET_NAME = 'AtomicAgent Demo USD';
const UNIT_NAME = 'aUSDC';
const DECIMALS = 6;

/** 10,000,000 whole units. Ample for many demo runs at realistic order sizes. */
const TOTAL_SUPPLY = 10_000_000n * 10n ** BigInt(DECIMALS);

/** Which account creates and holds the supply. */
const CREATOR_ROLE = 'MSME_BUYER';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const bar = () => console.log('='.repeat(72));

// ---------------------------------------------------------------------------
// Load accounts
// ---------------------------------------------------------------------------
const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
const accountsPath = path.join(home, 'x402-probe', 'testnet-accounts.env');

if (!fs.existsSync(accountsPath)) {
  console.log('ERROR: could not find ' + accountsPath);
  process.exit(1);
}

const accounts = {};

for (const raw of fs.readFileSync(accountsPath, 'utf8').split('\n')) {
  const line = raw.trim();
  const eq = line.indexOf('=');
  if (eq === -1) continue;

  const key = line.slice(0, eq);
  const value = line.slice(eq + 1).trim();

  if (key.endsWith('_ADDRESS')) {
    const role = key.replace('_ADDRESS', '');
    accounts[role] = { ...(accounts[role] ?? {}), address: value };
  } else if (key.endsWith('_SK_B64')) {
    const role = key.replace('_SK_B64', '');
    accounts[role] = {
      ...(accounts[role] ?? {}),
      secretKey: new Uint8Array(Buffer.from(value, 'base64')),
    };
  }
}

const creator = accounts[CREATOR_ROLE];

if (!creator?.address || !creator?.secretKey) {
  console.log('ERROR: could not load ' + CREATOR_ROLE + ' from ' + accountsPath);
  process.exit(1);
}

const client = new algosdk.Algodv2('', ALGOD_SERVER, ALGOD_PORT);

console.log('');
bar();
console.log('  MINT ATOMICAGENT DEMO ASSET');
console.log('  name     : ' + ASSET_NAME);
console.log('  unit     : ' + UNIT_NAME);
console.log('  decimals : ' + DECIMALS + '   (same as USDC)');
console.log('  supply   : ' + (TOTAL_SUPPLY / 10n ** BigInt(DECIMALS)).toLocaleString() + ' whole units');
console.log('  creator  : ' + CREATOR_ROLE);
console.log('  address  : ' + creator.address);
bar();
console.log('');

// ---------------------------------------------------------------------------
// 1. Create the asset
// ---------------------------------------------------------------------------
console.log('1. CREATING ASSET');
console.log('-'.repeat(72));

let assetId = null;

try {
  const params = await client.getTransactionParams().do();

  // Manager, reserve, freeze and clawback are all left UNSET.
  //
  // That matters for credibility. With no freeze address nobody can freeze a
  // holder's balance, and with no clawback nobody can seize it. The asset
  // behaves like a plain token, not one the demo operator can manipulate
  // mid-run to force a particular outcome.
  const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender: creator.address,
    total: TOTAL_SUPPLY,
    decimals: DECIMALS,
    defaultFrozen: false,
    unitName: UNIT_NAME,
    assetName: ASSET_NAME,
    manager: undefined,
    reserve: undefined,
    freeze: undefined,
    clawback: undefined,
    suggestedParams: params,
  });

  const signed = txn.signTxn(creator.secretKey);
  const response = await client.sendRawTransaction(signed).do();
  const txId = response.txid ?? response.txId;

  console.log('  submitted: ' + txId);
  console.log('  waiting for confirmation...');

  const confirmed = await algosdk.waitForConfirmation(client, txId, 10);

  // v3 returns assetIndex on the confirmation; older responses used
  // 'asset-index'. Read both so this works either way.
  const rawIndex = confirmed.assetIndex ?? confirmed['asset-index'];
  assetId = String(rawIndex);

  console.log('');
  console.log('  ' + GREEN + 'ASSET CREATED' + RESET);
  console.log('  asset id : ' + assetId);
  console.log('  round    : ' + String(confirmed.confirmedRound ?? confirmed['confirmed-round']));
  console.log('  explorer : https://lora.algokit.io/testnet/asset/' + assetId);
  console.log('');
} catch (err) {
  console.log('  ' + RED + 'FAILED' + RESET + ': ' + String(err.message).split('\n')[0]);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Opt in the four payee accounts
// ---------------------------------------------------------------------------
console.log('2. OPTING IN PAYEE ACCOUNTS');
console.log('-'.repeat(72));

const payeeRoles = Object.keys(accounts).filter((role) => role !== CREATOR_ROLE);
let optInFailures = 0;

for (const role of payeeRoles) {
  const account = accounts[role];

  if (!account?.address || !account?.secretKey) {
    console.log('  ' + RED + 'SKIP    ' + RESET + role.padEnd(18) + 'missing key');
    optInFailures += 1;
    continue;
  }

  try {
    const params = await client.getTransactionParams().do();

    // An opt-in is a zero-amount asset transfer from an account to itself.
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: account.address,
      receiver: account.address,
      amount: 0,
      assetIndex: Number(assetId),
      suggestedParams: params,
    });

    const signed = txn.signTxn(account.secretKey);
    const response = await client.sendRawTransaction(signed).do();
    const txId = response.txid ?? response.txId;

    await algosdk.waitForConfirmation(client, txId, 8);

    console.log('  ' + GREEN + 'OPTED IN' + RESET + ' ' + role.padEnd(18) + txId.slice(0, 24) + '...');
  } catch (err) {
    console.log('  ' + RED + 'FAILED  ' + RESET + role.padEnd(18) + String(err.message).split('\n')[0]);
    optInFailures += 1;
  }
}

console.log('');

// ---------------------------------------------------------------------------
// 3. Verify every holding
// ---------------------------------------------------------------------------
console.log('3. VERIFYING HOLDINGS');
console.log('-'.repeat(72));

for (const [role, account] of Object.entries(accounts)) {
  try {
    const holding = await client.accountAssetInformation(account.address, Number(assetId)).do();
    const raw = BigInt(holding.assetHolding?.amount ?? 0n);
    const human = (Number(raw) / Math.pow(10, DECIMALS)).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    console.log('  ' + GREEN + 'OK  ' + RESET + role.padEnd(18) + human.padStart(18) + ' ' + UNIT_NAME);
  } catch {
    console.log('  ' + RED + 'NOT OPTED IN' + RESET + ' ' + role);
  }
}

// ---------------------------------------------------------------------------
// 4. What to change in .env
// ---------------------------------------------------------------------------
console.log('');
bar();

if (optInFailures === 0) {
  console.log('  ' + GREEN + 'MINT COMPLETE' + RESET);
} else {
  console.log('  ' + YELLOW + 'MINT COMPLETE WITH ' + optInFailures + ' OPT-IN FAILURE(S)' + RESET);
}

console.log('');
console.log('  Update these three lines in .env:');
console.log('');
console.log('    PAYMENT_ASSET_ID=' + assetId);
console.log('    PAYMENT_ASSET_DECIMALS=' + DECIMALS);
console.log('    PAYMENT_ASSET_SYMBOL=' + UNIT_NAME);
console.log('');
console.log('  ' + DIM + 'To switch back to real USDC later, set 10458941 / 6 / USDC.' + RESET);
console.log('  ' + DIM + 'All five accounts are already opted into USDC, so no on-chain' + RESET);
console.log('  ' + DIM + 'work is needed to switch.' + RESET);
console.log('');
console.log('  Then restart the services:  Ctrl+C in terminal 1, then pnpm dev');
console.log('');
bar();
console.log('');

process.exitCode = optInFailures === 0 ? 0 : 1;