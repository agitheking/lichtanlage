
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..core.engine import Conflict, NotFound
from ..models.fixture_type import FixtureType
from ..models.rig import Fixture, Rig
from ..models.stage import StageGeometry
from .deps import Services, services

router = APIRouter(prefix="/api")
S = Annotated[Services, Depends(services)]


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except NotFound as e:
        raise HTTPException(404, f"Nicht gefunden: {e}") from e
    except (Conflict, ValueError) as e:
        raise HTTPException(400, str(e)) from e


# --------------------------------------------------------------------- Status

@router.get("/status")
def status(s: S):
    return s.status()


@router.post("/dmx/reconnect")
async def reconnect(s: S):
    s.output.reconnect()
    return s.status()


@router.get("/dmx/frame")
def dmx_frame(s: S):
    return list(s.output.last_frame)


class RawBody(BaseModel):
    channels: dict[int, int | None] = Field(default_factory=dict)
    clear: bool = False
    solo: bool | None = None


@router.post("/dmx/raw")
async def set_raw(body: RawBody, s: S):
    _guard(s.engine.set_raw, body.channels, clear=body.clear, solo=body.solo)
    await s.push("raw")
    return s.engine.raw_payload()


@router.delete("/dmx/raw")
async def clear_raw(s: S):
    s.engine.clear_raw()
    await s.push("raw")
    return s.engine.raw_payload()


# ------------------------------------------------------------------------ Rig

@router.get("/rig")
def get_rig(s: S):
    return s.engine.rig_payload()


@router.put("/rig")
async def put_rig(rig: Rig, s: S):
    _guard(s.engine.put_rig, rig)
    await s.push("rig")
    return s.engine.rig_payload()


@router.post("/rig/reset-default")
async def reset_rig(s: S):
    s.engine.reset_rig()
    await s.push("rig")
    return s.engine.rig_payload()


@router.get("/fixtures/new-id")
def new_fixture_id(s: S):
    return {"id": s.engine.new_fixture_id()}


@router.post("/fixtures")
async def create_fixture(fx: Fixture, s: S):
    if s.engine.rig.get(fx.id):
        raise HTTPException(400, f"Scheinwerfer „{fx.id}“ existiert bereits")
    _guard(s.engine.upsert_fixture, fx)
    await s.push("rig")
    return s.engine.rig_payload()


@router.put("/fixtures/{fixture_id}")
async def update_fixture(fixture_id: str, fx: Fixture, s: S):
    if fx.id != fixture_id:
        raise HTTPException(400, "ID im Pfad und im Körper unterscheiden sich")
    _guard(s.engine.upsert_fixture, fx)
    await s.push("rig")
    return s.engine.rig_payload()


@router.delete("/fixtures/{fixture_id}")
async def delete_fixture(fixture_id: str, s: S):
    _guard(s.engine.delete_fixture, fixture_id)
    await s.push("rig", "raw")
    return s.engine.rig_payload()


class IdentifyBody(BaseModel):
    on: bool = True
    address: int | None = Field(None, ge=1, le=512)
    typeId: str | None = None


@router.post("/fixtures/{fixture_id}/identify")
async def identify(fixture_id: str, body: IdentifyBody, s: S):
    _guard(s.engine.set_identify, fixture_id, body.on, body.address, body.typeId)
    await s.push("raw")
    return s.engine.raw_payload()


@router.get("/stage")
def get_stage(s: S):
    return s.engine.stage.model_dump()


@router.put("/stage")
async def put_stage(stage: StageGeometry, s: S):
    s.engine.put_stage(stage)
    await s.push("stage", "rig")
    return s.engine.stage.model_dump()


@router.post("/stage/reset-default")
async def reset_stage(s: S):
    s.engine.reset_stage()
    await s.push("stage", "rig")
    return s.engine.stage.model_dump()


# ---------------------------------------------------------------- Gerätetypen

@router.get("/fixture-types")
def list_types(s: S):
    return s.engine.types_payload()


@router.post("/fixture-types")
async def create_type(ftype: FixtureType, s: S):
    t = _guard(s.engine.save_type, ftype, create=True)
    await s.push("types", "rig")
    return t.model_dump()


@router.put("/fixture-types/{type_id}")
async def update_type(type_id: str, ftype: FixtureType, s: S):
    if ftype.id != type_id:
        raise HTTPException(400, "ID im Pfad und im Körper unterscheiden sich")
    t = _guard(s.engine.save_type, ftype, create=False)
    await s.push("types", "rig")
    return t.model_dump()


@router.delete("/fixture-types/{type_id}")
async def delete_type(type_id: str, s: S):
    _guard(s.engine.delete_type, type_id)
    await s.push("types")
    return {"ok": True}


@router.post("/fixture-types/{type_id}/duplicate")
async def duplicate_type(type_id: str, s: S, name: Annotated[str | None, Body(embed=True)] = None):
    t = _guard(s.engine.duplicate_type, type_id, name)
    await s.push("types")
    return t.model_dump()


# ---------------------------------------------------------------------- Werte

@router.get("/state")
def get_state(s: S):
    return s.engine.state_payload()


class LevelsBody(BaseModel):
    levels: dict[str, dict[str, float | None]]
    fade: float = Field(0.0, ge=0, le=120)


@router.post("/levels")
async def set_levels(body: LevelsBody, s: S):
    changed = _guard(s.engine.set_levels, body.levels, body.fade)
    await s.push("levels", levels=changed)
    return changed


class AllBody(BaseModel):
    dimmer: float = Field(ge=0, le=1)
    fade: float = Field(0.0, ge=0, le=120)
    ids: list[str] | None = None


@router.post("/all")
async def set_all(body: AllBody, s: S):
    changed = s.engine.set_all(body.dimmer, body.fade, body.ids)
    await s.push("levels", levels=changed)
    return changed


@router.post("/blackout")
async def blackout(s: S, on: Annotated[bool, Body(embed=True)]):
    s.engine.set_blackout(on)
    await s.push("levels")
    return s.engine.state_payload()


@router.post("/grandmaster")
async def grandmaster(s: S, value: Annotated[float, Body(embed=True, ge=0, le=1)]):
    s.engine.set_grandmaster(value)
    await s.push("levels")
    return s.engine.state_payload()


# --------------------------------------------------------------------- Szenen

@router.get("/scenes")
def list_scenes(s: S):
    return s.engine.scenes_payload()


class CaptureBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    fade: float = Field(2.0, ge=0, le=120)
    sceneId: str | None = None


@router.post("/scenes/capture")
async def capture_scene(body: CaptureBody, s: S):
    sc = _guard(s.engine.capture_scene, body.name, body.fade, body.sceneId)
    await s.push("scenes")
    return sc.model_dump()


class SceneUpdate(BaseModel):
    name: str | None = None
    fadeSeconds: float | None = Field(None, ge=0, le=120)


@router.put("/scenes/{scene_id}")
async def update_scene(scene_id: str, body: SceneUpdate, s: S):
    sc = _guard(s.engine.update_scene, scene_id, body.name, body.fadeSeconds)
    await s.push("scenes")
    return sc.model_dump()


@router.delete("/scenes/{scene_id}")
async def delete_scene(scene_id: str, s: S):
    _guard(s.engine.delete_scene, scene_id)
    await s.push("scenes")
    return {"ok": True}


@router.post("/scenes/reorder")
async def reorder_scenes(s: S, ids: Annotated[list[str], Body(embed=True)]):
    s.engine.reorder_scenes(ids)
    await s.push("scenes")
    return s.engine.scenes_payload()


class RecallBody(BaseModel):
    fade: float | None = Field(None, ge=0, le=120)
    othersOff: bool = True


@router.post("/scenes/{scene_id}/recall")
async def recall_scene(scene_id: str, s: S, body: RecallBody | None = None):
    body = body or RecallBody()
    changed = _guard(s.engine.recall_scene, scene_id, body.fade, body.othersOff)
    await s.push("levels", levels=changed)
    return changed


# ------------------------------------------------------------ Export / Import

@router.get("/export")
def export(s: S):
    data = s.engine.export_payload()
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="lichtpult-backup.json"'})


@router.post("/import")
async def import_backup(s: S, data: Annotated[dict, Body()]):
    allowed = {"rig.json", "stage.json", "fixture_types.user.json", "scenes.json"}
    unknown = set(data) - allowed - {"state.json"}
    if unknown:
        raise HTTPException(400, "Unbekannte Dateien: " + ", ".join(sorted(unknown)))
    e = s.engine
    from ..models.fixture_type import FixtureTypeList
    from ..models.state import SceneList

    try:
        if "fixture_types.user.json" in data:
            e.user_types = FixtureTypeList.model_validate(data["fixture_types.user.json"]).types
            e.store.save("fixture_types.user.json", FixtureTypeList(types=e.user_types))
        if "stage.json" in data:
            e.put_stage(StageGeometry.model_validate(data["stage.json"]))
        if "rig.json" in data:
            e.put_rig(Rig.model_validate(data["rig.json"]))
        if "scenes.json" in data:
            e.scenes = SceneList.model_validate(data["scenes.json"]).scenes
            e.store.save("scenes.json", SceneList(scenes=e.scenes))
    except Exception as ex:  # noqa: BLE001
        raise HTTPException(400, f"Import fehlgeschlagen: {ex}") from ex
    await s.push("types", "stage", "rig", "scenes")
    return {"ok": True, "imported": sorted(set(data) & allowed)}



