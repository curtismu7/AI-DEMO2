# langchain_agent — LangGraph banking agent

Inherits the root [CLAUDE.md](../CLAUDE.md) and `REGRESSION_PLAN.md` §0–§1.
Everything below is additive and **Python**, unlike every other nested
CLAUDE.md in this repo — do not carry over Node/jest conventions here.

## Stack

- Python 3.11, matching the Dockerfile (`FROM python:3.11-slim`).
  `scripts/run-pytest.sh` defaults to `python3.11` and falls back to `python3`.
- LangChain 1.3 + LangGraph 1.2 (stateful runtime, `MemorySaver` checkpointer)
- pytest (`testpaths = tests`, `pythonpath = src .`, `asyncio_mode = auto`)
- black + mypy for lint/type-check (no enforced pre-commit hook here)

## LLM provider

Default is **Helix** (`LANGCHAIN_LLM_PROVIDER=helix`, via `httpx` — see
`helix_llm.py`), not OpenAI. `langchain-openai` is present only to talk to a
local OpenAI-compatible endpoint (LM Studio / llama.cpp), never a cloud key.
Don't add a real OpenAI API key path — it's out of scope for this demo.

## Layout

```text
src/agent/ src/agents/    LangGraph graph + node definitions
src/agui/                  AG-UI protocol adapter
src/api/                   FastAPI-style HTTP surface
src/authentication/        PingOne token handling for the agent
src/mcp/                   MCP client calls into the banking MCP server (oauth-mcp) / gateway
frontend/                   separate npm project — own test:ci, not pytest
tests/                       pytest specs
```

## Verify before claiming done

```bash
bash scripts/run-pytest.sh              # stable subset only — fast, expected green
bash scripts/run-pytest.sh tests/       # full suite
```

The no-argument form is intentionally a curated subset, not full coverage —
don't read a green run as "all tests pass."
