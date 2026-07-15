"""Tests for POST /codegraph/query — CodeGraph Explorer SSE endpoint."""
from __future__ import annotations

import os
from unittest.mock import patch, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage

import src.api.codegraph_handler as handler
from src.api.codegraph_handler import router, _build_messages

app = FastAPI()
app.include_router(router, prefix="/codegraph")
client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_runner_cache():
    """Reset memoized runner between tests."""
    handler._runner_cache = None
    handler._runner_cache_key = None
    yield
    handler._runner_cache = None
    handler._runner_cache_key = None


def _mock_runner(*, token: str = "Hello world", error: str | None = None, capture=None):
    runner = MagicMock()

    async def astream_sse(messages):
        if capture is not None:
            capture["messages"] = messages
        yield 'data: {"type": "status", "text": "Searching the codebase…"}\n\n'
        if error:
            yield f'data: {{"type": "error", "text": "{error}"}}\n\n'
        elif token:
            yield f'data: {{"type": "token", "text": "{token}"}}\n\n'
        yield 'data: {"type": "done"}\n\n'

    runner.astream_sse = astream_sse
    return runner


class TestCodegraphQuery:
    def test_returns_sse_stream(self):
        with patch("src.api.codegraph_handler.create_codegraph_agent", return_value=_mock_runner()), \
             patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            response = client.post("/codegraph/query", json={"question": "How does X work?"})

        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]
        body = response.text
        assert '"type": "token"' in body
        assert "Hello world" in body
        assert '"type": "done"' in body

    def test_empty_question_returns_400(self):
        response = client.post("/codegraph/query", json={"question": ""})
        assert response.status_code == 400

    def test_whitespace_only_question_returns_400(self):
        response = client.post("/codegraph/query", json={"question": "   "})
        assert response.status_code == 400

    def test_missing_anthropic_key_still_streams(self):
        env_without_key = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
        with patch("src.api.codegraph_handler.create_codegraph_agent", return_value=_mock_runner(token="ok")), \
             patch.dict("os.environ", env_without_key, clear=True):
            response = client.post("/codegraph/query", json={"question": "test"})
        assert response.status_code == 200

    def test_agent_creation_failure_returns_503(self):
        with patch("src.api.codegraph_handler.create_codegraph_agent", side_effect=Exception("DB missing")), \
             patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            response = client.post("/codegraph/query", json={"question": "test"})
        assert response.status_code == 503
        err = response.json()["error"]
        assert "CodeGraph LLM backend unavailable" in err
        assert "DB missing" in err

    def test_default_history_is_empty(self):
        with patch("src.api.codegraph_handler.create_codegraph_agent", return_value=_mock_runner(token="x")), \
             patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            response = client.post("/codegraph/query", json={"question": "test"})
        assert response.status_code == 200

    def test_done_event_always_emitted(self):
        with patch("src.api.codegraph_handler.create_codegraph_agent", return_value=_mock_runner(token="")), \
             patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            response = client.post("/codegraph/query", json={"question": "test"})
        assert '"type": "done"' in response.text

    def test_stream_error_emits_error_event_then_done(self):
        with patch("src.api.codegraph_handler.create_codegraph_agent",
                   return_value=_mock_runner(error="something broke")), \
             patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            response = client.post("/codegraph/query", json={"question": "test"})
        assert response.status_code == 200
        body = response.text
        assert '"type": "error"' in body
        assert "something broke" in body
        assert '"type": "done"' in body

    def test_history_is_passed_to_agent(self):
        captured = {}
        history = [
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
        ]
        with patch("src.api.codegraph_handler.create_codegraph_agent",
                   return_value=_mock_runner(capture=captured)), \
             patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            client.post("/codegraph/query", json={"question": "follow up", "history": history})

        msgs = captured.get("messages", [])
        assert len(msgs) == 3
        assert isinstance(msgs[0], HumanMessage)
        assert isinstance(msgs[1], AIMessage)
        assert isinstance(msgs[2], HumanMessage)
        assert msgs[2].content == "follow up"


class TestCodegraphReindex:
    """POST /codegraph/reindex — live index refresh."""

    @staticmethod
    def _write_indexer(root, body: str) -> None:
        scripts = root / "scripts"
        scripts.mkdir(parents=True, exist_ok=True)
        (scripts / "build-codegraph.py").write_text(body)

    def test_missing_indexer_returns_503(self, tmp_path):
        with patch("src.api.codegraph_handler.repo_src_root", return_value=tmp_path):
            response = client.post("/codegraph/reindex")
        assert response.status_code == 503
        assert "indexer not found" in response.json()["error"]

    def test_busy_lock_returns_409(self, tmp_path):
        self._write_indexer(tmp_path, "print('noop')\n")
        busy = MagicMock()
        busy.locked.return_value = True
        with patch("src.api.codegraph_handler.repo_src_root", return_value=tmp_path), \
             patch("src.api.codegraph_handler._reindex_lock", busy):
            response = client.post("/codegraph/reindex")
        assert response.status_code == 409
        busy.locked.assert_called_once()

    def test_success_parses_counts(self, tmp_path):
        db = tmp_path / "codegraph.db"
        self._write_indexer(
            tmp_path,
            "import sys\n"
            "from pathlib import Path\n"
            "print('  Indexing 5 files from X')\n"
            "print('  Found 12 nodes, 3 call sites')\n"
            "out = Path(sys.argv[sys.argv.index('--out') + 1])\n"
            "out.parent.mkdir(parents=True, exist_ok=True)\n"
            "out.write_bytes(b'x' * 64)\n",
        )
        with patch("src.api.codegraph_handler.repo_src_root", return_value=tmp_path), \
             patch("src.api.codegraph_handler.CODEGRAPH_DB_PATH", str(db)), \
             patch("codegraph.ensure_index.CODEGRAPH_DB_PATH", str(db)), \
             patch("codegraph.ensure_index._BAKED_INDEXER", tmp_path / "missing.py"):
            response = client.post("/codegraph/reindex")
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["files"] == 5
        assert data["nodes"] == 12
        assert isinstance(data["durationMs"], int)
        assert db.is_file() and db.stat().st_size > 0

    def test_unparseable_output_yields_null_counts(self, tmp_path):
        db = tmp_path / "codegraph.db"
        self._write_indexer(
            tmp_path,
            "import sys\n"
            "from pathlib import Path\n"
            "print('done, nothing to parse here')\n"
            "out = Path(sys.argv[sys.argv.index('--out') + 1])\n"
            "out.write_bytes(b'x' * 64)\n",
        )
        with patch("src.api.codegraph_handler.repo_src_root", return_value=tmp_path), \
             patch("src.api.codegraph_handler.CODEGRAPH_DB_PATH", str(db)), \
             patch("codegraph.ensure_index.CODEGRAPH_DB_PATH", str(db)), \
             patch("codegraph.ensure_index._BAKED_INDEXER", tmp_path / "missing.py"):
            response = client.post("/codegraph/reindex")
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["files"] is None
        assert data["nodes"] is None

    def test_legacy_indexer_without_out_is_promoted(self, tmp_path):
        query_db = tmp_path / "query" / "codegraph.db"
        legacy = tmp_path / ".codegraph" / "codegraph.db"
        self._write_indexer(
            tmp_path,
            "from pathlib import Path\n"
            "print('  Indexing 2 files from X')\n"
            "print('  Found 9 nodes, 1 call sites')\n"
            "p = Path('.codegraph') / 'codegraph.db'\n"
            "p.parent.mkdir(parents=True, exist_ok=True)\n"
            "p.write_bytes(b'legacy-db' * 8)\n",
        )
        with patch("src.api.codegraph_handler.repo_src_root", return_value=tmp_path), \
             patch("src.api.codegraph_handler.CODEGRAPH_DB_PATH", str(query_db)), \
             patch("codegraph.ensure_index.CODEGRAPH_DB_PATH", str(query_db)), \
             patch("codegraph.ensure_index._BAKED_INDEXER", tmp_path / "missing.py"):
            response = client.post("/codegraph/reindex")
        assert response.status_code == 200
        assert response.json()["nodes"] == 9
        assert query_db.is_file() and query_db.stat().st_size > 0
        assert legacy.is_file()

    def test_indexer_failure_returns_500_with_log(self, tmp_path):
        self._write_indexer(tmp_path, "import sys\nprint('boom')\nsys.exit(1)\n")
        with patch("src.api.codegraph_handler.repo_src_root", return_value=tmp_path):
            response = client.post("/codegraph/reindex")
        assert response.status_code == 500
        body = response.json()
        assert "non-zero" in body["error"]
        assert "boom" in body["log"]


class TestBuildMessages:
    def test_converts_history_and_question(self):
        history = [
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
        ]
        messages = _build_messages("second question", history)
        assert len(messages) == 3
        assert isinstance(messages[0], HumanMessage)
        assert isinstance(messages[1], AIMessage)
        assert isinstance(messages[2], HumanMessage)
        assert messages[2].content == "second question"

    def test_empty_history(self):
        messages = _build_messages("question", [])
        assert len(messages) == 1
        assert isinstance(messages[0], HumanMessage)
        assert messages[0].content == "question"

    def test_unknown_role_is_skipped(self):
        history = [{"role": "system", "content": "ignored"}]
        messages = _build_messages("q", history)
        assert len(messages) == 1
        assert messages[0].content == "q"

    def test_question_is_last_message(self):
        messages = _build_messages("final", [{"role": "user", "content": "first"}])
        assert messages[-1].content == "final"
        assert isinstance(messages[-1], HumanMessage)
