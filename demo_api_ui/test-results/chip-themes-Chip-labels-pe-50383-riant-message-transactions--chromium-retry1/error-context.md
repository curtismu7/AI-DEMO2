# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chip-themes.spec.js >> Chip labels per vertical theme >> Vertical: healthcare >> [healthcare] clicking "Appointments" (key=transactions) sends invariant message "transactions"
- Location: tests/e2e/chip-themes.spec.js:235:9

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.ba-actions-popout')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('.ba-actions-popout')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - region "Notifications Alt+T"
  - generic [ref=e4]:
    - button "Collapse sidebar" [ref=e6] [cursor=pointer]: ←
    - generic [ref=e9]:
      - text: Ping
      - strong [ref=e10]: Identity
    - navigation [ref=e11]:
      - generic [ref=e12]:
        - button "Customer" [ref=e13] [cursor=pointer]
        - button "Admin" [ref=e14] [cursor=pointer]
        - link "Setup" [ref=e15] [cursor=pointer]:
          - /url: /configure
      - generic [ref=e16]:
        - link "Home" [ref=e17] [cursor=pointer]:
          - /url: /
          - generic [ref=e18]: Home
        - link "Dashboard" [ref=e19] [cursor=pointer]:
          - /url: /dashboard
          - generic [ref=e20]: Dashboard
        - link "Themes" [ref=e21] [cursor=pointer]:
          - /url: /themes
          - img [ref=e22]
          - generic [ref=e25]: Themes
        - link "Use Cases" [ref=e26] [cursor=pointer]:
          - /url: /use-cases
          - img [ref=e27]
          - generic [ref=e30]: Use Cases
        - button "Agent Demo Guide" [ref=e31] [cursor=pointer]:
          - img [ref=e32]
          - generic [ref=e35]: Agent Demo Guide
        - link "Family Delegation" [ref=e36] [cursor=pointer]:
          - /url: /delegation
          - img [ref=e37]
          - generic [ref=e39]: Family Delegation
        - button "Monitoring ▶" [ref=e41] [cursor=pointer]:
          - img [ref=e42]
          - generic [ref=e45]: Monitoring
          - generic [ref=e46]: ▶
        - button "MCP ▶" [ref=e48] [cursor=pointer]:
          - img [ref=e49]
          - generic [ref=e52]: MCP
          - generic [ref=e53]: ▶
        - button "Agent Gateway Server ▶" [ref=e55] [cursor=pointer]:
          - img [ref=e56]
          - generic [ref=e59]: Agent Gateway Server
          - generic [ref=e60]: ▶
        - link "PingOne MCP Setup" [ref=e61] [cursor=pointer]:
          - /url: /pingone-setup
          - img [ref=e62]
          - generic [ref=e65]: PingOne MCP Setup
        - button "Vertical Ops ▶" [ref=e67] [cursor=pointer]:
          - img [ref=e68]
          - generic [ref=e71]: Vertical Ops
          - generic [ref=e72]: ▶
        - button "Authorize ▶" [ref=e74] [cursor=pointer]:
          - img [ref=e75]
          - generic [ref=e79]: Authorize
          - generic [ref=e80]: ▶
        - button "OAuth & Identity ▶" [ref=e82] [cursor=pointer]:
          - img [ref=e83]
          - generic [ref=e86]: OAuth & Identity
          - generic [ref=e87]: ▶
        - button "AI Attack Demos ▶" [ref=e89] [cursor=pointer]:
          - img [ref=e90]
          - generic [ref=e93]: AI Attack Demos
          - generic [ref=e94]: ▶
        - button "Diagrams ▶" [ref=e96] [cursor=pointer]:
          - img [ref=e97]
          - generic [ref=e100]: Diagrams
          - generic [ref=e101]: ▶
        - button "Users & Accounts 🛡️ admin ▶" [ref=e103] [cursor=pointer]:
          - img [ref=e104]
          - generic [ref=e107]: Users & Accounts
          - generic [ref=e108]: 🛡️ admin
          - generic [ref=e109]: ▶
        - button "System Tools 🛡️ admin ▶" [ref=e111] [cursor=pointer]:
          - img [ref=e112]
          - generic [ref=e115]: System Tools
          - generic [ref=e116]: 🛡️ admin
          - generic [ref=e117]: ▶
        - button "Tests ▶" [ref=e119] [cursor=pointer]:
          - img [ref=e120]
          - generic [ref=e123]: Tests
          - generic [ref=e124]: ▶
        - link "Code Explorer" [ref=e125] [cursor=pointer]:
          - /url: /code-explorer
          - img [ref=e126]
          - generic [ref=e129]: Code Explorer
        - link "Code Search" [ref=e130] [cursor=pointer]:
          - /url: /code-search
          - img [ref=e131]
          - generic [ref=e134]: Code Search
        - link "OAuth Academy" [ref=e135] [cursor=pointer]:
          - /url: /oauth-academy
          - img [ref=e136]
          - generic [ref=e139]: OAuth Academy
        - link "OAS Demo" [ref=e140] [cursor=pointer]:
          - /url: /oas-demo
          - img [ref=e141]
          - generic [ref=e144]: OAS Demo
        - link "Learning Hub" [ref=e145] [cursor=pointer]:
          - /url: /learning
          - img [ref=e146]
          - generic [ref=e149]: Learning Hub
        - link "llama-vscode Guide" [ref=e150] [cursor=pointer]:
          - /url: /llama-vscode-guide
          - img [ref=e151]
          - generic [ref=e154]: llama-vscode Guide
        - link "Run Reports" [ref=e155] [cursor=pointer]:
          - /url: /reports
          - img [ref=e156]
          - generic [ref=e159]: Run Reports
        - link "PingOne Agent Builder" [ref=e160] [cursor=pointer]:
          - /url: /agent-builder
          - img [ref=e161]
          - generic [ref=e164]: PingOne Agent Builder
        - link "AI Control Plane" [ref=e165] [cursor=pointer]:
          - /url: /ai-control-plane
          - img [ref=e166]
          - generic [ref=e169]: AI Control Plane
      - button "Agent UI ▶" [ref=e173] [cursor=pointer]:
        - img [ref=e174]
        - generic [ref=e177]: Agent UI
        - generic [ref=e178]: ▶
      - button "Vertical ▶" [ref=e182] [cursor=pointer]:
        - img [ref=e183]
        - generic [ref=e186]: Vertical
        - generic [ref=e187]: ▶
      - button "STOP AGENT" [ref=e190] [cursor=pointer]:
        - img [ref=e191]
        - generic [ref=e194]: STOP AGENT
      - generic [ref=e196]:
        - button "Admin View" [ref=e197] [cursor=pointer]:
          - img [ref=e198]
          - generic [ref=e201]: Admin View
        - button "Reset Demo" [ref=e202] [cursor=pointer]:
          - img [ref=e203]
          - generic [ref=e206]: Reset Demo
        - button "Sign Out" [ref=e207] [cursor=pointer]:
          - img [ref=e208]
          - generic [ref=e211]: Sign Out
  - banner [ref=e212]:
    - generic [ref=e213]:
      - button "Go to dashboard" [ref=e215] [cursor=pointer]:
        - img [ref=e216]
        - generic [ref=e219]: AI Demo
      - generic [ref=e220]: Customer
      - button "Use Cases" [ref=e221] [cursor=pointer]
      - generic [ref=e222]:
        - generic [ref=e223]:
          - toolbar "Dashboard actions" [ref=e224]:
            - 'group "AI banking agent: embedded or float; optional FAB" [ref=e225]':
              - generic [ref=e226]: Choose layout
              - generic [ref=e227]:
                - toolbar "Choose layout" [ref=e228]:
                  - button "Embedded" [pressed] [ref=e229] [cursor=pointer]
                  - button "Bottom" [ref=e230] [cursor=pointer]
                  - button "Float" [ref=e231] [cursor=pointer]
                - generic [ref=e232] [cursor=pointer]:
                  - checkbox "Always show float agent" [checked] [ref=e233]
                  - generic [ref=e234]: Always float
            - button "Controls" [ref=e236] [cursor=pointer]
            - button "Reset Demo" [ref=e237] [cursor=pointer]
          - status "Session status" [ref=e238]:
            - generic [ref=e240]: No token — please sign in
          - button "Search" [ref=e242] [cursor=pointer]:
            - img [ref=e243]
        - button "Sign In" [ref=e247] [cursor=pointer]:
          - img [ref=e248]
          - generic [ref=e251]: Sign In
        - button "User menu" [ref=e253] [cursor=pointer]:
          - generic [ref=e254]: T
          - img [ref=e255]
  - main [ref=e258]:
    - status [ref=e260]: Loading your account information…
  - dialog "AI Demo AI Agent" [ref=e262]:
    - button "AI Demo Assistant Customer · Test user-123 RFC info Compliance Token Chain Guide Actions ▾ Sign out" [ref=e263]:
      - generic [ref=e264]:
        - generic [ref=e267]:
          - generic [ref=e268]: AI Demo Assistant
          - generic [ref=e269]: Customer · Test
        - generic "PingOne user id" [ref=e271]: user-123
        - generic [ref=e272]:
          - generic [ref=e273] [cursor=pointer]:
            - checkbox "RFC info"
            - generic [ref=e275]: RFC info
          - generic [ref=e276] [cursor=pointer]:
            - checkbox "Compliance"
            - generic [ref=e278]: Compliance
          - generic [ref=e279] [cursor=pointer]:
            - checkbox "Token Chain"
            - generic [ref=e281]: Token Chain
          - button "Guide" [ref=e282] [cursor=pointer]
          - button "Actions ▾" [ref=e283] [cursor=pointer]
          - button "Sign out" [ref=e284] [cursor=pointer]
    - generic [ref=e286]:
      - generic "Simple Stepper" [ref=e287]:
        - generic [ref=e288]: Simple Stepper
        - button "Show" [ref=e289] [cursor=pointer]
      - paragraph [ref=e295]: Hi Test! I'm your AI assistant. I can help with your accounts, explain the OAuth flows behind the scenes, and more. What would you like to do?
      - generic [ref=e297]:
        - textbox "Ask about your accounts…" [ref=e298]
        - button "Send" [disabled] [ref=e299]
      - button "Start Over" [ref=e301] [cursor=pointer]
      - generic [ref=e302]:
        - generic [ref=e303]: ⬆ 0 in
        - generic [ref=e304]: ⬇ 0 out
        - generic [ref=e305]: ∑ 0
  - dialog [ref=e306]:
    - generic [ref=e308]:
      - generic [ref=e309]:
        - heading [level=2] [ref=e310]:
          - text: Backchannel Authentication
          - generic [ref=e311]: Disabled
        - paragraph [ref=e312]:
          - text: OIDC CIBA plus OAuth tokens, Backend-for-Frontend (BFF) session, MCP, and RFC 8693 token exchange — open
          - strong [ref=e313]: Full stack
          - text: for the map and
          - strong [ref=e314]: Token exchange
          - text: for before/after
          - code [ref=e315]: /token
          - text: ", statuses, and responses."
      - button [ref=e316] [cursor=pointer]: ✕
    - generic [ref=e317]:
      - button [ref=e318] [cursor=pointer]: What is CIBA
      - button [ref=e319] [cursor=pointer]: Sign-in & roles
      - button [ref=e320] [cursor=pointer]: Full stack
      - button [ref=e321] [cursor=pointer]: Token exchange
      - button [ref=e322] [cursor=pointer]: vs Login Flow
      - button [ref=e323] [cursor=pointer]: ▶ Try It
      - button [ref=e324] [cursor=pointer]: App Flows
      - button [ref=e325] [cursor=pointer]: PingOne Setup
      - button [ref=e326] [cursor=pointer]: BFF code
    - generic [ref=e328]:
      - paragraph [ref=e329]:
        - text: CIBA (Client-Initiated Backchannel Authentication, OpenID CIBA Core 1.0) decouples the
        - strong [ref=e330]: consumption device
        - text: (where the app runs) from where the user
        - strong [ref=e331]: approves
        - text: — often another device or their email inbox. No browser redirect, no popup. PingOne delivers the approval step by
        - strong [ref=e332]: email
        - text: or
        - strong [ref=e333]: push
        - text: depending on your DaVinci configuration.
      - heading [level=3] [ref=e334]: The flow (6 steps)
      - generic [ref=e335]: "1. App (server) ──POST /bc-authorize──▶ PingOne { login_hint: \"user@bank.com\", scope: \"openid write\", binding_message: \"Approve $500 transfer\" } 2. PingOne ◀─────────────────────────── auth_req_id returned 3. PingOne ──out-of-band approval────▶ User (channel is your PingOne / DaVinci setup) • Email: approval link in inbox — OR — • Push: notification on registered device 4. User approves (link in email or tap Approve on device) 5. App polls POST /token (grant=ciba, auth_req_id=...) → authorization_pending (repeat every 5s) → tokens returned ✓ 6. Tokens stored server-side (never sent to browser) Tool call / transaction executes with user context"
      - heading [level=3] [ref=e336]: "Real HTTP: bc-authorize request & response"
      - generic [ref=e337]: "POST {issuer}/as/bc-authorize Content-Type: application/x-www-form-urlencoded Authorization: Basic <base64(client_id:client_secret)> scope=openid%20banking%3Awrite &login_hint=user%40bank.com &binding_message=Approve%20%24500%20transfer &acr_values=Multi_factor (optional step-up) &client_notification_token=... (required for ping/push delivery mode) HTTP/1.1 200 OK { \"auth_req_id\": \"abc123xyz...\", \"expires_in\": 300, \"interval\": 5 }"
      - heading [level=3] [ref=e338]: "Real HTTP: polling for tokens"
      - generic [ref=e339]: "POST {issuer}/as/token Content-Type: application/x-www-form-urlencoded grant_type=urn:openid:params:grant-type:ciba &auth_req_id=abc123xyz... &client_id=... &client_secret=... ── If user has not yet approved ── HTTP/1.1 400 Bad Request { \"error\": \"authorization_pending\" } ── If poll is too fast ── HTTP/1.1 400 Bad Request { \"error\": \"slow_down\" } → increase interval by 5s ── On approval ── HTTP/1.1 200 OK { \"access_token\": \"...\", \"token_type\": \"Bearer\", \"id_token\": \"...\", \"refresh_token\": \"...\", \"expires_in\": 3600 } ── On denial / timeout ── HTTP/1.1 400 Bad Request { \"error\": \"access_denied\" | \"expired_token\" }"
      - heading [level=3] [ref=e340]: Key concepts
      - list [ref=e341]:
        - listitem [ref=e342]:
          - strong [ref=e343]: auth_req_id
          - text: — a short-lived opaque ID returned by PingOne when
          - code [ref=e344]: POST /bc-authorize
          - text: succeeds. The server uses it to poll
          - code [ref=e345]: POST /token
          - text: until the user approves or the request expires.
        - listitem [ref=e346]:
          - strong [ref=e347]: binding_message
          - text: — the text shown in the approval email or push notification, e.g.
          - emphasis [ref=e348]: "\"Approve $500 transfer to Savings\""
          - text: . Helps the user confirm exactly what they are authorising.
        - listitem [ref=e349]:
          - strong [ref=e350]: login_hint
          - text: — the user's email address. PingOne resolves this to the target account and sends the approval to the right inbox or device.
        - listitem [ref=e351]:
          - strong [ref=e352]: Poll vs Ping delivery mode
          - text: —
          - emphasis [ref=e353]: Poll
          - text: ": server calls"
          - code [ref=e354]: POST /token
          - text: every 5 s (or
          - code [ref=e355]: interval
          - text: seconds).
          - emphasis [ref=e356]: Ping
          - text: ": PingOne calls a"
          - code [ref=e357]: client_notification_endpoint
          - text: when the user approves (requires a publicly reachable callback URL). This demo uses Poll mode.
        - listitem [ref=e358]:
          - strong [ref=e359]: Backend-for-Frontend (BFF) pattern — tokens never reach the browser
          - text: — tokens are stored in the server-side session. The browser only receives approval status updates via the Backend-for-Frontend (BFF) poll API. XSS cannot steal them.
        - listitem [ref=e360]:
          - strong [ref=e361]: Email vs push
          - text: — controlled by your PingOne / DaVinci flow, not by this app. Email-only CIBA requires no push-capable MFA device.
      - heading [level=3] [ref=e362]: When to use CIBA (vs Authorization Code)
      - list [ref=e363]:
        - listitem [ref=e364]: LLM / agent contexts where a browser redirect would break the flow.
        - listitem [ref=e365]: Step-up authentication mid-session (high-value transaction) without a page reload.
        - listitem [ref=e366]: IoT / headless devices that cannot host a redirect URI.
        - listitem [ref=e367]: Delegated approval — approve on phone while viewing dashboard on desktop.
  - dialog [ref=e368]:
    - generic [ref=e370]:
      - generic [ref=e371]:
        - heading [level=2] [ref=e372]: 📄 Client ID Metadata Document
        - paragraph [ref=e373]: draft-ietf-oauth-client-id-metadata-document — the client_id is a URL
      - button [ref=e374] [cursor=pointer]: ✕
    - tablist [ref=e375]:
      - tab [selected] [ref=e376] [cursor=pointer]: What is CIMD
      - tab [ref=e377] [cursor=pointer]: CIMD vs DCR
      - tab [ref=e378] [cursor=pointer]: Doc format
      - tab [ref=e379] [cursor=pointer]: How AS uses it
      - tab [ref=e380] [cursor=pointer]: Flow diagram
      - tab [ref=e381] [cursor=pointer]: ▶ Simulate
      - tab [ref=e382] [cursor=pointer]: PingOne
    - tabpanel [ref=e383]:
      - paragraph [ref=e384]:
        - strong [ref=e385]: OAuth Client ID Metadata Document (CIMD)
        - text: is an IETF draft (
        - link [ref=e386] [cursor=pointer]:
          - /url: https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/
          - text: draft-ietf-oauth-client-id-metadata-document
        - text: ) that redefines what a
        - code [ref=e387]: client_id
        - text: is. Instead of an opaque string like
        - code [ref=e388]: abc123
        - text: ", the"
        - code [ref=e389]: client_id
        - text: becomes a
        - strong [ref=e390]: URL
        - text: . When the authorization server receives that URL, it fetches the document at that URL to discover the client's metadata (redirect URIs, grant types, scopes, etc.).
      - generic [ref=e391]:
        - strong [ref=e392]: "Core idea:"
        - text: The
        - code [ref=e393]: client_id
        - text: IS the metadata document URL. The client controls the URL, so the client controls its own registration data.
      - list [ref=e394]:
        - listitem [ref=e395]:
          - code [ref=e396]: client_id
          - text: is a URL, e.g.
          - code [ref=e397]: https://app.example.com/.well-known/oauth-client/my-app
        - listitem [ref=e398]:
          - text: The AS fetches that URL and reads the metadata (
          - code [ref=e399]: redirect_uris
          - text: ","
          - code [ref=e400]: grant_types
          - text: ", etc.)"
        - listitem [ref=e401]: The client self-describes by controlling the hosted document
        - listitem [ref=e402]: Eliminates out-of-band registration in AS implementations that support the draft
        - listitem [ref=e403]: "Updates are instant: just update the hosted JSON file"
      - heading [level=3] [ref=e404]: What this demo does
      - paragraph [ref=e405]: "This demo bridges the gap between the draft and PingOne. You fill in a CIMD-style form, the backend creates the OAuth application in PingOne via the Management API, then hosts the CIMD document at:"
      - code [ref=e407]: "GET /.well-known/oauth-client/{pingone-app-id}"
      - paragraph [ref=e408]:
        - text: Use the
        - strong [ref=e409]: ▶ Simulate
        - text: tab to watch the full AS-fetches-CIMD flow animated step by step.
      - heading [level=3] [ref=e410]: Key references
      - list [ref=e411]:
        - listitem [ref=e412]:
          - link [ref=e413] [cursor=pointer]:
            - /url: https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/
            - text: draft-ietf-oauth-client-id-metadata-document (IETF)
        - listitem [ref=e414]:
          - link [ref=e415] [cursor=pointer]:
            - /url: https://www.rfc-editor.org/rfc/rfc7591
            - text: RFC 7591 — OAuth 2.0 Dynamic Client Registration
          - text: (compare & contrast)
  - contentinfo [ref=e416]:
    - generic [ref=e417]:
      - generic [ref=e418]: AI Demo Demo
      - generic [ref=e419]: © 2026 All rights reserved.
```

# Test source

```ts
  86  | 
  87  | /**
  88  |  * Install all required BFF mocks for a logged-in customer, injecting `manifest`
  89  |  * into /api/config/vertical so ThemeContext picks up the vertical's chip labels.
  90  |  */
  91  | async function mockCustomerWithVertical(page, manifest) {
  92  |   // OAuth — customer logged in via user/status endpoint
  93  |   await page.route('**/api/auth/oauth/status', (route) =>
  94  |     route.fulfill({ status: 200, contentType: 'application/json',
  95  |       body: JSON.stringify({ authenticated: false, user: null }) }),
  96  |   );
  97  |   await page.route('**/api/auth/oauth/user/status', (route) =>
  98  |     route.fulfill({ status: 200, contentType: 'application/json',
  99  |       body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }) }),
  100 |   );
  101 |   await page.route('**/api/auth/session', (route) =>
  102 |     route.fulfill({ status: 200, contentType: 'application/json',
  103 |       body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }) }),
  104 |   );
  105 | 
  106 |   // Vertical manifest — THIS is what drives the chip label overlay
  107 |   await page.route('**/api/config/vertical', (route) =>
  108 |     route.fulfill({ status: 200, contentType: 'application/json',
  109 |       body: JSON.stringify({ manifest }) }),
  110 |   );
  111 | 
  112 |   // Data APIs
  113 |   await page.route('**/api/accounts/my**', (route) =>
  114 |     route.fulfill({ status: 200, contentType: 'application/json',
  115 |       body: JSON.stringify(SAMPLE_ACCOUNTS) }),
  116 |   );
  117 |   await page.route('**/api/transactions/my**', (route) =>
  118 |     route.fulfill({ status: 200, contentType: 'application/json',
  119 |       body: JSON.stringify(SAMPLE_TRANSACTIONS) }),
  120 |   );
  121 | 
  122 |   // Config / flags
  123 |   await page.route('**/api/admin/config**', (route) =>
  124 |     route.fulfill({ status: 200, contentType: 'application/json',
  125 |       body: JSON.stringify({ config: {} }) }),
  126 |   );
  127 |   await page.route('**/api/admin/feature-flags**', (route) =>
  128 |     route.fulfill({ status: 200, contentType: 'application/json',
  129 |       body: JSON.stringify({ flags: [{ id: 'ff_show_banking_in_middle_agent', value: true }] }) }),
  130 |   );
  131 |   await page.route('**/api/admin/app-events**', (route) =>
  132 |     route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  133 |   );
  134 | 
  135 |   // Token chain / session preview
  136 |   await page.route('**/api/tokens/session-preview**', (route) =>
  137 |     route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_TOKEN_EVENTS) }),
  138 |   );
  139 |   await page.route('**/api/token-chain**', (route) =>
  140 |     route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_TOKEN_EVENTS) }),
  141 |   );
  142 | 
  143 |   // PingOne connectivity
  144 |   await page.route('**/api/pingone-test/config**', (route) =>
  145 |     route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  146 |   );
  147 | 
  148 |   // Silence WebSocket / MCP connections
  149 |   await page.route('**/ws**', (route) => route.abort());
  150 | }
  151 | 
  152 | /**
  153 |  * Wait for the inline BankingAgent panel to appear and be ready.
  154 |  * Customer /dashboard renders the agent inline (no FAB).
  155 |  */
  156 | async function ensureAgentReady(page) {
  157 |   const panel = page.locator('.banking-agent-panel');
  158 |   const fab = page.locator('.banking-agent-fab');
  159 | 
  160 |   await Promise.race([
  161 |     panel.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
  162 |     fab.first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
  163 |   ]);
  164 | 
  165 |   if (!(await panel.isVisible().catch(() => false)) && (await fab.count())) {
  166 |     await fab.first().click();
  167 |   }
  168 |   await expect(panel).toBeVisible({ timeout: 20000 });
  169 | }
  170 | 
  171 | /**
  172 |  * Open the Actions popout if not already open, then navigate to the
  173 |  * BankingChips area (Quick Actions section).
  174 |  *
  175 |  * The chips live inside `.banking-chips-content` which is rendered inside
  176 |  * the agent panel — it may be directly visible or inside the Actions popout
  177 |  * depending on the agent chrome mode.
  178 |  */
  179 | async function openChipsPanel(page) {
  180 |   // Try the Actions trigger first (popout-mode chrome)
  181 |   const trigger = page.locator('button.ba-actions-trigger').first();
  182 |   if (await trigger.isVisible({ timeout: 3000 }).catch(() => false)) {
  183 |     const popout = page.locator('.ba-actions-popout');
  184 |     if (!(await popout.isVisible().catch(() => false))) {
  185 |       await trigger.click();
> 186 |       await expect(popout).toBeVisible({ timeout: 10000 });
      |                            ^ Error: expect(locator).toBeVisible() failed
  187 |     }
  188 |   }
  189 | }
  190 | 
  191 | // ── Tests ──────────────────────────────────────────────────────────────────────
  192 | 
  193 | test.describe('Chip labels per vertical theme', () => {
  194 | 
  195 |   for (const verticalId of VERTICALS) {
  196 |     const manifest = loadVertical(verticalId);
  197 |     const manifestChips = (manifest.dashboard && manifest.dashboard.chips) || [];
  198 | 
  199 |     // Build expected label map from the manifest
  200 |     const expectedLabels = {};
  201 |     for (const c of manifestChips) {
  202 |       if (INVARIANT_MESSAGES[c.key] !== undefined) {
  203 |         expectedLabels[c.key] = c.label;
  204 |       }
  205 |     }
  206 | 
  207 |     test.describe(`Vertical: ${verticalId}`, () => {
  208 | 
  209 |       test(`[${verticalId}] Quick Action chips show manifest labels`, async ({ page }) => {
  210 |         await mockCustomerWithVertical(page, manifest);
  211 |         await page.goto('/dashboard');
  212 |         await ensureAgentReady(page);
  213 |         await openChipsPanel(page);
  214 | 
  215 |         // The BankingChips "Quick Actions" section renders heuristic chips
  216 |         const chipsSection = page.locator('.banking-chips-dropdown__section')
  217 |           .filter({ has: page.locator('.banking-chips-dropdown__label', { hasText: 'Quick Actions' }) });
  218 |         await expect(chipsSection).toBeVisible({ timeout: 15000 });
  219 | 
  220 |         for (const [key, label] of Object.entries(expectedLabels)) {
  221 |           const chipBtn = chipsSection.locator('.banking-chips-dropdown__button', { hasText: label });
  222 |           await expect(
  223 |             chipBtn.first(),
  224 |             `[${verticalId}] chip key="${key}" should have label "${label}"`,
  225 |           ).toBeVisible({ timeout: 10000 });
  226 |         }
  227 |       });
  228 | 
  229 |       // For each chip key with a known invariant message, verify the click
  230 |       // sends the invariant routing message (not the display label).
  231 |       for (const [key, invariantMessage] of Object.entries(INVARIANT_MESSAGES)) {
  232 |         const label = expectedLabels[key];
  233 |         if (!label) continue; // vertical doesn't define this chip key — skip
  234 | 
  235 |         test(`[${verticalId}] clicking "${label}" (key=${key}) sends invariant message "${invariantMessage}"`, async ({ page }) => {
  236 |           const nlRequests = [];
  237 | 
  238 |           await mockCustomerWithVertical(page, manifest);
  239 | 
  240 |           // Intercept NL calls — capture request body before fulfilling
  241 |           await page.route('**/api/demo-agent/nl', async (route) => {
  242 |             const body = route.request().postDataJSON();
  243 |             nlRequests.push(body);
  244 |             await route.fulfill({
  245 |               status: 200,
  246 |               contentType: 'application/json',
  247 |               body: JSON.stringify({
  248 |                 source: 'heuristic',
  249 |                 kind: 'banking',
  250 |                 action: 'get_my_accounts',
  251 |                 result: { accounts: [] },
  252 |                 executed: true,
  253 |                 tokenEvents: [],
  254 |               }),
  255 |             });
  256 |           });
  257 | 
  258 |           // Also stub MCP tool so any follow-up MCP call doesn't error
  259 |           await page.route('**/api/mcp/tool', (route) =>
  260 |             route.fulfill({ status: 200, contentType: 'application/json',
  261 |               body: JSON.stringify({ result: { accounts: [] } }) }),
  262 |           );
  263 | 
  264 |           await page.goto('/dashboard');
  265 |           await ensureAgentReady(page);
  266 |           await openChipsPanel(page);
  267 | 
  268 |           const chipsSection = page.locator('.banking-chips-dropdown__section')
  269 |             .filter({ has: page.locator('.banking-chips-dropdown__label', { hasText: 'Quick Actions' }) });
  270 |           await expect(chipsSection).toBeVisible({ timeout: 15000 });
  271 | 
  272 |           const chipBtn = chipsSection.locator('.banking-chips-dropdown__button', { hasText: label }).first();
  273 |           await expect(chipBtn).toBeVisible({ timeout: 10000 });
  274 |           await chipBtn.click();
  275 | 
  276 |           // Wait for the NL request to arrive
  277 |           await page.waitForTimeout(2000);
  278 | 
  279 |           expect(
  280 |             nlRequests.length,
  281 |             `[${verticalId}] clicking chip "${label}" should POST to /api/demo-agent/nl`,
  282 |           ).toBeGreaterThan(0);
  283 | 
  284 |           const lastReq = nlRequests[nlRequests.length - 1];
  285 |           expect(
  286 |             lastReq.message,
```