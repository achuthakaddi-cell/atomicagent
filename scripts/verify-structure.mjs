// verify-structure.mjs — checks that every expected file and folder exists,
// with the exact name it should have.
//
// Catches: missing files, typos (princeEngine vs priceEngine), wrong casing,
// and files saved into the wrong folder.
//
// Run from the project root:  node scripts/verify-structure.mjs

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// The expected shape of the project, as of the current build step.
// Add entries here as we create new files, so this stays the source of truth.
// ---------------------------------------------------------------------------
const EXPECTED = {
    'Root config': [
      'package.json',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      '.gitignore',
      '.gitattributes',
      '.env.example',
      '.env',
    ],
    'packages/shared': [
      'packages/shared/package.json',
      'packages/shared/tsconfig.json',
      'packages/shared/src/index.ts',
      'packages/shared/src/constants/network.ts',
      'packages/shared/src/constants/pricing.ts',
      'packages/shared/src/types/errors.ts',
      'packages/shared/src/types/x402.ts',
      'packages/shared/src/types/sourcing.ts',
      'packages/shared/src/schemas/sourcing.schema.ts',
      'packages/shared/src/schemas/x402.schema.ts',
    ],
    'apps/service-price': [
      'apps/service-price/package.json',
      'apps/service-price/tsconfig.json',
      'apps/service-price/src/index.ts',
      'apps/service-price/src/config/env.ts',
      'apps/service-price/src/config/logger.ts',
      'apps/service-price/src/config/x402.ts',
      'apps/service-price/src/domain/priceEngine.ts',
      'apps/service-price/src/middleware/errorHandler.ts',
      'apps/service-price/src/middleware/rateLimit.ts',
      'apps/service-price/src/middleware/x402Verify.ts',
      'apps/service-price/src/routes/check.ts',
    ],
    'apps/service-availability': [
      'apps/service-availability/package.json',
      'apps/service-availability/tsconfig.json',
      'apps/service-availability/src/index.ts',
      'apps/service-availability/src/config/env.ts',
      'apps/service-availability/src/config/logger.ts',
      'apps/service-availability/src/config/x402.ts',
      'apps/service-availability/src/domain/stockLedger.ts',
      'apps/service-availability/src/middleware/errorHandler.ts',
      'apps/service-availability/src/middleware/rateLimit.ts',
      'apps/service-availability/src/middleware/x402Verify.ts',
      'apps/service-availability/src/routes/check.ts',
    ],
    'apps/service-verification': [
      'apps/service-verification/package.json',
      'apps/service-verification/tsconfig.json',
      'apps/service-verification/src/index.ts',
      'apps/service-verification/src/config/env.ts',
      'apps/service-verification/src/config/logger.ts',
      'apps/service-verification/src/config/x402.ts',
      'apps/service-verification/src/domain/sellerRegistry.ts',
      'apps/service-verification/src/middleware/errorHandler.ts',
      'apps/service-verification/src/middleware/rateLimit.ts',
      'apps/service-verification/src/middleware/x402Verify.ts',
      'apps/service-verification/src/routes/check.ts',
    ],
  };

// Folders that must exist but may still be empty at this stage.
const EXPECTED_DIRS = [
    'apps/orchestrator',
    'apps/web',
    'scripts',
  ];

// Files that must never be committed.
const MUST_BE_GITIGNORED = ['.env'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let failures = 0;
let warnings = 0;

const rule = () => console.log('-'.repeat(72));
const bar = () => console.log('='.repeat(72));

/**
 * Checks a path exists AND that its name matches exactly, character for
 * character. Windows is case-insensitive, so fs.existsSync alone would happily
 * accept PriceEngine.ts when we asked for priceEngine.ts — and that file would
 * then fail to resolve on the Linux box we deploy to.
 *
 * @param relPath - path relative to the project root, using forward slashes
 * @returns 'ok' | 'missing' | a string describing the actual name found
 */
function checkExactName(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return 'missing';

  const dir = path.dirname(full);
  const wanted = path.basename(full);

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 'missing';
  }

  if (entries.includes(wanted)) return 'ok';

  const nearMiss = entries.find((e) => e.toLowerCase() === wanted.toLowerCase());
  return nearMiss ? 'case mismatch: found "' + nearMiss + '"' : 'missing';
}

/**
 * Looks for a likely typo of a missing filename in the same folder.
 *
 * @param relPath - the expected path
 * @returns a suggestion string, or null
 */
function suggestTypo(relPath) {
  const full = path.join(ROOT, relPath);
  const dir = path.dirname(full);
  const wanted = path.basename(full);

  if (!fs.existsSync(dir)) return null;

  const entries = fs.readdirSync(dir);
  const wantedExt = path.extname(wanted);

  for (const entry of entries) {
    if (path.extname(entry) !== wantedExt) continue;
    if (entry === wanted) continue;
    if (Math.abs(entry.length - wanted.length) <= 3) return entry;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
console.log('');
bar();
console.log('  ATOMICAGENT — STRUCTURE CHECK');
console.log('  root: ' + ROOT);
bar();

for (const [group, files] of Object.entries(EXPECTED)) {
  console.log('');
  console.log(group);
  rule();

  for (const relPath of files) {
    const result = checkExactName(relPath);
    const name = relPath.padEnd(52);

    if (result === 'ok') {
      const size = fs.statSync(path.join(ROOT, relPath)).size;
      console.log('  ' + GREEN + 'OK   ' + RESET + ' ' + name + ' ' + DIM + size + ' bytes' + RESET);
    } else if (result === 'missing') {
      failures++;
      console.log('  ' + RED + 'MISS ' + RESET + ' ' + name);
      const typo = suggestTypo(relPath);
      if (typo) {
        console.log('         ' + YELLOW + '-> found "' + typo + '" in that folder. Typo?' + RESET);
      }
    } else {
      failures++;
      console.log('  ' + RED + 'NAME ' + RESET + ' ' + name);
      console.log('         ' + YELLOW + '-> ' + result + RESET);
    }
  }
}

console.log('');
console.log('Required folders');
rule();

for (const relDir of EXPECTED_DIRS) {
  const full = path.join(ROOT, relDir);
  const exists = fs.existsSync(full) && fs.statSync(full).isDirectory();
  const name = relDir.padEnd(52);

  if (exists) {
    const count = fs.readdirSync(full).length;
    const note = count === 0 ? 'empty (fine for now)' : count + ' entries';
    console.log('  ' + GREEN + 'OK   ' + RESET + ' ' + name + ' ' + DIM + note + RESET);
  } else {
    failures++;
    console.log('  ' + RED + 'MISS ' + RESET + ' ' + name);
  }
}

console.log('');
console.log('Security');
rule();

const gitignorePath = path.join(ROOT, '.gitignore');
if (!fs.existsSync(gitignorePath)) {
  failures++;
  console.log('  ' + RED + 'MISS ' + RESET + ' .gitignore is missing entirely');
} else {
  const rules = fs.readFileSync(gitignorePath, 'utf8').split('\n').map((l) => l.trim());
  for (const relPath of MUST_BE_GITIGNORED) {
    if (rules.includes(relPath)) {
      console.log('  ' + GREEN + 'OK   ' + RESET + ' ' + relPath.padEnd(52) + ' ' + DIM + 'gitignored' + RESET);
    } else {
      failures++;
      console.log('  ' + RED + 'RISK ' + RESET + ' ' + relPath + ' is NOT in .gitignore');
    }
  }
}

console.log('');
console.log('Stray file scan');
rule();

const SCAN_DIRS = ['apps', 'packages'];

for (const scanDir of SCAN_DIRS) {
  const full = path.join(ROOT, scanDir);
  if (!fs.existsSync(full)) continue;

  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath, depth + 1);
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs')) &&
        !entryPath.includes(path.sep + 'src' + path.sep)
      ) {
        warnings++;
        const rel = path.relative(ROOT, entryPath).split(path.sep).join('/');
        console.log('  ' + YELLOW + 'WARN ' + RESET + ' ' + rel + ' is outside a src/ folder');
      }
    }
  };
  walk(full);
}

if (warnings === 0) {
  console.log('  ' + GREEN + 'OK   ' + RESET + ' no stray source files found');
}

// ---------------------------------------------------------------------------
console.log('');
bar();
if (failures === 0) {
  console.log('  ' + GREEN + 'STRUCTURE OK' + RESET + ' — every expected file is present and correctly named.');
} else {
  console.log('  ' + RED + failures + ' PROBLEM(S) FOUND' + RESET + ' — fix the entries marked MISS / NAME / RISK above.');
}
if (warnings > 0) {
  console.log('  ' + YELLOW + warnings + ' warning(s)' + RESET + ' — review, but not necessarily wrong.');
}
bar();
console.log('');

process.exit(failures === 0 ? 0 : 1);