"""Verteilt Nachrichten an alle verbundenen WebSocket-Clients."""

import asyncio
import json
import logging

from fastapi import WebSocket

log = logging.getLogger(__name__)


class Broadcaster:
    def __init__(self) -> None:
        self.clients: dict[str, WebSocket] = {}
        self.frame_subscribers: set[str] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self) -> None:
        self.loop = asyncio.get_running_loop()

    def add(self, cid: str, ws: WebSocket) -> None:
        self.clients[cid] = ws

    def remove(self, cid: str) -> None:
        self.clients.pop(cid, None)
        self.frame_subscribers.discard(cid)

    async def send(self, cid: str, msg: dict) -> None:
        ws = self.clients.get(cid)
        if ws is None:
            return
        try:
            await ws.send_text(json.dumps(msg, separators=(",", ":")))
        except Exception:  # noqa: BLE001 – Client weg
            self.remove(cid)

    async def broadcast(self, msg: dict, only: set[str] | None = None) -> None:
        targets = list(self.clients) if only is None else [c for c in self.clients if c in only]
        await asyncio.gather(*(self.send(c, msg) for c in targets))

    def broadcast_threadsafe(self, msg: dict) -> None:
        """Aus fremden Threads (DMX-Loop) aufrufbar."""
        if self.loop is None or self.loop.is_closed():
            return
        self.loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self.broadcast(msg)))
