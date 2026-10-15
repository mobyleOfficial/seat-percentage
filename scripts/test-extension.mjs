#!/usr/bin/env node
/**
 * Playwright integration tests for Ingresso Seat Percentage (Chromium).
 *
 * Usage: npm run test:chrome
 */

import {
  createReporter,
  launchExtensionContext,
  openFixturePage,
} from './lib/test-harness.mjs';
import { runExtensionTests } from './run-extension-tests.mjs';

process.env.CI = 'true';

const report = createReporter();

console.log('Launching Chromium with extension and static Ingresso fixture…');
const { context, page } = await launchExtensionContext();

try {
  await openFixturePage(page);

  const failures = await runExtensionTests({ page, report });

  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error('\nFatal:', err.message);
  process.exitCode = 1;
} finally {
  await context.close();
}
