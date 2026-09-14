# AI Demo FAQ

Answers for presenters, SEs and developers working with the Super Banking AI demo. For the one-hour overview, see the slide deck: [docs/resources/AI-Demo-Overview.pptx](resources/AI-Demo-Overview.pptx).

- [Download and install](#download-and-install)
- [Starting the demo](#starting-the-demo)
- [Settings that matter, and the ones that break things](#settings-that-matter-and-the-ones-that-break-things)
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
curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-DEMO2/main/install.sh | bash
```

Add `ASSUME_YES=1` before `bash` to skip the prompts; the installer then defaults to local mode.

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

You are probably on `api.ping.demo:4000`. That address serves the same app, but the session cookie and the passkey `rp.id` belong to `local.ping-devops.com`, so sign-in never sticks. Use `https://local.ping-devops.com:4000`. Some older docs still show the `api.ping.demo` address.

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
