---
name: generate-tests
description: Use when writing new unit/integration tests in this repo, or asked to "add tests for X" / "generate tests". Routes to the right runner per service, applies this repo's error-shape and mocking conventions, and flags the jest/vitest traps that have caused false-green or false-red runs before. Not for running/verifying existing tests — see verify-ai-demo2 for that.
---

# Generate tests (AI-DEMO2)

## 1. Find the runner and the existing test file first

| Service | Runner | Spec location | Notes |
|---|---|---|---|
| `demo_api_server` | Jest 29.7 + supertest | `tests/` (not `__tests__/` — legacy) | Zod 4 for schema assertions |
| `demo_api_ui` | **Vitest** 3.2, not jest | colocated or `src/**/*.test.jsx` | jsdom, `globals: true`, setup `src/setupTests.js` |
| `oauth-mcp` | Jest 29.5 + ts-jest | **both** `tests/` (integration, cross-cutting) and colocated `src/**/__tests__/` (unit) — match the nearest sibling | `jose` and `uuid` are globally CJS-shimmed via `moduleNameMapper` in `jest.config.js`; the stubs **throw** (`[jose-cjs shim] jwtVerify() called in test — mock the caller`), so a test needing real JWT behavior must mock the caller or `jest.unmock('jose')` |
| `demo_mcp_gateway` | Jest 29.7 + ts-jest | **both** `tests/` and colocated `src/__tests__/` | No unit/integration script split — `npm test` runs everything; no global module shims |
| `langchain_agent` | pytest | `tests/` | `pytest.ini` sets `pythonpath = src .` and `asyncio_mode = auto` — no `@pytest.mark.asyncio` needed |
| `openai_agent`, `pydantic_agent` | pytest | `tests/` | **No `pytest.ini`/`pyproject.toml` at all**, so pytest-asyncio runs in **strict** mode: an `async def test_` without an explicit `@pytest.mark.asyncio` is collected but never awaited — it silently passes without running a single assertion. Path setup is a plain `conftest.py` `sys.path.insert`, not `pythonpath` |

Check whether a spec file for the target already exists before creating a new one — extend it rather than starting a parallel file.

## 2. Structure

Arrange-act-assert. One behavior per `it`/`test`. Cover, where applicable to the function's actual contract (don't pad with cases that can't occur):
- the happy path
- null/undefined/missing-field inputs
- a thrown/rejected error from a dependency
- an authorization/ownership boundary if the code has one

Keep mocks scoped to the test file — don't reach for a shared global mock unless the suite already has one.

## 3. Repo-specific conventions to encode in the test (not just the code)

- **Error responses are `{ error }`**, never `{ message }` — assert on that shape. Extra fields are added alongside `error`, never instead of it (e.g. `{ error, need_auth: true }`). This is a `demo_api_server` rule; see below for the MCP services.
- **`oauth-mcp` / `demo_mcp_gateway` error shape is protocol-layer-specific, not repo-uniform.** Assert the shape belonging to the layer under test, not `demo_api_server`'s flat `{ error }`: MCP tool results are `{ success: false, error, type: 'text', text }`; `oauth-mcp`'s `ErrorHandler.createErrorResponse` nests `{ error: { code, message, category, retryable, actionRequired?, errorId } }`; its `/authorize` and `/token` endpoints use RFC 6749 (`{ error: 'invalid_grant' }`); and the gateway's JSON-RPC dispatch uses `{ error: { code, message } }` with RFC codes (`-32601` method not found, `-32602` invalid params).
- **Upstream/axios failures normalize through `normalizeAxiosError`** — a test for a route that calls an external service should assert the normalized shape, not a raw axios error leaking through.
- Server tests run in CommonJS (`demo_api_server`); UI tests are Vitest, and `expect()` matchers differ from jest's in a few places — don't copy a jest assertion verbatim into a `.test.jsx`.

## 4. Known traps — check before assuming a red/green result

- **`configStore` mock shadowing**: `demo_api_server/tests/stepVerification.*.test.js` do `jest.mock('../services/configStore', ...)`. Any shared helper the test calls that does its own `require('../../services/configStore')` resolves to that mock, not the real store. If a new test needs the real store inside a suite that mocks it, pass the store in as a parameter — don't add another bare `require`.
- **`middleware/auth.js` hand-written mocks**: `authorize-gate`, `step-up-gate`, `transaction-flows`, `runtime-settings-api` mock `../../middleware/auth` with a literal object. Adding a new named export to `auth.js` means adding it to all four mocks too, or they die at `server.js` load with `Router.use() requires a middleware function but got a undefined`.
- **React `StrictMode` double-invokes effects** — a `useRef` "first run only" guard can appear to fail in tests/dev but be correct in prod; don't chase it as a real bug without confirming under StrictMode specifically.
- **`jest.resetModules()`** invalidates previously-captured `require` handles — a test that grabs a module reference before `resetModules()` and asserts on it later is asserting on a stale handle.
- **Python agents: module-scope env mutation leaks across the whole session.** Each agent's `src/config.py` reads secrets/URLs into module-level constants *at import time*, so a bare `os.environ.setdefault("BFF_INTERNAL_SECRET", ...)` at test-module scope (as in `pydantic_agent/tests/test_run_handler.py`) is never reverted and whichever file imports `src.config` first bakes that value in for every other file in the run. Use an autouse fixture that does `monkeypatch.setenv(...)` **and** reassigns the already-imported attribute (`cfg.BFF_INTERNAL_SECRET = ...`) — see `pydantic_agent/tests/test_main.py`'s `_set_secret`.
- **Python agents: mock at the transport boundary, not the app code.** Existing suites use `respx` for `httpx` (openai/pydantic BFF tool calls), `aioresponses` for `aiohttp` (langchain PingOne/OAuth), and patch `websockets.connect` for MCP sockets — so the real request-building and response-parsing still runs. Mocking the SDK object itself (e.g. `Agent`/`OpenAIModel`) only proves call shape.

## 5. Running what you wrote

Scoped by default, per root CLAUDE.md:

```bash
cd demo_api_server && CI=true npx jest <new/changed test path> --forceExit
cd demo_api_ui && npm run test:unit
bash scripts/run-pytest.sh tests/<path>   # from the relevant python agent dir
```

`CI=true` is mandatory for `demo_api_server` — without it, supertest suites flake and a green run proves nothing. Full-suite runs, worktree node_modules setup, and jest-vs-vitest flake triage are covered by the **verify-ai-demo2** skill — use that once tests are written, not this one.
