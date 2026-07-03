# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: url-smoke.spec.js >> URL smoke — unknown routes redirect (no 404 / blank) >> unknown route as admin redirects to /admin
- Location: tests/e2e/url-smoke.spec.js:341:3

# Error details

```
Error: Unknown route went to /this-does-not-exist

expect(received).toContain(expected) // indexOf

Expected value: "/this-does-not-exist"
Received array: ["/admin", "/dashboard"]
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
        - button "Monitoring ▶" [ref=e37] [cursor=pointer]:
          - img [ref=e38]
          - generic [ref=e41]: Monitoring
          - generic [ref=e42]: ▶
        - button "MCP ▶" [ref=e44] [cursor=pointer]:
          - img [ref=e45]
          - generic [ref=e48]: MCP
          - generic [ref=e49]: ▶
        - button "Agent Gateway Server ▶" [ref=e51] [cursor=pointer]:
          - img [ref=e52]
          - generic [ref=e55]: Agent Gateway Server
          - generic [ref=e56]: ▶
        - link "PingOne MCP Setup" [ref=e57] [cursor=pointer]:
          - /url: /pingone-setup
          - img [ref=e58]
          - generic [ref=e61]: PingOne MCP Setup
        - button "Vertical Ops ▶" [ref=e63] [cursor=pointer]:
          - img [ref=e64]
          - generic [ref=e67]: Vertical Ops
          - generic [ref=e68]: ▶
        - button "Authorize ▶" [ref=e70] [cursor=pointer]:
          - img [ref=e71]
          - generic [ref=e75]: Authorize
          - generic [ref=e76]: ▶
        - button "OAuth & Identity ▶" [ref=e78] [cursor=pointer]:
          - img [ref=e79]
          - generic [ref=e82]: OAuth & Identity
          - generic [ref=e83]: ▶
        - button "AI Attack Demos ▶" [ref=e85] [cursor=pointer]:
          - img [ref=e86]
          - generic [ref=e89]: AI Attack Demos
          - generic [ref=e90]: ▶
        - button "Diagrams ▶" [ref=e92] [cursor=pointer]:
          - img [ref=e93]
          - generic [ref=e96]: Diagrams
          - generic [ref=e97]: ▶
        - button "Users & Accounts 🛡️ admin ▶" [ref=e99] [cursor=pointer]:
          - img [ref=e100]
          - generic [ref=e103]: Users & Accounts
          - generic [ref=e104]: 🛡️ admin
          - generic [ref=e105]: ▶
        - button "System Tools 🛡️ admin ▶" [ref=e107] [cursor=pointer]:
          - img [ref=e108]
          - generic [ref=e111]: System Tools
          - generic [ref=e112]: 🛡️ admin
          - generic [ref=e113]: ▶
        - button "Tests ▶" [ref=e115] [cursor=pointer]:
          - img [ref=e116]
          - generic [ref=e119]: Tests
          - generic [ref=e120]: ▶
        - link "Code Explorer" [ref=e121] [cursor=pointer]:
          - /url: /code-explorer
          - img [ref=e122]
          - generic [ref=e125]: Code Explorer
        - link "Code Search" [ref=e126] [cursor=pointer]:
          - /url: /code-search
          - img [ref=e127]
          - generic [ref=e130]: Code Search
        - link "OAuth Academy" [ref=e131] [cursor=pointer]:
          - /url: /oauth-academy
          - img [ref=e132]
          - generic [ref=e135]: OAuth Academy
        - link "OAS Demo" [ref=e136] [cursor=pointer]:
          - /url: /oas-demo
          - img [ref=e137]
          - generic [ref=e140]: OAS Demo
        - link "Learning Hub" [ref=e141] [cursor=pointer]:
          - /url: /learning
          - img [ref=e142]
          - generic [ref=e145]: Learning Hub
        - link "llama-vscode Guide" [ref=e146] [cursor=pointer]:
          - /url: /llama-vscode-guide
          - img [ref=e147]
          - generic [ref=e150]: llama-vscode Guide
        - link "Run Reports" [ref=e151] [cursor=pointer]:
          - /url: /reports
          - img [ref=e152]
          - generic [ref=e155]: Run Reports
        - link "PingOne Agent Builder" [ref=e156] [cursor=pointer]:
          - /url: /agent-builder
          - img [ref=e157]
          - generic [ref=e160]: PingOne Agent Builder
        - link "AI Control Plane" [ref=e161] [cursor=pointer]:
          - /url: /ai-control-plane
          - img [ref=e162]
          - generic [ref=e165]: AI Control Plane
      - button "Agent UI ▶" [ref=e169] [cursor=pointer]:
        - img [ref=e170]
        - generic [ref=e173]: Agent UI
        - generic [ref=e174]: ▶
      - button "Vertical ▶" [ref=e178] [cursor=pointer]:
        - img [ref=e179]
        - generic [ref=e182]: Vertical
        - generic [ref=e183]: ▶
      - button "STOP AGENT" [ref=e186] [cursor=pointer]:
        - img [ref=e187]
        - generic [ref=e190]: STOP AGENT
      - generic [ref=e192]:
        - button "Customer View" [ref=e193] [cursor=pointer]:
          - img [ref=e194]
          - generic [ref=e197]: Customer View
        - button "Reset Demo" [ref=e198] [cursor=pointer]:
          - img [ref=e199]
          - generic [ref=e202]: Reset Demo
        - button "Sign Out" [ref=e203] [cursor=pointer]:
          - img [ref=e204]
          - generic [ref=e207]: Sign Out
  - banner [ref=e208]:
    - generic [ref=e209]:
      - button "Go to dashboard" [ref=e211] [cursor=pointer]:
        - img [ref=e212]
        - generic [ref=e215]: AI Demo
      - generic [ref=e216]: Customer
      - navigation [ref=e217]:
        - button "Customer" [ref=e218] [cursor=pointer]
        - button "Admin" [ref=e219] [cursor=pointer]
        - button "Setup" [ref=e220] [cursor=pointer]
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
          - generic [ref=e240]: A
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
  246 |   '/mfa-test',
  247 |   '/authz-test',
  248 |   '/mcp-tools',
  249 |   '/mcp-traffic',
  250 |   '/api-traffic',
  251 |   '/dev-tools',
  252 |   '/error-audit',
  253 |   '/token-compliance',
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
> 346 |     expect(['/admin', '/dashboard'], `Unknown route went to ${path}`).toContain(path);
      |                                                                       ^ Error: Unknown route went to /this-does-not-exist
  347 |   });
  348 | 
  349 |   test('unknown route as customer redirects to /dashboard', async ({ page }) => {
  350 |     await mockCustomerAuth(page);
  351 |     await page.goto('/this-does-not-exist', { waitUntil: 'domcontentloaded' });
  352 |     await waitForRedirectFrom(page, '/this-does-not-exist');
  353 |     const path = new URL(page.url()).pathname;
  354 |     expect(['/dashboard', '/admin'], `Unknown route went to ${path}`).toContain(path);
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