# Workload identity for agent callers

October 9, 2026 · guide + gap statement

What a calling agent must hold for the Agent Privilege's **Pass Agent Token**
mode to work — what the gateway demands, what this repo has already built and
verified on the SPIFFE side, and the exact gap that still stops the two from
meeting. Written as the record of planned guide #4; the "not yet" in the
planned table was correct when written, and this explains precisely why.

## The demand, in the gateway's own words

When a remote agent's Auth Mode is **Pass Agent Token**, the gateway forwards
the *caller's* workload identity to the remote agent. A caller that came in as
a signed-in person, or with an agent virtual key, has **no workload assertion
to forward** — the call passes policy and is then refused:

```text
backend credential refused for <user-id> on <app>: app <app> requires token-pass,
but this session presented no workload assertion
```

Reproduced live 2026-10-03 (person) and 2026-10-03 (agent key). The refusal is
a bare `403` to the caller; the reason is only in the gateway log. Full
behavior: [`GATEWAY-AGENT-TO-AGENT-A2A.md`](GATEWAY-AGENT-TO-AGENT-A2A.md) §
auth modes; [`GATEWAY-A2A-AUTH-MODES-COMPARED.md`](GATEWAY-A2A-AUTH-MODES-COMPARED.md)
is the four-mode comparison. Both state the same open item: *Pass Agent Token
with a caller that holds a workload identity — not tested, because no caller
holds one.*

The gateway's own log lines tell you what it expects:

| Log line | Meaning |
|---|---|
| `mcpgw: workload token accepted for key <key> issuer=<issuer> subject=<subject>` | A workload token verified and matched a key |
| `mcpgw: workload token rejected: <reason>` | The token failed verification or matched no key |
| `app <app> requires token-pass, but ...no workload assertion` | The caller has nothing to forward |

The acceptance line names `issuer=` and `subject=` — the gateway validates a
caller-presented token against an issuer/subject it knows (an agent key's
registered identity). It does **not** mint workload identity; it only passes
on or verifies what arrives.

## What the repo already has: SPIFFE, verified end to end — to PingFederate

The `spiffe` compose profile is a real SPIRE 1.15.2 server + agent (join-token
node attestation, Docker-label workload attestation), with `spiffe-helper`
delivering a rotating JWT-SVID to the BFF, and an OIDC Discovery Provider
serving the trust domain's JWKS at
`https://local.ping-devops.com:8443/keys`. Trust domain:
`spiffe://bxfinance.demo`.

**Verified live 2026-09-26** (flag `ff_spiffe_pf_exchange`, default off):
the BFF mints its SVID via the Workload API and exchanges it at a real
PingFederate 13 as an RFC 8693 `actor_token` (`actor_token_type=jwt`). PF's
JWT Token Processor 2.0 trusts the SPIRE OIDC Discovery Provider as the
issuer, validates the JWT-SVID, and the workload identity lands in the
exchanged token as the `spiffeId` claim (plus `act` as a *string*, because
this PF instance has server-wide OGNL disabled — the RFC 8693-shaped
`act.sub` object needs that enabled, a separate decision with tenant-wide
blast radius).

- Runbook: `spiffe/README.md` (profile startup, PF container recreation with
  its two durable volumes, mkcert CA re-seed).
- Plan and constraints: `docs/SPIFFE_PLAN.md` — the decision log documents
  what was wrong in the previous version and why.
- BFF surface: `POST /api/demo/spiffe/pingfederate/exchange`
  (`demo_api_server/routes/spiffeDemo.js:153`,
  `services/spiffePingfederateService.js`), flag-gated.

**Why PingFederate and not PingOne:** verified against PingOne's docs and
live discovery — PingOne accepts only subject/actor tokens issued by its own
environment, has no trusted-external-issuer object, and no mTLS/DPoP/
cert-bound-token support at all. SPIFFE→actor-token validation is a
**PingFederate** capability (JWT Token Processor 2.0 trusting the SPIRE OIDC
Discovery Provider). PingOne's one achievable win is different: a workload's
`private_key_jwt` client assertion signed by a SPIRE-issued rotating key
(`jwksUrl` → the discovery provider), which deletes the static client secret.
That path exists in the plan (Phase C) but needs a **public** JWKS URL, so it
cannot be demonstrated on a laptop against real PingOne.

## The gap: two trust domains that have not met

| | The gateway's demand | The SPIFFE path delivers |
|---|---|---|
| Token | a workload assertion the gateway can verify (`issuer=` / `subject=`) | a SPIRE JWT-SVID from `spiffe://bxfinance.demo` |
| Verified against | agent keys registered in the console (the acceptance line matches a **key**) | PingFederate 13 (JWT Token Processor 2.0) |
| Status | `token-pass` never exercised with a real caller token | exchange verified at PF; the token has never been presented to the gateway |

The missing experiment is one call: an A2A caller that obtains a
SPIRE-issued token, presents it to the gateway on an app in Pass Agent Token
mode, and the remote agent receives it. Two unknowns decide whether that
works without Ping's help:

1. **Does the gateway verify the caller's workload token against agent-key
   registrations only, or against any trusted issuer?** The acceptance line's
   `for key <key>` suggests the former — in which case the caller needs a
   registered agent key *plus* a workload assertion, and the question becomes
   whether the console can bind an issuer to a key.
2. **If a trusted issuer can be registered** (console or `cyctl`), does
   `spiffe://bxfinance.demo` (the PF-validated JWT-SVID) satisfy it?

Until one of those is answered, the honest demo story is the two-legged one
this repo can already show: **SPIFFE → PingFederate** (verified) as the
workload-identity leg, and **agent key → gateway** (verified) as the gateway
leg, with Pass Agent Token's end-to-end path as the documented open item.

## How to close the gap (the experiment, in order)

1. Start the `spiffe` profile, enable `ff_spiffe_pf_exchange`, confirm the
   PF exchange returns a `spiffeId` (all verified steps, `spiffe/README.md`).
2. In the console, inspect the calling agent's registration for any
   issuer/identity field that a workload token could satisfy; check `cyctl`
   flags for the same (`cyctl object` surface, `PRIVILEGE-MCP-CONSOLE-STEPS.md`).
3. Present the SVID (or the PF-exchanged token) as Bearer to a Pass Agent
   Token app through the gateway; read the log for
   `workload token accepted/rejected` and the reason string.
4. If accepted: re-run the A2A demo end to end on Pass Agent Token and update
   `GATEWAY-A2A-AUTH-MODES-COMPARED.md`'s "Not tested" rows — that closes
   planned guide #4.
5. If rejected with `invalid virtual key presented` / no issuer registration
   exists: the gap is a vendor question (issues-to-raise-with-Ping), not a
   configuration one.

## What is verified

| Fact | Status |
|---|---|
| Pass Agent Token refuses person and agent-key callers (`token-pass` 403) | Verified live 2026-10-03 |
| Gateway validates workload tokens against `issuer=`/`subject=` and a key | From the gateway's own log lines (observed in the acceptance/rejection rows); matching not exercised |
| SPIRE server/agent/helper/OIDC-discovery profile works locally | Verified live 2026-09-26 |
| SPIRE JWT-SVID as PF `actor_token` → `spiffeId` claim in the exchanged token | Verified live 2026-09-26 (flag-gated) |
| PingOne cannot consume external-issuer or SPIRE tokens at all | Verified against PingOne docs + live discovery 2026-09-26 |
| Gateway accepting a SPIFFE/PF workload token on `token-pass` | **Not tested — the gap this guide documents** |
