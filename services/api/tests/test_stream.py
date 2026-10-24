"""FR-08: SSE fan-out, slow clients, disconnect cleanup."""

from __future__ import annotations

import asyncio
import json

from app.api.stream import format_sse, sse_events
from app.services.broker import QUEUE_SIZE, Broker


def _parse(frame: str) -> tuple[str, dict[str, object]]:
    lines = dict(
        line.split(": ", 1) for line in frame.strip().splitlines() if not line.startswith(":")
    )
    return lines["event"], json.loads(lines["data"])


def test_format_sse() -> None:
    assert format_sse("x", {"a": 1}, 3) == 'id: 3\nevent: x\ndata: {"a":1}\n\n'


def test_stream_delivers_then_cleans_up_on_disconnect() -> None:
    async def run() -> None:
        broker = Broker()
        broker.bind_loop(asyncio.get_running_loop())
        disconnected = False

        async def is_disconnected() -> bool:
            return disconnected

        gen = sse_events(broker, {"hello": True}, is_disconnected, heartbeat_s=0.05)
        assert _parse(await anext(gen)) == ("hello", {"hello": True})
        assert broker.subscriber_count == 1
        broker.publish("observation", {"id": "o1"})
        assert _parse(await anext(gen)) == ("observation", {"id": "o1"})
        assert (await anext(gen)).startswith(": heartbeat")
        disconnected = True
        try:
            await anext(gen)
            raise AssertionError("generator should stop after disconnect")
        except StopAsyncIteration:
            pass
        assert broker.subscriber_count == 0

    asyncio.run(run())


def test_cancelled_client_unsubscribes() -> None:
    async def run() -> None:
        broker = Broker()
        broker.bind_loop(asyncio.get_running_loop())

        async def never() -> bool:
            return False

        gen = sse_events(broker, {}, never, heartbeat_s=10)
        await anext(gen)
        task = asyncio.create_task(anext(gen))
        await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await gen.aclose()
        assert broker.subscriber_count == 0

    asyncio.run(run())


def test_slow_client_gets_resync() -> None:
    async def run() -> None:
        broker = Broker()
        broker.bind_loop(asyncio.get_running_loop())
        sub = broker.subscribe()
        for i in range(QUEUE_SIZE + 5):
            broker.publish("observation", {"i": i})
        await asyncio.sleep(0.05)
        types = []
        while not sub.queue.empty():
            types.append(sub.queue.get_nowait().type)
        assert "resync" in types
        assert len(types) < QUEUE_SIZE + 5

    asyncio.run(run())


def test_publish_from_worker_thread() -> None:
    async def run() -> None:
        broker = Broker()
        broker.bind_loop(asyncio.get_running_loop())
        sub = broker.subscribe()
        await asyncio.to_thread(broker.publish, "simulation", {"ok": True})
        msg = await asyncio.wait_for(sub.get(), timeout=1)
        assert (msg.type, msg.data) == ("simulation", {"ok": True})

    asyncio.run(run())
