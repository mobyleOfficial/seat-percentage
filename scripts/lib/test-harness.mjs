import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleSessionsApi } from './seat-fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '../..');
export const FIXTURES = path.join(ROOT, 'fixtures', 'ingresso');
export const PROFILE = process.env.CI
  ? path.join(os.tmpdir(), 'isp-playwright-profile-tests')
  : path.join(ROOT, '.playwright-profile-tests');
export const MOVIE_URL = 'https://www.ingresso.com/filme/homem-aranha-um-novo-dia?city=sao-paulo';

export function createReporter() {
  let passed = 0;
  let failed = 0;

  return {
    passed: () => passed,
    failed: () => failed,
    assert(name, condition, detail = '') {
      if (condition) {
        passed += 1;
        console.log(`  ✓ ${name}`);
        return;
      }
      failed += 1;
      console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    },
    section(title) {
      console.log(`\n${title}`);
    },
    summary() {
      console.log(`\n${'='.repeat(40)}`);
      console.log(`Passed: ${passed}  Failed: ${failed}`);
      return failed;
    },
  };
}

function stripScripts(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '');
}

let fixtureHtmlCache = null;

export function loadFixtureHtml() {
  if (!fixtureHtmlCache) {
    const raw = fs.readFileSync(path.join(FIXTURES, 'movie-page.html'), 'utf8');
    fixtureHtmlCache = stripScripts(raw);
  }
  return fixtureHtmlCache;
}

export async function setupFixtureRoutes(page) {
  const html = loadFixtureHtml();

  await page.route('**/www.ingresso.com/filme/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    });
  });

  await page.route('**/api.ingresso.com/v1/sessions/**', (route) => {
    const { status, body } = handleSessionsApi(new URL(route.request().url()).pathname);
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body,
    });
  });
}

export async function launchExtensionContext() {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1360, height: 900 },
    locale: 'pt-BR',
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  const page = context.pages()[0] || await context.newPage();
  await setupFixtureRoutes(page);

  await context.addCookies([
    { name: 'ingressoCookieConsent', value: 'true', domain: '.ingresso.com', path: '/' },
    { name: 'dcuc', value: 'true', domain: '.ingresso.com', path: '/' },
  ]);

  return { context, page };
}

export async function openFixturePage(page) {
  await page.goto(MOVIE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.addStyleTag({
    content: '.CookieConsent, [class*="CookieConsent"] { display: none !important; }',
  }).catch(() => {});
}

export async function waitForContentScript(page) {
  await page.waitForFunction(() => !!window.__ispLoaded, undefined, { timeout: 30000 });
  console.log('  ✓ Content script active');
}

/** Every session-time badge on the page with the session id of its host. */
export async function readBadges(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-isp-occ]')).map((badge) => {
    const host = badge.parentElement;
    const rect = host.getBoundingClientRect();
    return {
      sessionId: host.dataset.ispSessionId || null,
      state: badge.dataset.state,
      level: badge.dataset.level || null,
      text: badge.querySelector('.isp-occ-num')?.textContent || '',
      fill: badge.querySelector('.isp-occ-fill')?.style.width || '',
      title: host.title || '',
      inViewport: rect.bottom > 0 && rect.top < window.innerHeight,
    };
  }));
}
