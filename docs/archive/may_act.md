# `may_act` Claim Implementation Report

## Purpose

This report explains the `may_act` JWT claim, when to use it, how it differs from related claims such as `act`, and how to implement validation and issuance logic safely in an authorization server, token exchange service, or resource server.

The focus is practical implementation.

---

## Executive Summary

`may_act` is a JWT claim used to express **who is permitted to act on behalf of the token subject** in delegation or token-exchange scenarios.

At a high level:

- `sub` identifies the token subject.
- `may_act` identifies an actor that is allowed to become the acting party for that subject.
- `act` identifies the actor that is actually acting.

A common lifecycle looks like this:

1. A token is issued for a subject with a `may_act` claim.
2. A client or service later presents that token in a token exchange or delegation flow.
3. The authorization server verifies that the requester matches the actor described by `may_act`.
4. If valid, the server issues a new token containing an `act` claim representing the actual actor.

The main implementation rule is simple:

> Treat `may_act` as an authorization constraint on future delegation, not as proof that delegation has already occurred.

---

## What `may_act` Means

`may_act` is a structured JSON object embedded in a JWT. It says that a particular actor is authorized to act for the token subject.

Example:

```json
{
  "iss": "https://auth.example.com",
  "sub": "user-123",
  "aud": "https://api.example.com",
  "scope": "read write",
  "may_act": {
    "client_id": "orders-service",
    "sub": "service-account-orders"
  }
}
```

Interpretation:

- The subject is `user-123`.
- The token says the actor identified by `client_id=orders-service` and optionally `sub=service-account-orders` is allowed to act for that subject.
- This does **not** mean the service is currently acting.
- It means that the service is an approved actor for a later delegation or token exchange.

---

## `may_act` vs `act`

These claims serve different purposes and should not be conflated.

### `may_act`

Use `may_act` when you want to encode **who is allowed** to act for the subject in a later step.

Properties:

- prospective / permission-oriented
- appears in an upstream token before exchange
- used by the authorization server during validation

### `act`

Use `act` when you want to encode **who is actually acting** in the current token.

Properties:

- current / factual
- appears in the issued delegated or exchanged token
- used by downstream APIs for audit and policy decisions

### Comparison

| Claim | Meaning | Timeframe | Typical Validator |
|---|---|---|---|
| `may_act` | actor is allowed to act | future/potential | authorization server during exchange |
| `act` | actor is acting now | current/actual | resource server and downstream services |

---

## Recommended Use Cases

### 1. OAuth 2.0 Token Exchange

A subject token is issued for a user and includes a `may_act` claim naming a backend service that may exchange it for a new token.

### 2. Service-to-service delegation

A frontend obtains a token for a user, and a backend service later exchanges or transforms that token into an internal token, but only if the original token explicitly authorizes that service via `may_act`.

### 3. Controlled impersonation or brokered access

A trusted intermediary is allowed to request tokens on behalf of a subject, but only when the JWT explicitly grants that right.

---

## Data Model

Treat `may_act` as a JSON object with a constrained set of supported identity fields.

Recommended initial supported fields:

- `client_id`: OAuth client identifier
- `sub`: actor subject identifier
- `iss`: optional actor issuer when actor identity is federated or multi-tenant

Example schema:

```json
{
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "client_id": { "type": "string" },
    "sub": { "type": "string" },
    "iss": { "type": "string" }
  }
}
```

Implementation guidance:

- Require at least one stable actor identifier.
- Prefer `client_id` when the actor is a confidential OAuth client.
- Use `sub` when the actor is a service principal or user-like principal.
- Use both when you need stronger binding.

Recommended minimum rule:

> Reject `may_act` if it is not an object or if it contains none of the identifiers your platform supports.

---

## Issuance Rules

Only mint `may_act` when delegation is intentionally allowed.

### When to issue it

Issue `may_act` if:

- the requesting client is entitled to nominate an approved downstream actor
- a policy or user consent allows that actor to act for the subject
- the actor is known and strongly identified

### When not to issue it

Do not issue `may_act` if:

- the actor identity is ambiguous
- the client has not been authorized for delegation
- the policy only supports direct access and not delegation
- the claim would widen access without clear business need

### Example issuance policy

A policy engine might decide:

- client `portal-web` may request tokens for user `user-123`
- only backend `orders-service` may exchange those tokens
- therefore the token includes:

```json
"may_act": {
  "client_id": "orders-service"
}
```

---

## Validation Rules During Token Exchange

When a requester presents a token containing `may_act`, validate it against the requester’s authenticated identity.

### Required checks

1. **JWT integrity**
   - signature valid
   - issuer trusted
   - token not expired
   - audience/type appropriate for exchange

2. **Claim shape**
   - `may_act` exists when delegation is required
   - `may_act` is a JSON object
   - supported fields are well-formed

3. **Actor identity match**
   - authenticated client identity matches `may_act.client_id`, if present
   - authenticated actor subject matches `may_act.sub`, if present
   - issuer/tenant matches `may_act.iss`, if present

4. **Policy constraints**
   - client is still enabled for token exchange
   - requested scopes/audience are allowed
   - exchange type is permitted

5. **Optional context binding**
   - tenant, environment, or trust domain matches
   - proof-of-possession constraints remain valid if applicable

### Matching semantics

Use AND semantics for fields that are present.

Example:

```json
"may_act": {
  "client_id": "orders-service",
  "sub": "svc-orders"
}
```

Recommended behavior:

- requester must match `client_id=orders-service`
- requester must also match `sub=svc-orders`

Do not treat multiple identifiers as alternatives unless you explicitly design the format that way.

---

## Token Issued After Successful Exchange

If exchange succeeds, the new token should usually contain an `act` claim.

Example output token:

```json
{
  "iss": "https://auth.example.com",
  "sub": "user-123",
  "aud": "https://internal-api.example.com",
  "scope": "orders.read",
  "act": {
    "client_id": "orders-service",
    "sub": "svc-orders"
  }
}
```

Recommended behavior:

- do not copy `may_act` forward unless there is a concrete need for chained delegation
- add `act` to record who is now acting
- narrow scopes and audience where possible

---

## Chained Delegation

If your platform supports multiple delegation hops, define that explicitly.

Options:

### Option A: No chaining

Simplest and safest.

- incoming token may contain `may_act`
- exchanged token contains `act`
- no further delegation permitted unless a new policy evaluation adds a fresh `may_act`

Recommended default.

### Option B: Controlled chaining

Allow a downstream actor to delegate again, but only with explicit policy.

Rules:

- preserve prior `act` for audit in a separate internal structure or event log
- never automatically transform prior `may_act` into a new downstream `may_act`
- require explicit re-issuance by policy

---

## Security Risks and Mitigations

### Risk 1: Overbroad delegation

A token names an actor too generically.

Bad:

```json
"may_act": { "client_id": "*" }
```

Mitigation:

- require exact identifiers
- disallow wildcards
- require confidential clients or strong workload identity

### Risk 2: Confusing `may_act` with `act`

A resource server mistakenly believes the actor is currently acting because `may_act` is present.

Mitigation:

- document semantics clearly
- resource servers should rely on `act`, not `may_act`, for current actor context

### Risk 3: Weak actor binding

Only checking one mutable or weak identifier.

Mitigation:

- prefer strong client authentication
- bind on `client_id` plus `sub` where available
- require mutual TLS, private_key_jwt, or workload identity for high-trust flows

### Risk 4: Claim injection by untrusted issuers

An upstream token from an untrusted issuer contains a permissive `may_act`.

Mitigation:

- trust only approved issuers
- validate signing keys and token profiles
- optionally normalize and re-issue internal subject tokens before exchange

### Risk 5: Unbounded audience escalation

A permitted actor exchanges a user token for a token with broader audiences/scopes than intended.

Mitigation:

- enforce scope downscoping
- restrict target audiences by policy
- reject privileged scopes unless explicitly allowed

---

## Recommended Implementation Architecture

### Authorization Server / Token Service

Responsibilities:

- issue tokens with `may_act` when policy allows
- validate `may_act` during exchange
- issue output tokens with `act`
- write audit events

### Resource Server

Responsibilities:

- consume `sub` as subject
- consume `act` as current actor when present
- ignore `may_act` for current authorization decisions unless you have a very specific reason

### Policy Engine

Responsibilities:

- define which requesters may receive `may_act`
- define which actor identities are eligible
- constrain scopes, audiences, and token lifetime

---

## Reference Validation Algorithm

```text
function validateMayAct(subjectToken, authenticatedRequester):
    verifyJwt(subjectToken)

    mayAct = subjectToken.claims["may_act"]
    if mayAct is missing:
        return error("delegation_not_permitted")

    if mayAct is not an object:
        return error("invalid_may_act")

    supported = false

    if "client_id" in mayAct:
        supported = true
        if authenticatedRequester.client_id != mayAct.client_id:
            return error("actor_mismatch")

    if "sub" in mayAct:
        supported = true
        if authenticatedRequester.subject != mayAct.sub:
            return error("actor_mismatch")

    if "iss" in mayAct:
        supported = true
        if authenticatedRequester.issuer != mayAct.iss:
            return error("actor_mismatch")

    if not supported:
        return error("unsupported_may_act")

    if not policyAllowsExchange(subjectToken, authenticatedRequester):
        return error("exchange_not_allowed")

    return success
```

This should be followed by issuance of a new token that includes `act`.

---

## Example Pseudocode: Issuance

```text
function mintSubjectToken(user, requestingClient, allowedActor):
    claims = {
        "sub": user.id,
        "client_id": requestingClient.id,
        "scope": "orders.read"
    }

    if allowedActor is not null:
        claims["may_act"] = {
            "client_id": allowedActor.client_id,
            "sub": allowedActor.subject
        }

    return signJwt(claims)
```

## Example Pseudocode: Token Exchange

```text
function exchangeToken(subjectToken, requester):
    validateMayAct(subjectToken, requester)

    newClaims = {
        "sub": subjectToken.sub,
        "aud": "https://internal-api.example.com",
        "scope": "orders.read",
        "act": {
            "client_id": requester.client_id,
            "sub": requester.subject
        }
    }

    return signJwt(newClaims)
```

---

## Suggested Error Model

Use stable internal error categories even if your wire protocol maps them differently.

Recommended internal errors:

- `invalid_may_act`
- `unsupported_may_act`
- `actor_mismatch`
- `delegation_not_permitted`
- `exchange_not_allowed`
- `audience_not_allowed`
- `scope_not_allowed`

Recommended logging fields:

- token issuer
- token subject
- presented `may_act`
- authenticated requester client id
- authenticated requester subject
- target audience
- target scopes
- decision reason

Do not log raw tokens.

---

## Interoperability Guidance

Because JWT ecosystems vary, keep your implementation conservative.

Recommendations:

- accept only object-valued `may_act`
- define exactly which subfields your platform supports
- document matching semantics precisely
- do not infer identities from unrelated claims
- avoid optional behavior that changes across tenants or environments without explicit configuration

A good compatibility stance is:

> Be strict in what you issue and clear in what you validate.

---

## Testing Matrix

At minimum, cover these cases.

### Happy paths

1. `may_act.client_id` matches authenticated client
2. `may_act.client_id` and `may_act.sub` both match
3. successful exchange results in `act` claim in output token

### Failure cases

4. missing `may_act`
5. `may_act` is a string instead of object
6. mismatched `client_id`
7. mismatched `sub`
8. unsupported fields only
9. expired token
10. untrusted issuer
11. audience escalation attempt
12. privileged scope escalation attempt

### Edge cases

13. extra unknown fields in `may_act`
14. null-valued fields
15. actor authenticated as client only, but `sub` also required
16. chained exchange attempt without explicit policy

---

## Recommended Defaults

For a first implementation, use these defaults:

- support only object-valued `may_act`
- support `client_id`, `sub`, and optional `iss`
- require exact match for every present supported field
- reject if no supported fields are present
- only evaluate `may_act` in token exchange/delegation endpoints
- emit `act` in the resulting delegated token
- do not preserve `may_act` by default
- disallow chaining by default
- downscope output tokens

These defaults are simple, auditable, and secure enough for most initial deployments.

---

## Practical Implementation Notes

### Serialization

Store `may_act` as a nested JSON object in the JWT claims set. Do not stringify the object before embedding it.

Correct:

```json
"may_act": {
  "client_id": "orders-service"
}
```

Incorrect:

```json
"may_act": "{\"client_id\":\"orders-service\"}"
```

### Validation order

Validate in this order:

1. token cryptographic validity
2. token issuer and general claim checks
3. `may_act` shape
4. actor match
5. policy checks
6. output token construction

This makes failures easier to reason about and log.

### Auditing

Record both:

- the original subject token identity context
- the final acting identity in the new token

This is important for forensic review.

---

## Implementation Checklist

- [ ] Define supported `may_act` subfields
- [ ] Add claim schema validation
- [ ] Add actor-to-claim matching logic
- [ ] Add policy hook for exchange authorization
- [ ] Emit `act` on successful delegated tokens
- [ ] Downscope audience and scopes
- [ ] Add audit logging
- [ ] Add negative and edge-case tests
- [ ] Document semantics for platform consumers

---

## Bottom Line

`may_act` is a forward-looking authorization claim.

Use it to say:

> this actor is allowed to act for this subject later

Do not use it to mean:

> this actor is acting now

For implementation:

- issue it narrowly
- validate it strictly
- convert successful delegation into an `act` claim
- keep scopes and audiences constrained
- log every decision path clearly

That pattern gives you a clean separation between delegated permission and active delegation.
