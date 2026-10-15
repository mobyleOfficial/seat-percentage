#!/usr/bin/env node
/**
 * Pure-function tests for Ingresso seat map → room occupancy.
 *
 * Usage: node scripts/test-seat-percentage.mjs
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  extractSessionId,
  collectSessionIds,
  countSeats,
  summarizeSeatMaps,
  occupancyLevel
} = require(path.join(__dirname, '..', 'lib', 'seat-percentage.js'));

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ok — ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL — ${message}`);
    console.error(`         expected: ${JSON.stringify(expected)}`);
    console.error(`         actual:   ${JSON.stringify(actual)}`);
  }
}

function seatMap(statuses) {
  return { lines: [{ line: 1, seats: statuses.map((status, i) => ({ id: String(i), status })) }] };
}

console.log('extractSessionId');
assertEqual(
  extractSessionId('https://checkout.ingresso.com/?sessionId=86478848&partnership=home'),
  '86478848',
  'reads sessionId from a checkout link'
);
assertEqual(
  extractSessionId('https://checkout.ingresso.com/?partnership=home&sessionId=123'),
  '123',
  'reads sessionId when it is not the first param'
);
assertEqual(extractSessionId('https://www.ingresso.com/cinema/x'), null, 'null without sessionId');
assertEqual(extractSessionId(undefined), null, 'null for undefined');

console.log('countSeats');
assertEqual(
  countSeats(seatMap(['Available', 'Occupied', 'Occupied', 'PhysicalDistance'])),
  { free: 1, taken: 2 },
  'PhysicalDistance seats are not counted'
);
assertEqual(countSeats({}), { free: 0, taken: 0 }, 'empty map');
assertEqual(countSeats(null), { free: 0, taken: 0 }, 'null map');

console.log('summarizeSeatMaps');
assertEqual(
  summarizeSeatMaps([seatMap(['Available', 'Occupied', 'Occupied', 'Available'])]),
  { taken: 2, capacity: 4, percent: 50 },
  'half full'
);
assertEqual(
  summarizeSeatMaps([seatMap(['Occupied', 'Available']), seatMap(['Occupied', 'Occupied'])]),
  { taken: 3, capacity: 4, percent: 75 },
  'sums every section of a session'
);
assertEqual(
  summarizeSeatMaps([seatMap(['Occupied', 'Available', 'Available'])]),
  { taken: 1, capacity: 3, percent: 33 },
  'rounds the percentage'
);
assertEqual(summarizeSeatMaps([seatMap(['PhysicalDistance'])]), null, 'null when no sellable seats');
assertEqual(summarizeSeatMaps([]), null, 'null without sections');

console.log('collectSessionIds');
const midnightSession = {
  id: '87162327',
  time: '00:01',
  siteURL: 'https://checkout.ingresso.com/?sessionId=87162327&partnership=home',
  midnightMessage: 'Essa sessão ocorrerá na madrugada de 15/12/2026 para 16/12/2026. Deseja continuar?'
};
assertEqual(collectSessionIds({ session: midnightSession, onClick() {} }), ['87162327'], 'finds the id in a nested siteURL');
assertEqual(
  collectSessionIds({ sessions: [midnightSession, { siteURL: 'https://checkout.ingresso.com/?sessionId=87162337' }] }),
  ['87162327', '87162337'],
  'reports every distinct id so callers can reject a list'
);
assertEqual(collectSessionIds({ a: midnightSession, b: { ...midnightSession } }), ['87162327'], 'deduplicates repeated ids');
assertEqual(collectSessionIds({ children: midnightSession }), [], 'ignores children');
assertEqual(collectSessionIds({ a: { b: { c: { d: { e: { siteURL: '?sessionId=1' } } } } } }), [], 'stops at the depth bound');
const cyclic = { siteURL: '?sessionId=42' };
cyclic.self = cyclic;
assertEqual(collectSessionIds(cyclic), ['42'], 'survives cycles');
assertEqual(collectSessionIds({ node: new (class Node { constructor() { this.href = '?sessionId=9'; } })() }), [], 'skips class instances');
assertEqual(collectSessionIds(null), [], 'empty for null');

console.log('occupancyLevel');
assertEqual(occupancyLevel(0), 'low', '0% is low');
assertEqual(occupancyLevel(49), 'low', '49% is low');
assertEqual(occupancyLevel(50), 'medium', '50% is medium');
assertEqual(occupancyLevel(79), 'medium', '79% is medium');
assertEqual(occupancyLevel(80), 'high', '80% is high');
assertEqual(occupancyLevel(100), 'high', '100% is high');

console.log('');
if (failed) {
  console.error(`${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`All ${passed} assertions passed`);
