---
name: pingone-davinci-orchestration
description: Work on PingOne DaVinci widget and Orchestration SDK flows in this demo, including collectors, multi-screen progression, callback URLs, PKCE, embedded/pop-out runners, and safe flow debugging.
---

# PingOne DaVinci orchestration

Use this skill for changes or diagnosis involving the DaVinci widget, the Ping
Orchestration SDK, the `/davinci-widget` page, the
`/davinci-orchestration-sdk` page, or their BFF endpoints. It is not a generic
`/debug` route or a replacement for `regression-guard`.

## Product boundaries

- The hosted widget (`/davinci-widget`) gets a DaVinci API token from the BFF,
  calls `davinci.skRenderScreen`, and renders DaVinci-owned screens. Its BFF
  session endpoint is `/api/davinci-login/widget-session`.
- The Orchestration SDK page (`/davinci-orchestration-sdk`) builds the PingOne
  `/authorize` request with `response_mode=pi.flow`, receives flow JSON, and
  renders collectors in application-owned markup. Its BFF endpoints are under
  `/api/davinci-sdk-login`.
- `/davinci-orchestration` is the explanatory overview. Do not make it perform
  live authentication unless explicitly requested.
- Browser routes and BFF API paths are intentionally different. Preserve that
  boundary when renaming a page.

## Flow correctness

Never implement the SDK runner as a one-form demo. After every SDK call:

1. Record the request and response in the existing inspector/trace surface.
2. Read collectors from the SDK client, including collectors on an error node.
3. Render the current screen with a new React key when the flow node changes.
4. Route `ActionCollector`/submit controls through `next()` and
   `FlowCollector` branch controls through `flow(action)()`.
5. On `continue` or `error`, render the returned collectors again; retain field
   errors. On `success`, exchange the authorization code once through the BFF.

Do not assume that a successful first call means the flow has only one screen.
An existing PingOne session may complete immediately; explain that state and
offer a sign-out path so a presenter can see the forms.

## Callback and tenant configuration

- The redirect URI must be an exact, browser-reachable URI registered on the
  same PingOne public client used in the authorize request and token exchange.
- The local canonical origin is `https://local.ping-devops.com:4000`.
- For the current SDK route, the local callback is
  `https://local.ping-devops.com:4000/davinci-orchestration-sdk`.
- Preserve old callbacks during migrations when safe, but do not mutate a live
  PingOne application or add a production callback without explicit user
  approval. First perform a read-only application check and show the exact
  before/after URI set.
- A PingOne authorize validation error before any collector appears is usually
  a callback allowlist, client, flow policy, CORS, or request-shape problem—not
  a React form-rendering problem. Inspect the authorize request and effective
  BFF `/start` response without printing nonce, state, code verifier, tokens, or
  client secrets.

## Embedded and pop-out runners

If both presentation modes are requested, make the embedded runner and pop-out
runner use the same flow implementation and configuration. The pop-out must:

- open synchronously from the button click so browsers do not block it;
- use an explicit named window and bounded dimensions;
- keep its own flow state so opening it does not consume the embedded runner's
  nonce or collectors;
- provide a clear close action and a useful blocked-pop-up message; and
- retain the same token custody and BFF session rules as the embedded runner.

Use semantic buttons with the page's existing theme tokens. Keep headings,
button labels, borders, focus states, and error surfaces consistent with the
lesson shell. Do not put themeable colors, backgrounds, or font sizes in JSX
inline styles.

## Verification

For UI changes, read the repository's `REGRESSION_PLAN.md` §0–§1 and use
`regression-guard`. Run the focused Vitest files for the touched DaVinci page,
then `cd demo_api_ui && npm run build`. For BFF changes, run the focused Jest
route tests with `CI=true`. Do not claim a live flow works from unit tests:
manual validation requires the running stack on the canonical local origin and
must pin the stack generation before and after the drive.

Update the DaVinci use-case documentation when route names, flow behavior,
embedded/pop-out behavior, or tenant setup changes. Keep docs explicit about
which screens are rendered by the widget versus the SDK.
