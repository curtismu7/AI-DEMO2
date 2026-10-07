import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import a2a_tasks
from api.a2a_handler import public_router, router, set_agent, set_federated_token_validator
from authentication.federated_token_validator import FederatedCaller


class FakeAgent:
    def __init__(self, fail=False):
        self.fail = fail

    async def process_message(self, text, session_id):
        if self.fail:
            raise RuntimeError("boom")
        return "Delegated reply"


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.delenv("A2A_PUSH_ALLOWED_HOSTS", raising=False)
    a2a_tasks.set_task_store(a2a_tasks.TaskStore(str(tmp_path / "tasks.db")))
    set_agent(FakeAgent())
    yield
    a2a_tasks.set_task_store(None)
    set_federated_token_validator(None)


def client():
    app = FastAPI()
    app.include_router(router)
    app.include_router(public_router)
    return TestClient(app)


def as_user(sub):
    set_federated_token_validator(
        type("Validator", (), {"validate": lambda _self, token: FederatedCaller("tenant-a", sub, f"{sub}@example.test", ("agent:invoke",))})()
    )


def rpc(method, params, sub="user-a"):
    as_user(sub)
    return client().post(
        "/a2a/jsonrpc",
        headers={"Authorization": "Bearer customer-token"},
        json={"jsonrpc": "2.0", "id": "1", "method": method, "params": params},
    )


def message(**metadata):
    return {"message": {"role": "user", "messageId": "m1", "parts": [{"kind": "text", "text": "hello"}], "metadata": metadata}}


def test_plain_send_still_returns_one_message():
    result = rpc("message/send", message()).json()["result"]
    assert result["kind"] == "message"


def test_task_send_returns_a_completed_task_with_the_reply_as_an_artifact():
    result = rpc("message/send", message(task=True)).json()["result"]
    assert result["kind"] == "task"
    assert result["status"]["state"] == "completed"
    assert result["artifacts"][0]["parts"][0]["text"] == "Delegated reply"


def test_a_failing_agent_fails_the_task_without_leaking_the_error():
    set_agent(FakeAgent(fail=True))
    result = rpc("message/send", message(task=True)).json()["result"]
    assert result["status"]["state"] == "failed"
    assert "boom" not in json.dumps(result)


def test_tasks_get_is_owner_only():
    task_id = rpc("message/send", message(task=True)).json()["result"]["id"]
    assert rpc("tasks/get", {"id": task_id}).json()["result"]["id"] == task_id
    other = rpc("tasks/get", {"id": task_id}, sub="user-b")
    assert other.status_code == 404
    assert other.json()["error"]["code"] == -32001


def test_a_follow_up_keeps_the_context():
    first = rpc("message/send", message(task=True)).json()["result"]
    follow = message(task=True)
    follow["message"]["contextId"] = first["contextId"]
    second = rpc("message/send", follow).json()["result"]
    assert second["contextId"] == first["contextId"] and second["id"] != first["id"]


def test_the_task_survives_a_new_store_on_the_same_file(tmp_path):
    task_id = rpc("message/send", message(task=True)).json()["result"]["id"]
    reopened = a2a_tasks.TaskStore(str(tmp_path / "tasks.db"))
    assert reopened.get(task_id, "federated:tenant-a:user-a")["status"]["state"] == "completed"


def test_message_stream_sends_the_task_artifact_and_final_status():
    response = rpc("message/stream", message())
    assert response.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(line[5:])["result"] for line in response.text.splitlines() if line.startswith("data:")]
    assert [e["kind"] for e in events] == ["task", "artifact-update", "status-update"]
    assert events[-1]["final"] is True and events[-1]["status"]["state"] == "completed"


def test_card_advertises_streaming_and_push_only_with_an_allowlisted_host(monkeypatch):
    card = client().get("/.well-known/agent-card.json").json()
    assert card["capabilities"]["streaming"] is True and card["capabilities"]["pushNotifications"] is False
    monkeypatch.setenv("A2A_PUSH_ALLOWED_HOSTS", "hooks.example.com")
    assert client().get("/.well-known/agent-card.json").json()["capabilities"]["pushNotifications"] is True


def test_push_registration_is_refused_when_push_is_off():
    task_id = rpc("message/send", message(task=True)).json()["result"]["id"]
    response = rpc("tasks/pushNotificationConfig/set", {"taskId": task_id, "pushNotificationConfig": {"url": "https://hooks.example.com/cb"}})
    assert response.status_code == 400


def test_push_registration_refuses_an_unlisted_host_over_the_wire(monkeypatch):
    monkeypatch.setenv("A2A_PUSH_ALLOWED_HOSTS", "hooks.example.com")
    task_id = rpc("message/send", message(task=True)).json()["result"]["id"]
    response = rpc("tasks/pushNotificationConfig/set", {"taskId": task_id, "pushNotificationConfig": {"url": "https://169.254.169.254/x"}})
    assert response.status_code == 400 and "allowlist" in response.json()["error"]["message"]


async def public_resolver(_host):
    return ["93.184.216.34"]


@pytest.mark.parametrize(
    "url,why",
    [
        ("http://hooks.example.com/cb", "https"),
        ("https://evil.example.net/cb", "allowlist"),
        ("https://127.0.0.1/cb", "allowlist"),
    ],
)
async def test_guard_rejects(url, why):
    with pytest.raises(ValueError, match=why):
        await a2a_tasks.assert_push_url_allowed(url, hosts=["hooks.example.com"], resolver=public_resolver)


async def test_guard_rejects_an_allowlisted_host_that_resolves_private_and_accepts_a_public_one():
    async def private(_host):
        return ["10.0.0.5"]

    with pytest.raises(ValueError, match="private"):
        await a2a_tasks.assert_push_url_allowed("https://hooks.example.com/cb", hosts=["hooks.example.com"], resolver=private)
    await a2a_tasks.assert_push_url_allowed("https://hooks.example.com/cb", hosts=["hooks.example.com"], resolver=public_resolver)


async def test_a_registered_callback_is_posted_and_one_that_turns_private_is_dropped(monkeypatch):
    monkeypatch.setenv("A2A_PUSH_ALLOWED_HOSTS", "hooks.example.com")
    task = a2a_tasks.new_task()
    a2a_tasks.task_store().save(task, "owner")
    a2a_tasks.task_store().add_push(task["id"], "owner", "https://hooks.example.com/cb", "tok")
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200)

    async def private(_host):
        return ["10.0.0.5"]

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        assert await a2a_tasks.notify_push(task, "owner", client=http, resolver=public_resolver) == 1
        assert seen[0].headers[a2a_tasks.NOTIFICATION_TOKEN_HEADER] == "tok"
        assert await a2a_tasks.notify_push(task, "owner", client=http, resolver=private) == 0
