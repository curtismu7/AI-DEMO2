# Commitment-Grounding Guardrail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch and correct AI agent replies that claim a completed action/commitment ("I've waived your fee") beyond what this turn's real tool calls actually did, using a `guardrails-ai`-based validator wired into each of the three Python agent runtimes.

**Architecture:** Each agent runtime gets its own `grounding_guardrail.py` module (a regex pre-filter + a `guardrails-ai` custom `Validator` that makes one combined LLM judge/correct call using this turn's captured real tool results as ground truth). Live token streaming is untouched; a flagged/corrected reply is surfaced via a new AG-UI `CUSTOM` event (`grounding_correction`) that the BFF already passes through verbatim, picked up by a new reducer case in the UI and rendered as a follow-up token-event chat bubble.

**Tech Stack:** Python 3.11, `guardrails-ai` 0.10.x, pytest/pytest-asyncio, httpx/AsyncOpenAI (per-service LLM clients), React/Vitest (UI).

## Global Constraints

- Detection is **general** (any completed-action claim vs. this turn's real tool results), not hard-coded to the fee-waiver scenario.
- Pipeline is always: cheap regex pre-filter on every reply → only if matched, one **combined** LLM call (judge + correct in one round trip) — never two separate calls, never a reask loop.
- The grounding LLM call reuses the **same model/tier as the conversation** (the service's own already-configured client) — no new model routing.
- On grounding-call failure (timeout/network/model unavailable): **fail open** — send the original reply, `logger.exception(...)` the failure. Never block or alter the reply on a grounding-check error.
- Live token-by-token streaming to the browser is **never** buffered or held back. The correction (if any) arrives as a separate, later AG-UI `CUSTOM` event after the reply has already streamed.
- `mastra_agent` (Node/TS) is explicitly **out of scope** — do not touch it.
- `guardrails-ai`'s `Validator` base class requires a `~/.guardrailsrc` file to exist before any custom validator can be instantiated, or it raises `ValueError` at construction time. Every Dockerfile touched must provision this non-interactively and offline (`--disable-metrics --disable-remote-inferencing --token ""`) — no external network call is ever made by our custom validator.
- Follow each service's existing import/package conventions exactly (see per-task file paths) — do not introduce a shared cross-service library; the three implementations are deliberately independent per repo convention.

---

## Task 1: langchain_agent — grounding guardrail module (regex + validator, unit-tested in isolation)

**Files:**
- Create: `langchain_agent/src/agent/grounding_guardrail.py`
- Create: `langchain_agent/tests/test_grounding_guardrail.py`
- Modify: `langchain_agent/requirements.txt` (both duplicated dependency blocks — see Global Constraints note on the file's existing duplication)
- Modify: `langchain_agent/Pipfile`
- Modify: `langchain_agent/Dockerfile`

**Interfaces:**
- Produces: `contains_commitment_claim(text: str) -> bool`; `ToolCallRecord` (dataclass: `name: str`, `args: Any`, `result: str`); `CommitmentGroundingValidator(chat_fn: Callable[[str], Awaitable[str]], on_fail="fix", **kwargs)` — a `guardrails.validator_base.Validator` subclass whose `async_validate(value: str, metadata: dict) -> PassResult | FailResult` is the only supported entry point (`validate()` raises `NotImplementedError`). `metadata` must contain `{"tool_calls": list[ToolCallRecord]}`. On overclaim, the returned `FailResult.fix_value` is the corrected reply text and `FailResult.error_message` is a short note. Task 2 consumes all of these names directly.

- [ ] **Step 1: Write the failing tests for the regex pre-filter**

```python
# langchain_agent/tests/test_grounding_guardrail.py
import json
import pytest
from unittest.mock import AsyncMock

from src.agent.grounding_guardrail import (
    contains_commitment_claim,
    ToolCallRecord,
    CommitmentGroundingValidator,
)
from guardrails.validator_base import PassResult, FailResult


class TestContainsCommitmentClaim:
    def test_detects_fee_waiver_overclaim_phrasing(self):
        assert contains_commitment_claim("I've waived your fee!") is True

    def test_detects_future_tense_commitment(self):
        assert contains_commitment_claim("I'll open a new account for you right now.") is True

    def test_ignores_ordinary_informational_reply(self):
        assert contains_commitment_claim("Your checking account balance is $1,204.55.") is False

    def test_ignores_empty_string(self):
        assert contains_commitment_claim("") is False

    def test_detects_request_logged_is_not_flagged(self):
        # "submitted a request for review" is NOT a completion claim — must not
        # false-positive on the CORRECT, grounded phrasing.
        assert contains_commitment_claim(
            "I've submitted a fee waiver request (ID: fwr-123) for human review."
        ) is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd langchain_agent && python -m pytest tests/test_grounding_guardrail.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.agent.grounding_guardrail'`

- [ ] **Step 3: Implement the regex pre-filter**

```python
# langchain_agent/src/agent/grounding_guardrail.py
"""Commitment-grounding guardrail: catches agent replies that claim a
completed action beyond what this turn's real tool calls actually did.
See docs/superpowers/specs/2026-07-12-commitment-grounding-guardrail-design.md.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from guardrails.validator_base import FailResult, PassResult, Validator, register_validator

logger = logging.getLogger(__name__)

# First-person / completed-tense framing combined with a completion verb.
# Deliberately generalized past the fee-waiver example so any future
# "request-only" tool is covered without new code.
_COMMITMENT_PATTERN = re.compile(
    r"\b(I'?ve|I'?ll|I\s+will|Done[,:]?|Your\s+\S+\s+has\s+been)\b.{0,40}?\b"
    r"(waiv(?:e|ed)|grant(?:ed)?|appl(?:y|ied)|open(?:ed)?|remov(?:e|ed)|"
    r"refund(?:ed)?|credit(?:ed)?|process(?:ed)?|approv(?:e|ed))\b",
    re.IGNORECASE,
)

# Phrasing that correctly describes a request-only outcome — never flag these
# even if a completion verb appears nearby (e.g. "submitted a ... request").
_REQUEST_ONLY_PATTERN = re.compile(
    r"\b(submitted|logged|filed)\b.{0,20}\brequest\b", re.IGNORECASE
)


def contains_commitment_claim(text: str) -> bool:
    """Cheap pre-filter: does this reply look like it claims a completed
    action? Runs on every reply; only a match triggers the LLM grounding call."""
    if not text:
        return False
    if _REQUEST_ONLY_PATTERN.search(text):
        return False
    return bool(_COMMITMENT_PATTERN.search(text))
```

- [ ] **Step 4: Run tests to verify the pre-filter tests pass (validator tests still fail)**

Run: `cd langchain_agent && python -m pytest tests/test_grounding_guardrail.py -v`
Expected: The 5 `TestContainsCommitmentClaim` tests PASS. Collection may still fail overall since `CommitmentGroundingValidator` isn't defined yet — that's expected; proceed to Step 5.

- [ ] **Step 5: Write the failing tests for `CommitmentGroundingValidator`**

```python
# append to langchain_agent/tests/test_grounding_guardrail.py

class TestCommitmentGroundingValidator:
    @pytest.mark.asyncio
    async def test_flags_and_corrects_overclaiming_reply(self):
        async def fake_chat_fn(prompt: str) -> str:
            return json.dumps({
                "grounded": False,
                "corrected_reply": "I've submitted a fee waiver request (ID: fwr-123) for human review.",
            })

        validator = CommitmentGroundingValidator(chat_fn=fake_chat_fn, on_fail="fix")
        tool_calls = [ToolCallRecord(
            name="request_fee_waiver",
            args={"account_id": "acc_1"},
            result='{"requestId": "fwr-123", "status": "logged_for_review"}',
        )]
        result = await validator.async_validate(
            "I've waived your fee!", {"tool_calls": tool_calls}
        )
        assert isinstance(result, FailResult)
        assert "fwr-123" in result.fix_value

    @pytest.mark.asyncio
    async def test_passes_grounded_reply(self):
        async def fake_chat_fn(prompt: str) -> str:
            return json.dumps({"grounded": True})

        validator = CommitmentGroundingValidator(chat_fn=fake_chat_fn, on_fail="fix")
        result = await validator.async_validate(
            "I've submitted a fee waiver request (ID: fwr-123) for human review.",
            {"tool_calls": []},
        )
        assert isinstance(result, PassResult)

    @pytest.mark.asyncio
    async def test_fails_open_and_logs_on_chat_fn_error(self):
        async def broken_chat_fn(prompt: str) -> str:
            raise RuntimeError("LLM endpoint unreachable")

        validator = CommitmentGroundingValidator(chat_fn=broken_chat_fn, on_fail="fix")
        result = await validator.async_validate("I've waived your fee!", {"tool_calls": []})
        assert isinstance(result, PassResult)

    @pytest.mark.asyncio
    async def test_fails_open_on_malformed_json_from_llm(self):
        async def malformed_chat_fn(prompt: str) -> str:
            return "not json at all"

        validator = CommitmentGroundingValidator(chat_fn=malformed_chat_fn, on_fail="fix")
        result = await validator.async_validate("I've waived your fee!", {"tool_calls": []})
        assert isinstance(result, PassResult)

    def test_sync_validate_raises_not_implemented(self):
        async def fake_chat_fn(prompt: str) -> str:
            return json.dumps({"grounded": True})

        validator = CommitmentGroundingValidator(chat_fn=fake_chat_fn, on_fail="fix")
        with pytest.raises(NotImplementedError):
            validator.validate("anything", {})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd langchain_agent && python -m pytest tests/test_grounding_guardrail.py -v`
Expected: FAIL — `ImportError: cannot import name 'CommitmentGroundingValidator'`

- [ ] **Step 7: Implement `CommitmentGroundingValidator`**

Append to `langchain_agent/src/agent/grounding_guardrail.py`:

```python
@dataclass
class ToolCallRecord:
    name: str
    args: Any
    result: str


_GROUNDING_PROMPT_TEMPLATE = """You are a strict fact-checker for a banking assistant's reply.

The assistant just said:
---
{reply}
---

Here is what actually happened this turn (the real tool calls and their real results):
---
{tool_results}
---

Does the assistant's reply claim any completed action, grant, or commitment that is
NOT actually supported by the tool results above? For example, claiming a fee was
"waived" when the tool only logged a request for human review is an overclaim.

Respond with ONLY a JSON object, no other text:
{{"grounded": true}}  if the reply makes no claim beyond what the tool results support
{{"grounded": false, "corrected_reply": "..."}}  if it overclaims — corrected_reply must
  be a natural-language reply that says only what actually happened, in the same voice
  as the original reply.
"""


def _format_tool_results(tool_calls: list) -> str:
    if not tool_calls:
        return "(no tool calls were made this turn)"
    return "\n".join(f"- {tc.name}(args={tc.args}) -> {tc.result}" for tc in tool_calls)


def _extract_json_object(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"No JSON object found in grounding response: {text!r}")
    return json.loads(text[start : end + 1])


@register_validator(name="banking-agent/commitment-grounding", data_type="string")
class CommitmentGroundingValidator(Validator):
    """Catches replies claiming a completed action beyond what this turn's
    real tool calls actually did, and corrects them via one combined LLM
    judge/correct call. Async-only: the check makes a network call, so
    `async_validate` is overridden directly rather than relying on the base
    class's sync-validate-in-executor default.
    """

    def __init__(self, chat_fn: Callable[[str], Awaitable[str]], on_fail="fix", **kwargs):
        super().__init__(on_fail=on_fail, **kwargs)
        self._chat_fn = chat_fn

    def validate(self, value: Any, metadata: dict) -> Any:
        raise NotImplementedError(
            "CommitmentGroundingValidator only supports async_validate "
            "(the grounding check makes a network call)."
        )

    async def async_validate(self, value: str, metadata: dict) -> Any:
        tool_calls = metadata.get("tool_calls", [])
        prompt = _GROUNDING_PROMPT_TEMPLATE.format(
            reply=value, tool_results=_format_tool_results(tool_calls)
        )
        try:
            content = await self._chat_fn(prompt)
            parsed = _extract_json_object(content)
        except Exception:
            # Fail open with loud logging: the underlying write was already
            # gated by real P1AZ/HITL authorization; this check only guards
            # output truthfulness, so an error here must not block the reply.
            logger.exception("[grounding] LLM grounding call failed; failing open")
            return PassResult()

        if parsed.get("grounded", True):
            return PassResult()
        return FailResult(
            error_message="Reply claimed a completed action beyond what the tool results support.",
            fix_value=parsed.get("corrected_reply", value),
        )
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd langchain_agent && python -m pytest tests/test_grounding_guardrail.py -v`
Expected: All 10 tests PASS.

- [ ] **Step 9: Add the `guardrails-ai` dependency**

In `langchain_agent/requirements.txt`, add `guardrails-ai==0.10.2` on its own line immediately after line 18 (`python-dotenv>=1.0.0`) in the FIRST block, and again after the duplicate block's equivalent line (after `python-dotenv>=1.0.0` at line 48) — the file has known duplicated content (flagged during research; do not otherwise deduplicate it as part of this task, that's out of scope).

In `langchain_agent/Pipfile`, add a new line under `[packages]`:
```
guardrails-ai = "==0.10.2"
```

- [ ] **Step 10: Provision `.guardrailsrc` in the Dockerfile**

Read `langchain_agent/Dockerfile` first to find the line that runs `pip install` (or `pipenv install`). Immediately after the dependency-install line, add:

```dockerfile
RUN pip install --no-cache-dir guardrails-ai==0.10.2 \
    && guardrails configure --disable-metrics --disable-remote-inferencing --token ""
```

If the Dockerfile already installs from `requirements.txt` in one step (e.g. `RUN pip install -r requirements.txt`), the explicit `pip install guardrails-ai==0.10.2` above is redundant — instead append only the `&& guardrails configure ...` command onto that existing `RUN pip install -r requirements.txt` line (chained with `&&`), so `guardrails-ai` is already present in `requirements.txt` (Step 9) and installed by that line.

- [ ] **Step 11: Commit**

```bash
cd langchain_agent
git add src/agent/grounding_guardrail.py tests/test_grounding_guardrail.py requirements.txt Pipfile Dockerfile
git commit -m "feat(langchain_agent): add commitment-grounding guardrail module"
```

---

## Task 2: langchain_agent — wire the guardrail into `process_agui_message`

**Files:**
- Modify: `langchain_agent/src/agui/emitter.py`
- Modify: `langchain_agent/src/api/message_processor.py` (function `process_agui_message`, lines 726–1092)
- Modify: `langchain_agent/tests/test_message_processor.py`

**Interfaces:**
- Consumes: `contains_commitment_claim`, `ToolCallRecord`, `CommitmentGroundingValidator` from Task 1 (`src.agent.grounding_guardrail`); `FailResult`/`PassResult` from `guardrails.validator_base`.
- Produces: `AGUIEventEmitter.on_grounding_correction(original: str, corrected: str, note: str) -> None` (new emitter method, emits `{"type": "CUSTOM", "name": "grounding_correction", "value": {"original", "corrected", "correctionNote"}}`).

- [ ] **Step 1: Write the failing emitter test**

```python
# langchain_agent/tests/agui/test_grounding_correction_event.py
import pytest
from src.agui.emitter import AGUIEventEmitter


@pytest.mark.asyncio
async def test_on_grounding_correction_emits_custom_event():
    events = []

    async def sink(evt):
        events.append(evt)

    emitter = AGUIEventEmitter("run-1", "thread-1", sink=sink)
    await emitter.on_grounding_correction(
        original="I've waived your fee!",
        corrected="I've submitted a fee waiver request (ID: fwr-123) for human review.",
        note="Reply claimed a completed action beyond what the tool results support.",
    )

    assert len(events) == 1
    evt = events[0]
    assert evt["type"] == "CUSTOM"
    assert evt["name"] == "grounding_correction"
    assert evt["value"]["original"] == "I've waived your fee!"
    assert "fwr-123" in evt["value"]["corrected"]
    assert evt["value"]["correctionNote"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd langchain_agent && python -m pytest tests/agui/test_grounding_correction_event.py -v`
Expected: FAIL — `AttributeError: 'AGUIEventEmitter' object has no attribute 'on_grounding_correction'`

- [ ] **Step 3: Add `on_grounding_correction` to the emitter**

In `langchain_agent/src/agui/emitter.py`, add this method (matching the existing `on_usage`/`on_llm_detail` CUSTOM-event pattern at lines 107–142):

```python
    async def on_grounding_correction(self, original: str, corrected: str, note: str) -> None:
        try:
            await self._sink({
                "type": "CUSTOM",
                "name": "grounding_correction",
                "value": {"original": original, "corrected": corrected, "correctionNote": note},
            })
        except Exception:
            logger.exception("AG-UI sink error")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd langchain_agent && python -m pytest tests/agui/test_grounding_correction_event.py -v`
Expected: PASS.

- [ ] **Step 5: Write the failing integration test for `process_agui_message`**

```python
# append to langchain_agent/tests/test_message_processor.py

from unittest.mock import Mock
from guardrails.validator_base import FailResult


@pytest.fixture
def mock_agent_agui():
    """Agent double for the AG-UI (process_agui_message) MCP-graph path."""
    agent = Mock()
    agent.initialize_session_with_token = AsyncMock(return_value=None)
    agent.llm = Mock()
    agent.config = Mock()
    agent.config.langchain = Mock(max_iterations=25)
    agent._pre_model_hook = Mock()
    agent._checkpointer = Mock()
    agent.mcp_tool_provider = Mock()
    agent.mcp_tool_provider.set_session_context = AsyncMock(return_value=None)
    agent._build_system_message = AsyncMock(return_value="System prompt")

    graph = Mock()
    graph.get_state = Mock(return_value=Mock(values={}))

    async def fake_astream_events(agent_input, config=None, version="v2"):
        yield {
            "event": "on_tool_start",
            "name": "request_fee_waiver",
            "run_id": "call_1",
            "data": {"input": {"account_id": "acc_1"}},
        }
        yield {
            "event": "on_tool_end",
            "run_id": "call_1",
            "data": {"output": '{"requestId": "fwr-123", "status": "logged_for_review"}'},
        }

        class _Chunk:
            content = "I've waived your fee!"

        yield {"event": "on_chat_model_stream", "data": {"chunk": _Chunk()}}
        yield {
            "event": "on_chat_model_end",
            "data": {"output": Mock(usage_metadata=None, tool_calls=[]), "input": {"messages": []}},
            "metadata": {},
        }

    graph.astream_events = fake_astream_events
    agent._graph = graph
    return agent


@pytest.fixture
def mock_agui_emitter():
    emitter = AsyncMock()
    return emitter


@pytest.mark.asyncio
async def test_process_agui_message_emits_grounding_correction_on_overclaim(
    mock_config, mock_agent_agui, mock_session_manager, mock_websocket_handler, mock_agui_emitter,
):
    processor = MessageProcessor(
        agent=mock_agent_agui,
        session_manager=mock_session_manager,
        websocket_handler=mock_websocket_handler,
        config=mock_config,
    )
    with patch(
        "src.agent.grounding_guardrail.CommitmentGroundingValidator.async_validate",
        new=AsyncMock(
            return_value=FailResult(
                error_message="overclaim",
                fix_value="I've submitted a fee waiver request (ID: fwr-123) for human review.",
            )
        ),
    ):
        await processor.process_agui_message(
            session_id="s1",
            message="Can you waive the fee?",
            auth_token="tok",
            emitter=mock_agui_emitter,
            bff_tool_url="",
            tool_schemas=None,
            messages_list=None,
        )
    mock_agui_emitter.on_grounding_correction.assert_awaited_once()
    _, kwargs = mock_agui_emitter.on_grounding_correction.call_args
    assert kwargs["original"] == "I've waived your fee!"
    assert "fwr-123" in kwargs["corrected"]


@pytest.mark.asyncio
async def test_process_agui_message_no_correction_on_grounded_reply(
    mock_config, mock_session_manager, mock_websocket_handler, mock_agui_emitter,
):
    agent = Mock()
    agent.initialize_session_with_token = AsyncMock(return_value=None)
    agent.llm = Mock()
    agent.config = Mock()
    agent.config.langchain = Mock(max_iterations=25)
    agent._pre_model_hook = Mock()
    agent._checkpointer = Mock()
    agent.mcp_tool_provider = Mock()
    agent.mcp_tool_provider.set_session_context = AsyncMock(return_value=None)
    agent._build_system_message = AsyncMock(return_value="System prompt")
    graph = Mock()
    graph.get_state = Mock(return_value=Mock(values={}))

    async def fake_astream_events(agent_input, config=None, version="v2"):
        class _Chunk:
            content = "Your checking balance is $1,204.55."

        yield {"event": "on_chat_model_stream", "data": {"chunk": _Chunk()}}
        yield {
            "event": "on_chat_model_end",
            "data": {"output": Mock(usage_metadata=None, tool_calls=[]), "input": {"messages": []}},
            "metadata": {},
        }

    graph.astream_events = fake_astream_events
    agent._graph = graph

    processor = MessageProcessor(
        agent=agent,
        session_manager=mock_session_manager,
        websocket_handler=mock_websocket_handler,
        config=mock_config,
    )
    await processor.process_agui_message(
        session_id="s1",
        message="What's my balance?",
        auth_token="tok",
        emitter=mock_agui_emitter,
        bff_tool_url="",
        tool_schemas=None,
        messages_list=None,
    )
    mock_agui_emitter.on_grounding_correction.assert_not_awaited()
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd langchain_agent && python -m pytest tests/test_message_processor.py -k grounding -v`
Expected: FAIL — no `on_grounding_correction` call is ever made (the wiring doesn't exist yet), so `assert_awaited_once()` raises `AssertionError`.

- [ ] **Step 7: Wire the guardrail into `process_agui_message`**

In `langchain_agent/src/api/message_processor.py`, add the import near the top of the file (alongside the other module-level imports, e.g. right after the existing `logger = logging.getLogger(__name__)` line or wherever the file's other top-level imports live):

```python
from agent.grounding_guardrail import (
    CommitmentGroundingValidator,
    ToolCallRecord,
    contains_commitment_claim,
)
from guardrails.validator_base import FailResult
```

Then in `process_agui_message` (lines 726–1092):

1. Before the `async for event in active_graph.astream_events(...)` loop (after line 1005, `total_output_tokens = 0`), add:

```python
        turn_reply_text = ""
        pending_tool_calls: dict = {}
        turn_tool_calls: list = []
```

2. Inside the `elif event_name == "on_chat_model_stream":` branch, immediately after the existing `if token:` block starts (right after line 1020's `if not llm_streaming:` / before or alongside `await emitter.on_llm_new_token(token)` at line 1024), append the token to the buffer — insert a new line right after line 1024:

```python
                    await emitter.on_llm_new_token(token)
                    turn_reply_text += token
```

3. Inside the `elif event_name == "on_tool_start":` branch (lines 1060–1070), after `tool_call_id = event.get("run_id")` (line 1065), record the pending call:

```python
                tool_call_id = event.get("run_id")
                pending_tool_calls[tool_call_id] = {
                    "name": event.get("name", "unknown_tool"),
                    "args": event_data.get("input"),
                }
```

4. Inside the `elif event_name == "on_tool_end":` branch (lines 1072–1075), after `tool_call_id = event.get("run_id")` (line 1074), complete the record:

```python
                tool_call_id = event.get("run_id")
                pending = pending_tool_calls.pop(tool_call_id, None)
                if pending is not None:
                    turn_tool_calls.append(
                        ToolCallRecord(name=pending["name"], args=pending["args"], result=str(output))
                    )
```

(`output` is already bound on the line above this branch, at the existing line 1073.)

5. After the loop ends and the LLM message is closed (after line 1087's `await emitter.on_llm_end()`, before line 1089's `if total_input_tokens or total_output_tokens:`), add the grounding check:

```python
        if contains_commitment_claim(turn_reply_text):
            async def _chat_fn(prompt: str) -> str:
                resp = await run_llm.ainvoke([HumanMessage(content=prompt)])
                return _content_to_text(getattr(resp, "content", ""))

            validator = CommitmentGroundingValidator(chat_fn=_chat_fn, on_fail="fix")
            check = await validator.async_validate(
                turn_reply_text, {"tool_calls": turn_tool_calls}
            )
            if isinstance(check, FailResult):
                await emitter.on_grounding_correction(
                    original=turn_reply_text,
                    corrected=check.fix_value,
                    note=check.error_message,
                )
```

(`run_llm`, `HumanMessage`, and `_content_to_text` are all already in scope/imported in this function — `run_llm` from line 808/per-run override logic, `HumanMessage` from the function's own import at line 765, `_content_to_text` used already at line 1019.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd langchain_agent && python -m pytest tests/test_message_processor.py tests/agui/test_grounding_correction_event.py -v`
Expected: All tests PASS, including the two new grounding tests.

- [ ] **Step 9: Run the full langchain_agent test suite to check for regressions**

Run: `cd langchain_agent && python -m pytest tests/ -v`
Expected: No new failures beyond the tests just added/modified.

- [ ] **Step 10: Commit**

```bash
cd langchain_agent
git add src/agui/emitter.py src/api/message_processor.py tests/agui/test_grounding_correction_event.py tests/test_message_processor.py
git commit -m "feat(langchain_agent): wire commitment-grounding guardrail into process_agui_message"
```

---

## Task 3: openai_agent — grounding guardrail module (regex + validator, unit-tested in isolation)

**Files:**
- Create: `openai_agent/src/grounding_guardrail.py`
- Create: `openai_agent/tests/test_grounding_guardrail.py`
- Modify: `openai_agent/requirements.txt`
- Modify: `openai_agent/Dockerfile`

**Interfaces:**
- Produces: identical names/shapes to Task 1 (`contains_commitment_claim`, `ToolCallRecord`, `CommitmentGroundingValidator`) — same module content as `langchain_agent/src/agent/grounding_guardrail.py`, just at this service's own path (no shared import between services, per design).

- [ ] **Step 1: Write the failing tests**

Create `openai_agent/tests/test_grounding_guardrail.py` with **the exact same test content as Task 1 Steps 1 and 5 combined** (all 10 test functions: `TestContainsCommitmentClaim` and `TestCommitmentGroundingValidator`), changing only the import line to:

```python
from src.grounding_guardrail import (
    contains_commitment_claim,
    ToolCallRecord,
    CommitmentGroundingValidator,
)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd openai_agent && python -m pytest tests/test_grounding_guardrail.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.grounding_guardrail'`

- [ ] **Step 3: Implement the module**

Create `openai_agent/src/grounding_guardrail.py` with **the exact same content as `langchain_agent/src/agent/grounding_guardrail.py`** (both the regex pre-filter from Task 1 Step 3 and `CommitmentGroundingValidator`/`ToolCallRecord`/prompt template/`_format_tool_results`/`_extract_json_object` from Task 1 Step 7, concatenated in that order into one file).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd openai_agent && python -m pytest tests/test_grounding_guardrail.py -v`
Expected: All 10 tests PASS.

- [ ] **Step 5: Add the `guardrails-ai` dependency**

In `openai_agent/requirements.txt`, add a new line after line 9 (`pytest-mock>=3.14.0`):
```
guardrails-ai==0.10.2
```

- [ ] **Step 6: Provision `.guardrailsrc` in the Dockerfile**

Read `openai_agent/Dockerfile` to find its `pip install` step and append, chained with `&&`:
```dockerfile
&& guardrails configure --disable-metrics --disable-remote-inferencing --token ""
```

- [ ] **Step 7: Commit**

```bash
cd openai_agent
git add src/grounding_guardrail.py tests/test_grounding_guardrail.py requirements.txt Dockerfile
git commit -m "feat(openai_agent): add commitment-grounding guardrail module"
```

---

## Task 4: openai_agent — wire the guardrail into `run_agent()`

**Files:**
- Modify: `openai_agent/src/agui_emitter.py`
- Modify: `openai_agent/src/run_handler.py`
- Modify: `openai_agent/tests/test_run_handler.py`

**Interfaces:**
- Consumes: `contains_commitment_claim`, `ToolCallRecord`, `CommitmentGroundingValidator` from Task 3 (`src.grounding_guardrail`); `FailResult` from `guardrails.validator_base`.
- Produces: `AGUIEmitter.on_grounding_correction(original: str, corrected: str, note: str) -> None`; `AGUIEmitter` gains internal turn-scoped accumulators `self._turn_reply_text: str` and `self._turn_tool_calls: list[ToolCallRecord]` (populated by the existing `on_llm_token`/`on_tool_start`/`on_tool_end` methods — no change to their public signatures).

- [ ] **Step 1: Write the failing emitter test**

```python
# openai_agent/tests/test_agui_emitter_grounding.py
import pytest
from src.agui_emitter import AGUIEmitter


@pytest.mark.asyncio
async def test_on_grounding_correction_emits_custom_event():
    events = []

    async def sink(evt):
        events.append(evt)

    emitter = AGUIEmitter("run-1", "thread-1", sink)
    await emitter.on_grounding_correction(
        original="I've waived your fee!",
        corrected="I've submitted a fee waiver request (ID: fwr-123) for human review.",
        note="overclaim",
    )
    assert len(events) == 1
    assert events[0]["type"] == "CUSTOM"
    assert events[0]["name"] == "grounding_correction"
    assert "fwr-123" in events[0]["value"]["corrected"]


@pytest.mark.asyncio
async def test_emitter_accumulates_turn_reply_text_and_tool_calls():
    emitter = AGUIEmitter("run-1", "thread-1", lambda evt: None.__class__())  # sink unused directly here

    async def noop_sink(evt):
        pass

    emitter = AGUIEmitter("run-1", "thread-1", noop_sink)
    await emitter.on_llm_start()
    await emitter.on_llm_token("I've ")
    await emitter.on_llm_token("waived your fee!")
    assert emitter._turn_reply_text == "I've waived your fee!"

    await emitter.on_tool_start("request_fee_waiver", "call_1", '{"account_id": "acc_1"}')
    await emitter.on_tool_end("call_1", '{"requestId": "fwr-123", "status": "logged_for_review"}')
    assert len(emitter._turn_tool_calls) == 1
    assert emitter._turn_tool_calls[0].name == "request_fee_waiver"
    assert "fwr-123" in emitter._turn_tool_calls[0].result
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd openai_agent && python -m pytest tests/test_agui_emitter_grounding.py -v`
Expected: FAIL — `AttributeError: 'AGUIEmitter' object has no attribute 'on_grounding_correction'` (and `_turn_reply_text` doesn't exist).

- [ ] **Step 3: Add accumulators and `on_grounding_correction` to the emitter**

In `openai_agent/src/agui_emitter.py`:

Add the import at the top (line 5 area, alongside the existing `from typing import Any, Callable`):
```python
from .grounding_guardrail import ToolCallRecord
```

Modify `__init__` (lines 11–15) to add two new fields and a pending-call tracker:
```python
    def __init__(self, run_id: str, thread_id: str, sink: Callable) -> None:
        self._run_id = run_id
        self._thread_id = thread_id
        self._sink = sink
        self._current_message_id: str | None = None
        self._turn_reply_text: str = ""
        self._turn_tool_calls: list = []
        self._pending_tool_calls: dict = {}
```

Modify `on_llm_token` (lines 33–36) to accumulate:
```python
    async def on_llm_token(self, token: str) -> None:
        self._turn_reply_text += token
        if not self._current_message_id:
            return
        await self._emit({"type": "TEXT_MESSAGE_CONTENT", "messageId": self._current_message_id, "delta": token})
```

Modify `on_tool_start` (lines 43–46) to record the pending call:
```python
    async def on_tool_start(self, tool_name: str, tool_call_id: str, args_json: str) -> None:
        self._pending_tool_calls[tool_call_id] = {"name": tool_name, "args": args_json}
        await self._emit({"type": "TOOL_CALL_START", "toolCallId": tool_call_id, "toolCallName": tool_name})
        if args_json:
            await self._emit({"type": "TOOL_CALL_ARGS", "toolCallId": tool_call_id, "delta": args_json})
```

Modify `on_tool_end` (lines 48–60) to complete the record:
```python
    async def on_tool_end(self, tool_call_id: str, result: Any) -> None:
        pending = self._pending_tool_calls.pop(tool_call_id, None)
        if pending is not None:
            self._turn_tool_calls.append(
                ToolCallRecord(name=pending["name"], args=pending["args"], result=str(result))
            )
        # STATE_DELTA.delta must be a JSON-Patch op ARRAY (the client runs it
        # through applyJsonPatch) — a plain dict is silently dropped. Mirror the
        # shape used by bff_tool_adapter._emit_token_events.
        value = result if isinstance(result, dict) else {"result": str(result)}
        await self._emit({
            "type": "STATE_DELTA",
            "delta": [
                {"op": "add", "path": "/toolResults/-",
                 "value": {"toolCallId": tool_call_id, "result": value}},
            ],
        })
        await self._emit({"type": "TOOL_CALL_END", "toolCallId": tool_call_id})
```

Add the new method (after `on_usage`, lines 62–67):
```python
    async def on_grounding_correction(self, original: str, corrected: str, note: str) -> None:
        await self._emit({
            "type": "CUSTOM",
            "name": "grounding_correction",
            "value": {"original": original, "corrected": corrected, "correctionNote": note},
        })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd openai_agent && python -m pytest tests/test_agui_emitter_grounding.py -v`
Expected: PASS.

- [ ] **Step 5: Run the existing emitter/handler suite to check for regressions**

Run: `cd openai_agent && python -m pytest tests/ -v`
Expected: No new failures.

- [ ] **Step 6: Write the failing integration test in `test_run_handler.py`**

Append to `openai_agent/tests/test_run_handler.py`:

```python
from src.agui_emitter import AGUIEmitter
from guardrails.validator_base import FailResult


def test_run_emits_grounding_correction_on_overclaiming_reply():
    """When the reply overclaims relative to tool results, a CUSTOM
    grounding_correction event must appear before RUN_FINISHED."""
    with patch("src.run_handler.build_agent") as mock_build, \
         patch("src.run_handler.Runner") as mock_runner_cls, \
         patch(
             "src.grounding_guardrail.CommitmentGroundingValidator.async_validate",
             new=AsyncMock(
                 return_value=FailResult(
                     error_message="overclaim",
                     fix_value="I've submitted a fee waiver request (ID: fwr-123) for human review.",
                 )
             ),
         ):
        mock_agent = MagicMock()
        mock_build.return_value = mock_agent
        mock_result = MagicMock()

        async def fake_stream_events():
            from agents.stream_events import RawResponsesStreamEvent
            from openai.types.responses import ResponseTextDeltaEvent
            yield RawResponsesStreamEvent(data=ResponseTextDeltaEvent(
                delta="I've waived your fee!", item_id="i1", output_index=0,
                content_index=0, type="response.output_text.delta", sequence_number=1,
                logprobs=[],
            ))

        mock_result.stream_events = fake_stream_events
        mock_result.usage = None
        mock_runner_cls.run_streamed.return_value = mock_result

        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD)

    events = _parse_sse(resp.text)
    custom_events = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "grounding_correction"]
    assert len(custom_events) == 1
    assert "fwr-123" in custom_events[0]["value"]["corrected"]
    run_finished_idx = next(i for i, e in enumerate(events) if e["type"] == "RUN_FINISHED")
    grounding_idx = next(i for i, e in enumerate(events) if e["type"] == "CUSTOM" and e["name"] == "grounding_correction")
    assert grounding_idx < run_finished_idx


def test_run_emits_no_grounding_correction_on_grounded_reply():
    with patch("src.run_handler.build_agent") as mock_build, \
         patch("src.run_handler.Runner") as mock_runner_cls:
        mock_agent = MagicMock()
        mock_build.return_value = mock_agent
        mock_result = MagicMock()

        async def fake_stream_events():
            from agents.stream_events import RawResponsesStreamEvent
            from openai.types.responses import ResponseTextDeltaEvent
            yield RawResponsesStreamEvent(data=ResponseTextDeltaEvent(
                delta="Your checking balance is $1,204.55.", item_id="i1", output_index=0,
                content_index=0, type="response.output_text.delta", sequence_number=1,
                logprobs=[],
            ))

        mock_result.stream_events = fake_stream_events
        mock_result.usage = None
        mock_runner_cls.run_streamed.return_value = mock_result

        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD)

    events = _parse_sse(resp.text)
    custom_events = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "grounding_correction"]
    assert len(custom_events) == 0
```

If constructing a real `ResponseTextDeltaEvent` in the test fails because the installed `openai` SDK version requires additional fields, run the failing test first (Step 7 below) and adjust the constructor call to match the actual required fields reported by the resulting `pydantic.ValidationError` — do not guess further fields speculatively.

- [ ] **Step 7: Run tests to verify the new integration tests fail**

Run: `cd openai_agent && python -m pytest tests/test_run_handler.py -k grounding -v`
Expected: FAIL — no `grounding_correction` CUSTOM event is emitted yet (wiring doesn't exist in `run_agent()`/`_handle_sdk_event` yet).

- [ ] **Step 8: Wire the guardrail into `run_agent()`**

In `openai_agent/src/run_handler.py`, add the import near the top (after line 16, `from .config import get_config`):
```python
from .grounding_guardrail import CommitmentGroundingValidator, contains_commitment_claim
from guardrails.validator_base import FailResult
```

Modify `run_agent()` (lines 113–159): after the streaming loop ends (after line 139, `await _handle_sdk_event(event, emitter)`, before line 140 `usage = getattr(result, "usage", None)`), insert:

```python
            if contains_commitment_claim(emitter._turn_reply_text):
                async def _chat_fn(prompt: str) -> str:
                    completion = await client.chat.completions.create(
                        model=model,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0,
                    )
                    return completion.choices[0].message.content or ""

                validator = CommitmentGroundingValidator(chat_fn=_chat_fn, on_fail="fix")
                check = await validator.async_validate(
                    emitter._turn_reply_text, {"tool_calls": emitter._turn_tool_calls}
                )
                if isinstance(check, FailResult):
                    await emitter.on_grounding_correction(
                        original=emitter._turn_reply_text,
                        corrected=check.fix_value,
                        note=check.error_message,
                    )
```

(`client` and `model` are already bound earlier in `run_agent()`, at lines 118 and the outer `_stream(...)` parameter respectively — both are in scope at this point in the function.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd openai_agent && python -m pytest tests/test_run_handler.py tests/test_agui_emitter_grounding.py -v`
Expected: All tests PASS.

- [ ] **Step 10: Run the full openai_agent test suite to check for regressions**

Run: `cd openai_agent && python -m pytest tests/ -v`
Expected: No new failures.

- [ ] **Step 11: Commit**

```bash
cd openai_agent
git add src/agui_emitter.py src/run_handler.py tests/test_agui_emitter_grounding.py tests/test_run_handler.py
git commit -m "feat(openai_agent): wire commitment-grounding guardrail into run_agent"
```

---

## Task 5: pydantic_agent — grounding guardrail module (regex + validator, unit-tested in isolation)

**Files:**
- Create: `pydantic_agent/src/grounding_guardrail.py`
- Create: `pydantic_agent/tests/test_grounding_guardrail.py`
- Modify: `pydantic_agent/requirements.txt`
- Modify: `pydantic_agent/Dockerfile`

**Interfaces:**
- Produces: identical names/shapes to Task 1/3 (`contains_commitment_claim`, `ToolCallRecord`, `CommitmentGroundingValidator`).

- [ ] **Step 1: Write the failing tests**

Create `pydantic_agent/tests/test_grounding_guardrail.py` with the exact same test content as Task 1 Steps 1 and 5, changing the import to:
```python
from src.grounding_guardrail import (
    contains_commitment_claim,
    ToolCallRecord,
    CommitmentGroundingValidator,
)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pydantic_agent && python -m pytest tests/test_grounding_guardrail.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.grounding_guardrail'`

- [ ] **Step 3: Implement the module**

Create `pydantic_agent/src/grounding_guardrail.py` with the exact same content as Task 1's module (Steps 3 and 7 concatenated).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pydantic_agent && python -m pytest tests/test_grounding_guardrail.py -v`
Expected: All 10 tests PASS.

- [ ] **Step 5: Add the `guardrails-ai` dependency**

In `pydantic_agent/requirements.txt`, add a new line after `respx>=0.21.0`:
```
guardrails-ai==0.10.2
```

- [ ] **Step 6: Provision `.guardrailsrc` in the Dockerfile**

Read `pydantic_agent/Dockerfile` to find its `pip install` step and append, chained with `&&`:
```dockerfile
&& guardrails configure --disable-metrics --disable-remote-inferencing --token ""
```

- [ ] **Step 7: Commit**

```bash
cd pydantic_agent
git add src/grounding_guardrail.py tests/test_grounding_guardrail.py requirements.txt Dockerfile
git commit -m "feat(pydantic_agent): add commitment-grounding guardrail module"
```

---

## Task 6: pydantic_agent — wire the guardrail into `stream_events()`

**Files:**
- Modify: `pydantic_agent/src/run_handler.py`
- Modify: `pydantic_agent/tests/test_run_handler.py`

**Interfaces:**
- Consumes: `contains_commitment_claim`, `ToolCallRecord`, `CommitmentGroundingValidator` from Task 5 (`src.grounding_guardrail`); `FailResult` from `guardrails.validator_base`; `pydantic_ai.messages.ToolCallPart`, `ToolReturnPart` (fields confirmed: `tool_name`, `args`/`content`, `tool_call_id`).
- Produces: no new emitter method needed — `AGUIEmitter.emit(event: dict)` (already public, already used directly in this file at line 140 for the initial-token-events replay) is reused directly for the `grounding_correction` CUSTOM event.

- [ ] **Step 1: Write the failing integration tests**

Append to `pydantic_agent/tests/test_run_handler.py`:

```python
from guardrails.validator_base import FailResult


def _make_mock_agent_with_tool_call(tokens, tool_name, tool_args, tool_result):
    """Return a mock Agent whose run_stream yields tokens and whose
    all_messages()/get_output() expose one tool call for grounding checks."""
    from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart

    class FakeStreamResult:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def stream_text(self, delta: bool = False):
            for t in tokens:
                yield t

        async def get_output(self):
            return "".join(tokens)

        def all_messages(self, *, output_tool_return_content=None):
            return [
                ModelResponse(parts=[
                    ToolCallPart(tool_name=tool_name, args=tool_args, tool_call_id="call_1"),
                ]),
                ModelResponse(parts=[
                    ToolReturnPart(tool_name=tool_name, content=tool_result, tool_call_id="call_1"),
                ]),
            ]

    mock_agent = MagicMock()
    mock_agent.run_stream.return_value = FakeStreamResult()
    return mock_agent


def test_run_emits_grounding_correction_on_overclaiming_reply():
    mock_agent = _make_mock_agent_with_tool_call(
        ["I've waived your fee!"],
        "request_fee_waiver",
        {"account_id": "acc_1"},
        '{"requestId": "fwr-123", "status": "logged_for_review"}',
    )
    with patch("src.run_handler.build_agent", return_value=mock_agent), \
         patch(
             "src.grounding_guardrail.CommitmentGroundingValidator.async_validate",
             new=AsyncMock(
                 return_value=FailResult(
                     error_message="overclaim",
                     fix_value="I've submitted a fee waiver request (ID: fwr-123) for human review.",
                 )
             ),
         ):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    custom_events = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "grounding_correction"]
    assert len(custom_events) == 1
    assert "fwr-123" in custom_events[0]["value"]["corrected"]


def test_run_emits_no_grounding_correction_on_grounded_reply():
    mock_agent = _make_mock_agent_with_tool_call(
        ["Your checking balance is $1,204.55."],
        "get_accounts",
        {},
        '{"accounts": []}',
    )
    with patch("src.run_handler.build_agent", return_value=mock_agent):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    custom_events = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "grounding_correction"]
    assert len(custom_events) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pydantic_agent && python -m pytest tests/test_run_handler.py -k grounding -v`
Expected: FAIL — `get_output`/`all_messages` are called on a `MagicMock().run_stream.return_value`, which is fine (it's the real `FakeStreamResult` class defined in the test), but no `grounding_correction` event is emitted yet since the wiring doesn't exist.

- [ ] **Step 3: Wire the guardrail into `stream_events()`**

In `pydantic_agent/src/run_handler.py`, add the import near the top (after line 14, `from . import config as cfg`):
```python
from .grounding_guardrail import CommitmentGroundingValidator, ToolCallRecord, contains_commitment_claim
from guardrails.validator_base import FailResult
from pydantic_ai.messages import ToolCallPart, ToolReturnPart
```

Add a module-level helper function (after the imports, before `_error_stream`):
```python
def _extract_tool_calls(messages) -> list:
    pending: dict = {}
    records: list = []
    for msg in messages:
        for part in getattr(msg, "parts", []):
            if isinstance(part, ToolCallPart):
                pending[part.tool_call_id] = {"name": part.tool_name, "args": part.args}
            elif isinstance(part, ToolReturnPart):
                info = pending.pop(part.tool_call_id, None)
                if info is not None:
                    records.append(
                        ToolCallRecord(name=info["name"], args=info["args"], result=str(part.content))
                    )
    return records
```

Modify `stream_events()` (lines 126–203): inside the `async with agent.run_stream(...) as result:` block, immediately after the `async for text in result.stream_text(delta=True):` loop ends (after line 178, still inside the `async with` block, before it closes), add:

```python
                final_text = await result.get_output()
                turn_tool_calls = _extract_tool_calls(result.all_messages())

            if contains_commitment_claim(final_text):
                async def _chat_fn(prompt: str) -> str:
                    async with httpx.AsyncClient(timeout=15.0) as http_client:
                        resp = await http_client.post(
                            f"{cfg.LLM_BASE_URL}/chat/completions",
                            json={
                                "model": model,
                                "messages": [{"role": "user", "content": prompt}],
                                "temperature": 0,
                            },
                            headers={"Authorization": f"Bearer {cfg.LLM_API_KEY}"} if cfg.LLM_API_KEY else {},
                        )
                    resp.raise_for_status()
                    return resp.json()["choices"][0]["message"]["content"] or ""

                validator = CommitmentGroundingValidator(chat_fn=_chat_fn, on_fail="fix")
                check = await validator.async_validate(
                    final_text, {"tool_calls": turn_tool_calls}
                )
                if isinstance(check, FailResult):
                    await emitter.emit({
                        "type": "CUSTOM",
                        "name": "grounding_correction",
                        "value": {
                            "original": final_text,
                            "corrected": check.fix_value,
                            "correctionNote": check.error_message,
                        },
                    })
                    while collected:
                        yield collected.pop(0)
```

Note the dedent on the `if contains_commitment_claim(...)` block — it runs **after** the `async with agent.run_stream(...) as result:` block has closed (matching the existing structure where `await emitter.on_text_end(message_id)` at the current line 180 also runs after that block closes), but `final_text`/`turn_tool_calls` are captured **while still inside** the `async with` block per the note above, since `result.get_output()`/`result.all_messages()` are only valid before the stream context manager exits. Add `import httpx` at the top of the file if it is not already imported (check the current import block — it is not currently imported in this file, based on the verbatim file content read earlier).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pydantic_agent && python -m pytest tests/test_run_handler.py -v`
Expected: All tests PASS, including the two new grounding tests, and no regressions in the existing 6 tests in this file.

- [ ] **Step 5: Run the full pydantic_agent test suite to check for regressions**

Run: `cd pydantic_agent && python -m pytest tests/ -v`
Expected: No new failures.

- [ ] **Step 6: Commit**

```bash
cd pydantic_agent
git add src/run_handler.py tests/test_run_handler.py
git commit -m "feat(pydantic_agent): wire commitment-grounding guardrail into stream_events"
```

---

## Task 7: UI — `useAgentState.js` reducer picks up `grounding_correction`

**Files:**
- Modify: `demo_api_ui/src/hooks/useAgentState.js`
- Create: `demo_api_ui/src/hooks/__tests__/useAgentState.groundingCorrection.test.js`

**Interfaces:**
- Produces: `state.lastGroundingCorrection: { original: string, corrected: string, correctionNote: string } | null` (new field on the hook's returned `state`). Task 8 consumes this exact field name and shape.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_ui/src/hooks/__tests__/useAgentState.groundingCorrection.test.js
import { renderHook, act } from '@testing-library/react';
import { useAgentState } from '../useAgentState';

describe('useAgentState — grounding_correction CUSTOM event', () => {
  it('stores the correction payload in state.lastGroundingCorrection', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.handlers.onEvent({
        type: 'CUSTOM',
        name: 'grounding_correction',
        value: {
          original: "I've waived your fee!",
          corrected: "I've submitted a fee waiver request (ID: fwr-123) for human review.",
          correctionNote: 'overclaim',
        },
      });
    });
    expect(result.current.state.lastGroundingCorrection).toEqual({
      original: "I've waived your fee!",
      corrected: "I've submitted a fee waiver request (ID: fwr-123) for human review.",
      correctionNote: 'overclaim',
    });
  });

  it('resets lastGroundingCorrection to null on RUN_STARTED', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.handlers.onEvent({
        type: 'CUSTOM',
        name: 'grounding_correction',
        value: { original: 'a', corrected: 'b', correctionNote: 'c' },
      });
    });
    expect(result.current.state.lastGroundingCorrection).not.toBeNull();
    act(() => {
      result.current.handlers.onEvent({ type: 'RUN_STARTED' });
    });
    expect(result.current.state.lastGroundingCorrection).toBeNull();
  });

  it('ignores CUSTOM events with other names', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.handlers.onEvent({
        type: 'CUSTOM',
        name: 'token_usage',
        value: { inputTokens: 1, outputTokens: 2 },
      });
    });
    expect(result.current.state.lastGroundingCorrection).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/hooks/__tests__/useAgentState.groundingCorrection.test.js`
Expected: FAIL — `state.lastGroundingCorrection` is `undefined`, not `null`/the expected object (the field doesn't exist yet).

- [ ] **Step 3: Add the new state field and reducer case**

In `demo_api_ui/src/hooks/useAgentState.js`:

Add a new key to `INITIAL_STATE` (lines 26–48), after `lastTokenUsage: null,` (line 44):
```javascript
  lastTokenUsage: null,
  // Latest commitment-grounding correction (set by the CUSTOM
  // grounding_correction event; null = no correction this run).
  lastGroundingCorrection: null,
```

Modify the `RUN_STARTED` case (line 103–105) to reset it alongside `lastTokenUsage`:
```javascript
      case 'RUN_STARTED':
        setState((prev) => ({ ...prev, lastOutcome: null, error: null, hitlPending: null, lastTokenUsage: null, lastGroundingCorrection: null }));
        break;
```

Add a new `if` block inside the existing `case 'CUSTOM':` (lines 241–254), after the `llm_detail` block:
```javascript
      case 'CUSTOM':
        if (event.name === 'token_usage' && event.value) {
          setState((prev) => ({
            ...prev,
            lastTokenUsage: {
              inputTokens: event.value.inputTokens ?? 0,
              outputTokens: event.value.outputTokens ?? 0,
            },
          }));
        }
        if (event.name === 'llm_detail' && event.value) {
          tokenChainTraceStore.ingestLlmDetail(event.value);
        }
        if (event.name === 'grounding_correction' && event.value) {
          setState((prev) => ({
            ...prev,
            lastGroundingCorrection: {
              original: event.value.original,
              corrected: event.value.corrected,
              correctionNote: event.value.correctionNote,
            },
          }));
        }
        break;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/hooks/__tests__/useAgentState.groundingCorrection.test.js`
Expected: All 3 tests PASS.

- [ ] **Step 5: Run the full hooks test directory to check for regressions**

Run: `cd demo_api_ui && npx vitest run src/hooks/__tests__/`
Expected: No new failures.

- [ ] **Step 6: Commit**

```bash
cd demo_api_ui
git add src/hooks/useAgentState.js src/hooks/__tests__/useAgentState.groundingCorrection.test.js
git commit -m "feat(ui): reduce grounding_correction CUSTOM event into agent state"
```

---

## Task 8: UI — render the correction as a token-event chat bubble in `AIAgent.js`

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js`
- Create: `demo_api_ui/src/components/__tests__/AIAgent.groundingCorrection.test.js`

**Interfaces:**
- Consumes: `aguiState.lastGroundingCorrection` from Task 7.

- [ ] **Step 1: Write the failing test**

Model this directly on the existing `AIAgent.aguiError.test.js` (same mocks, same render helper). Create `demo_api_ui/src/components/__tests__/AIAgent.groundingCorrection.test.js`:

```javascript
/* eslint-disable testing-library/no-node-access */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({
    preset: { shortName: "Super Banking", name: "Super Banking" },
  }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => ({ open: jest.fn(), close: jest.fn() }),
  useEducationUI: () => ({ open: jest.fn(), close: jest.fn() }),
}));
vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => null,
}));
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: true, setAgentUi: jest.fn() }),
}));
vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    tokenSecondsLeft: 900,
    tokenLoading: false,
    staleSession: false,
    hasActiveToken: true,
  }),
}));
vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: jest.fn().mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: jest.fn().mockResolvedValue({
    source: "local",
    result: { kind: "action", action: { id: "accounts" } },
  }),
}));
vi.mock("../../services/demoAgentService", () => ({
  getMyAccounts: jest.fn().mockResolvedValue([]),
  getAccountBalance: jest.fn().mockResolvedValue({ balance: 100 }),
  getMyTransactions: jest.fn().mockResolvedValue([]),
  createTransfer: jest.fn().mockResolvedValue({ success: true }),
  createDeposit: jest.fn().mockResolvedValue({ success: true }),
  createWithdrawal: jest.fn().mockResolvedValue({ success: true }),
  refreshOAuthSession: jest.fn().mockResolvedValue({}),
  warmupAuthz: jest.fn().mockResolvedValue({}),
  callMcpTool: jest.fn().mockResolvedValue({ success: true }),
  sendAgentMessage: jest.fn().mockResolvedValue({ success: true, reply: "Done." }),
  fetchAgentTools: jest.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));
vi.mock("../../services/configService", () => ({
  loadPublicConfig: jest.fn().mockResolvedValue({}),
}));
vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: jest.fn(() => false),
  setAgentBlockedByConsentDecline: jest.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked by consent decline.",
  getConsentState: jest.fn(() => null),
  setConsentDeclined: jest.fn(),
}));
vi.mock("../../utils/agentToolSteps", () => ({
  getToolStepsForAction: jest.fn(() => []),
}));
vi.mock("react-toastify", () => ({
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
vi.mock("../../utils/appToast", () => ({
  toast: {
    info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(),
    warning: jest.fn(), update: jest.fn(), dismiss: jest.fn(),
  },
  notifySuccess: jest.fn(),
  notifyError: jest.fn(),
  notifyInfo: jest.fn(),
  notifyWarning: jest.fn(),
}));
vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

let mockGroundingCorrection = null;

vi.mock("../../hooks/useAgentState", () => ({
  useAgentState: () => ({
    state: {
      messages: [],
      toolCalls: [],
      tokenEvents: [],
      mcpTraffic: [],
      authorizeDecisions: [],
      lastTokenUsage: null,
      lastOutcome: null,
      hitlPending: null,
      error: null,
      lastGroundingCorrection: mockGroundingCorrection,
    },
    handlers: {},
    reset: jest.fn(),
  }),
}));

vi.mock("../../hooks/useAgentRun", () => ({
  useAgentRun: () => ({ run: jest.fn(), abort: jest.fn() }),
}));

import AIAgent from "../AIAgent";

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "bankUser",
  firstName: "Test",
  lastName: "User",
};

function renderAgent(props = {}) {
  return render(
    <MemoryRouter>
      <ActivityNarrativeProvider>
        <AIAgent {...props} />
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockGroundingCorrection = null;
});

describe("grounding correction surfaces in chat", () => {
  it("renders a token-event bubble when lastGroundingCorrection is set", async () => {
    mockGroundingCorrection = {
      original: "I've waived your fee!",
      corrected: "I've submitted a fee waiver request (ID: fwr-123) for human review.",
      correctionNote: "overclaim",
    };
    renderAgent({ user: customerUser, mode: "inline" });
    await waitFor(() => {
      expect(screen.getByText(/fwr-123/i)).toBeInTheDocument();
    });
  });

  it("renders nothing extra when there is no correction", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    await waitFor(() => {
      expect(screen.queryByText(/correction/i)).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.groundingCorrection.test.js`
Expected: FAIL — no bubble is rendered; `screen.getByText(/fwr-123/i)` throws.

- [ ] **Step 3: Add the effect that renders the correction bubble**

In `demo_api_ui/src/components/AIAgent.js`, immediately after the existing error-bubble effect (after line 1868, the `}, [aguiState.error]); // eslint-disable-line react-hooks/exhaustive-deps` line), add:

```javascript
  // AG-UI grounding correction → visible chat bubble. Mirrors the error-bubble
  // dedupe pattern above: useAgentState resets lastGroundingCorrection to null
  // on RUN_STARTED, so each new correction produces exactly one bubble.
  const aguiGroundingCorrectionRef = useRef(null);
  useEffect(() => {
    const correction = aguiState.lastGroundingCorrection;
    if (!correction) {
      aguiGroundingCorrectionRef.current = null;
      return;
    }
    if (aguiGroundingCorrectionRef.current === correction) return;
    aguiGroundingCorrectionRef.current = correction;
    addMessage(
      "token-event",
      `⚠️ Correction: ${correction.corrected}`,
    );
    // addMessage has stable identity for the life of the component; listing it
    // would re-fire this effect on unrelated renders.
  }, [aguiState.lastGroundingCorrection]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.groundingCorrection.test.js`
Expected: Both tests PASS.

- [ ] **Step 5: Run the existing AIAgent test files to check for regressions**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.aguiError.test.js src/components/__tests__/AIAgent.groundingCorrection.test.js`
Expected: No new failures.

- [ ] **Step 6: Commit**

```bash
cd demo_api_ui
git add src/components/AIAgent.js src/components/__tests__/AIAgent.groundingCorrection.test.js
git commit -m "feat(ui): render commitment-grounding corrections as chat bubbles"
```

---

## Final verification (after all 8 tasks)

- [ ] Run each Python service's full suite once more from a clean state: `cd langchain_agent && python -m pytest tests/ -v`, `cd openai_agent && python -m pytest tests/ -v`, `cd pydantic_agent && python -m pytest tests/ -v`.
- [ ] Run the UI's full test run: `cd demo_api_ui && npx vitest run`.
- [ ] Confirm none of the three Dockerfiles' `guardrails configure` line was accidentally made interactive (no bare `guardrails configure` without the three flags) — a build-time hang there would break every future Docker build of that service.
- [ ] Manually exercise the "Unauthorized Commitments" attack chip in the running demo (whichever agent framework is active per current config) and confirm: the original streamed reply appears as before, and — only when it overclaims — a follow-up `⚠️ Correction: ...` bubble appears citing the real tool result (e.g. the `fwr-...` request ID).
