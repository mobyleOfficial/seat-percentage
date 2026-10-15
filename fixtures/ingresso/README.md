# Ingresso test fixtures

Static snapshot used by the integration tests (`npm test`) so they do not depend on live ingresso.com HTML.

| File | Description |
|------|-------------|
| `movie-page.html` | Saved movie page DOM (session times with checkout links carrying `sessionId=`) |

Seat maps are not stored: the session ids in the snapshot expire, so
`scripts/lib/seat-fixtures.mjs` synthesizes the sessions API responses from
each id (`id % 5` picks low / medium / high occupancy, a session that already
started (the API answers 404), or a
session without seat selection). Tests compare each badge with that mapping.

## Refresh fixtures

When Ingresso changes page structure and tests stop finding session times:

```bash
npm run test:dump-fixture
```

Commit the updated file along with any selector fixes in `inpage.js`.
