from fastapi.testclient import TestClient
from app import app
from agent import _completion_text

client = TestClient(app)

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_completion_text_extracts_human_answer_from_json():
    class Completion:
        raw = None
        def __str__(self):
            return '{"answer":"OAuth uses delegated tokens.","sources":[{"file":"lesson.md"}]}'

    assert _completion_text(Completion()) == "OAuth uses delegated tokens."


def test_ask_returns_grounded_shape(monkeypatch):
    import agent
    monkeypatch.setattr(agent, "run_agent", lambda q, cid, limit=8: {
        "answer": "Auth logic lives in auth.js.",
        "sources": [{"file": "auth.js", "line_start": 1, "line_end": 9, "snippet": "..."}],
        "toolCalls": 1,
        "mode": "agent",
    })
    r = client.post("/ask", json={"question": "where is auth?", "codebase_id": "ai-demo2-default"})
    assert r.status_code == 200
    body = r.json()
    assert body["answer"]
    assert body["sources"][0]["file"] == "auth.js"
    assert body["mode"] in ("agent", "single-shot")
    assert isinstance(body["toolCalls"], int)
