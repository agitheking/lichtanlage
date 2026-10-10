from dataclasses import dataclass

from fastapi import Request

from ..core.broadcaster import Broadcaster
from ..core.engine import Engine
from ..core.productions import Productions
from ..core.show import Show
from ..dmx.output import DmxOutput


@dataclass
class Services:
    engine: Engine
    output: DmxOutput
    bus: Broadcaster
    productions: Productions
    show: Show

    def status(self) -> dict:
        from .. import __version__

        return {"dmx": self.output.status(), "version": __version__, "clients": len(self.bus.clients)}

    async def push(self, *kinds: str, origin: str | None = None, levels: dict | None = None) -> None:
        """Schickt geänderte Teile des Zustands an alle Clients."""
        e = self.engine
        for kind in kinds:
            if kind == "rig":
                msg = {"type": "rig", **e.rig_payload()}
            elif kind == "types":
                msg = {"type": "types", "types": e.types_payload()}
            elif kind == "stage":
                msg = {"type": "stage", "stage": e.stage.model_dump()}
            elif kind == "scenes":
                msg = {"type": "scenes", "scenes": e.scenes_payload()}
            elif kind == "productions":
                msg = {"type": "productions", **self.productions.payload()}
            elif kind == "show":
                msg = {"type": "show", "show": self.show.payload()}
            elif kind == "raw":
                msg = {"type": "raw", **e.raw_payload()}
            elif kind == "status":
                msg = {"type": "status", **self.status()}
            elif kind == "levels":
                msg = {"type": "levels", "fixtures": levels or {}, "grandMaster": e.state.grandMaster,
                       "blackout": e.state.blackout, "origin": origin}
            else:
                raise ValueError(kind)
            await self.bus.broadcast(msg)

    def hello(self, cid: str) -> dict:
        e = self.engine
        return {
            "type": "hello",
            "clientId": cid,
            "status": self.status(),
            **e.rig_payload(),
            "types": e.types_payload(),
            "stage": e.stage.model_dump(),
            "state": e.state_payload(),
            "scenes": e.scenes_payload(),
            "raw": e.raw_payload(),
            **self.productions.payload(),
            "show": self.show.payload(),
        }


def services(request: Request) -> Services:
    return request.app.state.services
