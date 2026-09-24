# PingOne Protect browser OIDC demo

## Goal

Provide an end-user-facing demo that collects PingOne Signals in the browser,
evaluates the sign-in with PingOne Protect, and demonstrates three outcomes:

- **Low:** continue with normal OIDC sign-in and show the success page.
- **Medium:** continue with OIDC sign-in using the configured PingOne MFA
  step-up requirement.
- **High:** stop before OIDC sign-in and show a block page.

The existing Protect product entry should describe this browser authentication
flow, not agent dispatch. Put the demo in its own page under the **Ping products**
side-navigation group and provide a **PingOne Protect** demo-steps chip/action to
open and run it. The page must work embedded in the lesson and as a standalone
pop-out, and expose a light/dark control in either presentation. Protect runs
only when the user clicks the chip; it does not run on every app sign-in.

## Recommended approach

Keep the existing browser OIDC demo's public PKCE client and configured PingOne
callback. Add a dedicated Protect sign-in page that loads the PingOne Signals Web
SDK, collects a login identifier, and obtains the Signals payload when the user
starts the demo. The page sends the identifier and payload to a new BFF route. The
BFF derives the client IP and user agent from the request, constructs an
`AUTHENTICATION` risk event for the configured PingOne environment, and calls
PingOne Protect using the existing server-side Worker-token service. No Worker
credential is exposed to the browser.

The BFF returns only the risk outcome and an opaque flow handle. The page owns the
demo branch: LOW starts the existing OIDC flow normally; MEDIUM starts it with the
configured step-up ACR value; HIGH records a failed/blocked completion and renders
the block page without redirecting to OIDC. After the OIDC callback, the page
reports SUCCESS or FAILED against the risk evaluation through the BFF. Keep the
evaluation ID in the server session associated with the opaque flow handle. The
callback must confirm the validated ID token identifies the same user evaluated
by Protect before reporting SUCCESS. A short-lived sessionStorage marker carries
the evaluated identifier and issue time across the OIDC redirect; expire it after
the 10-minute flow TTL and fail closed when identity claims do not match.

This is a demo application gate around OIDC, not a claim that PingOne's hosted
authorization service itself consumes the preflight Protect result. A DaVinci
flow could instead make risk branching part of the identity journey, but it
requires a Protect-enabled DaVinci flow to be attached to this OIDC application;
the BFF approach uses the existing OIDC demo configuration. Ping documents both
the API and DaVinci integration paths, requires flow-completion feedback, and
describes branching on risk for access, MFA, or blocking.

## Components and behavior

1. **Page and navigation:** Add a dedicated browser-auth page and a PingOne Protect
   entry/action under Ping products. Explain Signals collection, the server-side
   evaluation, and the Low/Medium/High outcomes. Provide visible states for SDK
   loading, evaluation, MFA in progress, success, block, and errors.
2. **Signals SDK:** Load and initialize the web SDK on the demo page, then call
   `getData()` for each run. Do not log or render the raw signals payload.
3. **BFF evaluation:** Validate the submitted identifier and signals payload;
   derive IP and user agent server-side; set `user.type` to `PING_ONE`,
   `flow.type` to `AUTHENTICATION`, and the configured OIDC client as the target
   resource. Use the configured risk policy set when provided, otherwise allow
   the environment's default policy. Store the evaluation ID server-side.
4. **OIDC branch:** LOW uses the ordinary authorization request. MEDIUM uses the
   configured `step_up_acr_value` already exposed to the SDK login demo. Both use
   the existing public PKCE OIDC client and callback. HIGH does not start OIDC.
5. **Completion feedback:** Update Protect with SUCCESS only after the OIDC flow
   returns authenticated as the evaluated identity; report FAILED for denied,
   mismatched, failed, or abandoned sign-in when the flow outcome is available.
   High-risk blocks are FAILED. Keep completion state single-use and scoped to
   the browser session.
6. **Failure behavior:** SDK, configuration, or Protect errors render an explicit
   error and never silently fall through to normal sign-in. Do not claim HIGH if
   evaluation did not return a valid risk result.

## Configuration and dependencies

Reuse `PINGONE_SDK_DEMO_CLIENT_ID`, its configured redirect URI, and
`step_up_acr_value`. Confirm the public OIDC client has the existing callback and
that its authentication policy honors the configured ACR for PingOne MFA. Reuse
the PingOne management-token service and Protect service where practical, while
keeping the agent-dispatch contract isolated from the new authentication route.
Add Signals SDK domains to the applicable Content Security Policy:
`https://apps.pingone.com` for script, connect, and style sources.

## Verification

- BFF tests cover valid and malformed payloads, server-derived event context,
  evaluation outcomes, Worker credentials never returned to the client,
  single-use completion feedback, and Protect/API failure behavior.
- UI tests cover SDK initialization and collection, all three risk branches,
  OIDC normal versus MFA step-up parameters, callback completion, and error states.
- Run the UI unit suite and required production build; run the focused BFF tests.
- Use Playwright against the canonical local browser origin to exercise Low,
  Medium/MFA, and High/block paths with deterministic evaluation responses, then
  verify the configured PingOne integration end-to-end where tenant policy permits.
- Run the required contrast audit for the page in light and dark themes.

## Documentation references

- [PingOne Protect risk evaluations](https://developer.pingidentity.com/pingone-api/protect/risk-evaluations.html)
- [Create a risk evaluation](https://developer.pingidentity.com/pingone-api/protect/risk-evaluations/create-risk-evaluation.html)
- [PingOne Signals SDK for Web](https://developer.pingidentity.com/pingone-api/native-sdks/pingone-risk-sdks/risk_evaluation_sdk_web.html)
- [Getting started with PingOne Protect](https://docs.pingidentity.com/pingone/threat_protection_using_pingone_protect/p1_protect_getting_started.html)
