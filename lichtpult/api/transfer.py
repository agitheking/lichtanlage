from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import JSONResponse

from ..core import transfer
from ..core.engine import Conflict, NotFound
from ..core.productions import Invalid
from .deps import Services, services

router = APIRouter(prefix="/api")
S = Annotated[Services, Depends(services)]


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except NotFound as e:
        raise HTTPException(404, f"Nicht gefunden: {e}") from e
    except Conflict as e:
        raise HTTPException(409, str(e)) from e
    except Invalid as e:
        raise HTTPException(422, str(e)) from e


def _download(data: dict, filename: str) -> JSONResponse:
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _mode(data: Any, query: str | None, default: str | None) -> str | None:
    """Modus aus dem Körper ({…, "mode": …}) oder als Query-Parameter (z. B. bei roher Liste)."""
    if isinstance(data, dict) and "mode" in data:
        return data["mode"]
    return query if query is not None else default


async def _sync_show(s: Services) -> None:
    if s.show.sync():
        await s.push("show")


# ------------------------------------------------------------------- Export

@router.get("/productions/{pid}/export")
def export_production(pid: str, s: S):
    with s.productions.lock:
        p = _guard(s.productions.get, pid)
        return _download(transfer.production_export(p), f"lichtpult-produktion-{p.id}.json")


@router.get("/productions/{pid}/scenes/export")
def export_production_scenes(pid: str, s: S):
    with s.productions.lock:
        p = _guard(s.productions.get, pid)
        return _download(transfer.scenes_export(p.scenes), f"lichtpult-szenen-{p.id}.json")


@router.get("/scenes/export")
def export_library(s: S):
    with s.engine.lock:
        return _download(transfer.scenes_export(s.engine.scenes), "lichtpult-bibliothek.json")


# ------------------------------------------------------------------- Import

@router.post("/productions/import")
async def import_production(s: S, data: Annotated[dict, Body()], mode: str | None = None):
    p = _guard(transfer.import_production, s.productions, data, _mode(data, mode, None))
    await s.push("productions")
    await _sync_show(s)
    return p.model_dump()


@router.post("/productions/{pid}/scenes/import")
async def import_production_scenes(pid: str, s: S, data: Annotated[dict | list, Body()], mode: str | None = None):
    scenes = _guard(transfer.import_production_scenes, s.productions, pid, data, _mode(data, mode, "merge"))
    await s.push("productions")
    return [sc.model_dump() for sc in scenes]


@router.post("/scenes/import")
async def import_library(s: S, data: Annotated[dict | list, Body()], mode: str | None = None):
    scenes = _guard(transfer.import_library_scenes, s.engine, data, _mode(data, mode, "merge"))
    await s.push("scenes")
    return [sc.model_dump() for sc in scenes]
