// probe-wallet.mjs — verifies the use-wallet v4 API before we write against it.
//
// THE QUESTION THAT MATTERS
// -------------------------
// AtomicAgent signs slots 1-4 of a five-transaction group and leaves slot 0
// UNSIGNED, so the facilitator can sign it and cover every fee. We need to know
// exactly how signTransactions() expresses "sign only these indexes".
//
// v2 used signTransactions(encodedTxns, indexesToSign). v4 may differ, and most
// tutorials online still show the v2 API. So we read the type declarations.

import fs from 'node:fs';
import path from 'node:path';

const bar = () => console.log('='.repeat(72));
const rule = () => console.log('-'.repeat(72));

const PACKAGES = ['@txnlab/use-wallet-react', '@txnlab/use-wallet', '@perawallet/connect'];

function collectDts(dir, depth = 0, acc = []) {
  if (depth > 4 || !fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectDts(full, depth + 1, acc);
    else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.mts')) acc.push(full);
  }
  return acc;
}

const ROOTS = [
  'apps/web/node_modules',
  'node_modules',
];

console.log('');
bar();
console.log('  USE-WALLET API PROBE');
bar();

// ---------- 1. Versions ----------
console.log('');
console.log('1. INSTALLED VERSIONS');
rule();

const found = {};

for (const name of PACKAGES) {
  for (const root of ROOTS) {
    const pkgPath = path.join(root, ...name.split('/'), 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log('  ' + name.padEnd(30) + pkg.version);
    console.log('    ' + path.dirname(pkgPath));
    found[name] = path.dirname(pkgPath);
    break;
  }
  if (!found[name]) console.log('  ' + name.padEnd(30) + 'NOT FOUND');
}

// ---------- 2. Exports ----------
console.log('');
console.log('2. RUNTIME EXPORTS');
rule();

for (const name of ['@txnlab/use-wallet-react']) {
  console.log('');
  console.log('  import("' + name + '")');
  try {
    const mod = await import(name);
    for (const key of Object.keys(mod).sort()) {
      console.log('    ' + key + '  [' + typeof mod[key] + ']');
    }
  } catch (err) {
    console.log('    FAILED: ' + String(err.message).split('\n')[0]);
  }
}

// ---------- 3. The signatures we need ----------
console.log('');
console.log('3. KEY DECLARATIONS');
rule();

const TARGETS = [
  'signTransactions',
  'WalletManager',
  'WalletId',
  'NetworkId',
  'useWallet',
  'WalletProvider',
  'activeAddress',
  'transactionSigner',
];

const files = Object.values(found).flatMap((dir) => collectDts(dir));

for (const target of TARGETS) {
  console.log('');
  console.log('  ### ' + target);

  let hits = 0;

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.includes(target)) continue;
      if (!line.includes('(') && !line.includes(':') && !line.includes('declare')) continue;

      hits += 1;
      if (hits > 4) break;

      console.log('    ' + line.trim().slice(0, 160));
      // Show the next line too, since signatures often wrap.
      const next = lines[i + 1];
      if (next && next.trim().length > 0 && next.trim().length < 140) {
        console.log('      ' + next.trim().slice(0, 160));
      }
    }
    if (hits > 4) break;
  }

  if (hits === 0) console.log('    NOT FOUND');
}

// ---------- 4. WalletId values ----------
console.log('');
console.log('4. AVAILABLE WALLET IDS');
rule();

try {
  const mod = await import('@txnlab/use-wallet-react');
  if (mod.WalletId) {
    console.log('  ' + Object.keys(mod.WalletId).join(', '));
  } else {
    console.log('  WalletId not exported at runtime');
  }
  if (mod.NetworkId) {
    console.log('');
    console.log('  NetworkId: ' + Object.keys(mod.NetworkId).join(', '));
  }
} catch (err) {
  console.log('  FAILED: ' + String(err.message).split('\n')[0]);
}

bar();
console.log('  DONE');
bar();
console.log('');
