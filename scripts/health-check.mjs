// health-check.mjs — checks all services in one shot.
//
// Confirms each is alive AND that each claims a DIFFERENT payment index.
// That last check matters: if two services claimed the same slot, the atomic
// group would be malformed and the whole design would silently break.
//
// Run:  pnpm health

const SERVICES = [
    { name: 'price',        port: 4101, expectedIndex: 1 },
    { name: 'availability', port: 4102, expectedIndex: 2 },
    { name: 'verification', port: 4103, expectedIndex: 3 },
  ];
  
  const GREEN = '\x1b[32m';
  const RED = '\x1b[31m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';
  
  const bar = () => console.log('='.repeat(72));
  
  let failures = 0;
  const seenIndices = new Map();
  
  console.log('');
  bar();
  console.log('  ATOMICAGENT — SERVICE HEALTH CHECK');
  bar();
  console.log('');
  
  for (const service of SERVICES) {
    const url = 'http://localhost:' + service.port + '/health';
  
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
  
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
  
      if (!response.ok) {
        failures++;
        console.log('  ' + RED + 'FAIL ' + RESET + service.name.padEnd(14) + 'HTTP ' + response.status);
        console.log('');
        continue;
      }
  
      const body = await response.json();
      const data = body.data ?? {};
      const index = data.paymentIndex;
  
      const indexOk = index === service.expectedIndex;
      if (!indexOk) failures++;
  
      // Two services claiming the same slot would break the atomic group.
      if (seenIndices.has(index)) {
        failures++;
        console.log(
          '  ' + RED + 'CLASH' + RESET + ' ' + service.name.padEnd(14) +
          'payment index ' + index + ' already claimed by ' + seenIndices.get(index),
        );
      } else {
        seenIndices.set(index, service.name);
      }
  
      const status = indexOk ? GREEN + 'OK   ' + RESET : RED + 'IDX  ' + RESET;
      console.log('  ' + status + ' ' + service.name.padEnd(14) + 'port ' + service.port + '  index ' + index);
      console.log('        ' + DIM + 'payTo ' + (data.payTo ?? 'unknown') + RESET);
      console.log('        ' + DIM + 'fee   ' + (data.feeAtomic ?? '?') + ' atomic units of ASA ' + (data.asset?.id ?? '?') + RESET);
      console.log('');
    } catch (err) {
      failures++;
      const reason = err.name === 'AbortError' ? 'timed out after 3s' : err.message;
      console.log('  ' + RED + 'DOWN ' + RESET + service.name.padEnd(14) + 'port ' + service.port + '  ' + reason);
      console.log('        ' + DIM + 'is `pnpm dev` running in the other terminal?' + RESET);
      console.log('');
    }
  }
  
  bar();
  if (failures === 0) {
    console.log('  ' + GREEN + 'ALL SERVICES HEALTHY' + RESET + ' — slots 1, 2 and 3 each claimed exactly once.');
  } else {
    console.log('  ' + RED + failures + ' PROBLEM(S)' + RESET + ' — see above.');
  }
  bar();
console.log('');

// Set the exit code rather than calling process.exit().
//
// process.exit() tears down the event loop immediately, which on Windows under
// Node 24 can trip a libuv assertion while fetch handles are still closing.
// Setting exitCode lets Node drain cleanly and then exit with the same status.
process.exitCode = failures === 0 ? 0 : 1;