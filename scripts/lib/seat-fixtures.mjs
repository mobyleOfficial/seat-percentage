/**
 * Deterministic mocks for the Ingresso sessions API
 * (`/v1/sessions/{id}` and `/v1/sessions/{id}/sections/{sectionId}/seats`).
 *
 * The movie-page fixture references real session ids that expire, so seat maps
 * are synthesized from the id: `id % 5` picks one scenario below. Only the
 * fields the extension reads are included.
 */

const SEATS_PER_SECTION = 20;

/** Scenario per `id % 5`. `sections` lists how many seats are Occupied in each. */
export const SEAT_SCENARIOS = {
  0: { kind: 'started' }, // the API answers 404 once a session has started
  1: { kind: 'ok', sections: [2], percent: 10, level: 'low' },
  2: { kind: 'ok', sections: [11], percent: 55, level: 'medium' },
  3: { kind: 'ok', sections: [18, 18], percent: 90, level: 'high' },
  4: { kind: 'no-seat-selection' },
};

export function seatScenario(sessionId) {
  return SEAT_SCENARIOS[Number(BigInt(sessionId) % 5n)];
}

/** Expected badge for a session id: { state, text, level? }. */
export function expectedBadge(sessionId) {
  const s = seatScenario(sessionId);
  if (s.kind !== 'ok') return { state: 'unavailable', text: '–' };
  return { state: 'ready', text: `${s.percent}%`, level: s.level };
}

function seatMap(occupied) {
  // Two PhysicalDistance seats per section: they must not count toward capacity.
  const statuses = [
    ...Array(occupied).fill('Occupied'),
    ...Array(SEATS_PER_SECTION - occupied).fill('Available'),
    'PhysicalDistance',
    'PhysicalDistance',
  ];
  return {
    lines: [{ line: 'A', seats: statuses.map((status, i) => ({ id: `A${i + 1}`, status })) }],
  };
}

/**
 * Routes a sessions API path (`/v1/sessions/...`).
 * @returns {{ status: number, body: string }}
 */
export function handleSessionsApi(pathname) {
  const m = pathname.match(/\/v1\/sessions\/(\d+)(?:\/sections\/([^/]+)\/seats)?\/?$/);
  if (!m) return { status: 404, body: '{}' };

  const [, sessionId, sectionId] = m;
  const scenario = seatScenario(sessionId);
  if (scenario.kind === 'started') return { status: 404, body: '' };

  if (!sectionId) {
    const sections = scenario.kind === 'ok'
      ? scenario.sections.map((_, i) => ({ id: `section-${i + 1}`, hasSeatSelection: true }))
      : [];
    return {
      status: 200,
      body: JSON.stringify({ id: sessionId, hasSeatSelection: scenario.kind === 'ok', sections }),
    };
  }

  const index = Number(String(sectionId).replace('section-', '')) - 1;
  const occupied = scenario.sections?.[index];
  if (occupied == null) return { status: 404, body: '{}' };
  return { status: 200, body: JSON.stringify(seatMap(occupied)) };
}
