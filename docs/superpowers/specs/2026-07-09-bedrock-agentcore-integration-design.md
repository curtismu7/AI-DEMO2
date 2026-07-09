# Bedrock AgentCore Gateway + Bedrock LLM Integration

**Date:** 2026-07-09  
**Status:** Approved (brainstorming)  
**Branch:** feat/privilege-shared-demo (spec authorship)  
**Scope:** AWS EKS deployment path only; local dev unchanged

---

## Goal

Complement the existing PingOne + `demo_mcp_gateway` stack with an optional AWS
path on EKS:

1. **AgentCore Gateway** — managed MCP entry point for tool calls (complements,
   does not replace, `demo_mcp_gateway` or PingGateway).
2. **Bedrock LLM** — optional model backend for the canonical agent-service
   (`:3006`) instead of llama.cpp / Helix.

Both capabilities are gated by **independent feature flags**, default **OFF**,
with cost guards and full observability in the token chain and flow trace so
presenters can narrate when AWS services are in use.

---

## Decisions (user-approved)

| Decision | Choice |
|----------|--------|
| Gateway relationship | Complement existing Ping gateway; do not replace |
| Deployment surface | AWS EKS only; local dev keeps `demo_mcp_gateway` + llama.cpp |
| Topology | AgentCore Gateway registers MCP server as direct target (not layered in front of Node gateway) |
| Feature flags | Two independent flags: gateway + LLM |
| Cost posture | Default OFF, `warnIfEnabled`, blessed single use-case chip, session turn cap |
| Token custody | BFF remains sole custodian; SPA never sees AWS or MCP tokens |
| Authz narrative | PingOne Authorize stays authoritative where the banking demo requires it; AgentCore is transport/aggregation |

---

## Non-goals

- Replacing `demo_mcp_gateway` for local development
- Bedrock Knowledge Bases / RAG
- Bedrock Agents as a separate multi-step runtime (Bedrock is LLM-only here)
- AgentCore Gateway layered in front of PingGateway
- Committing AWS secrets, kubeconfig, or live PingOne policy changes
- Enabling Bedrock paths without explicit admin flag toggle

---

## Architecture

```text
LOCAL (unchanged)                    AWS EKS (when flags ON)
─────────────────                    ─────────────────────────
BFF ──► demo_mcp_gateway ──► MCP     BFF ──► AgentCore Gateway ──► MCP target
BFF ──► agent-service ──► llama.cpp  BFF ──► agent-service ──► Bedrock Converse
```

### Principles

- **BFF token custody** — unchanged (`REGRESSION_PLAN.md` §1).
- **EKS gate** — flags have no effect unless `AWS_DEPLOYMENT=1` (or equivalent
  marker from `k8s/aws/`). Misconfigured local `.env` cannot invoke Bedrock.
- **Independent flags** — gateway-only, LLM-only, or both for the full AWS story.
- **Rollback** — flip both flags OFF → instant revert to Ping/llama.cpp, no redeploy.

### Auth bridge (gateway flag)

AgentCore Gateway registers `banking_mcp_server` (exposed via ALB) as an MCP
target. Amazon Bedrock AgentCore Identity handles OAuth to PingOne (authorization
code / on-behalf-of). The BFF still mints the user delegation token via RFC 8693;
`bedrockAuthBridge` performs AgentCore session binding per AWS 3LO model on first
use and re-binds on expiry.

PingOne Authorize remains the authoritative tool-policy gate in the banking
narrative where required. AgentCore Gateway provides centralized MCP connectivity,
credential management, and observability — not a replacement for Ping authz.

### Bedrock LLM (LLM flag)

`llmProviderResolver` gains a `bedrock` pass-through when the flag is effective.
Agent-service calls `bedrock-runtime:Converse` via IRSA. The heuristic floor is
unchanged (ARCHITECTURE-TRUTHS T-3).

---

## Feature flags

Registered in `demo_api_server/routes/featureFlags.js` (`FLAG_REGISTRY`) and
`demo_api_server/services/configStore.js` (defaults + env mapping).

| Flag ID | Name | Default | Gate | `runtimeKey` |
|---------|------|---------|------|--------------|
| `ff_bedrock_agentcore_gateway` | Bedrock AgentCore Gateway | `false` | `AWS_DEPLOYMENT=1` | `bedrockGatewayEnabled` |
| `ff_bedrock_llm` | Bedrock LLM | `false` | `AWS_DEPLOYMENT=1` | `bedrockLlmEnabled` |

Both flags:

- Category: **AWS / Bedrock**
- `warnIfEnabled: true`
- Admin-only (not public customer flags)
- Documented in Quick Flags / Feature Flags admin UI

### Environment variables (EKS only, not committed)

| Variable | Purpose |
|----------|---------|
| `AWS_DEPLOYMENT` | `1` — enables flag effect |
| `AGENTCORE_GATEWAY_URL` | Managed gateway MCP endpoint |
| `AGENTCORE_IDENTITY_CLIENT_ID` | AgentCore Identity OAuth client |
| `AGENTCORE_GATEWAY_TARGET_ID` | Registered MCP target ID (for trace) |
| `BEDROCK_MODEL_ID` | Default: `anthropic.claude-3-5-haiku-…` (cost-conscious) |
| `AWS_REGION` | e.g. `us-east-1` |
| `BEDROCK_MAX_TURNS_PER_SESSION` | Default: `3` — safety cap |

---

## Components

| Component | Location | Role |
|-----------|----------|------|
| `bedrockGatewayClient.js` | `demo_api_server/services/` | Parallel to `mcpGatewayClient.js` — AgentCore MCP `tools/call` |
| `bedrockAuthBridge.js` | `demo_api_server/services/` | AgentCore Identity 3LO session binding; re-auth on expiry |
| `mcpGatewayClient.js` | (modify) | Resolver branch when gateway flag effective |
| `llmProviderResolver.js` | (modify) | `bedrock` pass-through when LLM flag effective |
| `BedrockConverseProvider` | `banking_agent_service/` | `@aws-sdk/client-bedrock-runtime` Converse API |
| `unifiedTrace.js` emitters | `demo_api_server/services/` | `agentcore-sync`, `agentcore-tool-call`, `bedrock-converse` |
| `AwsProductChip` | `demo_api_ui/src/components/` | Token chain AWS attribution (parallel to `PingProductChip`) |
| `AwsBedrockPathPanel.js` | `demo_api_ui/src/components/education/` | Education when AWS path active |
| `aws_enterprise_path` chip | chip registry | Blessed narratable flow (both flags) |
| `k8s/aws/bedrock/` | infra scripts | Gateway, Identity client, target registration |
| `docs/AWS_BEDROCK_PATH.md` | docs | Operator runbook (Phase 5) |

---

## Data flow

### MCP tool call (gateway flag ON)

```text
1. User action → BFF runMcpToolPipeline
2. BFF mints MCP token (RFC 8693, aud=gateway) — unchanged
3. Resolver: ff_bedrock_agentcore_gateway + AWS_DEPLOYMENT → bedrockGatewayClient
4. bedrockAuthBridge: bind AgentCore session (3LO on first call in session)
5. bedrockGatewayClient → AgentCore Gateway
     POST tools/call { name, arguments }
     Headers: Bearer <agentcore-bound-token>
              MCP-Protocol-Version: 2025-11-25
6. AgentCore Gateway → MCP target (banking_mcp_server @ ALB /mcp)
7. Response → BFF → token chain:
     - agentcore-gateway (tool, target ID, latency)
     - downstream MCP events (unchanged)
8. UI: Token chain AWS hop; agent chip badge "AgentCore"
```

Gateway flag OFF → existing `mcpGatewayClient` path (Node gateway or PingGateway).

### Agent turn (LLM flag ON)

```text
1. BFF resolveLlmProvider → { provider: 'bedrock', model: BEDROCK_MODEL_ID }
2. BFF → agent-service with bedrock provider
3. agent-service → Bedrock Converse (IRSA)
4. Stream response → BFF → UI
5. Token chain / flow trace: bedrock-converse
     (model ID, region, input/output token counts)
6. UI: agent chip badge "Bedrock"
```

LLM flag OFF → existing llama.cpp / Helix path.

### Blessed use case: `aws_enterprise_path`

Single narratable chip for presenters:

- **Trigger:** education chip "AWS Enterprise Agent Path"
- **Requires:** both flags ON (chip warns if off)
- **Flow:** "show my accounts using the AWS agent path"
  → `get_accounts` via AgentCore Gateway + Bedrock reasoning
- **Cost bound:** 1 gateway tool call + 1 Bedrock turn typical;
  `BEDROCK_MAX_TURNS_PER_SESSION` rejects excess
- **Narration:** PingOne login → RFC 8693 → AgentCore Gateway → MCP → Bedrock Converse

---

## Infrastructure (EKS)

```text
AgentCore Gateway (managed AWS)
  └── Target: banking_mcp_server
        URL: https://<ALB>/mcp
        Auth: AgentCore Identity OAuth → PingOne AS
        Protocol: 2025-11-25
        Sync: SynchronizeGatewayTargets on deploy

EKS: banking_agent_service pod
  └── IRSA: bedrock:InvokeModel, agentcore:InvokeGateway (scoped)
```

Local `.env.example` documents variables as empty/commented.

---

## Error handling

| Failure | Behavior |
|---------|----------|
| Flag on, no `AWS_DEPLOYMENT` | 503 — "Bedrock path requires AWS deployment" |
| AgentCore session expired | `bedrockAuthBridge` re-runs 3LO; token chain `agentcore-reauth` |
| Bedrock throttling | One retry with backoff; then user-visible rate-limit message |
| Missing IAM on EKS | Agent-service fail-fast at startup when LLM flag effective |
| Cost cap exceeded | BFF 429 + education link |
| Flag on, missing gateway URL | 503 with config hint (no silent fallback to Node gateway) |

---

## Observability

### Token chain events

| Event ID | When | Fields |
|----------|------|--------|
| `agentcore-sync` | Target sync on deploy / first call | target ID, tool count |
| `agentcore-gateway` | Each tool call via AgentCore | tool name, latency, target ID |
| `agentcore-reauth` | 3LO re-bind | reason |
| `bedrock-converse` | Each LLM turn | model ID, region, token counts |

### UI

- `AwsProductChip` in token chain (orange/AWS branding)
- Agent chip badges: "AgentCore" / "Bedrock" when respective flag active
- `AwsBedrockPathPanel` education content
- Flow trace entries: `gateway: agentcore`, `llm: bedrock`

---

## Testing strategy

### Unit (default CI — `./run-tests.sh unit`)

| Test | Proves |
|------|--------|
| `bedrockGatewayClient.test.js` | JSON-RPC, MCP headers, error mapping |
| `bedrockAuthBridge.test.js` | Session bind/re-auth, no token leakage |
| `mcpGatewayResolver.bedrock.test.js` | Flag routing + 503 without AWS |
| `llmProviderResolver.bedrock.test.js` | Pass-through when flag effective |
| `featureFlags.bedrock.test.js` | Registry defaults, warnIfEnabled |
| `bedrockConverseProvider.test.js` | Converse shape, mocked SDK |
| Token chain snapshot | New events render; Ping events unchanged |
| `mcpToolPipeline.characterization` | Same `Outcome` discriminant on Bedrock branch |

### Integration (manual / nightly only)

```bash
BEDROCK_INTEGRATION=1 scripts/verify-bedrock-path.sh
```

Asserts: blessed chip flow, token chain events, cost cap. **Not** in default CI
to avoid accidental AWS charges.

### E2E (Playwright, mocked)

- Mock AgentCore in `customerDashboardMocks.js`
- Chip renders AWS badges when flags on
- Flags off → education warning, no Bedrock calls

### Regression guard

With both flags OFF (default), `REGRESSION_PLAN.md` §1 protected areas behave
identically to pre-integration baseline.

---

## Phased delivery

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| **P1** | Flags + resolver branches (no real AWS) | Admin UI flags, 503 when misconfigured |
| **P2** | Bedrock LLM provider + trace | `ff_bedrock_llm` on EKS with Haiku default |
| **P3** | AgentCore Gateway client + auth bridge + infra | `ff_bedrock_agentcore_gateway` routes one tool |
| **P4** | Demo polish | Blessed chip, education panel, AWS chips, cost cap |
| **P5** | Docs + verify script | `docs/AWS_BEDROCK_PATH.md`, nightly gate |

---

## Protected areas

Read `REGRESSION_PLAN.md` §0–§1 before implementation. Touching these requires
regression-guard skill:

- OAuth / RFC 8693 token exchange (`agentMcpTokenService.js`)
- BFF session layer
- `runMcpToolPipeline` outcome contract (ADR-0004)
- Token chain display semantics
- Feature flag registry dual-sync (`featureFlags.js` ↔ `configStore.js`)

---

## Open questions (resolve during P3 infra)

1. **Exact PingOne ↔ AgentCore Identity mapping** — confirm OAuth client, scopes,
   and audience for 3LO with AWS solutions architect.
2. **MCP target URL** — direct `banking_mcp_server` vs ALB path prefix; align
   with existing `k8s/aws/ingress.yaml`.
3. **Model default** — Haiku for cost vs Sonnet for demo quality; make
   `BEDROCK_MODEL_ID` operator-tunable without code change.

---

## References

- [Amazon Bedrock AgentCore Gateway — MCP server targets](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-MCPservers.html)
- [Connecting MCP servers via Authorization Code flow](https://aws.amazon.com/blogs/machine-learning/connecting-mcp-servers-to-amazon-bedrock-agentcore-gateway-using-authorization-code-flow/)
- Internal: `demo_api_server/services/mcpGatewayClient.js` (routing precedent)
- Internal: `demo_api_server/routes/featureFlags.js` (`ff_mcp_gateway_pinggateway` pattern)
- Internal: `docs/AWS_DEPLOY.md` (EKS baseline)
