# Plan: Enterprise-Managed MCP Authorization (P1-DEMO2)

**Status:** Draft — plan only, not implemented  
**Spec:** [MCP Enterprise-Managed Authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization)  
**Extension ID:** `io.modelcontextprotocol/enterprise-managed-authorization`  
**Related edu panel:** `demo_api_ui` → Enterprise-Managed Auth (`EDU.ENTERPRISE_MANAGED_AUTH`)  
**Related edu panel:** ID-JAG / Cross-App Access (`EDU.ID_JAG`)

---

## 1. Goal

Demonstrate **enterprise-managed MCP access** in the banking demo: employees authenticate once with corporate SSO (PingOne), IT controls which MCP servers they may use, and users **do not** go through per-server OAuth consent for each MCP resource.

The demo must remain honest: PingOne does not yet ship native **ID-JAG** end-to-end. Phase 2 uses **RFC 8693 token exchange as a stand-in** for ID-JAG → MCP access token, clearly labeled in UI and education content.

---

## 2. Non-goals

- Replacing RFC 8693 delegation (`may_act` / actor token) for agent tool calls
- Breaking existing consumer-mode flow (default remains current behavior)
- Implementing a full IdP admin console (PingOne admin is the real console)
- Committing kubeconfig, secrets, or live PingOne policy changes in repo
- Claiming full spec compliance before ID-JAG is available on PingOne

---

## 3. Current state (baseline)

| Layer | Today |
|-------|--------|
| User login | PingOne Auth Code + PKCE → BFF session |
| Agent connect | User explicitly authorizes / connects agent (consent-oriented) |
| MCP token | `agentMcpTokenService.js` — RFC 8693 exchange (user token + agent actor) |
| MCP gateway | `demo_mcp_gateway` — introspection, audience, Authorize gate |
| Resource metadata | RFC 9728 at `/.well-known/oauth-protected-resource` |
| MCP client | LangChain agent receives tokens from BFF internal API; no EMA extension in `initialize` |
| Education | Enterprise-Managed Auth + ID-JAG panels exist; demo marked as not enabled |

**Protected areas (read before coding):** `REGRESSION_PLAN.md` §1 — OAuth, token exchange, BFF session, UI auth surfaces.

---

## 4. Target behavior (enterprise mode ON)

1. Employee logs in via PingOne SSO (unchanged).
2. IT has pre-approved MCP resource servers for their population/group.
3. On first agent use (or immediately post-login), BFF mints MCP access token **without** a separate "Connect to MCP" OAuth redirect.
4. Token Chain UI shows **Enterprise-managed mode** and labels RFC 8693 as ID-JAG stand-in.
5. User not in allowed group → clear 403 with IT-policy message (no silent fallback).
6. Logout / IdP disable → MCP calls fail on next request.

---

## 5. Architecture

```text
┌─────────────┐     SSO      ┌──────────────┐   policy check   ┌─────────────┐
│  React UI   │─────────────▶│  BFF (API)   │─────────────────▶│  PingOne    │
└─────────────┘              │  session     │   group/pop      │  (IdP+AS)   │
       │                     └──────┬───────┘                  └──────▲──────┘
       │                            │ RFC 8693 stand-in               │
       │                            │ (Phase 2) or ID-JAG (Phase 3)   │
       │                            ▼                                 │
       │                     ┌──────────────┐                         │
       └────────────────────▶│ MCP Gateway  │◀── MCP access token ──┘
                             └──────┬───────┘
                                    ▼
                             ┌──────────────┐
                             │  MCP Server  │
                             └──────────────┘
```

**Principle:** Token minting stays in the **BFF**, not the LangChain container or browser (matches existing security model).

---

## 6. Phased delivery

### Phase 1 — Metadata + mode switch (low risk)

**Outcome:** Spec-visible declaration; toggle between consumer and enterprise mode; no auth behavior change yet.

| Task | File(s) | Notes |
|------|---------|-------|
| Add feature flag | `configStore`, Quick Flags (`QuickFlagsPill.js`), `.env.example` | `ff_enterprise_managed_mcp_auth` default **off** |
| Extend RFC 9728 metadata | `demo_api_server/routes/protectedResourceMetadata.js` | Add `extensions["io.modelcontextprotocol/enterprise-managed-authorization"]` when flag on |
| Gateway auth hint | `demo_mcp_gateway/src/index.ts` | When flag on, 401/`WWW-Authenticate` indicates enterprise-managed (no auth-code challenge) |
| UI mode badge | `BankingAgent.js`, Token Chain components | "Consumer" vs "Enterprise-managed" |
| Tests | `demo_api_server/src/__tests__/rfc9728-integration.test.js` | Assert extension block present when flag on |

**Acceptance criteria:**
- [ ] Flag off → identical behavior to today
- [ ] Flag on → metadata includes extension block; UI shows enterprise badge
- [ ] No regression in `./run-tests.sh unit`

---

### Phase 2 — Simulated EMA flow (demo-ready)

**Outcome:** Enterprise story works in demo: SSO once, group gate, no connect click, RFC 8693 stand-in.

| Task | File(s) | Notes |
|------|---------|-------|
| Enterprise token resolver | `demo_api_server/services/agentMcpTokenService.js` | New `resolveMcpTokenEnterpriseManaged()` branch |
| Group/policy gate | New `enterpriseMcpPolicyService.js` or extend `pingOneUserService` | Check population/group membership before exchange |
| Skip agent connect UI | `BankingAgent.js`, agent session routes | When EMA on + policy pass, auto-establish agent MCP session |
| Session middleware | `demo_api_server/middleware/agentSessionMiddleware.js` | Allow agent routes when enterprise session valid without separate consent flag |
| Config | `demo_api_server/.env.example` | `ENTERPRISE_MCP_ALLOWED_GROUPS`, `ENTERPRISE_MCP_RESOURCE_URIS` |
| Token Chain labels | Token exchange UI components | "ID-JAG equivalent (RFC 8693 stand-in)" |
| Deny path | BFF + UI | 403 `enterprise_mcp_policy_denied` with remediation text |
| Integration test | `demo_api_server/src/__tests__/enterpriseMcpAuth.test.js` | Allowed group → token; denied → 403 |
| Edu panel update | `EnterpriseManagedAuthPanel.js` tab "In This Demo" | Reflect Phase 2 behavior when shipped |

**Policy model (v1 — keep simple):**
- Allowed PingOne population IDs or group names (env/config)
- Allowed MCP resource URIs must match existing `MCP_SERVER_RESOURCE_URI` / scope topology
- No dynamic IdP MCP server registry in v1

**Acceptance criteria:**
- [ ] EMA on + user in group → agent works without "Connect MCP" step
- [ ] EMA on + user not in group → 403 before token exchange
- [ ] EMA off → existing connect + RFC 8693 flow unchanged
- [ ] Token Chain shows enterprise mode + stand-in label
- [ ] Audit log event: `enterprise_mcp.policy_check`, `enterprise_mcp.token_issued`

---

### Phase 3 — Real ID-JAG path (blocked on PingOne product)

**Outcome:** Spec-aligned token path when PingOne exposes ID-JAG issuance + validation.

| Task | File(s) | Notes |
|------|---------|-------|
| ID-JAG client | `demo_api_server/services/idJagService.js` | Exchange user ID token for ID-JAG at IdP |
| MCP AS exchange | Same service | POST to token endpoint with `jwt-bearer` grant + ID-JAG assertion |
| Account linking | BFF user lookup | Map IdP `sub` (primary) / `email` (fallback) to demo user |
| MCP client extension | `langchain_agent/src/mcp/connection.py` | Declare extension in `initialize`; call BFF on EMA challenge |
| Revocation demo | Docs + optional admin script | Disable user in PingOne → verify MCP failure |
| Replace stand-in label | UI | "Native ID-JAG" when Phase 3 active |

**Prerequisites:**
- PingOne ID-JAG token endpoint or DaVinci flow (see `IdJagPanel.js` limitations tab)
- Trust relationship: MCP AS validates IdP-issued assertions (JWKS)

**Acceptance criteria:**
- [ ] No browser redirect to MCP AS authorize endpoint in enterprise mode
- [ ] Token endpoint-only flow documented in Token Chain
- [ ] Parity test: enterprise mode works on Docker and SE K8 deploy

---

### Phase 4 — IT admin UX (optional polish)

| Task | Notes |
|------|-------|
| Admin settings page section | List approved MCP servers + allowed groups (read from config) |
| Provisioning hook | `pingoneProvisionService.js` — document redirect URIs for SE URL |
| SE K8 note | `docs/user-guide/PING-SE-K8-RUNBOOK.md` — EMA flag behavior on cluster |

---

## 7. Feature flag contract

| Flag | Default | Effect |
|------|---------|--------|
| `ff_enterprise_managed_mcp_auth` | `false` | Master switch for all Phase 1–2 behavior |

**Env vars (Phase 2):**

```bash
# Comma-separated PingOne group names or population IDs allowed MCP access
ENTERPRISE_MCP_ALLOWED_GROUPS=banking-agents,employees

# Optional override; defaults to scope-topology MCP resource URIs
ENTERPRISE_MCP_RESOURCE_URIS=mcpserver.ping.demo,mcpgateway.ping.demo
```

---

## 8. API / error contract

| Code | HTTP | When |
|------|------|------|
| `enterprise_mcp_policy_denied` | 403 | User not in allowed group/population |
| `enterprise_mcp_idp_error` | 502 | PingOne policy or token call failed |
| `enterprise_mcp_not_enabled` | 400 | Client requested EMA path but flag off |

All errors: user-safe message + `requestId`; no token leakage in logs.

---

## 9. UI / education updates

| Surface | Change |
|---------|--------|
| Enterprise-Managed Auth edu panel | Update "In This Demo" after Phase 2 |
| Token Chain | Mode badge + stand-in vs native ID-JAG label |
| Quick Flags | Toggle with tooltip linking to edu panel |
| Learning Hub | Already wired to edu panel |
| MCP Inspector toolbar | Already wired |

---

## 10. Testing plan

| Level | Scope |
|-------|--------|
| Unit | Metadata extension, policy service, flag gating in `agentMcpTokenService` |
| API | `enterpriseMcpAuth.test.js` — allow/deny paths |
| Regression | `./run-tests.sh unit` + existing RFC 8693 compliance tests with flag **off** |
| Manual | Login → agent query without connect (EMA on); user outside group denied |
| SE K8 | Deploy with flag on; verify `https://ai-demo.ping-devops.com` OAuth callbacks unchanged |

---

## 11. Rollout & demo script

**Consumer demo (default):** unchanged — shows user consent + RFC 8693 delegation.

**Enterprise demo:**
1. Enable `ff_enterprise_managed_mcp_auth` in Quick Flags (or env).
2. Log in as user in `banking-agents` group.
3. Open agent — no "Connect MCP" step.
4. Show Token Chain → enterprise mode + stand-in label.
5. Open edu panel → Enterprise-Managed Authorization.
6. (Optional) Log in as user outside group → policy denial.

**Talking points for SE:**
- PingOne = enterprise IdP + MCP AS
- PingGateway + Authorize = resource enforcement
- ID-JAG = on roadmap; RFC 8693 proves delegation mechanics today

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Regression in OAuth/session | Flag default off; parallel code path; regression-guard skill |
| Overclaiming ID-JAG compliance | UI + edu always say "stand-in" until Phase 3 |
| PingOne group API latency | Cache group membership per session (short TTL) |
| Protected auth files touched | Minimal diff; read `REGRESSION_PLAN.md` §1 first |
| SE vs local config drift | Document flag in `.env.example` only; no secrets in repo |

---

## 13. Effort estimate

| Phase | Effort | Depends on |
|-------|--------|------------|
| Phase 1 | 1–2 days | — |
| Phase 2 | 4–6 days | Phase 1 |
| Phase 3 | 2–4 weeks | PingOne ID-JAG availability |
| Phase 4 | 2–3 days | Phase 2 |

---

## 14. Implementation order (recommended)

1. Phase 1 — flag + metadata + UI badge  
2. Phase 2 — policy gate + skip connect + tests  
3. Update edu panel "In This Demo"  
4. Phase 3 when PingOne ready  
5. Phase 4 if SE asks for admin UX  

---

## 15. Open questions

1. **Which PingOne group** should the demo use by default? (`banking-agents` population vs custom group name)
2. **Auto-connect on login** vs **on first agent message** — which is clearer for SE demos?
3. **PingGateway (SE K8)** vs **demo MCP gateway** — should EMA metadata be published on both resource URIs?
4. **Phase 3 trigger:** DaVinci-based ID-JAG simulation acceptable as interim before native PingOne?

---

## 16. References

- [MCP Enterprise-Managed Authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization)
- [ID-JAG draft](https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/)
- [RFC 8693 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693) — current demo implementation
- [RFC 9728 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- Repo: `demo_api_server/services/agentMcpTokenService.js`
- Repo: `demo_api_ui/src/components/education/EnterpriseManagedAuthPanel.js`
