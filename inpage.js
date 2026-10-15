(function () {
  'use strict';

  if (window.__ispLoaded) return;
  window.__ispLoaded = true;

  if (!/^\/(filme|cinema)\//.test(location.pathname)) return;

  // ── Constants ──────────────────────────────────────────────────────────
  const SESSIONS_API = 'https://api.ingresso.com/v1/sessions';
  const OCCUPANCY_CONCURRENCY = 3;
  const OCCUPANCY_TTL = 3 * 60 * 1000;
  const REACT_FIBER_DEPTH = 12;

  const TIME_RE = /^\d{2}:\d{2}$/;

  const {
    extractSessionId,
    collectSessionIds,
    summarizeSeatMaps,
    occupancyLevel
  } = globalThis.IspSeatPercentage;

  // ── Seat occupancy above session times ────────────────────────────────

  const occupancyCache = new Map(); // sessionId → { at, summary, final?, error? } (summary may be null)
  const occupancyQueue = [];
  const occupancyQueued = new Set();
  let occupancyActive = 0;
  let occupancyObserver = null;

  function sessionLinkButton(link) {
    return link.closest('button') || link;
  }

  // True when the element shows a session time, ignoring our own badge.
  function hasTimeLabel(el) {
    return Array.from(el.childNodes).some(n =>
      n.nodeType === 3
        ? TIME_RE.test(n.textContent.trim())
        : n.nodeType === 1 && !n.matches('[data-isp-occ]') && hasTimeLabel(n)
    );
  }

  // Sessions that need a confirmation first (e.g. midnight ones) render as a
  // bare <button> with no checkout link, so the id is read from the props
  // React rendered it with. The first ancestor whose props mention exactly
  // one session wins; one that mentions several is a list, not this time.
  function reactSessionId(button) {
    const key = Object.keys(button).find(k => k.startsWith('__reactFiber$'));
    let fiber = key ? button[key] : null;
    for (let depth = 0; fiber && depth < REACT_FIBER_DEPTH; depth += 1, fiber = fiber.return) {
      const ids = collectSessionIds(fiber.memoizedProps);
      if (ids.length === 1) return ids[0];
      if (ids.length > 1) return null;
    }
    return null;
  }

  // Every enabled session time on the page: { host, sessionId }, where host is
  // the element the badge goes on.
  function findSessionTimes() {
    const times = new Map();

    for (const link of document.querySelectorAll('a[href*="sessionId="]')) {
      const host = sessionLinkButton(link);
      if (host.disabled || !TIME_RE.test(link.textContent.trim())) continue;
      const sessionId = extractSessionId(link.href);
      if (sessionId) times.set(host, sessionId);
    }

    for (const button of document.querySelectorAll('button')) {
      if (times.has(button) || button.disabled || !hasTimeLabel(button)) continue;
      const sessionId = reactSessionId(button);
      if (sessionId) times.set(button, sessionId);
    }

    return Array.from(times, ([host, sessionId]) => ({ host, sessionId }));
  }

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.json();
  }

  async function fetchSessionOccupancy(sessionId) {
    const session = await fetchJson(`${SESSIONS_API}/${sessionId}`);
    const sections = (session.sections || []).filter(s => s.hasSeatSelection !== false);
    if (!session.hasSeatSelection || sections.length === 0) return null;
    const maps = await Promise.all(sections.map(s =>
      fetchJson(`${SESSIONS_API}/${sessionId}/sections/${encodeURIComponent(s.id)}/seats`)
    ));
    return summarizeSeatMaps(maps);
  }

  // Every enabled time gets a badge right away, in a loading state, so the
  // row height is reserved before the seat map arrives.
  function ensureOccupancyBadge(button) {
    let badge = button.querySelector(':scope > [data-isp-occ]');
    if (!badge) {
      badge = document.createElement('span');
      badge.setAttribute('data-isp-occ', '1');
      badge.className = 'isp-occ';
      badge.dataset.state = 'loading';
      badge.innerHTML = '<span class="isp-occ-num"></span><span class="isp-occ-bar"><span class="isp-occ-fill"></span></span>' +
        '<span class="isp-occ-retry" role="button" tabindex="0" title="Tentar de novo" aria-label="Tentar carregar a ocupação de novo">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span>';
      bindRetry(badge.querySelector('.isp-occ-retry'), button);
      button.classList.add('isp-occ-host');
      button.appendChild(badge);
    }
    return badge;
  }

  // The badge sits inside the session's checkout link (or button), so the
  // retry control swallows its own click before the page reacts to it.
  function bindRetry(retry, host) {
    const run = e => {
      e.preventDefault();
      e.stopPropagation();
      const sessionId = host.dataset.ispSessionId;
      if (sessionId) retryOccupancy(sessionId);
    };
    retry.addEventListener('click', run);
    retry.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') run(e);
    });
  }

  function renderOccupancyBadges(sessionId) {
    const entry = occupancyCache.get(sessionId);
    if (!entry) return;

    for (const { host, sessionId: id } of findSessionTimes()) {
      if (id !== sessionId) continue;
      const badge = ensureOccupancyBadge(host);
      const num = badge.querySelector('.isp-occ-num');
      const fill = badge.querySelector('.isp-occ-fill');

      if (entry.error) {
        badge.dataset.state = 'error';
        num.textContent = '';
        fill.style.width = '0';
        host.title = 'Erro ao carregar a ocupação da sala';
        continue;
      }

      if (!entry.summary) {
        badge.dataset.state = 'unavailable';
        num.textContent = '–';
        fill.style.width = '0';
        host.title = 'Ocupação da sala indisponível';
        continue;
      }

      const { taken, capacity, percent } = entry.summary;
      badge.dataset.state = 'ready';
      badge.dataset.level = occupancyLevel(percent);
      num.textContent = `${percent}%`;
      fill.style.width = `${percent}%`;
      host.title = `Sala ${percent}% ocupada (${taken} de ${capacity} lugares)`;
    }
  }

  function pumpOccupancyQueue() {
    while (occupancyActive < OCCUPANCY_CONCURRENCY && occupancyQueue.length > 0) {
      const sessionId = occupancyQueue.shift();
      occupancyActive += 1;
      fetchSessionOccupancy(sessionId)
        .then(summary => { occupancyCache.set(sessionId, { at: Date.now(), summary }); })
        // The API answers 404 once a session has started (the page still lists
        // it), so that answer is final and the session is not asked for again.
        // Anything else is a failed load the user can retry.
        .catch(err => {
          const final = err.status === 404;
          occupancyCache.set(sessionId, { at: Date.now(), summary: null, final, error: !final });
        })
        .finally(() => {
          occupancyActive -= 1;
          occupancyQueued.delete(sessionId);
          renderOccupancyBadges(sessionId);
          pumpOccupancyQueue();
        });
    }
  }

  function requestOccupancy(sessionId) {
    const cached = occupancyCache.get(sessionId);
    if (cached && (cached.final || Date.now() - cached.at < OCCUPANCY_TTL)) {
      renderOccupancyBadges(sessionId);
      return;
    }
    if (occupancyQueued.has(sessionId)) return;
    occupancyQueued.add(sessionId);
    occupancyQueue.push(sessionId);
    pumpOccupancyQueue();
  }

  function retryOccupancy(sessionId) {
    occupancyCache.delete(sessionId);
    for (const { host, sessionId: id } of findSessionTimes()) {
      if (id !== sessionId) continue;
      ensureOccupancyBadge(host).dataset.state = 'loading';
      host.removeAttribute('title');
    }
    requestOccupancy(sessionId);
  }

  // Only fetch seat maps for times the user can actually see.
  // React may reuse a button for another session after a day change, so the
  // id is refreshed on every scan.
  function scanSessionTimes() {
    for (const { host, sessionId } of findSessionTimes()) {
      ensureOccupancyBadge(host);
      host.dataset.ispSessionId = sessionId;
      if (host.dataset.ispOccWatched) {
        if (occupancyCache.has(sessionId)) renderOccupancyBadges(sessionId);
        continue;
      }
      host.dataset.ispOccWatched = '1';
      occupancyObserver.observe(host);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────

  function init() {
    occupancyObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const sessionId = entry.target.dataset.ispSessionId;
        if (sessionId) requestOccupancy(sessionId);
      }
    }, { rootMargin: '200px 0px' });

    scanSessionTimes();

    // Session times render after the page loads and are re-rendered on day
    // changes; re-attach after React settles.
    let debounce = null;
    new MutationObserver(mutations => {
      const relevant = mutations.some(m =>
        [...m.addedNodes, ...m.removedNodes].some(n =>
          n.nodeType === 1 && !n.matches('[data-isp-occ]')
        )
      );
      if (!relevant) return;
      clearTimeout(debounce);
      debounce = setTimeout(scanSessionTimes, 400);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
