# Task: Token Exchange dashboard at `/monitoring/token-exchange`

Third dashboard on the New Relic view registry, after `pipeline`
(`/monitoring/new-relic`) and `authorize` (`/monitoring/p1az`). Read
`routes/newRelicQuery.js` and `P1AzDashboard.jsx` first — they are the pattern,
and this page composes the same `DashboardShell` / `StatStrip` / `EventStream`.

## Ground truth — measured live on 2026-08-10, not assumed

Telemetry landed yesterday (PR #1523). Every RFC 8693 exchange path now emits
`token-exchange/request`, then `token-exchange/ok` or `token-exchange/fail`.
Real traffic has already flowed. Design against these numbers:

| Facet | Live values (30d) |
|---|---|
| `tag` | `token-exchange/request` 8, `token-exchange/ok` 7, `token-exchange/fail` 1 |
| `exchangeVariant` | `exchange-as` 14, `subject` 2 |
| `audience` | `agentgateway.ping.demo` 6, `https://api.ping.demo:3036/mcp` 6, `mcpgateway.ping.demo` 2, `https://mcpserver.ping.demo` 2 |
| `exchangeClientId` | three distinct ids: `f4dd707d…` 8, `71e878ea…` 6, `8a711944…` 2 |
| `hasActorToken` | `true` 12, `false` 4 |
| `subjectTokenType` | `access_token` 16 — no `id_token` traffic yet |
| `latencyMs` (on ok) | avg 122, min 105, max 165 |
| `scope` | `agent:invoke read` 6, `gateway:mcp:invoke` 6, `read` 4 |

Two facts that will bite you if you skip them:

**1. Do NOT filter on `category='token_exchange'`.** That category also holds
`token_chain/fetched` (53 rows) and `oauth/user/callback` (24 rows) — unrelated
events. Filtering by category alone means 77 of 93 rows are noise. **Filter on
`tag LIKE 'token-exchange/%'`.** A previous dashboard in this series shipped
with exactly this class of contamination and had to be corrected.

**2. There is no old-tag history to be compatible with.** An earlier note in
this project claimed historical rows carry a flat `token-exchange` tag and that
queries need to span both. That was checked live and is **wrong** — `FACET
exchangeVariant WHERE tag='token-exchange'` returns zero rows. Do not add
dual-tag compatibility logic for data that does not exist.

**Depth of history:** the account's earliest `app_event` is 2026-08-06T22:53Z
and counts are identical at 7d / 14d / 30d — nothing is aging out, but there is
under four days of data, and exchange events only start from yesterday. The
`14d` window is correct to offer and will look partial. Say so in the empty
state rather than implying breakage.

## BFF — add the `tokenexchange` view

Add to the `VIEWS` registry in `demo_api_server/routes/newRelicQuery.js`,
following `_authorizeQuery`'s shape exactly. Five queries:

| Key | Purpose | Shape |
|---|---|---|
| `outcomes` | ok vs fail | `FACET tag` over the outcome tags only (exclude `/request` — it would double-count) |
| `attempts` | attempted vs settled | `count(*)` of `token-exchange/request`. The page derives **unsettled = attempts − (ok + fail)**; a non-zero value means exchanges started and never resolved |
| `delegation` | is nested `act` actually exercised | `FACET hasActorToken` |
| `variants` | which of the six code paths are in use | `FACET exchangeVariant` |
| `timeseries` | volume | `TIMESERIES ${bucket}` over outcome tags |
| `stream` | recent exchanges | `SELECT timestamp, tag, exchangeVariant, audience, scope, exchangeClientId, hasActorToken, subjectTokenType, latencyMs, httpStatus, pingoneError … LIMIT 50` |

That is six — `attempts` is a scalar count, the rest are facets. Keep them all.

**Search fields.** `_likeClause` takes the columns the stream table actually
renders, so a match is explainable from a visible cell. Use
`exchangeVariant`, `audience`, `scope`, `exchangeClientId`, `pingoneError`.
Do not search `message` — this table will not display it.

**Security, unchanged and non-negotiable:** the client sends a view key and a
window key, never NRQL. The search term is escaped and metacharacter-stripped
by the existing helpers. Do not introduce a new path where caller input reaches
query text un-escaped.

## UI — `TokenExchangeDashboard.jsx`

Route `/monitoring/token-exchange`, public, nav entry under Monitoring beside
New Relic and PingOne Events. Wiring points: `App.js:529` (route),
`AdminSideNav.jsx:876` (nav), and `routes/__tests__/NewRelicRoute.test.jsx`
has the existing route-test pattern.

`DEFAULT_WINDOW = '24h'` — exchange traffic is sparse and a `1h` default would
show an empty page most of the time. This matches the P1AZ page's reasoning.

Layout in reading order:

1. **Outcome strip** — ok / fail, plus **unsettled** when non-zero. Unsettled is
   the operator signal (an exchange that started and never returned), so render
   it in the warning treatment the P1AZ posture row uses for fail-open, not as
   a neutral stat.
2. **Delegation** — how many exchanges requested a nested `act` claim vs not.
   This is the RFC 8693 story and the most demo-relevant panel: it shows
   delegation is real, not decorative.
3. **The chain** — `audience` and `exchangeClientId` breakdowns. Three client
   IDs exchanging for four audiences is the two-exchange A2A chain made
   visible, which is the strongest thing on this page.
4. **Latency** — average and max over `ok`.
5. **Volume** — inline SVG timeseries, same treatment as the other two pages.
6. **Exchange stream** — time, variant, outcome, audience, scope, client,
   nested-act, latency, and on failures the status and PingOne error.

Client IDs are UUIDs and will overflow a table cell. Truncate for display but
keep the full value available (`title` attribute or equivalent) — do not
silently show a prefix that could collide.

## What must not break

- The `pipeline` and `authorize` views behave exactly as today. Adding a third
  registry entry must not alter the other two's queries, cache behavior, or
  payload shape.
- The cache key already spans view × window × search; a third view must slot in
  without collision.
- `Object.hasOwn` view lookup, `Number(accountId)` coercion, and the
  `JSON.stringify` literal embedding stay exactly as they are.

## Tests

- BFF: the new view maps to its query set; unknown view still 400s; the
  `tag LIKE 'token-exchange/%'` filter is present on **every** sub-query (assert
  on generated query text — this is the contamination guard); search applies to
  the stream only and to the specified fields; `pipeline` and `authorize`
  queries are unchanged.
- UI: the five states (loading / ready / unconfigured / error / empty); the
  unsettled stat appears only when non-zero; the empty state distinguishes
  "no exchanges in this window" from "no matches for this search".
- Use `fireEvent` for interactions, never raw `.click()` — raw clicks emit
  React `act()` warnings and this series has had to fix that repeatedly.

## Global constraints

- `demo_api_server` is CommonJS. `demo_api_ui` is React 19.2 + Vite 8 +
  **vitest** (`vi.*`, never `jest.*`).
- UI HTTP through `apiClient`, never bare `axios`. Error responses `{ error }`.
- No new npm dependencies.
- Emoji allowlist: only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`.
- CSS must paint its own `--*-ground` in both themes keyed to
  `:root[data-theme="dark"]`, never `prefers-color-scheme`. Monospace in a CSS
  file must be allowlisted in `src/__tests__/uiRegression.test.js` — this exact
  guard has been tripped twice in this series.
- Stage explicitly with `git add <files>`. **Never `git add -A`** — a BFF jest
  run regenerates hundreds of files under `data/step-verification/`.

## Verify

```
cd demo_api_server && CI=true npx jest tests/newRelicQuery.test.js
cd demo_api_ui && npx vitest run src/components/__tests__ src/components/dashboard/__tests__ src/routes/__tests__ src/__tests__/uiRegression.test.js
cd demo_api_ui && npm run build
```

Then query the live account (`NR_USER_API_KEY` / `NR_ACCOUNT_ID` in
`demo_api_server/.env`; other scripts in the repo call NerdGraph the same way)
and confirm each panel's query returns the numbers in the table above. Report
the actual row counts you got, not "matches expected".
