# Actor Token Terminology Guide

**Definitive reference for "Actor" vs "Agent" terminology in RFC 8693 token delegation patterns**

---

## Quick Reference Table

| Term | Definition | RFC Section | Example Usage |
|------|-----------|-------------|----------------|
| **Actor Token** | OAuth token with `act` claim identifying the entity (agent) performing actions | RFC 8693 §4.2 | "The actor token contains the agent's ID and the original user's ID" |
| **Agent Token** | Same as Actor Token (alternative name used in UI/education) | RFC 8693 §4.2 | "The agent token was successfully issued during token exchange" |  
| **Agent Actor** | RFC 8693 pattern where a token identifies an agent (actor) acting on behalf of a user | RFC 8693 §4 | "The agent-actor delegation pattern requires both act and may_act claims" |
| **Act Claim** | JWT claim (`act`) that identifies the entity performing actions and the original subject | RFC 8693 §4.2 | `"act": {"sub": "agent-id", "acr": "urn:pingidentity:oauth:mfa"}` |
| **May_Act Claim** | JWT claim (`may_act`) defining what the actor is authorized to do on behalf of the subject | RFC 8693 §4.3 | `"may_act": {"assertion": "..."}`  (contains scopes and permissions) |
| **Subject Claim** | JWT claim (`sub`) identifying the original authenticated user | RFC 6749 §4.1 | `"sub": "user-123"` |
| **Audience Claim** | JWT claim (`aud`) identifying the intended recipient API or resource | RFC 6749 §3.1.1 | `"aud": "https://banking-api.example.com"` |

---

## Detailed Definitions

### Actor vs Agent (They're the Same!)

In this codebase and the OAuth/MCP ecosystem, **"Actor" and "Agent" refer to exactly the same token and role**. The terminology difference comes from where these terms are used:

- **"Actor"** appears in:
  - RFC 8693 specification documents
  - Technical architecture diagrams  
  - Backend validation code and comments
  - Security audit documentation

- **"Agent"** appears in:
  - User-facing UI labels and education panels
  - Demo configuration
  - Frontend application language
  - Error messages presented to end users

**Why both terms?** RFC 8693 defines the pattern using "actor" to mean "the entity performing actions on behalf of another". In the broader AI agentic context (MCP, LLMs), "agent" is the more intuitive term for non-technical audiences. We use both, but always clarify which we mean.

**Example:** "The agent's (actor's) token includes the act claim" or "Agent tokens must contain actor credentials."

### Agent Actor (The RFC 8693 Pattern)

"Agent Actor" is a specific term describing the RFC 8693 token exchange pattern:

1. **Original State**: User Alice logs in, receives user token with `sub: "alice"` and `aud: "banking-api"`
2. **Delegation**: AI Agent requests token exchange on behalf of Alice, specifying:
   - `subject_token`: Alice's token
   - `actor_token`: Agent's credentials (or agent service principal)
3. **Result**: Issued token contains:
   - `sub: "alice"` (original subject)
   - `act: {sub: "agent-service"}` (the actor/agent)
   - `may_act: {...}` (agent's delegated permissions)
   - `aud: "banking-api"` (still intended for banking API)

This pattern allows: "Agent service XYZ is authorized to act on behalf of User Alice, with permission Y."

### The Act Claim

The **act claim** (`act`) is a JWT claim that proves an entity (agent/actor) is authorized to perform actions on someone else's behalf.

**Structure** (RFC 8693 §4.2):
```json
{
  "act": {
    "sub": "agent-service-principal-id",
    "acr": "urn:pingidentity:oauth:mfa"
  }
}
```

**What it proves:**
- The `sub` inside `act` identifies WHO the agent/actor is
- The presence of `act` in a token (alongside `sub`) indicates delegation: agent acting for original `sub`
- The `acr` shows HOW the agent authenticated (MFA, device, etc.)

**validation**: If a token has an `act` claim, the backend must verify:
1. The `act.sub` matches an authorized agent/service principal
2. The original `sub` is the user the agent is acting for
3. The `aud` (audience) matches the API the agent is accessing

### The May_Act Claim

The **may_act claim** (`may_act`) defines WHAT the actor/agent is allowed to do on behalf of the subject.

**Structure** (RFC 8693 §4.3):
```json
{
  "may_act": {
    "assertion": "<signed-or-encrypted-assertion>",
    "scope": ["banking:read", "banking:transfer:up_to_10000"]
  }
}
```

**What it defines:**
- Specific scopes the agent can use (not all user scopes)
- Permissions granted ONLY to this agent for THIS delegation
- Constraints on what agent can access (transaction limits, data sensitivity, etc.)

**Validation**: Before agent performs any API action, backend must verify:
1. The `aud` claim matches the target API
2. The requested scope is listed in `may_act.scope`
3. The `act.sub` is a trusted agent identity

---

## RFC 8693 References

All terminology and patterns referenced in this guide come from **RFC 8693 — OAuth 2.0 Token Exchange**. Key sections:

### RFC 8693 Section 4.2: The `act` Claim
> "The `act` claim indicates that assertion is made regarding the actor (typically the subject), such as over the authorization context in which the assertion is made."

**In our context:**
- `act.sub` = the agent/actor's identity (e.g., "mcp-agent-v1")
- Present when delegation is active (agent acting for user)
- Must be validated to prevent privilege escalation

### RFC 8693 Section 4.3: The `may_act` Claim  
> "The `may_act` claim defines which principals the token bearer can act as, when combined with the `sub` claim identifying the bearer of the token."

**In our context:**
- Limits agent's delegated permissions
- Protects against agent abusing more access than granted
- Used in authorization decisions at API boundary

### RFC 6749 Section 4.1: Standard Claims
Reference for `sub` (subject) and `aud` (audience) claims used in all OAuth tokens.

---

## Code Examples

### Example 1: User Token (No Delegation)

```json
{
  "sub": "user-alice-123",
  "aud": "https://banking-api.example.com",
  "scope": "banking:read banking:transfer banks:admin",
  "iat": 1648571234,
  "exp": 1648574834,
  "iss": "https://auth.pingone.com",
  "token_use": "access"
}
```

**Interpretation:** Alice is accessing banking API with full banking scopes. No agent involved.

### Example 2: Agent (Actor) Token

```json
{
  "sub": "user-alice-123",
  "aud": "https://banking-api.example.com",
  "act": {
    "sub": "mcp-agent-v1-service",
    "acr": "urn:pingidentity:oauth:mfa"
  },
  "may_act": {
    "scope": ["banking:read", "banking:transfer:up_to_5000"]
  },
  "iat": 1648571234,
  "exp": 1648574834,
  "iss": "https://auth.pingone.com",
  "token_use": "access"
}
```

**Interpretation:** 
- Original subject (user) = `alice-123`
- Actor (agent) = `mcp-agent-v1-service`
- Agent can only use `banking:read` and `banking:transfer:up_to_5000` (limited from Alice's full scopes)
- This is an agent token = actor token (both names apply)

### Example 3: Token Exchange Request (Obtaining Agent Token)

```bash
curl -X POST https://auth.pingone.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=<alice-user-token>" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "actor_token=<agent-service-token>" \
  -d "actor_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "resource=https://banking-api.example.com"
```

**What this does:**
- Alice's user token → subject_token (original authenticated party)
- Agent's credentials → actor_token (who's acting)
- Requests new token for banking-api resource
- PingOne will issue a token with `act` claim containing agent identity

### Example 4: Validation in Code

```javascript
// Validate an actor (agent) token
function validateAgentActorToken(decoded) {
  // Check original subject exists
  if (!decoded.sub) throw new Error("Missing subject (sub) claim");
  
  // Check ACTOR (agent) identity is present
  if (!decoded.act || !decoded.act.sub) {
    throw new Error("Missing act claim — this is not an agent token");
  }
  
  // Check agent (actor) has permission scopes
  if (!decoded.may_act || !decoded.may_act.scope) {
    throw new Error("Missing may_act claim — agent permissions undefined");
  }
  
  // Check audience matches target API
  const expectedAud = "https://banking-api.example.com";
  if (decoded.aud !== expectedAud) {
    throw new Error(`Audience mismatch: expected ${expectedAud}, got ${decoded.aud}`);
  }
  
  // Extract useful details
  const actorId = decoded.act.sub;        // Agent/actor identity
  const userId = decoded.sub;              // Original user
  const allowedScopes = decoded.may_act.scope;  // What agent can do
  
  console.log(`Agent (actor) ${actorId} is acting for user ${userId} with scopes: ${allowedScopes.join(', ')}`);
  
  return { valid: true, actorId, userId, allowedScopes };
}
```

---

## When to Use Each Term

### Use "Actor" When:
- Discussing RFC 8693 specification compliance
- Writing technical documentation or architecture diagrams
- Documenting validation logic in code comments
- Referencing OAuth/OAuth specifications

**Example:** "The actor token's act claim identifies the service principal performing the delegated action."

### Use "Agent" When:
- Writing user-facing UI labels or error messages
- Explaining concepts to non-technical audiences
- Naming UI components or pages
- Discussing AI agentic behavior

**Example:** "The agent successfully completed the transaction on your behalf."

### Use "Agent Actor" When:
- Describing the complete RFC 8693 delegation pattern
- Documenting architecture that involves delegation
- Explaining how the act and may_act claims interact

**Example:** "The agent-actor pattern allows an AI service to perform actions on behalf of a user, with explicit scope limitations through the may_act claim."

### Use "Act Claim" When:
- Referencing the specific JWT claim (lowercase, in code)
- Discussing claim contents or validation
- Explaining token structure

**Example:** "Extract the actor's ID from the act claim using decoded.act.sub."

### Use "May_Act Claim" When:
- Referencing the specific JWT claim
- Discussing permission scopes in delegation
- Explaining authorization decisions

**Example:** "Check that the requested scope is listed in the may_act claim before authorizing the API call."

---

## Common Mistakes & Corrections

| ❌ Wrong | ✓ Correct | Explanation |
|---------|-----------|-------------|
| "The actor claim contains the agent ID" | "The act claim contains the actor (agent) ID" | The JWT claim is called `act`, not `actor`. It contains actor identification. |
| "Agent token has an actor" | "Agent token contains an act claim with the actor's identity" | Clarifies that the token itself is the agent token (actor token), and the `act` claim inside identifies which actor/agent is using it. |
| "Alice's token was delegated to the agent" | "Token was exchanged for Alice's delegation to the agent (actor)" | Token exchange is the mechanism; delegation is the relationship. |
| "The agent app has permission Y" | "The agent's may_act claim grants permission Y" | Clarifies which part of the token (may_act) defines agent permissions. |
| "Check the actor token for scopes" | "Check the may_act claim in the agent (actor) token for allowed scopes" | Scopes are in a specific claim (may_act), not just "the token". |
| "If the user revokes, actor tokens are invalid" | "If the user revokes, agent (actor) tokens issued under that delegation are invalid" | Connects token lifecycle to user control over delegations. |

---

## Cross-Phase References

### Phase 87: Comprehensive Token Validation at Every Step
- Validates all token claims (act, may_act, sub, aud) at API boundaries
- Decides when to use authz server (introspection) vs local JWT validation
- Uses terminology from this guide

### Phase 96: Audience (aud) Claim Validation
- Validates aud claim matches target API
- Prevents agent tokens from wrong audience being used
- Works with act claim from this phase

---

**Last Updated:** 2026-04-08  
**Phase:** 95 (Actor Token = Agent Token Education)  
**References:** RFC 8693, RFC 6749, OAuth 2.0 Delegation Patterns
