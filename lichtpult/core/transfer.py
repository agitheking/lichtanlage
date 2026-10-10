"""Export/Import von Produktionen und Szenen (Produktion und Bibliothek) als JSON-Dateien.

Imports sind atomar: erst alles vollständig validieren, dann in einem Schritt übernehmen."""

from pydantic import ValidationError

from ..models.production import Production, ProductionList
from ..models.state import Scene
from .engine import Conflict, Engine, now_iso
from .productions import Invalid, Productions

PRODUCTION_FORMAT = "lichtpult-production"
SCENES_FORMAT = "lichtpult-scenes"
FORMAT_VERSION = 1

PRODUCTION_MODES = (None, "new", "replace")
SCENE_MODES = ("merge", "replace")


def _errors(what: str, e: ValidationError) -> Invalid:
    parts = []
    for err in e.errors()[:5]:
        loc = ".".join(str(x) for x in err["loc"])
        parts.append(f"{loc}: {err['msg']}" if loc else err["msg"])
    return Invalid(f"{what} ungültig – " + "; ".join(parts))


def _check_header(data: dict, fmt: str) -> None:
    if "format" in data and data["format"] != fmt:
        raise Invalid(f"Falsches Dateiformat „{data['format']}“ (erwartet „{fmt}“)")
    version = data.get("version", FORMAT_VERSION)
    if not isinstance(version, int) or version > FORMAT_VERSION:
        raise Invalid(f"Dateiversion {version} wird nicht unterstützt (höchstens {FORMAT_VERSION})")


def _drop_dangling_refs(p: Production) -> None:
    """Cues, deren Szene fehlt, werden zu Notiz-Cues."""
    sids = {s.id for s in p.scenes}
    for c in p.cues:
        if c.sceneId is not None and c.sceneId not in sids:
            c.sceneId = None


# ------------------------------------------------------------------- Export

def production_export(p: Production) -> dict:
    return {"format": PRODUCTION_FORMAT, "version": FORMAT_VERSION, "exportedAt": now_iso(),
            "production": p.model_dump()}


def scenes_export(scenes: list[Scene]) -> dict:
    return {"format": SCENES_FORMAT, "version": FORMAT_VERSION, "exportedAt": now_iso(),
            "scenes": [s.model_dump() for s in scenes]}


# ------------------------------------------------------------------- Parsen

def parse_scenes(data) -> list[Scene]:
    """Akzeptiert das Header-Format, eine rohe Liste und das alte {"scenes": […]}."""
    if isinstance(data, dict):
        if data.get("format") == PRODUCTION_FORMAT:  # Szenen aus einer Produktionsdatei übernehmen
            _check_header(data, PRODUCTION_FORMAT)
            data = (data.get("production") or {}).get("scenes")
        else:
            _check_header(data, SCENES_FORMAT)
            data = data.get("scenes")
    if not isinstance(data, list):
        raise Invalid("Keine Szenenliste gefunden")
    scenes = []
    for i, raw in enumerate(data, 1):
        try:
            scenes.append(Scene.model_validate(raw))
        except ValidationError as e:
            raise _errors(f"Szene {i}", e) from e
    ids = [s.id for s in scenes]
    dupes = sorted({sid for sid in ids if ids.count(sid) > 1})
    if dupes:
        raise Invalid("Doppelte Szenen-IDs in der Datei: " + ", ".join(dupes))
    return scenes


def parse_production(data: dict) -> Production:
    _check_header(data, PRODUCTION_FORMAT)
    raw = data.get("production")
    if not isinstance(raw, dict):
        raise Invalid("Keine Produktion in der Datei gefunden")
    try:
        p = Production.model_validate(raw)
    except ValidationError as e:
        raise _errors("Produktion", e) from e
    _drop_dangling_refs(p)
    try:
        p.check()
    except ValueError as e:
        raise Invalid(str(e)) from e
    return p


def parse_production_list(data) -> ProductionList:
    """Für die Gesamtsicherung (productions.json)."""
    try:
        pl = ProductionList.model_validate(data)
    except ValidationError as e:
        raise _errors("productions.json", e) from e
    ids = [p.id for p in pl.productions]
    if len(ids) != len(set(ids)):
        raise Invalid("productions.json: doppelte Produktions-IDs")
    for p in pl.productions:
        _drop_dangling_refs(p)
        try:
            p.check()
        except ValueError as e:
            raise Invalid(str(e)) from e
    return pl


def merge_scenes(existing: list[Scene], incoming: list[Scene], mode: str) -> list[Scene]:
    """merge: gleiche ID wird überschrieben, neue hinten angehängt; replace: nur die importierten."""
    if mode not in SCENE_MODES:
        raise Invalid(f"Unbekannter Modus „{mode}“ (erlaubt: merge, replace)")
    if mode == "replace":
        return list(incoming)
    by_id = {s.id: s for s in incoming}
    result = [by_id.pop(s.id, s) for s in existing]
    return result + [s for s in incoming if s.id in by_id]


# ------------------------------------------------------------------ Import

def import_production(prods: Productions, data: dict, mode: str | None) -> Production:
    """mode None: ID-Kollision → Conflict; "new": neue ID mit Suffix; "replace": vorhandene ersetzen."""
    if mode not in PRODUCTION_MODES:
        raise Invalid(f"Unbekannter Modus „{mode}“ (erlaubt: new, replace)")
    p = parse_production(data)
    with prods.lock:
        ids = [x.id for x in prods.data.productions]
        if p.id in ids and mode is None:
            raise Conflict(f"Produktion „{p.id}“ existiert bereits – neu anlegen oder ersetzen?")
        if p.id in ids and mode == "new":
            base, n = p.id, 2
            while f"{base}-{n}" in ids:
                n += 1
            p.id = f"{base}-{n}"
        p.createdAt = p.createdAt or now_iso()
        if p.id in ids:
            prods.data.productions[ids.index(p.id)] = p
        else:
            prods.data.productions.append(p)
        if prods.data.activeProductionId is None:
            prods.data.activeProductionId = p.id
        prods._save()
        return p


def import_production_scenes(prods: Productions, pid: str, data, mode: str) -> list[Scene]:
    incoming = parse_scenes(data)
    with prods.lock:
        p = prods.get(pid)
        p.scenes = merge_scenes(p.scenes, incoming, mode)
        _drop_dangling_refs(p)
        prods._save()
        return p.scenes


def import_library_scenes(engine: Engine, data, mode: str) -> list[Scene]:
    incoming = parse_scenes(data)
    with engine.lock:
        engine.scenes = merge_scenes(engine.scenes, incoming, mode)
        engine._save_scenes()
        return engine.scenes


def restore_productions(prods: Productions, pl: ProductionList) -> None:
    """Gesamtsicherung: alle Produktionen ersetzen (pl vorher mit parse_production_list geprüft)."""
    with prods.lock:
        prods.data = pl
        prods._repair()
        prods._save()
