# Education Panels — Elicitation + Content Refresh Design

**Date:** 2026-05-20  
**Status:** Approved  
**Scope:** New `ElicitationPanel` + copy/content edits to 8 existing education panels

---

## Overview

Two parallel workstreams:

1. **New panel** — `ElicitationPanel` covering the MCP Elicitation draft spec (form mode, URL mode, security model)
2. **Content refresh** — targeted copy edits inside existing tabs on 8 panels, based on newer internal demo walkthrough material and current Ping developer docs

Both workstreams follow the established `EducationDrawer` + `EducationPanelsHost` + `AdminSideNav` pattern. No new infrastructure, no new abstractions.

---

## Part 1 — New: ElicitationPanel

### File

`demo_api_ui/src/components/education/ElicitationPanel.js`

### Pattern

Identical to `McpProtocolPanel.js`:
- Import `EducationDrawer` from `../shared/EducationDrawer`
- Export a default function `ElicitationPanel({ isOpen, onClose, initialTabId })`
- Build a `tabs` array and return `<EducationDrawer ... />`
- No CSS file needed — all styling via existing `edu-*` classes and inline styles consistent with other panels

### Tabs

#### Tab 1 — `what` / "What is Elicitation"

Plain-English explanation:

- Servers can ask users for more information **mid-tool-call**, nested inside `tools/call` or `resources/read` processing
- Two modes: **form mode** (structured in-band data collection) and **URL mode** (out-of-band navigation for sensitive flows)
- The 3-action response model: **accept** (user submitted), **decline** (user explicitly rejected), **cancel** (user dismissed without choosing)
- Clients must clearly show which server is requesting info and always provide a way to decline
- Servers must NOT use form mode for passwords, API keys, access tokens, or payment credentials

#### Tab 2 — `form-mode` / "Form Mode"

How structured form elicitation works:

- `requestedSchema` is a flat JSON Schema object — no nested objects, no arrays-of-objects
- Supported primitive types: `string` (with `format`: email, uri, date, date-time), `number`/`integer`, `boolean`, `enum` (single-select with or without titles via `oneOf`), multi-select array enum
- JSON-RPC request/response shape with a full example (contact info: name string, email string with format, age number with minimum)
- Accept response carries `content` matching the schema; decline/cancel omit `content`
- Clients should pre-populate fields from `default` values in the schema
- Security constraint: servers MUST NOT request sensitive credentials via form mode

#### Tab 3 — `url-mode` / "URL Mode"

Out-of-band URL elicitation for sensitive flows:

- Used for: OAuth flows to third-party services, payment processing, API key entry — anything that must not transit the MCP client
- Required params: `mode: "url"`, `elicitationId` (unique per request), `url`, `message`
- `accept` response means user consented to open the URL — not that the interaction is complete
- Completion notification: `notifications/elicitation/complete` with `elicitationId` — server sends when the out-of-band flow finishes
- Client safe URL handling rules: show full URL before consent, do NOT auto-fetch, do NOT open without consent, use a secure browser context (not a WebView that the app can inspect)
- Phishing mitigation: server must verify the user who opens the URL is the same user who triggered the elicitation (e.g. session cookie / `sub` claim comparison) — concrete example of the rogue-click attack and how to prevent it
- Distinction from MCP authorization: URL mode elicitation is for the MCP server getting third-party access on behalf of the user, NOT for the client authorizing to the MCP server

#### Tab 4 — `in-repo` / "In this repo"

Practical tie-in:

- Note that the demo MCP server (`demo_mcp_server/`) does not currently implement elicitation — this tab explains what the wiring would look like when it does
- Where in the BFF the `InputRequiredResult` would be handled: `demo_api_server/services/mcpWebSocketClient.js`
- Link to the MCP spec: `https://modelcontextprotocol.io/specification/draft/client/elicitation`
- Cross-link to MCP Protocol panel (`EDU.MCP_PROTOCOL`) for the broader MCP context

### Registration — 3 files to update

**`educationIds.js`** — add one entry:
```js
/** MCP Elicitation — server-to-client requests for user input during tool calls (form mode + URL mode) */
MCP_ELICITATION: "mcp-elicitation",
```

**`EducationPanelsHost.js`** — add import + JSX entry:
```js
import ElicitationPanel from "./ElicitationPanel";
// ...in the return <>:
<ElicitationPanel isOpen={panel === EDU.MCP_ELICITATION} onClose={close} initialTabId={tab} />
```

**`AdminSideNav.jsx`** — add one nav item in the MCP cluster (after the existing `MCP_PROTOCOL` entries, around line 378):
```js
{ label: "MCP Elicitation", action: () => openEdu(EDU.MCP_ELICITATION, "what") },
```

---

## Part 2 — Content Edits to Existing Panels

All changes are copy/content edits inside existing tabs. No new tabs. No structural changes.

### MayActPanel — 3 edits

**File:** `demo_api_ui/src/components/education/MayActPanel.js`

**Tab `what` (Plain English):**  
Add at the start of the tab, before the landlord analogy: "The delegation lifecycle starts with explicit user consent. If you haven't authorized the agent, PingOne will not issue a delegated token — no consent means no delegation."

**Tab `attacks` (Why it's secure) — item 1:**  
Expand the "rogue app" bullet with a concrete example:
"Example: Agent A's `client_id` is `abc-123`. Your access token has `may_act: { sub: 'abc-123' }`. Rogue agent B (`client_id: xyz-999`) attempts the exchange using your token as the subject. PingOne checks that the presenting `actor_token.sub` (`xyz-999`) matches `may_act.sub` (`abc-123`) — it doesn't, so PingOne returns `invalid_grant` and the exchange is rejected."

**Tab `lifecycle` (Step by step) — step 2:**  
After the exchange description, reinforce: "The actor token in Exchange #1 is the agent's own identity proof — it's obtained via client credentials and proves the agent app is who it claims to be, independent of the user's token."

---

### TokenFlowPanel — 3 edits

**File:** `demo_api_ui/src/components/education/TokenFlowPanel.js`

**Tab `overview`:**  
In the "Why Two Exchanges?" section, add after the two-exchange list: "In multi-service deployments, this pattern extends naturally — a separate exchange produces a token scoped to each backend service, with its own `aud` and minimal `scope`. Each service sees only the token meant for it."

**Tab `token-inventory`:**  
Below the token table, add a note: "The live demo surfaces the full decoded token set in the Token Chain panel — you can inspect `sub`, `aud`, `scope`, `act`, and `may_act` for each token after a tool call."

**Tab `scopes-resources`:**  
In the Resource URIs section, add: "Each route or service enforces its own audience and scope independently. A token valid for the MCP server resource is not valid at the banking API resource, even if both are in the same PingOne environment. The gateway enforces this boundary at each route."

---

### PingGatewayMcpPanel — 3 edits

**File:** `demo_api_ui/src/components/education/PingGatewayMcpPanel.js`

**`OverviewTab` — headline point:**  
Add as the first paragraph: "**MCP servers contain no security logic.** Token validation, scope enforcement, protocol compliance, rate limiting, and audit all live in the gateway. The MCP server trusts that whatever reaches it has already been authorized — it focuses entirely on tool execution."

**`ArchitectureTab` — route-level examples:**  
Add a section "Route-level enforcement example" showing two routes with distinct scope requirements:
`/ecommerce` → requires scope: `read`, `write`
`/crm` → requires scope: `crm:read`, `crm:write`
Each route is independently configured — a token scoped for `/ecommerce` is rejected at `/crm`.

**`OfficialFiltersTab` — audit attribution:**  
After the `McpAuditFilter` row description, add: "Audit log entries include user email (from `sub` claim resolution), agent `client_id` (from `act.sub`), the full delegation chain (`act` nesting), the target service, and request latency — giving complete attribution for every tool invocation."

---

### PingOneAuthorizePanel — 3 edits

**File:** `demo_api_ui/src/components/education/PingOneAuthorizePanel.js`

**Tab `what`:**  
Add a concrete policy example: "Example: A customer on the basic tier requests an upgrade to Platinum. PingOne Authorize evaluates: `tool=upgrade_tier`, `targetField=tier`, `targetValue=Platinum`, `customerTier=basic` → **DENY**. The policy returns a denial with the matched rule visible in the Recent Decisions view. The agent receives the denial and can explain to the user why the upgrade isn't available."

Also add: "The policy logic lives centrally in PingOne Authorize — not in the agent, the MCP server, or the gateway. Any of those components changing doesn't affect the policy. New tools automatically get evaluated against the same rules without code changes."

**Tab `recent`:**  
Update the section intro to mention: "The PingOne Authorize console Recent Decisions view shows which rule fired, the full input parameters evaluated, and the decision output — useful for diagnosing unexpected PERMIT or DENY results during a demo."

---

### HumanInLoopPanel — 2 edits

**File:** `demo_api_ui/src/components/education/HumanInLoopPanel.js`

**Tab `what` (What is HITL?):**  
Add after the opening paragraph: "The simplest rule: **reads can proceed if policy permits; writes require explicit approval.** Querying account balances doesn't need a human in the loop. Transferring funds does. No consent, no delegation — the agent cannot complete a write operation without an explicit human approval signal."

**Tab `patterns`:**  
In the "Why human oversight matters" section, add to the list: "**Blur the read/write line** — agents that treat reads and writes identically apply unnecessary friction to harmless queries while potentially under-protecting mutations. Distinguishing the two makes approval flows proportionate."

---

### StepUpPanel — 2 edits

**File:** `demo_api_ui/src/components/education/StepUpPanel.js`

**Tab `what` (What is step-up):**  
Add a sequencing clarification before the existing content: "Step-up is the **second gate**, not the first. The sequence is: (1) policy decision — PingOne Authorize evaluates whether the action is permitted at all; (2) if permitted and it's a write operation, step-up authentication triggers to confirm the user's identity. A DENY from policy stops the flow before step-up is ever requested."

**Tab `ciba` (CIBA Backchannel):**  
Make the phone approval narrative more prominent — add near the top of the tab: "The most common path: the user gets a push notification on their phone, reviews the transaction details, and taps **Approve**. The agent is waiting and retries the tool call automatically once approval arrives. The user never needs to return to the browser."

---

### LoginFlowPanel — 2 edits

**File:** `demo_api_ui/src/components/education/LoginFlowPanel.js`

**Tab `what` (What happens):**  
Add after the existing flow description: "All client applications redirect to the **same centralized PingOne sign-on UI** — the app never renders its own login form. This means any change to authentication policy (new MFA requirement, new SSO provider, branding update) propagates automatically to every connected app without code changes."

**Tab `inrepo` (In this repo):**  
Add a redirect page note: "The redirect callback page (`/callback`) is intentionally minimal — static HTML with no JavaScript beyond the OAuth code exchange. Avoid rendering frameworks or lazy-loaded bundles on this page; delayed JavaScript execution can cause the auth code to expire before it's exchanged, producing silent login failures."

---

## Consistency rules (all panels)

- No new emojis beyond `⚠️`, `✅`, `❌` (per CLAUDE.md §0)
- All inline styles match existing panel patterns (dark tables use `#1e293b` background, body text uses `#374151`, code uses `.edu-code` className)
- No new CSS files
- All external links: `target="_blank" rel="noopener noreferrer"`
- Spec links point to `https://modelcontextprotocol.io/specification/draft/client/elicitation`

---

## Files touched

| File | Change type |
|---|---|
| `src/components/education/ElicitationPanel.js` | **New** |
| `src/components/education/educationIds.js` | Add 1 constant |
| `src/components/education/EducationPanelsHost.js` | Add 1 import + 1 JSX entry |
| `src/components/AdminSideNav.jsx` | Add 1 nav item |
| `src/components/education/MayActPanel.js` | 3 copy edits |
| `src/components/education/TokenFlowPanel.js` | 3 copy edits |
| `src/components/education/PingGatewayMcpPanel.js` | 3 copy edits |
| `src/components/education/PingOneAuthorizePanel.js` | 3 copy edits |
| `src/components/education/HumanInLoopPanel.js` | 2 copy edits |
| `src/components/education/StepUpPanel.js` | 2 copy edits |
| `src/components/education/LoginFlowPanel.js` | 2 copy edits |

**Total: 11 files, 1 new file + 10 edits**

---

## Success criteria

- `cd demo_api_ui && npm run build` exits 0
- All 11 panels open from AdminSideNav without errors
- ElicitationPanel slides in from the right, identical animation to other education drawers
- No new console errors or React warnings in flows that touch updated panels
- No emojis introduced beyond the permitted set
