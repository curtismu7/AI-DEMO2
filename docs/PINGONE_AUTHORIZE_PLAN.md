# PingOne Authorize — Setup Guide (Super Banking)

Step-by-step setup to connect the Super Banking banking demo to **PingOne Authorize** for real-time transaction and MCP delegation policy decisions.

**Product scope:** PingOne SaaS (`auth.pingone.com`) with the PingOne Authorize add-on.
This is NOT PingOne Advanced Identity Cloud (ForgeRock AM).

**Related:** [`PINGONE_MAY_ACT_SETUP.md`](PINGONE_MAY_ACT_SETUP.md) — OAuth apps, token chain, resource servers, and scope configuration. Complete that guide first.

---

## What You Are Setting Up

PingOne Authorize enforces policy decisions at two points in the Super Banking demo:

1. **Transaction authorization** — every transfer and withdrawal is evaluated by a PingOne Authorize policy before it executes. The policy returns PERMIT, DENY, or a step-up MFA obligation.
2. **MCP first-tool gate** *(optional)* — the first MCP tool call per signed-in session is evaluated against a delegation policy. The policy validates the actor chain (`act.client_id`, nested `act.act.client_id`) and the resource audience before allowing the Super Banking AI Agent to execute tools.

---

## Reference: All Names and Values

Use this table as your single source of truth when filling in PingOne forms and your `.env` file.

| Item | Field | Exact value |
|------|-------|-------------|
| Authorize Worker App | Name | `Super Banking Authorize Worker` |
| Transaction Policy | Name | `Super Banking Transaction Authorization` |
| MCP Delegation Policy | Name | `Super Banking MCP Delegation` |
| Transaction Decision Endpoint | Name | `Super Banking Transaction Authorization Endpoint` |
| MCP Decision Endpoint | Name | `Super Banking MCP Delegation Endpoint` |
| Env var — Worker Client ID | `PINGONE_AUTHORIZE_WORKER_CLIENT_ID` | `<client ID of Super Banking Authorize Worker>` |
| Env var — Worker Client Secret | `PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET` | `<client secret of Super Banking Authorize Worker>` |
| Env var — Transaction Endpoint ID | `PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID` | `<decision endpoint ID — copy from PingOne after Step 5a>` |
| Env var — MCP Endpoint ID | `PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID` | `<decision endpoint ID — copy from PingOne after Step 5b>` |

> **Applications from `PINGONE_MAY_ACT_SETUP.md` (already configured):**
> - `Super Banking User` — issues Subject Tokens (PKCE login)
> - `Super Banking Backend-for-Frontend (BFF) Admin` — exchanges Subject Token → MCP Token
> - `Super Banking MCP Worker` — exchanges MCP Token → Resource Token
>
> The `Super Banking Authorize Worker` created below is **separate** — it holds the credentials the BFF uses exclusively for calling PingOne Authorize decision endpoints.

---

## Part 1 — Create the Authorize Worker Application

> **PingOne Console → Applications → Applications → Add Application**

This Worker application holds the credentials the BFF uses to call PingOne Authorize decision endpoints. It is separate from `Super Banking Backend-for-Frontend (BFF) Admin`, which handles token exchange.

**Overview tab:**

| Field | Type in |
|-------|---------|
| **Application name** | `Super Banking Authorize Worker` |
| **Description** | `Worker application used by the Super Banking Backend-for-Frontend (BFF) to evaluate PingOne Authorize policy decisions. Handles transaction authorization and optional MCP first-tool delegation checks. Do not use this application for token exchange or user login.` |
| **Application type** | `Worker` |

**Configuration tab → Grant Types:**

- ✅ `Client Credentials`

Click **Save**, then from the application detail page copy:
- **Client ID** → this becomes `PINGONE_AUTHORIZE_WORKER_CLIENT_ID`
- **Client Secret** → this becomes `PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET`

**Assign the Authorize evaluation role:**

PingOne Authorize decision endpoints require the calling application to have appropriate environment permissions.

1. Go to **Roles** for the `Super Banking Authorize Worker` application
2. Assign **Environment Admin** *(or the specific PingOne Authorize evaluator role if your environment uses role-based Authorize access)*

> Refer to [Authorization using PingOne Authorize](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_overview.html) for the exact role assignment required in your PingOne subscription tier.

---

## Part 2 — Define Trust Framework Attributes

> **PingOne Console → Authorize → Trust Framework → Attributes**

The Trust Framework defines the named parameters your BFF sends to Authorize when requesting a decision. Add each attribute below.

### 2a. Transaction Authorization Attributes

These attributes are sent on every transaction authorization request.

| Attribute name | Type | Description |
|----------------|------|-------------|
| `Amount` | Number | Transaction amount in US dollars |
| `TransactionType` | String | One of: `transfer`, `withdrawal`, `deposit` |
| `UserId` | String | PingOne user ID — the `sub` claim from the user's access token |
| `Acr` | String | Authentication context class reference (step-up level already met by the user) |
| `Timestamp` | String | ISO 8601 timestamp of the transaction request |

### 2b. MCP Delegation Attributes *(for the optional MCP first-tool gate)*

These attributes are sent on the first MCP tool call per user session.

| Attribute name | Type | Description |
|----------------|------|-------------|
| `DecisionContext` | String | Always `McpFirstTool` — identifies this as an MCP delegation check |
| `UserId` | String | PingOne user ID — matches the `sub` claim on the MCP token |
| `ToolName` | String | Name of the MCP tool being invoked (e.g. `banking_get_accounts`) |
| `TokenAudience` | String | The `aud` claim of the presented MCP access token |
| `ActClientId` | String | `act.client_id` from the MCP token — the BFF actor (Client ID of `Super Banking Backend-for-Frontend (BFF) Admin`) |
| `NestedActClientId` | String | `act.act.client_id` or `act.act.sub` — the upstream agent actor, when nested delegation is present |
| `McpResourceUri` | String | Expected MCP resource URI — should match `https://mcp-server.pingdemo.com` |
| `Acr` | String | Authentication context class reference |

---

## Part 3 — Create the Transaction Authorization Policy

> **PingOne Console → Authorize → Policies → Add Policy**

**Overview:**

| Field | Type in |
|-------|---------|
| **Policy name** | `Super Banking Transaction Authorization` |
| **Description** | `Evaluates Super Banking banking transaction requests. Returns PERMIT for allowed transactions, DENY for rejected ones, and a step-up MFA obligation (HTTP 428) when stronger authentication is required before the transaction can proceed.` |

**Reference policy rules** — implement these conditions in the PingOne Authorize policy editor using the Trust Framework attributes from Step 2a:

| Condition | Decision | Rationale |
|-----------|----------|-----------|
| `Amount > 50000` | **DENY** | Blocks unusually large transfers in the demo |
| `Amount > 10000` AND `Acr` does not include MFA | **OBLIGATION — step-up** | Require MFA before approving large transfers or withdrawals |
| `TransactionType = "withdrawal"` AND `Amount > 10000` AND `Acr` does not include MFA | **OBLIGATION — step-up** | Stricter requirement for withdrawals |
| *(all other cases)* | **PERMIT** | Allow standard transactions |

> The simulated Authorize service (`ff_authorize_simulated = true`) uses these same thresholds in-process. Matching these rules in your live policy ensures consistent behavior when you toggle between simulated and live evaluation.

---

## Part 4 — Create the MCP Delegation Policy *(optional)*

> **PingOne Console → Authorize → Policies → Add Policy**

Only required if you are enabling the MCP first-tool gate (`ff_authorize_mcp_first_tool`).

**Overview:**

| Field | Type in |
|-------|---------|
| **Policy name** | `Super Banking MCP Delegation` |
| **Description** | `Evaluates MCP tool delegation requests for Super Banking. Validates the actor chain (ActClientId, NestedActClientId) and the token audience before allowing the Super Banking AI Agent to execute MCP tools on behalf of a user.` |

**Reference policy rules** — implement using Trust Framework attributes from Step 2b:

| Condition | Decision | Rationale |
|-----------|----------|-----------|
| `TokenAudience` does not match `McpResourceUri` | **DENY** | Token was not issued for the MCP server |
| `ActClientId` is not the Client ID of `Super Banking Backend-for-Frontend (BFF) Admin` | **DENY** | Unexpected actor — delegation chain broken |
| `UserId` is absent or empty | **DENY** | No user identity in the token |
| *(all other cases)* | **PERMIT** | Valid delegated MCP access |

---

## Part 5 — Create Decision Endpoints

### 5a. Transaction Authorization Endpoint

> **PingOne Console → Authorize → Decision Endpoints → Add Decision Endpoint**

| Field | Type in |
|-------|---------|
| **Name** | `Super Banking Transaction Authorization Endpoint` |
| **Description** | `Decision endpoint for Super Banking transaction authorization. Called by the BFF on every transfer and withdrawal request. Evaluates the Super Banking Transaction Authorization policy.` |
| **Policy** | Select `Super Banking Transaction Authorization` |
| **Record recent requests** | ✅ Enable *(allows admin monitoring and demo playback)* |

Click **Save**, then copy the **Decision Endpoint ID** — this becomes `PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID`.

---

### 5b. MCP Delegation Endpoint *(optional)*

> **PingOne Console → Authorize → Decision Endpoints → Add Decision Endpoint**

| Field | Type in |
|-------|---------|
| **Name** | `Super Banking MCP Delegation Endpoint` |
| **Description** | `Decision endpoint for Super Banking MCP first-tool delegation authorization. Called by the BFF on the first MCP tool invocation per user session. Evaluates the Super Banking MCP Delegation policy.` |
| **Policy** | Select `Super Banking MCP Delegation` |
| **Record recent requests** | ✅ Enable |

Click **Save**, then copy the **Decision Endpoint ID** — this becomes `PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID`.

---

## Part 6 — Configure Environment Variables

Set these in your `.env` file (`banking_api_server/`) or as Vercel environment variables.

| Variable | Where to find the value | Required? |
|----------|------------------------|-----------|
| `PINGONE_AUTHORIZE_WORKER_CLIENT_ID` | Client ID of `Super Banking Authorize Worker` (Step 1) | Required |
| `PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET` | Client Secret of `Super Banking Authorize Worker` (Step 1) | Required |
| `PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID` | Decision Endpoint ID from Step 5a | Required for transactions |
| `PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID` | Decision Endpoint ID from Step 5b | Required for MCP gate |

> These can also be set through the Admin UI at **Admin → Configuration → PingOne Authorize** without redeploying.

---

## Part 7 — Enable Feature Flags

Enable and adjust flags from **Admin → Feature Flags** or the `/demo-data` page.

| Flag | What it does | Recommended starting value |
|------|-------------|---------------------------|
| `ff_authorize_simulated` | Use in-process simulated Authorize — no PingOne API call. Use this to verify the UI and flow before connecting live PingOne. | `ON` first, then `OFF` once live PingOne is configured |
| `ff_authorize_fail_open` | Allow transactions to proceed when the Authorize API call fails (timeout, misconfiguration) | `ON` during initial setup; reassess for production |
| `ff_authorize_deposits` | Also apply Authorize to deposit transactions (default: transfers + withdrawals only) | `OFF` by default |
| `ff_authorize_mcp_first_tool` | Evaluate PingOne Authorize on the first MCP tool call per session | `OFF` until Step 5b is configured |

---

## Part 8 — Verify

### 8a. Verify transaction authorization

1. Log in as a standard user
2. Navigate to **Send Money**
3. Submit a transfer of **$500** → expect **PERMIT** (transaction succeeds)
4. Submit a transfer of **$60,000** → expect **DENY** (transaction blocked)
5. In **Admin → Monitoring → PingOne Authorize → Recent Decisions** — confirm decision records appear with PERMIT/DENY outcomes and the correct Trust Framework parameters (`Amount`, `TransactionType`, `UserId`)

### 8b. Verify MCP delegation *(if enabled)*

1. Set `PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID` and enable `ff_authorize_mcp_first_tool`
2. Log in as a user and open the **AI Agent**
3. Send a message that triggers a tool call (e.g. "show my accounts")
4. In **Admin → Monitoring → PingOne Authorize → Recent Decisions** — confirm a `McpFirstTool` evaluation appears with `TokenAudience`, `ActClientId`, and `UserId` populated

---

## How the BFF Calls Authorize

For reference — the BFF sends a `POST` to the decision endpoint with Trust Framework parameters in this shape:

**Transaction request:**
```json
{
  "parameters": {
    "Amount": 1000,
    "TransactionType": "transfer",
    "UserId": "<user-sub>",
    "Acr": "urn:pingidentity:authentication:user:password",
    "Timestamp": "2026-03-30T12:00:00.000Z"
  }
}
```

**MCP first-tool request:**
```json
{
  "parameters": {
    "DecisionContext": "McpFirstTool",
    "UserId": "<user-sub>",
    "ToolName": "banking_get_accounts",
    "TokenAudience": "https://mcp-server.pingdemo.com",
    "ActClientId": "<client-id-of-bx-finance-bff-admin>",
    "NestedActClientId": "",
    "McpResourceUri": "https://mcp-server.pingdemo.com"
  }
}
```

The endpoint URL is:
```
POST https://auth.pingone.com/{environmentId}/as/decisionEndpoints/{decisionEndpointId}
```

Authorization uses a Bearer token obtained via Client Credentials from `Super Banking Authorize Worker`.

---

## References

- [Authorization using PingOne Authorize — overview](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_overview.html)
- [PingOne Platform APIs — Decision Endpoints](https://developer.pingidentity.com/pingone-api/authorize/authorization-decisions/decision-endpoints.html)
- [PINGONE_MAY_ACT_SETUP.md](PINGONE_MAY_ACT_SETUP.md) — OAuth apps, token chain, resource servers, scope configuration
- `banking_api_server/services/pingOneAuthorizeService.js` — BFF implementation
- `banking_api_server/services/simulatedAuthorizeService.js` — simulated Authorize for testing without PingOne

---

---

## Part 9 — AUD Validation in the MCP Delegation Policy

The MCP delegation policy should validate that `TokenAudience` equals the expected MCP server URL. This prevents a token issued for a different resource server from being replayed at the MCP server.

**Trust Framework condition (PingOne Authorize condition editor):**

| Condition | Value | Outcome |
|-----------|-------|---------|
| `TokenAudience` equals `McpResourceUri` | `https://your-mcp-server.example.com` | PERMIT (token is for this MCP server) |
| `TokenAudience` does not match | *(mismatch)* | DENY (token was issued for a different audience) |

**Steps in PingOne Authorize:**
1. Open your `Super Banking MCP Delegation` policy (or the policy linked to your MCP decision endpoint).
2. In the Trust Framework attribute rules, add a condition:
   - Attribute name: `TokenAudience`
   - Operator: `equals`
   - Expected value: your exact MCP server URI (e.g., `https://mcp.example.com` — must match `mcp_resource_uri` in Admin → Config)
3. Branch: if condition fails → DENY with reason `aud_mismatch`

> **Note:** The BFF also sends `McpResourceUri` as a separate attribute. You can use either for the comparison. `TokenAudience` is extracted from the actual MCP token; `McpResourceUri` comes from the BFF config.

---

## Part 10 — RFC 8693 act.sub vs act.client_id

PingOne issues tokens with `act.client_id` (PingOne-specific extension) AND may also include `act.sub` (RFC 8693 §4.1 canonical actor identifier). The Super Banking BFF sends **both** in a coalesced value via `ActClientId`:

```
ActClientId = act.client_id  OR  act.sub  (whichever is present, in that priority)
```

**Why this matters for your PAZ policy:**

In a full RFC 8693 two-hop chain, the actors are identified by URL (subject), not client_id:
- `act.sub` = `https://bff.example.com` (BFF actor — acts on behalf of user)
- `act.act.sub` = `https://agent1.example.com` (upstream agent — acts on behalf of BFF)

But PingOne-based token exchange typically uses `act.client_id`:
- `act.client_id` = `<UUID of Super Banking BFF Admin app>`

**Policy design recommendation:**

Configure your MCP delegation policy to check `ActClientId` against the **expected BFF Client ID** (the UUID from PingOne → Applications → `Super Banking Backend-for-Frontend (BFF) Admin` → Client ID):

| Condition | Value | Outcome |
|-----------|-------|---------|
| `ActClientId` equals your BFF Client ID or URL | `<your-bff-client-id>` | PERMIT |
| `ActClientId` is empty | *(empty)* | DENY (no actor — direct call, not delegated) |
| `ActClientId` does not match | *(unknown actor)* | DENY |

For `NestedActClientId` (agent check):
- If you run a specific agent, check `NestedActClientId` equals the agent client ID / URL.
- If you allow any upstream agent, skip the `NestedActClientId` check (or only deny on mismatch when non-empty).

---

## Part 11 — Transaction Limit Policy Examples

The BFF sends these attributes to the **Transaction endpoint** (`Super Banking Demo — Transactions`):

| Attribute | Type | Example | Description |
|-----------|------|---------|-------------|
| `UserId` | String | `abc123-def-456` | PingOne user subject ID |
| `Amount` | Number | `1500.00` | Transaction amount in USD |
| `TransactionType` | String | `transfer` | One of: transfer, deposit, withdrawal |
| `Acr` | String | `level1` | Authentication context reference (from session) |
| `Timestamp` | String | ISO-8601 | Request timestamp |

**Example policy conditions (PingOne Authorize condition editor):**

*Condition 1 — Block large transfers:*
```
IF TransactionType == "transfer" AND Amount > 5000
THEN DENY
     reason: "Transfer exceeds daily limit"
```

*Condition 2 — Require step-up MFA for high-value transactions:*
```
IF Amount > 1000 AND Acr != "level2"
THEN DENY with obligation STEP_UP
     obligation type: "STEP_UP"
     message: "High-value transaction requires additional authentication"
```

*Condition 3 — Permit standard transactions:*
```
IF Amount <= 1000
THEN PERMIT
```

**Step-up obligation shape:**
When the step-up obligation is present in the PAZ response, the BFF automatically surfaces an MFA challenge to the user (CIBA backchannel or OTP redirect, per `step_up_method` config). The transaction is blocked until the user authenticates at the required level.

---

## Part 12 — Two-Hop act Chain Policy Design

The MCP delegation policy validates a **two-hop delegation chain**:

```
User (sub)
  └── delegated to: BFF (act.sub or act.client_id)              ← ActClientId
        └── upstream agent: Agent1 (act.act.sub or act.act.client_id) ← NestedActClientId
```

**Recommended policy logic (MCP Decision Endpoint):**

1. Check `DecisionContext == "McpFirstTool"` — guard against wrong endpoint
2. Check `TokenAudience == <MCP server URI>` — AUD validation (Part 5)
3. Check `ActClientId` is non-empty AND matches expected BFF identity (Part 6)
4. (Optional) Check `NestedActClientId` matches expected agent identity
5. Check `UserId` exists in your data store (PingOne user lookup attribute)
6. PERMIT if all checks pass; DENY otherwise

**PingOne Authorize Trust Framework attributes to create:**

| Attribute Name | Type | Source |
|----------------|------|--------|
| `DecisionContext` | String | BFF parameter |
| `UserId` | String | BFF parameter → PingOne user lookup |
| `ToolName` | String | BFF parameter |
| `TokenAudience` | String | BFF parameter (from JWT `aud`) |
| `ActClientId` | String | BFF parameter (from JWT `act.client_id` or `act.sub`) |
| `NestedActClientId` | String | BFF parameter (from JWT `act.act.client_id` or `act.act.sub`) |
| `McpResourceUri` | String | BFF parameter (from config) |

> **Tip:** Use the bootstrap button in **Admin → Monitoring → PingOne Authorize** to automatically create the two demo decision endpoints. You still need to create the policies and link them to the endpoints manually in PingOne.
