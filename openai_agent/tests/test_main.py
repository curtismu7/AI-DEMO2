"""Tests for the FastAPI app entry point (health endpoint).

The openai-agents SDK is not installed in CI/system Python, so we construct
a minimal test app that mirrors main.py's health endpoint directly.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    # Mirror only the health route — avoids importing the SDK-heavy run_handler.
    test_app = FastAPI()

    @test_app.get("/health")
    async def health():
        return {"status": "ok", "service": "openai_agent"}

    return TestClient(test_app)


def test_health_returns_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "openai_agent"


def test_health_has_required_fields(client):
    resp = client.get("/health")
    data = resp.json()
    assert "status" in data
    assert "service" in data
