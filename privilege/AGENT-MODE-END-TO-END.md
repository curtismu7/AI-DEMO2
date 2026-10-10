# Agent mode end to end

What the PingOne Privilege **Agent** — the device-bound desktop app — actually
does in this stack, measured live on 2026-10-10 with the agent installed and
paired on this Mac (v2.0.51, tenant `0428ba4f-169c-436b-aff9-b230496e0e3b`,
"AI Agent"). The short version, and the reason this guide exists:

> **The Agent is a device-bound identity anchor, not an MCP transport.** Its
> MCP story runs through Privilege's cloud frontend and is roadmap ("MCP
> clients TBD" — the SE1 setup doc says so). Every MCP call in this tenant —
> the doors, the policies, the union — flows through the **agentless**
> gateways. "Agent vs agentless" is not two ways to call MCP here; it is
> workstation identity vs no workstation identity.

## What the Agent is

The PingOne Privilege Agent (macOS app, `PingOne Privilege.app`) pairs one
user to one workstation:

- **Identity lives in the Secure Enclave.** Not on disk, not in the keychain
  dump, not in any file — verified from the negative on 2026-10-10 (no
  procyon/cyon items in the login keychain; `~/Library/Application
  Support/procyon-agent/` holds only Electron caches and a `config.json`
  carrying `controllerURL`, `version`, `homepath`).
- **One tenant at a time.** Re-pairing erases the previous tenant's device
  identity. Order matters: generate the new onboarding link **before**
  disconnecting (links are one-time, ~2 h expiry).
- **Phone-home architecture.** `cyonagent_mac` (the agent) + `enclave` (the
  key-store process) hold a live TLS channel to Privilege's controller
  (us-east-2 for this tenant).

## Measured, 2026-10-10

| Surface | Result |
|---|---|
| App version | 2.0.51 (`CFBundleShortVersionString`) |
| Processes | `cyonagent_mac` + `enclave`, both running at login |
| Pairing | Tenant `0428ba4f…` ("AI Agent" — the same tenant as our agentless gateway); MFA Disabled |
| Control channel | Established TLS to the us-east-2 controller |
| Local console | `https://local.procyon.ai:8643` → **302** (served locally by the agent; the UI lives behind it) |
| Cloud frontend | `https://opensearch.default.applications.procyon.ai:8643/mcp` → **403** without agent identity — the device-bound gate, measured directly |
| Keychain | Nothing readable (Secure Enclave claim verified from the negative) |
| UI panels | General (pairing/status) + Open Console. **No apps/MCP-connections panel** — confirmed on 2.0.51 |

## What Agent mode is NOT (on this stack)

The distinction the older documents imply — an Agent-authenticated MCP gateway
that the installed agent unlocks — no longer exists here:

- `cm-mcpgw` (the Agent-mode gateway of `AGENT-CONFIGURATION.md`, mesh
  `ai-demo-agent`, app `cmuir2`) is **gone** from `ping-devops-curtismuir`
  (helm: only `agentless-mcpgw` + `mcp-config-standalone` remain, revision 71).
- Nothing in either namespace serves `:8643` — the frontend the agent
  intercepts is Privilege's cloud control plane, not an in-cluster gateway.
- The demo BFF retired its Agent/Agentless door pair on 2026-09-02
  (`privilegeMcpClient.js`: the agent-mode frontend "has nothing behind it" —
  the page sat on "authenticated, 0 tools" forever).

**MCP enforcement in this tenant runs entirely through the agentless
gateways.** See [CURRENT-CONFIGURATION.md](CURRENT-CONFIGURATION.md) for the
doors and [PRIVILEGE-POLICIES-IN-DEPTH.md](PRIVILEGE-POLICIES-IN-DEPTH.md) for
the policy union that gates them.

## What the Agent IS for, today

1. **Device-bound trust anchor.** The workstation's Secure Enclave identity is
   the thing Privilege's cloud frontend gates on — the 403-vs-session line is
   the agent's presence, not a token.
2. **Console access from a trusted device.** Menu-bar Ping icon → **Open
   Console**; the console UI is served locally by the agent
   (`local.procyon.ai:8643`) and brokers to the tenant. (Known issue, with fix:
   a white console page after "Open Console" is the agent's self-signed cert
   on subresource loads — quit and relaunch the app; see
   [SE1-Privilege-Agent-Setup-Mac.md](SE1-Privilege-Agent-Setup-Mac.md).)
3. **Target-resource access** — SSH, RDP, database clients, `kubectl`, cloud
   CLIs — brokered through the agent's identity with session recording. None
   configured in this tenant yet; that is the next measurable chapter when a
   resource target exists.
4. **MCP via the agent** — roadmap. The setup doc's own words: "MCP clients
   TBD". When Privilege ships it, the cloud frontend (`*.applications.
   procyon.ai:8643`) is the shape it will arrive through; this guide's
   cloud-frontend 403 measurement is the baseline that work will move.

## The deployed state this guide describes (2026-10-10)

Two namespaces, one tenant (`0428ba4f…`):

| Namespace | Role | Privilege pieces |
|---|---|---|
| `ping-devops-curtismuir` | Primary Privilege gateway | `agentless-mcpgw` (`mcpgw.ai-demo.ping-devops.com`), `mcpgw-lb` (the 2-node pair), `agentless-mcpgw-homepage`, backends: `opensearch`, `opensearch-mcp-server` Service, `hostile-mcp-server`, resource server; `kibana-siem` + `elasticsearch-siem` |
| `ping-devops-cmuir` | The AI-DEMO2 demo stack + a second gateway | `agentless-mcpgw` (`mcpgw2.ai-demo.ping-devops.com`), `ping-gateway`, `tier-manager`, `privilege-redis`; the demo frontend/BFF/API fleet; the MCP fleet (`mcp-server`, `mcp-resource-server`, `mcp-weather`, `mcpdemo`, `hostile-a2a-agent`); `workeragentdemo` (Ping's reference demo pair); observability stack |

Both gateways run the same image (`public.ecr.aws/s7q1z8z4/privilege-aigw:latest`) —
the "legacy privilege-proxy image" caution in `AGENT-CONFIGURATION.md` is
doubly stale.

## Setup and pairing (condensed; full walk in SE1 doc)

1. PingOne: grant the user Privilege access (Directory → user → Services →
   Privilege → **Generate Onboarding Link**). One-time, ~2 h.
2. Open the link on the workstation → **Download for Apple macOS (Arm64)** →
   install → launch.
3. Back in the browser: **Launch Agent** → "Always allow" → **Open** (mouse
   click, not Return).
4. General panel: Connection Status **Connected**, Key Store **Secure
   Enclave**, the tenant ID — pairing done.
5. MFA (PingID) enrolment is a separate step per persona; currently
   **Disabled** in this tenant — expect step-up on sudo around Q3 2026.

## Re-pairing (the order that does not strand you)

Generate the onboarding link in the target tenant **first**, then disconnect
(the broken-chain icon, bottom left), then run the link. Disconnecting first
leaves the agent unpaired with nothing to pair to. Re-pairing destroys the
previous tenant's device identity — recovering it needs console access there.

## Open items

- **Group-attached policies did not participate in the union** on the
  2026-10-10 run (see [PRIVILEGE-POLICIES-IN-DEPTH.md](PRIVILEGE-POLICIES-IN-DEPTH.md)
  step F) — the agent resolves identity at sign-in; whether a fresh sign-in
  picks up newly attached groups is untested.
- **MFA Disabled** — enabling PingID step-up is the natural next measurement
  (the SE1 doc's step 7).
- **MCP via the agent** — when Ping ships it, measure here first: the
  cloud-frontend 403 above is the "before" picture.
