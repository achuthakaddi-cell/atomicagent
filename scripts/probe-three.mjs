// probe-three.mjs — verifies the three.js API we are about to build against.
//
// We are writing raw GLSL and driving the render loop by hand, so a wrong
// assumption about a constructor or a uniform shape produces a black screen
// with no error. Better to ask the installed package directly.
//
// Run from the project root:  node scripts/probe-three.mjs

import fs from 'node:fs';
import path from 'node:path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const bar = () => console.log('='.repeat(72));
const rule = () => console.log('-'.repeat(72));

console.log('');
bar();
console.log('  THREE.JS API PROBE');
bar();

// ---------------------------------------------------------------------------
// 1. Version
// ---------------------------------------------------------------------------
console.log('');
console.log('1. INSTALLED VERSION');
rule();

const ROOTS = ['apps/web/node_modules', 'node_modules'];
let threeDir = null;

for (const root of ROOTS) {
  const pkgPath = path.join(root, 'three', 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  console.log('  three           ' + pkg.version);
  console.log('  ' + DIM + path.dirname(pkgPath) + RESET);
  console.log('  main            ' + (pkg.main ?? '(none)'));
  console.log('  module          ' + (pkg.module ?? '(none)'));
  console.log('  exports keys    ' + (pkg.exports ? Object.keys(pkg.exports).join(', ') : '(none)'));
  threeDir = path.dirname(pkgPath);
  break;
}

if (!threeDir) {
  console.log('  ' + RED + 'NOT INSTALLED' + RESET);
  process.exit(1);
}

const typesPath = path.join('apps/web/node_modules/@types/three/package.json');
if (fs.existsSync(typesPath)) {
  const t = JSON.parse(fs.readFileSync(typesPath, 'utf8'));
  console.log('  @types/three    ' + t.version);
} else {
  console.log('  @types/three    ' + RED + 'NOT FOUND' + RESET);
}

// ---------------------------------------------------------------------------
// 2. The exports we need
// ---------------------------------------------------------------------------
console.log('');
console.log('2. REQUIRED EXPORTS');
rule();

const NEEDED = [
  'WebGLRenderer',
  'Scene',
  'OrthographicCamera',
  'PerspectiveCamera',
  'PlaneGeometry',
  'ShaderMaterial',
  'RawShaderMaterial',
  'Mesh',
  'Vector2',
  'Vector3',
  'Color',
  'Clock',
  'BufferGeometry',
  'BufferAttribute',
  'Points',
  'PointsMaterial',
  'InstancedMesh',
  'Group',
];

let missing = 0;

try {
  const THREE = await import('three');

  for (const name of NEEDED) {
    const present = typeof THREE[name] !== 'undefined';
    if (!present) missing += 1;
    console.log(
      '  ' + (present ? GREEN + 'OK  ' + RESET : RED + 'MISS' + RESET) +
      ' ' + name.padEnd(24) + (present ? typeof THREE[name] : ''),
    );
  }

  console.log('');
  console.log('  total exports: ' + Object.keys(THREE).length);
} catch (err) {
  console.log('  ' + RED + 'IMPORT FAILED' + RESET + ': ' + String(err.message).split('\n')[0]);
  missing = 999;
}

// ---------------------------------------------------------------------------
// 3. ShaderMaterial and WebGLRenderer signatures
// ---------------------------------------------------------------------------
console.log('');
console.log('3. KEY SIGNATURES FROM TYPES');
rule();

const typesDir = 'apps/web/node_modules/@types/three';

/**
 * Finds declaration lines mentioning a symbol.
 *
 * @param dir - directory to search
 * @param symbol - what to look for
 * @param limit - how many hits to print
 */
function findInTypes(dir, symbol, limit = 3) {
  if (!fs.existsSync(dir)) return;

  const stack = [dir];
  let hits = 0;

  while (stack.length > 0 && hits < limit) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (hits >= limit) break;
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith('.d.ts')) {
        let text;
        try {
          text = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        if (!text.includes(symbol)) continue;

        const lines = text.split('\n');
        for (let i = 0; i < lines.length && hits < limit; i += 1) {
          if (!lines[i].includes(symbol)) continue;
          if (!lines[i].includes('constructor') && !lines[i].includes('interface') && !lines[i].includes('class')) continue;
          hits += 1;
          console.log('    ' + lines[i].trim().slice(0, 150));
        }
      }
    }
  }

  if (hits === 0) console.log('    ' + DIM + '(no declaration lines found)' + RESET);
}

for (const symbol of ['ShaderMaterialParameters', 'WebGLRendererParameters', 'class ShaderMaterial', 'class WebGLRenderer']) {
  console.log('');
  console.log('  ### ' + symbol);
  findInTypes(typesDir, symbol, 4);
}

// ---------------------------------------------------------------------------
bar();
if (missing === 0) {
  console.log('  ' + GREEN + 'ALL EXPORTS PRESENT' + RESET + ' — safe to write GLSL against this build.');
} else {
  console.log('  ' + RED + missing + ' EXPORT(S) MISSING' + RESET);
}
bar();
console.log('');

process.exitCode = missing === 0 ? 0 : 1;