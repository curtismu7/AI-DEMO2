# RESUME HERE — act claim nested-object → array migration (SUPERSEDED 2026-10-10)

**This migration is CANCELLED — do not execute it.** See the superseding note at the top of
`2026-08-12-act-claim-array-migration.md` for the full rationale. Short version: web research
against RFC 8693 §4.1 and vendor implementations (Auth0 OBO = nested + auto-maintained, capped
at 5; Entra Agent ID / Okta / AWS = no `act` claim at all) found **no implementer that mints
`act` as an array**. The standard and every real deployment use the nested object; this repo
already mints nested everywhere, so it was already compliant. The only live violation — the
array-shaped example in `TokenFlowDiagram.jsx`'s education diagram (also carried the subject
in `act`, doubly wrong) — was fixed directly in worktree `act-claim-rfc8693-alignment`.

If the *internal-normalization* idea (shared `normalizeActChain` at decode boundaries) is ever
revisited, treat it as optional hardening, not a migration: the existing recursive walkers
(`countActDepth`, gateway `actChainDepth`) are correct for the nested shape.
