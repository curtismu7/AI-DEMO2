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
