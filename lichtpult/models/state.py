from pydantic import BaseModel, Field


class FixtureLevels(BaseModel):
    """Logischer Zustand eines Scheinwerfers, alle Werte 0…1."""

    dimmer: float = Field(0.0, ge=0, le=1)
    r: float = Field(1.0, ge=0, le=1)
    g: float = Field(1.0, ge=0, le=1)
    b: float = Field(1.0, ge=0, le=1)
    w: float = Field(1.0, ge=0, le=1)
    a: float = Field(0.0, ge=0, le=1)
    cct: float = Field(0.5, ge=0, le=1)
    strobe: float = Field(0.0, ge=0, le=1)


class StageState(BaseModel):
    grandMaster: float = Field(1.0, ge=0, le=1)
    blackout: bool = False
    fixtures: dict[str, FixtureLevels] = Field(default_factory=dict)


class Scene(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    name: str
    fadeSeconds: float = Field(2.0, ge=0, le=120)
    levels: dict[str, FixtureLevels] = Field(default_factory=dict)
    createdAt: str = ""


class SceneList(BaseModel):
    scenes: list[Scene] = Field(default_factory=list)
