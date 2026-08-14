// check-asset.mjs — shows ASA opt-in status and balance for all 5 accounts.
//
// On Algorand an account must opt into an asset before it can receive it.
// Every account in an AtomicAgent group that RECEIVES the payment asset must
// have opted in, or settlement fails.
//
// Run:  node scripts/check-asset.mjs

import algosdk from 'algosdk';
import fs from 'node:fs';
import path from 'node:path';

const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const ALGOD_PORT = 443;

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const bar = () => console.log('='.repeat(72));

// ---- read the asset id from .env ----
const envPath = path.join(process.cwd(), '.env');

if (!fs.existsSync(envPath)) {
  console.log('ERROR: .env not found. Run this from the project root.');
  process.exit(1);
}

let assetId = null;
let assetSymbol = 'ASSET';

for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const line = raw.trim();
  if (line.startsWith('PAYMENT_ASSET_ID=')) assetId = line.slice(17).trim();
  if (line.startsWith('PAYMENT_ASSET_SYMBOL=')) assetSymbol = line.slice(21).trim();
}

if (!assetId) {
  console.log('ERROR: PAYMENT_ASSET_ID not found in .env');
  process.exit(1);
}

// ---- read the addresses from the probe folder ----
const accountsPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'x402-probe', 'testnet-accounts.env');

const addresses = {};

if (fs.existsSync(accountsPath)) {
  for (const raw of fs.readFileSync(accountsPath, 'utf8').split('\n')) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq);
    if (key.endsWith('_ADDRESS')) {
      addresses[key.replace('_ADDRESS', '')] = line.slice(eq + 1).trim();
    }
  }
} else {
  // Fall back to the payee addresses in .env
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq);
    if (key.endsWith('_ADDRESS') && !key.startsWith('#')) {
      addresses[key.replace('_ADDRESS', '')] = line.slice(eq + 1).trim();
    }
  }
}

const client = new algosdk.Algodv2('', ALGOD_SERVER, ALGOD_PORT);

console.log('');
bar();
console.log('  ASSET OPT-IN CHECK');
console.log('  asset : ' + assetId + '  (' + assetSymbol + ')');
bar();
console.log('');

// ---- asset metadata ----
let decimals = 6;

try {
  const info = await client.getAssetByID(Number(assetId)).do();
  decimals = Number(info.params.decimals);
  console.log('  name     : ' + (info.params.name ?? '(none)'));
  console.log('  unit     : ' + (info.params.unitName ?? '(none)'));
  console.log('  decimals : ' + decimals);
  console.log('  total    : ' + String(info.params.total));
  console.log('');
} catch (err) {
  console.log('  ' + RED + 'Could not read asset ' + assetId + RESET);
  console.log('  ' + String(err.message).split('\n')[0]);
  console.log('');
}

// ---- per-account holdings ----
let anyMissing = false;

for (const [role, address] of Object.entries(addresses)) {
  try {
    const holding = await client.accountAssetInformation(address, Number(assetId)).do();
    const raw = BigInt(holding.assetHolding?.amount ?? 0n);
    const human = (Number(raw) / Math.pow(10, decimals)).toFixed(decimals);

    console.log('  ' + GREEN + 'OPTED IN' + RESET + ' ' + role.padEnd(18) + human + ' ' + assetSymbol);
    console.log('           ' + DIM + address + RESET);
  } catch (err) {
    const message = String(err.message);
    const notOptedIn = message.includes('404') || message.toLowerCase().includes('not found');

    anyMissing = true;
    console.log('  ' + RED + (notOptedIn ? 'NOT OPTED' : 'ERROR   ') + RESET + ' ' + role.padEnd(18) +
      (notOptedIn ? 'must opt in before receiving' : message.split('\n')[0]));
    console.log('           ' + DIM + address + RESET);
  }
  console.log('');
}

bar();
if (anyMissing) {
  console.log('  ' + RED + 'SOME ACCOUNTS ARE NOT OPTED IN' + RESET);
  console.log('  Every account that RECEIVES this asset must opt in first.');
} else {
  console.log('  ' + GREEN + 'ALL ACCOUNTS OPTED IN' + RESET);
}
bar();
console.log('');

process.exitCode = anyMissing ? 1 : 0;