# Workspace Detection

## Workspace State
- **Existing Code**: Yes
- **Programming Languages**: TypeScript, JavaScript (React), Python (agents), shell
- **Build System**: npm (root + per-service package.json); Docker / K8s launchers
- **Project Structure**: Multi-service monorepo (BFF, UI, MCP servers/gateway, agents, authz/HITL, PingGateway)
- **Workspace Root**: /Users/curtismuir/Development/AI-DEMO2-chore-aidlc-sidecar
- **brownfield**: true

## Request Context (pilot)
Add read-only MCP tool `get_account_nickname` and an Actions chip that shows it.
Must obey REGRESSION_PLAN.md; no inventing auth/session stacks.

## Stack Snapshot (relevant to request)
| Layer | Path / service | Notes |
|-------|----------------|-------|
| UI | `demo_api_ui` (React / Vite) | Actions chips via AIAgent / Direct MCP path |
| BFF | `demo_api_server` | Banking data + OAuth session; MCP servers call it |
| MCP banking | `demo_mcp_server` :8080 | Tool registry in `BankingToolRegistry.ts` |
| MCP gateway | `demo_mcp_gateway` | Token enforce + authz + HITL for sensitive ops |
| Auth | PingOne + RFC 8693 TX | Protected — do not redesign |
| Agent | langchain_agent (+ others) | Optional consumer of tools |

## Existing read-only banking tools (do not duplicate)
`get_my_accounts`, `get_account_balance`, `get_my_transactions`, `search_transactions`, `get_transaction_detail`, `sequential_think`

## AI-DLC sidecar present
- `.aidlc/CORE-WORKFLOW.md` (upstream 1.0.1)
- `.aidlc-rule-details/`
- Priority: REGRESSION_PLAN → CLAUDE.md → AI-DLC when activated

## Next Step
Reverse Engineering (scoped) → Requirements Analysis questions.
