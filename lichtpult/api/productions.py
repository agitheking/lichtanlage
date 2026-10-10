from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core.engine import Conflict, NotFound
from ..core.productions import Invalid
from .deps import Services, services
from .routes import CaptureBody, RecallBody, SceneUpdate

router = APIRouter(prefix="/api/productions")
S = Annotated[Services, Depends(services)]


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except NotFound as e:
        raise HTTPException(404, f"Nicht gefunden: {e}") from e
    except Invalid as e:
        raise HTTPException(422, str(e)) from e
    except (Conflict, ValueError) as e:
        raise HTTPException(400, str(e)) from e


# --------------------------------------------------------------- Produktionen

class NameBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.get("")
def list_productions(s: S):
    return s.productions.payload()


@router.post("")
async def create_production(body: NameBody, s: S):
    p = s.productions.create(body.name)
    await s.push("productions")
    return p.model_dump()


@router.put("/{pid}")
async def rename_production(pid: str, body: NameBody, s: S):
    p = _guard(s.productions.rename, pid, body.name)
    await s.push("productions")
    return p.model_dump()


@router.delete("/{pid}")
async def delete_production(pid: str, s: S):
    _guard(s.productions.delete, pid)
    await s.push("productions")
    return {"ok": True}


@router.post("/{pid}/activate")
async def activate_production(pid: str, s: S):
    _guard(s.productions.activate, pid)
    await s.push("productions")
    return s.productions.payload()


# --------------------------------------------------------------------- Szenen

@router.get("/{pid}/scenes")
def list_scenes(pid: str, s: S):
    return [sc.model_dump() for sc in _guard(s.productions.get, pid).scenes]


@router.post("/{pid}/scenes/capture")
async def capture_scene(pid: str, body: CaptureBody, s: S):
    sc = _guard(s.productions.capture_scene, pid, body.name, body.fade, body.sceneId)
    await s.push("productions")
    return sc.model_dump()


@router.post("/{pid}/scenes/reorder")
async def reorder_scenes(pid: str, s: S, ids: Annotated[list[str], Body(embed=True)]):
    scenes = _guard(s.productions.reorder_scenes, pid, ids)
    await s.push("productions")
    return [sc.model_dump() for sc in scenes]


@router.post("/{pid}/scenes/copy-from-library")
async def copy_from_library(pid: str, s: S, sceneIds: Annotated[list[str], Body(embed=True, min_length=1)]):
    copies = _guard(s.productions.copy_from_library, pid, sceneIds)
    await s.push("productions")
    return [sc.model_dump() for sc in copies]


@router.put("/{pid}/scenes/{sid}")
async def update_scene(pid: str, sid: str, body: SceneUpdate, s: S):
    sc = _guard(s.productions.update_scene, pid, sid, body.name, body.fadeSeconds)
    await s.push("productions")
    return sc.model_dump()


@router.delete("/{pid}/scenes/{sid}")
async def delete_scene(pid: str, sid: str, s: S):
    _guard(s.productions.delete_scene, pid, sid)
    await s.push("productions")
    return {"ok": True}


@router.post("/{pid}/scenes/{sid}/recall")
async def recall_scene(pid: str, sid: str, s: S, body: RecallBody | None = None):
    body = body or RecallBody()
    changed = _guard(s.productions.recall_scene, pid, sid, body.fade, body.othersOff)
    await s.push("levels", levels=changed)
    return changed


# ----------------------------------------------------------------------- Cues

class CueCreate(BaseModel):
    sceneId: str | None = None
    fadeSeconds: float | None = Field(None, ge=0, le=120)
    note: str = Field("", max_length=300)
    othersOff: bool = True


class CueUpdate(BaseModel):
    sceneId: str | None = None
    fadeSeconds: float | None = Field(None, ge=0, le=120)
    note: str | None = Field(None, max_length=300)
    othersOff: bool | None = None


@router.post("/{pid}/cues")
async def create_cue(pid: str, body: CueCreate, s: S):
    c = _guard(s.productions.add_cue, pid, body.model_dump())
    await s.push("productions")
    return c.model_dump()


@router.post("/{pid}/cues/reorder")
async def reorder_cues(pid: str, s: S, ids: Annotated[list[str], Body(embed=True)]):
    cues = _guard(s.productions.reorder_cues, pid, ids)
    await s.push("productions")
    return [c.model_dump() for c in cues]


@router.put("/{pid}/cues/{cid}")
async def update_cue(pid: str, cid: str, body: CueUpdate, s: S):
    # nur gesetzte Felder; explizites null bei sceneId/fadeSeconds ist erlaubt, bei note/othersOff nicht
    fields = body.model_dump(exclude_unset=True)
    for k in ("note", "othersOff"):
        if k in fields and fields[k] is None:
            raise HTTPException(422, f"„{k}“ darf nicht leer (null) sein")
    c = _guard(s.productions.update_cue, pid, cid, fields)
    await s.push("productions")
    return c.model_dump()


@router.delete("/{pid}/cues/{cid}")
async def delete_cue(pid: str, cid: str, s: S):
    _guard(s.productions.delete_cue, pid, cid)
    await s.push("productions")
    return {"ok": True}
