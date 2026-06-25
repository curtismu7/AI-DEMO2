# Design: New `pingone-mfa` skill (PingOne MFA device lifecycle)

**Date:** 2026-05-16
**Status:** Approved
**Author:** Curtis Muir (with Claude Code)

## Goal

Create a new authoritative skill, `.claude/skills/pingone-mfa/`, covering the
**PingOne MFA Management API device lifecycle**. Content is sourced from
`~/Development/oauthPlayground` (read-only, outside the banking repo) and
grounded in the banking app's real `banking_api_server/services/mfaService.js`
and `routes/mfa.js` / `mfaStepUp.js` / `mfaTest.js`. Progressive disclosure:
lean SKILL.md + bundled `reference/` files per device type.

## Boundary (three-skill split)

- **`oauth-pingone`** — MFA *during authentication* (ACR, step-up, CIBA,
  pi.flow). Unchanged.
- **`pingone-api-calls`** — generic Management API (users, attributes).
  MFA ownership ceded (one-line frontmatter edit).
- **`pingone-mfa`** (new) — MFA *device* lifecycle: worker scopes,
  device-auth policies, enroll/activate/order/list/delete, per-device-type,
  debugging. Authoritative.

## Source of truth

`~/Development/oauthPlayground` harvested docs: `docs/mfa/mfascopes.md`,
`docs/mfa/mfapolicy.md`, `docs/mfa/mfa-curl-debug-guide.md`,
`docs/mfa/MFA_REGISTRATION_PATHS.md`, `docs/mfa/OTP_FLOWS_ARCHITECTURE.md`,
`docs/mfa/rightFIDO2.md`, `docs/mfa/rightTOTP.md`, `docs/mfa/totp.md`,
`docs/mfa/usernameless.md`, `docs/mfa-ui-documentation/*` (per-device contracts).

## Scope

### In scope

1. **New `.claude/skills/pingone-mfa/SKILL.md`** (lean index, ~250 lines):
   - Frontmatter `description:` with strong USE FOR / DO NOT USE FOR routing
     (defers auth-side MFA → `oauth-pingone`; generic MA → `pingone-api-calls`).
   - Worker token + required MFA scopes (`p1:read:user`, `p1:update:user`,
     `p1:read:device`, `p1:create:device`, `p1:update:device`,
     `p1:delete:device`, device-auth-policy scopes).
   - Device-authentication-policies API (list / by-name / create-from-template).
   - Generic device lifecycle spine: lookup user → create device →
     activate (OTP) → list → delete, with PingOne endpoint patterns and
     status transitions.
   - Banking grounding: `mfaService.js`, `routes/mfa.js`, `mfaStepUp.js`;
     read config via `configStore.getEffective`, never `process.env`.
   - curl debug recipe (worker-token-status → lookup-user → create → activate).
   - Common MFA error codes + reference index.

2. **Bundled `reference/` files** under `.claude/skills/pingone-mfa/reference/`:

   | File | Contents |
   |---|---|
   | `device-sms.md` | SMS enrollment (E.164), OTP send/activate, resend, SMS errors |
   | `device-email.md` | Email device enrollment + OTP activation |
   | `device-totp.md` | TOTP secret/QR provisioning, activation by code |
   | `device-fido2.md` | FIDO2/passkey registration (WebAuthn attestation), usernameless |
   | `device-whatsapp.md` | WhatsApp device (two-route registration), OTP delivery |
   | `device-mobile-push.md` | Mobile push (SDK pairing), device order/priority, push vs OTP fallback |
   | `policy-and-scopes.md` | Device-auth-policy create-from-template payloads, full scope matrix, pairing/one-time-device flags |

   All device-type files mark clearly whether the type is wired in banking's
   `mfaService.js` or is PingOne reference only (demo/teaching).

3. **One surgical edit to `pingone-api-calls/SKILL.md`** — remove
   "MFA device enrollment, enable/disable MFA" from its USE FOR; add
   "MFA device lifecycle (use pingone-mfa)" to its DO NOT USE FOR.
   Single-line frontmatter change, no body changes.

### Out of scope

- No changes to `oauth-pingone`, banking services/routes, or the playground.
- No new banking MFA features — documentation/skill only.
- No REGRESSION_PLAN §1 files touched → no §4 Bug Fix Log entry.

## Constraints honored

- Emoji rule: only `⚠️ ✅ ❌`; strip playground's other emoji from snippets.
- Reference-not-prescription: distinguish banking-wired vs playground-only
  device types so an agent does not assume e.g. WhatsApp is wired.
- Each reference file ~80–140 lines, PingOne-API-accurate, house voice.

## Verification (docs only — no UI build)

- `pingone-mfa/SKILL.md` frontmatter valid; every `reference/*.md` link
  resolves to an existing file.
- `pingone-api-calls` description no longer claims MFA; new DO-NOT-USE
  pointer to `pingone-mfa` present.
- No banned emoji in any new/edited file.
- SKILL.md stayed lean (~250 lines).
