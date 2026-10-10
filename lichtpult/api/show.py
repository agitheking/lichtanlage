from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.engine import NotFound
from ..core.productions import Invalid
from ..core.show import NotRunning
from .deps import Services, services

router = APIRouter(prefix="/api/show")
S = Annotated[Services, Depends(services)]


async def _step(s: Services, fn, *args) -> dict:
    try:
        changed, moved = fn(*args)
    except NotFound as e:
        raise HTTPException(404, f"Nicht gefunden: {e}") from e
    except NotRunning as e:
        raise HTTPException(409, str(e)) from e
    except Invalid as e:
        raise HTTPException(422, str(e)) from e
    if changed:
        await s.push("levels", levels=changed)
    if moved:
        await s.push("show")
    return s.show.payload()


class StartBody(BaseModel):
    productionId: str | None = None  # leer = aktive Produktion


class GotoBody(BaseModel):
    cueIndex: int


@router.get("")
def get_show(s: S):
    return s.show.payload()


@router.post("/start")
async def start(s: S, body: StartBody | None = None):
    return await _step(s, s.show.start, (body or StartBody()).productionId)


@router.post("/next")
async def next_cue(s: S):
    return await _step(s, s.show.next)


@router.post("/prev")
async def prev_cue(s: S):
    return await _step(s, s.show.prev)


@router.post("/goto")
async def goto(body: GotoBody, s: S):
    return await _step(s, s.show.goto, body.cueIndex)


@router.post("/stop")
async def stop(s: S):
    return await _step(s, s.show.stop)
