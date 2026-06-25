# AGENTS.md

Canonical instructions for AI coding agents in this repository live in **[CLAUDE.md](./CLAUDE.md)**.

Read `CLAUDE.md` first, then [REGRESSION_PLAN.md](./REGRESSION_PLAN.md) §1 before changing protected areas.
{
  "language_models": {
    "ollama": {
      "api_url": "http://localhost:11434"
    },
    "provider": "ollama",
    "inline_provider": "ollama",
    "default_model": "gemma4:latest"
  },
  "assistant": {
    "version": "2",
    "default_model": {
      "provider": "ollama",
      "model": "gemma4:latest"
    }
  }
}
