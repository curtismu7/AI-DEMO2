"""Reconnect over a real HTTP connection: a real uvicorn server on a real socket,
a stream dropped at the TCP level, and a rejoin from a brand-new connection."""

import asyncio
import json
import threading
import time

import httpx
import pytest
import uvicorn
from fastapi import FastAPI

from api import a2a_tasks
from api.a2a_handler import public_router, router, set_agent, set_federated_token_validator
from authentication.federated_token_validator import FederatedCaller


class GatedAgent:
    """Holds the turn until the test releases it, from any thread."""

    def __init__(self):
        self.release = threading.Event()

    async def process_message(self, text, session_id):
        await asyncio.get_running_loop().run_in_executor(None, self.release.wait)
        return "Delegated reply"


@pytest.fixture
def server(tmp_path):
    a2a_tasks.set_task_store(a2a_tasks.TaskStore(str(tmp_path / "tasks.db")))
    agent = GatedAgent()
    set_agent(agent)
    set_federated_token_validator(
        type("Validator", (), {"validate": lambda _self, token: FederatedCaller("tenant-a", "user-a", "a@example.test", ("agent:invoke",))})()
    )
    app = FastAPI()
    app.include_router(router)
    app.include_router(public_router)
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    uv = uvicorn.Server(config)
    thread = threading.Thread(target=uv.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not uv.started and time.time() < deadline:
        time.sleep(0.02)
    assert uv.started, "uvicorn did not start"
    port = uv.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}", agent
    agent.release.set()
    uv.should_exit = True
    thread.join(timeout=10)
    a2a_tasks.set_task_store(None)
    set_federated_token_validator(None)


HEADERS = {"Authorization": "Bearer customer-token"}


def rpc(method, params, rid="1"):
    return {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}


async def sse_events(response):
    async for line in response.aiter_lines():
        if line.startswith("data:"):
            yield json.loads(line[5:])["result"]


async def test_drop_the_stream_then_rejoin_on_a_new_connection_and_see_it_finish(server):
    base, agent = server
    message = {"message": {"role": "user", "messageId": "m1", "parts": [{"kind": "text", "text": "go"}]}}

    # Connection 1: start a streamed task, read the working snapshot, then drop the socket.
    async with httpx.AsyncClient(base_url=base, timeout=10) as first:
        async with first.stream("POST", "/a2a/jsonrpc", headers=HEADERS, json=rpc("message/stream", message)) as stream:
            assert stream.status_code == 200
            assert stream.headers["content-type"].startswith("text/event-stream")
            started = await anext(sse_events(stream))
            task_id = started["id"]
            assert started["status"]["state"] == "working"
    # leaving the context closed that connection; the agent is still holding the turn

    # Connection 2: a brand-new client rejoins the running task.
    async with httpx.AsyncClient(base_url=base, timeout=10) as second:
        async with second.stream("POST", "/a2a/jsonrpc", headers=HEADERS, json=rpc("tasks/resubscribe", {"id": task_id}, "2")) as rejoin:
            assert rejoin.status_code == 200
            events = sse_events(rejoin)
            snapshot = await anext(events)
            assert snapshot["id"] == task_id and snapshot["status"]["state"] == "working"
            agent.release.set()  # the turn finishes while the rejoined stream is open
            rest = [event async for event in events]

    assert [e["kind"] for e in rest] == ["artifact-update", "status-update"]
    assert rest[-1]["final"] is True and rest[-1]["status"]["state"] == "completed"
    assert rest[0]["artifact"]["parts"][0]["text"] == "Delegated reply"

    # The result was stored even though the first connection was gone, and a finished task cannot be rejoined.
    async with httpx.AsyncClient(base_url=base, timeout=10) as third:
        got = (await third.post("/a2a/jsonrpc", headers=HEADERS, json=rpc("tasks/get", {"id": task_id}, "3"))).json()["result"]
        assert got["status"]["state"] == "completed"
        again = await third.post("/a2a/jsonrpc", headers=HEADERS, json=rpc("tasks/resubscribe", {"id": task_id}, "4"))
        assert again.status_code == 400 and again.json()["error"]["code"] == -32004


async def test_a_dropped_stream_alone_does_not_lose_the_result(server):
    base, agent = server
    message = {"message": {"role": "user", "messageId": "m2", "parts": [{"kind": "text", "text": "go"}]}}
    async with httpx.AsyncClient(base_url=base, timeout=10) as first:
        async with first.stream("POST", "/a2a/jsonrpc", headers=HEADERS, json=rpc("message/stream", message)) as stream:
            task_id = (await anext(sse_events(stream)))["id"]
    agent.release.set()
    async with httpx.AsyncClient(base_url=base, timeout=10) as later:
        for _ in range(100):
            got = (await later.post("/a2a/jsonrpc", headers=HEADERS, json=rpc("tasks/get", {"id": task_id}))).json()["result"]
            if got["status"]["state"] != "working":
                break
            await asyncio.sleep(0.05)
    assert got["status"]["state"] == "completed"
