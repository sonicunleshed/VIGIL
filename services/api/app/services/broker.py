"""In-process pub/sub for server-sent events.

Single-process only (run one uvicorn worker). `publish` is thread-safe so sync
request handlers running in the threadpool can emit messages.
"""

from __future__ import annotations

import asyncio
import itertools
import threading
from dataclasses import dataclass
from typing import Any

QUEUE_SIZE = 1000


@dataclass(frozen=True)
class Message:
    id: int
    type: str
    data: dict[str, Any]


class Subscription:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[Message] = asyncio.Queue(maxsize=QUEUE_SIZE)

    async def get(self) -> Message:
        return await self.queue.get()


class Broker:
    def __init__(self) -> None:
        self._subs: set[Subscription] = set()
        self._lock = threading.Lock()
        self._ids = itertools.count(1)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subs)

    def subscribe(self) -> Subscription:
        sub = Subscription()
        with self._lock:
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        with self._lock:
            self._subs.discard(sub)

    def publish(self, type_: str, data: dict[str, Any]) -> None:
        msg = Message(next(self._ids), type_, data)
        with self._lock:
            subs = list(self._subs)
        if not subs or self._loop is None:
            return
        for sub in subs:
            self._loop.call_soon_threadsafe(_offer, sub, msg)


def _offer(sub: Subscription, msg: Message) -> None:
    """Enqueue; a client that falls too far behind gets a single `resync` instead."""
    try:
        sub.queue.put_nowait(msg)
    except asyncio.QueueFull:
        while not sub.queue.empty():
            sub.queue.get_nowait()
        sub.queue.put_nowait(Message(msg.id, "resync", {"reason": "client fell behind"}))
