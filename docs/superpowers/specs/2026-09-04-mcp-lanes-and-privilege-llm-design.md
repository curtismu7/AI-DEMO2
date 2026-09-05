# MCP lanes (Direct / Privilege / Façade) + Privilege LLM protection — design

**Date:** 2026-09-04
**Status:** design, awaiting approval
**Goal:** make the three MCP connection lanes demoable and bulletproof in *both*
clients (the web AI Gateway Client page and LM Studio) on *both* targets (local
Docker and the SE cluster), and add a Privilege LLM protection panel to the
gateway client page.

---

## 1. Problem statement

The user reports the three MCP lanes "fighting each other", and has never seen
the façade work in LM Studio or in the AI Gateway Client. Separately, the user
wants Privilege LLM protection — a virtual API key through which Privilege calls
Anthropic / OpenAI / Google — surfaced on the gateway client page, believing the
Anthropic side was set up but possibly never finished.

Both reports are accurate. Neither has the cause the symptom suggests.

---

## 2. Current state — verified, not assumed

Everything in this section was checked live on 2026-09-04 against the running
SE cluster and the repository at `main`. Where a claim is code-derived rather
than probe-derived, it says so.

### 2.1 What is already working

| Fact | Evidence |
|---|---|
| SE façade serves all doors | `GET /mcp-facade/{privilege-gateway,opensearch,agent-gateway}/.well-known/oauth-protected-resource` → 200 |
| SE advertises a correct, publicly reachable authorization server | all three doors return `authorization_servers: ["https://ai-demo.ping-devops.com"]` |
| That AS is real | `GET https://ai-demo.ping-devops.com/.well-known/oauth-authorization-server` → 200, with `authorization_endpoint`, `token_endpoint`, `registration_endpoint` (RFC 7591 DCR) and `scopes_supported` including `mcp:invoke` and `audit:read` |
| The public-URL patch mechanism exists and works | `service-topology.json` marks `MCP_FACADE_AGENT_GATEWAY_AS`, `MCP_FACADE_REEL_BASE`, `PUBLIC_APP_URL` as `"public"`; live `ai-demo-config` configmap carries `https://ai-demo.ping-devops.com` for each |
| The Privilege AI Gateway is up | `GET https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp` → 401 (alive, demanding auth) |
| Privilege LLM protection is built and merged | PRs #2732 (Gemini) and #2740 (Claude); [`services/privilegeLlmProxyService.js`](../../../demo_api_server/services/privilegeLlmProxyService.js), header records live verification 2026-09-03 |
| Its secrets are live on SE | `ai-demo-secrets` contains `PRIVILEGE_LLM_GATEWAY_URL`, `PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC`, `PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE` |
| Local Docker can complete the OAuth dance | `docker-compose.yml` publishes `mcp-gateway` as `3005:3005`, so the default `MCP_FACADE_AGENT_GATEWAY_AS=http://localhost:3005` is reachable from a host-side LM Studio |

Two hypotheses raised during analysis were **disproved** and are recorded so
nobody re-investigates them:

- *"SE advertises `localhost:3005` as the AS."* False — the public-patch
  mechanism sets it correctly.
- *"The SE façade is down."* False — the 502s observed were a deploy in flight
  (`demo-api-server` pod was 11s old and `0/1`); it returned 200 once settled.

### 2.2 Finding 1 — the gateway session is the demo-killer

[`services/privilegeGatewaySession.js`](../../../demo_api_server/services/privilegeGatewaySession.js)
holds the façade's upstream leg to the Privilege AI Gateway **in memory, as a
single shared session**. Its own header explains why a service credential is
impossible: the gateway publishes only `authorization_code` and `refresh_token`
grants — no `client_credentials` — so a gateway token can only be minted by a
human completing a browser sign-in at `/privilege-mcp-client`.

Consequences, all code-derived from `mcpFacade.js:678-695` and
`privilegeMcpClient.js:1573-1585` (the only writer):

- Every `demo-api-server` restart wipes the session.
- Every Privilege gateway restart invalidates it (the gateway's RFC 7591 client
  registry is also in memory), and `refresh()` then clears it permanently.
- With no session, the `privilege-gateway` door returns
  `503 {error: {code: -32002, message: "Gateway session unavailable"}}` to
  every caller.
- Nothing surfaces this state. Not the page, not a health check, not a log the
  operator reads.

The SE BFF restarted during this analysis, which means the door was dead at that
moment with no external signal. **This is the single most likely reason the
façade has never been seen working in LM Studio.**

This is a deliberate design (the file argues that a token store outliving the
process would be "a credential at rest for no demo benefit"), and this spec does
not overturn it. The fix is visibility and one-click recovery, not persistence.

### 2.3 Finding 2 — the three lanes do not serve the same tools

**The current Privilege deployment is agent-based, and it works. Do not change
it.** Confirmed with the user 2026-09-04. Two naming traps to record, because
both cost time in this analysis:

- The Helm release in `ping-devops-curtismuir` is still called
  **`agentless-mcpgw`** (chart-legacy naming, revision 5, 2026-09-03). That
  name does not describe the mode. The deployment is the agent one.
- **Agent mode here still uses OAuth.** The "agent mode carries no
  `Authorization` header" behaviour described for the retired
  `*.applications.procyon.ai:8643` frontends does **not** apply to this
  deployment. Clients reach it at `https://mcpgw.ai-demo.ping-devops.com/<app>/mcp`
  and complete the normal OAuth dance. Finding 1 (§2.2) therefore stands in
  full.

It serves **three** Agentic Apps — two OpenSearch and one Brave — named in
`privilegeMcpClient.js:20-26` as `opensearch22`, `opensearch` and `brave`, each
with its own Privilege policy. (An earlier version of this spec said one;
`privilege/CURRENT-CONFIGURATION.md` is stale on this point.) Banking is not
behind Privilege at all.

Two caveats on that inventory, both unresolved and both for W4/W8 rather than
assumption:

- The user's live `~/.lmstudio/mcp.json` calls the Brave app
  **`mcp-brave-search`**, which matches no constant in the code. One of the two
  is wrong; which is unknown.
- **An unauthenticated probe cannot settle it.** The gateway returns 401 before
  routing, so a nonexistent app name (`bogus-app`) answers 401 exactly like a
  real one. App existence can only be confirmed through the console inventory
  (§5, W8) or an authenticated call.

**The user will add more Agentic Apps over time.** Any design that hardcodes the
app list is wrong by construction — see W8.

| Lane | Banking | OpenSearch | Brave | PingOne admin |
|---|---|---|---|---|
| Direct | yes (`mcp-server:8080`) | yes | yes (`mcp-brave:8897`) | yes (local handler) |
| Privilege | **no** | yes (`opensearch22`) | yes (`mcp-brave-search`) | no |
| Façade | yes (`agent-gateway` door) | yes | yes | yes |

So "the same call down three different paths" — the comparison the demo exists
to make — is possible for OpenSearch and Brave, but not for banking. Three
façade doors (`agentless`, `agent`, `agent-cmuir`) point at torn-down
infrastructure and are dark on purpose
([`TECH_DEBT.md:2273`](../../../TECH_DEBT.md)).

### 2.4 Finding 3 — the LM Studio config is stale and diverged

[`lmstudio/mcp.json`](../../../lmstudio/mcp.json) names doors `agentless` and
`agent` (both dark) and two `localhost` URLs. Four of its six entries cannot
work. The user's live `~/.lmstudio/mcp.json` is a different file entirely,
naming `opensearch`, `privilege-gateway` and `agent-gateway` on SE hosts. The
repo's copy is not a usable starting point for anyone.

### 2.5 Finding 4 — Privilege LLM protection is invisible and not reproducible

The feature works, but:

- **It is not on the gateway client page.** Its only UI surface is the agent
  mode picker (`privilege_llm` = Gemini, `privilege_claude` = Claude, in
  `demo_api_ui/src/config/agentModes.js`). The user asked for it on
  `/privilege-mcp-client`, where it does not exist.
- **There is no OpenAI lane.** `privilegeLlmProxyService.js` implements
  `POST {base}/llm/google/v1/chat/completions` and
  `POST {base}/llm/anthropic/v1/messages` only.
- **Its configuration is not reproducible.** The three env vars live in the
  user's `demo_api_server/.env` and in the live SE `ai-demo-secrets`, but appear
  in **no committed artifact** — not `k8s/03-secrets.yaml.template`, not
  `k8s/create-secrets.sh`, not `docker-compose.yml`, not
  `demo_api_server/.env.example`. They were hand-patched into the cluster. A
  fresh clone, a new operator, or a rebuilt namespace gets
  `PRIVILEGE_LLM_GATEWAY_URL not configured`.
- **There are no docs.** The only prose is the source header.

### 2.6 Finding 5 — a real bug found in passing

`mcpFacade.js:872-887`: `DELETE /:door/mcp` is registered only for the bare
path, not `/:door/:app/mcp`. It calls `req.door.upstream()` ignoring
`req.params.app`, and forwards the caller's bearer via `forwardHeaders` rather
than the `ownsUpstreamAuth` gateway token. Session teardown on
`privilege-gateway/<app>` therefore either 404s or tears down the wrong app with
the wrong credential.

---

## 3. The support matrix this design must satisfy

The deliverable is this table, all green, on demand.

| Lane | Web page (`/privilege-mcp-client`) | LM Studio | Local Docker | SE K8s |
|---|---|---|---|---|
| Direct — banking | required | required | required | required |
| Direct — OpenSearch | required | required | required | required |
| Privilege — OpenSearch (`opensearch22`) | required | required | required | required |
| Privilege — OpenSearch (`opensearch`) | required | required | required | required |
| Privilege — Brave (`brave`) | required | required | required | required |
| Privilege — banking (new app, W3) | required | required | required | required |
| Privilege — any app added later (W8) | required | required | required | required |
| Façade — Privilege gateway | required | required | required | required |
| Façade — agent-gateway (banking) | required | required | required | required |
| Privilege LLM — Anthropic | required | n/a | required | required |
| Privilege LLM — Google | required | n/a | required | required |
| Privilege LLM — OpenAI | required | n/a | required | required |

"Required" means: proven by an actual call returning real data, not by reading
config. LM Studio proof means the GUI, not a scripted equivalent — the two have
diverged before (`lmstudio/README.md`, PR #2353 notes).

---

## 4. Kubernetes and Docker impact analysis

Called out explicitly because deployment differences are where this demo breaks.

### 4.1 Topology

| | Local Docker | SE K8s |
|---|---|---|
| App services | `docker-compose.yml`, one shared stack | namespace `ping-devops-cmuir` |
| Privilege AI Gateway | not present (SE only) | namespace **`ping-devops-curtismuir`** |
| OpenSearch MCP server | port-forward or absent | `ping-devops-curtismuir` |
| Public host | `local.ping-devops.com:4000` / `localhost` | `ai-demo.ping-devops.com` |
| Façade reachable at | `:3001` (TLS) and `:3002` (plain HTTP) | `/mcp-facade/` via nginx configmap |

The app and the Privilege gateway are in **different namespaces**. The façade's
`opensearch` door depends on the cross-namespace FQDN
`opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local`. This works
today but is a standing risk: any NetworkPolicy added to either namespace
silently kills that door. The preflight (W1) must probe it rather than assume.

### 4.2 Docker-specific issues

1. **The mkcert chain breaks LM Studio.** LM Studio's MCP bridge is a Node
   process that rejects the mkcert CA (`SELF_SIGNED_CERT_IN_CHAIN`, "Plugin
   process exited with code 1"). This is why the plain-HTTP façade listener
   exists (`MCP_FACADE_HTTP_PORT=3002`, bound `127.0.0.1:3002`). Local LM Studio
   entries **must** use `http://localhost:3002/mcp-facade/...`, never `:3001`.
   Containerised clients (LibreChat) keep the `:3001` HTTPS URL.
2. **`/etc/hosts` is required.** `api.ping.demo` and `local.ping-devops.com`
   have no DNS; the Mac needs `127.0.0.1 local.ping-devops.com api.ping.demo`.
   Sign-in only works on `local.ping-devops.com:4000` (passkey `rp.id`).
3. **Reel base differs from the app URL by design.** `MCP_FACADE_REEL_BASE`
   defaults to `https://localhost:4000` in code but is set to
   `https://local.ping-devops.com:4000` in `demo_api_server/.env`, because LM
   Studio refuses to open loopback URLs ("Invalid or potentially unsafe URL").
   Do not repoint `PUBLIC_APP_URL` to fix a reel problem.
4. **One stack, one owner.** Never `docker compose up` from a worktree — it
   repoints the shared containers and starves every service of its `.env`. Use
   `npm run serve:worktree`.
5. **Only `demo_api_server` and `demo_api_ui` bind-mount source.** A change to
   `demo_mcp_gateway` (the broker) needs an image rebuild; `restart` keeps the
   old code.

### 4.3 Kubernetes-specific issues

1. **Public URLs come from the topology patch, not from a hand-edited
   configmap.** `service-topology.json` marks keys `"public"`; the deploy
   substitutes the real host. Any new public-facing façade var must be added
   there, or it will be correct locally and wrong on SE.
2. **`PRIVILEGE_LLM_*` are hand-patched into `ai-demo-secrets`.**
   `create-secrets.sh` uses `kubectl patch --type merge` throughout, which does
   not drop unlisted keys, so they survive a re-run today. But nothing recreates
   them: a deleted namespace, a `kubectl replace`, or a fresh environment loses
   them with no way to regenerate. W6 closes this.
3. **A BFF pod restart silently kills the façade's Privilege door** (§2.2).
   Rollouts, evictions, node drains and image updates all trigger it. On SE this
   is frequent and invisible.
4. **`demo-api-server` has no `app=demo-api-server` label**, so
   `kubectl get pods -l app=demo-api-server` returns nothing. Preflight and
   runbooks must not rely on that selector.
5. **Deploy-in-flight looks exactly like an outage.** A 502 from
   `/mcp-facade/...` during a rollout is indistinguishable from a broken door.
   Preflight must report pod readiness alongside the HTTP probe so a red line
   can be attributed correctly.
6. **The AI Gateway's DCR registry is in memory.** Restarting
   `agentless-mcpgw` invalidates every registered client; standalone MCP clients
   must be removed and re-added, and the BFF's gateway session must be re-armed.
7. **Backends register with `/sse`, never `/mcp`.** The gateway's discovery
   client speaks SSE; `/mcp` answers 200 and the handshake dies, reported as
   `Error discovering MCP server: calling "initialize": Unauthorized`.
8. **Policies are per Agentic App and time-boxed.** A new app starts with none,
   and a lapsed policy presents as a 403 that looks like misconfiguration.

---

## 5. Design

Eight workstreams. W1 is the measuring instrument and comes first; W4 is the
acceptance gate and comes last.

**Standing constraint:** the Privilege transport works and is not to be changed
(user, 2026-09-04). Agent-based deployment, OAuth retained, reached at
`https://mcpgw.ai-demo.ping-devops.com/<app>/mcp`. Nothing below alters that
path; the work is visibility, coverage, discovery and reproducibility around it.

### W1 — Preflight: one command that tells the truth

**New:** `npm run demo:preflight -- --target local|se`

Probes and prints a single green/red table:

- every façade door: PRM fetch, `initialize`, `tools/list` count
- every Privilege Agentic App reachable at `mcpgw`
- the gateway session status (`privilegeGatewaySession.status()`)
- each Privilege LLM lane (Anthropic / Google / OpenAI): one cheap call
- on SE: pod readiness per relevant deployment, so a red HTTP line can be
  attributed to a rollout rather than a defect
- the cross-namespace OpenSearch backend

**Why first:** nothing else in this spec is verifiable without it, and it is
the thing the user runs two minutes before a demo. It must exit non-zero on any
red so it can gate a deploy.

**New BFF endpoint:** `GET /api/privilege-mcp/preflight` returning the same
data as JSON, so the page (W2) and the CLI share one implementation.

### W2 — Make the gateway session impossible to be silently dead

1. Surface `privilegeGatewaySession.status()` on `/privilege-mcp-client` as an
   explicit armed / expired / absent indicator, visible without opening
   settings.
2. One-click **re-arm** that starts the sign-in flow directly, so recovery is a
   click rather than a diagnosis.
3. Include the status in W1's preflight and in the 503 body the client already
   receives (it carries a `remedy` string today; make the page act on it).
4. Do **not** persist the token. The in-memory design is deliberate and the
   demo point is that the upstream identity is a real human's, not a service
   account.

**Optional, flagged, decided at implementation time:** re-arm automatically on
BFF boot if a refresh token is still valid. This only helps if the token
outlives the process, which it does not today — so it is likely dropped.

### W3 — Register banking as an Agentic App on the AI Gateway

Console work, then config:

1. Create a new Agentic App via **Add Application → MCP Server** specifically —
   an app made any other way gets no working `FrontEndName` and fails with
   `Domain not found` forever.
2. Register the banking MCP server backend with a **`/sse`** suffix.
3. Author a policy for it (a new app starts with none; absence presents as 403).
4. Set `MCP_FACADE_AGENTLESS_URL` / `_AS` and
   `PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING` to the new app, un-darkening the
   `agentless` door.
5. Add the new app to the `privilege-gateway` door's multi-app path so
   `/mcp-facade/privilege-gateway/<app>/mcp` resolves.

**Result:** Direct, Privilege and Façade all serve the same banking tools, and
the three-lane comparison becomes honest.

**Dependency:** Privilege console access. This is user-side work.

### W4 — Reconcile LM Studio and prove it in the GUI

1. Regenerate `lmstudio/mcp.json` from the live door table, with correct
   per-target URLs (`:3002` plain HTTP locally, `https://ai-demo...` on SE).
2. Rewrite `lmstudio/README.md` for the current door set.
3. Prove **every** entry by hand in the LM Studio GUI: OAuth dance completes,
   `tools/list` populates, one real `tools/call` returns real data, reel image
   renders.
4. Add a test asserting `lmstudio/mcp.json` names only doors that exist in
   `DOORS` — the staleness in §2.4 was undetectable.

### W5 — Privilege LLM protection panel on the gateway client page

New panel on `/privilege-mcp-client`:

- **Provider picker:** Anthropic / Google / OpenAI.
- **Prompt box + Send**, showing the response, the gateway route used
  (`/llm/<provider>/...`), and latency.
- **Prove the policy:** a control that fires a call the Privilege policy denies,
  rendering `llm_policy_denied` with its reason and provider — the security
  story, not an error state.
- **Add the OpenAI lane** to `privilegeLlmProxyService.js`
  (`POST {base}/llm/openai/v1/chat/completions`, OpenAI-compatible wire shape,
  same `llm_policy_denied` contract as the other two).

Reuses `privilegeLlmProxyService.js` unchanged for Anthropic and Google. The
existing agent modes (`privilege_llm`, `privilege_claude`) are untouched.

**Dependency:** an OpenAI virtual key issued in the Privilege console. User-side.

### W6 — Make the configuration reproducible

1. Add `PRIVILEGE_LLM_GATEWAY_URL` and the three virtual keys to
   `k8s/03-secrets.yaml.template` (keys empty) and to `create-secrets.sh`'s
   mirror-from-BFF-`.env` path, alongside the existing `ANTHROPIC_API_KEY`
   handling.
2. Add all four to `demo_api_server/.env.example` with comments.
3. Add them to `docker-compose.yml` so a fresh local clone works.
4. Document the feature — currently the only prose is a source header.

Virtual keys are credentials: they go through the secrets path, never a
configmap.

### W8 — Refresh the door list from Privilege, instead of hardcoding it

**Requirement:** the user will keep adding Agentic Apps. Today the Door picker
is built from three hardcoded constants in `privilegeMcpClient.js:20-26`
(`opensearch22`, `opensearch`, `brave`) with env-var overrides, so a new app
needs a code change or a redeploy. That is wrong by construction.

**Most of this already exists.** `consoleInventory()`
(`privilegeMcpClient.js:1808-1836`) already reads
`GET /api/{envId}/v1/applications` from the Privilege console API and returns,
per app: `name`, a derived `mcpUrl` (`<gateway-origin>/<name>/mcp`),
`frontEndName`, `backends`, `entryPath` and `status`. It is already exposed as
`POST /console/connect` and `GET /console/inventory`, and the page already calls
both. The inventory is simply **not wired to the Door picker**.

**The work:**

1. Populate the Privilege- and Façade-mode Door pickers from
   `consoleInventory().applications`, falling back to today's constants when no
   inventory is available. The façade's `privilege-gateway` door is already
   `multiApp`, so `/mcp-facade/privilege-gateway/<app>/mcp` needs no change —
   only the list of `<app>` values does.
2. A visible **Refresh from Privilege** control on the page, reporting how many
   apps and policies came back.
3. **Persist the discovered list** (configStore), because the console credential
   is an operator-pasted `auth_token` cookie valid roughly 60 minutes. The doors
   must outlive it; only re-discovery needs the token.
4. Surface each app's `status` and whether a policy mentions it — the inventory
   already returns both, and a lapsed policy is the most common cause of a 403
   that looks like misconfiguration.

**Known ceiling, stated rather than designed around:** discovery cannot be fully
automatic. The console API takes a pasted browser cookie, not a service
credential, so "refresh" is an operator action. That is acceptable for adding an
app; it must not be on the path of serving one — hence persistence in step 3.

**Also resolves** the `mcp-brave-search`-vs-`brave` discrepancy in §2.3: the
inventory is authoritative, and the probe is not.

### W7 — The `DELETE` bug (§2.6)

Register the route for the multi-app path, honour `req.params.app`, and use the
gateway token when the door sets `ownsUpstreamAuth`. Small, and it is in a file
W2 and W3 already touch.

---

## 6. Sequencing

```
W1 (preflight)
  ├─> W8 (door discovery from Privilege)  ─┐
  ├─> W2 (session visibility)             ─┤
  ├─> W6 (config) ─> W5 (LLM panel + OpenAI) ─┤
  └─> W3 (banking Agentic App)            ─┤
                                           └─> W4 (LM Studio GUI proof = gate)
W7 folds into whichever of W2/W3/W8 lands first.
```

W8 should land **before** W3: once the door list comes from the console
inventory, registering the banking app makes it appear with no further code
change — which is also the proof that W8 works. W5 is independent of all of
them. W4 is last because it proves the whole matrix in §3.

---

## 7. Success criteria

The work is done when, on both targets:

1. `npm run demo:preflight -- --target se` and `--target local` both exit 0 with
   every row green.
2. Every cell in the §3 matrix is proven by a real call returning real data.
3. Every LM Studio entry in `lmstudio/mcp.json` works in the GUI, first try,
   from a clean install.
4. The gateway session state is visible on the page and recoverable in one
   click, and a BFF restart followed by a re-arm restores the façade door.
5. A fresh clone plus documented setup reproduces the Privilege LLM panel
   without hand-patching a secret.
6. The banking tools are reachable identically through Direct, Privilege and
   Façade.
7. **Adding a new Agentic App in the Privilege console makes it appear as a
   selectable door after one "Refresh from Privilege" click, with no code
   change, no env var and no redeploy** — and the door survives the console
   token expiring. Registering the banking app (W3) is the live test of this.

Non-negotiable evidence rule: each criterion is met by a pasted command result,
not an assertion. Piped commands do not prove exit status — redirect to a file
and read it, or check `${PIPESTATUS[0]}`.

---

## 8. Risks, dependencies and open questions

**Dependencies the user must supply:**

- Privilege console access to create the banking Agentic App and its policy (W3).
- An OpenAI virtual key from the Privilege console (W5).

**Risks:**

- **Console-created objects are fragile.** The `Add Application → MCP Server`
  flow is the only one that produces a working `FrontEndName`; a repurposed app
  fails permanently and misleadingly.
- **Policies are time-boxed.** A demo that worked last week can 403 today with
  no code change. Preflight catches it; a runbook entry should name it.
- **The gateway's in-memory DCR registry** means a gateway restart breaks
  standalone MCP clients irrecoverably from the client side. W2 mitigates the
  BFF half; the LM Studio half still needs a remove-and-re-add, which W4's
  README must state plainly.
- **Cross-namespace dependency** (§4.1) has no NetworkPolicy protecting or
  documenting it.

**Open questions, to resolve during implementation rather than blocking:**

- Does the SE deploy path ever `kubectl replace` (rather than patch) the
  `ai-demo-secrets` secret? If so, hand-patched keys are lost on deploy and W6
  becomes urgent rather than hygienic.
- Which banking MCP server should back the new Agentic App — `oauth-mcp`
  (`mcp-server:8080`) or the Node gateway — given the gateway registers an SSE
  backend?

---

## 9. Out of scope

- **The Privilege transport itself.** The agent-based deployment with OAuth
  retained works; the user has said explicitly not to change it. No workstream
  here touches the gateway, its chart, its mode, or the OAuth dance.

- Changing any frozen LLM setting (resident tiers, `LLAMACPP_MAX_TOKENS`,
  `REASON_LOOP_TIMEOUT_MS`, `reasoning_effort`). None of this work requires it.
- The `agent` and `agent-cmuir` façade doors. They need inbound mesh exposure
  the AI Gateway chart does not ship. They stay dark; W4 removes them from the
  LM Studio config rather than fixing them.
- LibreChat. It shares the façade and should keep working, but proving it is not
  part of this deliverable.
- Persisting the Privilege gateway token (§5, W2).
