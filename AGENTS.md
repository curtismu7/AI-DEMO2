# AGENTS.md

Canonical instructions for AI coding agents live in **[CLAUDE.md](./CLAUDE.md)**.

1. Read the **Agent behavior** section in `CLAUDE.md` first (don't assume, minimum
   change, surgical diffs, verify until done).
2. Before protected areas (auth, token exchange, BFF session, UI), read
   [REGRESSION_PLAN.md](./REGRESSION_PLAN.md) §0–§1 and invoke `regression-guard`.
3. Opt-in AI-DLC only when the user says `Using AI-DLC,` — see `.aidlc/README.md`.
   Repo do-not-break rules still win.
