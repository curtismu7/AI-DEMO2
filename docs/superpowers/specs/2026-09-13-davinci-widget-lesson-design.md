# DaVinci Widget developer lesson — design

Date: 2026-09-13 · Page: `/davinci-login-guide` · Status: approved in chat, pending spec review

## Goal

Turn `/davinci-login-guide` into a lesson a developer can build from: every API call the
DaVinci widget makes, how the app is wired to PingOne and DaVinci (and which "login
policy" actually runs), how the flow's final node hands back tokens, how the BFF turns
them into a session, and what `pi.flow` is — including why the widget never uses it.

It must look and read like the Orchestration SDK lesson on `/davinci-sdk-login` (owned by
session ai-demo2-35), so a developer moving between them sees one format.

## Decisions (user-approved 2026-09-13)

| Decision | Choice |
|---|---|
| pi.flow on this page | Teach the widget; explain pi.flow as the contrast (the widget never calls `/as/authorize`) and link to `/davinci-sdk-login`, which proves pi.flow on the wire |
| Lesson design | Twelve sections: the ten shared ones plus two lesson-specific ones, in the shared order below |
| After sign-in | Stay on the page and open a "What just happened" `DraggableModal` with the run's trace — replaces the navigation to `/davinci-login/confirmed` |
| Sequencing | #3245 merges and deploys first; the page is built on ai-demo2-35's shared `components/lesson/` module once it lands — no duplicate components |

## Coordination contract with ai-demo2-35

- ai-demo2-35 owns `demo_api_ui/src/components/lesson/` (new files only), imported as
  `import { LessonLayout, Section, CodeBlock, TableBlock, MermaidFigure, OnThisRun, Status, Lede, LessonFoot } from '../components/lesson'`
  (its `index.js` imports `lesson.css`):
  - `LessonLayout({ title, subtitle, sections: [{ id, label }], storageKey, children })` — header, resizable section nav (`useDividerDrag`), scrolling content; nav click scrolls to `#id`.
  - `Section({ id, title, children })` — `<section id>` with an `h2`.
  - `CodeBlock({ title, code, language })` — title bar with Copy (`navigator.clipboard`, "Copied" for 1.5s); `code` is a string.
  - `TableBlock({ headers: string[], rows: ReactNode[][] })`.
  - `MermaidFigure({ source, label })` — `useMermaidRender`, strict; shows parse errors; `label` is the aria-label.
  - `OnThisRun({ title = 'On this run', children })` — the info box.
  - `Status({ ok, children })` — inline ✓ / ⚠️ status on `--th-*` tokens.
  - `Lede({ children })` — intro paragraph; `LessonFoot({ children })` — links footer.
  - Lists are plain `<ul className="lesson-list">`.
  All `lesson-*` classes, `--th-*` colours, font scale, radius tokens. The same primitives
  are used inside the modal body; the `DraggableModal` body must be wrapped in
  `<div className="dm-scroll">` (dmScrollContract).
- Shared section ids (kebab-case), in order: `try-it-live`, `overview`, `how-its-wired`,
  `pi-flow`, `how-it-works`, `api-calls`, `the-flow`, [lesson-specific], `security`,
  `troubleshooting`, `in-this-repo`. This lesson's two extras, between `the-flow` and
  `security`: `the-final-node`, `tokens-to-session`.
- Both lessons' post-sign-in modals are a short run summary (On this run plus the steps
  just taken, linking into the page sections); the teaching content lives in the sections.
- This work owns `DavinciLoginGuidePage.jsx/.css`, `DavinciLoginWidget.jsx`,
  `lib/davinciWidgetClient.js`, and the new widget files below. Neither side edits the
  other's files.

## Facts the lesson teaches (all measured 2026-09-13)

Every claim in the page must trace to one of these, to the DaVinci widget docs
(`docs.pingidentity.com/davinci/integrating_flows_into_applications/davinci_launching_a_flow_with_the_widget`),
the PingOne Authentication connector docs, or this repo's code. Nothing from memory.

### Wiring — PingOne and DaVinci setup

| Setting | Where | Why it matters |
|---|---|---|
| DaVinci application "AI Demo" (`6502b512…`) and its API key | DaVinci › Applications › General | The BFF mints the widget's SDK token with it (`X-SK-API-KEY`). The key is a vault secret and never reaches the browser |
| Flow policy `a759d4c3` "AI DEMO" → flow `81d28621…`, version latest | DaVinci › Applications › Flow Policy | Selected by `policyId` in the SDK-token request. A widget policy: **no trigger** — not a PingOne flow policy, so no PingOne application assignment is involved |
| Flow Input Schema: `nonce`, `username` | Flow › Input Schema | Values passed in the SDK-token request's `parameters` become `{{global.parameters.*}}` inside the flow |
| PingOne SSO connection (`94141bf2…`, worker client id/secret, env, region) | DaVinci › Connections | The flow's Sign On nodes (user lookup, check password) call PingOne's directory through it |
| PingOne Authentication connection (`c3e6a164…`) | DaVinci › Connections | Its "Return Success Response (Widget Flows)" node creates the PingOne session and returns OIDC tokens to the widget |
| That node's settings: app `8a711944…`, scopes `openid profile email read write ai:agent:read`, idTokenClaims `nonce` = `{{global.parameters.nonce}}` | Flow › final node | The app the tokens are issued to; the scopes decide the access token's audience; the nonce claim is what the BFF's replay check reads |
| OIDC app "Demo AI App - Admin Login" (`8a711944…`) resource grant | PingOne › Applications › Resources | Grants the Demo API scopes, so the access token's `aud` is `enduser.ping.demo` |
| CORS allowed origins | PingOne › Applications › Configuration | The widget calls `auth.pingone.com` from this origin with credentials. Ping's docs put the origin on the PingOne DaVinci Connection app or any app in the environment; here `8a711944…` and `4e122cbf…` list it |
| BFF config | `.env` / vault | `PINGONE_DAVINCI_LOGIN_COMPANY_ID`, `PINGONE_DAVINCI_LOGIN_POLICY_ID_V1`, `PINGONE_DAVINCI_API_KEY` (vault) |

"Which login policy?" — none from PingOne. The DaVinci flow is the login policy: the widget
runs flow policy `a759d4c3` directly. Contrast: the SDK page's PingOne app has a
`flowPolicyAssignment` to a PingOne flow policy (trigger `AUTHENTICATION`), which is what
makes `/as/authorize` run a flow.

### The wire (fresh browser, captured; values elided)

1. `POST /api/davinci-login/sdk-token` (page → BFF) → `{ accessToken, companyId, policyId, flowVersion, apiRoot }`. `accessToken` is the DaVinci SDK token (a JWT), not a PingOne access token.
2. BFF → `POST https://orchestrate-api.pingone.com/v1/company/{companyId}/sdktoken`, header `X-SK-API-KEY`, body `{ policyId, parameters: { nonce } }` (plus `username` when the caller supplies one).
3. Widget → `POST https://auth.pingone.com/{envId}/davinci/policy/{policyId}/start`, header `Authorization: Bearer <SDK token>`, no body (the parameters ride inside the SDK token). Response 200 JSON: `interactionId`, `flowId`, `connectionId`, `capabilityName: customHTMLTemplate`, `screen`; `Set-Cookie: interactionId`.
4. Each screen submit → `POST https://auth.pingone.com/{envId}/davinci/connections/{connectionId}/capabilities/customHTMLTemplate`, headers `interactionid`, `interactiontoken`, body `{ id, eventName: "continue", interactionId, nextEvent: { eventName: "continue", eventType: "post" }, parameters: { buttonType, buttonValue, …form fields } }`. Response: the next screen.
5. After Create Session: response also sets `ST` and `ST-NO-SS` on `auth.pingone.com`.
6. Final submit → response from `capabilityName: returnSuccessResponseWidget`, `connectorId: pingOneAuthenticationConnector`: `{ success: true, access_token, token_type: "Bearer", expires_in: 3600, scope, id_token, sessionToken, sessionTokenMaxAge }`.
7. Page → `POST /api/davinci-login/widget-session { idToken, accessToken }` → `{ ok: true, username }` + session cookie.

The browser never requests `/as/authorize`, so `response_mode` never appears.

### pi.flow

`response_mode=pi.flow` is a parameter of PingOne's `GET /as/authorize`: PingOne answers
200 with JSON describing the current step instead of a 302 to hosted pages, and delivers
the authorization code inside the final JSON. The Orchestration SDK sets it itself. The
widget uses DaVinci's own start/continue API (steps 3–6), authenticated by the SDK token,
so there is no authorize request to carry it. Both render the flow in your page; they
differ in who draws the screens (widget: DaVinci's HTML; SDK: your UI from collectors)
and in what comes back (widget: whatever the final node returns — here OIDC tokens; SDK:
an authorization code).

### Why the old `/authorize` hop failed

The flow used to end with an HTTP success response (no PingOne session, no session token),
and even with a session, `ST` set during the widget's cross-site calls never reached a
top-level `/as/authorize` (Set-Cookie arrived, not reported blocked, absent from the jar).
REGRESSION_PLAN §4 2026-09-13.

## Page structure

`DavinciLoginGuidePage` on `LessonLayout`, twelve `Section`s in this order:

1. **Try It Live** (`try-it-live`) — mirrors the SDK page's layout: a two-column grid with the widget in a sticky card on the left and a live **Call Inspector** on the right, fed by the same `davinciWidgetTrace` records as the modal (method, path, status, `capabilityName`) as each call happens. Grid CSS is page-level in `DavinciLoginGuidePage.css`, as the SDK page keeps `.dvsdk-live*` in its own stylesheet. After sign-in, the "What just happened" modal.
2. **Overview** (`overview`) — what the widget is (Ping-hosted `davinci.js`, DaVinci's own screens in your container); table: redirect vs widget vs Orchestration SDK (who draws screens, what comes back, when to choose).
3. **How It's Wired — PingOne & DaVinci setup** (`how-its-wired`) — the wiring table above + the login-policy answer.
4. **pi.flow** (`pi-flow`) — definition, why the widget doesn't use it, comparison, link to `/davinci-sdk-login`.
5. **How It Works** (`how-it-works`) — numbered steps 1–7.
6. **API Calls — on the wire** (`api-calls`) — one `CodeBlock` per call (request + abridged response), values elided.
7. **The Flow** (`the-flow`) — `MermaidFigure` sequence matching the wire.
8. **The flow's final node** (`the-final-node`) — HTTP success vs PingOne Authentication widget success, the node's settings, why the hop failed.
9. **Tokens to session** (`tokens-to-session`) — `/widget-session` checks with the real code, and the no-refresh-token limit.
10. **Security** (`security`).
11. **Troubleshooting** (`troubleshooting`) — CORS origin, `431` → `originCookies`, wrong policy type, each 401 from `/widget-session`.
12. **In This Repo** (`in-this-repo`).

Copyable snippets: minimal integration (script tag, config fetch, `skRenderScreen` props
incl. `includeHttpCredentials`, `successCallback` posting tokens) and the BFF SDK-token mint.

## "What just happened" modal and the run trace

- `lib/davinciWidgetTrace.js` — installed before the page fetches its widget config (so
  `/sdk-token` and `/start` are captured) and removed when the run ends. Wraps
  `window.fetch` only: every flow call davinci.js made on the captured run was resource
  type `fetch`, so an `XMLHttpRequest` wrapper would be dead code. Records, per call to a
  `/davinci/`, `/as/` or `/api/davinci-login/` path: method, host, path, status, and from
  JSON responses only `capabilityName`, `connectorId`, `success`. A fetch wrapper cannot
  see a page navigation, so no-redirect is shown as a structural fact (the summary is
  open on the same page), not read from the trace. Paths carry public configuration ids
  (environment, policy, connection) — the same level the SDK lesson shows. Never recorded:
  request or response bodies, `interactionId`, `interactiontoken`, tokens, nonce, form
  values, cookies. Never alters requests or responses (JSON is read from a clone).
  Exports `summarizeWidgetTrace(trace)` for tests.
- `components/davinci/WidgetRunSummary.jsx` — modal body, a short run summary matching the
  SDK page's: `Lede` ("signed in as X, still on this page"), `OnThisRun` (calls in order,
  final `capabilityName`, a `Status` for whether the final node returned tokens, and a
  `Status` that the page never left — it signed in without an `/authorize` redirect),
  then the steps just taken, each linking to its page
  section (`api-calls`, `the-final-node`, `tokens-to-session`, `pi-flow`) through an
  `onNavigate(id)` prop — as `SdkWalkthrough` does — so a link closes the modal and scrolls
  to that section. No teaching content of its own — that lives in the sections.
- `DavinciLoginWidget.jsx` — after `/widget-session` succeeds it stays on the page, reads
  the signed-in username from that response, and calls `onSignedIn({ username })`; the
  guide page opens the `DraggableModal`. No navigation to `/davinci-login/confirmed` (that
  route and page stay for `/callback`).
- `routes/davinciLogin.js` — the one server change: `establishSession` answers
  `{ ok: true, username: user.username || null }`, as `routes/davinciSdkLogin.js` already
  does. Amended 2026-09-13 (SDD ledger Ruling R5): `GET /api/auth/me` returned
  `user.username = null` after a live widget sign-in, because it looks the user up by the
  token's PingOne `sub` while `/widget-session` resolves the user by username.

## Out of scope

`components/lesson/` (ai-demo2-35), `SdkWalkthrough.jsx`, `/davinci-sdk-login`,
`/sdk-login`, server routes other than the one-line `/widget-session` response change above,
the DaVinci flow.

## Testing and verification

- vitest: `davinciWidgetTrace` (records only the allowed fields, installs before and
  restores after the run, passes responses through untouched), `WidgetRunSummary` (renders
  run facts, warns when a call was not captured), `DavinciLoginWidget` (stays on page,
  passes the `/widget-session` username to `onSignedIn`, no navigation), guide page renders
  all twelve section ids in order.
- jest: `/widget-session` and `/callback` success responses carry `username`.
- Gates for touched surfaces: `npm run test:unit`, `npm run build`, theming ratchets (new
  CSS), `dmScrollContract` (new modal), emoji allowlist.
- Live, fresh browser on `local.ping-devops.com:4000` with a stack-generation pin: Sign On
  → Welcome → Success → modal opens on `/davinci-login-guide` showing the user and the
  captured calls ending in `returnSuccessResponseWidget`; `/api/auth/me` 200; no
  `/as/authorize` request on the wire.

## Success criteria

A developer who has never used DaVinci can, from this page alone: name every PingOne and
DaVinci setting the widget needs and where it lives; reproduce the SDK-token mint and the
`skRenderScreen` call; read each wire call and say what it does; explain what `pi.flow` is
and why this integration does not use it; and explain how the tokens become a session and
what the BFF checks. Every claim traceable to a captured run, docs page, or code line.
