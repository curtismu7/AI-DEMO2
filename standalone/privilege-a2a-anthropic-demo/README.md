# Privilege A2A Anthropic demo

Three Node processes demonstrate an access review through A2A and MCP, on
Anthropic or Google models. The main agent owns the browser conversation and delegates to the worker.
The worker owns the access-review tools and calls the separate MCP process.

```text
AI Guard Client A2A tab ──SSE──▶ BFF :3001 ──▶ main agent :3300
                                                   ├──A2A JSON-RPC──▶ worker :3301
                                                   └──Anthropic Messages API──▶ Privilege
                                                          worker ├──Anthropic Messages API──▶ Privilege
                                                                 └──MCP Streamable HTTP──▶ MCP :3302
```

The A2A boundary carries the analyst's question and result, with a fresh random
context ID for each chat turn so concurrent worker traces stay isolated. The
main agent uses the opaque browser session ID only for its in-memory
conversation history. Neither ID represents an authenticated user. The A2A
boundary does not carry a browser token, user `sub`, `act`, or an RFC 8693 token
exchange. Privilege validates each Agent Access key and applies its configured
policies.

## How it works through the gateway

In gateway mode every hop goes through the PingOne Privilege AI Gateway, and
each agent presents only its own agent key:

```text
main agent ──① A2A message/send (main key) ──▶ gateway ──▶ worker agent
main agent ──② model call (main key) ────────▶ gateway ──▶ model provider
worker     ──③ model call (worker key) ──────▶ gateway ──▶ model provider
worker     ──④ MCP tools/call (worker key) ──▶ gateway ──▶ MCP server
```

What the gateway does on each leg:

| Leg | Checks | What it can refuse or change |
|---|---|---|
| ① A2A | key, `a2a` scope, policy for the remote agent, guardrail | an ungranted agent (`403`), a prompt-injection message (`400`) |
| ②③ model | key, `llm` scope, allowed model, limits | a model outside the key's list (`403`); swaps in the real provider key |
| ④ MCP | key, `mcp` scope, per-tool grant, guardrail | an ungranted tool (`403`); redacts personal data in a result; blocks a result that carries hidden instructions |

The three-deep chain (`POST /chain`) adds a middle agent: main agent → gateway →
LangChain agent → gateway → specialist. The middle agent calls with its own key,
so its hop is checked on its own.

## Set up on Privilege, in order

This is the order that worked end to end. Apps first, because an agent can only
select apps that already exist.

1. **Deploy the worker and MCP server** (`k8s/deployment.yaml`; see "Run worker
   and MCP in the cluster" below). They can also be registered before they run.
2. **Register two apps** (Agentic Apps → Add Application), on the mesh cluster of
   the gateway that serves traffic:
   - `workeragentdemo`: type **Remote Agent**, backend
     `http://workeragentdemo.<namespace>.svc.cluster.local`, path `/a2a`, Auth
     Mode None.
   - `mcpdemo`: type **MCP**, backend
     `http://mcpdemo.<namespace>.svc.cluster.local`, path `/mcp`, Auth Mode None.
3. **Create the worker's agent** (AI Gateway → Agent Registry → Add Agent): scopes
   `llm` + `mcp`, one allowed model, MCP Servers → `mcpdemo`, then **Configure
   Tools** and allow each tool. If the tool list is empty, save the `mcpdemo` app
   again to re-run discovery now that its backend is up.
4. **Create the main agent**: scopes `llm` + `a2a`, a different allowed model,
   Remote Agents → `workeragentdemo` (and the middle agent, for the chain).
5. **Store each key where its agent runs**: the main key in `.env` as
   `MAIN_AGENT_KEY`; the worker key in the `privilege-a2a-demo` Secret. Paste a
   key once: a doubled key is refused as `invalid virtual key`.
6. **Point the main agent at the gateway** in `.env`: `WORKER_A2A_URL` and
   `WORKER_TRACE_URL` to `https://<gateway>/workeragentdemo/a2a` and `/trace`,
   the provider base URL, and `MAIN_AGENT_MODEL` to the exact model ID allowed on
   its key.
7. **Turn on Discover A2A agent card** on `workeragentdemo` once it is running.

For the three-deep chain, also:

8. Give the middle agent its own agent (scope `a2a`, the specialists selected)
   **with a different custodian** from the main agent. Remote-agent grants follow
   the custodian, so two agents under one custodian can reach each other's agents.
9. Set `CHAIN_A2A_URL` to the middle agent's gateway route.

Check it with one question that is allowed (`Review Carol Nguyen's access`) and
one that reads the poisoned record (`What access does Dave hold?`, with
`MCP_DEMO_INJECTION=true`): the second should come back as blocked, and the MCP
server's log should show no `open_ticket` call.

## Requirements and local startup

Use Node.js 22 or later. Copy `config.example` to `.env`, set the Privilege
gateway URLs, Agent Access keys, model IDs, and shared BFF secret, then install
dependencies and start all three backend processes:

```bash
cp config.example .env
npm ci
npm run dev
```

The integrated client is at
<https://local.ping-devops.com:4000/privilege-mcp-client>. Select **A2A** in
Demo mode. The BFF must be running and configured as described below. To run
the three backend processes separately, use three terminals:

```bash
npm run mcp
npm run worker
npm run main
```

### Change the local ports

Update the three port values and the local service URLs together in `.env`.
For example, to use ports `3400`, `3401`, and `3402`:

```dotenv
MAIN_AGENT_PORT=3400
WORKER_AGENT_PORT=3401
MCP_SERVER_PORT=3402
WORKER_A2A_URL=http://127.0.0.1:3401/a2a
WORKER_TRACE_URL=http://127.0.0.1:3401/trace
MCP_URL=http://127.0.0.1:3402/mcp
```

Then run `npm run dev`. If the BFF is native, update its main-agent URL too:

```dotenv
# demo_api_server/.env
PRIVILEGE_A2A_MAIN_URL=http://127.0.0.1:3400
```

If the BFF is in Docker, use the host gateway URL shown below. If you only move
the main agent, update that URL in the BFF too.

Each process reads `.env`. Local listeners bind to loopback. The MCP server
seeds fictional users, grants, and resources; `open_ticket` writes to an
in-memory store that resets when the MCP process restarts. The optional native
browser page at <http://127.0.0.1:3300> is for standalone use only; leave the
BFF secret unset for its direct chat path. In the integrated setup, the A2A
tab calls the main agent only through the BFF.

### Connect the AI Guard Client BFF

Set the same random secret in the A2A package's `.env` and the BFF's
`demo_api_server/.env`. Keep both values server-side; the browser never receives
this secret or either agent's key.

```dotenv
# standalone/privilege-a2a-anthropic-demo/.env
A2A_BFF_SHARED_SECRET=<random-shared-secret>
MAIN_AGENT_HOST=127.0.0.1
MAIN_AGENT_PORT=3300

# demo_api_server/.env when the BFF runs natively
PRIVILEGE_A2A_MAIN_URL=http://127.0.0.1:3300
PRIVILEGE_A2A_BFF_SECRET=<same-random-shared-secret>
```

Generate a value with `openssl rand -hex 32`, then put that value in both
files. Restart the BFF after changing its environment. For a Docker BFF,
replace the BFF URL and main listener host as follows; the root Compose stack
already maps `host.docker.internal` to the host gateway:

```dotenv
# standalone/privilege-a2a-anthropic-demo/.env
MAIN_AGENT_HOST=0.0.0.0

# demo_api_server/.env used by the Docker BFF
PRIVILEGE_A2A_MAIN_URL=http://host.docker.internal:3300
PRIVILEGE_A2A_BFF_SECRET=<same-random-shared-secret>
```

Worker and MCP stay loopback-bound. The main process accepts chat only when
the BFF sends the shared secret. No Compose service or root startup change is
needed: start the three processes with `npm run dev` (or the three commands
above) and restart the existing BFF so it loads its two A2A environment values.

## Gateway configuration

### Prepare the Privilege agents

The supplied SE Agentic Demo Setup guide assumes the shared Privilege Endpoint
Controller is already configured and that you can connect to it (including MFA
if prompted). Follow the current Admin Console labels; the guide refers to
**AI Security → Agent Registry** (called **Agent Config** in older versions).

1. Confirm an Anthropic provider key is registered in Privilege and attached to
   the `llm/anthropic` route. The provider key stays in Privilege; never paste
   it into this demo's `.env`.
2. Configure the MainAgent entry for LLM access and remote-agent access to the
   WorkerAgent app. Create or copy its Agent Access virtual key with `llm` and
   `a2a` scopes, then set it as `MAIN_AGENT_KEY`.
3. Configure the WorkerAgent entry for LLM access and the MCP app. Associate
   the MCP app with its MCP Gateway policy, create or copy its Agent Access
   virtual key with `llm` and `mcp` scopes, then set it as `WORKER_AGENT_KEY`.
   Do not edit the shared WorkerAgent or MCP policy while other SEs are using
   the demo.
4. Set each process's Anthropic model ID to one allowed by that agent's
   Privilege policy. The gateway base URL ends in `/llm/anthropic`; the Anthropic
   SDK adds `/v1/messages`.

The key split follows the four-hop flow: MainAgent key for its LLM and outbound
A2A request; WorkerAgent key for its LLM and outbound MCP request. The MCP
backend can run beside the worker in the cluster, while the MainAgent runs
on the laptop and reaches the worker through Privilege. For that layout, set
the main process's `WORKER_A2A_URL` and `WORKER_TRACE_URL` to the worker app's
gateway routes, and set the worker's `MCP_URL` to the MCP app's gateway route.
The exact URL prefixes depend on the app names in the target controller.

The provided guide describes shared per-minute rate limits and budget limits
on the MainAgent. Treat those limits as shared live policy: check the current
policy before a demo, avoid deliberate budget exhaustion, and don't change
shared policy for a local run. A denied gateway request is reported in the
chat trace; rate and budget status codes are produced by the configured
Privilege policy.

The integrated demo defaults to port `3300` for MainAgent so it does not occupy
the AI-DEMO2 BFF's port `3001`. Keep the BFF-to-main URL and bind host paired as
described above when switching between native and Docker BFF operation.

**Google instead of Anthropic.** Each agent picks its provider with
`MAIN_AGENT_PROVIDER` and `WORKER_AGENT_PROVIDER` (`anthropic` by default, or
`google`), so the two agents can sit on different providers and different
model tiers. A Google agent calls Gemini's `generateContent` API: set
`GEMINI_BASE_URL` to `https://<gateway>/llm/google` and the agent's Privilege
key is sent as `x-goog-api-key`; leave it blank to call Google directly with
`GEMINI_API_KEY`. A Privilege agent key is tied to one provider, so an agent
set to `google` needs a key created with the Google provider. The Google path
returns each reply whole rather than token by token.

Set `ANTHROPIC_BASE_URL` to `https://<gateway>/llm/anthropic`. The Anthropic SDK
appends `/v1/messages`, so calls use Privilege's native
`/llm/anthropic/v1/messages` route and its Anthropic `anthropic-version` header.
In this mode, both agents send `Authorization: Bearer` with their own Agent
Access key. The app does not hold the Anthropic provider key; register that
provider key inside Privilege for the Anthropic route.

The model IDs are pinned independently for cost and policy visibility:

```bash
MAIN_AGENT_MODEL=claude-sonnet-5
WORKER_AGENT_MODEL=claude-opus-5
```

Set each to a concrete model permitted for its key in Privilege. There is no
cross-agent key fallback.

### Run worker and MCP in the cluster

Ping's reference demo runs these two on the gateway VM. Here they run as two
Deployments in the cluster instead ([k8s/deployment.yaml](k8s/deployment.yaml)),
so the gateway reaches each by its Service name rather than `localhost`.
Register both backends in PingOne Privilege, using the reference demo's names:

| App | Type | Backend URL | Entry path |
|---|---|---|---|
| `workeragentdemo` | Remote Agent | `http://workeragentdemo.<namespace>.svc.cluster.local` | `/a2a` |
| `mcpdemo` | MCP | `http://mcpdemo.<namespace>.svc.cluster.local` | `/mcp` |

Register the worker as a **Remote Agent** (Agentic Apps, Add Application), not
as an HTTP or MCP app: only Remote Agent apps appear in an agent key's Remote
Agents list, and an app registered as MCP gets an MCP `initialize` sent to its
`/a2a` path. Turn on **Discover A2A agent card** once the backend is running:
the worker serves its card at `/.well-known/agent-card.json` on the Backend
URL, and `WORKER_PUBLIC_URL` sets the address that card advertises.

Set the MCP backend's `AuthMode` to `none`. The gateway authenticates the
worker's Agent Access key before proxying the request.

Create the worker's Agent Access key with `llm` and `mcp` scopes and select
the `mcpdemo` app under the key's MCP Gateway configuration. The worker reuses
`WORKER_AGENT_KEY` for both its model call and its outbound MCP request, and
the manifest reads it from the `privilege-a2a-demo` Secret. Both of the
worker's outbound legs go back through the gateway:

```bash
GEMINI_BASE_URL=https://<gateway>/llm/google     # or ANTHROPIC_BASE_URL=https://<gateway>/llm/anthropic
MCP_URL=https://<gateway>/mcpdemo/mcp
```

Build the image for the cluster's CPU architecture, push it, create the
Secret, then `kubectl apply -f k8s/deployment.yaml`; the commands are at the
top of that file. For a purely local run, leave the defaults: all three
processes on loopback, no cluster needed.

### Run main agent on your laptop

Create the main Agent Access key with `llm` and `a2a` scopes. Associate it with
the worker app and select that app under the key's AI Gateway Remote Agents
configuration. The main process reuses `MAIN_AGENT_KEY` for its Anthropic call
and its A2A request to the worker.

Configure `.env` with the gateway URLs:

```bash
ANTHROPIC_BASE_URL=https://<gateway>/llm/anthropic
MAIN_AGENT_KEY=sk-orion-<main-agent-access-key>
MAIN_AGENT_MODEL=claude-sonnet-5
WORKER_A2A_URL=https://<gateway>/<worker-app-name>/a2a
WORKER_TRACE_URL=https://<gateway>/<worker-app-name>/trace
```

`WORKER_TRACE_URL` lets the main process forward MCP tool-call traces to the
browser. It uses the main agent key. If you run all processes on one machine,
leave `WORKER_A2A_URL`, `WORKER_TRACE_URL`, and `MCP_URL` on their loopback
defaults while keeping `ANTHROPIC_BASE_URL` on Privilege.

### Provider key registration

Register the Anthropic provider key in Privilege's AI Gateway Provider Keys
and associate it with the `llm/anthropic` route. This provider key stays in
Privilege. The demo sends only the Agent Access keys above to that route.

## Configuration reference

| Variable | Purpose |
|---|---|
| `ANTHROPIC_BASE_URL` | Empty for direct Anthropic, or the Privilege base ending in `/llm/anthropic` |
| `MAIN_AGENT_KEY` | Main agent's Privilege key, reused on its model and A2A legs |
| `WORKER_AGENT_KEY` | Worker agent's Privilege key, reused on its model and MCP legs |
| `MAIN_AGENT_ANTHROPIC_API_KEY` | Main direct-provider key when the base URL is empty |
| `WORKER_AGENT_ANTHROPIC_API_KEY` | Worker direct-provider key when the base URL is empty |
| `ANTHROPIC_API_KEY` | Optional shared direct-provider key fallback |
| `MAIN_AGENT_MODEL`, `WORKER_AGENT_MODEL` | Independent concrete Anthropic model IDs |
| `MAIN_AGENT_HOST` | Main-agent bind host; `127.0.0.1` native, `0.0.0.0` when Docker BFF connects through the host gateway |
| `MAIN_AGENT_PORT`, `WORKER_AGENT_PORT`, `MCP_SERVER_PORT` | Process ports; defaults are `3300`, `3301`, and `3302` |
| `A2A_BFF_SHARED_SECRET` | Main-agent inbound secret; required in integrated mode and must match the BFF value |
| `PRIVILEGE_A2A_MAIN_URL` | BFF-only main-agent base URL; defaults to `http://127.0.0.1:3300` |
| `PRIVILEGE_A2A_BFF_SECRET` | BFF-only shared secret; must match `A2A_BFF_SHARED_SECRET` |
| `WORKER_A2A_URL` | Worker A2A base URL; client uses its `/jsonrpc` endpoint |
| `WORKER_TRACE_URL` | Worker trace SSE endpoint |
| `MCP_URL` | MCP Streamable HTTP endpoint |
| `WORKER_REQUIRE_BEARER` | Optional local check that inbound A2A/trace requests include a Bearer header |
| `MCP_REQUIRE_BEARER` | Optional local check that MCP requests include a Bearer header |
| `MCP_STATEFUL` | Use MCP session IDs; defaults to `true` |
| `MCP_JSON_RESPONSE` | Use JSON instead of SSE-framed MCP replies; defaults to `false` |
| `MCP_SESSION_TTL_MS` | Idle session lifetime; defaults to `300000` |
| `MCP_DEMO_INJECTION` | Add an instruction-like string to one seeded grant; defaults to `false` |

The optional local bearer settings only check that a header is present. They do
not validate the key; Privilege performs that validation on gateway traffic.

## Tests

Run the demo's integration test from this directory:

```bash
npm ci
npm test
```

It starts the real MCP, worker, and main processes with isolated ports and a
local Anthropic API stub. It exercises the browser chat through A2A delegation
and an MCP entitlement lookup, checks each agent uses its own Anthropic Bearer
key, requires Bearer headers on the local A2A and MCP hops, and runs two chats
concurrently to verify each receives only its own worker trace events.

`npm run build` checks the TypeScript source separately.

## Direct Anthropic mode

For local development without a Privilege LLM route, leave
`ANTHROPIC_BASE_URL` empty and set `MAIN_AGENT_ANTHROPIC_API_KEY` and
`WORKER_AGENT_ANTHROPIC_API_KEY`, or the shared `ANTHROPIC_API_KEY`. Agent
Access keys remain separate and are used on A2A/MCP routes only when those URLs
point through Privilege.
