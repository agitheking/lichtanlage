"""Zentraler Pult-Zustand: Rig, Gerätetypen, Bühne, Werte, Szenen, Overrides."""

import logging
import re
import threading
import time
import unicodedata
from datetime import datetime

from ..models.fixture_type import FixtureType, FixtureTypeList
from ..models.rig import ArcMount, Fixture, Rig
from ..models.stage import StageGeometry
from ..models.state import FixtureLevels, Scene, SceneList, StageState
from . import patch
from .fade import FadeEngine
from .store import Store

log = logging.getLogger(__name__)

RIG_FILE = "rig.json"
STAGE_FILE = "stage.json"
USER_TYPES_FILE = "fixture_types.user.json"
SCENES_FILE = "scenes.json"
STATE_FILE = "state.json"

IDENTIFY_HZ = 2.0


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


def slugify(text: str) -> str:
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "x"


class Engine:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.lock = threading.RLock()
        self.builtin_types = store.load_default("fixture_types.builtin.json", FixtureTypeList).types
        for t in self.builtin_types:
            t.builtin = True
        self.user_types = store.load(USER_TYPES_FILE, FixtureTypeList).types
        for t in self.user_types:
            t.builtin = False
        self.rig = store.load(RIG_FILE, Rig, "rig.default.json")
        self.stage = store.load(STAGE_FILE, StageGeometry, "stage.default.json")
        self.scenes = store.load(SCENES_FILE, SceneList, "scenes.default.json").scenes
        self.state = store.load(STATE_FILE, StageState)
        self.fade = FadeEngine()
        self.raw: dict[int, int] = {}
        self.raw_solo = False
        # fixture_id → (address, typeId) für Identify (auch für noch nicht gespeicherte Werte)
        self.identify: dict[str, tuple[int, str]] = {}
        self.state_dirty = False
        self._retarget(0.0)

    # ------------------------------------------------------------------ Typen

    @property
    def types(self) -> dict[str, FixtureType]:
        d = {t.id: t for t in self.builtin_types}
        d.update({t.id: t for t in self.user_types})
        return d

    def types_payload(self) -> list[dict]:
        return [t.model_dump() | {"footprint": t.footprint} for t in self.types.values()]

    def save_type(self, ftype: FixtureType, *, create: bool) -> FixtureType:
        with self.lock:
            existing = self.types.get(ftype.id)
            if create and existing:
                raise Conflict(f"Gerätetyp „{ftype.id}“ existiert bereits")
            if existing and existing.builtin:
                raise Conflict("Eingebaute Gerätetypen können nicht geändert werden – bitte duplizieren")
            if not create and existing is None:
                raise NotFound(ftype.id)
            ftype.builtin = False
            self.user_types = [t for t in self.user_types if t.id != ftype.id] + [ftype]
            self.store.save(USER_TYPES_FILE, FixtureTypeList(types=self.user_types))
            self._retarget(0.0)
            return ftype

    def delete_type(self, type_id: str) -> None:
        with self.lock:
            t = self.types.get(type_id)
            if t is None:
                raise NotFound(type_id)
            if t.builtin:
                raise Conflict("Eingebaute Gerätetypen können nicht gelöscht werden")
            used = [f.name for f in self.rig.fixtures if f.typeId == type_id]
            if used:
                raise Conflict("Wird noch verwendet von: " + ", ".join(used))
            self.user_types = [x for x in self.user_types if x.id != type_id]
            self.store.save(USER_TYPES_FILE, FixtureTypeList(types=self.user_types))

    def duplicate_type(self, type_id: str, name: str | None = None) -> FixtureType:
        with self.lock:
            src = self.types.get(type_id)
            if src is None:
                raise NotFound(type_id)
            new_name = name or f"{src.name} (Kopie)"
            base = slugify(new_name)
            new_id, n = base, 2
            while new_id in self.types:
                new_id, n = f"{base}-{n}", n + 1
            copy = src.model_copy(deep=True, update={"id": new_id, "name": new_name, "builtin": False})
            return self.save_type(copy, create=True)

    # ------------------------------------------------------------------- Rig

    def fixture_position(self, fx: Fixture) -> list[float]:
        if isinstance(fx.mount, ArcMount):
            return list(self.stage.lightArc.point(fx.mount.t))
        return list(fx.mount.position)

    def rig_payload(self) -> dict:
        types = self.types
        fixtures = []
        for fx in self.rig.fixtures:
            d = fx.model_dump()
            d["position"] = self.fixture_position(fx)
            t = types.get(fx.typeId)
            d["footprint"] = t.footprint if t else 1
            fixtures.append(d)
        return {
            "rig": {"version": self.rig.version, "fixtures": fixtures, "groups": [g.model_dump() for g in self.rig.groups]},
            "conflicts": patch.find_conflicts(self.rig, types),
        }

    def _save_rig(self) -> None:
        self.store.save(RIG_FILE, self.rig)
        self._retarget(0.0)

    def put_rig(self, rig: Rig) -> None:
        with self.lock:
            ids = [f.id for f in rig.fixtures]
            if len(ids) != len(set(ids)):
                raise Conflict("Doppelte Scheinwerfer-IDs")
            self.rig = rig
            self._save_rig()

    def new_fixture_id(self) -> str:
        used = {f.id for f in self.rig.fixtures}
        n = 1
        while f"f{n:02d}" in used:
            n += 1
        return f"f{n:02d}"

    def upsert_fixture(self, fx: Fixture) -> Fixture:
        with self.lock:
            if fx.typeId not in self.types:
                raise Conflict(f"Unbekannter Gerätetyp „{fx.typeId}“")
            for i, old in enumerate(self.rig.fixtures):
                if old.id == fx.id:
                    self.rig.fixtures[i] = fx
                    break
            else:
                self.rig.fixtures.append(fx)
            self._save_rig()
            return fx

    def delete_fixture(self, fixture_id: str) -> None:
        with self.lock:
            if self.rig.get(fixture_id) is None:
                raise NotFound(fixture_id)
            self.rig.fixtures = [f for f in self.rig.fixtures if f.id != fixture_id]
            self.state.fixtures.pop(fixture_id, None)
            self.identify.pop(fixture_id, None)
            self._save_rig()

    def reset_rig(self) -> None:
        with self.lock:
            self.rig = self.store.load_default("rig.default.json", Rig)
            self._save_rig()

    def put_stage(self, stage: StageGeometry) -> None:
        with self.lock:
            self.stage = stage
            self.store.save(STAGE_FILE, stage)

    def reset_stage(self) -> None:
        with self.lock:
            self.stage = self.store.load_default("stage.default.json", StageGeometry)
            self.store.save(STAGE_FILE, self.stage)

    # ---------------------------------------------------------------- Werte

    def state_payload(self) -> dict:
        return self.state.model_dump()

    def _retarget(self, fade_s: float) -> None:
        frame = patch.build_frame(self.rig, self.types, self.state)
        self.fade.set_targets(frame, fade_s, time.monotonic())

    def set_levels(self, levels: dict[str, dict], fade_s: float = 0.0) -> dict[str, dict]:
        """Teilweise Updates je Scheinwerfer; liefert die neuen vollständigen Werte zurück."""
        changed: dict[str, dict] = {}
        with self.lock:
            for fid, upd in levels.items():
                if self.rig.get(fid) is None:
                    continue
                cur = self.state.fixtures.get(fid) or FixtureLevels()
                new = FixtureLevels.model_validate(cur.model_dump() | {k: v for k, v in upd.items() if v is not None})
                self.state.fixtures[fid] = new
                changed[fid] = new.model_dump()
            if changed:
                self.state_dirty = True
                self._retarget(fade_s)
        return changed

    def set_all(self, dimmer: float, fade_s: float = 0.0, ids: list[str] | None = None) -> dict[str, dict]:
        targets = ids if ids is not None else [f.id for f in self.rig.fixtures]
        return self.set_levels({fid: {"dimmer": dimmer} for fid in targets}, fade_s)

    def set_grandmaster(self, value: float) -> None:
        with self.lock:
            self.state.grandMaster = max(0.0, min(1.0, value))
            self.state_dirty = True
            self._retarget(0.0)

    def set_blackout(self, on: bool) -> None:
        with self.lock:
            self.state.blackout = on
            self.state_dirty = True
            self._retarget(0.0)

    def set_raw(self, channels: dict[int, int], *, clear: bool = False, solo: bool | None = None) -> None:
        with self.lock:
            if clear:
                self.raw.clear()
            for ch, v in channels.items():
                ch = int(ch)
                if not 1 <= ch <= 512:
                    raise ValueError(f"Kanal {ch} außerhalb 1…512")
                if v is None:
                    self.raw.pop(ch, None)
                else:
                    self.raw[ch] = max(0, min(255, int(v)))
            if solo is not None:
                self.raw_solo = solo

    def clear_raw(self) -> None:
        with self.lock:
            self.raw.clear()
            self.raw_solo = False
            self.identify.clear()

    def set_identify(self, fixture_id: str, on: bool, address: int | None = None, type_id: str | None = None) -> None:
        with self.lock:
            fx = self.rig.get(fixture_id)
            if not on:
                self.identify.pop(fixture_id, None)
                return
            addr = address or (fx.address if fx else None)
            tid = type_id or (fx.typeId if fx else None)
            if addr is None or tid not in self.types:
                raise NotFound(fixture_id)
            self.identify[fixture_id] = (addr, tid)

    def raw_payload(self) -> dict:
        return {"channels": {str(k): v for k, v in sorted(self.raw.items())}, "solo": self.raw_solo,
                "identify": sorted(self.identify)}

    def compute_frame(self, now: float) -> bytes:
        with self.lock:
            frame = [0] * 512 if self.raw_solo else self.fade.frame(now)
            for ch, v in self.raw.items():
                frame[ch - 1] = v
            if self.identify:
                lit = int(now * IDENTIFY_HZ * 2) % 2 == 0
                types = self.types
                for addr, tid in self.identify.values():
                    t = types[tid]
                    vals = patch.highlight_values(t) if lit else [0] * t.footprint
                    patch.write(frame, addr, vals)
            return bytes(frame)

    # --------------------------------------------------------------- Szenen

    def _save_scenes(self) -> None:
        self.store.save(SCENES_FILE, SceneList(scenes=self.scenes))

    def scenes_payload(self) -> list[dict]:
        return [s.model_dump() for s in self.scenes]

    def capture_scene(self, name: str, fade_s: float, scene_id: str | None = None) -> Scene:
        with self.lock:
            levels = {fid: lv.model_copy() for fid, lv in self.state.fixtures.items() if self.rig.get(fid)}
            if scene_id:
                sc = self._scene(scene_id)
                sc.levels, sc.fadeSeconds, sc.name = levels, fade_s, name or sc.name
            else:
                base = slugify(name)
                sid, n = base, 2
                while any(s.id == sid for s in self.scenes):
                    sid, n = f"{base}-{n}", n + 1
                sc = Scene(id=sid, name=name, fadeSeconds=fade_s, levels=levels,
                           createdAt=datetime.now().isoformat(timespec="seconds"))
                self.scenes.append(sc)
            self._save_scenes()
            return sc

    def create_scene(self, name: str, fade_s: float, levels: dict[str, FixtureLevels]) -> Scene:
        """Szene direkt aus Werten anlegen (ohne das Licht im Saal umzuschalten)."""
        with self.lock:
            base = slugify(name)
            sid, n = base, 2
            while any(s.id == sid for s in self.scenes):
                sid, n = f"{base}-{n}", n + 1
            sc = Scene(id=sid, name=name, fadeSeconds=fade_s,
                       levels={fid: lv for fid, lv in levels.items() if self.rig.get(fid)},
                       createdAt=datetime.now().isoformat(timespec="seconds"))
            self.scenes.append(sc)
            self._save_scenes()
            return sc

    def _scene(self, scene_id: str) -> Scene:
        sc = next((s for s in self.scenes if s.id == scene_id), None)
        if sc is None:
            raise NotFound(scene_id)
        return sc

    def update_scene(self, scene_id: str, name: str | None, fade_s: float | None) -> Scene:
        with self.lock:
            sc = self._scene(scene_id)
            if name:
                sc.name = name
            if fade_s is not None:
                sc.fadeSeconds = fade_s
            self._save_scenes()
            return sc

    def delete_scene(self, scene_id: str) -> None:
        with self.lock:
            self._scene(scene_id)
            self.scenes = [s for s in self.scenes if s.id != scene_id]
            self._save_scenes()

    def reorder_scenes(self, ids: list[str]) -> None:
        with self.lock:
            order = {sid: i for i, sid in enumerate(ids)}
            self.scenes.sort(key=lambda s: order.get(s.id, len(order)))
            self._save_scenes()

    def recall_scene(self, scene_id: str, fade_s: float | None = None, others_off: bool = True) -> dict[str, dict]:
        with self.lock:
            sc = self._scene(scene_id)
            levels = {fid: lv.model_dump() for fid, lv in sc.levels.items()}
            if others_off:
                for f in self.rig.fixtures:
                    levels.setdefault(f.id, {"dimmer": 0.0})
            return self.set_levels(levels, sc.fadeSeconds if fade_s is None else fade_s)

    # ------------------------------------------------------------ Persistenz

    def autosave(self) -> None:
        with self.lock:
            if not self.state_dirty:
                return
            self.state_dirty = False
            snapshot = self.state.model_copy(deep=True)
        self.store.save(STATE_FILE, snapshot)

    def export_payload(self) -> dict:
        with self.lock:
            return {
                RIG_FILE: self.rig.model_dump(),
                STAGE_FILE: self.stage.model_dump(),
                USER_TYPES_FILE: FixtureTypeList(types=self.user_types).model_dump(),
                SCENES_FILE: SceneList(scenes=self.scenes).model_dump(),
                STATE_FILE: self.state.model_dump(),
            }
