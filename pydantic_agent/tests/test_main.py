"""Tests for the FastAPI app entry point (health, auth middleware).

pydantic-ai is not installed in CI/system Python, so we stub it and run_handler
at module-import time before the app is loaded.
"""
import sys
from unittest.mock import MagicMock, AsyncMock
import pytest

# Stub pydantic-ai and anything run_handler imports before app load.
for _mod in ('pydantic_ai', 'pydantic_ai.models', 'pydantic_ai.models.openai'):
    sys.modules.setdefault(_mod, MagicMock())

# Stub run_handler with an async callable so FastAPI can mount it.
async def _fake_handle_run(request):
    from fastapi.responses import JSONResponse
    return JSONResponse({"ok": True})

sys.modules['src.run_handler'] = MagicMock(handle_run=_fake_handle_run)

SECRET = "test-secret"


@pytest.fixture(autouse=True)
def _set_secret(monkeypatch):
    monkeypatch.setenv("BFF_INTERNAL_SECRET", SECRET)
    import src.config as cfg
    cfg.BFF_INTERNAL_SECRET = SECRET


@pytest.fixture
def client(_set_secret):
    from fastapi.testclient import TestClient
    from src.main import app
    return TestClient(app)


def test_health_returns_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "pydantic_ai"


def test_run_rejects_missing_secret(client):
    resp = client.post("/run", json={})
    assert resp.status_code == 401
    assert "x-internal-gateway-secret" in resp.json()["detail"]


def test_run_rejects_wrong_secret(client):
    resp = client.post("/run", json={}, headers={"x-internal-gateway-secret": "wrong"})
    assert resp.status_code == 403
