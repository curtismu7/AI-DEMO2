# Privilege Across Three MCP Clients — Demo Design

**Date:** 2026-09-26
**Status:** Approved in conversation; code reviewed
**Scope:** Rehearsable Privilege MCP demo across the in-repo app, LM Studio, and LibreChat, followed by the app's AI Guard Attack Lab.

## Goal

Give presenters and first-time users one dependable story they can run from
three MCP clients. The comparison should make the access boundary visible:

1. Direct OpenSearch access exposes the full tool catalog and bypasses
   Privilege.
2. Privilege access exposes only the tools in a deliberately narrow,
   verified policy and allows a representative read.
3. A separate Privilege app returns a real policy 403 for the same known demo
   identity.
4. The app then runs its full current AI Guard Attack Lab suite.

The app is the only AI Guard surface in this presentation. LM Studio and
LibreChat demonstrate the MCP path; they are not expected to send model traffic
through AI Guard.

## Approved approach

Use a local-first presenter setup: the app and BFF run in the local OrbStack
stack, LM Studio runs as a desktop client, and LibreChat runs in its existing
standalone Compose stack. All three reach the same OpenSearch MCP backend and
the same hosted Privilege AI Gateway apps. Preserve each client’s native
interaction style, but label the three access states identically in the docs.

Deliver two documentation layers:

- A presenter runbook with preflight, the shared talk track, the three-client
  access comparison, the AI Guard handoff, and recovery steps.
- First-time setup guides for the app, LM Studio, and LibreChat, each with
  screenshots and client-specific OAuth/setup instructions.

First prove the full demo matrix, then capture screenshots from passing live
runs and write the final user-facing instructions against those results.

## Audience and presentation flow

### Shared MCP comparison

Use the same read-only OpenSearch task and data for each state in each client.
Make clear that the direct lane is a baseline and does not pass through
Privilege.

| State | Intended route | What the audience should observe |
|---|---|---|
| Direct | Direct OpenSearch MCP endpoint | Full backend tool catalog and a successful read; explicitly identify this as outside Privilege. |
| Privilege-limited | Privilege `opensearch22` app | A smaller, exact allowlisted tool catalog and a successful call to an allowed tool. |
| Privilege-denied | Separate Privilege `opensearch` app | A real 403 from Privilege before the backend call. Treat this as the expected policy result. |

Repeat those same three semantic states in the web app, LM Studio, and
LibreChat. The gateway app and the user identity are the policy boundary; do
not imply that the clients share access tokens. Each client completes its own
OAuth connection and should resolve to the same intended PingOne identity.

Use a separate deny app so the denied state does not overwrite or weaken the
limited allowlist. Confirm the 403 is an app-policy denial for a recognized
identity, not an expired allow policy, an unsynced user, a stale client token,
or a transport/setup failure.

### AI Guard segment

After the three-client comparison, return to the app and run the five scenarios
currently documented for the Attack Lab at `/llm-gateway?tab=attacks`:

- Tool Abuse
- Tool Poisoning
- Schema Violation
- Inter-Agent Abuse
- Malicious Content

For every run, show the observed path, enforcement component, decision, and
whether the model/provider or backend was reached when the UI provides that
evidence. A scenario result may be a local validation, an authorization
decision, a model refusal, a Privilege decision, or no verdict; describe the
observed result accurately. Do not present all five scenarios as AI Guard
blocks unless the live evidence says that AI Guard made the decision.

## Environment and client mapping

The local-first setup is canonical for the guide. Current repository routes
provide a starting point, not proof that the live matrix is ready:

| Client | Existing direct route | Existing Privilege route(s) | Verification needed |
|---|---|---|---|
| Web app | Dynamic direct door selection on `/privilege-mcp-client` | Dynamic Privilege and façade modes, with per-app door selection | Verify all three states and returned tools using the same main-tenant identity. |
| LM Studio | `MCP Direct-OpenSearch` at the local MCP endpoint | `MCP Privilege-OpenSearch` through the local recording façade | Add or document the denied app entry; verify OAuth completion, exact limited catalog, and the 403 result in the running LM Studio version. |
| LibreChat | `opensearch-direct` through the local host port | Façade and direct Privilege gateway entries both exist | Select one recommended entry for each state; remove ambiguity from labels/starters and verify authentication and tool results in a fresh LibreChat account/session. |

The main app origin remains `https://local.ping-devops.com:4000`. LibreChat
uses its separate local URL and BFF-facing route. Direct OpenSearch may require
the documented local port-forward. The final guides must distinguish those
local hops from the public Privilege gateway endpoint and list the required
services explicitly.

Use the same demo identity across the three clients, federated through the
Privilege gateway to the main PingOne environment. Each client has its own
OAuth session and may need a one-time sign-in; explain this clearly. Avoid a
second interactive login when an existing main PingOne session can complete
federation silently. Verify the resolved identity from the gateway evidence,
not from the local console account or a login hint alone.

## Policy and backend preflight

Before rehearsals and screenshot capture:

1. Confirm the direct and Privilege routes reach the same OpenSearch MCP
   backend and the direct catalog count is current.
2. Confirm `opensearch22` has one effective, unexpired policy granting the
   intended demo identity only the chosen tools. Check for group-policy unions
   that could silently broaden the effective allowlist.
3. Confirm `opensearch` is the intended deny app and that its 403 is a policy
   denial for the synced demo identity. Capture gateway evidence that the
   backend was not reached.
4. Confirm all three client-specific OAuth flows resolve to the same gateway
   identity. Client sessions remain separate; do not copy tokens between
   clients.
5. Run each AI Guard scenario and record its observed enforcement point and
   reachability before describing it in the guide.

Treat policy expiry, identity sync, gateway registration, direct port-forward,
and LibreChat startup as setup dependencies with named recovery steps. Never
change a live Privilege policy silently as part of routine demo preparation.

## Documentation and screenshots

Proposed deliverables:

- `docs/user-guide/privilege-three-client-demo.md` — presenter runbook and
  common story.
- `docs/user-guide/privilege-three-client-demo-app.md` — first-time web-app
  path and setup.
- `docs/user-guide/privilege-three-client-demo-lm-studio.md` — installation,
  MCP configuration, authentication, tool selection, and recovery.
- `docs/user-guide/privilege-three-client-demo-librechat.md` — Compose setup,
  account setup, MCP authentication, agent selection, and recovery.
- `docs/screenshots/privilege-three-client-demo/` — live, sanitized images
  used by the guides.

Use screenshots to answer a concrete user question: where to configure a
server, what to click to authenticate, what the limited tool set looks like,
how the 403 is presented, and where the AI Guard evidence appears. Capture the
real clients after the matrix passes; do not use mocked screens as product
evidence. Crop away unrelated desktop content, redact personal identifiers and
all credentials/tokens, provide useful alt text, and keep captions tied to the
verified state shown.

Keep the common runbook short. Put installation and client-specific differences
in the setup pages. Include a troubleshooting table mapping visible symptoms
to checks and recovery, especially for the expected 403 versus a broken sign-in
or expired policy.

## Execution phases

1. **Readiness audit:** inspect live configuration and policy state, confirm
   current client versions and local routes, and run the unmodified matrix to
   identify concrete failures.
2. **Parity fixes:** make only the configuration or code changes required for
   all three clients to show the same three access states. Keep the gateway
   apps and policy boundaries explicit. Auth/session changes require the
   repository regression workflow.
3. **Matrix rehearsal:** execute direct, limited, and denied states in every
   client; then run the full Attack Lab suite in the app. Record statuses,
   tool counts, actual results, and gateway/backend reachability.
4. **Screenshot capture:** capture each distinct setup and evidence state from
   passing runs, sanitize the images, and add captions/alt text.
5. **Guide writing and review:** write the presenter and setup guides from the
   verified matrix; have a first-time user follow each client setup and a
   presenter rehearse the entire run without undocumented help.

Do not begin broad client redesign. If the readiness audit finds an
architectural blocker, stop and bring back the evidence and a narrowly scoped
design decision before changing the auth model or live gateway policy.

## Acceptance criteria

- Each of the three clients shows a direct full-catalog result, a Privilege
  allowlisted catalog plus successful allowed read, and an expected 403 from
  the separate deny app.
- All Privilege results use the same intended identity; gateway evidence
  confirms the expected allow/deny decisions. A denial occurs before the MCP
  backend is reached.
- The app's five Attack Lab scenarios have been rehearsed with accurate
  enforcement attribution and observed outcomes.
- A first-time user can follow the written client setup guides; a presenter can
  run the sequence from the runbook and recover from common documented failures.
- Screenshots match verified live states, are readable, include context and
  alt text, and expose no secrets or personal identifiers.
- Client labels, endpoints, policy claims, and expected outcomes agree across
  the runbook, setup guides, and shipped configs.

## Non-goals

- AI Guard model traffic through LM Studio or LibreChat.
- Replacing the current Privilege gateway or migrating the demo to a different
  PingOne environment.
- Making a live 403 disappear or weakening the policy to make the demo look
  successful.
- Rebuilding LibreChat or LM Studio, or creating a generic MCP setup wizard.
- Claiming an AI Guard decision when another component produced the result.
- Publishing secrets, tokens, private user data, or unsanitized screenshots.
