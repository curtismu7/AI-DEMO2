"""Opt-in A2A tasks, streaming and guarded push callbacks for the LangChain agent.

A plain ``message/send`` still returns one Message. These pieces only run when
the caller sets ``metadata.task``, calls ``message/stream``, or asks for a task
by id, so the existing gateway path is untouched.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import os
import socket
import sqlite3
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger(__name__)

TERMINAL_STATES = {"completed", "failed", "canceled", "rejected"}
TASK_TTL_SECONDS = 24 * 60 * 60
NOTIFICATION_TOKEN_HEADER = "X-A2A-Notification-Token"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- task store


class TaskStore:
    """Tasks and push callbacks in SQLite, scoped to the caller that made them.

    Durable across a process restart. The file lives in the pod unless
    ``A2A_TASK_DB`` points at a mounted volume.
    """

    def __init__(self, path: Optional[str] = None) -> None:
        self._path = path or os.environ.get("A2A_TASK_DB") or os.path.join(tempfile.gettempdir(), "langchain-a2a-tasks.db")
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self._path, check_same_thread=False)
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, context_id TEXT, payload TEXT NOT NULL, expires_at REAL NOT NULL)"
        )
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS push (task_id TEXT NOT NULL, owner TEXT NOT NULL, config_id TEXT NOT NULL, url TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY (task_id, config_id))"
        )
        self._db.commit()

    def save(self, task: dict[str, Any], owner: str) -> None:
        with self._lock:
            current = self._db.execute("SELECT owner, payload FROM tasks WHERE id = ?", (task["id"],)).fetchone()
            if current and current[0] != owner:
                return
            if current and json.loads(current[1])["status"]["state"] in TERMINAL_STATES:
                return
            self._db.execute(
                "INSERT OR REPLACE INTO tasks (id, owner, context_id, payload, expires_at) VALUES (?, ?, ?, ?, ?)",
                (task["id"], owner, task.get("contextId"), json.dumps(task), time.time() + TASK_TTL_SECONDS),
            )
            self._db.commit()

    def get(self, task_id: str, owner: str) -> Optional[dict[str, Any]]:
        with self._lock:
            row = self._db.execute(
                "SELECT payload FROM tasks WHERE id = ? AND owner = ? AND expires_at > ?", (task_id, owner, time.time())
            ).fetchone()
        return json.loads(row[0]) if row else None

    def add_push(self, task_id: str, owner: str, url: str, token: str) -> dict[str, Any]:
        config_id = str(uuid.uuid4())
        with self._lock:
            self._db.execute(
                "INSERT INTO push (task_id, owner, config_id, url, token) VALUES (?, ?, ?, ?, ?)",
                (task_id, owner, config_id, url, token),
            )
            self._db.commit()
        return {"id": config_id, "url": url, "token": token}

    def push_for(self, task_id: str, owner: str) -> list[dict[str, str]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT config_id, url, token FROM push WHERE task_id = ? AND owner = ?", (task_id, owner)
            ).fetchall()
        return [{"id": r[0], "url": r[1], "token": r[2]} for r in rows]


_store: Optional[TaskStore] = None


def task_store() -> TaskStore:
    global _store
    if _store is None:
        _store = TaskStore()
    return _store


def set_task_store(store: Optional[TaskStore]) -> None:
    """Test seam."""

    global _store
    _store = store


# ---------------------------------------------------------------- push guard


def allowed_hosts() -> list[str]:
    return [h.strip().lower() for h in os.environ.get("A2A_PUSH_ALLOWED_HOSTS", "").split(",") if h.strip()]


def push_enabled() -> bool:
    """Push is offered only when at least one callback host is allowlisted."""

    return bool(allowed_hosts())


def is_private_address(raw: str) -> bool:
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return True
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified
    )


async def _resolve(host: str) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


async def assert_push_url_allowed(
    url: str,
    hosts: Optional[list[str]] = None,
    resolver: Callable[[str], Awaitable[list[str]]] = _resolve,
) -> None:
    """Raise ValueError unless ``url`` is https, on the allowlist, and resolves only to public addresses."""

    parts = urlsplit(url or "")
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError("push notification url must be https")
    host = parts.hostname.lower()
    if host not in (allowed_hosts() if hosts is None else hosts):
        raise ValueError(f'push notification host "{host}" is not on the allowlist')
    try:
        ipaddress.ip_address(host)
        addresses = [host]
    except ValueError:
        addresses = await resolver(host)
    if not addresses or any(is_private_address(a) for a in addresses):
        raise ValueError("push notification url resolves to a private address")


async def notify_push(
    task: dict[str, Any],
    owner: str,
    client: Optional[httpx.AsyncClient] = None,
    resolver: Callable[[str], Awaitable[list[str]]] = _resolve,
) -> int:
    """Post the task to each registered callback that still passes the guard. Returns how many were sent."""

    sent = 0
    for config in task_store().push_for(task["id"], owner):
        try:
            await assert_push_url_allowed(config["url"], resolver=resolver)
        except ValueError as exc:
            logger.warning("[A2A] push callback dropped at send time: %s", exc)
            continue
        try:
            if client is not None:
                await client.post(config["url"], json=task, headers={NOTIFICATION_TOKEN_HEADER: config["token"]})
            else:
                async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as own:
                    await own.post(config["url"], json=task, headers={NOTIFICATION_TOKEN_HEADER: config["token"]})
            sent += 1
        except httpx.HTTPError as exc:
            logger.warning("[A2A] push callback failed: %s", exc)
    return sent


# ---------------------------------------------------------------- task shapes


def new_task(context_id: Optional[str] = None) -> dict[str, Any]:
    return {
        "kind": "task",
        "id": str(uuid.uuid4()),
        "contextId": context_id or str(uuid.uuid4()),
        "status": {"state": "working", "timestamp": now_iso()},
        "artifacts": [],
        "history": [],
    }


def result_artifact(text: str, metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "artifactId": str(uuid.uuid4()),
        "name": "agent-reply",
        "description": "The LangChain agent's reply",
        "parts": [{"kind": "text", "text": text}],
        **({"metadata": metadata} if metadata else {}),
    }


def finish(task: dict[str, Any], state: str, artifact: Optional[dict[str, Any]], message: str = "") -> dict[str, Any]:
    if artifact:
        task["artifacts"].append(artifact)
    task["status"] = {"state": state, "timestamp": now_iso()}
    if message:
        task["status"]["message"] = {
            "kind": "message",
            "messageId": str(uuid.uuid4()),
            "role": "agent",
            "parts": [{"kind": "text", "text": message}],
        }
    return task


# ---------------------------------------------------------------- running tasks


class TaskRun:
    """A task running in the background, with every event it has produced.

    The run belongs to the task, not to the connection that started it: a caller
    that drops the stream does not stop the task, and any number of callers can
    attach with ``tasks/resubscribe`` while it runs. In memory and per process:
    after a restart a stored task that was still working cannot be rejoined.
    """

    def __init__(self, task: dict[str, Any], owner: str) -> None:
        self.task = task
        self.owner = owner
        self.events: list[dict[str, Any]] = []
        self.done = False
        self.worker: Optional["asyncio.Task[None]"] = None
        self._changed = asyncio.Condition()

    async def publish(self, event: dict[str, Any]) -> None:
        async with self._changed:
            self.events.append(event)
            self._changed.notify_all()

    async def close(self) -> None:
        async with self._changed:
            self.done = True
            self._changed.notify_all()

    async def follow(self, start: int = 0):
        """Yield events from index ``start``, waiting for new ones until the run closes."""

        index = start
        while True:
            async with self._changed:
                await self._changed.wait_for(lambda: index < len(self.events) or self.done)
                batch = self.events[index:]
            if not batch:
                return
            for event in batch:
                yield event
            index += len(batch)


_runs: dict[str, TaskRun] = {}


def start_run(task: dict[str, Any], owner: str, drive: Callable[[TaskRun], Awaitable[None]]) -> TaskRun:
    """Run ``drive(run)`` in the background and register the run until it ends."""

    run = TaskRun(task, owner)
    _runs[task["id"]] = run

    async def runner() -> None:
        try:
            await drive(run)
        except Exception:
            logger.exception("[A2A] background task run failed")
        finally:
            await run.close()
            _runs.pop(task["id"], None)

    run.worker = asyncio.get_running_loop().create_task(runner())
    return run


def get_run(task_id: str, owner: str) -> Optional[TaskRun]:
    run = _runs.get(task_id)
    return run if run is not None and run.owner == owner else None


async def wait_for_run(task_id: str) -> None:
    """Wait for a registered run to end (a no-op if it already has). Test seam."""

    run = _runs.get(task_id)
    if run is not None and run.worker is not None:
        await run.worker
