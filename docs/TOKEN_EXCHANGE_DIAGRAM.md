# Token Exchange Flow Diagrams

> 📚 **Part of the Token Exchange Learning Series**  
> **Architecture Deep Dive?** [Full guide](TOKEN_EXCHANGE_ARCHITECTURE.md) • **Need Quick Ref?** [Quick reference](TOKEN_EXCHANGE_QUICK_REFERENCE.md) • **Onboarding?** [Use checklist](TOKEN_EXCHANGE_ONBOARDING.md)

## Simple Flow Diagram

```mermaid
graph TB
    A["🌐 Browser<br/>User Logs In"] -->|Session Cookie| B["🔐 BFF<br/>Backend-for-Frontend"]
    B -->|Extract User Token<br/>from Session| C["📋 User Token<br/>Original JWT"]
    C -->|RFC 8693 Exchange| D["🔄 PingOne<br/>OAuth Service"]
    D -->|Scoped Delegated Token<br/>with act claim| E["🎯 Delegated Token<br/>Limited Scope"]
    E -->|Send Only<br/>Delegated Token| F["🤖 MCP/Agent<br/>Execute Tools"]
    F -->|Query via Gateway| G["🚪 Authorization<br/>Gateway"]
    G -->|Check Policies<br/>& Scope| H["✅ Tool Execution<br/>or ❌ Deny"]
    
    B -.->|User Token<br/>Stays Here<br/>Never Leaves| B
    
    style A fill:#e1f5ff
    style B fill:#fff3e0
    style C fill:#ffe0b2
    style D fill:#c8e6c9
    style E fill:#b2dfdb
    style F fill:#f8bbd0
    style G fill:#e1bee7
    style H fill:#c5cae9
```

---

## Detailed Sequence Diagram

```mermaid
sequenceDiagram
    participant User as 👤 User
    participant Browser as 🌐 Browser
    participant BFF as 🔐 BFF
    participant PingOne as 🔄 PingOne
    participant MCP as 🤖 MCP
    participant Gateway as 🚪 Gateway

    User->>Browser: Click "Get Accounts"
    Browser->>BFF: POST /api/mcp/tool<br/>(session cookie, no token)
    
    Note over BFF: Extract user token<br/>from session
    
    BFF->>PingOne: RFC 8693 Exchange<br/>user_token + agent_creds
    Note over PingOne: Validate both tokens<br/>Create delegated token
    PingOne-->>BFF: delegated_token<br/>(scoped, expires 5min)
    
    Note over BFF: User token stays<br/>in secure session
    
    BFF->>MCP: WebSocket with<br/>delegated_token
    BFF->>MCP: Call tool
    
    MCP->>Gateway: Authorize tool call<br/>with delegated_token
    
    alt Gateway allows
        Gateway-->>MCP: ✅ Permitted
        MCP->>MCP: Execute tool
        MCP-->>BFF: Tool result
        BFF-->>Browser: Result to user
    else Gateway denies
        Gateway-->>MCP: ❌ Access Denied
        MCP-->>BFF: Error
        BFF-->>Browser: Error to user
    end
```

---

## Token Comparison Diagram

```mermaid
graph LR
    subgraph UserToken["👤 User's Original Token<br/>(In BFF Session)"]
        UT1["sub: user-123"]
        UT2["aud: api.banking"]
        UT3["scope: read write email"]
        UT4["act: null"]
        UT5["⏱️ exp: 1hr"]
    end
    
    subgraph Delegation["🔄 RFC 8693<br/>Exchange"]
        D1["Validate user token"]
        D2["Validate agent creds"]
        D3["Narrow scope"]
        D4["Add act claim"]
        D5["Short expiry"]
    end
    
    subgraph DelegatedToken["🎯 Delegated Token<br/>(Sent to Agent)"]
        DT1["sub: user-123"]
        DT2["aud: api.banking/mcp"]
        DT3["scope: mcp:invoke read"]
        DT4["act: {client_id: agent}"]
        DT5["⏱️ exp: 5min"]
    end
    
    UserToken -->|Exchange| Delegation
    Delegation -->|Result| DelegatedToken
    
    style UserToken fill:#ffe0b2
    style Delegation fill:#c8e6c9
    style DelegatedToken fill:#b2dfdb
```

---

## Security Layers Diagram

```mermaid
graph TB
    subgraph Layer1["Layer 1️⃣: Session Cookies"]
        L1["🔒 HTTP-only encrypted cookie<br/>Browser cannot access<br/>User token is server-side only"]
    end
    
    subgraph Layer2["Layer 2️⃣: Token Exchange"]
        L2["🔄 RFC 8693 at BFF<br/>User token → Delegated token<br/>Scopes narrowed"]
    end
    
    subgraph Layer3["Layer 3️⃣: Gateway Authorization"]
        L3["🚪 Check policies<br/>Validate act claim<br/>Enforce scope"]
    end
    
    Request["📤 Agent Request"] -->|Must Pass| Layer1
    Layer1 -->|If Valid| Layer2
    Layer2 -->|If Passed| Layer3
    Layer3 -->|If Permitted| Execute["✅ Execute Tool"]
    Layer3 -->|If Denied| Deny["❌ Access Denied"]
    
    style Layer1 fill:#e3f2fd
    style Layer2 fill:#fff3e0
    style Layer3 fill:#f3e5f5
    style Execute fill:#c8e6c9
    style Deny fill:#ffcdd2
```

---

## What Could Go Wrong (Insecure Pattern)

```mermaid
graph LR
    A["❌ Browser Has Token"] -->|Exposed| B["❌ JavaScript Accesses Token"]
    B -->|Sends to Agent| C["❌ Agent Has User Token"]
    C -->|Bypass Gateway| D["❌ Direct API Access"]
    D -->|Unaudited| E["❌ Data Breach"]
    
    style A fill:#ffcdd2
    style B fill:#ffcdd2
    style C fill:#ffcdd2
    style D fill:#ffcdd2
    style E fill:#c62828
```

---

## What We Actually Do (Secure Pattern)

```mermaid
graph LR
    A["✅ Browser Has Cookie"] -->|Server-side| B["✅ BFF Has Token"]
    B -->|Exchange| C["✅ Agent Has Delegated Token"]
    C -->|Limited| D["✅ Gateway Checks"]
    D -->|Allowed| E["✅ Safe Tool Execution"]
    
    style A fill:#c8e6c9
    style B fill:#c8e6c9
    style C fill:#b2dfdb
    style D fill:#b2dfdb
    style E fill:#81c784
```

---

## Request/Response Flow

```mermaid
graph TB
    Browser["🌐 Browser"]
    BFF["🔐 BFF"]
    Session["📦 Session Storage"]
    PingOne["🔄 PingOne OAuth"]
    MCP["🤖 MCP Server"]
    
    Browser -->|1. POST /api/mcp/tool| BFF
    BFF -->|2. Read Session| Session
    Session -->|3. Return userToken| BFF
    BFF -->|4. RFC 8693 Exchange| PingOne
    PingOne -->|5. Return delegatedToken| BFF
    BFF -->|6. WebSocket + delegatedToken| MCP
    MCP -->|7. Execute Tool| MCP
    MCP -->|8. Return Result| BFF
    BFF -->|9. Return to Browser| Browser
    
    style Browser fill:#e1f5ff
    style BFF fill:#fff3e0
    style Session fill:#ffe0b2
    style PingOne fill:#c8e6c9
    style MCP fill:#f8bbd0
```

---

## Permission Model

```mermaid
graph TB
    User["👤 User<br/>Full Permissions"]
    
    subgraph BFF["🔐 BFF<br/>(Trusted)"]
        BBF1["✅ Reads user token"]
        BBF2["✅ Performs exchange"]
        BBF3["✅ Controls scopes"]
    end
    
    subgraph Agent["🤖 Agent<br/>(Untrusted)"]
        A1["❌ Cannot see user token"]
        A2["❌ Cannot request extra scopes"]
        A3["❌ Cannot bypass gateway"]
        A4["✅ Can call MCP tools"]
        A5["✅ Can be audited"]
    end
    
    User -->|Trusts| BFF
    BFF -->|Delegates Limited Permissions| Agent
    
    style User fill:#e8f5e9
    style BFF fill:#fff3e0
    style Agent fill:#f3e5f5
```

---

## Timeline: "Get Accounts" Request

```mermaid
timeline
    title Token Exchange Timeline
    
    section T0
        User clicks "Get Accounts" : t0
    
    section T1-T2
        Browser sends session cookie : t1
        BFF receives request : t2
    
    section T3-T4
        BFF reads session : t3
        User token extracted : t4
    
    section T5-T8
        RFC 8693 request to PingOne : t5
        PingOne validates : t6
        PingOne issues delegated token : t7
        User token stays at BFF : t8
    
    section T9-T10
        BFF sends delegated token to MCP : t9
        Gateway validates token : t10
    
    section T11-T12
        Tool executes : t11
        Result sent back : t12
    
    Total Time: ~200ms : total
```

---

## Configuration Decision Tree

```mermaid
graph TD
    A{Is ff_skip_token_exchange<br/>set to true?}
    
    A -->|YES| B["⚠️ DEMO MODE"]
    B -->|Result| B1["User token forwarded<br/>directly to agent<br/>NOT SECURE"]
    
    A -->|NO<br/>Default| C["✅ PRODUCTION MODE"]
    C -->|Result| C1["RFC 8693 exchange<br/>Delegated token sent<br/>SECURE"]
    
    style A fill:#fff9c4
    style B fill:#ffcdd2
    style B1 fill:#c62828,color:#fff
    style C fill:#c8e6c9
    style C1 fill:#2e7d32,color:#fff
```

---

## Copy-Paste for Your Docs

All diagrams are in Mermaid format. To use in your docs:

**Markdown:**
```markdown
```mermaid
[paste diagram code]
```
```

**Rendered in:**
- GitHub (auto-renders)
- GitLab (auto-renders)
- Notion
- Confluence
- Any Mermaid-compatible viewer

---

## Print-Friendly Reference

If you want to print these:
- Use your browser's Print function
- Diagrams will render as SVG (vector graphics)
- Won't pixelate at any size
