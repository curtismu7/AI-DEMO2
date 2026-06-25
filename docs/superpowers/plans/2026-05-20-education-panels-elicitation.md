# Education Panels — Elicitation + Content Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `ElicitationPanel` education drawer covering the MCP Elicitation draft spec, and apply targeted copy/content edits to 8 existing panels based on updated demo walkthrough material.

**Architecture:** All panels use the `EducationDrawer` shell from `src/components/shared/EducationDrawer.js` — a right-side slide-in drawer with pill tabs. Panel visibility is managed by `EducationUIContext` (a single `panel` + `tab` state pair). `EducationPanelsHost.js` mounts all panels; `AdminSideNav.jsx` triggers them via `openEdu(EDU.<ID>, tabId)`.

**Tech Stack:** React (CRA, `.js` files with JSX), existing `EducationDrawer` component, `EducationUIContext`, inline styles + `edu-*` CSS classes. No new dependencies.

---

## File Map

| File | Action |
|---|---|
| `src/components/education/ElicitationPanel.js` | **Create** — new panel, 4 tabs |
| `src/components/education/educationIds.js` | **Modify** — add `MCP_ELICITATION` constant |
| `src/components/education/EducationPanelsHost.js` | **Modify** — add import + JSX entry |
| `src/components/AdminSideNav.jsx` | **Modify** — add 1 nav item in MCP cluster |
| `src/components/education/MayActPanel.js` | **Modify** — 3 copy edits |
| `src/components/education/TokenFlowPanel.js` | **Modify** — 3 copy edits |
| `src/components/education/PingGatewayMcpPanel.js` | **Modify** — 3 copy edits |
| `src/components/education/PingOneAuthorizePanel.js` | **Modify** — 3 copy edits |
| `src/components/education/HumanInLoopPanel.js` | **Modify** — 2 copy edits |
| `src/components/education/StepUpPanel.js` | **Modify** — 2 copy edits |
| `src/components/education/LoginFlowPanel.js` | **Modify** — 2 copy edits |

All paths relative to `demo_api_ui/`.

---

## Conventions (read before starting)

- **No emojis** beyond `⚠️`, `✅`, `❌` anywhere in UI text, code, or comments (CLAUDE.md §0)
- **Inline styles** match existing panels: body text `color: '#374151'`, dark table header `background: '#1e293b'`, code blocks use `className="edu-code"`, section font size `fontSize: '0.82rem'`
- **External links** always: `target="_blank" rel="noopener noreferrer"`
- **No new CSS files**
- **Build gate**: after every commit, the plan notes when to run `cd demo_api_ui && npm run build` — exit must be 0

---

## Task 1: Add `MCP_ELICITATION` to educationIds

**Files:**
- Modify: `demo_api_ui/src/components/education/educationIds.js`

- [ ] **Step 1: Add the constant after `WEB_MCP`**

Open `src/components/education/educationIds.js`. The last entry is `WEB_MCP: "web-mcp"`. Add after it:

```js
  /** MCP Elicitation — server-to-client requests for user input during tool calls (form mode + URL mode) */
  MCP_ELICITATION: "mcp-elicitation",
```

The full tail of the file should look like:
```js
  /** WebMCP — Browser-native MCP tool access via BFF proxy; tokens stay server-side */
  WEB_MCP: "web-mcp",
  /** MCP Elicitation — server-to-client requests for user input during tool calls (form mode + URL mode) */
  MCP_ELICITATION: "mcp-elicitation",
};
```

- [ ] **Step 2: Verify no syntax error**

```bash
cd demo_api_ui && node -e "const e = require('./src/components/education/educationIds.js'); console.log(e.EDU.MCP_ELICITATION)"
```

Expected output: `mcp-elicitation`

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/education/educationIds.js
git commit -m "feat(edu): add MCP_ELICITATION id to educationIds"
```

---

## Task 2: Create ElicitationPanel

**Files:**
- Create: `demo_api_ui/src/components/education/ElicitationPanel.js`

- [ ] **Step 1: Create the file**

```js
// demo_api_ui/src/components/education/ElicitationPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

export default function ElicitationPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();

  const tabs = [
    {
      id: 'what',
      label: 'What is Elicitation',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Servers asking users for more information</h3>
          <p>
            MCP Elicitation is a mechanism that lets MCP servers request additional information from
            users <strong>mid-tool-call</strong> — while processing a <code>tools/call</code> or{' '}
            <code>resources/read</code> request. Instead of failing when it needs more context, the
            server pauses, asks, and resumes once the user responds.
          </p>
          <p>
            The server sends an <code>elicitation/create</code> request to the client. The client
            presents UI to the user, collects a response, and sends it back. Execution then continues
            with the new information.
          </p>

          <h4>Two modes</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#cbd5e1' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Mode</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>When to use</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Data visibility</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Form mode', 'Structured data collection — names, preferences, settings', 'Data passes through the MCP client'],
                ['URL mode', 'Sensitive flows — OAuth, payments, API keys', 'Data does NOT pass through the client'],
              ].map(([mode, use, vis], i) => (
                <tr key={mode} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', fontWeight: 600 }}>{mode}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', color: '#374151' }}>{use}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', color: '#374151' }}>{vis}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>The three response actions</h4>
          <p>
            Every elicitation response uses one of three actions — regardless of mode:
          </p>
          <ul style={{ fontSize: '0.82rem', lineHeight: 1.8 }}>
            <li><strong>accept</strong> — the user explicitly submitted or consented. For form mode, the <code>content</code> field contains the submitted data.</li>
            <li><strong>decline</strong> — the user explicitly rejected the request (e.g. clicked "No", "Reject").</li>
            <li><strong>cancel</strong> — the user dismissed without choosing (closed the dialog, pressed Escape, browser navigated away).</li>
          </ul>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            Servers must handle all three. A decline is not the same as a cancel — design your server logic accordingly.
          </p>

          <h4>Client responsibilities</h4>
          <ul style={{ fontSize: '0.82rem', lineHeight: 1.8 }}>
            <li>Clearly display <strong>which server</strong> is requesting the information</li>
            <li>Always provide a way to decline or cancel</li>
            <li>For form mode: let users review and modify their response before submitting</li>
            <li>For URL mode: show the full URL before navigation and require explicit consent</li>
          </ul>

          <div className="edu-info-box edu-info-box--warning" style={{ marginTop: '1rem' }}>
            Servers <strong>must not</strong> use form mode to request passwords, API keys, access tokens,
            or payment credentials. Those flows must use URL mode so the data never passes through the
            MCP client.
          </div>

          <p style={{ marginTop: '1rem', fontSize: '0.82rem' }}>
            <strong>See also:</strong>{' '}
            <button
              type="button"
              onClick={() => open(EDU.MCP_PROTOCOL, 'what')}
              style={{ background: 'none', border: 'none', color: 'var(--brand-navy)', cursor: 'pointer', padding: 0, textDecoration: 'underline', font: 'inherit' }}
            >
              How the AI banking assistant works (MCP Protocol)
            </button>
          </p>
        </>
      ),
    },
    {
      id: 'form-mode',
      label: 'Form Mode',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Structured in-band data collection</h3>
          <p>
            Form mode elicitation lets a server define a JSON Schema describing what it needs. The
            client renders a form from that schema, validates the user's input, and returns it in the
            response. The schema is intentionally limited to <strong>flat objects with primitive
            properties</strong> — no nested objects, no arrays of objects.
          </p>

          <h4>Supported field types</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#cbd5e1' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Type</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Key constraints</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Formats / notes</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['string', 'minLength, maxLength, pattern', 'format: email | uri | date | date-time'],
                ['number / integer', 'minimum, maximum', '—'],
                ['boolean', '—', 'renders as checkbox'],
                ['enum (single)', 'enum: [...] or oneOf: [{const, title}]', 'renders as select / radio'],
                ['enum (multi)', 'type: array, items.enum or items.anyOf', 'minItems, maxItems'],
              ].map(([type, constraints, notes], i) => (
                <tr key={type} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb' }}><code>{type}</code></td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', color: '#374151', fontSize: '0.78rem' }}>{constraints}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', color: '#374151', fontSize: '0.78rem' }}>{notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            All types support an optional <code>default</code> value. Clients should pre-populate
            form fields from these defaults.
          </p>

          <h4>Full example — contact info request</h4>
          <pre className="edu-code" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>{`// Server sends:
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "elicitation/create",
  "params": {
    "mode": "form",
    "message": "Please provide your contact information",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "name":  { "type": "string", "description": "Your full name" },
        "email": { "type": "string", "format": "email", "description": "Your email address" },
        "age":   { "type": "number", "minimum": 18, "description": "Your age" }
      },
      "required": ["name", "email"]
    }
  }
}

// Client responds (user accepted):
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "action": "accept",
    "content": {
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "age": 30
    }
  }
}

// Client responds (user declined):
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "action": "decline" }
}`}</pre>

          <div className="edu-info-box edu-info-box--warning" style={{ marginTop: '1rem' }}>
            <strong>Security:</strong> never request passwords, API keys, tokens, or payment data via
            form mode. These must use URL mode. "Sensitive" means secrets and credentials — general
            contact info (name, email) is permitted at server discretion.
          </div>
        </>
      ),
    },
    {
      id: 'url-mode',
      label: 'URL Mode',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Out-of-band flows for sensitive interactions</h3>
          <p>
            URL mode sends the user to an external URL to complete an interaction that <strong>must
            not pass through the MCP client</strong>. The classic uses are OAuth flows to third-party
            services, payment processing, and API key entry. The server directs the user; what the
            user does there stays between them and the external service.
          </p>

          <h4>Request shape</h4>
          <pre className="edu-code" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>{`{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "elicitation/create",
  "params": {
    "mode": "url",
    "elicitationId": "550e8400-e29b-41d4-a716-446655440000",
    "url": "https://mcp.example.com/ui/connect",
    "message": "Authorize access to your GitHub account to continue."
  }
}`}</pre>

          <h4>Response and completion flow</h4>
          <pre className="edu-code" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>{`// Client responds when user consents to open URL:
{ "result": { "action": "accept" } }
// Note: accept means consent to navigate, NOT that the flow is done.

// Server sends when out-of-band flow completes (optional):
{
  "jsonrpc": "2.0",
  "method": "notifications/elicitation/complete",
  "params": { "elicitationId": "550e8400-e29b-41d4-a716-446655440000" }
}`}</pre>

          <h4>Client safe-URL rules</h4>
          <ul style={{ fontSize: '0.82rem', lineHeight: 1.8 }}>
            <li><strong>Do not</strong> auto-fetch or pre-load the URL</li>
            <li><strong>Do not</strong> open the URL without explicit user consent</li>
            <li><strong>Show the full URL</strong> (and highlight the domain) before the user consents</li>
            <li>Open in a <strong>secure browser context</strong> — on iOS, <code>SFSafariViewController</code> yes, <code>WKWebView</code> no. The LLM must not be able to inspect the page content or user inputs.</li>
            <li>Warn for ambiguous/Punycode URIs</li>
          </ul>

          <h4>The phishing attack (and how to prevent it)</h4>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            Without mitigation, a malicious user (Alice) could trigger an elicitation URL, then
            trick another user (Bob) into clicking it. Bob completes the OAuth flow — but the tokens
            get bound to Alice's session. To prevent this:
          </p>
          <ol style={{ fontSize: '0.82rem', lineHeight: 1.8 }}>
            <li>The server generates a URL to its own endpoint (e.g. <code>/connect?elicitationId=...</code>), not directly to the third-party authorization server.</li>
            <li>When the user loads that page, the server checks their session cookie and verifies the <code>sub</code> claim matches the user who triggered the elicitation.</li>
            <li>Only after confirming identity does the server redirect to the third-party authorization endpoint.</li>
          </ol>

          <div className="edu-info-box" style={{ marginTop: '1rem', fontSize: '0.82rem' }}>
            URL mode is <strong>not</strong> for authorizing the MCP client to the MCP server — that
            is handled by{' '}
            <a href="https://modelcontextprotocol.io/specification/draft/basic/authorization" target="_blank" rel="noopener noreferrer">
              MCP authorization
            </a>
            . URL mode is for the MCP server obtaining third-party access on behalf of the user.
          </div>

          <p style={{ marginTop: '1rem', fontSize: '0.82rem' }}>
            Reference:{' '}
            <a href="https://modelcontextprotocol.io/specification/draft/client/elicitation" target="_blank" rel="noopener noreferrer">
              MCP Elicitation specification (draft)
            </a>
          </p>
        </>
      ),
    },
    {
      id: 'in-repo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Elicitation in the banking demo</h3>
          <p>
            The demo MCP server (<code>demo_mcp_server/</code>) does not currently implement
            elicitation — all tool calls resolve without requesting additional user input. This tab
            describes where the wiring would live if elicitation were added.
          </p>

          <h4>Where it would be handled</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#cbd5e1' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Layer</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>File</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Role</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['MCP Server', 'demo_mcp_server/src/tools/BankingToolProvider.ts', 'Emits InputRequiredResult from a tool handler when it needs more info'],
                ['BFF WebSocket client', 'demo_api_server/services/mcpWebSocketClient.js', 'Intercepts InputRequiredResult mid-stream, surfaces elicitation/create to the UI layer'],
                ['BFF route', 'demo_api_server/routes/mcp.js', 'Could relay elicitation requests to the browser via SSE'],
                ['React UI', 'demo_api_ui/src/components/BankingAgent.js', 'Would render the elicitation form or URL consent dialog inline in the agent sidebar'],
              ].map(([layer, file, role], i) => (
                <tr key={layer} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', fontWeight: 600 }}>{layer}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb' }}><code style={{ fontSize: '0.75rem' }}>{file}</code></td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', color: '#374151' }}>{role}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Protocol reference</h4>
          <p style={{ fontSize: '0.82rem' }}>
            <a href="https://modelcontextprotocol.io/specification/draft/client/elicitation" target="_blank" rel="noopener noreferrer">
              MCP Elicitation specification (draft)
            </a>
            {' — '}covers form mode, URL mode, the request/response schema, completion notifications,
            security considerations, and the phishing mitigation pattern.
          </p>

          <p style={{ fontSize: '0.82rem', marginTop: '0.5rem' }}>
            <strong>See also:</strong>{' '}
            <button
              type="button"
              onClick={() => open(EDU.MCP_PROTOCOL, 'handshake')}
              style={{ background: 'none', border: 'none', color: 'var(--brand-navy)', cursor: 'pointer', padding: 0, textDecoration: 'underline', font: 'inherit' }}
            >
              MCP Protocol — Handshake sequence
            </button>
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="MCP Elicitation"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
```

- [ ] **Step 2: Verify it has no obvious syntax issues**

```bash
cd demo_api_ui && node -e "require('./src/components/education/ElicitationPanel.js')" 2>&1 | head -5
```

Expected: no output (or a React-related warning, not a syntax error)

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/education/ElicitationPanel.js
git commit -m "feat(edu): add ElicitationPanel (form mode, URL mode, in-repo tabs)"
```

---

## Task 3: Register ElicitationPanel in EducationPanelsHost + AdminSideNav

**Files:**
- Modify: `demo_api_ui/src/components/education/EducationPanelsHost.js`
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`

- [ ] **Step 1: Add import to EducationPanelsHost**

In `src/components/education/EducationPanelsHost.js`, add after the last import line (after `import WebMcpEduPanel from "./WebMcpEduPanel";`):

```js
import ElicitationPanel from "./ElicitationPanel";
```

- [ ] **Step 2: Add JSX entry to EducationPanelsHost**

In the same file, inside the `return (<>...</>)` block, add after the `<WebMcpEduPanel ... />` entry:

```jsx
      <ElicitationPanel
        isOpen={panel === EDU.MCP_ELICITATION}
        onClose={close}
        initialTabId={tab}
      />
```

- [ ] **Step 3: Add nav item to AdminSideNav**

In `src/components/AdminSideNav.jsx`, find the MCP cluster around line 378 (the three `MCP_PROTOCOL` entries):

```js
    {
      label: "MCP: MFA gate on tools",
      icon: "dbg",
      action: () => openEdu(EDU.MCP_PROTOCOL, "mfa-gate"),
    },
```

Add immediately after it:

```js
    {
      label: "MCP Elicitation",
      icon: "dbg",
      action: () => openEdu(EDU.MCP_ELICITATION, "what"),
    },
```

- [ ] **Step 4: Run build to verify wiring**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.` (exit 0). Fix any import or JSX errors before continuing.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/education/EducationPanelsHost.js demo_api_ui/src/components/AdminSideNav.jsx
git commit -m "feat(edu): register ElicitationPanel in host and AdminSideNav"
```

---

## Task 4: Edit MayActPanel — consent framing, rogue-agent example, actor token note

**Files:**
- Modify: `demo_api_ui/src/components/education/MayActPanel.js`

- [ ] **Step 1: Add consent-first framing to tab `what` (line ~10)**

In tab `what` (id: `'what'`, label: `'Plain English'`), the content starts with `<p>When you sign in...`. Prepend a new paragraph before it:

```jsx
          <p>
            The delegation lifecycle starts with explicit user consent. If you have not authorized
            the agent, PingOne will not issue a delegated token — <strong>no consent means no
            delegation</strong>.
          </p>
```

- [ ] **Step 2: Expand rogue-agent bullet in tab `attacks` (line ~84)**

In tab `attacks` (id: `'attacks'`, label: `"Why it's secure"`), item 1 currently reads:
```
"A rogue app tries to steal your pass and act as the AI" — rejected: PingOne checks that the requesting app's ID matches the one listed in may_act. Any other app gets a "permission denied".
```

Replace the `<li>` with:

```jsx
            <li>
              <strong>A rogue app tries to steal your pass and act as the AI</strong> — rejected.
              PingOne checks that the requesting <code>actor_token.sub</code> matches the{' '}
              <code>may_act.sub</code> in the subject token. Example: Agent A&apos;s{' '}
              <code>client_id</code> is <code>abc-123</code>. Your access token has{' '}
              <code>may_act: {'{'}{ ' "sub": "abc-123"' }{'}'}</code>. Rogue agent B (
              <code>client_id: xyz-999</code>) attempts the exchange. PingOne compares{' '}
              <code>xyz-999</code> against <code>abc-123</code> — they don&apos;t match, so
              PingOne returns <code>invalid_grant</code> and the exchange is rejected.
            </li>
```

- [ ] **Step 3: Add actor-token identity note to tab `lifecycle` step 2 (line ~37)**

In tab `lifecycle` (id: `'lifecycle'`, label: `'Step by step'`), step 2 describes the exchange patterns. After the closing `</ul>` of the exchange patterns list (after the `2-exchange` bullet), add:

```jsx
            <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: 6 }}>
              The actor token in Exchange #1 is the agent&apos;s own identity proof — it is obtained
              via client credentials and proves the agent app is who it claims to be, independent of
              the user&apos;s token.
            </p>
```

- [ ] **Step 4: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/education/MayActPanel.js
git commit -m "feat(edu): strengthen MayActPanel — consent framing, rogue-agent example, actor token note"
```

---

## Task 5: Edit TokenFlowPanel — multi-service scoping, decoder note, gateway boundary

**Files:**
- Modify: `demo_api_ui/src/components/education/TokenFlowPanel.js`

- [ ] **Step 1: Add multi-service paragraph to tab `overview`**

In tab `overview` (id: `'overview'`), find the `<ol>` containing "Exchange #1" and "Exchange #2". After the closing `</ol>`, and before the `<h4>End-to-end Guarantees</h4>`, add:

```jsx
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            In multi-service deployments this pattern extends naturally — a separate exchange
            produces a token scoped to each backend service, with its own <code>aud</code> and
            minimal <code>scope</code>. Each service sees only the token meant for it.
          </p>
```

- [ ] **Step 2: Add decoder-panel note below the token table in tab `token-inventory`**

In tab `token-inventory` (id: `'token-inventory'`), after the closing `</table>` for the token count table, add before the `<h4 style={{ marginTop: 20 }}>Key claim...` heading:

```jsx
          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: 12 }}>
            The live demo surfaces the full decoded token set in the Token Chain panel — you can
            inspect <code>sub</code>, <code>aud</code>, <code>scope</code>, <code>act</code>, and{' '}
            <code>may_act</code> for each token after a tool call.
          </p>
```

- [ ] **Step 3: Add gateway enforcement note to tab `scopes-resources`**

In tab `scopes-resources` (id: `'scopes-resources'`), after the Resource URIs `</table>`, before the `<h3 style={{ marginTop: 20 }}>Scope Definitions</h3>`, add:

```jsx
          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: 12 }}>
            Each route or service enforces its own audience and scope independently. A token valid
            for the MCP server resource is not valid at the banking API resource, even if both are
            in the same PingOne environment. The gateway enforces this boundary at each route.
          </p>
```

- [ ] **Step 4: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/education/TokenFlowPanel.js
git commit -m "feat(edu): update TokenFlowPanel — multi-service scoping, decoder note, gateway boundary"
```

---

## Task 6: Edit PingGatewayMcpPanel — no-security-logic headline, route examples, audit attribution

**Files:**
- Modify: `demo_api_ui/src/components/education/PingGatewayMcpPanel.js`

- [ ] **Step 1: Add no-security-logic headline to OverviewTab**

In `function OverviewTab()`, the `<div>` starts with `<h3 style={{ marginTop: 0 }}>Why secure MCP with a gateway?</h3>`. Add a new paragraph before that `<h3>`:

```jsx
      <p>
        <strong>MCP servers contain no security logic.</strong> Token validation, scope enforcement,
        protocol compliance, rate limiting, and audit all live in the gateway. The MCP server trusts
        that whatever reaches it has already been authorized — it focuses entirely on tool execution.
      </p>
```

- [ ] **Step 2: Add route-level enforcement examples to ArchitectureTab**

In `function ArchitectureTab()`, find the `<h4>Token validation flow</h4>` section. After its closing `</ol>`, add:

```jsx
      <h4>Route-level enforcement example</h4>
      <p style={{ fontSize: '0.82rem', color: '#374151' }}>
        Each route is independently configured with its own required scopes. A token valid for one
        route is rejected at another:
      </p>
      <pre className="edu-code" style={{ fontSize: '0.78rem' }}>{`/ecommerce  →  requires scope: read, write
/crm        →  requires scope: crm:read, crm:write

Token with scope "read write" → /ecommerce   ✅ allowed
Token with scope "read write" → /crm         ❌ rejected (missing crm:read)`}</pre>
```

- [ ] **Step 3: Add audit attribution note to OfficialFiltersTab**

In `function OfficialFiltersTab()`, find the table rows mapping filter names to descriptions. The `McpAuditFilter` row currently reads: `'Records all MCP request activity to audit/mcp.audit.json'`. Replace that string with:

```
'Records all MCP request activity to audit/mcp.audit.json — entries include user email (resolved from sub claim), agent client_id (from act.sub), the full delegation chain (nested act), target service, and request latency'
```

In code, the table row currently is:
```jsx
['McpAuditFilter', 'Records all MCP request activity to audit/mcp.audit.json'],
```

Replace with:
```jsx
['McpAuditFilter', 'Records all MCP request activity — entries include user email (from sub claim), agent client_id (from act.sub), full delegation chain (nested act), target service, and latency'],
```

- [ ] **Step 4: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/education/PingGatewayMcpPanel.js
git commit -m "feat(edu): update PingGatewayMcpPanel — no-security-logic headline, route examples, audit attribution"
```

---

## Task 7: Edit PingOneAuthorizePanel — Platinum tier example, central policy note, recent decisions copy

**Files:**
- Modify: `demo_api_ui/src/components/education/PingOneAuthorizePanel.js`

The tab IDs in this panel are: `what` (line 374), `flow` (415), `policy-mcp` (506), `mcp-config` (585), `setup` (698), `attributes` (764), `inrepo` (814), `recent` (829).

- [ ] **Step 1: Add Platinum example + central-policy note to tab `what`**

In tab `what` (id: `'what'`), find where the existing content ends (before the next `},` closing the tab object). Add these paragraphs inside the tab's content JSX, after the existing content:

```jsx
          <h4>Example: policy blocks a tier upgrade</h4>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            A customer on the basic tier asks the agent to upgrade them to Platinum. PingOne Authorize
            evaluates the request: <code>tool=upgrade_tier</code>, <code>targetField=tier</code>,{' '}
            <code>targetValue=Platinum</code>, <code>customerTier=basic</code> →{' '}
            <strong>DENY</strong>. The matched rule is visible in the Recent Decisions view. The
            agent receives the denial and explains to the user why the upgrade is not available,
            without any application code needed to enforce the rule.
          </p>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            The policy logic lives centrally in PingOne Authorize — not in the agent, the MCP server,
            or the gateway. Any of those components changing does not affect the policy. New tools
            are automatically evaluated against the same rules without code changes.
          </p>
```

- [ ] **Step 2: Update tab `recent` intro copy**

In tab `recent` (id: `'recent'`), find the opening content of the tab. Locate the first `<p>` or `<h3>` element that introduces the recent decisions section. Add or prepend:

```jsx
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            The PingOne Authorize console Recent Decisions view shows which rule fired, the full
            input parameters that were evaluated, and the decision output — useful for diagnosing
            unexpected PERMIT or DENY results during a demo.
          </p>
```

- [ ] **Step 3: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/education/PingOneAuthorizePanel.js
git commit -m "feat(edu): update PingOneAuthorizePanel — Platinum deny example, central policy note, recent decisions copy"
```

---

## Task 8: Edit HumanInLoopPanel — read/write distinction, no-consent framing

**Files:**
- Modify: `demo_api_ui/src/components/education/HumanInLoopPanel.js`

The tab IDs are: `what` (line 12), `patterns` (35), `agent` (148), `decline` (174), `inrepo` (193), `compliance` (206).

- [ ] **Step 1: Add read/write + no-consent paragraph to tab `what`**

In tab `what` (id: `'what'`, label: `'What is HITL?'`), the content opens with `<p><strong>Human-in-the-loop (HITL)</strong>...`. After the closing `</p>` of that first paragraph, add:

```jsx
          <p>
            The simplest rule: <strong>reads can proceed if policy permits; writes require explicit
            approval.</strong> Querying account balances does not need a human in the loop.
            Transferring funds does. No consent, no delegation — the agent cannot complete a write
            operation without an explicit human approval signal.
          </p>
```

- [ ] **Step 2: Add read/write note to tab `patterns`**

In tab `patterns` (id: `'patterns'`), find the unordered list under "Why human oversight matters" (the list with hallucinate, misuse permissions, overreach, reduce traceability bullets). Add a new list item at the end:

```jsx
            <li>
              <strong>Blur the read/write line</strong> — agents that treat reads and writes
              identically apply unnecessary friction to harmless queries while potentially
              under-protecting mutations. Distinguishing the two makes approval flows proportionate.
            </li>
```

- [ ] **Step 3: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/education/HumanInLoopPanel.js
git commit -m "feat(edu): update HumanInLoopPanel — read/write distinction, no-consent framing"
```

---

## Task 9: Edit StepUpPanel — policy-before-stepup sequencing, phone approval prominence

**Files:**
- Modify: `demo_api_ui/src/components/education/StepUpPanel.js`

The tab IDs are: `what` (line 9), `device-auth` (32), `ciba` (103), `exchange-modes` (132), `acr` (164), `inrepo` (176).

- [ ] **Step 1: Add policy-first sequencing to tab `what`**

In tab `what` (id: `'what'`, label: `'What is step-up'`), the content opens with `<p><strong>Step-up MFA</strong>...`. Prepend before that first `<p>`:

```jsx
          <p>
            Step-up is the <strong>second gate</strong>, not the first. The sequence is: (1) a
            policy decision — PingOne Authorize evaluates whether the action is permitted at all;
            (2) if permitted and it is a write operation, step-up authentication triggers to confirm
            the user&apos;s identity. A DENY from policy stops the flow before step-up is ever
            requested.
          </p>
```

- [ ] **Step 2: Add phone approval prominence to tab `ciba`**

In tab `ciba` (id: `'ciba'`, label: `'CIBA (Backchannel)'`), the content opens with `<p><strong>CIBA (Client-Initiated Backchannel Authentication)</strong>...`. Prepend before that first `<p>`:

```jsx
          <p>
            The most common path: the user gets a push notification on their phone, reviews the
            transaction details, and taps <strong>Approve</strong>. The agent is waiting and retries
            the tool call automatically once approval arrives. The user never needs to return to the
            browser.
          </p>
```

- [ ] **Step 3: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/education/StepUpPanel.js
git commit -m "feat(edu): update StepUpPanel — policy-first sequencing, phone approval prominence"
```

---

## Task 10: Edit LoginFlowPanel — centralized sign-on, redirect page guidance

**Files:**
- Modify: `demo_api_ui/src/components/education/LoginFlowPanel.js`

The tab IDs are: `what` (line 14), `ciba` (57), `pkce` (62), `tokens` (67), `security` (99), `inrepo` (104).

- [ ] **Step 1: Add centralized sign-on paragraph to tab `what`**

In tab `what` (id: `'what'`, label: `'What happens'`), find the end of the existing content. After the last `</p>` or closing element in the tab content, add:

```jsx
          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: 8 }}>
            All client applications redirect to the <strong>same centralized PingOne sign-on
            UI</strong> — the app never renders its own login form. This means any change to
            authentication policy (new MFA requirement, new SSO provider, branding update)
            propagates automatically to every connected app without code changes.
          </p>
```

- [ ] **Step 2: Add redirect-page note to tab `inrepo`**

In tab `inrepo` (id: `'inrepo'`, label: `'In this repo'`), at the end of the existing content, add:

```jsx
          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: 12 }}>
            <strong>Redirect callback page:</strong> the <code>/callback</code> route is
            intentionally minimal — static HTML with no JavaScript beyond the OAuth code exchange.
            Avoid rendering frameworks or lazy-loaded bundles on this page; delayed JavaScript
            execution can cause the auth code to expire before it is exchanged, producing silent
            login failures.
          </p>
```

- [ ] **Step 3: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/education/LoginFlowPanel.js
git commit -m "feat(edu): update LoginFlowPanel — centralized sign-on, redirect page guidance"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.` with exit 0.

- [ ] **Step 2: Start the app and verify ElicitationPanel opens**

```bash
./run.sh
```

Navigate to `https://api.ping.demo:4000`, log in as admin, open AdminSideNav. Find "MCP Elicitation" in the Learn & Education section (near "MCP Protocol" entries). Click it. Expected: right-side drawer slides in with tabs "What is Elicitation", "Form Mode", "URL Mode", "In this repo".

- [ ] **Step 3: Spot-check updated panels**

Open each of these from AdminSideNav and confirm the new copy appears:
- MayActPanel → "Plain English" tab: first paragraph should mention "no consent means no delegation"
- StepUpPanel → "What is step-up" tab: first paragraph should describe the policy-first sequence
- HumanInLoopPanel → "What is HITL?" tab: should mention reads vs writes distinction
- PingGatewayMcpPanel → "Overview" tab: first paragraph should state MCP servers contain no security logic

- [ ] **Step 4: Commit spec file if not already committed**

```bash
git add docs/superpowers/specs/2026-05-20-education-panels-elicitation-design.md
git status
```

If untracked: `git add` and `git commit -m "docs: add education panels elicitation design spec"`

---

## Self-review notes

- All 11 files from the spec are covered by tasks 1–10
- `ElicitationPanel.js` uses `useEducationUI` + cross-link to `EDU.MCP_PROTOCOL` (same pattern as McpProtocolPanel)
- No `edu-info-box--warning` class invented — it already exists in `EducationDrawer.css` (used in existing panels)
- `✅` and `❌` in the route enforcement code block are in a `pre` element, not UI text — acceptable per the spec's "code blocks" exception; if in doubt, replace with `[OK]` / `[REJECTED]`
- PingOneAuthorizePanel tab `recent` edit: the instruction says to "add or prepend" — the implementer should read the existing content of that tab first and insert the paragraph at the top, not duplicate existing intro copy
