import asyncio
import base64
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import productions, routes, show, transfer, ws
from .api.deps import Services
from .config import DEFAULT_DATA_DIR, STATE_AUTOSAVE_S, STATIC_DIR
from .core.broadcaster import Broadcaster
from .core.engine import Engine
from .core.productions import Productions
from .core.show import Show
from .core.store import Store
from .dmx.output import DmxOutput

log = logging.getLogger(__name__)


def create_app(
    data_dir: Path = DEFAULT_DATA_DIR,
    *,
    sim: bool = False,
    serial_port: str | None = None,
    blackout_on_exit: bool = False,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        bus = Broadcaster()
        bus.bind_loop()
        store = Store(data_dir)
        engine = Engine(store)
        services_ref: dict = {}

        def on_status(_status: dict) -> None:
            if "s" in services_ref:
                bus.broadcast_threadsafe({"type": "status", **services_ref["s"].status()})

        output = DmxOutput(engine.compute_frame, sim=sim, port=serial_port, on_status=on_status)
        prods = Productions(store, engine)
        s = Services(engine=engine, output=output, bus=bus, productions=prods, show=Show(prods))
        services_ref["s"] = s
        app.state.services = s
        output.start()
        tasks = [asyncio.create_task(_periodic(s))]
        log.info("Lichtpult bereit – DMX: %s", output.status())
        try:
            yield
        finally:
            for t in tasks:
                t.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await t
            engine.autosave()
            output.stop(blackout=blackout_on_exit)

    app = FastAPI(title="Lichtpult", lifespan=lifespan)
    app.include_router(routes.router)
    app.include_router(transfer.router)
    app.include_router(productions.router)
    app.include_router(show.router)
    app.include_router(ws.router)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.middleware("http")
    async def no_stale_static(request, call_next):
        # lokale App: nach Updates immer die aktuellen Module laden (ETag-Revalidierung)
        response = await call_next(request)
        if request.url.path.startswith("/static/") and "/vendor/" not in request.url.path:
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    return app


async def _periodic(s: Services) -> None:
    """Autosave, Status-Heartbeat und DMX-Monitor-Frames."""
    tick = 0
    while True:
        await asyncio.sleep(0.2)
        tick += 1
        if s.bus.frame_subscribers:
            data = base64.b64encode(s.output.last_frame).decode()
            await s.bus.broadcast({"type": "dmx_frame", "data": data}, only=set(s.bus.frame_subscribers))
        if tick % 10 == 0:
            await s.push("status")
        if tick % int(STATE_AUTOSAVE_S / 0.2) == 0:
            await asyncio.to_thread(s.engine.autosave)
