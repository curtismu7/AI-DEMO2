from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.a2a_handler import router, set_agent, set_transaction_token_validator
from authentication.token_validator import TokenValidationError


class FakeAgent:
    def __init__(self):
        self.calls = []

    async def process_message(self, text, session_id):
        self.calls.append((text, session_id))
        return "Delegated reply"


def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def reject_token(_token):
    raise TokenValidationError("rejected")


def test_agent_card_advertises_privilege_compatible_jsonrpc(monkeypatch):
    monkeypatch.setenv(
        "PRIVILEGE_A2A_PUBLIC_URL",
        "https://gateway.example/langchainagent/a2a/jsonrpc",
    )
    response = client().get("/a2a/.well-known/agent-card.json")
    assert response.status_code == 200
    card = response.json()
    assert card["protocolVersion"] == "0.3.0"
    assert card["preferredTransport"] == "JSONRPC"
    assert card["url"] == "https://gateway.example/langchainagent/a2a/jsonrpc"


def test_jsonrpc_requires_cryptographically_valid_privilege_token():
    set_transaction_token_validator(reject_token)
    response = client().post(
        "/a2a/jsonrpc",
        headers={"txn-token": "forged"},
        json={"jsonrpc": "2.0", "id": "1", "method": "message/send", "params": {}},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == -32001


def test_jsonrpc_message_send_runs_agent_without_echoing_transaction_token():
    fake = FakeAgent()
    set_agent(fake)
    set_transaction_token_validator(lambda _token: {"client_id": "privilege-caller"})
    response = client().post(
        "/a2a/jsonrpc",
        headers={"txn-token": "signed-gateway-token"},
        json={
            "jsonrpc": "2.0",
            "id": "request-1",
            "method": "message/send",
            "params": {
                "message": {
                    "role": "user",
                    "messageId": "message-1",
                    "parts": [{"kind": "text", "text": "Summarize account access"}],
                }
            },
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["result"]["parts"] == [{"kind": "text", "text": "Delegated reply"}]
    assert "signed-gateway-token" not in response.text
    assert fake.calls[0][0] == "Summarize account access"
    assert fake.calls[0][1].startswith("a2a-")
