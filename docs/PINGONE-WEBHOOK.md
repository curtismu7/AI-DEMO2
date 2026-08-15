# PingOne webhook to New Relic

Two ways to get PingOne activity into New Relic. Pick by whether you need the
events on screen in the demo UI.

---

## Option A — PingOne posts straight to New Relic

Simplest, and it needs no code, no secret, and no tunnel. PingOne ships a native
New Relic event schema, and New Relic's Logs API is on the public internet.

In the PingOne console, **Connections → Webhooks → Add Webhook**:

| Field | Value |
|---|---|
| Name | anything, e.g. `NR` |
| Protocol | HTTPS |
| Destination URL | `https://log-api.newrelic.com/log/v1` |
| Allow TLS with untrusted certificates | unchecked — New Relic has a real CA cert |
| TLS Client Authentication Key | None |
| Basic Authentication | leave blank |
| Custom HTTP Header | Key `Api-Key`, Value = your `NR_LICENSE_KEY` |
| JSON Format | JSON array |
| Pretty Print | unchecked — adds ~20% payload for no benefit |
| Event Schema | **New Relic** |
| Payload Limit | Limit by Events, **1** |

`Api-Key` here is not a security control — it is the credential New Relic
requires to accept ingest. Without it every payload is rejected.

Payload limit `1` matters for a live demo: at the default 500 PingOne batches
events and nothing appears until a batch fills.

Verify in New Relic (account id is in `NR_ACCOUNT_ID`):

    SELECT * FROM Log WHERE source LIKE '%pingone%' SINCE 30 minutes ago

**Tradeoff:** events reach New Relic but not the demo's own
`/monitoring/pingone-events` panel, which reads the BFF's local store.

---

## Option B — PingOne posts to this app

Use this when you want events on screen in the demo.

### The endpoint is open on purpose

`POST /webhook/pingone` performs **no authentication**. Anyone who can reach it
can inject events into the store and on to New Relic.

That is a deliberate demo tradeoff, not an oversight. PingOne's webhook offers
only Basic auth, static custom headers, or mTLS — it does not sign the request
body. The HMAC check this route used to perform (`x-p1-signature` over the raw
body) could therefore never pass against a real PingOne subscription; it only
ever passed for hand-crafted curls. Rather than keep a check that guaranteed
401s in production use, the gate was removed.

If you later need this closed, the honest options are a static shared secret in
a custom header, Basic auth, or mTLS — all things PingOne can actually send.

### Payload shape

PingOne posts a **batch**: a JSON array of up to 500 events. The route accepts
an array or a single bare object, keeps every element with a usable event type,
drops the rest, and returns `{ received, eventId, eventIds, count }`. It returns
400 `invalid_event` only when nothing in the payload is usable.

The event type lives at **`action.type`**, not at the top level — a real
delivery looks like:

```json
[ { "id": "...", "recordedAt": "...",
    "actors": { "user": { "id": "...", "environment": { "id": "..." } } },
    "action": { "type": "EVENT_DELIVERY_TEST" },
    "result": { "status": "SUCCESS" },
    "_embedded": {} } ]
```

Two traps worth knowing, both of which cost real 400s here: `_embedded` is `{}`
on live payloads, so the environment must be read off the actor; and reading a
top-level `type` matches hand-written curls while failing every genuine PingOne
event.

### Reachability

The endpoint must be reachable from PingOne's cloud.
`https://api.ping.demo:3001/webhook/pingone` and `https://local.ping-devops.com:4000`
are **local-only** — both are `/etc/hosts` entries pointing at 127.0.0.1 and
resolve to nothing from outside your machine, despite looking like real domains.

**Recommended: a public tunnel.** This repo is set up for ngrok with a static
domain, managed by a launchd agent so it survives logout:

    ~/Library/LaunchAgents/com.cmuir.ngrok-pingone-webhook.plist

Start/stop with `launchctl load|unload` on that path; logs at
`/tmp/ngrok-pingone-webhook.log`. Manually:

    ngrok http https://localhost:3001 --url https://<your-static-domain>

The static domain matters: the PingOne subscription keeps working across
restarts instead of needing a new URL each time.

Note the tunnel exposes the **whole BFF** on :3001, not just `/webhook/`.

**SE AWS deployment.** `https://ai-demo.ping-devops.com/webhook/pingone` works
only when the cluster is actually deployed — as of 2026-08-09 the host is
NXDOMAIN. Two things had to be true for it to work at all, and one of them was
missing until now:

- the ingress sends `/` to `frontend:4000`, so the request lands on nginx, and
- nginx must proxy `/webhook/` to the BFF.

Without that nginx rule the request falls through to `location /` and is
answered with the SPA's `index.html` — **HTTP 200 with an HTML body**. PingOne
records the delivery as successful and the events are silently discarded, which
is worse than a clean failure. The rule now exists in `demo_api_ui/nginx.conf`,
but has not been exercised against a live cluster.

### Console fields

Same as Option A except:

| Field | Value |
|---|---|
| Destination URL | your tunnel URL + `/webhook/pingone` |
| Basic Authentication | leave blank — the endpoint ignores credentials |
| Event Schema | **Ping Activity** — the mapper reads `action.type`, `actors`, `result`, `resources`, `recordedAt` |
| Allow TLS with untrusted certificates | unchecked for ngrok (real cert); check only for a mkcert/self-signed target |
| Payload Limit | Limit by Events, **1** — at the default 500 nothing appears until a batch fills |

PingOne issues a `HEAD` before it will `POST` (that is what **Test Connection**
sends). The route answers 200; if you see the console report the subscription as
unreachable, check that first.

### Verifying

    curl -sk -X POST https://<your-host>/webhook/pingone \
      -H 'Content-Type: application/json' \
      -d '[{"type":"AUTHENTICATION","result":{"status":"SUCCESS"}}]'

Expected: `{"received":true,"eventId":"...","eventIds":["..."],"count":1}`, and
the event appears at `/monitoring/pingone-events`.

---

## Provisioning via the Management API

The console is not the only route — a Worker token can create the subscription
directly:

    POST https://api.pingone.com/v1/environments/{environmentId}/subscriptions

Get the token with `client_credentials` against
`https://auth.pingone.com/{environmentId}/as/token` using
`PINGONE_WORKER_CLIENT_ID` / `PINGONE_WORKER_CLIENT_SECRET`. List existing
subscriptions with the same path and `GET`.
