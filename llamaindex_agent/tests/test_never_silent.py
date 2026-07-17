"""Never-silent contract: _completion_text must speak on EVERY path.

`except Exception: return ""` here once rendered as NOTHING in the UI — the
documented "HTTP 200 with sources but EMPTY answer" bug. Retrieval worked; the
model spent its whole budget on reasoning_content. An empty answer is
indistinguishable from a broken page, so every exit must say something.

If a refactor reintroduces a bare-empty return, this fails with the exact case.
"""
from agent import _completion_text, _is_truncated, EMPTY_ANSWER_NOTICE, TRUNCATION_NOTICE


class _Completion:
    def __init__(self, raw=None, text=""):
        self.raw = raw
        self._text = text

    def __str__(self):
        return self._text


def test_normal_content_passes_through_unchanged():
    assert _completion_text(_Completion(text="Here is your answer")) == "Here is your answer"


def test_empty_content_falls_back_to_reasoning():
    c = _Completion(raw={"choices": [{"message": {"reasoning_content": "thinking..."}}]})
    assert _completion_text(c) == "thinking..."


def test_empty_content_no_reasoning_speaks_not_silent():
    # This was the silent path: content "" and no reasoning_content -> "".
    c = _Completion(raw={"choices": [{"message": {}}]})
    assert _completion_text(c) == EMPTY_ANSWER_NOTICE


def test_garbage_raw_speaks_not_silent():
    assert _completion_text(_Completion(raw="not-a-dict")) == EMPTY_ANSWER_NOTICE


def test_raw_none_speaks_not_silent():
    assert _completion_text(_Completion(raw=None)) == EMPTY_ANSWER_NOTICE


def test_notices_are_real_text():
    # The fallbacks themselves must never be blanked out.
    assert EMPTY_ANSWER_NOTICE.strip()
    assert TRUNCATION_NOTICE.strip()


def test_is_truncated_reads_finish_reason():
    assert _is_truncated(_Completion(raw={"choices": [{"finish_reason": "length", "message": {}}]})) is True
    assert _is_truncated(_Completion(raw={"choices": [{"finish_reason": "stop", "message": {}}]})) is False
    # Unknown shapes must never mislabel a good answer.
    assert _is_truncated(_Completion(raw=None)) is False
