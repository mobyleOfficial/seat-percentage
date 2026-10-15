#!/usr/bin/env node
/**
 * Capture static Ingresso movie-page HTML for the extension tests.
 *
 * Usage: npm run test:dump-fixture
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'fixtures', 'ingresso');
const MOVIE_URL = 'https://www.ingresso.com/filme/homem-aranha-um-novo-dia?city=sao-paulo';

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'pt-BR' });
const page = await context.newPage();

await context.addCookies([
  { name: 'ingressoCookieConsent', value: 'true', domain: '.ingresso.com', path: '/' },
]);

console.log('Fetching live Ingresso page…');
await page.goto(MOVIE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => {
  return Array.from(document.body.querySelectorAll('*')).some(
    el => /^\d{2}:\d{2}$/.test(el.textContent.trim()) && el.children.length === 0,
  );
}, { timeout: 90000 });
await page.waitForTimeout(3000);

const html = await page.content();
fs.writeFileSync(path.join(OUT, 'movie-page.html'), html);

const sessions = await page.evaluate(() => document.querySelectorAll('a[href*="sessionId="]').length);

console.log(`Saved fixtures to ${OUT}`);
console.log(`  movie-page.html (${html.length} bytes, ${sessions} session links)`);

await browser.close();
