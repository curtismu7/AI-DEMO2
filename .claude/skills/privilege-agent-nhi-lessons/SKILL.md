---
name: privilege-agent-nhi-lessons
description: Set up and troubleshoot non-human identities (NHI) for AI agents in PingOne Privilege — agent access keys in the Agent Registry, scopes, custodians, per-agent grants, per-key guardrails, workload-identity (NonHumanIdentity) federation, key rotation and expiry, and the 401/403/429 refusals an agent hits. Use whenever someone is registering an AI agent / service / MCP or A2A caller in Privilege, gets a refusal with an agent key, asks how to give an agent its own identity without a static secret, or asks about rotating or revoking an agent key. Use it even if they never say "NHI".
---

# AI-agent NHI in PingOne Privilege — setup and lessons learned

Focused on agent identities only. For the full Privilege field guide (aggregate doors, tags, approvals,
gateway quirks) see `privilege-nhi-setup`.

What we built and what bit us (Oct 2026, Ping-hosted gateway). Claims are tagged:
**[verified]** reproduced live; **[swagger]** read from the spec only, treat as a lead.

Work out which layer someone is stuck on before suggesting anything:
**(1) identity** (key or workload identity), **(2) grant** (what it may reach),
**(3) guardrail** (what screens its traffic). Most "it doesn't work" reports are a mismatch
between 1 and 2, and the gateway's error text for that is deliberately thin.

## The model

An NHI is an **agent access key**: one credential that *is* the agent's whole identity. Scopes,
allowed models, rate limits, budget, expiry, guardrail and reachable apps all hang off it. No
sign-in, no token exchange: the agent sends `Authorization: Bearer <key>` on every call. [verified]

Each key has a **custodian**, the human the agent acts as. Policy is issued to the custodian, the
gateway log names the custodian, and if the custodian's account goes inactive the key stops
working. Choose someone who will stay and who should answer for the agent. [verified]

The alternative is a `NonHumanIdentity` that proves itself with a platform token (see
"Workload identity") so no static secret exists at all. [verified: objects read live]

## Setup, in console order

**Agent Privilege → Agent Registry → Add Agent**, four steps.

1. **Identity & Access** — name, custodian, expiry, scopes.
   - **The name is permanent.** Rename = delete + recreate, and the key value changes.
   - Scopes: `llm` (`/llm/<provider>/v1/...`), `mcp` (`/<app>/mcp`), `a2a` (`/<app>/a2a/...`).
     Grant only what the agent uses; a three-scope key is one secret reaching models, tools and agents.
2. **Gateway & Apps**
   - `llm`: one provider per key (two providers = two keys), allowed models, RPM, TPM, budget.
     Creating an `llm` key **requires the real upstream provider key** (`Spec.RealKey`); Privilege
     injects it server-side so the agent only holds the virtual key. [verified]
   - `mcp` / `a2a`: *select the specific apps*. Selecting them **is** the grant; saving auto-creates
     a policy issued to the custodian and tied to this key. For MCP apps the grant can list tools
     (others are hidden and refused). [verified]
3. **Runtime Protection** — the per-key guardrail.
4. **Review & Create** — shows the key once with calling code. Copy it now; it is a secret.

Smoke test (swap the path for `mcp`/`llm`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://<gateway-host>/<app>/a2a/jsonrpc" \
  -H "Authorization: Bearer $AGENT_KEY" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","messageId":"m1","parts":[{"kind":"text","text":"Hello"}]}}}'
```

Policy/app changes take **~4 minutes** to reach the gateway; don't conclude failure sooner. A
brand-new key was picked up immediately. [verified]

## Reading an agent's refusal

| Caller sees | Cause | Fix |
|---|---|---|
| `401`, or `401 invalid virtual key` on `/llm/...` | Gateway doesn't know the key: typo, revoked, expired, deleted | Check it exists, not `Revoked`, not past `NotAfter` |
| `403 key not scoped for mcp access` | Missing scope — the only self-describing refusal | Add the scope |
| bare `403 Forbidden` | App not selected for this key, **or** the remote agent's Auth Mode can't be met by a key | Read the gateway log: `policy denied` = missing grant; `requires token-pass` = auth mode |
| `403 model "x" not allowed for this key` | Not on the model allowlist | Add it or use the right key |
| `403 wrong_provider` | Key belongs to a different provider | Use the matching key |
| `429 tokens_rate_limit_exceeded` + `retry-after` | RPM/TPM/budget cap hit (enforced natively; a 75-request burst gave 60×200 then 15×429) | Wait or raise the cap |
| `400 content_blocked`, or JSON-RPC `-32600 request blocked by security policy` | The key's guardrail blocked the text | Working as designed; check the key's AI Guard events |

The bare `403` is only explained in the **gateway log** (`/var/log/procyon/cyonproxy.log`, rotates
every few hours — grep the newest rotated file too).

**Auth Mode trap:** a remote agent set to *Pass Agent Token* refuses key callers, because a key
carries no workload assertion to forward. Use *Static Token* for key callers. We fixed our A2A
chain's middle agent this way. [verified]

## Guardrail per agent

- AI Guard belongs to the **key**, not the app. It is the *only* screen on agent-to-agent calls;
  a signed-in person calling the same agent is not screened. [verified]
- **Defaults mostly alert, they don't block.** A jailbreak and an impersonation both reached the
  remote agent with only a log alert. Raise thresholds to sanitize/block on purpose.
- We put one external ML sidecar (`http://localhost:8086/inspect`, timeout 1000, Fail Closed off,
  Block Agreement **"Off — ML Blocks Alone"**) on all 10 keys. Block Agreement off is the only
  provable mode (the built-ins must otherwise agree). One older key already had `inspection` set —
  check, don't assume. [verified]
- **Expired keys are edit-locked on step 1.** The wizard won't continue until you bump the expiry,
  so editing an expired key *is* renewing it. [verified]
- A console outage can silently eat a Save. Confirm on the key's AI Guard tab ("1 / 1 Active").

## Lifecycle: rotation, revocation, expiry (where we lost the most time)

All [verified] 2026-10-14:

- **No rotate endpoint.** `VirtualKey` is server-generated and **immutable**: a PUT with a new one
  returns 200 and ignores it. `RealKey` is never returned by GET (empty string).
- A PUT of the object exactly as read returns 200 and **keeps** the stored real key.
- **Revoke (`Revoked: true`) is the only non-destructive kill.**
- Rotation = delete + recreate. An `llm` key can't be recreated without the real provider key, so
  **never delete one before you have it in hand.**
- Put every `NotAfter` on a calendar. We found one expired and unused, and two due within weeks.
- **Snapshot the full Spec to a `chmod 600` file before any delete.** The list API returns *all*
  Spec fields (CustomUpstream, AIGuardConfig, LLMRules, WorkloadIdentity…); our first snapshot
  printed only 14 and hid the rest.

**The incident:** a rotate script deleted an `llm`-scoped key, then tried to read its Spec from the
list it had just removed it from. The recreate failed and the key was gone ~10 minutes. We rebuilt
it from a sibling key's guardrail and limits, but the original budget/RPM/TPM were lost.

**Safe order:** snapshot → create a *temp-named* key from the snapshot → verify it (200, guardrail
copied, gateway picks it up immediately) → real swap. We proved the recipe on temp keys first.

The real swap has a catch: grants follow the key's *name*, and we did not test whether two keys can
share a name at once. So either (a) keep the new name and recreate its grants, or (b) delete the old
key and immediately recreate under the original name from the snapshot — keeps the grants, brief
outage, new VirtualKey. Either way: repoint consumers, confirm the old value returns 401, revoke
before you delete.

Find where a key lives by sha256-prefix match against cluster secrets and `.env` files, never by
printing it. After rotating, remember a key can sit in several unlinked places (we found one in
three).

## Secrets hygiene

- The console key object returns `VirtualKey` **unredacted**, and the key is written in full to the
  gateway log on model calls and to the audit feed whenever an agent is saved. Restrict who reads both.
- Never paste keys into a chat or transcript. We later audited our own transcripts for leaked `sk-`
  strings and had to rotate three keys.
- Keep working copies in `chmod 600` files and delete them afterwards.

## Automating agent keys (console REST)

Auth is covered by the `privilege-console-api` skill. Agent-specific points:

- **Key PUT quirk:** only `/v1/agentaccesskeys/default/{name}` works (bare name, UUID, base64 id and
  collection PUT all return 401). Apps work without the namespace. [verified]
- **A grant is a `pacpolicys` rule:** `Attributes.Map.agentaccesskey` = base64(`tenant@@@default@@@<keyname>`)
  and `ObjectRef` = base64(`tenant@@@default@@@<app>`). One app per rule — arrays are a 400. [verified]
- **Safety classifiers block** writing a key's VirtualKey, patching k8s secrets/`.env` with keys,
  and creating grant policies, even when told to. Expect to hand those steps to the user or get
  explicit, specific approval.
- The local console accepts *any* credential scheme (the desktop agent injects device identity), so
  "it worked" there proves nothing about the key/secret you used.

## Sensor identity in Docker: crash-loop after a restart

A Docker-hosted sensor (a `NonHumanIdentity` whose credential is a signing key the sensor makes
itself) can loop forever with:

```text
open /etc/procyon/nodesensor-signing.pem: read-only file system
```

The key file *is* the identity: the sensor writes it on first start, and the identity in the console
pins that key's ID. Two separate failures hide behind the one symptom [verified 2026-10-01, OrbStack]:

1. **Key directory mounted read-only.** `docker inspect <sensor> --format '{{.HostConfig.Binds}}'`
   showed `/etc/procyon:/etc/procyon:ro`. The sensor must write there on start, so every start
   fails and `--restart always` keeps it looping (it can look alive in a quick `docker ps` unless
   you read the status column). Same flags with a writable mount created the key; with `:ro` it
   failed identically. Fix: recreate the container with `/etc/procyon` writable (only `/sys` and
   `/var/lib/docker/containers` stay `:ro`).
2. **A new key means a new identity.** Once it runs, reports fail `Unauthenticated` if the key
   file was lost, because the console still pins the old key ID. Fix: print the new key set with
   the sensor's `-mint-jwks` against the same directory and paste it into the identity (Paste
   Keys). Issuer, subject and audience do not change and no restart is needed.

**Why it comes back after a restart:** on OrbStack, `/etc/procyon` is a path inside the VM whose
writable layer sits on a tmpfs, so the key file lived in memory and was lost when the VM restarted.
Put the key on a **named Docker volume** (we used `procyon-nodesensor-key` mounted at
`/etc/procyon`, copying the existing key in first so the key ID does not change). The volume
survives on disk, but it is lost if someone runs `docker volume prune` while no sensor container
exists. We never tested a full restart after the move.

When someone reports "worked, then broke after Docker restarted or the laptop rebooted", do not
assume it is the same as ours: run the `docker inspect` line first. We only verified OrbStack;
Docker Desktop bind mounts may behave differently [unverified]. The sensor is usually not in
compose, so nothing in the repo shows its mounts.

## Workload identity (secretless NHI)

A `NonHumanIdentity` describes an **external token issuer** an agent key can be authenticated by, instead of a static key. Schema and live
objects read 2026-10-21 [verified]; token acceptance per issuer not re-exercised here.

CRUD at `/api/{tenant}/v1/nonhumanidentities`. Spec: `Description`, `Enabled` ("the only kill
switch"), `Federation`, `Scopes` (`llm`/`mcp`/`a2a`), `SubjectBinding`, `UserClaim` (dotted path to
the end user, default `sub`), `NotAfter` (empty = no expiry).

| `Federation` field | Meaning |
|---|---|
| `Issuer` | expected `iss`, exact match |
| `Audience` | required `aud`. **Mandatory** — an unbound token is replayable elsewhere |
| `Subject` / `AllowAnySubject` | pin one `sub`, or explicitly accept any (avoid unless the issuer is already tightly scoped) |
| `JwksURI` | gateway fetches and refreshes keys; preferred over pinned `JWKS` (public keys only) |
| `MaxTokenLifetimeSec` | rejects tokens whose `exp - iat` is longer (0 = default 3600); needed because self-signing workloads choose their own `exp` |
| `RequiredClaims` | extra claims that must match exactly — for composite `sub`s (GitHub Actions: repository, workflow, actor) |
| `Platform` | UI hint only (`kubernetes`, `docker`, `github_actions`, `spiffe`, `oidc`); never used for verification |

Our tenant has 5, all enabled: Kubernetes (cluster-local issuer, and EKS OIDC → the pod's service
account), Docker, and one PingFederate-issued test identity bound to a single door with `mcp` scope
only and a short `NotAfter`.

Lessons:
- The platform's own token (a k8s service-account JWT) *is* the credential, so there is no key to
  leak. Audiences are generated (`priv-nhi-<random>`); copy the one the console issues.
- For an agent: issuer = your IdP, audience bound to the specific door, minimal scope, short expiry.
- An agent key can carry its own `WorkloadIdentity` in place of a VirtualKey, **or** name an NHI as its
  custodian and let the NHI supply the federation — never both (the API refuses). See "Wiring an agent
  NHI end to end" below: an NHI with no key behind it authenticates nobody.
- `PolicyRule.RequiredClaims` in `pacpolicys` gates a rule on claims in the *presented* token. It is
  native claim gating, **not Cedar**. Snapshot 2026-10-20: 0 of 28 rules used it.
- Log lines: `mcpgw: workload token accepted for key <k> issuer=… subject=…` /
  `mcpgw: workload token rejected: <reason>`. A key caller still can't satisfy *Pass Agent Token*;
  a presented workload assertion is what that mode forwards.
- In the Ping stack only PingFederate issues ID-JAG/DPoP or consumes external issuers; PingOne is
  plain OIDC. SPIFFE → PingFederate is verified; SPIFFE straight to the gateway is untested.

## Wiring an agent NHI end to end (found 2026-10-21; gateway acceptance still NOT proven)

An NHI is the identity a key acts as. It does **not** authenticate callers by itself. The pieces,
and what each one told us [verified unless noted]:

1. **NHI** (`/v1/nonhumanidentities`): issuer, pinned subject, door-bound audience, scopes, expiry.
2. **Grant** (`pacpolicys`): put the NHI in `IssuedTo` as `{RefKind: NonHumanIdentity, RefID:
   base64("<tenant>@@@default@@@<name>")}` and give the rule the app and tool list. Existing policies
   use this shape for the sensor NHIs.
3. **An agent key whose `CustodianRef` is the NHI.** The gateway log for an NHI with no key says
   `non-human identity <n> updated, rebuilding 0 key(s)` — that "0" is the tell that nothing can
   authenticate as it. Creating the key, the API refused two mistakes with clear messages:
   - `Spec.WorkloadIdentity and a NonHumanIdentity Spec.CustodianRef are mutually exclusive` —
     leave the key's own `WorkloadIdentity` empty; the NHI supplies the federation.
   - `Spec.CustodianRef and Spec.UserRef name different principals` — clear `UserRef` if you
     cloned a key that has a human custodian. No `VirtualKey` or `RealKey` is needed for `mcp`-only.
   Success shows as `llmgw: upserted workload key <key> issuer=… subject=…` on every gateway node.
4. **The issuer must be able to mint the token.** On PingFederate, a plain client-credentials
   request failed twice before it worked:
   - `invalid_target … did not match any access token manager` — PF only accepts a `resource` value
     that is listed on a token manager. Our default manager issued opaque reference tokens
     (2-hour lifetime), which can never satisfy an NHI that needs a JWT, audience and lifetime cap.
   - Fix without touching shared managers: **add** a JWT token manager cloned from an existing JWT
     one (audience claim = the door URL, `resourceUris` = the door URL, short lifetime) and copy that
     manager's CLIENT_CREDENTIALS mapping to it. Token manager "Token Lifetime" is in minutes.
   Check the minted token's `iss`, `sub`, `aud` and `exp - iat` against the NHI before blaming Privilege.

**Open (a question for Ping):** with all of the above in place and the token claims matching, the
token was rejected on both the MCP door (`401 Bearer token required`) and the LLM route (`401
invalid virtual key`), and the gateway logged **no** `workload token accepted/rejected` line for
either — the check was never reached. We could not tell whether the deployed `privilege-aigw` image
evaluates workload tokens on these routes, whether the token must be presented differently, or
whether rejections log below info. Neither the container stdout nor `cyonproxy.log` records
per-request lines. Do not promise a customer that workload-token auth works on a door until this is
answered. `Pass Agent Token` (forwarding a caller's token to a remote agent) is a separate mode.

## When someone is stuck: triage order

1. What exactly does the caller see (status + body)? Map it with the refusal table.
2. Is the key alive: exists, not `Revoked`, not past `NotAfter`, custodian still active?
3. Right scope, right provider, model on the allowlist?
4. Is the target app *selected* on the key (that's the grant)? Did you wait ~4 minutes?
5. For A2A: what is the remote agent's Auth Mode? Key callers need Static Token.
6. Read the gateway log for `policy denied`, `requires token-pass`, `workload token rejected`. For an NHI caller, also look for `rebuilding 0 key(s)` (no key behind the NHI) and `upserted workload key`.
7. Only then suspect the guardrail (check the key's AI Guard events for a block).

Related: `privilege-console-api` (REST + auth); in the repo `privilege/GATEWAY-SETTING-UP-A-CALLING-AGENT.md`,
`privilege/WORKLOAD-IDENTITY-AGENT-CALLERS.md`, `privilege/AGENT-REGISTRY-SIDECAR-ROLLOUT.md`.
