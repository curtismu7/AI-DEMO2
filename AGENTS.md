# AGENTS.md

Canonical instructions for AI coding agents in this repository live in **[CLAUDE.md](./CLAUDE.md)**.

Read `CLAUDE.md` first, then [REGRESSION_PLAN.md](./REGRESSION_PLAN.md) §1 before changing protected areas.
{
  "language_models": {
    "llamacpp": {
      "api_url": "http://localhost:8080"
    },
    "provider": "llamacpp",
    "inline_provider": "llamacpp",
    "default_model": "qwen2.5-3b-instruct"
  },
  "assistant": {
    "version": "2",
    "default_model": {
      "provider": "llamacpp",
      "model": "qwen2.5-3b-instruct"
    }
  }
}
