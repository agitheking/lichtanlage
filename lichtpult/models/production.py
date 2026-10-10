from pydantic import BaseModel, Field

from .state import Scene


class Cue(BaseModel):
    """Eintrag im Ablauf; ohne sceneId ist es ein reiner Notiz-Cue (ändert das Licht nicht)."""

    id: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    sceneId: str | None = None
    fadeSeconds: float | None = Field(None, ge=0, le=120)  # None = Fade der Szene
    note: str = Field("", max_length=300)
    othersOff: bool = True


class Production(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    name: str
    scenes: list[Scene] = Field(default_factory=list)
    cues: list[Cue] = Field(default_factory=list)
    createdAt: str = ""

    def scene(self, scene_id: str) -> Scene | None:
        return next((s for s in self.scenes if s.id == scene_id), None)

    def check(self) -> None:
        """Eindeutige IDs und gültige Szenen-Verweise; ValueError mit verständlicher Meldung."""
        sids = [s.id for s in self.scenes]
        if len(sids) != len(set(sids)):
            raise ValueError(f"Produktion „{self.name}“: doppelte Szenen-IDs")
        cids = [c.id for c in self.cues]
        if len(cids) != len(set(cids)):
            raise ValueError(f"Produktion „{self.name}“: doppelte Cue-IDs")
        for i, c in enumerate(self.cues, 1):
            if c.sceneId is not None and c.sceneId not in sids:
                raise ValueError(f"Produktion „{self.name}“, Eintrag {i}: unbekannte Szene „{c.sceneId}“")


class ProductionList(BaseModel):
    version: int = 1
    activeProductionId: str | None = None
    productions: list[Production] = Field(default_factory=list)


class ShowState(BaseModel):
    """Zustand der Show-Steuerung, nur im Speicher (nicht persistiert)."""

    running: bool = False
    productionId: str | None = None
    cueIndex: int | None = None  # None = vor Start
    atEnd: bool = False
