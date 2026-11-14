# Slack note: what we need from PingFederate + PingOne to be Poppy-compliant

> Draft for #**se-demos** / #**product-identity**. Short enough to paste; the full spec-mapped table lives in `docs/poppy-ping-gaps.md`.

---

**Subject: Poppy (Personal Agent Protocol) — 2 product asks for PF, several for PingOne**

Team — we built a working Poppy (Personal Agent Protocol) demo on PingFederate: an unregistered "personal agent" (client_id is its own HTTPS metadata URL, CIMD), Direct Sign-In with PKCE on real PF, and a Company API that verifies the spec's signed `Poppy-Session` header on every request. End-to-end works today. But two PF gaps and a handful of PingOne ones block real compliance — posting here so the asks are on record.

**PingFederate (blocks spec compliance):**

1. **`protected_resources` in the authorization-server metadata.** Poppy §3.2 requires the AS metadata (RFC 8414) to list the Company's domain under `protected_resources` (RFC 9728). Agents MUST refuse metadata without it — otherwise any domain could claim another Company's issuer and receive its tokens. PF has no setting for this; we run a TLS shim in front of PF that injects it. **Ask: a product setting to declare protected resources on the AS.**
2. **CIMD client cache control + per-client scopes.** PF caches a fetched CIMD client document ~5 min with no eviction (a revoked agent stays accepted up to the TTL), and grants scopes from the AS-wide list (our PF advertises 55 scopes from other demos) instead of intersecting with what the agent requested. **Ask: configurable CIMD cache TTL + admin eviction, and per-client scope allow-listing with consent that shows only the requested scopes.**

Smaller/verify-only: RFC 9207 `iss` on error responses; device grant for CIMD clients; refresh + revocation for CIMD clients; PS384 assertions.

**PingOne (if PingOne is the issuer for a Poppy Company):**

- **CIMD client type** — today clients must be pre-registered; Poppy requires dynamic client_id-is-a-URL (fetch the metadata document, keys from its `jwks_uri`, redirect URIs from the document, private_key_jwt). This is the big one.
- **`protected_resources`** in issuer metadata (same ask as PF).
- **Client assertion `aud` = issuer exactly** (RFC 7523bis direction) rather than token-endpoint audience.
- **Per-resource scope advertising + `changes`/`personal_data` scope hints**, and consent that grants ⊆ requested.

**What already works (no action needed):** CIMD on PF, private_key_jwt (`client-authentication+jwt`, aud = issuer), PKCE + consent, Poppy-Session verification (delegation ≤24h, htm/htu, ath token-hash binding, jti replay refusal, session binding, signed-out sessions), and our poppy.json discovery checks.

Full spec-mapped gap table + what's proven: `docs/poppy-gaps/poppy-ping-gaps.md` on the AI-DEMO2 repo. Spec: <https://personalagentprotocol.org/docs/0.4/spec> (draft 0.4 = the 1.0 RC).

---

## Notes for the poster (not part of the Slack message)

- Post in the morning; offer the 3-minute demo (poppy-agent-tester on the lab shelf) as follow-up.
- If a PM asks "why now": draft 0.4 is the 1.0 release candidate (published 2026-11-10); 1.0 is targeted with no breaking changes from 0.4 unless implementers find problems — i.e. the window to influence the product asks is now.
- Link the inspector (`https://local.ping-devops.com:4000/poppy/inspector`) when talking to anyone who wants to *see* the requests.
