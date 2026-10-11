# Running our demo against the shared Privilege environment

Status: gap analysis, 2026-10-11. Question: how much of our stack breaks if we point it at the shared SE1 Privilege environment, and what would we have to add there to make our use cases work.

Companion pieces: [SE1-Privilege-Shared-Demo.md](SE1-Privilege-Shared-Demo.md) (the shared env as Demo Engineering built it), [A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md](A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md) (our A2A demo and how it was built), [NEW-DEMO-ENVIRONMENT.md](NEW-DEMO-ENVIRONMENT.md) (standing up a gateway in any tenant).

## The short answer

The shared SE1 environment is built for a different demo than ours. It is the agent-persona environment: `{seemail}+AgentAdmin` / `+AgentEndUser` users, the desktop Privilege Agent, and the AWS AppRole / S3 / VPC / kill-switch script acts. Nothing in it is ours — no AI GW gateway node, no Agentic Apps, no agent registry entries, no OIDC apps.

Our use cases (UC45–47 A2A runs, LLM virtual keys, the `/privilege-mcp-client` door and console page) ride entirely on the agentless AI GW pattern we built in our own tenant (`0428ba4f-…`) with our own gateway at `mcpgw.ai-demo.ping-devops.com`. Pointed at the shared env as-is, everything that touches Privilege breaks on day one — not because the shared env is hostile, but because it is empty for us.

## Answers we already have

Asked of Demo Engineering (or assumed until checked):

| # | Question | Answer |
| --- | --- | --- |
| 1 | Can an SE add an **AI GW gateway node** in the shared Agent env? | **Not sure** — the open gate. SE1 says nothing about gateways; "SSO / agentless coming soon" may mean the console tabs are restricted |
| 2 | Can SEs create Agentic Apps, registry agents, and OIDC apps there? | **Yes** |
| 3 | Quota/limits per SE in the shared tenant? | **No** |

An admin account on the shared demo already exists.

## What breaks

| Our demo surface | Why it breaks |
| --- | --- |
| `PRIVILEGE_MCPGW_URL`, `MCP_PRIVILEGE_GATEWAY_URL` → `mcpgw…/opensearch22/mcp` | The `opensearch22` app does not exist in the shared tenant → 401 at the door |
| LLM virtual keys (`PRIVILEGE_LLM_VIRTUAL_KEY_*`) | Minted by agents in *our* tenant; keys are per-tenant → `invalid virtual key` |
| A2A runs (UC46/47) | `workeragentdemo`, `langchainagent`, `hostile-a2a`, `restrictedagent` apps and the `main-agent` / `worker-agent` / `langchain-caller` agents do not exist there |
| `/privilege-mcp-client` console-token sign-in + Door picker | `PRIVILEGE_CONSOLE_ENV_ID` / `PRIVILEGE_SSO_ENV_ID` point at our tenant; the shared Agent env is `a32ebaed-…` |
| Gateway-records block on Steps 25/26 | Needs the time-boxed `SearchIndexTool`-on-`opensearch22` policy; it lapses mid-demo even in our own env, and would need re-granting there |
| `PRIVILEGE_LOGIN_HINT` (`cmuir+ssoEndUser@…`) | Wrong persona address for the shared env |

## What we would have to add (assuming the gate opens)

1. **Enroll our own AI GW gateway node into the shared tenant** — our helm chart, our cluster namespace, our ingress; only the tenant, enrollment token and OIDC values change. This is the linchpin: our A2A backends are k8s services (`*.ping-devops-cmuir.svc.cluster.local`) that only resolve from a pod in our cluster, so Demo Engineering's gateway could not front them.
2. **An OIDC web app in the shared env** (client_secret_basic, Authorization Code + Token Exchange, redirect to our gateway host) for the gateway's own sign-in, plus the SSO client-credentials pairing for `PRIVILEGE_SSO_CLIENT_ID/_SECRET`.
3. **Re-register the 6 apps and 3 agents** in the shared console, in that order (apps before agents — an agent can only select apps that already exist). Re-mint the 3 agent keys (shown once, on the last wizard screen) into the vault → `k8s/create-secrets.sh` → restart deployments.
4. **Collision-proof names.** The shared tenant is one tenant for all SEs, so `opensearch22` / `mcpdemo` *will* collide. Prefix everything (`cmuir-mcpdemo`, …) and update every env and config reference.
5. **Re-grantable time-boxed policies** for the `SearchIndexTool` read that feeds the gateway-records block — documented console steps or a script, since they lapse.

## The 15-minute probe (answers #1)

Sign in to the shared Agent env with the admin account, in a dedicated Chrome profile (MFA is profile-bound): `https://console.pingone.com/?env=a32ebaed-d454-4f5a-9575-697cfcb6f822`.

If the top right offers only User view, the Privilege Administrator role is missing — SE1 step 4 first (Platform Admin → the user → Grant Roles → PingOne Privilege Administrator).

Then check, in order:

1. **Gateways → Add New** — is there an **AI GW** tab beside the VM wizard? Screenshot whatever tabs exist.
2. **Agent Privilege → Agentic Apps → Add Application** — confirm the type picker offers MCP Server and Remote Agent.
3. **Agent Privilege → Agent Registry → Add Agent** — the wizard opens, and does it offer a Real Provider Key (Google)? The LLM legs need it.
4. **Gateways page** — is there an existing cluster/node that belongs to Demo Engineering (a shared gateway apps could attach to)?

## Reading the result

| Outcome | Meaning |
| --- | --- |
| AI GW tab present | Full path open. About a day of config-swap: enroll our node, register 6 apps + 3 agents with `cmuir-` prefixes, re-mint agent keys into the vault, a `.env.privilege-shared` profile |
| No AI GW tab, but an existing shared cluster on the Gateways page | Possible middle path — ask Demo Engineering whether SEs can attach apps to their node. Note: our A2A backends only resolve from inside our cluster, so their gateway would only work for apps with a reachable backend URL |
| Neither | Apps/agents creatable but nothing routes. Our stack keeps its own tenant; the shared env stays the persona demo |
