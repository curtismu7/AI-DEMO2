# PingFederate ID-JAG Run Mode Design

## Status

Approved design for implementation planning.

## Goal

Make the PingFederate ID-JAG demo an explicit, reversible run mode: an explicit Run action, Mission Control chip, or recognized agent phrase silently signs out the current session, sends the user through PingFederate login, runs UC40 through the native PingFederate ID-JAG path, and shows ID-JAG-specific evidence only for that run.

## Current gap

The `/pingfederate-id-jag/demo` page can dispatch the generic `show my balance` prompt, but it does not establish a provider-authenticated ID-JAG run before doing so. The agent therefore treats the request as an ordinary run or reports an expired/invalid session. The existing catalog and Mission Control data contain UC40, but the launch path does not consistently carry an ID-JAG mode through logout, login, agent dispatch, BFF validation, and visual evidence.

The existing unified logout endpoint already clears the local session and chooses the PingFederate OIDC end-session endpoint when PingFederate is selected. The missing piece is a pending, server-validated run intent that survives that redirect and prevents UC40 from silently falling back to the standard exchange path.

## Non-goals and do-not-break contract

- Do not change the ordinary PingOne login, ordinary PingFederate login, or their token-exchange semantics.
- Do not make opening an explainer or demo URL log a user out; only an explicit ID-JAG Run action starts the handoff.
- Do not make the browser a token custodian; ID-JAG and exchanged access tokens remain BFF/server-side.
- Do not make `ff_enterprise_managed_mcp_auth` the sole source of run identity. The flag may enable capability, but the run mode must be explicit and scoped.
- Do not show native ID-JAG nodes for a mock/stand-in or ordinary exchange trace.
- Do not leave the ID-JAG feature flag or pending run state active after a normal PingOne/PingFederate login or logout.
- Preserve the project emoji allowlist and existing UI theme/accessibility rules.

## Recommended architecture

### 1. Explicit launcher and pending run intent

Create one UI launcher contract for the ID-JAG demo. It accepts the target return path and emits/stores a bounded run intent containing:

```js
{
  useCaseId: 'enterprise-managed-mcp-authorization',
  mode: 'id-jag',
  message: 'show my balance',
  returnTo: '/dashboard'
}
```

The page Run button, Mission Control UC40 chip, and recognized agent phrases (`run demo`, `run ID-JAG demo`, `enterprise managed MCP`, and `show my balance` when explicitly launched from UC40) all call the same launcher. The launcher clears stale client run context and the ID-JAG flag before starting the unified logout flow, then preserves only the pending intent needed for the login callback.

The launcher must be idempotent while a logout/login handoff is in progress so repeated phrases or clicks cannot create competing OAuth states.

### 2. Provider-aware logout and PingFederate login handoff

Extend the existing auth handoff without changing normal logout behavior:

1. Store the pending UC40/id-jag intent in a short-lived, same-site server session value or signed state associated with the OAuth transaction; use session storage only as a UI replay aid, never as authorization proof.
2. Invoke the existing unified logout endpoint, which must clear the BFF session, auth cookies, token-chain caches, and the active provider SSO session.
3. Return to a same-origin callback landing path that resumes the pending intent.
4. Start end-user PingFederate login with `return_to` restricted to the approved same-origin route and with the pending mode bound server-side.
5. On callback, verify that the selected provider is PingFederate and stamp the authenticated session/run context as `mode: 'id-jag'`.

If the provider is PingOne or the required PF ID-JAG configuration is unavailable, UC40 must return a clear reauthentication/configuration error instead of invoking ordinary token exchange.

### 3. BFF run-mode enforcement

Thread the run mode with the existing `useCaseId` through the agent request and token service. The server remains authoritative:

- UC40 with `mode: 'id-jag'` requires an authenticated PingFederate session and native PF ID-JAG capability.
- UC40 without a valid ID-JAG mode must not silently choose the PF ID-JAG path.
- Ordinary use cases ignore stale ID-JAG client fields and use their existing provider path.
- A normal successful login or explicit provider switch clears pending ID-JAG state and resets `ff_enterprise_managed_mcp_auth` through the existing feature-flag/config boundary.

The existing PF ID-JAG issuer, downstream audience/resource, JWKS validation, and redemption service remain unchanged; this work supplies the correct authenticated subject and run selection to them.

### 4. Mission Control and agent launch behavior

Expose UC40 as a clearly labeled Mission Control action, such as `Run PingFederate ID-JAG`, with a short explanation that it signs out the current identity and asks for PingFederate login. The chip must use the shared launcher rather than dispatching a generic prompt directly.

Update agent intent matching so “run demo” is not treated as an unscoped banking question when the user is in the UC40/Mission Control context. Recognized ID-JAG phrases must produce the same pending intent as the page button. A generic “show my balance” typed outside UC40 remains an ordinary banking request.

After the login handoff, the pending message is replayed once, with the UC40 ID-JAG context attached. Failed login, dismissed login, expired session, and duplicate callback paths must clear the one-shot pending intent.

### 5. Dynamic visual evidence

Use the trace’s authoritative provenance/mode, not a global flag, to decide what is shown.

For an actual PF ID-JAG run, show:

- the PingFederate identity/provider step;
- ID-JAG issuance by PingFederate;
- ID-JAG redemption/validation by the downstream authorization server;
- the resulting MCP access-token/tool-call path;
- labels indicating native PF ID-JAG rather than an RFC 8693 stand-in.

For ordinary PingOne, ordinary PingFederate, mock, or stand-in runs, omit the native ID-JAG nodes and retain the current exchange visualization. The same predicate should drive the movie reel/filmstrip, token-chain cards, sequence diagram, run-story text, and any provider badges so the screens cannot disagree.

The empty/error trace must still identify the failed prerequisite: for example, “PingFederate login required for this ID-JAG run,” rather than rendering a completed standard exchange with blank claims.

### 6. Reset behavior

Reset on all of these boundaries:

- explicit logout;
- successful PingOne login;
- successful ordinary PingFederate login;
- provider toggle;
- cancelled/failed ID-JAG login;
- completed or abandoned UC40 run.

Reset includes the one-shot pending intent, client run context, ID-JAG-only visual state, and `ff_enterprise_managed_mcp_auth` when that flag was armed for the run. The capability remains configurable for other use cases, but stale UC40 mode cannot affect them.

## Error handling

- If the ID-JAG launcher cannot start logout, leave the current page in place and show the existing application error notification.
- If logout succeeds but PF login is unavailable, return to the intended page with a concise reauthentication/configuration message and no active ID-JAG mode.
- If the agent receives UC40 with a non-PF session, return a structured auth error that the UI maps to the PF login action; never fall back to standard exchange.
- If PF issues a token that is not typed/validated as ID-JAG, preserve the existing service failure and show the trace as failed, not as a normal exchange.
- Ensure all pending values are bounded, same-origin validated, and single-use.

## Testing and verification

### UI unit tests

- shared launcher creates the correct one-shot pending intent and calls logout;
- page Run button, Mission Control chip, and agent phrases use the shared launcher;
- UC40 context replays once after successful PF callback;
- normal provider login clears ID-JAG state and flag;
- dynamic filmstrip/sequence/token-chain rendering includes native nodes only when trace mode is `id-jag`;
- expired/non-PF sessions show the PF login requirement;
- button text remains readable in light and dark themes.

### BFF tests

- pending intent is accepted only for UC40 and same-origin return paths;
- PF session plus ID-JAG mode selects native PF exchange;
- PingOne or ordinary PF session cannot select native PF ID-JAG;
- normal login/logout/provider switch clears the mode and flag;
- one-shot pending intent cannot be replayed twice.

### Integration/manual verification

On `https://local.ping-devops.com:4000` with the local Docker stack:

1. Start from an active PingOne or ordinary PF session.
2. Open `/pingfederate-id-jag/demo`; confirm no logout occurs on page load.
3. Click the explicit Run button; confirm silent logout, PF login, and return to the run.
4. Confirm the agent executes `show my balance` only after PF login and the trace contains PF ID-JAG issuance and redemption.
5. Repeat from Mission Control and by saying “run ID-JAG demo” and “run demo” in the UC40 context.
6. Log in normally through PingOne and ordinary PF; confirm ID-JAG nodes, pending context, and run-only flag are gone.
7. Run the existing UI unit/build checks, focused BFF tests, `npm run topology:verify`, `npm run hygiene:check`, and `npm run authz:verify` where affected.
8. Use Playwright for the browser flow and capture a screenshot/artifact under `output/playwright/` if the environment permits it.

## Alternatives considered

### Global feature-flag-only mode

Arm `ff_enterprise_managed_mcp_auth` and let every UC40 request infer ID-JAG from the flag. This is smaller but permits stale state to leak into ordinary runs and cannot reliably coordinate logout/login or multiple tabs. Rejected.

### Separate ID-JAG-only login route and session

Create a completely separate browser route and server session for ID-JAG. This isolates state well but duplicates provider login/callback, logout, and session-clearing behavior. It would make ordinary provider switching harder to reason about. Rejected for this phase.

### Explicit run intent with existing auth/session boundaries

Use a one-shot, server-validated UC40/id-jag intent and the existing logout/login/session/token services, then derive visuals from trace provenance. This has the smallest interface change while keeping the BFF authoritative and reset behavior explicit. Recommended.
