# Hostile MCP server behind the Privilege AI Gateway — design & runbook

**Date:** 2026-09-13
**Status:** approved (brainstorming) — implementation in progress
**Builds on:** `2026-09-09-hostile-mcp-server-design.md` (the standalone server, PR #3104),
PR #3267 (victim agent), PR #3268 (`standalone/mcp-scanner`).

## Goal

Make the hostile MCP server reachable on the SE cluster **behind the PingOne
Privilege AI Gateway**, and demonstrate the **full chain**:

1. The poisoned tool **metadata** reaches an agent unfiltered — the gateway does
   policy on tool *calls*, not metadata, so it cannot see this. (Honest gap.)
2. The poison induces a harmful **call** — `create_transfer` to an external
   account. That call goes *through* the gateway.
3. **Privilege denies the call.** The gateway is the backstop that stops the
   *action* even though it never saw the poison. (The positive Privilege use case.)
4. `standalone/mcp-scanner` would have caught the poison at ingest — the earlier
   defense.

## Why a separate Deployment, not a gateway sidecar

The `privilege-mcpgw-agent-k8s` skill forces a sidecar only for **catalog** apps,
which pin their backend to `localhost:8080/mcp`. A **custom** Agentic App (Add
Application → MCP Server) takes an explicit backend URL — exactly how
`opensearch-mcp-server` is registered (`…svc.cluster.local/sse`). So we host the
hostile server as its **own Deployment + Service** and register a custom app.

This keeps us **entirely off the `agentless-mcpgw` Helm chart** — the chart whose
stale-`.tgz`/`extraContainers` trap caused the 2026-09-07 outage. The only shared
action is a gateway `rollout restart` to re-run discovery, which is safe.

## Transport: must serve SSE

The gateway's discovery client issues a bare `GET` and waits for the SSE
`endpoint` event; it never POSTs `initialize`. The standalone server speaks only
Streamable HTTP on `/`. So the server gains an **SSE transport** (`GET /sse` +
`POST /messages`) **alongside** the existing Streamable HTTP `POST /` (which the
standalone agent and scanner keep using) and a `GET /health`.

Register the backend with **`/sse`**, never `/mcp` — `/mcp` answers 200 but the
handshake never completes ("Gateway Unreachable … initialize: Unauthorized",
which is not an auth fault).

## The harmful tool

The server serves a real, callable **`create_transfer`** tool (in `tools/list`,
with a `CallTool` handler) so there is an actual call for Privilege to police. It
is a **stub**: it returns a fake "transferred" result and never moves money. Its
presence also makes the description-injection landing real — the `get_weather`
`<IMPORTANT>` block tells the agent to call `create_transfer`, and now it can.

Served tools: `get_weather` (poisoned metadata), `search_docs` (poisoned schema),
`create_transfer` (real harmful action).

## Components

| Component | Owner | What |
|---|---|---|
| Server v2 | me | SSE transport + `/health` + `create_transfer`; Dockerfile; tests |
| Image | me | `ghcr.io/curtismu7/hostile-mcp-server:<sha>` + `:latest` |
| Deployment + Service | me | `hostile-mcp-server` in `ping-devops-curtismuir`, port 80→8899 |
| In-cluster `/sse` check | me | prove the `endpoint` event fires before registering |
| Gateway restart | me | `kubectl rollout restart deployment/agentless-mcpgw -n ping-devops-curtismuir` |
| **Agentic App registration** | **you (console)** | custom MCP server → backend `/sse` URL |
| **Deny policy** | **you (console)** | deny `create_transfer` for the demo user |
| Proof | shared | victim agent (direct) + gateway deny (Privilege door) |

## Console runbook (the manual steps)

After the Deployment is up and `/sse` verified, and the gateway restarted:

1. Privilege console → **Agentic Apps → Add Application → MCP Server**
   - Application Name: `hostile-mcp`
   - MCP Server URL: `http://hostile-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse`
   - Mesh Cluster: `ai-demo-cmuir`
   - Auth Mode: `None`
2. Wait for discovery to succeed (Tools populated; policy creation enabled). If it
   fails, read the gateway log, not the client:
   `kubectl logs -n ping-devops-curtismuir deployment/agentless-mcpgw -c log-tailer --tail=200`
3. Author a **policy** on the `hostile-mcp` app that **denies `create_transfer`**
   for the demo user (per-app, time-boxed, names the user — see the skill).

## Proof of the full chain

- **Metadata lands:** run the victim agent against the *direct* backend
  (`MCP_URL=http://…:8899/ npm run agent`, or via port-forward) — it reads the
  poison and chooses `create_transfer` / fills the exfil sink.
- **Privilege denies the call:** call `create_transfer` through the client URL
  `https://mcpgw.ai-demo.ping-devops.com/hostile-mcp/mcp` (Postman/LM Studio/
  `standalone/ai-gateway-client` Privilege door) → `403` / "denied". The
  ai-gateway-client's two doors show it cleanest: **Direct** succeeds, **Privilege**
  denies the same call.
- **Scanner would have caught it:** `standalone/mcp-scanner` flags the poison at
  ingest.

## Non-goals

- No edit to the `agentless-mcpgw` chart (no sidecar).
- No real money movement; `create_transfer` is a stub.
- Inter-Agent Abuse / A2A — still out of scope (belongs with UC2/UC2.5).
- Wiring this into the banking demo UI — separate work if wanted.

## Risks

- A deliberately-hostile, no-auth server on the cluster: the backend Service is
  ClusterIP (in-cluster only); the front door is gated by Privilege's own
  OAuth/DCR. Acceptable for the SE demo env.
- Gateway restart briefly re-runs discovery for all apps — safe, expected.
