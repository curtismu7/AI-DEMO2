"""
WR-02 Option A proof: per-session worker model for MessageProcessor.

These tests are the load-bearing evidence that the single global
message-queue worker has been replaced with a per-session worker model that:

1. Cross-session concurrency — a slow turn in session A does NOT block
   session B (head-of-line blocking across sessions is gone).
2. Intra-session ordering — turns within ONE session are processed strictly
   in arrival order, never reordered (the property B/C were rejected for
   losing).
3. Tracer isolation under real concurrency — each session's tool path reads
   ITS OWN WR-06 ContextVar tracer, never another session's (analogous to
   the CR-06 demux test, now that concurrency is real).
4. Cap + backpressure — exceeding the per-session-worker cap yields the
   defined backpressure response, not a crash or unbounded task spawn.
5. Idle reaping — an idle session's worker is reaped after TTL (task
   cancelled, no leak); a later message re-establishes a worker.
6. Reaper actually starts — regression guard against the CR-01 class of bug
   (a cleanup loop wired but never started).
"""
import asyncio

import pytest
from unittest.mock import Mock, AsyncMock

from src.api.message_processor import MessageProcessor
from src.models.chat import ChatMessage
from src.config.settings import SecurityConfig, ChatConfig, AppConfig

from tests.conftest import TEST_SECURITY_KWARGS


def _make_config(max_workers=50, idle_ttl=900, reap_interval=60):
    security_config = SecurityConfig(
        **{**TEST_SECURITY_KWARGS, "session_timeout_minutes": 30}
    )
    chat_config = ChatConfig(
        websocket_port=8080,
        max_message_length=1000,
        conversation_history_limit=50,
        session_cleanup_interval_minutes=5,
        max_session_workers=max_workers,
        session_worker_idle_ttl_seconds=idle_ttl,
        session_worker_reap_interval_seconds=reap_interval,
    )
    config = Mock(spec=AppConfig)
    config.security = security_config
    config.chat = chat_config
    return config


def _processor(config, agent=None):
    session_manager = AsyncMock()
    session_manager.is_session_active = AsyncMock(return_value=True)
    session_manager.add_message_to_session = AsyncMock(return_value=True)
    session_manager.add_session_context = AsyncMock(return_value=True)
    session_manager.get_session_context = AsyncMock(return_value=None)

    websocket_handler = AsyncMock()
    websocket_handler.send_message_to_session = AsyncMock(return_value=True)
    websocket_handler.send_chat_response = AsyncMock(return_value=True)
    websocket_handler.send_auth_request = AsyncMock(return_value=True)

    agent = agent or AsyncMock()
    return MessageProcessor(
        agent=agent,
        session_manager=session_manager,
        websocket_handler=websocket_handler,
        config=config,
    )


@pytest.mark.asyncio
async def test_cross_session_concurrency_no_head_of_line_blocking():
    """Session A artificially slow; session B must finish WITHOUT waiting."""
    config = _make_config()
    proc = _processor(config)

    order = []
    started = {}

    async def fake_process(content, session_id, stream_context=None):
        started[session_id] = asyncio.get_event_loop().time()
        if session_id == "A":
            await asyncio.sleep(0.5)  # A is the slow turn
        order.append(session_id)
        return f"resp-{session_id}"

    proc.agent.process_message_with_tracing = AsyncMock(side_effect=fake_process)

    await proc.start()
    try:
        await proc.process_chat_message(
            ChatMessage.create_user_message("A", "slow message")
        )
        await proc.process_chat_message(
            ChatMessage.create_user_message("B", "fast message")
        )

        # Wait until B has completed. If head-of-line blocking still
        # existed (single global worker), B would be stuck behind A's 0.5s.
        for _ in range(100):
            if "B" in order:
                break
            await asyncio.sleep(0.02)

        assert "B" in order, "session B did not complete (head-of-line block)"
        # B must finish BEFORE A despite being enqueued second.
        assert order.index("B") < order.index("A") if "A" in order else True
    finally:
        await proc.stop()


@pytest.mark.asyncio
async def test_intra_session_ordering_strict():
    """msg1 (slow) then msg2 in the SAME session: processed 1 then 2."""
    config = _make_config()
    proc = _processor(config)

    processed = []

    async def fake_process(content, session_id, stream_context=None):
        if content == "m1":
            await asyncio.sleep(0.3)  # first message slow
        processed.append(content)
        return "ok"

    proc.agent.process_message_with_tracing = AsyncMock(side_effect=fake_process)

    await proc.start()
    try:
        # Back-to-back: m2 enqueued before m1 finishes.
        await proc.process_chat_message(
            ChatMessage.create_user_message("S", "m1")
        )
        await proc.process_chat_message(
            ChatMessage.create_user_message("S", "m2")
        )

        for _ in range(100):
            if len(processed) >= 2:
                break
            await asyncio.sleep(0.02)

        assert processed == ["m1", "m2"], (
            f"intra-session order broken: {processed}"
        )
    finally:
        await proc.stop()


@pytest.mark.asyncio
async def test_tracer_isolation_under_concurrency():
    """Two concurrent sessions each see ONLY their own WR-06 ContextVar tracer."""
    from src.agent import mcp_tool_provider

    config = _make_config()
    proc = _processor(config)

    observed = {}

    async def fake_process(content, session_id, stream_context=None):
        # Mimic the real agent path: set the WR-06 ContextVar tracer, yield
        # to the loop so the OTHER session's worker runs, then read it back.
        mcp_tool_provider._current_tracer.set(f"tracer-{session_id}")
        if session_id == "A":
            await asyncio.sleep(0.3)
        else:
            await asyncio.sleep(0.05)
        # The tool path reads the contextvar AFTER the await.
        observed[session_id] = mcp_tool_provider._current_tracer.get()
        return "ok"

    proc.agent.process_message_with_tracing = AsyncMock(side_effect=fake_process)

    await proc.start()
    try:
        await proc.process_chat_message(
            ChatMessage.create_user_message("A", "a")
        )
        await proc.process_chat_message(
            ChatMessage.create_user_message("B", "b")
        )

        for _ in range(100):
            if len(observed) >= 2:
                break
            await asyncio.sleep(0.02)

        assert observed.get("A") == "tracer-A", observed
        assert observed.get("B") == "tracer-B", observed
    finally:
        await proc.stop()
        mcp_tool_provider._current_tracer.set(None)


@pytest.mark.asyncio
async def test_cap_and_backpressure():
    """Exceeding the per-session-worker cap yields a backpressure error."""
    config = _make_config(max_workers=2)
    proc = _processor(config)

    release = asyncio.Event()

    async def fake_process(content, session_id, stream_context=None):
        await release.wait()  # hold workers occupied so cap stays full
        return "ok"

    proc.agent.process_message_with_tracing = AsyncMock(side_effect=fake_process)

    await proc.start()
    try:
        # Two sessions saturate the cap of 2.
        await proc.process_chat_message(
            ChatMessage.create_user_message("S1", "x")
        )
        await proc.process_chat_message(
            ChatMessage.create_user_message("S2", "x")
        )
        for _ in range(100):
            if len(proc._session_workers) >= 2:
                break
            await asyncio.sleep(0.02)
        assert len(proc._session_workers) == 2

        # A third NEW session must be refused (backpressure), not spawned.
        proc.websocket_handler.send_message_to_session.reset_mock()
        await proc.process_chat_message(
            ChatMessage.create_user_message("S3", "x")
        )
        for _ in range(100):
            if proc.websocket_handler.send_message_to_session.called:
                break
            await asyncio.sleep(0.02)

        assert len(proc._session_workers) == 2, "cap exceeded — worker leak"
        call = proc.websocket_handler.send_message_to_session.call_args
        assert call[0][0] == "S3"
        assert call[0][1]["type"] == "error_response"
    finally:
        release.set()
        await proc.stop()


@pytest.mark.asyncio
async def test_idle_reaping_and_reestablish():
    """An idle worker is reaped after TTL; a later message re-creates one."""
    # 1s idle TTL, reap every 1s — fast for the test.
    config = _make_config(idle_ttl=1, reap_interval=1)
    proc = _processor(config)
    proc.agent.process_message_with_tracing = AsyncMock(return_value="ok")

    await proc.start()
    try:
        await proc.process_chat_message(
            ChatMessage.create_user_message("R", "hello")
        )
        for _ in range(100):
            if "R" in proc._session_workers:
                break
            await asyncio.sleep(0.02)
        worker = proc._session_workers.get("R")
        assert worker is not None
        task = worker.task

        # Wait out the idle TTL + a reap pass.
        for _ in range(200):
            if "R" not in proc._session_workers:
                break
            await asyncio.sleep(0.05)

        assert "R" not in proc._session_workers, "idle worker not reaped"
        assert task.done(), "reaped worker task not cancelled/finished (leak)"

        # A subsequent message re-establishes a worker.
        await proc.process_chat_message(
            ChatMessage.create_user_message("R", "again")
        )
        for _ in range(100):
            if "R" in proc._session_workers:
                break
            await asyncio.sleep(0.02)
        assert "R" in proc._session_workers, "worker not re-established"
    finally:
        await proc.stop()


@pytest.mark.asyncio
async def test_reaper_actually_starts():
    """CR-01-class guard: start() must schedule the idle reaper loop."""
    config = _make_config()
    proc = _processor(config)

    assert proc._reaper_task is None
    await proc.start()
    try:
        assert proc._reaper_task is not None
        assert not proc._reaper_task.done()
        stats = await proc.get_processor_stats()
        assert stats["reaper_running"] is True
    finally:
        await proc.stop()
    assert proc._reaper_task.done()


@pytest.mark.asyncio
async def test_session_close_tears_down_worker_and_discards_pending():
    """clear_session_data tears down the worker; pending discarded, no orphan."""
    config = _make_config()
    proc = _processor(config)

    gate = asyncio.Event()

    async def fake_process(content, session_id, stream_context=None):
        await gate.wait()
        return "ok"

    proc.agent.process_message_with_tracing = AsyncMock(side_effect=fake_process)

    await proc.start()
    try:
        # First message occupies the worker; second queues behind it.
        await proc.process_chat_message(
            ChatMessage.create_user_message("C", "m1")
        )
        await proc.process_chat_message(
            ChatMessage.create_user_message("C", "m2")
        )
        for _ in range(100):
            if "C" in proc._session_workers:
                break
            await asyncio.sleep(0.02)
        worker = proc._session_workers["C"]
        task = worker.task

        await proc.clear_session_data("C")

        assert "C" not in proc._session_workers
        assert task.done(), "worker task not cancelled on close (orphan)"
    finally:
        gate.set()
        await proc.stop()


def _dead_worker(session_id):
    """Build a _SessionWorker whose task has already finished (a corpse)."""
    from src.api.message_processor import _SessionWorker

    worker = _SessionWorker(session_id)

    async def _noop():
        pass

    worker.task = asyncio.create_task(_noop())
    return worker


@pytest.mark.asyncio
async def test_dead_worker_discarded_and_recreated():
    """A registered worker whose task is done is treated as absent:
    _get_or_create_session_worker discards it and creates a fresh one
    instead of stranding the session behind a corpse."""
    config = _make_config()
    proc = _processor(config)

    dead = _dead_worker("D")
    await dead.task  # ensure the task is finished
    proc._session_workers["D"] = dead

    worker = await proc._get_or_create_session_worker("D")
    try:
        assert worker is not None
        assert worker is not dead, "dead worker must be discarded, not returned"
        assert worker.task is not None and not worker.task.done()
        assert proc._session_workers["D"] is worker
    finally:
        await proc._teardown_session_worker("D", reason="test cleanup")


@pytest.mark.asyncio
async def test_crashed_worker_self_deregisters():
    """A worker loop that crashes removes itself from _session_workers in
    its finally block, so the session can get a new worker later."""
    config = _make_config()
    proc = _processor(config)
    proc._handle_queued_message = AsyncMock(side_effect=RuntimeError("boom"))

    await proc.start()
    try:
        await proc.process_chat_message(
            ChatMessage.create_user_message("X", "m1")
        )
        # The worker crashes on its first message and must deregister itself.
        for _ in range(100):
            if proc._handle_queued_message.called and "X" not in proc._session_workers:
                break
            await asyncio.sleep(0.02)

        assert proc._handle_queued_message.called
        assert "X" not in proc._session_workers, (
            "crashed worker left registered — session permanently stranded"
        )
    finally:
        await proc.stop()


@pytest.mark.asyncio
async def test_dead_worker_reaped_despite_pending_queue():
    """A dead worker (task done) is reapable even with a non-empty queue and
    recent activity — its queue can never drain, so it must not be exempt."""
    config = _make_config(idle_ttl=900, reap_interval=60)
    proc = _processor(config)

    dead = _dead_worker("Q")
    await dead.task
    await dead.queue.put({"type": "chat_message"})  # non-empty queue
    proc._session_workers["Q"] = dead

    reaped = await proc._reap_idle_workers_once()

    assert reaped == 1
    assert "Q" not in proc._session_workers
