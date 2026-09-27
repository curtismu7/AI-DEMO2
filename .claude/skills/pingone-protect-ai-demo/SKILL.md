---
name: pingone-protect-ai-demo
description: Use when integrating PingOne Protect, PingOne Signals, authentication risk evaluations, risk policy inputs, or risk-result handling in AI-DEMO2.
---

# PingOne Protect integration

PingOne Protect evaluates risk from an event and its available signals. In AI-DEMO2, the browser Signals demo is deliberately observational: it displays a risk evaluation but does not authenticate a user, require MFA, block a request, or dispatch an agent action.

## Existing project path

`demo_api_ui/src/lib/pingOneSignalsSdk.js` collects Signals on user action. The browser submits them to `POST /api/protect-auth/evaluations`; `demo_api_server/routes/protectAuthentication.js` validates input and builds request context; `demo_api_server/services/pingOneProtectService.js` gets a server-side Management API token and calls the environment's `/riskEvaluations` endpoint. The BFF returns only the normalized level, recommended action, and selected bot-detection fields. The browser never receives the worker token or raw evaluation response. The page-supplied `userId` is sent as an `EXTERNAL` identity and is not bound to an authenticated PingOne subject; treat it as untrusted demo input, not verified identity.

## Workflow

1. Start at `https://docs.pingidentity.com/llms.txt`, follow the PingOne documentation set to the PingOne Protect and Signals references, and verify current APIs, SDK setup, event schema, and policy behavior for the target environment/release. The demo links to official predictor guidance from `demo_api_ui/src/pages/PingAiProductPage.jsx`.
2. Decide whether the requested flow is collection, risk evaluation, or enforcement. Record the event type, user identity type, client IP provenance, user-agent, session, target resource, Signals payload, and any policy set required. Do not substitute invented fields or identities for values the product uses to make a decision.
3. Keep Signals collection explicit and user-visible. Validate and size-limit browser input at the BFF, add trusted request context server-side, keep Management credentials server-side, and return only fields the UI needs. Never log raw Signals, tokens, or full risk responses.
4. Preserve the current demo's separation: a browser evaluation does not silently become a login gate. If the user requests risk-based enforcement, design the policy mapping and fail-safe behavior with them, implement it on a trusted server boundary, and test the protected action itself before describing the result as enforced.
5. Test missing/oversized Signals, missing configuration, Management API rejection/timeout, unknown risk levels, redaction, and valid normalized responses. UI changes also require the project UI tests/build and the auth-requirements check if a route's access changes.
6. Provision or alter live Protect policies, applications, or environment settings only when explicitly requested. Inspect the operation and target first; never store credentials in source or generated shareable skill packages.

## Project references

- `demo_api_ui/src/pages/PingOneProtectBrowserDemo.jsx`
- `demo_api_server/routes/protectAuthentication.js`
- `demo_api_server/services/pingOneProtectService.js`
- `demo_api_server/tests/protectAuthentication.test.js`
- `demo_api_server/tests/pingOneProtectService.authentication.test.js`
