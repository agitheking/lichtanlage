import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core.engine import Conflict, NotFound
from .deps import Services

log = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    s: Services = ws.app.state.services
    await ws.accept()
    cid = uuid.uuid4().hex[:8]
    s.bus.add(cid, ws)
    await s.bus.send(cid, s.hello(cid))
    await s.push("status")
    try:
        while True:
            try:
                msg = json.loads(await ws.receive_text())
                await handle(s, cid, msg)
            except (ValueError, KeyError, TypeError, NotFound, Conflict) as e:
                await s.bus.send(cid, {"type": "error", "message": str(e)})
    except WebSocketDisconnect:
        pass
    finally:
        s.bus.remove(cid)
        await s.push("status")


async def handle(s: Services, cid: str, msg: dict) -> None:
    e = s.engine
    match msg.get("type"):
        case "set_levels":
            changed = e.set_levels(msg["levels"], float(msg.get("fade", 0)))
            await s.push("levels", origin=cid, levels=changed)
        case "all":
            changed = e.set_all(float(msg["dimmer"]), float(msg.get("fade", 0)), msg.get("ids"))
            await s.push("levels", origin=cid, levels=changed)
        case "blackout":
            e.set_blackout(bool(msg["on"]))
            await s.push("levels", origin=cid)
        case "grandmaster":
            e.set_grandmaster(float(msg["value"]))
            await s.push("levels", origin=cid)
        case "set_raw":
            e.set_raw(msg.get("channels", {}), clear=bool(msg.get("clear")), solo=msg.get("solo"))
            await s.push("raw")
        case "clear_raw":
            e.clear_raw()
            await s.push("raw")
        case "identify":
            e.set_identify(msg["fixtureId"], bool(msg.get("on", True)), msg.get("address"), msg.get("typeId"))
            await s.push("raw")
        case "subscribe_frame":
            if msg.get("on", True):
                s.bus.frame_subscribers.add(cid)
            else:
                s.bus.frame_subscribers.discard(cid)
        case "ping":
            await s.bus.send(cid, {"type": "pong"})
        case other:
            raise ValueError(f"Unbekannter Nachrichtentyp: {other}")
