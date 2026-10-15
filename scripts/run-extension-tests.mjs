import {
  createReporter,
  waitForContentScript,
  readBadges,
} from './lib/test-harness.mjs';
import { expectedBadge } from './lib/seat-fixtures.mjs';

const NEW_SESSION_ID = '90000002'; // % 5 === 2 → 55%, medium

export async function runExtensionTests({
  page,
  report = createReporter(),
}) {
  async function waitForSettledInViewport() {
    await page.waitForFunction(() => {
      const visible = Array.from(document.querySelectorAll('[data-isp-occ]')).filter((badge) => {
        const rect = badge.parentElement.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
      return visible.length > 0 && visible.every(b => b.dataset.state !== 'loading');
    }, undefined, { timeout: 30000 });
  }

  function assertBadgesMatchFixture(badges, label) {
    const mismatches = badges.filter((b) => {
      const exp = expectedBadge(b.sessionId);
      return b.state !== exp.state || b.text !== exp.text || (exp.level && b.level !== exp.level);
    });
    report.assert(
      `${label}: every badge matches its seat map`,
      badges.length > 0 && mismatches.length === 0,
      mismatches.slice(0, 3).map(b => `${b.sessionId}=${b.state}/${b.text}/${b.level}`).join(', '),
    );
  }

  async function testBadgesAttached() {
    report.section('Badges: one per enabled session time');

    await page.waitForSelector('[data-isp-occ]', { state: 'attached', timeout: 30000 });
    const counts = await page.evaluate(() => {
      const TIME_RE = /^\d{2}:\d{2}$/;
      const links = Array.from(document.querySelectorAll('a[href*="sessionId="]'))
        .filter(a => TIME_RE.test(a.textContent.trim()) && !(a.closest('button') || a).disabled);
      const hosts = new Set(links.map(a => a.closest('button') || a));
      return {
        hosts: hosts.size,
        badges: document.querySelectorAll('[data-isp-occ]').length,
        withId: Array.from(hosts).filter(h => h.dataset.ispSessionId).length,
      };
    });
    report.assert('fixture has session links', counts.hosts > 0, `hosts=${counts.hosts}`);
    report.assert('every session time has one badge', counts.badges === counts.hosts, `badges=${counts.badges} hosts=${counts.hosts}`);
    report.assert('every badge host knows its session id', counts.withId === counts.hosts, `withId=${counts.withId}`);
  }

  async function testVisibleBadges() {
    report.section('Badges: visible times show the room occupancy');

    await page.evaluate(() => {
      document.querySelector('[data-isp-occ]')?.parentElement.scrollIntoView({ block: 'center' });
    });
    await waitForSettledInViewport();

    const badges = await readBadges(page);
    const visible = badges.filter(b => b.inViewport);
    assertBadgesMatchFixture(visible, 'in viewport');

    const ready = visible.find(b => b.state === 'ready');
    report.assert('a ready badge is in view', !!ready);
    if (ready) {
      report.assert('bar width follows the percentage', ready.fill === ready.text, `fill=${ready.fill} text=${ready.text}`);
      report.assert('title explains the occupancy', /^Sala \d+% ocupada \(\d+ de \d+ lugares\)$/.test(ready.title), ready.title);
    }

    const unavailable = badges.find(b => b.state === 'unavailable');
    if (unavailable) {
      report.assert('unavailable badge has an explanatory title', unavailable.title === 'Ocupação da sala indisponível', unavailable.title);
    }
  }

  async function testLazyLoading() {
    report.section('Badges: seat maps are only fetched for times near the viewport');

    const far = await page.evaluate(() => {
      const margin = 200 + 50;
      return Array.from(document.querySelectorAll('[data-isp-occ]')).filter((badge) => {
        const rect = badge.parentElement.getBoundingClientRect();
        return rect.top > window.innerHeight + margin || rect.bottom < -margin;
      }).map(b => b.dataset.state);
    });
    if (far.length === 0) {
      report.assert('fixture has off-screen session times', false, 'all times fit in the viewport');
      return;
    }
    report.assert('off-screen times stay loading', far.every(s => s === 'loading'), far.join(','));

    await page.evaluate(() => {
      const badges = document.querySelectorAll('[data-isp-occ]');
      badges[badges.length - 1].parentElement.scrollIntoView({ block: 'center' });
    });
    await waitForSettledInViewport();
    assertBadgesMatchFixture((await readBadges(page)).filter(b => b.inViewport), 'after scrolling');
  }

  async function testRerender() {
    report.section('Badges: re-rendered session list is picked up');

    await page.evaluate((id) => {
      const host = document.querySelector('[data-isp-occ]').parentElement;
      const link = host.matches('a') ? host : host.querySelector('a[href*="sessionId="]');
      const clone = link.cloneNode(true);
      clone.querySelectorAll('[data-isp-occ]').forEach(n => n.remove());
      clone.classList.remove('isp-occ-host');
      delete clone.dataset.ispSessionId;
      delete clone.dataset.ispOccWatched;
      clone.removeAttribute('title');
      clone.href = clone.href.replace(/sessionId=\d+/, `sessionId=${id}`);
      clone.id = 'isp-test-new-session';
      document.body.prepend(clone);
      window.scrollTo(0, 0);
    }, NEW_SESSION_ID);

    await page.waitForFunction(
      () => document.querySelector('#isp-test-new-session > [data-isp-occ]')?.dataset.state === 'ready',
      undefined,
      { timeout: 15000 },
    );
    const badge = (await readBadges(page)).find(b => b.sessionId === NEW_SESSION_ID);
    const exp = expectedBadge(NEW_SESSION_ID);
    report.assert('new session time gets its own badge', !!badge);
    report.assert('new session shows its occupancy', badge?.text === exp.text && badge?.level === exp.level, `${badge?.text}/${badge?.level}`);
  }

  await waitForContentScript(page);

  await testBadgesAttached();
  await testVisibleBadges();
  await testLazyLoading();
  await testRerender();

  return report.summary();
}
