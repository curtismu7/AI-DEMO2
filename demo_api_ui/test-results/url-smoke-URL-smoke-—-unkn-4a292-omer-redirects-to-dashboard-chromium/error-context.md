# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: url-smoke.spec.js >> URL smoke — unknown routes redirect (no 404 / blank) >> unknown route as customer redirects to /dashboard
- Location: tests/e2e/url-smoke.spec.js:349:3

# Error details

```
Error: Unknown route went to /this-does-not-exist

expect(received).toContain(expected) // indexOf

Expected value: "/this-does-not-exist"
Received array: ["/dashboard", "/admin"]
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
          - status "Session status" [ref=e224]:
            - generic [ref=e226]: No token — please sign in
          - button "Search" [ref=e228] [cursor=pointer]:
            - img [ref=e229]
        - button "Sign In" [ref=e233] [cursor=pointer]:
          - img [ref=e234]
          - generic [ref=e237]: Sign In
        - button "User menu" [ref=e239] [cursor=pointer]:
          - generic [ref=e240]: C
          - img [ref=e241]
  - main [ref=e244]:
    - generic [ref=e246]:
      - generic [ref=e247]: "404"
      - heading "Page not found" [level=1] [ref=e248]
      - paragraph [ref=e249]:
        - code [ref=e250]: /this-does-not-exist
        - text: doesn't exist.
      - generic [ref=e251]:
        - button "Go Home" [ref=e252] [cursor=pointer]
        - button "Go Back" [ref=e253] [cursor=pointer]
  - dialog [ref=e254]:
    - generic [ref=e256]:
      - generic [ref=e257]:
        - heading [level=2] [ref=e258]:
          - text: Backchannel Authentication
          - generic [ref=e259]: Disabled
        - paragraph [ref=e260]:
          - text: OIDC CIBA plus OAuth tokens, Backend-for-Frontend (BFF) session, MCP, and RFC 8693 token exchange — open
          - strong [ref=e261]: Full stack
          - text: for the map and
          - strong [ref=e262]: Token exchange
          - text: for before/after
          - code [ref=e263]: /token
          - text: ", statuses, and responses."
      - button [ref=e264] [cursor=pointer]: ✕
    - generic [ref=e265]:
      - button [ref=e266] [cursor=pointer]: What is CIBA
      - button [ref=e267] [cursor=pointer]: Sign-in & roles
      - button [ref=e268] [cursor=pointer]: Full stack
      - button [ref=e269] [cursor=pointer]: Token exchange
      - button [ref=e270] [cursor=pointer]: vs Login Flow
      - button [ref=e271] [cursor=pointer]: ▶ Try It
      - button [ref=e272] [cursor=pointer]: App Flows
      - button [ref=e273] [cursor=pointer]: PingOne Setup
      - button [ref=e274] [cursor=pointer]: BFF code
    - generic [ref=e276]:
      - paragraph [ref=e277]:
        - text: CIBA (Client-Initiated Backchannel Authentication, OpenID CIBA Core 1.0) decouples the
        - strong [ref=e278]: consumption device
        - text: (where the app runs) from where the user
        - strong [ref=e279]: approves
        - text: — often another device or their email inbox. No browser redirect, no popup. PingOne delivers the approval step by
        - strong [ref=e280]: email
        - text: or
        - strong [ref=e281]: push
        - text: depending on your DaVinci configuration.
      - heading [level=3] [ref=e282]: The flow (6 steps)
      - generic [ref=e283]: "1. App (server) ──POST /bc-authorize──▶ PingOne { login_hint: \"user@bank.com\", scope: \"openid write\", binding_message: \"Approve $500 transfer\" } 2. PingOne ◀─────────────────────────── auth_req_id returned 3. PingOne ──out-of-band approval────▶ User (channel is your PingOne / DaVinci setup) • Email: approval link in inbox — OR — • Push: notification on registered device 4. User approves (link in email or tap Approve on device) 5. App polls POST /token (grant=ciba, auth_req_id=...) → authorization_pending (repeat every 5s) → tokens returned ✓ 6. Tokens stored server-side (never sent to browser) Tool call / transaction executes with user context"
      - heading [level=3] [ref=e284]: "Real HTTP: bc-authorize request & response"
      - generic [ref=e285]: "POST {issuer}/as/bc-authorize Content-Type: application/x-www-form-urlencoded Authorization: Basic <base64(client_id:client_secret)> scope=openid%20banking%3Awrite &login_hint=user%40bank.com &binding_message=Approve%20%24500%20transfer &acr_values=Multi_factor (optional step-up) &client_notification_token=... (required for ping/push delivery mode) HTTP/1.1 200 OK { \"auth_req_id\": \"abc123xyz...\", \"expires_in\": 300, \"interval\": 5 }"
      - heading [level=3] [ref=e286]: "Real HTTP: polling for tokens"
      - generic [ref=e287]: "POST {issuer}/as/token Content-Type: application/x-www-form-urlencoded grant_type=urn:openid:params:grant-type:ciba &auth_req_id=abc123xyz... &client_id=... &client_secret=... ── If user has not yet approved ── HTTP/1.1 400 Bad Request { \"error\": \"authorization_pending\" } ── If poll is too fast ── HTTP/1.1 400 Bad Request { \"error\": \"slow_down\" } → increase interval by 5s ── On approval ── HTTP/1.1 200 OK { \"access_token\": \"...\", \"token_type\": \"Bearer\", \"id_token\": \"...\", \"refresh_token\": \"...\", \"expires_in\": 3600 } ── On denial / timeout ── HTTP/1.1 400 Bad Request { \"error\": \"access_denied\" | \"expired_token\" }"
      - heading [level=3] [ref=e288]: Key concepts
      - list [ref=e289]:
        - listitem [ref=e290]:
          - strong [ref=e291]: auth_req_id
          - text: — a short-lived opaque ID returned by PingOne when
          - code [ref=e292]: POST /bc-authorize
          - text: succeeds. The server uses it to poll
          - code [ref=e293]: POST /token
          - text: until the user approves or the request expires.
        - listitem [ref=e294]:
          - strong [ref=e295]: binding_message
          - text: — the text shown in the approval email or push notification, e.g.
          - emphasis [ref=e296]: "\"Approve $500 transfer to Savings\""
          - text: . Helps the user confirm exactly what they are authorising.
        - listitem [ref=e297]:
          - strong [ref=e298]: login_hint
          - text: — the user's email address. PingOne resolves this to the target account and sends the approval to the right inbox or device.
        - listitem [ref=e299]:
          - strong [ref=e300]: Poll vs Ping delivery mode
          - text: —
          - emphasis [ref=e301]: Poll
          - text: ": server calls"
          - code [ref=e302]: POST /token
          - text: every 5 s (or
          - code [ref=e303]: interval
          - text: seconds).
          - emphasis [ref=e304]: Ping
          - text: ": PingOne calls a"
          - code [ref=e305]: client_notification_endpoint
          - text: when the user approves (requires a publicly reachable callback URL). This demo uses Poll mode.
        - listitem [ref=e306]:
          - strong [ref=e307]: Backend-for-Frontend (BFF) pattern — tokens never reach the browser
          - text: — tokens are stored in the server-side session. The browser only receives approval status updates via the Backend-for-Frontend (BFF) poll API. XSS cannot steal them.
        - listitem [ref=e308]:
          - strong [ref=e309]: Email vs push
          - text: — controlled by your PingOne / DaVinci flow, not by this app. Email-only CIBA requires no push-capable MFA device.
      - heading [level=3] [ref=e310]: When to use CIBA (vs Authorization Code)
      - list [ref=e311]:
        - listitem [ref=e312]: LLM / agent contexts where a browser redirect would break the flow.
        - listitem [ref=e313]: Step-up authentication mid-session (high-value transaction) without a page reload.
        - listitem [ref=e314]: IoT / headless devices that cannot host a redirect URI.
        - listitem [ref=e315]: Delegated approval — approve on phone while viewing dashboard on desktop.
  - dialog [ref=e316]:
    - generic [ref=e318]:
      - generic [ref=e319]:
        - heading [level=2] [ref=e320]: 📄 Client ID Metadata Document
        - paragraph [ref=e321]: draft-ietf-oauth-client-id-metadata-document — the client_id is a URL
      - button [ref=e322] [cursor=pointer]: ✕
    - tablist [ref=e323]:
      - tab [selected] [ref=e324] [cursor=pointer]: What is CIMD
      - tab [ref=e325] [cursor=pointer]: CIMD vs DCR
      - tab [ref=e326] [cursor=pointer]: Doc format
      - tab [ref=e327] [cursor=pointer]: How AS uses it
      - tab [ref=e328] [cursor=pointer]: Flow diagram
      - tab [ref=e329] [cursor=pointer]: ▶ Simulate
      - tab [ref=e330] [cursor=pointer]: PingOne
    - tabpanel [ref=e331]:
      - paragraph [ref=e332]:
        - strong [ref=e333]: OAuth Client ID Metadata Document (CIMD)
        - text: is an IETF draft (
        - link [ref=e334] [cursor=pointer]:
          - /url: https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/
          - text: draft-ietf-oauth-client-id-metadata-document
        - text: ) that redefines what a
        - code [ref=e335]: client_id
        - text: is. Instead of an opaque string like
        - code [ref=e336]: abc123
        - text: ", the"
        - code [ref=e337]: client_id
        - text: becomes a
        - strong [ref=e338]: URL
        - text: . When the authorization server receives that URL, it fetches the document at that URL to discover the client's metadata (redirect URIs, grant types, scopes, etc.).
      - generic [ref=e339]:
        - strong [ref=e340]: "Core idea:"
        - text: The
        - code [ref=e341]: client_id
        - text: IS the metadata document URL. The client controls the URL, so the client controls its own registration data.
      - list [ref=e342]:
        - listitem [ref=e343]:
          - code [ref=e344]: client_id
          - text: is a URL, e.g.
          - code [ref=e345]: https://app.example.com/.well-known/oauth-client/my-app
        - listitem [ref=e346]:
          - text: The AS fetches that URL and reads the metadata (
          - code [ref=e347]: redirect_uris
          - text: ","
          - code [ref=e348]: grant_types
          - text: ", etc.)"
        - listitem [ref=e349]: The client self-describes by controlling the hosted document
        - listitem [ref=e350]: Eliminates out-of-band registration in AS implementations that support the draft
        - listitem [ref=e351]: "Updates are instant: just update the hosted JSON file"
      - heading [level=3] [ref=e352]: What this demo does
      - paragraph [ref=e353]: "This demo bridges the gap between the draft and PingOne. You fill in a CIMD-style form, the backend creates the OAuth application in PingOne via the Management API, then hosts the CIMD document at:"
      - code [ref=e355]: "GET /.well-known/oauth-client/{pingone-app-id}"
      - paragraph [ref=e356]:
        - text: Use the
        - strong [ref=e357]: ▶ Simulate
        - text: tab to watch the full AS-fetches-CIMD flow animated step by step.
      - heading [level=3] [ref=e358]: Key references
      - list [ref=e359]:
        - listitem [ref=e360]:
          - link [ref=e361] [cursor=pointer]:
            - /url: https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/
            - text: draft-ietf-oauth-client-id-metadata-document (IETF)
        - listitem [ref=e362]:
          - link [ref=e363] [cursor=pointer]:
            - /url: https://www.rfc-editor.org/rfc/rfc7591
            - text: RFC 7591 — OAuth 2.0 Dynamic Client Registration
          - text: (compare & contrast)
  - contentinfo [ref=e364]:
    - generic [ref=e365]:
      - generic [ref=e366]: AI Demo Demo
      - generic [ref=e367]: © 2026 All rights reserved.
```

# Test source

```ts
  254 |   '/webmcp',
  255 |   '/oauth-debug-logs',
  256 |   '/client-registration',
  257 |   '/postman',
  258 |   '/scope-audit',
  259 |   '/scope-reference',
  260 |   '/oauth/token-display',
  261 |   '/agent-flow-inspector',
  262 |   '/agentic-trust',
  263 |   '/actor-token-education',
  264 |   '/langchain',
  265 |   '/llm-config',
  266 |   '/mcp-gateway',
  267 |   '/mcp-inspector',
  268 |   '/resource-server',
  269 |   '/resource-server-cc',
  270 |   // Monitoring sub-routes
  271 |   '/monitoring/token-chain',
  272 |   '/monitoring/flow-inspector',
  273 |   '/monitoring/mcp-traffic',
  274 |   '/monitoring/api-explorer',
  275 |   // Architecture sub-routes
  276 |   '/architecture/overview',
  277 |   '/architecture/token-flow',
  278 |   '/architecture/flow',
  279 | ];
  280 | 
  281 | // ─── Tests ───────────────────────────────────────────────────────────────────
  282 | 
  283 | test.describe('URL smoke — public routes (unauthenticated)', () => {
  284 |   test.beforeEach(async ({ page }) => {
  285 |     await mockNoAuth(page);
  286 |   });
  287 | 
  288 |   for (const route of PUBLIC_ROUTES) {
  289 |     test(`${route.path} renders without crash`, async ({ page }) => {
  290 |       await smokeCheck(page, route.path, { allowRedirectTo: route.allowRedirectTo });
  291 |     });
  292 |   }
  293 | });
  294 | 
  295 | test.describe('URL smoke — customer routes', () => {
  296 |   test.beforeEach(async ({ page }) => {
  297 |     await mockCustomerAuth(page);
  298 |   });
  299 | 
  300 |   for (const path of CUSTOMER_ROUTES) {
  301 |     test(`${path} renders without crash`, async ({ page }) => {
  302 |       await smokeCheck(page, path, { allowRedirectTo: ['/dashboard', '/login'] });
  303 |     });
  304 |   }
  305 | });
  306 | 
  307 | test.describe('URL smoke — admin routes', () => {
  308 |   test.beforeEach(async ({ page }) => {
  309 |     await mockAdminAuth(page);
  310 |   });
  311 | 
  312 |   for (const entry of ADMIN_ROUTES) {
  313 |     const routePath = typeof entry === 'string' ? entry : entry.path;
  314 |     const redirectAllow = typeof entry === 'string'
  315 |       ? ['/admin', '/login']
  316 |       : entry.allowRedirectTo;
  317 |     test(`${routePath} renders without crash`, async ({ page }) => {
  318 |       await smokeCheck(page, routePath, { allowRedirectTo: redirectAllow });
  319 |     });
  320 |   }
  321 | });
  322 | 
  323 | /** Wait for the React app to redirect away from `startPath`. */
  324 | async function waitForRedirectFrom(page, startPath) {
  325 |   try {
  326 |     await page.waitForFunction(
  327 |       (sp) => {
  328 |         const root = document.getElementById('root');
  329 |         if (!root || root.children.length === 0) return false;
  330 |         return new URL(window.location.href).pathname !== sp;
  331 |       },
  332 |       startPath,
  333 |       { timeout: 10000 },
  334 |     );
  335 |   } catch (_) {
  336 |     // If no redirect fired, we fall through; the assertion below will report.
  337 |   }
  338 | }
  339 | 
  340 | test.describe('URL smoke — unknown routes redirect (no 404 / blank)', () => {
  341 |   test('unknown route as admin redirects to /admin', async ({ page }) => {
  342 |     await mockAdminAuth(page);
  343 |     await page.goto('/this-does-not-exist', { waitUntil: 'domcontentloaded' });
  344 |     await waitForRedirectFrom(page, '/this-does-not-exist');
  345 |     const path = new URL(page.url()).pathname;
  346 |     expect(['/admin', '/dashboard'], `Unknown route went to ${path}`).toContain(path);
  347 |   });
  348 | 
  349 |   test('unknown route as customer redirects to /dashboard', async ({ page }) => {
  350 |     await mockCustomerAuth(page);
  351 |     await page.goto('/this-does-not-exist', { waitUntil: 'domcontentloaded' });
  352 |     await waitForRedirectFrom(page, '/this-does-not-exist');
  353 |     const path = new URL(page.url()).pathname;
> 354 |     expect(['/dashboard', '/admin'], `Unknown route went to ${path}`).toContain(path);
      |                                                                       ^ Error: Unknown route went to /this-does-not-exist
  355 |   });
  356 | 
  357 |   test('unknown route unauthenticated does not crash', async ({ page }) => {
  358 |     await mockNoAuth(page);
  359 |     await page.goto('/this-does-not-exist', { waitUntil: 'domcontentloaded' });
  360 |     // Unauthenticated catch-all renders TopNav without redirecting — no crash
  361 |     // is the important guarantee; the URL may stay or redirect.
  362 |     try {
  363 |       await page.waitForFunction(
  364 |         () => {
  365 |           const root = document.getElementById('root');
  366 |           return root !== null && root.children.length > 0;
  367 |         },
  368 |         { timeout: 10000 },
  369 |       );
  370 |     } catch (_) {}
  371 |     const path = new URL(page.url()).pathname;
  372 |     expect(
  373 |       ['/', '/login', '/dashboard', '/admin', '/this-does-not-exist'],
  374 |       `Unknown unauthenticated route went to unexpected path ${path}`,
  375 |     ).toContain(path);
  376 |   });
  377 | });
  378 | 
```