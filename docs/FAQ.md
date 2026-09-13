# AI Demo FAQ

Answers for presenters, SEs and developers working with the Super Banking AI demo. For the one-hour overview, see the slide deck: [docs/resources/AI-Demo-Overview.pptx](resources/AI-Demo-Overview.pptx).

- [Download and install](#download-and-install)
- [Starting the demo](#starting-the-demo)
- [Settings that matter, and the ones that break things](#settings-that-matter-and-the-ones-that-break-things)
- [Which PingOne app does what](#which-pingone-app-does-what)
- [Other things you need to know](#other-things-you-need-to-know)
- [Lessons learned](#lessons-learned)

---

## Download and install

### Where are the full install directions?

| If you want… | Read |
| --- | --- |
| The quickest path on a new Mac | [README.md — Quick Start](../README.md#-quick-start-brand-new-machine) |
| A step-by-step walkthrough | [docs/user-guide/getting-started.md](user-guide/getting-started.md) and [docs/user-guide/SETUP.md](user-guide/SETUP.md) |
| Setting up a second machine | [NEW-MACHINE.md](../NEW-MACHINE.md) |
| Docker details | [DOCKER_STARTUP.md](../DOCKER_STARTUP.md) |
| Every deployment mode | [docs/user-guide/deployment.md](user-guide/deployment.md) |
| The Ping SE Kubernetes cluster | [docs/user-guide/PING-SE-K8-RUNBOOK.md](user-guide/PING-SE-K8-RUNBOOK.md) |

### What's the one-line install?

```bash
curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-DEMO2/main/install.sh \
  | REPO_URL=https://github.com/curtismu7/AI-DEMO2.git bash
```

Set `REPO_URL` as shown. `install.sh` and the README still point at the old `curtismu7/AI-demo` repository, which no longer resolves, so the command as printed in the README fails. Add `ASSUME_YES=1` before `bash` to skip the prompts; the installer then defaults to local mode.

The installer asks how you want to run the demo:

1. Local
2. Local Kubernetes (OrbStack)
3. The Ping SE cluster
4. EKS

It then installs the tools that mode needs (Homebrew, git, Node, Python, Docker or OrbStack, mkcert, llama.cpp), clones the repo, generates TLS certificates and provisions PingOne.

### I'd rather clone it myself

```bash
git clone https://github.com/curtismu7/AI-DEMO2.git
cd AI-DEMO2
npm run setup:fresh   # provisions PingOne apps, scopes, resources and demo users; writes the .env files
```

`npm run setup:fresh` changes a live PingOne environment. It is safe to re-run and doesn't wipe anything, but read the script before pointing it at an environment other people use.

### What do I need that the installer can't create?

- **A PingOne Worker app** with the *Identity Data Admin* role. The installer asks for its environment ID, client ID and client secret.
- **An LLM (optional).** Without one, the agent runs in heuristics-only mode: chips work, free-form questions don't. See [README — Configure the AI agent](../README.md#configure-the-ai-agent-helix).

### What versions do I need?

- **Node 22 or later.** Every `package.json` declares `"node": ">=22"`. Some older docs still say Node 20.
- **Python 3.11 or later**, for the Python agents.
- **Docker Desktop or OrbStack.** Even local mode uses Docker to run PingGateway.
- **mkcert**, for local HTTPS.

---

## Starting the demo

### One-time setup on each machine

```bash
mkcert -install
echo '127.0.0.1  local.ping-devops.com api.ping.demo' | sudo tee -a /etc/hosts
```

Neither hostname is in public DNS, so both need the hosts entry. The installer generates certificates for them but does not edit `/etc/hosts`.

### Which command starts it?

| Where | Command | Notes |
| --- | --- | --- |
| Your laptop, Docker (lean core) | `./run-docker.sh` | Stops everything, then starts the core stack plus Code Search. `./run-docker.sh start full` starts every service. |
| Your laptop, native processes | `./run.sh` | Also `stop`, `restart`, `status`, `tail`. PingGateway still runs in Docker. |
| Local Kubernetes (OrbStack) | `./run-k8.sh` | `./run-k8.sh aws-all` targets EKS. |
| Ping SE cluster | `./run-pingaws.sh` | Serves `https://ai-demo.ping-devops.com`. Shared with other SEs. |

Useful `run-docker.sh` commands:

- `status` and `logs [service]` to see what's running.
- `restart <service>` to restart one service.
- `stop` to stop the stack.
- `optional start|stop|status <group>` for the opt-in groups: `rag`, `agents`, `tracing`, `demo-auth`, `mcpgw`, `observability`.
- `demo-sync` to line the containers up with the admin Quick Flags.

### Which URL do I open?

| | URL |
| --- | --- |
| Web app | **<https://local.ping-devops.com:4000>** |
| API (BFF) | <https://api.ping.demo:3001> |
| Grafana (after `optional start observability`) | `/grafana` |

### Why does the app say "Please sign in" after I signed in?

You are probably on `api.ping.demo:4000`. That address serves the same app, but the session cookie and the passkey `rp.id` belong to `local.ping-devops.com`, so sign-in never sticks. Use `https://local.ping-devops.com:4000`. Some older docs, including the README, still show the `api.ping.demo` address.

For automated tests, point `E2E_BASE_URL` at `local.ping-devops.com` too. Otherwise every `*.real.spec.js` returns 401, which looks like broken auth.

### The agent only lists its capabilities, or says "Heuristics-only mode — no LLM"

The agent can't reach a model.

- The local LLM proxy listens on `:8090`, and `LLM_BACKEND` chooses the backend: `llamacpp` by default, or `omlx` on Apple Silicon.
- Check that the proxy and its model server are running.
- Chips keep working without a model; free-form questions don't.

### Which vertical should I use?

Any of the 11 works, and you can switch in the app. Use **Super Sports** for manual checks and tests unless you are testing something specific to another vertical.

---

## Settings that matter, and the ones that break things

Feature flags live in `FLAG_REGISTRY` in [demo_api_server/routes/featureFlags.js](../demo_api_server/routes/featureFlags.js), with defaults in [demo_api_server/services/configStore.js](../demo_api_server/services/configStore.js). Change them on the admin Feature Flags page.

### Flags that remove a security control

Never leave these on after a demo.

| Flag | Default | What happens when you turn it on |
| --- | --- | --- |
| `ff_authorize_fail_open` | OFF | Calls are **allowed** whenever PingOne Authorize can't be reached, on every path. |
| `ff_skip_token_exchange` | OFF | The raw user token goes to the tools. There's no `act` claim, so the delegation story disappears. |
| `ff_local_fallback_on_exchange_failure` | OFF | If the token exchange fails, tools run **without authorization** (results are tagged `_degraded`). |

### Flags that change what the demo shows

| Flag | Default | Effect |
| --- | --- | --- |
| `ff_mcp_gateway_pinggateway` | ON | PingGateway is the MCP gateway. OFF switches to the Node gateway: run `./run-docker.sh optional start demo-auth` and then `./run-docker.sh demo-sync`. |
| `ff_authorize_real` | ON | Real PingOne Authorize. OFF uses the local mock engine. |
| `ff_hitl_enabled` | ON | Human approval for transfers. OFF removes the consent moment. |
| `ff_prompt_injection_guard` | ON | Blocks common prompt-injection patterns before the model sees them. |
| `ff_heuristic_enabled` | ON | Known chips answer from fast heuristics. OFF means "LLM first", with heuristics kept only as a safety net. |
| `step_up_enabled` | OFF | Step-up MFA for high-value transactions (UC7). |
| `ciba_enabled` | OFF | Out-of-band approval on the user's phone (UC22). |
| `ff_rar` | OFF | Intent binding (UC14, UC14b). The amount cap also needs the `RarMaxAmount` rule imported into PingOne Authorize. |
| `ff_dpop` | OFF | Binds tokens to a key for the replay demo (UC12). |
| `ff_mcp_gateway_jwks` | OFF | ON validates tokens locally with JWKS instead of introspection. It's faster but can't see revoked tokens. |
| `ff_mcp_gateway_privilege_first` | OFF | Puts the PingOne Privilege AI Gateway in front of the Agent Gateway. SE cluster only. |
| `ff_knowledge_grounding` | OFF | Grounds the agent's answers in the citable facts in `graphify-out/banking-domain.kb.json`. |

### "I flipped the flag and nothing changed"

Some flags are pinned by an environment variable (for example `FF_MCP_GATEWAY_PINGGATEWAY`). While the variable is set, the UI toggle has no effect. After switching gateways, run `./run-docker.sh demo-sync` so the containers match.

### Environment switches (not flags)

- **`LLM_BACKEND`:** `llamacpp` (default) or `omlx` (Apple Silicon). Selects the model server behind the LLM proxy on `:8090`.
- **`MCP_MTLS_ON`** (root `.env`): unset means plaintext between gateway and MCP servers; `1` means mTLS. There is no runtime toggle. Recreate `mcp-server`, `ping-gateway`, `mcp-gateway` and `demo-api-server` after changing it.
- **`authorize_mode`:** `pingone`, `simulated` or `pingone_with_fallback`.

---

## Which PingOne app does what

When something breaks, find the symptom, then open that app in the PingOne console. App names below are exactly as they appear in the console, in the main demo environment (`01d89b06`) unless noted.

The mapping comes from the code, and the app names were checked against the environment's app list on 2026-09-13. The running demo's configured client IDs were not checked, so where a config key has fallbacks, confirm which client ID is actually set before assuming.

### Start from the symptom

| You see | Open this PingOne app | Read from |
| --- | --- | --- |
| Customer can't sign in, or keeps landing back on sign-in | Demo AI App - User Login | `PINGONE_USER_CLIENT_ID` (also check you're on `local.ping-devops.com:4000`) |
| Admin can't sign in | Demo AI App - Admin Login | `PINGONE_ADMIN_CLIENT_ID` |
| Agent tool call fails at token exchange (`invalid_client`) | Demo AI App - AI Agent Actor, then Demo AI App - Token Exchanger | `PINGONE_AI_AGENT_ACTOR_CLIENT_ID`, `PINGONE_TOKEN_EXCHANGER_CLIENT_ID` |
| PingGateway rejects the agent's token (401, token inactive) | Demo AI App - Token Exchanger (PingGateway introspects with it) | `INTROSPECT_CLIENT_ID`, a copy of the exchanger |
| Tool call fails after the gateway hop (401 or 502) | Demo AI App - MCP Gateway; for banking tools, also Demo AI App - MCP Step 9 Exchanger | `PINGONE_MCP_GATEWAY_CLIENT_ID` / `TE_CLIENT_ID`, `PINGONE_MCP_EXCHANGER_CLIENT_ID` |
| PingOne Authorize decisions fail, "Missing PingOne worker credentials", or UC1 "Incomplete" after a secret rotation | Demo AI App - Introspection Worker (the operator worker) | `PINGONE_WORKER_CLIENT_ID`, copied to `P1AZ_WORKER_CLIENT_ID` |
| CIBA approval (UC22) won't start | Demo AI App - Admin Login: the environment has no dedicated CIBA app, so CIBA falls back to it | `PINGONE_CIBA_CLIENT_ID` if set, otherwise `PINGONE_ADMIN_CLIENT_ID` |
| Agent-to-agent handoff 401s with an audience mismatch | That vertical's *Specialist Agent* app (banking: Demo AI App - Investment Advisor Agent) | `PINGONE_A2A_<KEY>_AGENT_CLIENT_ID` |
| Enterprise-managed MCP (UC25, UC39, UC40) fails at sign-in | Demo AI App - Enterprise IdP Federation | `ENTERPRISE_IDP_PINGONE_CLIENT_ID` |
| The DaVinci SDK login page fails | Demo AI App - DaVinci SDK Login | `PINGONE_DAVINCI_LOGIN_APP_ID` |
| Claude Code's banking-gateway login fails | Claude Code - Banking Gateway | `GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID` (pinned in `docker-compose.yml`) |
| Grafana's PingOne sign-in fails (local admin still works) | Demo AI App - Grafana Login | `GRAFANA_PINGONE_CLIENT_ID` (default pinned in `docker-compose.yml`) |
| A Management API call fails | Check `PINGONE_MGMT_*` / `PINGONE_MANAGEMENT_*` first. If those are unset, the call uses Demo AI App - Admin Login **before** the worker. | See `pingone_mgmt_client_id` in `services/configStore.js` |
| Privilege AI Gateway sign-in fails with `invalid_client` | The gateway's OIDC client in the Privilege tenant (`0428ba4f`), not this environment | `PRIVILEGE_SSO_CLIENT_ID`; the vault holds the real secret |

### Every app the demo uses

| PingOne app | What it's for | Config keys | Used by |
| --- | --- | --- | --- |
| Demo AI App - User Login | Customer sign-in (authorization code + PKCE) | `PINGONE_USER_CLIENT_ID` | BFF |
| Demo AI App - Admin Login | Admin sign-in; CIBA fallback; Management API fallback | `PINGONE_ADMIN_CLIENT_ID` | BFF |
| Demo AI App - AI Agent Actor | The agent's identity: actor in exchange #1, and the PAR client for intent binding | `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` (aliases `PINGONE_AI_AGENT_CLIENT_ID`, `AI_AGENT_CLIENT_ID`) | BFF, langchain-agent |
| Demo AI App - Token Exchanger | Performs the RFC 8693 exchanges for the gateway audience; PingGateway introspects with it | `PINGONE_TOKEN_EXCHANGER_CLIENT_ID` (falls back to `PINGONE_MCP_TOKEN_EXCHANGER_*`, `PINGONE_MCP_EXCHANGER_*`, `AGENT_OAUTH_CLIENT_*`) | BFF, PingGateway, banking MCP server, Node gateway, Authorize mock |
| Demo AI App - MCP Gateway | The gateway's own identity; exchanges to the MCP server audience | `PINGONE_MCP_GATEWAY_CLIENT_ID`, `MCP_GW_CLIENT_ID`, `TE_CLIENT_ID` | PingGateway, Node gateway, BFF |
| Demo AI App - MCP Step 9 Exchanger | The banking MCP server's exchange to the banking API | `PINGONE_MCP_EXCHANGER_CLIENT_ID` | Banking MCP server (`oauth-mcp`) |
| Demo AI App - *\<name\>* Specialist Agent, and Demo AI App - Investment Advisor Agent (11 apps in all) | Agent-to-agent specialists, one per vertical | `PINGONE_A2A_<KEY>_AGENT_CLIENT_ID` | BFF |
| Demo AI App - Introspection Worker | The operator worker: PingOne Authorize calls, user and group lookups, provisioning, Management API | `PINGONE_WORKER_CLIENT_ID` (or `PINGONE_AUTHORIZE_WORKER_CLIENT_ID` if set); copied to `P1AZ_WORKER_CLIENT_ID` | BFF, PingGateway, Authorize mock |
| Demo AI App - Enterprise IdP Federation | The demo enterprise IdP for enterprise-managed MCP authorization | `ENTERPRISE_IDP_PINGONE_CLIENT_ID` | BFF (`routes/enterpriseIdp.js`) |
| Demo AI App - DaVinci SDK Login | Public PKCE client for `/davinci-sdk-login` | `PINGONE_DAVINCI_LOGIN_APP_ID` | BFF, web app |
| Claude Code - Banking Gateway | Public PKCE client for Claude Code and IDE MCP clients | `PINGONE_GATEWAY_MCP_OAUTH_CLIENT_ID`, `GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID` | Node gateway OAuth broker, `.mcp.json` |
| Demo AI App - Grafana Login | Grafana single sign-on | `GRAFANA_PINGONE_CLIENT_ID` | Grafana |
| LibreChat Local Login - exploratory | LibreChat sign-in. A bad secret locks everyone out when auto-redirect is on. | `OPENID_CLIENT_ID` in `librechat/.env` | LibreChat |
| Demo AI App - Onyx | Onyx sign-in, and its MCP action to PingGateway | Onyx's own config (`~/.config/onyx`), not this repo | Onyx |
| Demo AI App - Agent Actor | Worker identity for the agent service; docs disagree on whether any exchange still uses it | `PINGONE_AGENT_CLIENT_ID` | agent-service |
| Demo AI App - Fraud Watch Agent, Demo AI App - Balance Sweep Agent | Autonomous agent identities (client credentials) | `PINGONE_FRAUD_WATCH_AGENT_*`, `PINGONE_BALANCE_SWEEP_AGENT_*` | Privilege banking backend experiments |
| Demo AI App - MCP Server Client | Banking MCP server identity; no runtime use found | none | — |
| Demo AI App - MCP External Client | Federation hop for external MCP client doors, per `docs/superpowers/plans/2026-08-23-external-door-token-chain-bridge.md`; no code reference found | — | — |
| Demo AI App - Privilege Tenant Federation | The identity provider behind Privilege AI Gateway sign-in | none in this repo | Privilege gateway federation |

Apps you can usually ignore when debugging the demo:

- **Developer tooling:** PingOne MCP Server and the PingOne MCP Server Claude Code, Cursor and VS Code workers (IDE access to the hosted PingOne MCP), and the two *Super Banking Worker* apps.
- **System apps:** PingOne DaVinci Connection, PingOne Helix Connection, the two `…_agent` Helix workers, PingID Desktop Gen2, PingOne Admin Console, Application Portal, Self-Service, and Getting Started Application (disabled). Don't modify these.
- **No code reference found:** Demo AI App - PKCE, MCP Gateway - cmuir agentless, Privilege Cloud MCP Gateway, Sample Apps - Native Flow.
- **`ai-demo-bff-audit`:** not a runtime dependency. Its name collides with the Node gateway broker's static client ID, which lives in `docker-compose.yml`, not in PingOne.

Outside this environment:

- **Privilege tenant `0428ba4f`:** the gateway's OIDC client. It is read from `PRIVILEGE_SSO_CLIENT_ID`, and the vault is the source of truth for its secret.
- **The "PingOne Privilege" app (`a6219652…`):** owned by the Privilege service. **Never rotate its secret**: the Privilege console signs in through it, and one copy can't be updated.
- **Copilot Studio broker:** `agent_token_service/.env` reuses the variable name `PINGONE_AGENT_CLIENT_ID` for a different app.

### Demo Steps and the PingOne apps they touch

Most chip steps run the same **standard chain**:

1. Demo AI App - User Login issues the customer's token.
2. Demo AI App - AI Agent Actor is the actor in exchange #1.
3. Demo AI App - Token Exchanger performs exchange #2 to the gateway audience.
4. Demo AI App - MCP Gateway is PingGateway's identity for its exchange to the tool server.
5. Demo AI App - Introspection Worker calls PingOne Authorize, from both the BFF and PingGateway.

These are the 24 Demo Steps the agent shows for every customer vertical, in order.

| # | Step | Gate | Flag | What it demonstrates | PingOne apps |
| --- | --- | --- | --- | --- | --- |
| 1 | UC24 Public catalog access | public | — | Public tool, no token | None |
| 2 | UC1 Delegated access with proof | user | `ff_mcp_gateway_pinggateway` | Two RFC 8693 exchanges and an Authorize permit | Standard chain |
| 3 | UC8 Human-in-the-loop consent | user | `ff_mcp_gateway_pinggateway` | Authorize asks for consent ($300); single-use receipt | Standard chain (the HITL service is local, not PingOne) |
| 4 | UC7 Step-up required | user | `ff_mcp_gateway_pinggateway` | Authorize requires step-up, then PingOne MFA | Standard chain, plus PingOne MFA (the MFA client wasn't traced) |
| 5 | UC14b Intent verified (PAR + RAR) | user | `ff_rar` | Pushed intent within the cap | AI Agent Actor (the PAR push), PingOne Authorize |
| 6 | UC14 Intent violation (PAR + RAR) | user | `ff_rar` | Over the cap, Authorize denies | Token Exchanger, Introspection Worker (Authorize) |
| 7 | UC12 Token theft / replay | user | `ff_dpop` | A replayed session token is rejected at the gateway (the simulation sends no DPoP proof) | User Login |
| 8 | UC6 Authorization denied | user | `ff_mcp_gateway_pinggateway` | Authorize denies a $2,500 transfer | Standard chain |
| 9 | UC2 Agent-to-agent delegation | user | `ff_mcp_gateway_pinggateway` | Nested `act` chain across two hops | User Login, AI Agent Actor, that vertical's Specialist Agent, Introspection Worker (Authorize checks the chain) |
| 10 | UC2.5 A2A orchestrator | user | `ff_mcp_gateway_pinggateway` | The orchestrator picks a specialist, then the UC2 chain runs | Same as UC2 |
| 11 | UC2.7 A2A protocol and identity | public | — | Agent Card and JSON-RPC; the UC2 chain once signed in | None when signed out; the UC2 apps when signed in |
| 12 | UC22 CIBA approval | user | `ciba_enabled` | Authorize step-up approved on the user's phone | Standard chain, plus the CIBA client (Admin Login in this environment) |
| 13 | UC5 Insufficient scope | user | — | Read-only token; the gateway returns 403 | Token Exchanger |
| 14 | UC10 Another user's account | user | — | Authorize denies on resource ownership | Standard chain |
| 15 | UC13 Confused-deputy actor | user | — | A rogue actor is injected; Authorize denies | Standard chain |
| 16 | UC11 Bad client at the gateway | user | — | Wrong audience; the gateway returns 401 | User Login (the exchange client wasn't traced) |
| 17 | UC20 Audit trail | user | `ff_mcp_gateway_pinggateway` | The UC1 chip with evidence tagging | Standard chain |
| 18 | UC18 Rate-limit defense | user | — | A burst of calls; the gateway returns 429 | Token Exchanger |
| 19 | UC30 Third-party MCP permitted | public | — | PingGateway policy permits the call | None (the weather route has no OAuth) |
| 20 | UC31 Third-party MCP denied | public | — | PingGateway policy denies the call | None |
| 21 | UC32 Live-reconfigure the gateway policy | public | — | An admin setting the gateway reads live | None |
| 22 | UC40 Enterprise-managed MCP (ID-JAG) | public | `ff_enterprise_managed_mcp_auth` | The demo IdP signs the grant (ID-JAG is mocked) after a group check | Enterprise IdP Federation, Introspection Worker (group lookup) |
| 23 | UC38 Personal Agent Concierge | user | `ff_personal_agent_concierge` | MFA, a registered agent, then an exchange | User Login, Introspection Worker (creates the agent app); the exchange client wasn't traced |
| 24 | UC-TOOL1 Protected RAG | user | `ff_mcp_gateway_pinggateway` | `code:search` exchange and an Authorize permit | Standard chain |

The PingOne Admin vertical's steps (ADMIN1–13) sign in with PingOne's built-in `pingone-mcp-server` client, which isn't an app in your environment, and call the hosted PingOne MCP server. None of them go through the gateway or Authorize.

| Steps | What they do | Fallback when the hosted MCP call fails |
| --- | --- | --- |
| ADMIN1–4, ADMIN9 | List applications, users and populations; get the environment and its services | Management API with Demo AI App - Introspection Worker |
| ADMIN5–6 | Search users or applications by name prefix | Opens a filter first; same hosted tools as ADMIN1–2 |
| ADMIN7–8 | List the PingOne MCP tools; show resources and their scopes | Scopes come from the Management API with the Introspection Worker |
| ADMIN10–12 | List DaVinci flows, applications and connectors | None |
| ADMIN13 | Govern PingOne MCP with Privilege (a link to `/privilege-mcp-client`) | Not traced; see the Privilege tenant above |

The other 38 use cases in `demo_api_server/config/useCases.js` aren't Demo Steps. Most of them run the standard chain.

---

## Other things you need to know

### Scripts that change shared things

- **PingOne lifecycle scripts** change a live PingOne environment: `npm run setup:fresh`, `pingone:bootstrap`, and the import, export and reset scripts. Read them before running.
- **`./run-pingaws.sh undeploy`** deletes the workloads *and secrets* inside the shared SE namespace, for everyone using it.

### Working in the repo

- **Never run `docker compose up` from a git worktree.** A worktree has no `.env` files. Services start unconfigured while PingGateway still reports healthy. To try worktree code in the running stack, use `npm run serve:worktree here`, and hand it back with `npm run serve:worktree main`.
- **A merged PR doesn't change the running demo until the main checkout syncs.** Docker bind-mounts the main checkout's files. A launchd job syncs every 15 minutes; `scripts/sync-main-checkout.sh` does it now, and `npm run sync:status` shows whether it's stale.
- **Several sessions can share one stack.** Before and after a live UI run, pin the stack generation with `npm run -s stack:generation`. If the check fails, a container was recreated mid-run and the result doesn't count.

### Parts of the demo that aren't what they look like

- **Protocol Playground:** the PKCE, PAR and DPoP steps on `/protocol-playground` are self-contained teaching mocks; they make no PingOne call. The real flows run elsewhere in the app.
- **ID-JAG:** PingOne doesn't issue native ID-JAG yet. The ID-JAG demo route is a mock, and the enterprise MCP use cases use RFC 8693 as a stand-in.
- **Needs-build use cases:** UC15 (intent-token tampering) and UC29 (introspection fail-closed) are still marked needs-build in the catalog.
- **Flag-gated use cases:** several use cases only work with their flag on, including UC9, UC12, UC14, UC22, UC25, UC37, UC38, UC39 and UC40. Each use case's doc in [docs/use-cases/](use-cases/) names its flag.
- **Alerts:** Alertmanager receives alerts, but its default receiver does nothing. Alerts show as firing in Grafana and nobody is paged.

---

## Lessons learned

These are the lessons that shaped the design, each with its source.

### Authorization architecture

- **The gateway enforces; it doesn't decide.** It owns no tools and makes no policy calls of its own. PingOne Authorize decides, and the gateway carries out the result. ([ARCHITECTURE-TRUTHS T-1, T-2](ARCHITECTURE-TRUTHS.md))
- **Identity comes from a PingOne-issued token, never from something the client says.** PingOne performs token exchange; the gateway, agents and MCP servers only ask for it. ([T-4](ARCHITECTURE-TRUTHS.md))
- **Every hop checks the audience itself.** A validated token doesn't vouch for the next hop. One missing entry in the gateway's anti-bypass list was a real bypass. ([T-5](ARCHITECTURE-TRUTHS.md))
- **Keep one source of truth for authorization.** A local scope-to-tool map drifted away from the real policy and was deleted in favour of PingOne Authorize. ([ADR 0003](adr/0003-pingauthorize-is-sole-bff-tool-gate.md))
- **Tokens stay on the server, and the model never sees them.** The browser gets a cookie; the model gets the tools offered for that run, with tokens stripped from results. ([ADR 0006](adr/0006-bff-only-token-custody.md), [REGRESSION_PLAN.md §1](../REGRESSION_PLAN.md))
- **A shortcut can route a request, but never authorize it.** Heuristic write operations still go through the MCP pipeline. ([T-11](ARCHITECTURE-TRUTHS.md))
- **Introspection versus JWKS is a real trade-off.** JWKS is faster but blind to revocation, so the choice is a runtime switch, and only read-only tools skip introspection. ([ADR 0005](adr/0005-runtime-switchable-token-validation-mode.md), [ADR 0002](adr/0002-mcp-resource-server-skips-token-introspection.md))

### PingOne specifics

- **A PingOne token request covers exactly one resource.** Every requested scope must live on the target audience's resource. If you leave `scope` out, PingOne tries every granted scope and fails. ([T-10](ARCHITECTURE-TRUTHS.md))
- **Pick one client authentication method and keep exceptions explicit.** Mixing `client_secret_post` and `basic` broke token exchange. ([T-9](ARCHITECTURE-TRUTHS.md))
- **Agent-to-agent calls lack proof-of-possession for now,** because PingOne can't yet issue sender-constrained tokens for that hop. This is tracked, not hidden. ([TECH_DEBT.md, 2026-09-11](../TECH_DEBT.md))
- **The hosted PingOne MCP server needs per-environment setup that fails silently.** Without an MCP-audience resource, PingOne mints a token for the wrong audience instead of erroring, and the result looks like a credentials problem. ([privilege/LESSONS-LEARNED.md](../privilege/LESSONS-LEARNED.md))

### MCP gateways and PingOne Privilege

- **Privilege policies add up; they don't replace each other.** A new, narrower policy leaves the older, broader one in force, so fix a policy by deleting the extras rather than adding another. ([privilege/LESSONS-LEARNED.md](../privilege/LESSONS-LEARNED.md))
- **The gateway forgets dynamically registered clients on restart.** Clients must detect this and re-register. ([privilege/LESSONS-LEARNED.md](../privilege/LESSONS-LEARNED.md))
- **"Allowed" doesn't mean "not detected."** Only Block verdicts reach the caller; Alert and Sanitize verdicts appear on the gateway dashboard. The output scanners also need a model that actually produces bad content before they have anything to catch. ([privilege/LESSONS-LEARNED.md](../privilege/LESSONS-LEARNED.md))
- **Health signals can all be green while nothing works.** The only trustworthy check is a real request through the path a caller uses. Floating `:latest` image tags make every restart an unplanned upgrade. ([privilege/LESSONS-LEARNED.md](../privilege/LESSONS-LEARNED.md))

### Operating the demo

- **A bug can hide behind another bug.** A single-worker queue masked three cross-session leaks; remove the mask only after fixing what it hides. ([T-8](ARCHITECTURE-TRUTHS.md))
- **A piped command's exit code belongs to the last command in the pipe.** `deploy | tail` reports success even when the deploy failed, so check `${PIPESTATUS[0]}` or read a log file. ([CLAUDE.md](../CLAUDE.md))
