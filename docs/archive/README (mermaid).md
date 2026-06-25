# I4AI Reference Architecture

This document presents the **Identity for AI (i4ai)** reference architecture for securing Digital Assistants with delegated access patterns. It demonstrates how an AI agent can securely invoke tools and access banking data on behalf of users using **RFC 8693 Token Exchange** within a Ping Identity ecosystem.

This is the first complete use case — the banking demo implements this exact flow end-to-end. Additional use cases and patterns will follow.

## Context: Banking Demo Implementation

This reference architecture is **fully implemented** in the [Banking Digital Assistant demo](README.md) (parent directory):

- **Agent** = LangChain AI assistant with OpenAI
- **Agent Gateway** = `banking_api_server` (Express BFF, `/api/mcp/tool` endpoint)
- **MCP Server** = `banking_mcp_server` (TypeScript WebSocket, banking tools)
- **Resource Server** = Banking data APIs (accounts, balances, transactions)
- **Authorization Server** = PingOne (token validation, policy evaluation)

See [README.md](README.md) for setup instructions and architecture overview.

## Repository Contents

| File | Description |
|---|---|
| [i4ai-ref-arch.mmd](i4ai-ref-arch.mmd) | Mermaid sequence diagram source  |
| [i4ai-ref-arch.svg](i4ai-ref-arch_v1.svg) | V1 Rendered SVG |

---

## Viewing and Editing the Diagram

The diagram is authored in [Mermaid](https://mermaid.js.org/) format (`.mmd`).

### Setup: Mermaid VSCode Extension

1. **Install extension** in VSCode:
   - Open Extensions panel (`Cmd+Shift+X` / `Ctrl+Shift+X`)
   - Search for "Mermaid Preview" by Tomoya Labs or "Mermaid Diagram Support"
   - Click **Install**

2. **View the diagram**:
   - Open `i4ai-ref-arch.mmd` in VSCode
   - Right-click → **Preview Mermaid Diagram** (or click the preview icon in the editor toolbar)
   - The sequence diagram will render in a side panel

3. **Edit and see live updates**:
   - Edit the `.mmd` file in the main editor
   - Preview pane updates automatically

### Alternative Viewers

**Online editors** (no local setup required):

- [mermaid.ai](https://mermaid.ai/d/226f9374-b2af-4ee8-b1e0-77c71f8021b9) — View the diagram (link is read-only for this diagram)
- [mermaid.live](https://mermaid.live) — Paste the `.mmd` file contents to edit and render in your browser

**Markdown preview**:

- In VSCode, open `README (mermaid).md` and preview any embedded Mermaid blocks (if using Markdown Preview Enhanced or similar)

---

## Token Operations by Participant

### Token Exchange (RFC 8693)

Token exchange is performed when a participant needs to obtain a new token scoped to the next actor in the delegation chain.

| Participant | Exchanges For | Resulting Token |
|---|---|---|
| **Agent (Digital Assistant)** | Agent Gateway | `aud: mcp-gw`, `sub: user`, `act: {sub: agent1}` |
| **Agent Gateway** | MCP | `aud: mcp`, `sub: user`, `act: {sub: agent1}` |
| **MCP** | Resource Server | `aud: resource-server`, `sub: user`, `act: {sub: agent1}` |

The `act` claim is intentionally kept flat across all exchanges: `sub` is always the user and `act` is always the originating agent. Full intermediary chain auditability will be provided by Transaction Tokens (Txn-Token draft) in a future iteration.

---

### Token Introspection

Token introspection is performed when a participant needs to retrieve token claims from the Authorization Server to make an authorization or policy decision. This is required when the token is opaque, or when real-time revocation checking is needed for a JWT.

| Participant | Introspects | Purpose |
|---|---|---|
| **Ping Authorize** | Agent token | Retrieve claims to evaluate which tools the agent is permitted to see (`tools/list`) |
| **Ping Authorize** | TX token | Retrieve claims (`sub`, `act`, `aud`, `scope`) to validate and permit the tool call |
| **Resource Server** | RS token | Retrieve claims to validate delegation chain before serving protected data |

---

### Token Validation

Token validation is lightweight local verification — checking the token signature, expiry, and `aud` claim without calling the Authorization Server. Performed by participants that receive a token but delegate the authorization decision elsewhere.

| Participant | Validates | Notes |
|---|---|---|
| **Agent Gateway** | TX token | Validates before forwarding to Ping Authorize for policy evaluation |
| **MCP** | MCP token | Validates before performing the token exchange for the Resource Server |

---

## Delegation Chain

The `act` claim is kept flat across all token exchanges. `sub` always represents the end user; `act` always represents the originating agent:

```json
{
  "sub": "user",
  "act": {
    "sub": "agent1"
  }
}
```

This applies to the TX token, MCP token, and RS token equally. Intermediaries (Gateway, MCP) are not added to the `act` chain. Full intermediary chain auditability — capturing each hop — is deferred to Transaction Tokens (Txn-Token draft).

---

## Standards Referenced

| Standard | Purpose |
|---|---|
| OAuth 2.1 | Authorization framework |
| RFC 8693 | Token Exchange — delegation and impersonation |
| RFC 8707 | Resource Indicators — `resource` parameter in authorization requests |
| RFC 7662 | Token Introspection |
| MCP (Model Context Protocol) | Agent-to-tool communication via JSON-RPC 2.0 |
| [Txn-Token (draft-ietf-oauth-transaction-tokens-08)](https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/08/) | Transaction Tokens — full intermediary chain auditability (planned) |
