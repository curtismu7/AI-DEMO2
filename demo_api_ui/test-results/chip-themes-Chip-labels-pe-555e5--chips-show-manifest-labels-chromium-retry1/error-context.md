# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chip-themes.spec.js >> Chip labels per vertical theme >> Vertical: healthcare >> [healthcare] Quick Action chips show manifest labels
- Location: tests/e2e/chip-themes.spec.js:209:7

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
      - generic [ref=e260]:
        - complementary "Token chain" [ref=e261]:
          - generic [ref=e262]:
            - generic [ref=e263]:
              - generic [ref=e264] [cursor=pointer]:
                - generic [ref=e265]: Token Exchange Mode
                - generic [ref=e266]:
                  - generic [ref=e267]: RFC 8693 Delegation
                  - generic [ref=e268]: ▼
              - paragraph [ref=e269]:
                - strong [ref=e270]: "Chained delegation:"
                - text: User Token → Agent Token → Delegated Access Token (nested
                - code [ref=e271]: act
                - text: claim)
              - generic [ref=e272]:
                - generic [ref=e273]:
                  - generic [ref=e274]: Token Type
                  - generic [ref=e275]: Full Name
                  - generic [ref=e276]: Issued By
                  - generic [ref=e277]: RFC 8693 Role
                - generic [ref=e278]:
                  - strong [ref=e280]: User Token
                  - generic [ref=e281]: User access token
                  - generic [ref=e282]: PingOne OIDC login
                  - generic [ref=e283]:
                    - code [ref=e284]: subject_token
                    - text: "(Exchange #1)"
                - generic [ref=e285]:
                  - strong [ref=e287]: Agent Token
                  - generic [ref=e288]: Agent access token
                  - generic [ref=e289]: Client credentials grant
                  - generic [ref=e290]:
                    - code [ref=e291]: actor_token
                    - text: "(Exchange #1 & #2)"
                - generic [ref=e292]:
                  - strong [ref=e294]: MCP Token
                  - generic [ref=e295]: Delegated access token
                  - generic [ref=e296]: RFC 8693 exchange
                  - generic [ref=e297]:
                    - text: Result with nested
                    - code [ref=e298]: act
                    - text: claim (to MCP Server)
              - paragraph [ref=e299]:
                - text: ℹ️
                - strong [ref=e300]: "Security guarantee:"
                - text: User Token and Agent Token are secrets — stored only on the Backend-for-Frontend (BFF). Only the Delegated Access Token (limited scope + nested delegation proof) reaches the MCP Server.
            - generic [ref=e301]:
              - generic [ref=e302]:
                - generic [ref=e303]:
                  - generic [ref=e304]: Token Chain
                  - button "View all RFC standards" [ref=e305] [cursor=pointer]: Standards
                  - button "Copy token chain to clipboard" [ref=e306] [cursor=pointer]: Copy JSON
                - paragraph [ref=e307]: 2-Token Exchange Flow — User access token stays in BFF → RFC 8693 exchange → MCP access token → MCP server → Banking API
              - generic [ref=e308]:
                - button "Current call" [ref=e309] [cursor=pointer]
                - button "MCP Results" [ref=e310] [cursor=pointer]
                - button "History" [ref=e311] [cursor=pointer]
                - button "Trust" [ref=e312] [cursor=pointer]
              - generic [ref=e313]:
                - generic [ref=e314]: "Token Types:"
                - generic [ref=e317]: Subject Token (RFC 8693 §2.1)
                - generic [ref=e320]: Actor Token (RFC 8693 §2.2)
                - generic [ref=e323]: MCP-Scoped Access Token (RFC 8693 §3.2)
              - generic [ref=e325]:
                - generic [ref=e326]: Step explainers
                - switch "Show the What / Why / Value popout for each step (off by default)" [ref=e327] [cursor=pointer]
              - generic [ref=e328]:
                - generic [ref=e329]: Sign in and load the dashboard to see your user access token, or make a banking / AI Agent request to see the full chain after exchange.
                - generic "Ping products in this chain" [ref=e330]:
                  - generic "PingOne" [ref=e332]:
                    - img [ref=e333]
                    - text: PingOne
                  - generic "PingGateway" [ref=e336]:
                    - img [ref=e337]
                    - text: PingGateway
                  - generic "PingOne Authorize" [ref=e340]:
                    - img [ref=e341]
                    - text: PingOne Authorize
                - generic [ref=e343]:
                  - generic [ref=e344]: OAUTH BEARER PATH
                  - generic [ref=e346]:
                    - generic [ref=e347]:
                      - generic "Subject Token (RFC 8693 §2.1)" [ref=e348]
                      - generic [ref=e349]: Subject Token — user access token (RFC 8693 §2.1)
                      - generic "PingOne" [ref=e350]:
                        - img [ref=e351]
                        - text: PingOne
                      - generic [ref=e353]: Step 1 of 6
                    - generic [ref=e354]:
                      - generic [ref=e355]:
                        - link "RFC 7519" [ref=e356] [cursor=pointer]:
                          - /url: https://www.rfc-editor.org/rfc/rfc7519
                        - text: ·
                        - link "RFC 9068" [ref=e357] [cursor=pointer]:
                          - /url: https://www.rfc-editor.org/rfc/rfc9068
                      - generic [ref=e358]: Waiting
                    - button "Inspect Subject Token — user access token (RFC 8693 §2.1)" [ref=e360] [cursor=pointer]:
                      - img [ref=e361]
                      - text: Token Details
                  - generic [ref=e366]:
                    - generic [ref=e368]: ↓
                    - generic [ref=e369]:
                      - link "RFC 8693" [ref=e370] [cursor=pointer]:
                        - /url: https://www.rfc-editor.org/rfc/rfc8693
                      - text: ·
                      - generic [ref=e371]: 2-Token Exchange
                - generic [ref=e372]:
                  - generic [ref=e373]: OAUTH BEARER PATH
                  - generic [ref=e375]:
                    - generic [ref=e376]:
                      - generic "Subject Token (RFC 8693 §2.1)" [ref=e377]
                      - generic [ref=e378]: "Token Exchange (RFC 8693 §3.1): subject_token → MCP-scoped access token"
                      - generic "PingOne" [ref=e379]:
                        - img [ref=e380]
                        - text: PingOne
                      - generic [ref=e382]: Step 2 of 6
                    - generic [ref=e383]:
                      - generic [ref=e384]:
                        - link "RFC 8693" [ref=e385] [cursor=pointer]:
                          - /url: https://www.rfc-editor.org/rfc/rfc8693
                        - text: ·
                        - link "RFC 8707" [ref=e386] [cursor=pointer]:
                          - /url: https://www.rfc-editor.org/rfc/rfc8707
                      - generic [ref=e387]: Waiting
                    - 'button "Inspect Token Exchange (RFC 8693 §3.1): subject_token → MCP-scoped access token" [ref=e389] [cursor=pointer]':
                      - img [ref=e390]
                      - text: Token Details
                  - generic [ref=e395]:
                    - generic [ref=e397]: ↓
                    - generic [ref=e398]:
                      - link "RFC 8693" [ref=e399] [cursor=pointer]:
                        - /url: https://www.rfc-editor.org/rfc/rfc8693
                      - text: ·
                      - generic [ref=e400]: 2-Token Exchange
                - generic [ref=e401]:
                  - generic [ref=e402]: OAUTH BEARER PATH
                  - generic [ref=e404]:
                    - generic [ref=e405]:
                      - generic "MCP-Scoped Access Token (RFC 8693 §3.2)" [ref=e406]
                      - generic [ref=e407]: Delegated Token (aud=mcp-gw) — BFF → Ping Agent Gateway
                      - generic "PingOne" [ref=e408]:
                        - img [ref=e409]
                        - text: PingOne
                      - generic [ref=e411]: Step 3 of 6
                    - generic [ref=e412]:
                      - link "RFC 8693" [ref=e414] [cursor=pointer]:
                        - /url: https://www.rfc-editor.org/rfc/rfc8693
                      - generic [ref=e415]: Waiting
                    - button "Inspect Delegated Token (aud=mcp-gw) — BFF → Ping Agent Gateway" [ref=e417] [cursor=pointer]:
                      - img [ref=e418]
                      - text: Token Details
                  - generic [ref=e423]:
                    - generic [ref=e425]: ↓
                    - generic [ref=e426]:
                      - link "RFC 8693" [ref=e427] [cursor=pointer]:
                        - /url: https://www.rfc-editor.org/rfc/rfc8693
                      - text: ·
                      - generic [ref=e428]: 2-Token Exchange
                - generic [ref=e429]:
                  - generic [ref=e430]: OAUTH BEARER PATH
                  - generic [ref=e432]:
                    - generic [ref=e433]:
                      - generic "MCP-Scoped Access Token (RFC 8693 §3.2)" [ref=e434]
                      - generic [ref=e435]: Ping Agent Gateway — RFC 7662 Token Introspection
                      - generic "PingGateway" [ref=e436]:
                        - img [ref=e437]
                        - text: PingGateway
                      - generic [ref=e439]: Step 4 of 6
                    - generic [ref=e440]:
                      - link "RFC 7662" [ref=e442] [cursor=pointer]:
                        - /url: https://www.rfc-editor.org/rfc/rfc7662
                      - generic [ref=e443]: Waiting
                    - button "Inspect Ping Agent Gateway — RFC 7662 Token Introspection" [ref=e445] [cursor=pointer]:
                      - img [ref=e446]
                      - text: Token Details
                  - generic [ref=e451]:
                    - generic [ref=e453]: ↓
                    - generic [ref=e454]:
                      - link "RFC 8693" [ref=e455] [cursor=pointer]:
                        - /url: https://www.rfc-editor.org/rfc/rfc8693
                      - text: ·
                      - generic [ref=e456]: 2-Token Exchange
                - generic [ref=e457]:
                  - generic [ref=e458]: OAUTH BEARER PATH
                  - generic [ref=e460]:
                    - generic [ref=e461]:
                      - generic "MCP-Scoped Access Token (RFC 8693 §3.2)" [ref=e462]
                      - generic [ref=e463]: Ping Agent Gateway — PingOne Authorization Server policy decision
                      - generic "PingOne Authorize" [ref=e464]:
                        - img [ref=e465]
                        - text: PingOne Authorize
                      - generic [ref=e467]: Step 5 of 6
                    - generic [ref=e468]:
                      - generic [ref=e469]: PingOne Authorize
                      - generic [ref=e470]: Waiting
                    - button "Inspect Ping Agent Gateway — PingOne Authorization Server policy decision" [ref=e472] [cursor=pointer]:
                      - img [ref=e473]
                      - text: Token Details
                  - generic [ref=e478]:
                    - generic [ref=e480]: ↓
                    - generic [ref=e481]:
                      - link "RFC 8693" [ref=e482] [cursor=pointer]:
                        - /url: https://www.rfc-editor.org/rfc/rfc8693
                      - text: ·
                      - generic [ref=e483]: 2-Token Exchange
                - generic [ref=e484]:
                  - generic [ref=e485]: OAUTH BEARER PATH
                  - generic [ref=e487]:
                    - generic [ref=e488]:
                      - generic "MCP-Scoped Access Token (RFC 8693 §3.2)" [ref=e489]
                      - generic [ref=e490]: Token forwarded unchanged → MCP Server executes tool
                      - generic "PingGateway" [ref=e491]:
                        - img [ref=e492]
                        - text: PingGateway
                      - generic [ref=e494]: Step 6 of 6
                    - generic [ref=e495]:
                      - generic [ref=e496]: RFC 6750
                      - generic [ref=e497]: Waiting
                    - button "Inspect Token forwarded unchanged → MCP Server executes tool" [ref=e499] [cursor=pointer]:
                      - img [ref=e500]
                      - text: Token Details
              - generic [ref=e505]:
                - generic [ref=e506]:
                  - generic [ref=e507]: TLS
                  - generic [ref=e508]: Transport Security — Certificate-protected hops
                  - button "Expand TLS details" [ref=e509] [cursor=pointer]: ▸
                - paragraph [ref=e510]: Every hop that carries a token is TLS-encrypted. The BFF is the sole token custodian — no token is ever sent over plaintext or exposed to the browser.
        - region "AI banking assistant" [ref=e511]:
          - dialog "AI Demo AI Agent" [ref=e515]:
            - button "AI Demo Assistant Customer · Test user-123 Agent mode llama.cpp only Wiring via BFF (token chain intact) RFC info Compliance Token Chain Guide Actions ▾ Sign out" [ref=e516]:
              - generic [ref=e517]:
                - generic [ref=e520]:
                  - generic [ref=e521]: AI Demo Assistant
                  - generic [ref=e522]: Customer · Test
                - generic "PingOne user id" [ref=e524]: user-123
                - generic [ref=e525]:
                  - generic [ref=e526]:
                    - generic [ref=e527]:
                      - text: Agent mode
                      - combobox "Agent mode" [ref=e528] [cursor=pointer]:
                        - option "Heuristics only"
                        - option "llama.cpp only" [selected]
                        - option "Anthropic only — not configured" [disabled]
                        - option "Helix only"
                    - generic [ref=e529]:
                      - text: Wiring
                      - combobox "External wiring" [ref=e530] [cursor=pointer]:
                        - option "via BFF (token chain intact)" [selected]
                        - option "platform-driven (token chain lost)"
                  - generic [ref=e531] [cursor=pointer]:
                    - checkbox "RFC info"
                    - generic [ref=e533]: RFC info
                  - generic [ref=e534] [cursor=pointer]:
                    - checkbox "Compliance"
                    - generic [ref=e536]: Compliance
                  - generic [ref=e537] [cursor=pointer]:
                    - checkbox "Token Chain"
                    - generic [ref=e539]: Token Chain
                  - button "Guide" [active] [ref=e540] [cursor=pointer]
                  - button "Actions ▾" [ref=e541] [cursor=pointer]
                  - button "Sign out" [ref=e542] [cursor=pointer]
            - generic [ref=e544]:
              - generic "Simple Stepper" [ref=e545]:
                - generic [ref=e546]: Simple Stepper
                - button "Show" [ref=e547] [cursor=pointer]
              - paragraph [ref=e553]: Hi Test! I'm your AI assistant. I can help with your accounts, explain the OAuth flows behind the scenes, and more. What would you like to do?
              - generic [ref=e555]:
                - textbox "Ask about your accounts…" [ref=e556]
                - button "Send" [disabled] [ref=e557]
              - button "Start Over" [ref=e559] [cursor=pointer]
              - generic [ref=e560]:
                - generic [ref=e561]: ⬆ 0 in
                - generic [ref=e562]: ⬇ 0 out
                - generic [ref=e563]: ∑ 0
          - button "Drag to resize assistant height" [ref=e564] [cursor=pointer]:
            - generic [ref=e567]: Resize height
    - dialog [ref=e568]:
      - generic [ref=e570]:
        - generic [ref=e571]:
          - heading [level=2] [ref=e572]:
            - text: Backchannel Authentication
            - generic [ref=e573]: Disabled
          - paragraph [ref=e574]:
            - text: OIDC CIBA plus OAuth tokens, Backend-for-Frontend (BFF) session, MCP, and RFC 8693 token exchange — open
            - strong [ref=e575]: Full stack
            - text: for the map and
            - strong [ref=e576]: Token exchange
            - text: for before/after
            - code [ref=e577]: /token
            - text: ", statuses, and responses."
        - button [ref=e578] [cursor=pointer]: ✕
      - generic [ref=e579]:
        - button [ref=e580] [cursor=pointer]: What is CIBA
        - button [ref=e581] [cursor=pointer]: Sign-in & roles
        - button [ref=e582] [cursor=pointer]: Full stack
        - button [ref=e583] [cursor=pointer]: Token exchange
        - button [ref=e584] [cursor=pointer]: vs Login Flow
        - button [ref=e585] [cursor=pointer]: ▶ Try It
        - button [ref=e586] [cursor=pointer]: App Flows
        - button [ref=e587] [cursor=pointer]: PingOne Setup
        - button [ref=e588] [cursor=pointer]: BFF code
      - generic [ref=e590]:
        - paragraph [ref=e591]:
          - text: CIBA (Client-Initiated Backchannel Authentication, OpenID CIBA Core 1.0) decouples the
          - strong [ref=e592]: consumption device
          - text: (where the app runs) from where the user
          - strong [ref=e593]: approves
          - text: — often another device or their email inbox. No browser redirect, no popup. PingOne delivers the approval step by
          - strong [ref=e594]: email
          - text: or
          - strong [ref=e595]: push
          - text: depending on your DaVinci configuration.
        - heading [level=3] [ref=e596]: The flow (6 steps)
        - generic [ref=e597]: "1. App (server) ──POST /bc-authorize──▶ PingOne { login_hint: \"user@bank.com\", scope: \"openid write\", binding_message: \"Approve $500 transfer\" } 2. PingOne ◀─────────────────────────── auth_req_id returned 3. PingOne ──out-of-band approval────▶ User (channel is your PingOne / DaVinci setup) • Email: approval link in inbox — OR — • Push: notification on registered device 4. User approves (link in email or tap Approve on device) 5. App polls POST /token (grant=ciba, auth_req_id=...) → authorization_pending (repeat every 5s) → tokens returned ✓ 6. Tokens stored server-side (never sent to browser) Tool call / transaction executes with user context"
        - heading [level=3] [ref=e598]: "Real HTTP: bc-authorize request & response"
        - generic [ref=e599]: "POST {issuer}/as/bc-authorize Content-Type: application/x-www-form-urlencoded Authorization: Basic <base64(client_id:client_secret)> scope=openid%20banking%3Awrite &login_hint=user%40bank.com &binding_message=Approve%20%24500%20transfer &acr_values=Multi_factor (optional step-up) &client_notification_token=... (required for ping/push delivery mode) HTTP/1.1 200 OK { \"auth_req_id\": \"abc123xyz...\", \"expires_in\": 300, \"interval\": 5 }"
        - heading [level=3] [ref=e600]: "Real HTTP: polling for tokens"
        - generic [ref=e601]: "POST {issuer}/as/token Content-Type: application/x-www-form-urlencoded grant_type=urn:openid:params:grant-type:ciba &auth_req_id=abc123xyz... &client_id=... &client_secret=... ── If user has not yet approved ── HTTP/1.1 400 Bad Request { \"error\": \"authorization_pending\" } ── If poll is too fast ── HTTP/1.1 400 Bad Request { \"error\": \"slow_down\" } → increase interval by 5s ── On approval ── HTTP/1.1 200 OK { \"access_token\": \"...\", \"token_type\": \"Bearer\", \"id_token\": \"...\", \"refresh_token\": \"...\", \"expires_in\": 3600 } ── On denial / timeout ── HTTP/1.1 400 Bad Request { \"error\": \"access_denied\" | \"expired_token\" }"
        - heading [level=3] [ref=e602]: Key concepts
        - list [ref=e603]:
          - listitem [ref=e604]:
            - strong [ref=e605]: auth_req_id
            - text: — a short-lived opaque ID returned by PingOne when
            - code [ref=e606]: POST /bc-authorize
            - text: succeeds. The server uses it to poll
            - code [ref=e607]: POST /token
            - text: until the user approves or the request expires.
          - listitem [ref=e608]:
            - strong [ref=e609]: binding_message
            - text: — the text shown in the approval email or push notification, e.g.
            - emphasis [ref=e610]: "\"Approve $500 transfer to Savings\""
            - text: . Helps the user confirm exactly what they are authorising.
          - listitem [ref=e611]:
            - strong [ref=e612]: login_hint
            - text: — the user's email address. PingOne resolves this to the target account and sends the approval to the right inbox or device.
          - listitem [ref=e613]:
            - strong [ref=e614]: Poll vs Ping delivery mode
            - text: —
            - emphasis [ref=e615]: Poll
            - text: ": server calls"
            - code [ref=e616]: POST /token
            - text: every 5 s (or
            - code [ref=e617]: interval
            - text: seconds).
            - emphasis [ref=e618]: Ping
            - text: ": PingOne calls a"
            - code [ref=e619]: client_notification_endpoint
            - text: when the user approves (requires a publicly reachable callback URL). This demo uses Poll mode.
          - listitem [ref=e620]:
            - strong [ref=e621]: Backend-for-Frontend (BFF) pattern — tokens never reach the browser
            - text: — tokens are stored in the server-side session. The browser only receives approval status updates via the Backend-for-Frontend (BFF) poll API. XSS cannot steal them.
          - listitem [ref=e622]:
            - strong [ref=e623]: Email vs push
            - text: — controlled by your PingOne / DaVinci flow, not by this app. Email-only CIBA requires no push-capable MFA device.
        - heading [level=3] [ref=e624]: When to use CIBA (vs Authorization Code)
        - list [ref=e625]:
          - listitem [ref=e626]: LLM / agent contexts where a browser redirect would break the flow.
          - listitem [ref=e627]: Step-up authentication mid-session (high-value transaction) without a page reload.
          - listitem [ref=e628]: IoT / headless devices that cannot host a redirect URI.
          - listitem [ref=e629]: Delegated approval — approve on phone while viewing dashboard on desktop.
    - dialog [ref=e630]:
      - generic [ref=e632]:
        - generic [ref=e633]:
          - heading [level=2] [ref=e634]: 📄 Client ID Metadata Document
          - paragraph [ref=e635]: draft-ietf-oauth-client-id-metadata-document — the client_id is a URL
        - button [ref=e636] [cursor=pointer]: ✕
      - tablist [ref=e637]:
        - tab [selected] [ref=e638] [cursor=pointer]: What is CIMD
        - tab [ref=e639] [cursor=pointer]: CIMD vs DCR
        - tab [ref=e640] [cursor=pointer]: Doc format
        - tab [ref=e641] [cursor=pointer]: How AS uses it
        - tab [ref=e642] [cursor=pointer]: Flow diagram
        - tab [ref=e643] [cursor=pointer]: ▶ Simulate
        - tab [ref=e644] [cursor=pointer]: PingOne
      - tabpanel [ref=e645]:
        - paragraph [ref=e646]:
          - strong [ref=e647]: OAuth Client ID Metadata Document (CIMD)
          - text: is an IETF draft (
          - link [ref=e648] [cursor=pointer]:
            - /url: https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/
            - text: draft-ietf-oauth-client-id-metadata-document
          - text: ) that redefines what a
          - code [ref=e649]: client_id
          - text: is. Instead of an opaque string like
          - code [ref=e650]: abc123
          - text: ", the"
          - code [ref=e651]: client_id
          - text: becomes a
          - strong [ref=e652]: URL
          - text: . When the authorization server receives that URL, it fetches the document at that URL to discover the client's metadata (redirect URIs, grant types, scopes, etc.).
        - generic [ref=e653]:
          - strong [ref=e654]: "Core idea:"
          - text: The
          - code [ref=e655]: client_id
          - text: IS the metadata document URL. The client controls the URL, so the client controls its own registration data.
        - list [ref=e656]:
          - listitem [ref=e657]:
            - code [ref=e658]: client_id
            - text: is a URL, e.g.
            - code [ref=e659]: https://app.example.com/.well-known/oauth-client/my-app
          - listitem [ref=e660]:
            - text: The AS fetches that URL and reads the metadata (
            - code [ref=e661]: redirect_uris
            - text: ","
            - code [ref=e662]: grant_types
            - text: ", etc.)"
          - listitem [ref=e663]: The client self-describes by controlling the hosted document
          - listitem [ref=e664]: Eliminates out-of-band registration in AS implementations that support the draft
          - listitem [ref=e665]: "Updates are instant: just update the hosted JSON file"
        - heading [level=3] [ref=e666]: What this demo does
        - paragraph [ref=e667]: "This demo bridges the gap between the draft and PingOne. You fill in a CIMD-style form, the backend creates the OAuth application in PingOne via the Management API, then hosts the CIMD document at:"
        - code [ref=e669]: "GET /.well-known/oauth-client/{pingone-app-id}"
        - paragraph [ref=e670]:
          - text: Use the
          - strong [ref=e671]: ▶ Simulate
          - text: tab to watch the full AS-fetches-CIMD flow animated step by step.
        - heading [level=3] [ref=e672]: Key references
        - list [ref=e673]:
          - listitem [ref=e674]:
            - link [ref=e675] [cursor=pointer]:
              - /url: https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/
              - text: draft-ietf-oauth-client-id-metadata-document (IETF)
          - listitem [ref=e676]:
            - link [ref=e677] [cursor=pointer]:
              - /url: https://www.rfc-editor.org/rfc/rfc7591
              - text: RFC 7591 — OAuth 2.0 Dynamic Client Registration
            - text: (compare & contrast)
    - contentinfo [ref=e678]:
      - generic [ref=e679]:
        - generic [ref=e680]: AI Demo Demo
        - generic [ref=e681]: © 2026 All rights reserved.
  - dialog [ref=e682]:
    - generic [ref=e691]:
      - generic [ref=e692]: Agent Demo Guide
      - generic [ref=e693]:
        - button "↗" [ref=e694] [cursor=pointer]
        - button "Close" [ref=e695] [cursor=pointer]: ✕
    - generic [ref=e696]:
      - generic [ref=e697]:
        - paragraph [ref=e698]: Real request scenarios mapped to 13 compliance steps. See /architecture/flow for live diagram.
        - generic [ref=e699]:
          - generic [ref=e700]:
            - button "Compliance" [ref=e701] [cursor=pointer]
            - button "Presenter" [ref=e702] [cursor=pointer]
          - button "Reset demo flags" [ref=e703] [cursor=pointer]
      - generic [ref=e704]:
        - generic [ref=e705]:
          - generic [ref=e706]: Scenarios
          - button "1. Read-Only Scope (Simple Path)" [ref=e707] [cursor=pointer]
          - button "2. Scope Denial (403 + Denial Metadata)" [ref=e708] [cursor=pointer]
          - button "2b. Denied Access (User Not in Group)" [ref=e709] [cursor=pointer]
          - button "3. Token Exchange (RFC 8693 — Full Exchange)" [ref=e710] [cursor=pointer]
          - button "4. HITL Consent Gate (Enabled, Amount > Threshold)" [ref=e711] [cursor=pointer]
          - button "5. HITL Disabled (Feature Flag Off)" [ref=e712] [cursor=pointer]
          - button "6. HITL Threshold Variation (Dynamic Configuration)" [ref=e713] [cursor=pointer]
          - button "7. HITL Transfer Gate (Always Required)" [ref=e714] [cursor=pointer]
          - button "8. HITL + Step-Up MFA (Two Gates)" [ref=e715] [cursor=pointer]
          - button "9. HITL Consent Declined (User Denies Operation)" [ref=e716] [cursor=pointer]
          - button "10. Step-Up MFA (RFC 9470 Separate from HITL)" [ref=e717] [cursor=pointer]
          - button "11. Prompt Injection — Guard Active" [ref=e718] [cursor=pointer]
          - button "12. Sensitive Data Exfiltration — Consent Gate" [ref=e719] [cursor=pointer]
          - button "13. Token Exfiltration — BFF Custody Model" [ref=e720] [cursor=pointer]
          - button "14. DoS via Oversized Input — Length Guard" [ref=e721] [cursor=pointer]
          - button "15. LLM Output Manipulation — nlIntentSanitize" [ref=e722] [cursor=pointer]
          - button "16. Guard Disabled — All 4 Defense Layers" [ref=e723] [cursor=pointer]
          - button "17. Intent Token Binding — Prompt Cryptographically Bound" [ref=e724] [cursor=pointer]
          - button "18. Intent Token Bypass — Live Demo" [ref=e725] [cursor=pointer]
          - button "Full Compliance (All 12 Steps)" [ref=e726] [cursor=pointer]
        - generic [ref=e727]:
          - generic [ref=e728]:
            - heading "1. Read-Only Scope (Simple Path)" [level=2] [ref=e729]
            - paragraph [ref=e730]: "Basic read operation: list your accounts. Exercises only token init and caching."
            - generic [ref=e731]:
              - generic [ref=e732]: "Exercises steps:"
              - generic [ref=e733]:
                - generic [ref=e734]: 1. LLM Intent Reasoning
                - generic [ref=e735]: 2. Token Initialization
                - generic [ref=e736]: 3. Gateway Scope Mapping
                - generic [ref=e737]: 4. Scope-Aware Caching
                - generic [ref=e738]: 12. Claim Diagnostics
          - 'button "▶ Click test chip: \" My Accounts\" (Banking group)" [ref=e741] [cursor=pointer]':
            - generic [ref=e742]: ▶
            - generic [ref=e743]: "Click test chip:"
            - code [ref=e744]: "\" My Accounts\" (Banking group)"
          - generic [ref=e745]:
            - generic [ref=e746]:
              - strong [ref=e747]: "Pro Tips:"
              - list [ref=e748]:
                - listitem [ref=e749]: Toggle "Token Chain" in the agent header to open the floating panel — it doesn't block the agent, so you can keep chatting while token events stream in
                - listitem [ref=e750]: Toggle "Compliance" in the agent header to see which steps are active (enable "Side panel" for the slide-out view)
                - listitem [ref=e751]: The Simple Stepper bar above the messages is a compact per-step audit trail — click "Show" to pop it out as a draggable table
                - listitem [ref=e752]: Follow scenarios top-to-bottom to understand the story
                - listitem [ref=e753]:
                  - text: "Reference:"
                  - link "/architecture/flow" [ref=e754] [cursor=pointer]:
                    - /url: /architecture/flow
                  - text: shows live compliance diagram
                - listitem [ref=e755]: Each step lights up as it executes in real-time
                - listitem [ref=e756]: "Thresholds: HITL $250, MFA $500 (configurable via Controls)"
                - listitem [ref=e757]: "Feature Flags: HITL, step-up, authorize, and token exchange are all independently toggleable"
                - listitem [ref=e758]: "Scenarios 4–9: HITL consent gates; 10: MFA step-up; 11–16: AI attacks (injection, exfil, DoS, output sanitization, token custody, defence layers); 17–18: Intent Token binding & bypass"
            - generic [ref=e759]:
              - button "Previous scenario" [disabled] [ref=e760]: Previous
              - generic [ref=e761]: 1 / 20
              - button "Next scenario" [ref=e762] [cursor=pointer]: Next
              - button "Close guide" [ref=e763] [cursor=pointer]: Close
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