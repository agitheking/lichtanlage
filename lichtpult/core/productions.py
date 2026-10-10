"""Produktionen: eigene Szenen und Ablauf (Cues) je Produktion, gespeichert in productions.json."""

import uuid

from ..models.production import Cue, Production, ProductionList
from ..models.state import Scene
from .engine import Engine, NotFound, now_iso, unique_slug
from .store import Store

PRODUCTIONS_FILE = "productions.json"


class Invalid(ValueError):
    """Ungültige Eingabe (z. B. Cue verweist auf unbekannte Szene) → 422."""


class Productions:
    def __init__(self, store: Store, engine: Engine) -> None:
        self.store = store
        self.engine = engine
        self.lock = engine.lock  # gemeinsamer Lock: Abrufe greifen in den Engine-Zustand
        self.data = store.load(PRODUCTIONS_FILE, ProductionList, "productions.default.json")
        self._repair()

    def _repair(self) -> None:
        """Verwaiste Verweise beim Laden still bereinigen – die Probe darf nicht hängen."""
        for p in self.data.productions:
            sids = {s.id for s in p.scenes}
            for c in p.cues:
                if c.sceneId not in sids:
                    c.sceneId = None
        ids = [p.id for p in self.data.productions]
        if self.data.activeProductionId not in ids:
            self.data.activeProductionId = ids[0] if ids else None

    def _save(self) -> None:
        self.store.save(PRODUCTIONS_FILE, self.data)

    def payload(self) -> dict:
        with self.lock:
            return self.data.model_dump()

    def get(self, pid: str) -> Production:
        p = next((p for p in self.data.productions if p.id == pid), None)
        if p is None:
            raise NotFound(pid)
        return p

    # ------------------------------------------------------------ Produktionen

    def create(self, name: str) -> Production:
        with self.lock:
            p = Production(id=unique_slug(name, (p.id for p in self.data.productions)), name=name,
                           createdAt=now_iso())
            self.data.productions.append(p)
            if self.data.activeProductionId is None:
                self.data.activeProductionId = p.id
            self._save()
            return p

    def rename(self, pid: str, name: str) -> Production:
        """Nur der Name ändert sich, die ID bleibt stabil (Verweise, Show)."""
        with self.lock:
            p = self.get(pid)
            p.name = name
            self._save()
            return p

    def delete(self, pid: str) -> None:
        with self.lock:
            self.get(pid)
            self.data.productions = [p for p in self.data.productions if p.id != pid]
            if self.data.activeProductionId == pid:
                self.data.activeProductionId = self.data.productions[0].id if self.data.productions else None
            self._save()

    def activate(self, pid: str) -> None:
        with self.lock:
            self.get(pid)
            self.data.activeProductionId = pid
            self._save()

    # ------------------------------------------------------------------ Szenen

    def _scene(self, p: Production, sid: str) -> Scene:
        sc = p.scene(sid)
        if sc is None:
            raise NotFound(sid)
        return sc

    def capture_scene(self, pid: str, name: str, fade_s: float, scene_id: str | None = None) -> Scene:
        with self.lock:
            p = self.get(pid)
            target = self._scene(p, scene_id) if scene_id else None
            sc = self.engine.capture_into(p.scenes, name, fade_s, target)
            self._save()
            return sc

    def update_scene(self, pid: str, sid: str, name: str | None, fade_s: float | None) -> Scene:
        with self.lock:
            sc = self._scene(self.get(pid), sid)
            if name:
                sc.name = name
            if fade_s is not None:
                sc.fadeSeconds = fade_s
            self._save()
            return sc

    def delete_scene(self, pid: str, sid: str) -> None:
        """Betroffene Cues bleiben als Notiz-Cues erhalten (sceneId → None)."""
        with self.lock:
            p = self.get(pid)
            self._scene(p, sid)
            p.scenes = [s for s in p.scenes if s.id != sid]
            for c in p.cues:
                if c.sceneId == sid:
                    c.sceneId = None
            self._save()

    def reorder_scenes(self, pid: str, ids: list[str]) -> list[Scene]:
        with self.lock:
            p = self.get(pid)
            order = {sid: i for i, sid in enumerate(ids)}
            p.scenes.sort(key=lambda s: order.get(s.id, len(order)))
            self._save()
            return p.scenes

    def recall_scene(self, pid: str, sid: str, fade_s: float | None = None, others_off: bool = True) -> dict[str, dict]:
        with self.lock:
            return self.engine.apply_scene(self._scene(self.get(pid), sid), fade_s, others_off)

    def copy_from_library(self, pid: str, scene_ids: list[str]) -> list[Scene]:
        """Eigenständige Kopien der Bibliotheksszenen (neue ID in der Produktion)."""
        with self.lock:
            p = self.get(pid)
            sources = [self.engine._scene(sid) for sid in scene_ids]  # erst alle prüfen, dann kopieren
            copies = []
            for src in sources:
                sc = src.model_copy(deep=True, update={
                    "id": unique_slug(src.name, (s.id for s in p.scenes)), "createdAt": now_iso()})
                p.scenes.append(sc)
                copies.append(sc)
            self._save()
            return copies

    # -------------------------------------------------------------------- Cues

    def _cue(self, p: Production, cid: str) -> Cue:
        c = next((c for c in p.cues if c.id == cid), None)
        if c is None:
            raise NotFound(cid)
        return c

    @staticmethod
    def _check_scene_ref(p: Production, scene_id: str | None) -> None:
        if scene_id is not None and p.scene(scene_id) is None:
            raise Invalid(f"Unbekannte Szene „{scene_id}“ in Produktion „{p.name}“")

    def add_cue(self, pid: str, fields: dict) -> Cue:
        with self.lock:
            p = self.get(pid)
            self._check_scene_ref(p, fields.get("sceneId"))
            used = {c.id for c in p.cues}
            cid = uuid.uuid4().hex[:8]
            while cid in used:
                cid = uuid.uuid4().hex[:8]
            c = Cue.model_validate(fields | {"id": cid})
            p.cues.append(c)
            self._save()
            return c

    def update_cue(self, pid: str, cid: str, fields: dict) -> Cue:
        """Teil-Update: nur übergebene Felder; sceneId=None macht daraus einen Notiz-Cue."""
        with self.lock:
            p = self.get(pid)
            c = self._cue(p, cid)
            if "sceneId" in fields:
                self._check_scene_ref(p, fields["sceneId"])
            new = Cue.model_validate(c.model_dump() | fields | {"id": c.id})
            p.cues[p.cues.index(c)] = new
            self._save()
            return new

    def delete_cue(self, pid: str, cid: str) -> None:
        with self.lock:
            p = self.get(pid)
            self._cue(p, cid)
            p.cues = [c for c in p.cues if c.id != cid]
            self._save()

    def reorder_cues(self, pid: str, ids: list[str]) -> list[Cue]:
        with self.lock:
            p = self.get(pid)
            order = {cid: i for i, cid in enumerate(ids)}
            p.cues.sort(key=lambda c: order.get(c.id, len(order)))
            self._save()
            return p.cues
