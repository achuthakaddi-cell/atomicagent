// probe-facilitator.mjs — asks the live GoPlausible facilitator what it supports.
//
// Slot 0 of our atomic group is a fee-payer transaction that the FACILITATOR
// signs, not the buyer. To build it we need the facilitator's fee-payer address
// for Algorand TestNet. The x402 AVM spec says it arrives in the `extra` field
// of the /supported response, but the exact shape is undocumented — so we ask.
//
// Run from the project root:  node scripts/probe-facilitator.mjs

const FACILITATOR_URL = 'https://facilitator.goplausible.xyz';
const TESTNET_CAIP2 = 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=';

const bar = () => console.log('='.repeat(72));
const rule = () => console.log('-'.repeat(72));

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

console.log('');
bar();
console.log('  FACILITATOR CAPABILITY PROBE');
console.log('  url: ' + FACILITATOR_URL);
bar();

// ---------------------------------------------------------------------------
// 1. Raw /supported response
// ---------------------------------------------------------------------------
console.log('');
console.log('1. GET /supported  (raw HTTP)');
rule();

let supported = null;

try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  const response = await fetch(FACILITATOR_URL + '/supported', {
    signal: controller.signal,
    headers: { Accept: 'application/json' },
  });
  clearTimeout(timer);

  console.log('  status: ' + response.status + ' ' + response.statusText);

  const text = await response.text();
  console.log('  bytes : ' + text.length);
  console.log('');

  try {
    supported = JSON.parse(text);
    console.log(JSON.stringify(supported, null, 2).slice(0, 6000));
  } catch {
    console.log('  (not JSON)');
    console.log(text.slice(0, 2000));
  }
} catch (err) {
  console.log('  ' + RED + 'FAILED' + RESET + ': ' + err.message);
}

// ---------------------------------------------------------------------------
// 2. Find the Algorand TestNet entry and its feePayer
// ---------------------------------------------------------------------------
console.log('');
console.log('2. ALGORAND TESTNET ENTRY');
rule();

let feePayer = null;

if (supported) {
  // The response may nest the list under `kinds`, `supported`, or be an array.
  const candidates =
    supported.kinds ??
    supported.supported ??
    (Array.isArray(supported) ? supported : null);

  if (!Array.isArray(candidates)) {
    console.log('  ' + YELLOW + 'Could not find an array of kinds.' + RESET);
    console.log('  top-level keys: ' + Object.keys(supported).join(', '));
  } else {
    console.log('  found ' + candidates.length + ' supported kind(s)');
    console.log('');

    for (const kind of candidates) {
      const isOurs = kind.network === TESTNET_CAIP2;
      const marker = isOurs ? GREEN + '>>> ' + RESET : '    ';
      console.log(marker + 'scheme=' + kind.scheme + '  network=' + kind.network);

      if (kind.extra) {
        console.log('        extra: ' + JSON.stringify(kind.extra));
      }

      if (isOurs && kind.extra) {
        feePayer =
          kind.extra.feePayer ??
          kind.extra.feepayer ??
          kind.extra.fee_payer ??
          null;
      }
    }
  }
}

console.log('');
if (feePayer) {
  console.log('  ' + GREEN + 'FEE PAYER FOUND' + RESET);
  console.log('  ' + feePayer);
  console.log('  length: ' + feePayer.length + (feePayer.length === 58 ? ' (valid)' : ' <-- EXPECTED 58'));
} else {
  console.log('  ' + RED + 'NO FEE PAYER FOUND' + RESET);
  console.log('  ' + DIM + 'We may need the buyer to cover fees instead of the facilitator.' + RESET);
}

// ---------------------------------------------------------------------------
// 3. Same call through the SDK client
// ---------------------------------------------------------------------------
console.log('');
console.log('3. VIA HTTPFacilitatorClient.getSupported()');
rule();

try {
  const { HTTPFacilitatorClient } = await import('@x402-avm/core/server');
  const client = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

  const result = await client.getSupported();
  console.log('  returned type: ' + typeof result);
  console.log('  top-level keys: ' + Object.keys(result ?? {}).join(', '));
  console.log('');
  console.log(JSON.stringify(result, null, 2).slice(0, 4000));
} catch (err) {
  console.log('  ' + RED + 'FAILED' + RESET + ': ' + String(err.message).split('\n')[0]);
  console.log('  ' + DIM + 'If this fails but step 1 worked, we call the endpoint directly.' + RESET);
}

// ---------------------------------------------------------------------------
// 4. Discover other endpoints
// ---------------------------------------------------------------------------
console.log('');
console.log('4. OTHER ENDPOINTS');
rule();

for (const path of ['/', '/health', '/docs', '/openapi.json']) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(FACILITATOR_URL + path, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    const type = response.headers.get('content-type') ?? 'unknown';
    console.log('  ' + path.padEnd(18) + response.status + '  ' + type.split(';')[0]);
  } catch (err) {
    console.log('  ' + path.padEnd(18) + 'failed: ' + String(err.message).split('\n')[0]);
  }
}

bar();
console.log('  DONE');
bar();
console.log('');