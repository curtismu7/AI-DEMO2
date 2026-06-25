# Design: Enrich `oauth-pingone` skill with extended grant types

**Date:** 2026-05-16
**Status:** Approved
**Author:** Curtis Muir (with Claude Code)

## Goal

Enrich the existing `.claude/skills/oauth-pingone/SKILL.md` skill with the
OAuth/OIDC flows it does not currently cover, sourced and adapted from the
`oauthPlayground` (MasterFlow) repo at `~/Development/oauthPlayground`. Content
must be **PingOne-specific**, not generic RFC paraphrase. Use **progressive
disclosure**: SKILL.md stays the lean index; detailed flows live in bundled
`reference/` files.

## Source of truth

- `~/Development/oauthPlayground` — cloned read-only, outside the banking repo.
  Key harvested docs: `docs/redirect.md` (pi.flow), `docs/flows/par/PAR_RAR_REDIRECTLESS_UPGRADE_PLAN.md`,
  `docs/flows/oauth/OAUTH_VS_OIDC_IMPLICIT_DIFFERENCES.md`,
  `docs/flows/oidc/HYBRID_FLOW_V6_MIGRATION_PLAN.md`,
  `docs/reference/OAuth 2.0 Token Exchange - info for selected customers.rtf`
  (Ping-internal RFC 8693 spec note, Nov 2025).

## Scope

### In scope (skill files only)

1. **SKILL.md edits (additive, ~40 lines):**
   - Add new-flow rows to the §0 Grant Type Selector table, each marked
     *reference: see `reference/<file>.md`* and noting banking applicability
     (most are demo/teaching only, not wired into the banking app).
   - New `§18. Extended Grant Types (reference index)` — short pointer table +
     up-front critical PingOne constraints (e.g. token-exchange same-environment-only).
   - Extend `description:` frontmatter keywords: hybrid, implicit, ROPC,
     redirectless, pi.flow, RAR, authorization_details, jwt-bearer.
   - Add new files to the "See Also" section.

2. **New `reference/` files** under `.claude/skills/oauth-pingone/reference/`:

   | File | Contents |
   |---|---|
   | `hybrid-flow.md` | OIDC Hybrid (`code id_token`, `code token`, `code id_token token`), PingOne app config, fragment+code dual handling, when to use vs auth-code |
   | `redirectless-pi-flow.md` | PingOne `response_mode=pi.flow`, `urn:pingidentity:redirectless`, JSON flow-object response, PingOne docs link |
   | `jwt-bearer-and-rar.md` | `urn:ietf:params:oauth:grant-type:jwt-bearer` + RAR (`authorization_details`, RFC 9396), PAR pairing, banking fine-grained-authz relevance |
   | `deprecated-flows.md` | Implicit (OAuth vs OIDC variants) + ROPC documented **as anti-patterns** with prominent deprecation warnings and "why banking never uses these" |
   | `token-exchange-pingone-deep-dive.md` | Ping-internal RFC 8693 details: same-environment-only constraint, `requested_token_type=id_token` support, no refresh token in TE response, `context.requestData.*` SPEL attribute-mapping expressions, App-A-acts-as-client chained-resource pattern |

### Out of scope

- Any change to `banking_api_*` code or other skills.
- No REGRESSION_PLAN §1 files touched → no §4 Bug Fix Log entry needed.
- No work on the oauthPlayground repo itself (separate future task).

## Constraints honored

- Emoji rule: only `⚠️ ✅ ❌`; strip playground's other emoji from harvested snippets.
- Reference-not-prescription: new-flow files state explicitly these are
  demo/teaching flows not wired into the banking app, so an agent does not, e.g.,
  wire ROPC into the BFF.
- Each reference file ~80–150 lines, PingOne-accurate, matching SKILL.md voice.
- SKILL.md stays lean (~670 lines after edit, was 628).

## Verification (docs only — no UI build)

- Every `reference/*.md` link in SKILL.md resolves to an existing file.
- New `description:` keywords present.
- No banned emoji in any new/edited file.
- SKILL.md line count stayed lean (~670).
