from typing import Annotated, Literal

from pydantic import BaseModel, Field


class ArcMount(BaseModel):
    kind: Literal["arc"] = "arc"
    t: float = Field(0.5, ge=0.0, le=1.0)


class FreeMount(BaseModel):
    kind: Literal["free"] = "free"
    position: list[float] = Field(min_length=3, max_length=3)


Mount = Annotated[ArcMount | FreeMount, Field(discriminator="kind")]


class Fixture(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    name: str
    typeId: str
    address: int = Field(1, ge=1, le=512)
    enabled: bool = True
    verified: bool = False
    mount: Mount = ArcMount()
    target: list[float] = Field(default_factory=lambda: [0.0, 0.4, -2.5], min_length=3, max_length=3)
    beamAngleDeg: float | None = Field(None, gt=1, lt=170)
    shape: Literal["round", "square", "profile"] | None = None
    groups: list[str] = Field(default_factory=list)
    notes: str = ""


class Group(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    name: str
    color: str = "#44aaff"


class Rig(BaseModel):
    version: int = 1
    fixtures: list[Fixture] = Field(default_factory=list)
    groups: list[Group] = Field(default_factory=list)

    def get(self, fixture_id: str) -> Fixture | None:
        return next((f for f in self.fixtures if f.id == fixture_id), None)
