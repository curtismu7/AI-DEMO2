# Identity Setup Checklist (PingOne + AgentCore credential provider)

Do these steps in order. The PingOne side and the AWS side are interleaved —
the credential provider (Step 4) must be created before you can finish PingOne
configuration (Step 5). The checklist handles the sequencing.

---

## Step 1 — Create the PingOne OAuth application

In PingOne console → **Applications → Applications → +**

| Field | Value |
|---|---|
| Application type | **OIDC Web App** — for both USER_FEDERATION and M2M. Worker type works for M2M-only, but OIDC Web App supports both grant types on the same app, which is safer if requirements change. |
| Name | Something descriptive, e.g. `My Agent - AgentCore` |
| Token endpoint auth method | **`CLIENT_SECRET_POST`** — set this explicitly. Do not leave it as the default. If AgentCore's credential provider uses `CLIENT_SECRET_BASIC` and your app requires `CLIENT_SECRET_POST`, all token requests silently return `401 invalid_client` with no indication of which auth method was actually used. |
| Grant types (USER_FEDERATION) | Enable **Authorization Code** and **Client Credentials** |
| Grant types (M2M only) | Enable **Client Credentials** only |
| Redirect URIs | Leave empty for now — you'll add AgentCore's relay URL in Step 5. (M2M only: skip this column entirely.) |

**Capture:** `client_id`, `client_secret`, PingOne environment ID (`env_id`),
token endpoint (`https://auth.pingone.com/<env_id>/as/token`),
authorization endpoint (`https://auth.pingone.com/<env_id>/as/authorize`),
discovery URL (`https://auth.pingone.com/<env_id>/as/.well-known/openid-configuration`).

---

## Step 2 — Create the resource and scope

In PingOne console → **Applications → Resources → +**

| Field | Value |
|---|---|
| Resource name | A descriptive name, e.g. `my-agent-resource` |
| Audience | **This is what appears as the `aud` claim on tokens.** In PingOne, the audience identifier and resource name default to the same value but are separately editable. Confirm the audience identifier is exactly what your downstream system (gateway, API) will validate against — a mismatch here produces a well-formed token that is silently rejected by the downstream. |
| `sub` mapping | Leave as default — PingOne maps `sub` to User ID automatically. |

Add at least one scope (e.g. `data:read`). The scope name appears in the
`scope` claim on tokens.

**Capture:** audience identifier (≠ resource name if you edited it), scope name(s).

---

## Step 3 — Grant the resource to the application

In PingOne console → **Applications → Applications → [your app] → Resources tab → +**

Add the resource from Step 2. Select the scope(s) the agent will request.

Without this grant, token requests for that resource are rejected even if
everything else is configured correctly.

---

## Step 4 — Create the AgentCore credential provider (AWS)

This is an AWS step, but it must happen before Step 5 because you need
the `callbackUrl` from the response.

```python
response = control.create_oauth2_credential_provider(
    name="my-agent-agentcore",
    credentialProviderVendor="CustomOauth2",   # not PingOneOauth2 — see gotchas #4
    oauth2ProviderConfigInput={
        "customOauth2ProviderConfig": {
            "clientId":                   "<client_id from Step 1>",
            "clientSecret":               "<client_secret from Step 1>",
            "authorizationEndpoint":      "https://auth.pingone.com/<env_id>/as/authorize",
            "tokenEndpoint":              "https://auth.pingone.com/<env_id>/as/token",
            "discoveryUrl":               "https://auth.pingone.com/<env_id>/as/.well-known/openid-configuration",
            "clientAuthenticationMethod": "CLIENT_SECRET_POST",
        }
    },
)
callback_url = response["callbackUrl"]
# Looks like: https://bedrock-agentcore.<region>.amazonaws.com/identities/oauth2/callback/<id>
# This is AgentCore's internal code-exchange relay — NOT your application's callback URL.
# See gotchas #3 for the distinction between these two URLs.
```

**Capture:** `callbackUrl` from the response.

---

## Step 5 — Register AgentCore's callbackUrl in PingOne (USER_FEDERATION only)

> **M2M flows: skip this step entirely.** M2M uses client_credentials — no
> authorization code, no browser redirect, no redirect URI needed.

Back in PingOne console → **Applications → Applications → [your app] → Configuration tab**

Add the `callbackUrl` from Step 4 as a **Redirect URI**.

Without this, PingOne rejects the OAuth redirect with `invalid_redirect_uri`
when the user tries to log in.

---

## Step 6 — Register your own callback URL on the AgentCore workload identity (USER_FEDERATION only)

> **M2M flows: skip this step entirely.**

After your Runtime is deployed, register your own backend's callback URL
(e.g. `https://your-backend.example.com/agentcore/callback`) on the workload
identity AgentCore auto-creates for your Runtime.

**Do not derive the workload identity name from the ARN suffix.** List and
confirm the actual name after first deploy — the suffix format is not guaranteed
(gotcha 19):

```python
# After deploy, list workload identities and find the one for your runtime
resp = control.list_workload_identities()
# Confirm the name, then register
control.update_workload_identity(
    name="<confirmed-workload-identity-name>",
    allowedResourceOauth2ReturnUrls=["https://your-backend.example.com/agentcore/callback"],
)
```

This URL must be **exact** — no query parameters, no wildcards (gotcha 12).
AgentCore validates it as a literal string match.

---

## Completion checklist

### All flows (M2M and USER_FEDERATION)

- [ ] OIDC Web App created with `CLIENT_SECRET_POST` auth method explicitly set
- [ ] `Client Credentials` grant enabled
- [ ] Custom resource created; audience identifier noted and confirmed (not assumed equal to resource name)
- [ ] Scope(s) added to resource
- [ ] Resource grant added to the application
- [ ] AgentCore credential provider created with `CustomOauth2` vendor and `CLIENT_SECRET_POST`
- [ ] `client_id`, `client_secret`, `env_id`, audience identifier, scope name(s) all captured

### USER_FEDERATION only (additional)

- [ ] `Authorization Code` grant enabled on the application
- [ ] AgentCore's `callbackUrl` registered as a Redirect URI in the PingOne app (Step 5)
- [ ] Your own backend's callback URL registered on the workload identity (Step 6, after Runtime deploy)
