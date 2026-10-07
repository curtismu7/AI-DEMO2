import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import a2a_handler, a2a_tasks
from api.a2a_handler import public_router, router, set_agent, set_federated_token_validator
from authentication.federated_token_validator import FederatedCaller

OWNER = "federated:tenant-a:user-a"


class SlowAgent:
    """Holds every turn until the test opens the gate."""

    def __init__(self):
        self.gate = asyncio.Event()

    async def process_message(self, text, session_id):
        await self.gate.wait()
        return "Delegated reply"


@pytest.fixture(autouse=True)
def store(tmp_path):
    a2a_tasks.set_task_store(a2a_tasks.TaskStore(str(tmp_path / "tasks.db")))
    yield
    a2a_tasks.set_task_store(None)
    set_federated_token_validator(None)


async def read_events(response):
    events = []
    async for chunk in response.body_iterator:
        for line in (chunk if isinstance(chunk, str) else chunk.decode()).splitlines():
            if line.startswith("data:"):
                events.append(json.loads(line[5:])["result"])
    return events


async def start_and_drop(agent):
    """Start a streamed task, read its first event, then drop the connection."""

    set_agent(agent)
    response = a2a_handler._stream_task("1", {"message": {"parts": [{"text": "go"}]}}, "go", OWNER)
    first = await response.body_iterator.__anext__()
    await response.body_iterator.aclose()
    return json.loads(first[5:])["result"]["id"]


async def test_a_dropped_stream_does_not_cancel_the_task():
    agent = SlowAgent()
    task_id = await start_and_drop(agent)
    agent.gate.set()
    await a2a_tasks.wait_for_run(task_id)
    assert a2a_tasks.task_store().get(task_id, OWNER)["status"]["state"] == "completed"


async def test_resubscribe_gets_the_running_snapshot_then_the_finish():
    agent = SlowAgent()
    task_id = await start_and_drop(agent)

    response = a2a_handler._resubscribe("2", {"id": task_id}, OWNER)
    collected = asyncio.ensure_future(read_events(response))
    await asyncio.sleep(0.05)
    agent.gate.set()
    events = await collected

    assert [e["kind"] for e in events] == ["task", "artifact-update", "status-update"]
    assert events[0]["status"]["state"] == "working"
    assert events[-1]["final"] is True and events[-1]["status"]["state"] == "completed"


async def test_two_subscribers_each_see_the_finish():
    agent = SlowAgent()
    task_id = await start_and_drop(agent)
    first = asyncio.ensure_future(read_events(a2a_handler._resubscribe("2", {"id": task_id}, OWNER)))
    second = asyncio.ensure_future(read_events(a2a_handler._resubscribe("3", {"id": task_id}, OWNER)))
    await asyncio.sleep(0.05)
    agent.gate.set()
    for events in await asyncio.gather(first, second):
        assert events[-1]["status"]["state"] == "completed"


async def test_a_finished_unknown_or_foreign_task_cannot_be_resubscribed():
    agent = SlowAgent()
    task_id = await start_and_drop(agent)
    agent.gate.set()
    await a2a_tasks.wait_for_run(task_id)

    finished = a2a_handler._resubscribe("1", {"id": task_id}, OWNER)
    assert finished.status_code == 400 and json.loads(finished.body)["error"]["code"] == -32004

    unknown = a2a_handler._resubscribe("1", {"id": "no-such-task"}, OWNER)
    assert unknown.status_code == 404 and json.loads(unknown.body)["error"]["code"] == -32001

    agent2 = SlowAgent()
    other_id = await start_and_drop(agent2)
    foreign = a2a_handler._resubscribe("1", {"id": other_id}, "federated:tenant-a:someone-else")
    assert foreign.status_code == 404
    agent2.gate.set()
    await a2a_tasks.wait_for_run(other_id)


def test_the_jsonrpc_method_is_wired_and_reports_unknown_tasks():
    set_federated_token_validator(
        type("Validator", (), {"validate": lambda _self, token: FederatedCaller("tenant-a", "user-a", "a@example.test", ("agent:invoke",))})()
    )
    app = FastAPI()
    app.include_router(router)
    app.include_router(public_router)
    response = TestClient(app).post(
        "/a2a/jsonrpc",
        headers={"Authorization": "Bearer customer-token"},
        json={"jsonrpc": "2.0", "id": "1", "method": "tasks/resubscribe", "params": {"id": "missing"}},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == -32001
