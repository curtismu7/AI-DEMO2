# Banking App — Architecture diagrams (Mermaid)

Source of truth for the diagrams below. Open in **diagrams.net (draw.io)** with your Mermaid extension and paste **one** fenced block at a time.

**Reference Visio:** `Agent Gateway demo architecture.vsdx` (repo root) — swimlanes, security/RFC strips, MCP ingress & egress gateway behavior, Baseline vs Gateway, 401 → OAuth → Bearer retry, and phased OAuth with **resource** (RFC 8707). The diagram below mirrors that **pattern** and labels; ports and hosts match this banking repo.

**Terminology — Backend-for-Frontend (BFF):** **Backend-for-Frontend (BFF)** means **Backend for Frontend**: a backend owned by the same app as the SPA, which holds **httpOnly session cookies**, stores **OAuth tokens on the server** (never in browser JavaScript), and proxies or orchestrates calls to the authorization server and APIs. In this repo the Backend-for-Frontend (BFF) is **`banking_api_server`** (Express — local port **3001**, production **same origin** as the UI with `/api` routes on Vercel).

---

## Diagram 0: Agent Gateway pattern (aligned with Agent Gateway demo architecture.vsdx)

Same information class as the Visio: actors, RFC callouts, ingress/egress, RS as audience-bound resource.

```mermaid
flowchart TB
  subgraph WEB["Web Browser SPA"]
    SPA["React SPA\nHTTPS + session cookie"]
  end

  subgraph AGENT["Agent — security: OAuth 2.1 · RFC 8707 · RFC 9728 · RFC 7523 · RFC 8693"]
    LLM["LLM"]
    MEM["memory"]
    BL["business logic"]
  end

  subgraph AS["IDP / AS — PingOne"]
    AUTHZ["/authorize · /token\nresource RFC 8707"]
    INTRO["/introspect RFC 7662 · JWKS"]
  end

  subgraph INGRESS["MCP ingress — Backend-for-Frontend (BFF) gateway behavior"]
    I1["Introspection + scope enforcement\non behalf of downstream tools"]
    I2["MCP authorization RFC 9728\nMCP spec requires RFC 8707"]
  end

  subgraph EGRESS["MCP egress"]
    E1["RFC 9728 + RFC 8707 with MCP peer"]
    E2["Token exchange RFC 8693\nbinding RFC 7523 or DPoP 9449"]
  end

  subgraph MCP["MCP Server"]
    TLIST["tools/list · tools/call"]
    TH["Tool handler"]
  end

  subgraph RS["Resource Server — Banking API"]
    API["RS validates aud + scopes"]
  end

  OAUTH["OAuth flows\nPKCE · CIBA · RFC 8693"]

  SPA --> AGENT
  AGENT --> INGRESS
  INGRESS --> AS
  AS --> INGRESS
  INGRESS --> EGRESS
  EGRESS --> MCP
  TH -->|"Bearer AT"| API
  API -.->|"401 Unauthorized"| OAUTH
  OAUTH -.->|"attempt again with Bearer"| TH
```

### Phased OAuth with resource indicator (RFC 8707) — same steps as reference slide

| Phase | Step | Action |
|-------|------|--------|
| 1 | 1–4 | Authorization request with `resource=<RS URL>` → consent → authorization **code** |
| 2 | 5–6 | Token request `grant_type=authorization_code` + `resource` → AS limits **audience** to RS |
| 3 | 7–8 | Resource request `Authorization: Bearer` → RS validates audience |

---

## Diagram 1: Component Architecture

```mermaid
flowchart TB
    subgraph BROWSER["Browser (User Device)"]
        UI["React UI\nPort 3000"]
        CHAT["Chat Interface\n(AI)"]
    end

    subgraph Backend-for-Frontend (BFF)["Banking Backend-for-Frontend (BFF) — Port 3001 (Vercel: same domain)"]
        OAUTH["OAuth Routes\n/api/auth/oauth/*\n/api/auth/ciba/*"]
        SESSION["Session Store\n{ accessToken T1\n  refreshToken\n  idToken }"]
        MCPPROXY["MCP Proxy\nPOST /api/mcp/tool\n→ Token Exchange RFC 8693\n→ WS to MCP Server"]
        MCPINSP["MCP Inspector (demo)\nGET /api/mcp/inspector/context|tools\nPOST …/invoke\nauthenticateToken + same WS client"]
        BANKAPI["Banking API\n/api/accounts\n/api/transactions"]
        AUTH["auth.js middleware\nauthenticateToken()\nrequireScopes()"]
    end

    subgraph MCPSRV["MCP Server — Port 8080 (WebSocket / JSON-RPC)"]
        AUTHMGR["AuthenticationIntegration\ninit: validate token via introspect\ntools/call: check scopes → execute"]
        TOOLS["BankingToolRegistry\nget_my_accounts · get_account_balance\nget_my_transactions\ncreate_transfer · create_deposit\ncreate_withdrawal · query_user_by_email"]
        INTROSPECT["TokenIntrospector\nPingOne introspection RFC 7662\naud validation"]
    end

    subgraph AGENT["LangChain Agent — Python (second MCP Host)"]
        LLM["ChatOpenAI LLM\nstreaming + function calling"]
        MEM["ConversationMemory"]
        MCPCLIENT["MCPToolProvider / MCPClientManager\nWS JSON-RPC + Bearer to MCP"]
        CIBAAUTH["OAuthAuthenticationManager\nCIBA + client credentials"]
        WSEVENTS["WebSocket stream_event\ntool_start · tool_end · llm_token"]
        HOSTJSON["HTTP :8081 /inspector/mcp-host\nregistered tools snapshot"]
    end

    subgraph PINGONE["PingOne"]
        AUTH_EP["/authorize"]
        TOKEN_EP["/token\n• auth_code exchange → issues T1 with may_act\n• token exchange RFC 8693 → validates may_act → issues T2 with act\n• CIBA poll"]
        BCAUTH_EP["/bc-authorize\nCIBA initiation"]
        JWKS_EP["/jwks"]
        INTROSPECT_EP["/introspect\nreturns act claim"]
        USERINFO_EP["/userinfo"]
        SIGNOFF_EP["/signoff"]
        DAVINCI["DaVinci Flow\nCIBA email orchestration"]
    end

    EMAIL["📧 User Email\nApproval link"]

    UI -->|"HTTP + session cookie"| OAUTH
    UI -->|"HTTP + session cookie"| MCPPROXY
    UI -->|"HTTP + session cookie"| MCPINSP
    UI -->|"HTTP + session cookie"| BANKAPI
    CHAT -->|"WebSocket chat"| AGENT

    OAUTH -->|"stores tokens"| SESSION
    SESSION -->|"T1 read"| MCPPROXY
    SESSION -->|"T1 read"| MCPINSP
    MCPPROXY -->|"RFC 8693\nvalidates may_act"| TOKEN_EP
    MCPINSP -->|"optional RFC 8693"| TOKEN_EP
    MCPPROXY -->|"WS + T2 delegated\nwith act claim"| AUTHMGR
    MCPINSP -->|"WS tools/list · tools/call"| AUTHMGR
    BANKAPI --> AUTH
    AUTH -->|"JWKS verify"| JWKS_EP

    AUTHMGR --> INTROSPECT
    AUTHMGR --> TOOLS
    INTROSPECT -->|"POST introspect\nreturns act claim"| INTROSPECT_EP
    TOOLS -->|"HTTP Bearer T2"| BANKAPI

    AGENT --> LLM
    AGENT --> MEM
    LLM -->|"tool call"| MCPCLIENT
    MCPCLIENT -->|"WS JSON-RPC + T3"| AUTHMGR
    AGENT --> CIBAAUTH
    LLM -.->|"callbacks"| WSEVENTS
    AGENT --> HOSTJSON
    CIBAAUTH -->|"POST /bc-authorize"| BCAUTH_EP
    CIBAAUTH -->|"poll POST /token"| TOKEN_EP
    BCAUTH_EP --> DAVINCI
    DAVINCI --> EMAIL

    OAUTH -->|"GET /authorize"| AUTH_EP
    OAUTH -->|"POST /token\n→ T1 + may_act"| TOKEN_EP
    OAUTH -->|"GET /userinfo"| USERINFO_EP
    OAUTH -->|"GET /signoff"| SIGNOFF_EP
```

---

## Diagram 2: Complete Step-by-Step Flow — Login → Token Exchange → Banking Agent Gets Results

```mermaid
sequenceDiagram
    autonumber
    participant U as User / Browser
    participant Backend-for-Frontend (BFF) as Banking Backend-for-Frontend (BFF)
    participant P1 as PingOne
    participant MCP as MCP Server
    participant API as Banking API

    rect rgb(220, 235, 255)
        Note over U,P1: PHASE 1 — Authorization Code Flow (User Login)
        U->>Backend-for-Frontend (BFF): Click Login
        Backend-for-Frontend (BFF)->>Backend-for-Frontend (BFF): Generate state (CSRF protection)\nGenerate PKCE code_verifier (random 64 bytes)\nCompute code_challenge = base64url(sha256(verifier))\nDerive redirect_uri from request host
        Backend-for-Frontend (BFF)-->>U: 302 → PingOne /authorize\n?response_type=code\n&client_id=bff-client\n&redirect_uri=https://domain/callback\n&scope=openid profile email banking:*\n&code_challenge=ABC123\n&code_challenge_method=S256\n&state=CSRF_TOKEN
        U->>P1: GET /authorize (browser follows redirect)
        P1-->>U: Login page
        U->>P1: Enter credentials + submit
        P1->>P1: Authenticate user\nApply sign-on policy\nGenerate authorization_code
        P1-->>U: 302 → /callback?code=AUTH_CODE&state=CSRF_TOKEN
    end

    rect rgb(220, 255, 220)
        Note over U,P1: PHASE 2 — Code Exchange + PingOne Issues Token WITH may_act
        U->>Backend-for-Frontend (BFF): GET /callback?code=AUTH_CODE&state=CSRF_TOKEN
        Backend-for-Frontend (BFF)->>Backend-for-Frontend (BFF): Validate state = CSRF_TOKEN ✅\nRetrieve code_verifier from session
        Backend-for-Frontend (BFF)->>P1: POST /token\ngrant_type=authorization_code\ncode=AUTH_CODE\ncode_verifier=PKCE_VERIFIER\nclient_id=bff-client\nclient_secret=...
        P1->>P1: Verify code_verifier matches challenge ✅\nIssue T1 with may_act claim\n(PingOne policy: bff-client may act for users)
        P1-->>Backend-for-Frontend (BFF): T1 = JWT { sub: user123\n  aud: bff-client\n  scope: banking:*\n  may_act: { client_id: bff-client }\n  exp, iat, iss }
        Note over Backend-for-Frontend (BFF): may_act says:\n"bff-client is ALLOWED to\nexchange this token later"
        Backend-for-Frontend (BFF)->>Backend-for-Frontend (BFF): session.regenerate() ← prevent session fixation\nStore T1 in session (server-side only)\nNever send T1 to browser
        Backend-for-Frontend (BFF)-->>U: 302 → /dashboard\nSet-Cookie: session=XYZ (httpOnly, secure)
    end

    rect rgb(255, 245, 220)
        Note over U,API: PHASE 3 — User Asks AI Agent for Account Data
        U->>Backend-for-Frontend (BFF): POST /api/mcp/tool\n{ tool: get_my_accounts }\nCookie: session=XYZ
        Backend-for-Frontend (BFF)->>Backend-for-Frontend (BFF): Read T1 from session\nLook up tool scopes:\nget_my_accounts → banking:accounts:read
    end

    rect rgb(255, 220, 220)
        Note over Backend-for-Frontend (BFF),P1: PHASE 4 — RFC 8693 Token Exchange (Backend-for-Frontend (BFF) presents may_act, gets act)
        Backend-for-Frontend (BFF)->>P1: POST /token\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\nsubject_token=T1\nsubject_token_type=access_token\naudience=https://mcp.banking.internal\nscope=banking:accounts:read\nclient_id=bff-client\nclient_secret=...

        Note over P1: PingOne validates may_act (WHY this matters ↓):\n1. Verify T1 signature + not expired\n2. Extract may_act: { client_id: bff-client }\n3. Check authenticated caller = bff-client\n4. caller matches may_act.client_id ✅\n5. Requested audience allowed by policy ✅\n6. Requested scope ⊆ original scope ✅\n→ Without may_act, exchange is REJECTED\n→ Prevents any rogue service from\n   exchanging user tokens it shouldn't have

        P1-->>Backend-for-Frontend (BFF): T2 = JWT { sub: user123\n  aud: https://mcp.banking.internal\n  scope: banking:accounts:read\n  act: { client_id: bff-client }\n  exp: shorter lifetime }
        Note over Backend-for-Frontend (BFF): act says:\n"bff-client IS ACTING\nright now for user123"\nT1 never leaves the Backend-for-Frontend (BFF)
    end

    rect rgb(220, 255, 245)
        Note over Backend-for-Frontend (BFF),API: PHASE 5 — MCP Server Validates Delegation + Executes Tool
        Backend-for-Frontend (BFF)->>MCP: WS initialize\n{ agentToken: T2 }
        MCP->>P1: POST /introspect token=T2
        P1-->>MCP: { active: true\n  sub: user123\n  aud: https://mcp.banking.internal\n  act: { client_id: bff-client }\n  scope: banking:accounts:read }
        MCP->>MCP: aud = mcp resource URI ✅\nact.client_id = known Backend-for-Frontend (BFF) client ✅\nscope sufficient for get_my_accounts ✅\nLog: "user123 delegated via bff-client"
        MCP-->>Backend-for-Frontend (BFF): handshake OK

        Backend-for-Frontend (BFF)->>MCP: tools/call { get_my_accounts }
        MCP->>API: GET /api/accounts\nAuthorization: Bearer T2
        API->>API: Validate T2 (JWKS)\nCheck banking:accounts:read scope ✅\nFilter accounts for sub=user123
        API-->>MCP: [ { id, type, balance }, ... ]
        MCP-->>Backend-for-Frontend (BFF): tool result
        Backend-for-Frontend (BFF)-->>U: 200 { result: [ accounts ] }
    end
```

---

## Diagram 3: may_act Claim — What It Is, How It's Checked, Why It Matters

```mermaid
flowchart TD
    subgraph ISSUE["Step 1 · ISSUE — PingOne mints T1 after code exchange"]
        T1BOX["T1 — User Access Token\n─────────────────────────\nsub:      user123\naud:      bff-client\nscope:    banking:accounts:read\n          banking:transactions:write\niss:      https://auth.pingone.com/env\nexp:      now + 1h\n─────────────────────────\nmay_act: {\n  client_id: bff-client\n}\n─────────────────────────\nMeaning: bff-client is ALLOWED\nto exchange this token later.\nThis is prospective — nobody\nis acting yet."]
    end

    subgraph EXCHANGE["Step 2 · EXCHANGE — Backend-for-Frontend (BFF) presents T1 to get T2"]
        REQ["Backend-for-Frontend (BFF) → POST /token\n────────────────────────────\ngrant_type  = token-exchange\nsubject_token = T1\naudience    = mcp-server-uri\nscope       = banking:accounts:read\nclient_id   = bff-client\nclient_secret = ****"]

        subgraph CHECK["PingOne Validation — may_act check"]
            C1["① Verify T1 signature\n   and not expired"]
            C2["② Extract may_act from T1\n   → { client_id: bff-client }"]
            C3["③ Who is making this request?\n   → Authenticated as: bff-client"]
            C4["④ Does caller match may_act?\n   bff-client == bff-client ✅\n   If mismatch → REJECT 400\n   exchange_not_allowed"]
            C5["⑤ Is audience allowed by policy?\n   mcp-server-uri → allowed ✅"]
            C6["⑥ Is scope a subset of T1 scope?\n   banking:accounts:read ⊆ banking:* ✅"]
            C7["⑦ All checks pass → issue T2"]
            C1-->C2-->C3-->C4-->C5-->C6-->C7
        end

        T2BOX["T2 — Delegated Token\n─────────────────────────\nsub:   user123\naud:   https://mcp.banking.internal\nscope: banking:accounts:read  ← narrowed\nexp:   shorter lifetime\n─────────────────────────\nact: {\n  client_id: bff-client\n}\n─────────────────────────\nMeaning: bff-client IS ACTING\nfor user123 right now.\nThis is current — delegation\nis happening."]
    end

    subgraph USE["Step 3 · USE — MCP Server receives T2 and validates"]
        INTRO["MCP → POST /introspect T2\nPingOne returns full claims including act"]
        V1["✅ active = true"]
        V2["✅ aud matches MCP_SERVER_RESOURCE_URI\n   (configured in MCP server env)"]
        V3["✅ act.client_id = bff-client\n   (proves Backend-for-Frontend (BFF) performed exchange,\n    not a rogue caller)"]
        V4["✅ scope covers required tool scopes"]
        V5["📋 Audit log:\n   user123 accessed via bff-client delegation\n   tool: get_my_accounts\n   time: 2026-03-22T..."]
        INTRO-->V1-->V2-->V3-->V4-->V5
    end

    subgraph WHY["Why may_act Prevents Attacks"]
        W1["🚫 Rogue service has user token T1\n   Tries to exchange for MCP token\n   → may_act.client_id = bff-client\n   → Caller authenticated as rogue-svc\n   → Mismatch → REJECTED"]
        W2["🚫 No may_act on token\n   Token issued without delegation policy\n   → may_act missing\n   → Exchange rejected by policy\n   → Prevents delegation of tokens\n      not designed for it"]
        W3["🚫 Scope escalation attempt\n   Requests scope not in T1\n   → Requested scope not a subset\n   → REJECTED"]
    end

    T1BOX --> REQ
    REQ --> CHECK
    CHECK --> T2BOX
    T2BOX --> INTRO
    INTRO --> V1

    T1BOX -.->|"may_act is prospective\npermission"| WHY
    T2BOX -.->|"act is current\nfact"| WHY
```

---

## Diagram 4: Token Exchange — BEFORE (Current State — No Delegation)

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant Backend-for-Frontend (BFF) as Backend-for-Frontend (BFF) (3001)
    participant MCP as MCP Server (8080)
    participant API as Banking API
    participant P1 as PingOne

    Note over B,P1: ❌ BEFORE — Raw user token passed by reference, no delegation

    B->>Backend-for-Frontend (BFF): POST /api/mcp/tool (session cookie)
    Backend-for-Frontend (BFF)->>Backend-for-Frontend (BFF): Extract T1 from session\n(user's raw access token, aud=Backend-for-Frontend (BFF))

    Note over Backend-for-Frontend (BFF),MCP: T1 passed directly — same token the browser flow issued
    Backend-for-Frontend (BFF)->>MCP: WS initialize { agentToken: T1 }
    MCP->>P1: POST /introspect token=T1
    P1-->>MCP: { active, sub=user123, aud=bff ← wrong audience }
    Note over MCP: ⚠️ aud=bff-client, not mcp-server-uri\n❌ no act claim — cannot verify who sent token\n❌ no delegation record for audit\n❌ scope not narrowed for this tool
    MCP-->>Backend-for-Frontend (BFF): handshake OK (no aud enforcement)
    Backend-for-Frontend (BFF)->>MCP: tools/call { get_my_accounts }
    MCP->>API: GET /api/accounts Bearer T1
    API-->>MCP: accounts data
    MCP-->>Backend-for-Frontend (BFF): tool result
    Backend-for-Frontend (BFF)-->>B: 200 { result }

    Note over B,P1: Problems — T1 scoped for Backend-for-Frontend (BFF), used for MCP (audience mismatch)\nMCP cannot verify Backend-for-Frontend (BFF) sent it (no act claim)\nNo audit trail — just a raw user token\nIf T1 leaks in MCP layer, attacker has the full user token
```

---

## Diagram 5: Token Exchange — AFTER (RFC 8693 with may_act → act)

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant Backend-for-Frontend (BFF) as Backend-for-Frontend (BFF) (3001)
    participant P1 as PingOne
    participant MCP as MCP Server (8080)
    participant API as Banking API

    Note over B,API: ✅ AFTER — RFC 8693 Token Exchange with may_act validation and act claim

    B->>Backend-for-Frontend (BFF): POST /api/mcp/tool { tool: get_my_accounts } (session cookie)
    Backend-for-Frontend (BFF)->>Backend-for-Frontend (BFF): Read T1 from session\nT1 contains may_act: { client_id: bff-client }\nTool scope: banking:accounts:read

    Backend-for-Frontend (BFF)->>P1: POST /token\ngrant_type=token-exchange\nsubject_token=T1\naudience=https://mcp.banking.internal\nscope=banking:accounts:read\nclient_id=bff-client
    Note over P1: Validates may_act:\nmay_act.client_id=bff-client == caller ✅\nDownscope scope ✅\nIssue T2 with act claim
    P1-->>Backend-for-Frontend (BFF): T2 = { sub:user123, aud:mcp-uri\nscope:accounts:read\nact:{ client_id:bff-client } }

    Backend-for-Frontend (BFF)->>MCP: WS initialize { agentToken: T2 }
    MCP->>P1: POST /introspect T2
    P1-->>MCP: { active, sub, aud=mcp-uri, act={ client_id:bff-client } }
    MCP->>MCP: aud=mcp-server-uri ✅\nact.client_id=bff-client ✅\nscope=accounts:read ✅\nAudit: user123 via bff delegation
    MCP-->>Backend-for-Frontend (BFF): handshake OK
    Backend-for-Frontend (BFF)->>MCP: tools/call { get_my_accounts }
    MCP->>API: GET /api/accounts Bearer T2
    API->>API: Validate T2 — aud, scope, exp ✅
    API-->>MCP: accounts
    MCP-->>Backend-for-Frontend (BFF): tool result
    Backend-for-Frontend (BFF)-->>B: 200 { result }
```

---

## Diagram 6: AI Agent (LangChain) Full Flow — CIBA → Token Exchange → Tool Result

```mermaid
sequenceDiagram
    autonumber
    participant U as User Email
    participant LC as LangChain Agent (MCP Host)
    participant P1 as PingOne / DaVinci
    participant MCP as MCP Server (8080)
    participant API as Banking API

    rect rgb(220, 235, 255)
        Note over LC,P1: PHASE 1 — CIBA: Get user token without browser redirect
        LC->>LC: User says "show my accounts"\nfor user@example.com
        LC->>P1: POST /bc-authorize\nlogin_hint=user@example.com\nscope=openid banking:*\nbinding_message=Banking App Access\nclient_id=ai-agent-client
        P1->>P1: Look up user by email\nTrigger DaVinci flow
        P1->>U: 📧 Email: "Approve Banking App access [Approve]"
        P1-->>LC: { auth_req_id: abc-123, expires_in: 300, interval: 5 }
        LC-->>U: "Check your email and click Approve"

        loop Poll every 5s until approved
            LC->>P1: POST /token\ngrant_type=ciba\nauth_req_id=abc-123
            P1-->>LC: { error: authorization_pending }
        end

        U->>P1: User clicks Approve in email
        LC->>P1: POST /token (next poll)
        P1-->>LC: T_ciba = { sub:user123, aud:ai-agent\nmay_act:{ client_id:ai-agent-client }\nscope:banking:* }
    end

    rect rgb(255, 220, 220)
        Note over LC,P1: PHASE 2 — Token Exchange: Narrow to MCP audience with act claim
        LC->>P1: POST /token\ngrant_type=token-exchange\nsubject_token=T_ciba\nactor_token=ai_agent_client_assertion\naudience=https://mcp.banking.internal\nscope=banking:accounts:read\nclient_id=ai-agent-client
        Note over P1: Validates may_act:\nmay_act.client_id=ai-agent-client == caller ✅\nIssue T3 with act claim
        P1-->>LC: T3 = { sub:user123\naud:mcp-server-uri\nact:{ client_id:ai-agent-client }\nscope:banking:accounts:read }
    end

    rect rgb(220, 255, 220)
        Note over LC,API: PHASE 3 — MCP Tool Call with delegated token
        LC->>MCP: WS initialize { agentToken: T3 }
        MCP->>P1: POST /introspect T3
        P1-->>MCP: { active, sub:user123, aud:mcp-uri\nact:{ client_id:ai-agent-client } }
        MCP->>MCP: aud=mcp-server-uri ✅\nact.client_id=ai-agent-client ✅\nAudit: user123 via ai-agent delegation
        MCP-->>LC: handshake OK

        LC->>MCP: tools/call { get_my_accounts }
        MCP->>API: GET /api/accounts Bearer T3
        API->>API: Validate T3\nCheck banking:accounts:read ✅
        API-->>MCP: [ accounts ]
        MCP-->>LC: tool result

        LC->>LC: LLM formats response
        LC-->>U: "You have 2 accounts:\nChecking $2,400 | Savings $11,200"
    end
```

---

## Diagram 7: CIBA Email Approval Flow

```mermaid
sequenceDiagram
    autonumber
    participant SRV as Backend-for-Frontend (BFF) or MCP Server
    participant P1 as PingOne
    participant DV as DaVinci Flow
    participant U as User Email

    SRV->>P1: POST /bc-authorize\n{ login_hint: user@email.com\n  scope: openid banking:*\n  binding_message: Banking App Access\n  client_id, client_secret }
    P1->>P1: Look up user by email
    P1->>DV: Trigger CIBA flow
    DV->>U: 📧 Email: Approve Banking App access\n[Approve] [Deny]
    P1-->>SRV: { auth_req_id: abc-123\n  expires_in: 300\n  interval: 5 }

    loop Poll every 5 seconds
        SRV->>P1: POST /token\ngrant_type=urn:openid:params:grant-type:ciba\nauth_req_id=abc-123
        P1-->>SRV: { error: authorization_pending }
    end

    U->>DV: User clicks Approve in email
    DV->>P1: Mark auth_req_id approved

    SRV->>P1: POST /token (next poll)
    P1-->>SRV: { access_token: T_user\n  refresh_token: R\n  scope: banking:*\n  may_act: { client_id: ai-agent-client } }

    SRV->>SRV: Store tokens in session\nProceed to token exchange (Diagram 5/6)
```

---

## Diagram 8: may_act Claim Lifecycle — Prospective vs Current

```mermaid
flowchart LR
    subgraph ISSUE["① ISSUE — Code Exchange\nPingOne adds may_act to T1"]
        T1["Token T1\n──────────────\nsub: user123\naud: bff-client\nscope: banking:*\n──────────────\nmay_act: {\n  client_id: bff-client\n}\n──────────────\n🔵 PROSPECTIVE\nSays who MAY act later\nNobody is acting yet"]
    end

    subgraph EXCHANGE["② EXCHANGE — RFC 8693\nPingOne validates may_act, issues T2"]
        CHECK["PingOne checks:\n1. T1 valid + not expired\n2. may_act exists\n3. caller == may_act.client_id\n4. audience allowed by policy\n5. scope ⊆ original scope\n✅ All pass → issue T2\n❌ Any fail → reject 400"]
        T2["Token T2\n──────────────\nsub: user123\naud: mcp-server-uri ← scoped\nscope: accounts:read ← narrowed\n──────────────\nact: {\n  client_id: bff-client\n}\n──────────────\n🟢 CURRENT FACT\nSays who IS acting now\nbff-client is the actor"]
        CHECK --> T2
    end

    subgraph RESOURCE["③ RESOURCE SERVER\nMCP Server validates act"]
        MCP_CHECK["Introspect T2:\n✅ active\n✅ aud = MCP_SERVER_RESOURCE_URI\n✅ act.client_id = bff-client\n✅ scope sufficient\n📋 Audit log:\nuser123 via bff-client\ntime + tool recorded"]
    end

    subgraph ATTACK["What happens without may_act"]
        A1["Rogue service holds T1\nTries token exchange\n→ caller = rogue-svc\n→ may_act.client_id = bff-client\n→ MISMATCH → REJECTED 🚫"]
        A2["Token issued without\nmay_act policy\n→ claim missing\n→ no delegation allowed 🚫"]
        A3["Scope escalation\nRequests broader scope\n→ scope not subset 🚫"]
    end

    T1 --> CHECK
    T2 --> MCP_CHECK
    T1 -.->|"attack attempt"| ATTACK
```

---

## Diagram 9: MCP Inspector — dual hosts (Backend-for-Frontend (BFF) vs LangChain)

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser (logged-in user)
    participant UI as React /mcp-inspector
    participant Backend-for-Frontend (BFF) as Banking Backend-for-Frontend (BFF) :3001
    participant P1 as PingOne (optional RFC 8693)
    participant MCP as MCP Server :8080 WS
    participant AG as LangChain :8081 /inspector/mcp-host

    Note over U,AG: Compare two MCP hosts: Backend-for-Frontend (BFF) session token path vs agent-issued token path.

    U->>UI: Open MCP Inspector (session cookie)
    UI->>Backend-for-Frontend (BFF): GET /api/mcp/inspector/context
    Backend-for-Frontend (BFF)-->>UI: mcpHosts: banking_bff · langchain_agent · shared_mcp_server

    UI->>Backend-for-Frontend (BFF): GET /api/mcp/inspector/tools
    Backend-for-Frontend (BFF)->>Backend-for-Frontend (BFF): getSessionAccessToken()
    opt mcp_resource_uri configured
        Backend-for-Frontend (BFF)->>P1: POST /token (RFC 8693 token exchange)
        P1-->>Backend-for-Frontend (BFF): MCP-audience access token
    end
    Backend-for-Frontend (BFF)->>MCP: WS initialize → tools/list
    MCP-->>Backend-for-Frontend (BFF): tool catalog
    Backend-for-Frontend (BFF)-->>UI: tools + source: bff_session

    U->>UI: Invoke tool (demo)
    UI->>Backend-for-Frontend (BFF): POST /api/mcp/inspector/invoke
    Backend-for-Frontend (BFF)->>MCP: tools/call
    MCP-->>Backend-for-Frontend (BFF): result
    Backend-for-Frontend (BFF)-->>UI: JSON result

    UI->>AG: GET /inspector/mcp-host (agent health port)
    AG-->>UI: langchain_tools_exposed_to_llm · mcp_client_registry snapshot
```
