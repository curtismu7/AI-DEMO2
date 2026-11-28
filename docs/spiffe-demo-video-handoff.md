# Video Recording Handoff — SPIFFE Demo (Real Mode)

**Date:** 2026-11-22
**Recording goal:** Customer-facing demo video of SPIFFE/SPIRE workload identity in Real mode
**Runtime target:** ~5 minutes

---

## Environment (all verified live 2026-11-22)

### Primary: standalone lab (SPIFFE Issuer LAB)

- **URL:** `<lab-proxy-url>/spiffe-issuer/` (lab proxy — always use this URL, never loopback)
- **Mode:** REAL (`/api/info` returns `source: "real"`, `realAvailable: true`)
- **Container:** `spiffe-issuer-spiffe-issuer-1` (Up, healthy)
- **Issuer:** `https://spiffe-issuer.local` · Trust domain: `lab.example`
- **JWKS:** `https://spiffe-issuer.local/.well-known/jwks.json` · Discovery: `/.well-known/openid-configuration`
- **Repo:** `curtismu7/spiffe-issuer-LAB` (local: `~/Development/AI-DEMO-Standalone/standalone/spiffe-issuer-LAB`)

### Optional second segment: full AI-DEMO2 stack (live PingFederate exchange)

- **URL:** `<ai-demo2-url>` → SPIFFE page `/spiffe-privilege`
- **Verified working:** `POST /api/demo/spiffe/pingfederate/exchange` returns `spiffe_id: "spiffe://<trust-domain>/ns/<ns>/sa/<agent>"` and the exchanged JWT carries that same SPIFFE ID in the `act` claim
- **Containers up:** spire-server, spire-agent, spiffe-oidc-provider, spiffe-helper-bff/gateway, pingfederate (healthy)

---

## Run of show

### Part 1 — The lab (~3 min)

1. Open `<lab-proxy-url>/spiffe-issuer/`
2. Show the mode badge: **Real** (not Mock)
3. **Mint** — three tokens are minted with real signatures:
   - **Valid**: `sub = spiffe://lab.example/ns/agents/sa/mcp-agent`, signed by the published key
   - **Mismatched**: different SPIFFE ID in the same trust domain
   - **Untrusted**: valid SPIFFE ID but signed by a key that is NEVER published to JWKS
4. Open/point at the JWKS URL — only ONE key is published (this is the whole security model)
5. **Present** all three to the real Privilege MCP door:
   - Valid → **200** with tool list
   - Mismatched → **401**
   - Untrusted → **401** (signature doesn't check against published JWKS)
6. Narration beat: "A stored secret works until someone revokes it. This token is short-lived (exp − iat ≤ 300s) and checked against a public key list." Do not say "attested": this lab mints test tokens, it attests no workload.

### Part 2 (optional) — Full stack with PingFederate (~2 min)

1. `<ai-demo2-url>` → sign in → navigate to `/spiffe-privilege`
2. Trigger the exchange — highlight `spiffe_id` in the response
3. Show the decoded exchanged token — `act` claim carries the SPIFFE ID

---

## Talking points (map to the deck)

- **What the demo is (1 sentence):** An AI agent proves who it is with a short-lived cryptographic identity — no passwords, no secrets — and a stolen token no longer works.
- **Standards:** SPIFFE/SPIRE (workload identity, JWT-SVIDs), RFC 8693 token exchange, OIDC discovery/JWKS
- **Business value:** security (no static secrets), platform (zero-touch identity, one label), compliance (spiffeId in every token = audit trail)
- **The point:** Every workload can have a verifiable identity — secrets stop being the source of trust

## Known-good facts (verified, safe to claim on camera)

- On 2026-11-22 this lab's OWN tokens (RS256, `aud` as one string) got 200 / 401 / 401 (Valid / Mismatched / Untrusted) from a real Privilege door in Real mode; the recorded take is in the lab repo under `video/` (spiffe-issuer-LAB, PR #15, #19)
- The gateway gives no reason for a 401 and logs no per-call line for these. Say "it gives no reason", never "the cause". The two wrong tokens can get different gateway answers, so quote each one.
- Tokens are ≤300s lifetime, RS256, `kid` header, `aud` = the audience the Federated Identity generates (not the door URL, when an override is set)
- Lab is a token minter, NOT SPIRE — say "this mints SVIDs; SPIRE attests the workload" if asked
- The 2026-11-19 verification: a real SPIRE (1.7.2 k8s) SVID was accepted by a real Privilege door (200); wrong ID / wrong aud / tampered / no token all 401

## Do NOT claim on camera

- That the lab attests workloads (it doesn't), or that a stolen token "no longer works" (these tokens are valid for up to 300 s)
- Mock-mode rows as Privilege results (they say MOCK; you're in Real mode, so N/A)

## Pre-record checklist

- [ ] Lab proxy URL loads, mode badge shows **Real**
- [ ] Privilege gateway door reachable (present valid token → 200 before recording)
- [ ] Browser zoom ~125%, clean profile, no other tabs
- [ ] (Part 2) AI-DEMO2 signed in, `/spiffe-privilege` reachable, stack generation pinned
