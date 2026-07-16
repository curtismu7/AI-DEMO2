# CLAUDE.md — OKF Knowledge Patch

## Instructions for Patching

Add the following section to your existing `CLAUDE.md` file. Place it near
the top, after any existing "Project Overview" section but before detailed
file-by-file descriptions.

---

## Paste the block below into CLAUDE.md:

```markdown
## OKF Knowledge Bundles

This repository includes machine-readable knowledge bundles in `graphify-out/`.
Before answering architectural questions or making structural changes, consult
the relevant bundle:

### Available Bundles

| Bundle | Domain | Use When |
|---|---|---|
| `graphify-out/repo-topology.okf.json` | `repo-topology` | Understanding service boundaries, token exchange, scope topology, feature flag wiring, compose profiles, MCP tools |
| `graphify-out/banking-domain.okf.json` | `banking-domain` | Understanding banking policies (balance definitions, transfer limits, fraud holds) that the demo agent enforces |

### How to Use

1. **Read the bundle** at session start — it contains 15 assertions about the codebase architecture
2. **Cite assertions** when explaining decisions: "The RAG stack is compose-profile gated, not feature-flagged [K3]"
3. **Check before rediscovering** — if you're about to grep for how feature flags work, K2 and K13 in `repo-topology` already document the three-point wiring pattern

### Key Assertions (repo-topology)

- **K1** — Agent prompt assembly location (demoAgentLangGraphService.js:1407)
- **K2** — Feature flag three-point wiring (FLAG_REGISTRY + FIELD_DEFS + QUICK_FLAGS)
- **K3** — RAG is compose-profile gated, not feature-flagged
- **K4** — MCP tools (code_search, get_code, list_codebases) are NOT wired into agent prompts
- **K5** — Compose profiles vs feature flags distinction
- **K6** — Token exchange chain (RFC 8693)
- **K7** — Scope topology (accounts:read, accounts:transfer, admin:config)
- **K13** — Step-by-step: how to add a new feature flag
- **K14** — ff_okf_grounding flag behavior

### Updating Bundles

If you discover new architectural facts while working, add them to the
appropriate `.okf.json` bundle. Each assertion needs: `id` (K-number),
`claim` (the fact), `source` (where you found it), `confidence` (1.0 for
verified facts). Validate with `schemas/okf-bundle.schema.json`.
```
