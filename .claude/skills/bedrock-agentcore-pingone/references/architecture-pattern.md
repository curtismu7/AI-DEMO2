# The correct high-level pattern

---

## M2M flow (client_credentials)

> **Inferred, not confirmed against a decoded token.** The `oauth2_flow="M2M"`
> enum value, the `accessToken`-direct response shape, and the `sub`/`aud`
> claim expectations below are inferred from the SDK's flow enum and PingOne's
> standard client_credentials behavior. The origin build ran only a USER_FEDERATION
> flow end-to-end. Treat this section as a reasonable starting point, verify
> against a decoded token when you first run it, and update this note with
> what you actually observed.

Use when the agent itself needs a PingOne-issued token and there is no human
in the loop. No callback, no browser redirect, no polling.

```python
from bedrock_agentcore.runtime import BedrockAgentCoreContext
from bedrock_agentcore.services.identity import IdentityClient
import asyncio

# WAT is delivered by Runtime automatically — opaque, not a JWT (gotcha 11)
wat = BedrockAgentCoreContext.get_workload_access_token()

identity_client = IdentityClient(region)

# Single call — returns accessToken directly for M2M (inferred)
resp = await asyncio.to_thread(
    identity_client.get_resource_oauth2_token,
    resource_credential_provider_name=PROVIDER_NAME,
    scopes=SCOPES,
    oauth2_flow="M2M",
    workload_identity_token=wat,
)
agent_token = resp["accessToken"]
```

`IdentityClient.__getattr__` wraps `get_resource_oauth2_token` as a synchronous
boto3 call — use `asyncio.to_thread()` from async code (gotcha 15). The wrapper
accepts both camelCase and snake_case parameter names.

Verify the result by decoding claims — `aud` should be your resource's audience
identifier (usually the resource name, but check — they are separately editable
in PingOne), `sub` is expected to be the agent's own client_id for M2M
(inferred from standard client_credentials behavior).

---

## USER_FEDERATION flow (3LO — human login)

### Local / spike (identity-only, no Runtime hosting)

Use for testing that AgentCore↔PingOne works before building Runtime hosting.

1. Create PingOne app, resource, credential provider per `pingone-setup.md`.
2. Run a local HTTP listener to receive the OAuth redirect and call
   `CompleteResourceTokenAuth`.
3. Use `get_resource_oauth2_token()` directly with a `localhost` callback URL
   and `oauth2_flow="USER_FEDERATION"`.
4. This entire local listener mechanism is throwaway — it does not carry
   forward into Runtime hosting as-is.

### Runtime-hosted agent (production pattern)

Key differences from the local spike:

**Use `get_resource_oauth2_token()` directly — not the `@requires_access_token`
decorator.**

The decorator calls `IdentityClient.get_token()` which internally calls
`get_resource_oauth2_token()` and polls — but it hides `sessionUri` from your
code. You need `sessionUri` to pre-register user context with your backend
callback before yielding the auth URL to the caller (gotcha 14). Without it,
your callback lookup always misses (gotcha 13).

```python
from bedrock_agentcore.runtime import BedrockAgentCoreContext
from bedrock_agentcore.services.identity import IdentityClient
import asyncio, requests

wat = BedrockAgentCoreContext.get_workload_access_token()   # opaque (gotcha 11)
identity_client = IdentityClient(region)

# Step 1 — first call: get authorizationUrl + sessionUri
init_resp = await asyncio.to_thread(
    identity_client.get_resource_oauth2_token,
    resource_credential_provider_name=PROVIDER_NAME,
    scopes=SCOPES,
    oauth2_flow="USER_FEDERATION",
    workload_identity_token=wat,
    resource_oauth2_return_url=CALLBACK_URL,  # your backend's plain base URL — no query params
)

if "accessToken" in init_resp:
    agent_token = init_resp["accessToken"]    # token was cached — skip the 3LO flow
else:
    auth_url    = init_resp["authorizationUrl"]
    session_uri = init_resp["sessionUri"]
    # sessionUri looks like: urn:ietf:params:oauth:request_uri:...
    # This is NOT your Runtime invocation session ID — completely different value (gotcha 13)

    # Step 2 — pre-register sessionUri → user_id on YOUR backend
    # AgentCore calls your callback as: GET /your/callback?session_id=<sessionUri>
    # Your backend must look up user_id by sessionUri to call CompleteResourceTokenAuth
    requests.post(
        BACKEND_SESSION_URL,          # e.g. https://your-backend.example.com/agentcore/session
        json={"session_id": session_uri, "user_id": user_id},
        timeout=10,
    ).raise_for_status()

    # Step 3 — yield auth URL to caller (they open it in the user's browser)
    yield {"type": "auth_required", "url": auth_url}

    # Step 4 — poll until accessToken appears (user logged in, callback fired)
    agent_token = None
    for _ in range(120):      # 120 × 5s = 10 min max
        await asyncio.sleep(5)
        poll_resp = await asyncio.to_thread(
            identity_client.get_resource_oauth2_token,
            resource_credential_provider_name=PROVIDER_NAME,
            scopes=SCOPES,
            oauth2_flow="USER_FEDERATION",
            workload_identity_token=wat,
            resource_oauth2_return_url=CALLBACK_URL,
            session_uri=session_uri,           # required on every poll call
        )
        if "accessToken" in poll_resp:
            agent_token = poll_resp["accessToken"]
            break
```

### Backend callback endpoint

Your backend's callback (`GET /agentcore/callback?session_id=<sessionUri>`) must:

1. Extract `session_id` from the query string — this is the `sessionUri` value.
2. Look up the pre-registered `user_id` by `session_uri` (keyed on `sessionUri`,
   not your invocation session ID — they are different, gotcha 13).
3. Call `CompleteResourceTokenAuth(sessionUri, UserIdIdentifier(user_id))`.
4. Return a browser-facing success page.

The backend service hosting this endpoint needs exactly one IAM permission:
`bedrock-agentcore:CompleteResourceTokenAuth`. Create a dedicated,
narrowly-scoped IAM user for it — do not reuse a broad deploy identity (gotcha 21).

For K8s-hosted backends, inject AWS credentials explicitly via K8s secrets —
the pod will not inherit permissions from the node unless IRSA or pod identity
is configured (gotcha 31).

---

## Per-invocation user identity

Pass user context in the **JSON request body**, not headers (gotcha 10):

```python
# Invoke script / caller side
payload = json.dumps({"prompt": "...", "user_id": "your-stable-user-identifier"}).encode()

# Agent handler side
user_id = request.get("user_id", "")
```

`X-Amzn-Bedrock-AgentCore-Runtime-User-Id` and similar `x-amzn-*` headers are
filtered by the SDK before your handler code runs.

---

## Downstream token exchange (if your gateway requires a different audience)

AgentCore Identity returns a token audienced to the PingOne resource you
configured. If your downstream system (a gateway, an API) requires a different
audience, that's a separate token exchange your own code must perform — AgentCore
does not re-scope tokens automatically.

```python
# subject_token = what AgentCore returned (aud = your PingOne resource)
# actor_token   = your agent's own client_credentials token (sets act.sub)
# target        = the audience your downstream gateway validates
resp = requests.post(
    pingone_token_url,
    headers={"Authorization": f"Basic {b64_client_creds}",
             "Content-Type": "application/x-www-form-urlencoded"},
    data={
        "grant_type":          "urn:ietf:params:oauth:grant-type:token-exchange",
        "subject_token":        agent_token,
        "subject_token_type":   "urn:ietf:params:oauth:token-type:access_token",
        "actor_token":          actor_cc_token,
        "actor_token_type":     "urn:ietf:params:oauth:token-type:access_token",
        "resource":             "target-gateway-resource-name",
        "scope":                "gateway:invoke",
    },
)
gateway_token = resp.json()["access_token"]
```

---

## Token custody principle

- The backend that invokes the Runtime on a user's behalf should hold the
  human's login credential and never pass it to the Runtime-hosted agent.
- Pass only a narrow, stable identifier (e.g. a user ID string) in the request body.
- The Runtime-hosted agent's `USER_FEDERATION` flow independently authenticates
  the user against PingOne — it does not need the backend's held credential.

---

## Verification standard

Decode every token. "It deployed" or "it returned 200" is not verification.

```python
import base64, json

def decode_claims(token: str) -> dict:
    payload = token.split(".")[1]
    payload += "=" * (4 - len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))
```

Confirm: `sub` (the human's PingOne user ID for USER_FEDERATION, or the agent's
client_id for M2M), `aud` (your resource's audience identifier), `scope`, and
`act.sub` if you performed a downstream token exchange. Check these values
explicitly — the wrong `act.sub` (e.g. a different service's client_id instead
of your agent's) is a common misconfiguration that produces a well-formed token
with incorrect claims. See the downstream token exchange section above and
`references/architecture-pattern.md` for a working example if you need to set
`act.sub`.
