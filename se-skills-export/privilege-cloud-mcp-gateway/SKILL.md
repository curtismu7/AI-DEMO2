---
name: privilege-cloud-mcp-gateway
description: >-
  Durable troubleshooting methodology for integrating an app with a PingOne
  Privilege Cloud MCP gateway (a proxy that fronts your own backend MCP
  server, validates PingOne tokens, and enforces per-tool access policy).
  Use when setting up or debugging a Privilege gateway integration. This
  vendor API is young and its specifics (ports, binary behavior) have
  changed under active projects before — treat every concrete number here
  as something to verify live against your own deployment, not a fact to
  trust from documentation, including this one.
---

# Privilege Cloud MCP gateway — troubleshooting methodology

Distilled from one project's integration experience. The Privilege MCP
gateway feature is new (GA'd with no configuration docs at the time this was
written) and its proxy binary has already changed once mid-project, flipping
which port meant what. **Every specific fact below (ports, header names,
error strings) should be re-verified by probing your own deployment before
you rely on it** — that habit matters more than any individual number here.

## Architecture

```
Your app (MCP client) → Privilege Gateway (MCP server, the security boundary)
                              ↓
                       Your backend MCP server
```

Your app never talks to your backend MCP server directly in this topology —
the gateway validates the caller's PingOne token, applies per-tool access
policy, then proxies allowed calls through. Your backend MCP server only
needs to trust the gateway (commonly via mTLS or a static token), not
PingOne tokens directly.

## Core methodology: probe, don't read

The single highest-value lesson: **settle every "what port / what header /
what response shape" question by hitting your own live deployment, never by
trusting a vendor SE deck, a reference architecture diagram, or a doc
(including this file) written against a binary version you haven't
confirmed you're running.** This project's proxy binary swapped mid-project
and several port assignments meant the *opposite* thing on the new build —
a diagram or doc lag of even a few weeks was actively misleading.

Concretely, before touching the console:

```bash
curl -i -X POST http://<gateway-host>:<candidate-port>/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

The **positive signal you found the right front-door port** is a `401`
response that carries a `www-authenticate` header (commonly shaped like
`Bearer realm="MCP OAuth Server", authorization_uri="..."`). A bare `401`
with no such header, or a generic body like `Bearer Token not found.`,
proves nothing on its own — some gateway builds return that same generic
401 from *any* port, or even before evaluating which backend/host you asked
for. Don't stop investigating on the first 401 you see; check for the
header.

Also worth checking early: whether the gateway's `.well-known` OAuth
discovery documents (`/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource`) are reachable *without* a token.
Per OAuth discovery spec they must be public; a build that 401s them too is
non-compliant and a real integration gap, not something to keep debugging
as a config error on your end.

## Enrollment token: env-file gotcha

If your proxy needs a one-time enrollment JWT on first boot, delivered via
an env-file mechanism (e.g. Docker Compose `env_file:`), the file's content
matters more than it looks:

```bash
# CORRECT — the ENV_PROXY_TOKEN= prefix is required
printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...' > proxy-token.env
```

Writing just the bare JWT with no `KEY=` prefix produces a file the loader
parses as one giant (wrong) variable name with an empty value — the proxy
then starts with no token at all, and the failure mode looks like "token
didn't work" rather than "file was malformed."

After a successful first enrollment, the durable credential is typically an
mTLS cert pair issued at that time, persisted in a volume — not the
original JWT. Don't diagnose "expired token" from the JWT's `exp` claim
once the container has enrolled and is running; check whether the
container/volume state is intact first. A fresh token is usually only
needed for: first enrollment, a deleted state volume, or enrolling into a
different cluster/host — not for routine restarts.

## Host-based routing (self-hosted/agentless frontends)

If you're running your own reverse proxy (nginx/ingress) in front of the
gateway rather than using its hosted cloud frontend, the gateway commonly
matches the inbound `Host` header against an exact, vendor-assigned
"frontend name" for your registered application — not against whatever
friendly hostname you want to use publicly. That assigned name is often
console-read-only. The fix is a `Host`-rewrite at your reverse proxy (one
mapping per registered app), not trying to change the assigned name. A
mismatch here typically presents as an empty `200` with a generic
"domain/route not found" body — easy to mistake for a dead backend when
it's actually a routing miss one layer up.

## Where to actually look when it's broken

If the gateway exposes its own log file inside the container, prefer
tailing the log delta around a failing request over trusting the HTTP
response body — some gateway builds return the same generic error text
(e.g. a signature-validation-sounding message) for multiple unrelated root
causes (missing token, key-id mismatch, no route). The response body can
actively misdirect toward a fix (like reissuing a certificate) that changes
nothing. The log is more likely to name the actual internal check that
failed.

## Before proposing "make the vendor's token work" fixes

If your PingOne (or other IdP) tokens are rejected at the gateway with a
key-id/signature-shaped error, resist the urge to try every token
variant (worker, user, self-signed) as the next debugging step — if the
gateway is validating against a fixed, vendor-controlled trust anchor
(e.g. an internal PKI key it fetches itself) rather than your IdP's JWKS,
no token shape fixes that; you need the vendor-side inbound-trust
configuration (an IdP/issuer registration object, if the platform exposes
one) rather than a different bearer token. Confirm which regime you're in
before spending days iterating on token contents.

## Summary checklist for a new integration

1. Confirm your binary/build version explicitly — don't assume last
   month's port table still applies.
2. Probe for the front-door port with a tokenless request; require a
   `www-authenticate` header as proof, not just any 401.
3. Check `.well-known` discovery documents are public.
4. If using an enrollment-token env file, verify the `KEY=` prefix is
   present, not just the raw token.
5. For self-hosted/agentless frontends, read the exact registered frontend
   name from the platform's API (not the console UI, which can lag or
   simplify what it displays) and route by rewriting `Host` to that value.
6. Diagnose from the gateway's own logs, not the HTTP response body, once
   past the front-door check.
7. Before debugging token contents, confirm whether inbound trust is
   IdP-federated or fixed to a vendor-internal key — that answer decides
   whether a different token can ever help.
