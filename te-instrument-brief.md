# Task: instrument every RFC 8693 token-exchange path for New Relic

## Why

A Token Exchange dashboard is planned, but 30 days of New Relic history hold
**zero** token-exchange events. The cause: `demo_api_server/services/oauthService.js`
has **six** exchange variants and only one emits telemetry.

| Line | Method | Emits today |
|---|---|---|
| 300 | `performTokenExchange` | request + success only — **nothing on failure** |
| 370 | `performTokenExchangeFromIdToken` | nothing |
| 425 | `performTokenExchangeWithActor` | nothing |
| 478 | `performTokenExchangeWithActorIdToken` | nothing |
| 841 | `performTokenExchangeAs` | nothing — the nested-`act` path used by A2A delegation and the attack sims |
| 892 | `performTokenExchangeWithDedicatedApp` | nothing (private_key_jwt path; falls back to 300/425 when the dedicated app is disabled) |

Because only the success path of one variant is instrumented, a dashboard built
on today's data would show a 100% success rate by construction. Failures must
emit too, or the page lies.

## Scope

One file: `demo_api_server/services/oauthService.js`. Plus tests.

## What to build

### A shared emit helper

Six variants × three emit points is eighteen copy-pasted blocks and eighteen
chances to drift. Write one private helper in this file and call it from every
variant. Do not export it unless a test genuinely needs the seam — if it does,
export it with a leading underscore, the convention already used for
`_mapDecisionFields` in `pingOneAuthorizeService.js`.

### Event vocabulary

Three tags, in the `prefix/outcome` shape already used by the authorize events
(`authorize/permit`, `authorize/deny`, `authorize/fail-open`):

| Tag | When |
|---|---|
| `token-exchange/request` | before the POST |
| `token-exchange/ok` | exchange returned an access token |
| `token-exchange/fail` | exchange threw |

Category stays `token_exchange` for all of them.

**Continuity note:** the existing success event at line 332 uses the flat tag
`token-exchange`. Records already in New Relic carry that tag. Moving to
`token-exchange/ok` is intended — but say so in your report so the dashboard
work knows historical rows use the old tag.

### Metadata

`metadata` spreads flat into New Relic attributes
(`newRelicForwarder.js:100`), so these keys become the facets a dashboard
queries. Emit the same key set from every variant — a facet that only exists on
some variants is worse than no facet.

| Key | Value |
|---|---|
| `exchangeVariant` | stable slug per method: `subject`, `subject+actor`, `id-token`, `id-token+actor`, `exchange-as`, `dedicated-app` |
| `audience` | as passed; if it is an array (RFC 8707 multi-resource), join it — do not emit a raw array |
| `scope` | the joined scope string |
| `exchangeClientId` | the client that performed the exchange. This differs per variant and is the whole point of the 2-exchange chain, so get it right: `this.config.clientId` for most, the `clientId` **parameter** for `performTokenExchangeAs`, and `exchangerClientId` for the dedicated-app path |
| `hasActorToken` | boolean — whether an actor token was actually sent, i.e. whether a nested `act` claim was requested. For variants that take an optional actor token, this must reflect the runtime value, not the method's name |
| `subjectTokenType` | `access_token` or `id_token` |
| `latencyMs` | wall-clock around the POST. On the `ok` and `fail` events only |
| `httpStatus` | `fail` events only |
| `pingoneError` | `fail` events only — `error` / `error_description` from PingOne |

### Security — the hard constraint

Token exchange is a protected area under `REGRESSION_PLAN.md` §1.

**Never** put a token value or a secret into an event message or into
`metadata`. That means `subjectToken`, `actorToken`, `idToken`, the issued
`access_token`, and — specifically in `performTokenExchangeAs`, which receives
it as a parameter — `clientSecret`. Emit the boolean `hasActorToken`, never the
actor token itself. `appEventService.logEvent` runs `redactObject` over
metadata, but treat that as a backstop, not as your safety net: do not pass a
secret in and rely on redaction to catch it.

**The emit must never change control flow.** In particular, a `logEvent` call
inside a `catch` block that throws would mask the real PingOne error and turn a
diagnosable 400 into a confusing crash. Guard against that.

## What must not break

State these in your report as verified, not assumed:

- Every variant returns exactly what it returned before, and throws the same
  enriched error object with the same properties (`httpStatus`, `pingoneError`,
  `pingoneErrorDescription`, `pingoneErrorDetail`, `requestContext`).
- The existing `nrSegments.tokenExchangeSubject` / `tokenExchangeActor` wrappers
  at lines 327 and 444 still wrap the POST.
- `performTokenExchangeWithDedicatedApp`'s fallback still delegates to
  `performTokenExchangeWithActor` / `performTokenExchange` when the dedicated
  exchanger is disabled — and does **not** double-emit as a result. Decide
  deliberately whether the fallback path emits as `dedicated-app` or as the
  variant it delegates to, and say which you chose and why.

## Tests

`demo_api_server/tests/` (not `__tests__/`, which is legacy).

- Each of the six variants emits `request` then `ok` on success, and `request`
  then `fail` on error.
- The failure event carries `httpStatus` and `pingoneError`, and the original
  enriched error still propagates unchanged.
- **A token value never appears in any emitted event.** Assert this directly:
  drive an exchange with recognizable sentinel token strings and assert no
  emitted event — message or metadata, at any depth — contains them. This is the
  most important test in the task.
- `hasActorToken` is false when `performTokenExchangeAs` is called without an
  actor token and true when called with one.
- `exchangeClientId` is the parameter client for `performTokenExchangeAs`, not
  `this.config.clientId`.
- A throwing `logEvent` does not mask the PingOne error.

## Global constraints

- CommonJS (`require`, not `import`). Node >= 22.
- Error responses use `{ error }`.
- Stage explicitly with `git add <files>`. **Never `git add -A`** — a BFF jest
  run regenerates hundreds of files under `data/step-verification/`.
- Emoji allowlist: only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`.
- No new npm dependencies.

## Verify

```
cd demo_api_server && CI=true npx jest tests/<your-new-spec>.js
cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4
```

`--maxWorkers=4` matters: under parallel load this suite flakes with a
*different* disjoint set of suites failing each run. Re-run any failure in
isolation before calling it a regression — and do not add
`--testPathIgnorePatterns`, which replaces rather than appends to the ignore
list and drags the live-stack `/tests/real/` suites in.

Expect roughly two rotating live-integration failures in the full run that are
pre-existing. Report which failed and whether they fail on a clean checkout too.
