# Seeing the Privilege Map

Everything runs on this Mac. Use the domain for the AI-DEMO2 app (`local.ping-devops.com` points at 127.0.0.1 through `/etc/hosts`, and sign-in only works on that host). The Privilege pages are public, so they also load at `https://127.0.0.1:4000`.

## 1. In the AI-DEMO2 app

| What | URL |
| --- | --- |
| **Privilege shelf** (cards for everything) | https://local.ping-devops.com:4000/privilege-shelf |
| **Privilege Map**, all five areas | https://local.ping-devops.com:4000/privilege-map |
| Identity | https://local.ping-devops.com:4000/privilege-map?page=identity |
| LLM | https://local.ping-devops.com:4000/privilege-map?page=llm |
| MCP and A2A | https://local.ping-devops.com:4000/privilege-map?page=mcp |
| Oversight | https://local.ping-devops.com:4000/privilege-map?page=oversight |
| Platform | https://local.ping-devops.com:4000/privilege-map?page=platform |
| NHI diagrams (open "Non-human identity" in the page's left list) | https://local.ping-devops.com:4000/privilege-mcp-learning |
| Docs index | https://local.ping-devops.com:4000/privilege-docs-index |

**Side menu:** Ping products, then **Privilege info**. It lists the shelf, the Privilege Map, the Guide, Diagrams, Topologies, External Agent App Diagrams and the Docs Index, and it opens by itself on any of those pages. If the rail on the left is collapsed to icons, click the arrow at the top left to expand it.

**A diagram for every feature:** each feature page has an **Open the diagram in a new tab** link. The diagram shows the feature in the middle and each component it uses around it. It is ReactFlow: drag any box, **Simulate** walks the components one at a time, **Reset** puts everything back, and the step time is adjustable. The step text is the sentence from "How it works" that mentions the component. Build a URL by hand from the feature id:

- page: `https://local.ping-devops.com:4000/privilege-map?page=<page>&feature=<id>`
- diagram: add `&diagram=1`

## 2. The standalone Privilege Map

It serves plain HTTP on loopback only, so it uses `localhost` (a domain would need its own certificate and a hosts entry, and the standalone-app rules keep these apps on loopback).

| What | URL |
| --- | --- |
| Map (the two NHI diagrams) | http://localhost:5301/ |
| A page | http://localhost:5301/#/oversight (also `#/identity`, `#/llm`, `#/mcp`, `#/platform`) |
| A feature's diagram | http://localhost:5301/#/diagram/<id> |
| Health | http://localhost:5301/api/health |

Start it: `docker compose up --build -d` in `~/Development/privilege-map` (publishes 127.0.0.1:5301 only). Developing: `npm run dev` serves port 5300. Code: https://github.com/cmuir_pingcorp/privilege-map. Its font is Montserrat, bundled in the app (no outbound requests).

## 3. The demo shelf

The shelf in Docker (http://127.0.0.1:4401/) lists only demos that have a hosted copy, so it does not show Privilege Map. Run the shelf on the host instead: `cd ~/Development/demo-shelf && npm start`, then open http://127.0.0.1:4400/.

## 4. The local gateway (optional)

`docker compose --profile mcpgw up -d ping-mcpgw` from the AI-DEMO2 folder. A healthy gateway answers with a 401 and OAuth metadata:

```
curl -s -H "Host: mcpgw.local.ping-devops.com" http://127.0.0.1:8623/.well-known/oauth-protected-resource
```

Port 8623 is plain HTTP. For browser names, `/etc/hosts` needs `127.0.0.1  mcpgw.local.ping-devops.com aidemo.mcpgw.local.ping-devops.com`. The log line `has same NodeURL` is harmless. A 404 on `/mcp` for the `aidemo` host means the tenant has no `aidemo` app attached to this gateway; creating it is a console step.

## 5. Things that look wrong but are not

- **The text is marked draft.** Open "Sources and what is not verified" on a feature to see what is confirmed. Token and budget caps are untested.
- **The hosted site returns 503.** The SE frontend and API server are scaled to 0; everything above runs locally.
- **The left menu is cut off at the bottom.** That was the page zoom (the "A 113%" control): the menu was sized to the window before zoom, so the last items sat below the screen. The menu is now pinned top and bottom.

## 6. Feature ids

The ids come from the feature data (`demo_api_ui/src/data/privilegeFeatures.json`).

| Area | Feature | Id | Links |
| --- | --- | --- | --- |
| Identity | Agent Registry | `agent-registry` | [page](https://local.ping-devops.com:4000/privilege-map?page=identity&feature=agent-registry) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=identity&feature=agent-registry&diagram=1) |
| Identity | Privilege Agent (desktop device-bound identity) | `privilege-agent-desktop-device-bound-identity` | [page](https://local.ping-devops.com:4000/privilege-map?page=identity&feature=privilege-agent-desktop-device-bound-identity) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=identity&feature=privilege-agent-desktop-device-bound-identity&diagram=1) |
| Identity | CIMD client documents | `cimd-client-documents` | [page](https://local.ping-devops.com:4000/privilege-map?page=identity&feature=cimd-client-documents) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=identity&feature=cimd-client-documents&diagram=1) |
| LLM | Virtual keys | `virtual-keys` | [page](https://local.ping-devops.com:4000/privilege-map?page=llm&feature=virtual-keys) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=llm&feature=virtual-keys&diagram=1) |
| LLM | Model allowlists | `model-allowlists` | [page](https://local.ping-devops.com:4000/privilege-map?page=llm&feature=model-allowlists) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=llm&feature=model-allowlists&diagram=1) |
| LLM | LLM provider routes and wire shapes | `llm-provider-routes-and-wire-shapes` | [page](https://local.ping-devops.com:4000/privilege-map?page=llm&feature=llm-provider-routes-and-wire-shapes) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=llm&feature=llm-provider-routes-and-wire-shapes&diagram=1) |
| LLM | Attributable denial | `attributable-denial` | [page](https://local.ping-devops.com:4000/privilege-map?page=llm&feature=attributable-denial) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=llm&feature=attributable-denial&diagram=1) |
| MCP and A2A | Policy union model | `policy-union-model` | [page](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=policy-union-model) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=policy-union-model&diagram=1) |
| MCP and A2A | MCP tool-call policy | `mcp-tool-call-inspection` | [page](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=mcp-tool-call-inspection) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=mcp-tool-call-inspection&diagram=1) |
| MCP and A2A | MCP discovery gating | `mcp-discovery-gating` | [page](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=mcp-discovery-gating) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=mcp-discovery-gating&diagram=1) |
| MCP and A2A | Aggregate apps | `aggregate-apps` | [page](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=aggregate-apps) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=aggregate-apps&diagram=1) |
| MCP and A2A | Agent-to-agent (A2A) through the gateway | `agent-to-agent-a2a-through-the-gateway` | [page](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=agent-to-agent-a2a-through-the-gateway) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=agent-to-agent-a2a-through-the-gateway&diagram=1) |
| MCP and A2A | A2A guardrails | `a2a-guardrails` | [page](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=a2a-guardrails) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=a2a-guardrails&diagram=1) |
| MCP and A2A | Backend auth modes | `backend-auth-modes` | [page](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=backend-auth-modes) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=mcp&feature=backend-auth-modes&diagram=1) |
| Oversight | Per-credential inspection policy (AI Guard) | `per-credential-inspection-policy-aiguard` | [page](https://local.ping-devops.com:4000/privilege-map?page=oversight&feature=per-credential-inspection-policy-aiguard) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=oversight&feature=per-credential-inspection-policy-aiguard&diagram=1) |
| Oversight | Cedar per-call policy | `cedar-per-call-policy` | [page](https://local.ping-devops.com:4000/privilege-map?page=oversight&feature=cedar-per-call-policy) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=oversight&feature=cedar-per-call-policy&diagram=1) |
| Oversight | Human-in-the-loop approvals | `human-in-the-loop-approvals` | [page](https://local.ping-devops.com:4000/privilege-map?page=oversight&feature=human-in-the-loop-approvals) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=oversight&feature=human-in-the-loop-approvals&diagram=1) |
| Oversight | Attack Lab | `attack-lab` | [page](https://local.ping-devops.com:4000/privilege-map?page=oversight&feature=attack-lab) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=oversight&feature=attack-lab&diagram=1) |
| Oversight | Audit evidence | `audit-evidence` | [page](https://local.ping-devops.com:4000/privilege-map?page=oversight&feature=audit-evidence) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=oversight&feature=audit-evidence&diagram=1) |
| Platform | Secrets Hub | `secrets-hub` | [page](https://local.ping-devops.com:4000/privilege-map?page=platform&feature=secrets-hub) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=platform&feature=secrets-hub&diagram=1) |
| Platform | Sensor enforcement | `sensor-enforcement` | [page](https://local.ping-devops.com:4000/privilege-map?page=platform&feature=sensor-enforcement) · [diagram](https://local.ping-devops.com:4000/privilege-map?page=platform&feature=sensor-enforcement&diagram=1) |
