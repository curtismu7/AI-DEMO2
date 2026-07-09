# AGENTS.md

Canonical instructions for AI coding agents in this repository live in **[CLAUDE.md](./CLAUDE.md)**.

Read `CLAUDE.md` first, then [REGRESSION_PLAN.md](./REGRESSION_PLAN.md) §1 before changing protected areas.

Opt-in AI-DLC: when the user says `Using AI-DLC,`, follow `.aidlc/CORE-WORKFLOW.md`
(see `.aidlc/README.md`). Repo do-not-break rules still win.
{
  "language_models": {
    "llamacpp": {
      "api_url": "http://localhost:8090"
    },
    "provider": "llamacpp",
    "inline_provider": "llamacpp",
    "default_model": "phi-4-mini-instruct"
  },
  "assistant": {
    "version": "2",
    "default_model": {
      "provider": "llamacpp",
      "model": "phi-4-mini-instruct"
    }
  }
}
