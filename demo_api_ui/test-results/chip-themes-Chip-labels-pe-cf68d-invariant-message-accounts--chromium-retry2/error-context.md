# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chip-themes.spec.js >> Chip labels per vertical theme >> Vertical: healthcare >> [healthcare] clicking "My Records" (key=accounts) sends invariant message "accounts"
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
- generic [ref=e1]:
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
          - link "AI Control Plane" [ref=e160] [cursor=pointer]:
            - /url: /ai-control-plane
            - img [ref=e161]
            - generic [ref=e164]: AI Control Plane
        - button "Agent UI ▶" [ref=e168] [cursor=pointer]:
          - img [ref=e169]
          - generic [ref=e172]: Agent UI
          - generic [ref=e173]: ▶
        - button "Vertical ▶" [ref=e177] [cursor=pointer]:
          - img [ref=e178]
          - generic [ref=e181]: Vertical
          - generic [ref=e182]: ▶
        - button "STOP AGENT" [ref=e185] [cursor=pointer]:
          - img [ref=e186]
          - generic [ref=e189]: STOP AGENT
        - generic [ref=e191]:
          - button "Admin View" [ref=e192] [cursor=pointer]:
            - img [ref=e193]
            - generic [ref=e196]: Admin View
          - button "Reset Demo" [ref=e197] [cursor=pointer]:
            - img [ref=e198]
            - generic [ref=e201]: Reset Demo
          - button "Sign Out" [ref=e202] [cursor=pointer]:
            - img [ref=e203]
            - generic [ref=e206]: Sign Out
    - banner [ref=e207]:
      - generic [ref=e208]:
        - button "Go to dashboard" [ref=e210] [cursor=pointer]:
          - img [ref=e211]
          - generic [ref=e214]: AI Demo
        - generic [ref=e215]: Customer
        - button "Use Cases" [ref=e216] [cursor=pointer]
        - generic [ref=e217]:
          - generic [ref=e218]:
            - toolbar "Dashboard actions" [ref=e219]:
              - 'group "AI banking agent: embedded or float; optional FAB" [ref=e220]':
                - generic [ref=e221]: Choose layout
                - generic [ref=e222]:
                  - toolbar "Choose layout" [ref=e223]:
                    - button "Embedded" [pressed] [ref=e224] [cursor=pointer]
                    - button "Bottom" [ref=e225] [cursor=pointer]
                    - button "Float" [ref=e226] [cursor=pointer]
                  - generic [ref=e227] [cursor=pointer]:
                    - checkbox "Always show float agent" [checked] [ref=e228]
                    - generic [ref=e229]: Always float
              - button "Controls" [ref=e231] [cursor=pointer]
              - button "Reset Demo" [ref=e232] [cursor=pointer]
            - status "Session status" [ref=e233]:
              - generic [ref=e235]: No token — please sign in
            - button "Search" [ref=e237] [cursor=pointer]:
              - img [ref=e238]
          - button "Sign In" [ref=e242] [cursor=pointer]:
            - img [ref=e243]
            - generic [ref=e246]: Sign In
          - button "User menu" [ref=e248] [cursor=pointer]:
            - generic [ref=e249]: T
            - img [ref=e250]
    - main [ref=e253]:
      - generic [ref=e255]:
        - complementary "Token chain" [ref=e256]:
          - generic [ref=e257]:
            - generic [ref=e258]:
              - generic [ref=e259] [cursor=pointer]:
                - generic [ref=e260]: Token Exchange Mode
                - generic [ref=e261]:
                  - generic [ref=e262]: RFC 8693 Delegation
                  - generic [ref=e263]: ▼
              - paragraph [ref=e264]:
                - strong [ref=e265]: "Chained delegation:"
                - text: User Token → Agent Token → Delegated Access Token (nested
                - code [ref=e266]: act
                - text: claim)
            - generic [ref=e267]:
              - generic [ref=e268]:
                - generic [ref=e269]: 🔗 Token Chain
                - button "Legend" [ref=e270] [cursor=pointer]
              - generic [ref=e271]:
                - text: User
                - generic [ref=e273]: →
                - text: Agent
                - generic [ref=e275]: →
                - text: MCP
                - generic [ref=e277]: CHAINED
              - generic [ref=e278]: Pipeline — awaiting agent action
              - group [ref=e279]:
                - generic "· 1. Sign-in — User Token acquired PINGONE" [ref=e280] [cursor=pointer]:
                  - generic [ref=e281]: ·
                  - generic [ref=e282]: 1. Sign-in — User Token acquired
                  - generic [ref=e283]: PINGONE
              - group [ref=e284]:
                - generic "· 2. Chatbot — prompt sent CHAT" [ref=e285] [cursor=pointer]:
                  - generic [ref=e286]: ·
                  - generic [ref=e287]: 2. Chatbot — prompt sent
                  - generic [ref=e288]: CHAT
              - group [ref=e289]:
                - generic "· 3. Agent service receives request AGENT" [ref=e290] [cursor=pointer]:
                  - generic [ref=e291]: ·
                  - generic [ref=e292]: 3. Agent service receives request
                  - generic [ref=e293]: AGENT
              - group [ref=e294]:
                - generic "· 4. LLM — reasoning & tool choice LLM" [ref=e295] [cursor=pointer]:
                  - generic [ref=e296]: ·
                  - generic [ref=e297]: 4. LLM — reasoning & tool choice
                  - generic [ref=e298]: LLM
              - group [ref=e299]:
                - generic "· 5. Agent identity token BFF" [ref=e300] [cursor=pointer]:
                  - generic [ref=e301]: ·
                  - generic [ref=e302]: 5. Agent identity token
                  - generic [ref=e303]: BFF
              - group [ref=e304]:
                - generic "· 6. Token exchange — delegation BFF" [ref=e305] [cursor=pointer]:
                  - generic [ref=e306]: ·
                  - generic [ref=e307]: 6. Token exchange — delegation
                  - generic [ref=e308]: BFF
              - group [ref=e309]:
                - generic "· 7. PingOne Authorize — policy decision AUTHZ" [ref=e310] [cursor=pointer]:
                  - generic [ref=e311]: ·
                  - generic [ref=e312]: 7. PingOne Authorize — policy decision
                  - generic [ref=e313]: AUTHZ
              - group [ref=e314]:
                - generic "· 8. Agent Gateway — token validated GATEWAY" [ref=e315] [cursor=pointer]:
                  - generic [ref=e316]: ·
                  - generic [ref=e317]: 8. Agent Gateway — token validated
                  - generic [ref=e318]: GATEWAY
              - group [ref=e319]:
                - generic "· 9. MCP server — tool executes MCP" [ref=e320] [cursor=pointer]:
                  - generic [ref=e321]: ·
                  - generic [ref=e322]: 9. MCP server — tool executes
                  - generic [ref=e323]: MCP
              - group [ref=e324]:
                - generic "· 10. Resource server — API call API" [ref=e325] [cursor=pointer]:
                  - generic [ref=e326]: ·
                  - generic [ref=e327]: 10. Resource server — API call
                  - generic [ref=e328]: API
              - group [ref=e329]:
                - generic "· 11. LLM composes reply → chat LLM" [ref=e330] [cursor=pointer]:
                  - generic [ref=e331]: ·
                  - generic [ref=e332]: 11. LLM composes reply → chat
                  - generic [ref=e333]: LLM
              - group [ref=e334]:
                - generic "▶ Exchange Mode Details" [ref=e335] [cursor=pointer]:
                  - generic [ref=e336]: ▶
                  - text: Exchange Mode Details
        - region "AI banking assistant" [ref=e337]:
          - dialog "AI Demo AI Agent" [ref=e341]:
            - button "AI Demo Assistant Customer · Test user-123 RFC info What's Happening Compliance Token Chain Guide Actions ▾ Sign out" [ref=e342]:
              - generic [ref=e343]:
                - generic [ref=e346]:
                  - generic [ref=e347]: AI Demo Assistant
                  - generic [ref=e348]: Customer · Test
                - generic "PingOne user id" [ref=e350]: user-123
                - generic [ref=e351]:
                  - generic [ref=e352] [cursor=pointer]:
                    - checkbox "RFC info"
                    - generic [ref=e354]: RFC info
                  - generic [ref=e355] [cursor=pointer]:
                    - checkbox "What's Happening"
                    - generic [ref=e357]: What's Happening
                  - generic [ref=e358] [cursor=pointer]:
                    - checkbox "Compliance"
                    - generic [ref=e360]: Compliance
                  - generic [ref=e361] [cursor=pointer]:
                    - checkbox "Token Chain"
                    - generic [ref=e363]: Token Chain
                  - button "Guide" [active] [ref=e364] [cursor=pointer]
                  - button "Actions ▾" [ref=e365] [cursor=pointer]
                  - button "Sign out" [ref=e366] [cursor=pointer]
            - generic [ref=e368]:
              - generic "Simple Stepper" [ref=e369]:
                - generic [ref=e370]: Simple Stepper
                - button "Show" [ref=e371] [cursor=pointer]
              - paragraph [ref=e377]: Hi Test! I'm your AI assistant. I can help with your accounts, explain the OAuth flows behind the scenes, and more. What would you like to do?
              - generic [ref=e379]:
                - textbox "Ask about your accounts…" [ref=e380]
                - button "Send" [disabled] [ref=e381]
              - button "Start Over" [ref=e383] [cursor=pointer]
              - generic [ref=e384]:
                - generic [ref=e385]: ⬆ 0 in
                - generic [ref=e386]: ⬇ 0 out
                - generic [ref=e387]: ∑ 0
          - button "Drag to resize assistant height" [ref=e388] [cursor=pointer]:
            - generic [ref=e391]: Resize height
    - dialog [ref=e392]:
      - generic [ref=e394]:
        - generic [ref=e395]:
          - heading [level=2] [ref=e396]:
            - text: Backchannel Authentication
            - generic [ref=e397]: Disabled
          - paragraph [ref=e398]:
            - text: OIDC CIBA plus OAuth tokens, Backend-for-Frontend (BFF) session, MCP, and RFC 8693 token exchange — open
            - strong [ref=e399]: Full stack
            - text: for the map and
            - strong [ref=e400]: Token exchange
            - text: for before/after
            - code [ref=e401]: /token
            - text: ", statuses, and responses."
        - button [ref=e402] [cursor=pointer]: ✕
      - generic [ref=e403]:
        - button [ref=e404] [cursor=pointer]: What is CIBA
        - button [ref=e405] [cursor=pointer]: Sign-in & roles
        - button [ref=e406] [cursor=pointer]: Full stack
        - button [ref=e407] [cursor=pointer]: Token exchange
        - button [ref=e408] [cursor=pointer]: vs Login Flow
        - button [ref=e409] [cursor=pointer]: ▶ Try It
        - button [ref=e410] [cursor=pointer]: App Flows
        - button [ref=e411] [cursor=pointer]: PingOne Setup
        - button [ref=e412] [cursor=pointer]: BFF code
      - generic [ref=e414]:
        - paragraph [ref=e415]:
          - text: CIBA (Client-Initiated Backchannel Authentication, OpenID CIBA Core 1.0) decouples the
          - strong [ref=e416]: consumption device
          - text: (where the app runs) from where the user
          - strong [ref=e417]: approves
          - text: — often another device or their email inbox. No browser redirect, no popup. PingOne delivers the approval step by
          - strong [ref=e418]: email
          - text: or
          - strong [ref=e419]: push
          - text: depending on your DaVinci configuration.
        - heading [level=3] [ref=e420]: The flow (6 steps)
        - generic [ref=e421]: "1. App (server) ──POST /bc-authorize──▶ PingOne { login_hint: \"user@bank.com\", scope: \"openid write\", binding_message: \"Approve $500 transfer\" } 2. PingOne ◀─────────────────────────── auth_req_id returned 3. PingOne ──out-of-band approval────▶ User (channel is your PingOne / DaVinci setup) • Email: approval link in inbox — OR — • Push: notification on registered device 4. User approves (link in email or tap Approve on device) 5. App polls POST /token (grant=ciba, auth_req_id=...) → authorization_pending (repeat every 5s) → tokens returned ✓ 6. Tokens stored server-side (never sent to browser) Tool call / transaction executes with user context"
        - heading [level=3] [ref=e422]: "Real HTTP: bc-authorize request & response"
        - generic [ref=e423]: "POST {issuer}/as/bc-authorize Content-Type: application/x-www-form-urlencoded Authorization: Basic <base64(client_id:client_secret)> scope=openid%20banking%3Awrite &login_hint=user%40bank.com &binding_message=Approve%20%24500%20transfer &acr_values=Multi_factor (optional step-up) &client_notification_token=... (required for ping/push delivery mode) HTTP/1.1 200 OK { \"auth_req_id\": \"abc123xyz...\", \"expires_in\": 300, \"interval\": 5 }"
        - heading [level=3] [ref=e424]: "Real HTTP: polling for tokens"
        - generic [ref=e425]: "POST {issuer}/as/token Content-Type: application/x-www-form-urlencoded grant_type=urn:openid:params:grant-type:ciba &auth_req_id=abc123xyz... &client_id=... &client_secret=... ── If user has not yet approved ── HTTP/1.1 400 Bad Request { \"error\": \"authorization_pending\" } ── If poll is too fast ── HTTP/1.1 400 Bad Request { \"error\": \"slow_down\" } → increase interval by 5s ── On approval ── HTTP/1.1 200 OK { \"access_token\": \"...\", \"token_type\": \"Bearer\", \"id_token\": \"...\", \"refresh_token\": \"...\", \"expires_in\": 3600 } ── On denial / timeout ── HTTP/1.1 400 Bad Request { \"error\": \"access_denied\" | \"expired_token\" }"
        - heading [level=3] [ref=e426]: Key concepts
        - list [ref=e427]:
          - listitem [ref=e428]:
            - strong [ref=e429]: auth_req_id
            - text: — a short-lived opaque ID returned by PingOne when
            - code [ref=e430]: POST /bc-authorize
            - text: succeeds. The server uses it to poll
            - code [ref=e431]: POST /token
            - text: until the user approves or the request expires.
          - listitem [ref=e432]:
            - strong [ref=e433]: binding_message
            - text: — the text shown in the approval email or push notification, e.g.
            - emphasis [ref=e434]: "\"Approve $500 transfer to Savings\""
            - text: . Helps the user confirm exactly what they are authorising.
          - listitem [ref=e435]:
            - strong [ref=e436]: login_hint
            - text: — the user's email address. PingOne resolves this to the target account and sends the approval to the right inbox or device.
          - listitem [ref=e437]:
            - strong [ref=e438]: Poll vs Ping delivery mode
            - text: —
            - emphasis [ref=e439]: Poll
            - text: ": server calls"
            - code [ref=e440]: POST /token
            - text: every 5 s (or
            - code [ref=e441]: interval
            - text: seconds).
            - emphasis [ref=e442]: Ping
            - text: ": PingOne calls a"
            - code [ref=e443]: client_notification_endpoint
            - text: when the user approves (requires a publicly reachable callback URL). This demo uses Poll mode.
          - listitem [ref=e444]:
            - strong [ref=e445]: Backend-for-Frontend (BFF) pattern — tokens never reach the browser
            - text: — tokens are stored in the server-side session. The browser only receives approval status updates via the Backend-for-Frontend (BFF) poll API. XSS cannot steal them.
          - listitem [ref=e446]:
            - strong [ref=e447]: Email vs push
            - text: — controlled by your PingOne / DaVinci flow, not by this app. Email-only CIBA requires no push-capable MFA device.
        - heading [level=3] [ref=e448]: When to use CIBA (vs Authorization Code)
        - list [ref=e449]:
          - listitem [ref=e450]: LLM / agent contexts where a browser redirect would break the flow.
          - listitem [ref=e451]: Step-up authentication mid-session (high-value transaction) without a page reload.
          - listitem [ref=e452]: IoT / headless devices that cannot host a redirect URI.
          - listitem [ref=e453]: Delegated approval — approve on phone while viewing dashboard on desktop.
    - dialog [ref=e454]:
      - generic [ref=e456]:
        - generic [ref=e457]:
          - heading [level=2] [ref=e458]: 📄 Client ID Metadata Document
          - paragraph [ref=e459]: draft-ietf-oauth-client-id-metadata-document — the client_id is a URL
        - button [ref=e460] [cursor=pointer]: ✕
      - tablist [ref=e461]:
        - tab [selected] [ref=e462] [cursor=pointer]: What is CIMD
        - tab [ref=e463] [cursor=pointer]: CIMD vs DCR
        - tab [ref=e464] [cursor=pointer]: Doc format
        - tab [ref=e465] [cursor=pointer]: How AS uses it
        - tab [ref=e466] [cursor=pointer]: Flow diagram
        - tab [ref=e467] [cursor=pointer]: ▶ Simulate
        - tab [ref=e468] [cursor=pointer]: PingOne
      - tabpanel [ref=e469]:
        - paragraph [ref=e470]:
          - strong [ref=e471]: OAuth Client ID Metadata Document (CIMD)
          - text: is an IETF draft (
          - link [ref=e472] [cursor=pointer]:
            - /url: https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/
            - text: draft-ietf-oauth-client-id-metadata-document
          - text: ) that redefines what a
          - code [ref=e473]: client_id
          - text: is. Instead of an opaque string like
          - code [ref=e474]: abc123
          - text: ", the"
          - code [ref=e475]: client_id
          - text: becomes a
          - strong [ref=e476]: URL
          - text: . When the authorization server receives that URL, it fetches the document at that URL to discover the client's metadata (redirect URIs, grant types, scopes, etc.).
        - generic [ref=e477]:
          - strong [ref=e478]: "Core idea:"
          - text: The
          - code [ref=e479]: client_id
          - text: IS the metadata document URL. The client controls the URL, so the client controls its own registration data.
        - list [ref=e480]:
          - listitem [ref=e481]:
            - code [ref=e482]: client_id
            - text: is a URL, e.g.
            - code [ref=e483]: https://app.example.com/.well-known/oauth-client/my-app
          - listitem [ref=e484]:
            - text: The AS fetches that URL and reads the metadata (
            - code [ref=e485]: redirect_uris
            - text: ","
            - code [ref=e486]: grant_types
            - text: ", etc.)"
          - listitem [ref=e487]: The client self-describes by controlling the hosted document
          - listitem [ref=e488]: Eliminates out-of-band registration in AS implementations that support the draft
          - listitem [ref=e489]: "Updates are instant: just update the hosted JSON file"
        - heading [level=3] [ref=e490]: What this demo does
        - paragraph [ref=e491]: "This demo bridges the gap between the draft and PingOne. You fill in a CIMD-style form, the backend creates the OAuth application in PingOne via the Management API, then hosts the CIMD document at:"
        - code [ref=e493]: "GET /.well-known/oauth-client/{pingone-app-id}"
        - paragraph [ref=e494]:
          - text: Use the
          - strong [ref=e495]: ▶ Simulate
          - text: tab to watch the full AS-fetches-CIMD flow animated step by step.
        - heading [level=3] [ref=e496]: Key references
        - list [ref=e497]:
          - listitem [ref=e498]:
            - link [ref=e499] [cursor=pointer]:
              - /url: https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/
              - text: draft-ietf-oauth-client-id-metadata-document (IETF)
          - listitem [ref=e500]:
            - link [ref=e501] [cursor=pointer]:
              - /url: https://www.rfc-editor.org/rfc/rfc7591
              - text: RFC 7591 — OAuth 2.0 Dynamic Client Registration
            - text: (compare & contrast)
    - contentinfo [ref=e502]:
      - generic [ref=e503]:
        - generic [ref=e504]: AI Demo Demo
        - generic [ref=e505]: © 2026 All rights reserved.
  - dialog [ref=e507]:
    - generic [ref=e516]:
      - generic [ref=e517]: Agent Demo Guide
      - generic [ref=e518]:
        - button "↗" [ref=e519] [cursor=pointer]
        - button "Close" [ref=e520] [cursor=pointer]: ✕
    - generic [ref=e521]:
      - generic [ref=e522]:
        - paragraph [ref=e523]: Real request scenarios mapped to 12 compliance steps. See /architecture/flow for live diagram.
        - generic [ref=e524]:
          - generic [ref=e525]:
            - button "Compliance" [ref=e526] [cursor=pointer]
            - button "Presenter" [ref=e527] [cursor=pointer]
          - button "Reset demo flags" [ref=e528] [cursor=pointer]
      - generic [ref=e529]:
        - generic [ref=e530]:
          - generic [ref=e531]: Scenarios
          - button "1. Read-Only Scope (Simple Path)" [ref=e532] [cursor=pointer]
          - button "2. Scope Denial (403 + Denial Metadata)" [ref=e533] [cursor=pointer]
          - button "2b. Denied Access (User Not in Group)" [ref=e534] [cursor=pointer]
          - button "3. Token Exchange (RFC 8693 — Full Exchange)" [ref=e535] [cursor=pointer]
          - button "4. HITL Consent Gate (Enabled, Amount > Threshold)" [ref=e536] [cursor=pointer]
          - button "5. HITL Disabled (Feature Flag Off)" [ref=e537] [cursor=pointer]
          - button "6. HITL Threshold Variation (Dynamic Configuration)" [ref=e538] [cursor=pointer]
          - button "7. HITL Transfer Gate (Always Required)" [ref=e539] [cursor=pointer]
          - button "8. HITL + Step-Up MFA (Two Gates)" [ref=e540] [cursor=pointer]
          - button "9. HITL Consent Declined (User Denies Operation)" [ref=e541] [cursor=pointer]
          - button "10. Step-Up MFA (RFC 9470 Separate from HITL)" [ref=e542] [cursor=pointer]
          - button "11. Prompt Injection — Guard Active" [ref=e543] [cursor=pointer]
          - button "12. Sensitive Data Exfiltration — Consent Gate" [ref=e544] [cursor=pointer]
          - button "13. Token Exfiltration — BFF Custody Model" [ref=e545] [cursor=pointer]
          - button "14. DoS via Oversized Input — Length Guard" [ref=e546] [cursor=pointer]
          - button "15. LLM Output Manipulation — nlIntentSanitize" [ref=e547] [cursor=pointer]
          - button "16. Guard Disabled — All 4 Defense Layers" [ref=e548] [cursor=pointer]
          - button "17. Intent Token Binding — Prompt Cryptographically Bound" [ref=e549] [cursor=pointer]
          - button "18. Intent Token Bypass — Live Demo" [ref=e550] [cursor=pointer]
          - button "Full Compliance (All 12 Steps)" [ref=e551] [cursor=pointer]
        - generic [ref=e552]:
          - generic [ref=e553]:
            - heading "1. Read-Only Scope (Simple Path)" [level=2] [ref=e554]
            - paragraph [ref=e555]: "Basic read operation: list your accounts. Exercises only token init and caching."
            - generic [ref=e556]:
              - generic [ref=e557]: "Exercises steps:"
              - generic [ref=e558]:
                - generic [ref=e559]: 1. LLM Intent Reasoning
                - generic [ref=e560]: 2. Token Initialization
                - generic [ref=e561]: 3. Gateway Scope Mapping
                - generic [ref=e562]: 4. Scope-Aware Caching
                - generic [ref=e563]: 12. Claim Diagnostics
          - 'button "▶ Click test chip: \" My Accounts\" (Banking group)" [ref=e566] [cursor=pointer]':
            - generic [ref=e567]: ▶
            - generic [ref=e568]: "Click test chip:"
            - code [ref=e569]: "\" My Accounts\" (Banking group)"
          - generic [ref=e570]:
            - generic [ref=e571]:
              - strong [ref=e572]: "Pro Tips:"
              - list [ref=e573]:
                - listitem [ref=e574]: Open Token Chain panel (right sidebar) to watch token events live
                - listitem [ref=e575]: Compliance panel (below messages) shows which steps are active
                - listitem [ref=e576]: Follow scenarios top-to-bottom to understand the story
                - listitem [ref=e577]:
                  - text: "Reference:"
                  - link "/architecture/flow" [ref=e578] [cursor=pointer]:
                    - /url: /architecture/flow
                  - text: shows live compliance diagram
                - listitem [ref=e579]: Each step lights up as it executes in real-time
                - listitem [ref=e580]: "Thresholds: HITL $250, MFA $500 (configurable via Controls)"
                - listitem [ref=e581]: "Feature Flags: HITL, step-up, authorize, and token exchange are all independently toggleable"
                - listitem [ref=e582]: "Scenarios 4–9: HITL consent gates; 10: MFA step-up; 11–16: AI attacks (injection, exfil, DoS, output sanitization, token custody, defence layers)"
            - generic [ref=e583]:
              - button "Previous scenario" [disabled] [ref=e584]: Previous
              - generic [ref=e585]: 1 / 20
              - button "Next scenario" [ref=e586] [cursor=pointer]: Next
              - button "Close guide" [ref=e587] [cursor=pointer]: Close
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