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
