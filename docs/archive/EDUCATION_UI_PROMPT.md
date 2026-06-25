# Education Panel UI — Developer Implementation Prompt

## Context

The Banking demo app already has two floating education panels:
- **CIBAPanel.js** — 5-tab slide-in drawer (bottom-right FAB)
- **BankingAgent.js** — MCP action panel (bottom-right FAB, stacked above CIBA)

And one existing modal:
- **Token Info Modal** — "View OAuth Token Info" button in Dashboard.js and UserDashboard.js

We need to extend this pattern so **every major OAuth/security/protocol concept** has its own dedicated education popup, each triggered by a labelled button pinned to the top of the relevant page (or globally in the header). The goal: any developer or student can click a concept button and get a self-contained explanation without leaving the page.

---

## Global Pattern — "Learn" Button Bar

Add a **horizontal pill-button bar** just below the main `<Header>` navigation (above page content) on all authenticated pages. Buttons are grouped by category:

```
[ OAuth Flows ▾ ]  [ Token Exchange ]  [ may_act / act ]  [ PKCE ]  [ CIBA ]  [ MCP Protocol ]  [ Introspection ]  [ Agent Gateway ]  [ RFC Index ]
```

Each button opens a **slide-in drawer** (same pattern as existing CIBAPanel) or a **full-screen modal** (for complex multi-step topics). All drawers/modals are independent — multiple can coexist in DOM but only one open at a time.

**Component to create:** `src/components/EducationBar.js` + `EducationBar.css`
**Mount location:** `App.js`, rendered inside authenticated routes just below `<Header />`

---

## Education Panels to Build

Each entry below specifies: trigger label · component name · panel type · tab structure · key content.

---

### 1. Login Flow (Authorization Code + PKCE)
**Button label:** `Login Flow`
**Component:** `LoginFlowPanel.js`
**Type:** Slide-in drawer, 4 tabs

| Tab | Content |
|-----|---------|
| **What happens** | Plain English 10-step walkthrough: click Login → Backend-for-Frontend (BFF) generates PKCE → redirect to PingOne → credentials → auth code → /callback → POST /token → T1 issued with `may_act` → session stored → dashboard |
| **PKCE deep dive** | What `code_verifier` and `code_challenge` are, why SHA-256, why it prevents interception even on public clients. Show the two requests side by side |
| **The Tokens** | Show an annotated example T1 JWT payload: `sub`, `aud`, `scope`, `may_act`, `exp`, `iss` — every field explained |
| **Security notes** | Why T1 never touches the browser. httpOnly cookie. Session fixation prevention (`session.regenerate()`). State = CSRF token |

**Where to also add trigger:** Login page (`Login.js`) — replace the existing `<details>` expandable with a "How does this login work?" button that opens this panel.

---

### 2. Token Exchange (RFC 8693)
**Button label:** `Token Exchange`
**Component:** `TokenExchangePanel.js`
**Type:** Slide-in drawer, 5 tabs

| Tab | Content |
|-----|---------|
| **What & Why** | Plain English: T1 is user's full token scoped for the Backend-for-Frontend (BFF). MCP Server needs a token scoped for itself. Token Exchange is how Backend-for-Frontend (BFF) swaps T1 → T2 without the user re-authenticating |
| **BEFORE (no exchange)** | The broken pattern — Backend-for-Frontend (BFF) passes T1 directly to MCP. Problems: wrong `aud`, no `act` claim, no audit trail, T1 leaks at MCP layer |
| **AFTER (RFC 8693)** | The correct flow — annotated HTTP request/response. Show the exact `POST /token` body fields: `grant_type`, `subject_token`, `subject_token_type`, `audience`, `scope`. Show T2 response with `act` claim |
| **may_act check** | The 6-step PingOne validation: T1 signature → `may_act` exists → caller matches → audience allowed → scope ⊆ original → issue T2. What happens on each failure |
| **Live tokens** | If user is authenticated: fetch and display the current T1 from session status endpoint. Show what T2 would look like if exchange were triggered now |

**Where to also add trigger:**
- `McpInspector.js` — "How token exchange works" button next to the existing explainer section
- `BankingAgent.js` — Add tab or button in the MCP panel alongside existing explainers

---

### 3. `may_act` and `act` Claims
**Button label:** `may_act / act`
**Component:** `MayActPanel.js`
**Type:** Slide-in drawer, 4 tabs

| Tab | Content |
|-----|---------|
| **What they are** | Two-sentence plain English: `may_act` = prospective permission in T1 ("this client is allowed to exchange this token"). `act` = current fact in T2 ("this client IS acting right now"). Nobody is acting until exchange happens |
| **Lifecycle** | Visual: ISSUE → EXCHANGE → USE. T1 with `may_act` (no action yet) → PingOne validates → T2 with `act` (delegation active). Show JSON of both tokens side by side |
| **Attack scenarios** | Three attacks that `may_act` blocks: (1) rogue service tries to exchange T1 it obtained — caller≠`may_act.client_id` → rejected; (2) token issued without `may_act` policy — claim missing → rejected; (3) scope escalation — requested scope not ⊆ T1 → rejected |
| **RFC 8693 spec** | Link and quote relevant sections. Explain `actor_token` optional parameter. Explain difference between `subject_token` (who the action is for) vs `actor_token` (who is acting) |

**Where to also add trigger:**
- `Dashboard.js` and `UserDashboard.js` — next to "View OAuth Token Info" button, add "What is may_act?" button
- Anywhere the decoded token is shown, annotate `may_act` / `act` fields with a `ⓘ` icon that opens this panel

---

### 4. CIBA (Client-Initiated Backchannel Authentication)
**Button label:** `CIBA`
**Component:** Extend existing `CIBAPanel.js` — it already has 5 tabs. No new component needed.
**Action:** Move CIBAPanel's FAB trigger into the Education Bar as a top-of-page button. Keep the FAB too for discoverability.
**Add one new tab: "vs Login Flow"** — side-by-side comparison: CIBA (no browser redirect, email approval, polling) vs Authorization Code (browser redirect, login page, immediate redirect back).

---

### 5. MCP Protocol
**Button label:** `MCP Protocol`
**Component:** `McpProtocolPanel.js`
**Type:** Slide-in drawer, 5 tabs

| Tab | Content |
|-----|---------|
| **What is MCP** | Plain English: MCP = Model Context Protocol. JSON-RPC 2.0 over WebSocket. LLM calls `tools/list` to discover what tools exist, then `tools/call` to invoke one. The Banking app exposes 7 tools |
| **Tool catalog** | List all 7 tools: `get_my_accounts`, `get_account_balance`, `get_my_transactions`, `create_transfer`, `create_deposit`, `create_withdrawal`, `query_user_by_email`. For each: description, required scopes, what it returns |
| **Auth flow** | How the MCP Server validates the token: WS initialize → introspect T2 → check `aud`, `act`, scope → run tool → call Banking API with Bearer T2. Show the JSON-RPC message shapes |
| **Two hosts** | Backend-for-Frontend (BFF) path (session cookie → T1 → RFC 8693 → T2 → MCP) vs LangChain Agent path (CIBA → T_ciba → RFC 8693 → T3 → MCP). Same MCP Server, different token origin |
| **MCP Inspector** | Link to `/mcp-inspector` page. Explain: test tools without a full agent, see raw JSON-RPC, compare Backend-for-Frontend (BFF) vs agent tokens |

**Where to also add trigger:**
- `McpInspector.js` page header — "What is MCP?" button
- `BankingAgent.js` panel — replace the inline `<details>` explainer with "Open MCP explainer" button

---

### 6. Token Introspection (RFC 7662)
**Button label:** `Introspection`
**Component:** `IntrospectionPanel.js`
**Type:** Slide-in drawer, 3 tabs

| Tab | Content |
|-----|---------|
| **What & Why** | MCP Server doesn't verify the JWT locally (no public key held locally by default). Instead it calls PingOne `/introspect` with the token. PingOne responds with active status and all claims. This is RFC 7662 |
| **Request / Response** | Show exact HTTP: `POST /introspect` with `token=<T2>` and client credentials. Show response JSON: `active`, `sub`, `aud`, `act`, `scope`, `exp`. Show what an inactive/expired token returns |
| **vs JWKS verification** | When to use introspect (need `act` claim, need real-time revocation check) vs JWKS (local fast validation, no round-trip). Banking API uses JWKS. MCP Server uses introspect to get `act` claim |

**Where to also add trigger:**
- `McpInspector.js` — "How introspection works" button
- `ActivityLogs.js` — "How audit tokens work" link

---

### 7. Agent Gateway Pattern (RFC 8707 + RFC 9728)
**Button label:** `Agent Gateway`
**Component:** `AgentGatewayPanel.js`
**Type:** Full-screen modal (complex diagram), 4 tabs

| Tab | Content |
|-----|---------|
| **Pattern overview** | Plain English: An "Agent Gateway" sits between the LLM agent and the resource servers. It does token validation and scope enforcement on behalf of all downstream tools, so individual tools don't need auth logic. Maps to the Visio reference architecture (Agent Gateway demo architecture.vsdx) |
| **Ingress vs Egress** | Ingress (MCP ingress gateway): intercepts every `tools/call`, validates token, enforces scopes. Egress (MCP egress): when the agent itself needs to call an external MCP peer — performs RFC 8693 token exchange to get a peer-scoped token. Show the swimlane diagram |
| **RFC 8707 — Resource Indicators** | What the `resource` parameter does in `/authorize` and `/token` requests. Binds the access token's `aud` to a specific RS URL at issuance time — so a token obtained for Banking API can't be replayed at MCP Server. 3-phase table: authorization request with `resource` → code → token request with `resource` → audience-bound AT → RS validates `aud` |
| **RFC 9728 — MCP Auth** | The emerging MCP authorization spec. How MCP clients discover the AS (authorization server metadata endpoint). How the `resource` parameter flows through MCP tool calls. Current implementation status in this app |

**Where to also add trigger:**
- Top of `McpInspector.js` page

---

### 8. OAuth Flows Overview (dropdown menu)
**Button label:** `OAuth Flows ▾`
**Type:** Dropdown menu with 3 items, each opening a mini-panel

| Menu item | Opens |
|-----------|-------|
| Authorization Code + PKCE | → `LoginFlowPanel.js` (panel 1 above) |
| Client-Initiated Backchannel (CIBA) | → `CIBAPanel.js` (existing) |
| Token Exchange (RFC 8693) | → `TokenExchangePanel.js` (panel 2 above) |

---

### 9. RFC Index
**Button label:** `RFC Index`
**Component:** `RFCIndexPanel.js`
**Type:** Slide-in drawer, single scrollable list

| RFC | Name | Used for in this app | Link |
|-----|------|---------------------|------|
| RFC 6749 | OAuth 2.0 Authorization Framework | Authorization Code flow | spec link |
| RFC 7636 | PKCE | code_challenge / code_verifier on login | spec link |
| RFC 7519 | JWT | All tokens T1, T2, T3, T_ciba | spec link |
| RFC 7517 | JWK | JWKS endpoint for Banking API token validation | spec link |
| RFC 7662 | Token Introspection | MCP Server introspects T2 to get `act` claim | spec link |
| RFC 8693 | Token Exchange | Backend-for-Frontend (BFF) swaps T1 → T2, Agent swaps T_ciba → T3 | spec link |
| RFC 8707 | Resource Indicators | Binds token `aud` to RS URL at issuance | spec link |
| RFC 9449 | DPoP | Optional binding (egress token exchange) | spec link |
| RFC 9728 | OAuth for MCP | MCP authorization server discovery | spec link |
| RFC 7523 | JWT Client Auth | Agent client_assertion in token exchange | spec link |
| OIDC Core 1.0 | OpenID Connect | `openid` scope, `/userinfo`, ID tokens | spec link |
| OIDC CIBA 1.0 | Backchannel Auth | `/bc-authorize`, `auth_req_id`, polling | spec link |

Each row: click → opens the relevant panel above directly to the tab that covers this RFC.

---

## Additional Page-Specific Triggers

Beyond the global bar, add contextual buttons directly on specific pages:

### Dashboard.js and UserDashboard.js
- Next to "View OAuth Token Info" button → add `What is may_act?` (opens MayActPanel)
- Inside the token modal, annotate `may_act` / `act` / `scope` fields with `ⓘ` icons
- Add `How does login work?` button at top of page (opens LoginFlowPanel)

### McpInspector.js
- Replace inline "How MCP tools work" text section with tabbed panel buttons:
  - `What is MCP?` → McpProtocolPanel
  - `How token exchange works` → TokenExchangePanel
  - `How introspection works` → IntrospectionPanel
  - `Agent Gateway pattern` → AgentGatewayPanel

### ActivityLogs.js
- Add `How are audit logs created?` button at top → opens IntrospectionPanel on "What & Why" tab (introspection is how `act` claim gets logged)

### Login.js
- Replace existing `<details>` expandable with `How does this login work?` button → LoginFlowPanel
- Add `What is CIBA?` button → CIBAPanel (for the "other path" awareness)

### SecuritySettings.js
- Add `What is step-up MFA?` button → mini explainer panel (new: `StepUpPanel.js`, 2 tabs: "What is step-up" + "ACR values in PingOne")
- Add `What is PingOne Authorize?` button → mini explainer (2 tabs: "What it does" + "Policy configuration")

### BankingAgent.js panel
- Replace inline `<details>` learn sections with two buttons:
  - `How OAuth + MCP work together` → McpProtocolPanel tab 3 (Auth flow)
  - `Token exchange explained` → TokenExchangePanel

---

## Implementation Notes

### Shared drawer component
Create `src/components/shared/EducationDrawer.js` — a reusable drawer shell:
```
props: { isOpen, onClose, title, tabs: [{ label, content }], width? }
```
All panels use this shell. Tabs rendered as pill buttons at top of drawer. Consistent close button (×), header, and scroll area.

### Shared full-screen modal
Create `src/components/shared/EducationModal.js`:
```
props: { isOpen, onClose, title, tabs }
```
Used for AgentGatewayPanel only (needs more horizontal space for diagrams).

### State management
Each panel has its own `useState(false)` for open/closed. The EducationBar holds refs and passes open handlers down. No global state needed — panels are independent.

### Button styling
```css
.edu-bar-button {
  padding: 5px 14px;
  border-radius: 20px;
  border: 1px solid #6c8ebf;
  background: white;
  font-size: 12px;
  cursor: pointer;
  color: #333;
}
.edu-bar-button:hover { background: #dae8fc; }
.edu-bar-button.dropdown { padding-right: 8px; }
```

### Content source
Use the step-by-step plain English document (`STEP_BY_STEP.md` / `ciba.md`) and the Mermaid diagrams in `LUCIDCHART_DIAGRAMS.md` as the source of truth for all panel content. Render diagrams as SVG or static PNG — do not require a live Mermaid renderer in production.

### Priority order
1. `TokenExchangePanel` — highest impact, currently buried in CIBA panel
2. `MayActPanel` — core novel concept of this demo
3. `LoginFlowPanel` — most common first question from devs
4. `McpProtocolPanel` — needed for MCP Inspector page
5. `AgentGatewayPanel` — ties to reference Visio/new Diagram 0
6. `RFCIndexPanel` — quick reference, low complexity
7. `IntrospectionPanel` — supporting detail
8. `EducationBar` global mount — do last, after individual panels exist
