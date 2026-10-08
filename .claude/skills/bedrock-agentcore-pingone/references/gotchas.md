# Gotchas — ordered roughly by when you'll hit them

Every item here was confirmed through direct debugging on a real build, not
inferred from documentation alone, unless explicitly marked otherwise.
"Confirmed" means: decoded token, real API response, or SDK source read.
"Inferred" is flagged.

Gotchas 22–31 cover AgentCore packaging, deploy, and runtime behavior.
They apply regardless of which IdP you use — not PingOne-specific.

---

## Setup phase

**1. GA status is often inferred, not directly stated.** AgentCore's docs may
not carry an explicit "Generally Available" banner even once preview caveats
are gone elsewhere. Don't assume either way — check for an explicit statement,
and apply preview-level caution to unexpected errors.

**2. `us-east-2` (Ohio) is a supported region** — confirmed in the regional
availability table as of 2026-08-12. Check current regional coverage before
assuming any specific region works.

**3. Two different "callback URL" concepts exist and get confused constantly.**
This single confusion was the root cause of the first major debugging loop.

- **AgentCore's relay URL** — returned by `CreateOauth2CredentialProvider`
  as `callbackUrl` (looks like
  `https://bedrock-agentcore.<region>.amazonaws.com/identities/oauth2/callback/<id>`).
  Register this in PingOne as a redirect URI. It's AgentCore's internal
  code-exchange endpoint — not your app's callback.
- **Your application's callback URL** — the endpoint on your own backend
  (e.g. `https://your-backend.example.com/agentcore/callback`). This goes in
  `resource_oauth2_return_url` in your agent code and in
  `allowedResourceOauth2ReturnUrls` on the workload identity. AgentCore calls
  this URL (appending `?session_id=<sessionUri>`) after its own internal
  code exchange.

Mixing these up causes AgentCore to redirect the browser back to itself after
login, where it fails silently.

---

## PingOne-side configuration

**4. `PingOneOauth2` vs `CustomOauth2` — use `CustomOauth2` for new builds.**

`PingOneOauth2` is a real, valid vendor name (it appears in the AWS console's
"Included provider" list and works). However, it provides no
`clientAuthenticationMethod` field and silently defaults to
`CLIENT_SECRET_BASIC`. If your PingOne app requires `CLIENT_SECRET_POST` —
which is true for most newly-created 3LO-capable apps — the credential
provider silently returns `401 invalid_client`. Nothing in AgentCore's surface
tells you which auth method was actually sent.

**Use `CustomOauth2` with `clientAuthenticationMethod: "CLIENT_SECRET_POST"`
explicitly set for all new builds.** `PingOneOauth2` is fine only if you have
verified your PingOne app accepts `CLIENT_SECRET_BASIC`.

If you have an existing `PingOneOauth2` provider that's silently failing:
delete it and recreate as `CustomOauth2`. There is no in-place update path for
the vendor type field.

**5. PingOne app type for USER_FEDERATION (3LO): OIDC Web App.** Not Worker,
not AI Agent type. OIDC Web App is the one type that supports Authorization
Code flow for a real human login.

**6. `CLIENT_SECRET_POST` is confirmed working end-to-end for USER_FEDERATION**
— four decoded claims verified: `sub` (human's user ID), `aud` (resource name),
`scope`, correct token shape. If you hit an auth-method error, check what's
actually configured on the PingOne app before switching methods.

**7. Both `Authorization Code` and `Client Credentials` grant types can be
enabled simultaneously on the same PingOne app.** The constraint (if any) is
on the AgentCore credential provider instance choosing which flow to use, not
on the PingOne app being limited to one grant type.

**8. A custom resource is required.** The resource's name becomes the `aud`
claim on tokens minted against it. PingOne maps `sub` to User ID by default.
Add scopes to the resource; they appear in the `scope` claim. Without a
resource grant on the application, token requests for that resource are rejected.

---

## AWS-side setup

**9. `CreateOauth2CredentialProvider`'s response includes a `callbackUrl` field
— register this in PingOne as a redirect URI** before any login attempt, or
PingOne will reject the redirect with `invalid_redirect_uri`.

**10. `x-amzn-*` request headers do not reach agent code.** The SDK filters
them before your `@app.entrypoint` handler runs — confirmed by reading SDK
source (`is_forwardable_header` in `models.py`). This includes
`X-Amzn-Bedrock-AgentCore-Runtime-User-Id`. A custom-prefixed variant
(`X-Amzn-Bedrock-AgentCore-Runtime-Custom-*`) was also tested and did not
reliably arrive. **The reliable path for per-invocation identity context is
the JSON request body** — `request.get("user_id")` inside the entrypoint.

**11. The Workload Access Token (WAT) is opaque, not a JWT.** Confirmed by
direct inspection: ~2000+ characters, zero `.` separators (a JWT has exactly
two). It cannot be decoded for user identity claims. Read it from
`BedrockAgentCoreContext.get_workload_access_token()`. It exists solely as a
bearer credential for calling AgentCore's first-party identity APIs.

**12. `allowedResourceOauth2ReturnUrls` validates with exact string match —
no query parameters, no wildcards.** You cannot embed per-invocation context
in the callback URL itself. Use the pre-registration pattern: the invoking
caller POSTs `{session_id: sessionUri, user_id: ...}` to your backend before
invoking the Runtime, so your callback can look up the user by `sessionUri`
alone. See `architecture-pattern.md`.

**13. `sessionUri` ≠ your Runtime invocation session ID — completely different
values.** When `GetResourceOauth2Token` returns an `authorizationUrl`, it also
returns `sessionUri` (a `urn:ietf:params:oauth:request_uri:...` value generated
internally by AgentCore). AgentCore appends this exact value as
`?session_id=<sessionUri>` to your callback URL. Your pre-registration map must
be keyed on `sessionUri`, not on the `SESSION_ID` header you used when invoking
the Runtime. If you key on the wrong value, the callback lookup always misses.

This was the root cause of the second major blocking issue in the original build.

**14. `@requires_access_token` hides `sessionUri` from your code.** The
decorator calls `IdentityClient.get_token()` internally, which calls
`get_resource_oauth2_token()` and polls for the token — but never surfaces
`sessionUri` to your handler. Without `sessionUri`, you cannot pre-register the
correct key on your backend before yielding the auth URL. **Call
`get_resource_oauth2_token()` on `IdentityClient` directly** for USER_FEDERATION
flows where you need the pre-registration pattern. See `architecture-pattern.md`.

**15. `IdentityClient.get_resource_oauth2_token()` is a synchronous boto3 call.**
Use `asyncio.to_thread()` to call it from async agent code without blocking the
event loop. It is not a coroutine — do not `await` it directly.

---

## IAM

**16. Execution role trust principal is `bedrock-agentcore.amazonaws.com`,**
scoped with `aws:SourceAccount` and `aws:SourceArn` conditions. This is a role,
not an IAM user.

**17. Role names may need to match a specific prefix (e.g. `AmazonBedrockAgentCore`)
for AWS-managed policies' `iam:PassRole` scoping to apply.** If you get an
unexpected `PassRole` denial with an otherwise-correct policy, check the role
name pattern before assuming the policy itself is wrong.

**18. `GetResourceOauth2Token` IAM policy needs both the parent and child ARNs
for the workload identity directory.** The resource list must include:
- `arn:aws:bedrock-agentcore:<region>:<account>:workload-identity-directory/default`
  (the parent — omitting this causes `AccessDenied` even with the child pattern)
- `arn:aws:bedrock-agentcore:<region>:<account>:workload-identity-directory/default/workload-identity/*`
  (the children)

This was confirmed as a blocking `AccessDeniedException` in the original build
after an initial fix addressed only the child pattern.

**19. Scope `WorkloadIdentityAccess` to the specific agent's workload identity**
(named after the runtime, typically `<runtime-name>-<suffix>`) rather than the
entire default directory. Check the actual workload identity name after first
deploy rather than assuming the suffix format.

**20. `CompleteResourceTokenAuth` does not appear to have a meaningful resource-level
ARN to scope down to** — a wildcard resource (`"*"`) may be unavoidable for this
specific action. Verify against current IAM documentation before accepting this,
but don't spend excessive time trying to scope an action that may not support it.

**21. Never reuse a broad, general-purpose deploy/scripting IAM identity inside
an always-on deployed service** that calls `CompleteResourceTokenAuth` on every
user login. Create a dedicated, narrowly-scoped IAM user with exactly the
permissions that service needs. In the original build, a broad deploy identity
was initially used and required a credential rotation after the fact. The correct
permission set for a backend callback service: `bedrock-agentcore:CompleteResourceTokenAuth`
on `"*"`, nothing else.

---

## Deploy / packaging

**22. Two packaging formats: Container (ECR image) and CodeZip (S3-uploaded
zip). Both require linux/arm64** — no x86 option as of 2026-08-12; verify this
hasn't changed before assuming. Zip limits: 250 MB zipped, 750 MB unzipped.
For local multi-arch builds (e.g. targeting a K8s cluster with arm64 nodes),
use `--platform linux/amd64,linux/arm64`.

**23. `BedrockAgentCoreApp` + `@app.entrypoint` auto-registers `/invocations`
(POST) and `/ping` (GET) on port 8080.** No manual FastAPI scaffolding needed
for CodeZip deployments using the SDK wrapper.

**24. When OAuth inbound auth is configured on a Runtime, boto3 cannot invoke
it — use raw HTTPS with manual SigV4 signing.** Plan invocation tooling around
this from the start:

```python
import botocore.auth, botocore.awsrequest, boto3, requests

session     = boto3.Session(region_name=REGION)
credentials = session.get_credentials().get_frozen_credentials()

aws_request = botocore.awsrequest.AWSRequest(   # use AWSRequest, not AWSPreparedRequest
    method="POST", url=url,                     # SigV4Auth needs the .context dict
    headers={"Content-Type": "application/json"},
    data=payload,
)
botocore.auth.SigV4Auth(credentials, "bedrock-agentcore", REGION).add_auth(aws_request)
prepared = aws_request.prepare()
resp = requests.post(url, headers=dict(prepared.headers), data=payload, stream=True)
```

**25. Runtime names must match `[a-zA-Z][a-zA-Z0-9_]{0,47}` — no hyphens.**
`my-agent` is rejected; use `my_agent`.

**26. Runtime invocation session IDs must be at least 33 characters** — short
values are rejected with a validation error.

**27. `list_agent_runtimes` returns results under the key `agentRuntimes`,
not `agentRuntimeSummaries`** — a wrong key assumption silently produces zero
results and looks like "nothing exists" when something does. Try both keys in
your deploy script if you can't confirm from current API reference.

**28. `update_agent_runtime` requires `networkConfiguration` on every call,
even when you are not changing networking.** Include
`{"networkMode": "PUBLIC"}` (or your actual mode) or it will be rejected with
`ValidationException`.

**29. Shell-exported environment variables override `.env` file values loaded
via `os.environ.setdefault`.** If your shell has `AWS_REGION=us-east-1` and
your resources are in `us-east-2`, `list_agent_runtimes` returns empty,
`create_agent_runtime` falls through, and the create fails with a
role-validation error (the execution role also only trusts the correct region).
The whole thing looks like an IAM problem when it's actually a region mismatch.
**Hardcode the region explicitly in deploy and invoke scripts** — don't rely on
environment variable loading order.

---

## Runtime behavior

**30. AgentCore Identity does not write to customer-owned CloudWatch log
groups** — confirmed via permission fix + zero results from
`describe_log_groups` across regions. Don't spend time hunting for
Identity-specific server-side logs there. Runtime execution logs (separate
from Identity) may exist under `/aws/bedrock-agentcore/runtimes/*`.

**31. K8s backends that call AgentCore APIs need AWS credentials explicitly
injected — don't assume the pod inherits them.**

The correct long-term approach is **IRSA (IAM Roles for Service Accounts)** or
EKS pod identity — the pod assumes an IAM role via a service account annotation,
no static keys needed. Use that if your cluster supports it.

If you need a simpler expedient path (e.g. a demo environment): inject static
credentials via a K8s secret and `secretKeyRef` references in the deployment
manifest. Never embed credential values in the manifest itself. This is
acceptable for controlled demo environments; it is not appropriate for
production deployments.

In either case, always inject `AWS_REGION` explicitly alongside credentials —
the SDK default region may not be the region your AgentCore resources are in.

```yaml
# expedient path — K8s secret-based credentials
env:
- name: AWS_REGION
  valueFrom: {secretKeyRef: {name: my-secrets, key: AWS_REGION}}
- name: AWS_ACCESS_KEY_ID
  valueFrom: {secretKeyRef: {name: my-secrets, key: AWS_ACCESS_KEY_ID}}
- name: AWS_SECRET_ACCESS_KEY
  valueFrom: {secretKeyRef: {name: my-secrets, key: AWS_SECRET_ACCESS_KEY}}
```
