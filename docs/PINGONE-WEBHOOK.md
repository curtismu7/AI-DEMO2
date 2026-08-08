# PingOne webhook to New Relic

Two things must both be true before `/monitoring/pingone-events` shows anything.

## 1. The shared secret

`demo_api_server/routes/webhookPingOne.js` verifies an HMAC-SHA256 over the
raw request body against the `x-p1-signature` header (`_hmacOk()`, lines
10-23). When `PINGONE_WEBHOOK_SECRET` is unset, `_hmacOk()` returns false
immediately (line 12), and the route handler responds 401
`{"error":"invalid_signature"}` before any event handling — mapping,
storage, or forwarding to New Relic (lines 39-41 short-circuit before lines
42-62 run).

Note: the JSON body is still parsed before that check runs. `server.js`
mounts a route-specific `express.json()` on `/webhook` with a `verify`
callback that captures the raw bytes into `req.rawBody` (server.js
lines 503-505) — that parsing happens for every request regardless of the
HMAC outcome. What the missing secret skips is the application-level event
handling in the route, not JSON parsing itself.

Set it in `demo_api_server/.env`:

    PINGONE_WEBHOOK_SECRET=<64 hex chars>

Generate with:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

The same value goes in the PingOne webhook subscription config.

## 2. Reachability

The endpoint is `POST /webhook/pingone` on the BFF. Locally that is
`https://api.ping.demo:3001/webhook/pingone` — a hostname that resolves only
on your machine. PingOne runs in the cloud and cannot route to it, so no
amount of secret configuration will produce events locally without a
tunnel.

Options:

- **Public tunnel** (ngrok, Cloudflare Tunnel) pointed at
  `api.ping.demo:3001`, then register the tunnel URL as the webhook target.
- **SE AWS deployment** — `ai-demo.ping-devops.com` is already
  internet-facing; point the subscription there instead.

## Verifying

With the secret set and the BFF restarted so it picks up the new env var, a
correctly signed request should be accepted:

    BODY='{"type":"AUTHENTICATION","result":{"status":"SUCCESS"}}'
    SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PINGONE_WEBHOOK_SECRET" -hex | awk '{print $2}')
    curl -sk -X POST https://api.ping.demo:3001/webhook/pingone \
      -H 'Content-Type: application/json' \
      -H "x-p1-signature: $SIG" \
      -d "$BODY"

Expected: `{"received":true,"eventId":"<id>"}` and the event appears at
`/monitoring/pingone-events`. An unsigned request still returns
`{"error":"invalid_signature"}` — that is the guard working, not a failure.

This snippet has **not** been run against a live server as part of writing
this runbook — the secret was never set in any running environment, so the
40x-to-200 transition described above is not empirically confirmed here. It
follows directly from reading `_hmacOk()` and the route handler, but treat
it as unverified until someone runs it.

## What this does and does not fix

Setting `PINGONE_WEBHOOK_SECRET` removes the blanket 401 that currently
rejects every request regardless of signature. It does **not**, by itself,
make PingOne events show up anywhere — reachability (§2) is a separate,
independent blocker. A reader who sets only the secret and skips the tunnel
will still see zero events at `/monitoring/pingone-events`, correctly: no
POST is arriving at all.
