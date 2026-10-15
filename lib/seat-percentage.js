/**
 * Pure helpers: Ingresso seat maps → room occupancy.
 * Loaded as a classic script in the extension (globalThis.IspSeatPercentage)
 * and required from Node unit tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.IspSeatPercentage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Seats that can be sold. Anything else (e.g. PhysicalDistance, which blocks
  // seats next to wheelchair spaces) is left out of the room's capacity.
  const FREE_STATUSES = ['Available'];
  const TAKEN_STATUSES = ['Occupied'];

  function extractSessionId(href) {
    const m = String(href || '').match(/[?&]sessionId=(\d+)/);
    return m ? m[1] : null;
  }

  // Collects every distinct session id referenced by a value (React props),
  // via `sessionId=` in strings such as a session's siteURL. Walks plain
  // objects and arrays only, with a depth bound, so DOM nodes, fibers and
  // cycles are never followed.
  function collectSessionIds(value, maxDepth = 4) {
    const ids = new Set();
    const seen = new Set();

    function walk(v, depth) {
      if (typeof v === 'string') {
        for (const m of v.matchAll(/[?&]sessionId=(\d+)/g)) ids.add(m[1]);
        return;
      }
      if (!v || typeof v !== 'object' || depth > maxDepth || seen.has(v)) return;
      const proto = Object.getPrototypeOf(v);
      if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return;
      seen.add(v);
      for (const key of Object.keys(v)) {
        if (key === 'children' || key.startsWith('_')) continue;
        walk(v[key], depth + 1);
      }
    }

    walk(value, 0);
    return [...ids];
  }

  function countSeats(seatMap) {
    let free = 0, taken = 0;
    for (const line of seatMap?.lines || []) {
      for (const seat of line?.seats || []) {
        if (FREE_STATUSES.includes(seat.status)) free += 1;
        else if (TAKEN_STATUSES.includes(seat.status)) taken += 1;
      }
    }
    return { free, taken };
  }

  // Combines every section of a session (a room can be split into sections).
  // Returns null when there is nothing to measure.
  function summarizeSeatMaps(seatMaps) {
    let free = 0, taken = 0;
    for (const map of seatMaps || []) {
      const c = countSeats(map);
      free += c.free;
      taken += c.taken;
    }
    const capacity = free + taken;
    if (capacity === 0) return null;
    return { taken, capacity, percent: Math.round((taken / capacity) * 100) };
  }

  function occupancyLevel(percent) {
    if (percent >= 80) return 'high';
    if (percent >= 50) return 'medium';
    return 'low';
  }

  return {
    extractSessionId,
    collectSessionIds,
    countSeats,
    summarizeSeatMaps,
    occupancyLevel
  };
});
