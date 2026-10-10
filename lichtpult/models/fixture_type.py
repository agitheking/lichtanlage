from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ChannelRole(StrEnum):
    DIMMER = "dimmer"
    RED = "red"
    GREEN = "green"
    BLUE = "blue"
    WHITE = "white"
    AMBER = "amber"
    UV = "uv"
    CCT = "cct"
    WARM = "warm"
    COLD = "cold"
    STROBE = "strobe"
    ZOOM = "zoom"
    PAN = "pan"
    TILT = "tilt"
    PROGRAM = "program"
    OTHER = "other"


class ChannelDef(BaseModel):
    name: str
    role: ChannelRole
    default: int = Field(0, ge=0, le=255)
    # Wert beim Identify/Testen ("Scheinwerfer hell schalten")
    highlight: int = Field(255, ge=0, le=255)


class BeamDef(BaseModel):
    kind: Literal["par", "flood", "fresnel", "profile"] = "par"
    angleDeg: float = Field(30, gt=1, lt=170)


class RenderDef(BaseModel):
    shape: Literal["round", "square", "profile"] = "square"
    color: str = "#1c1c1c"


ColorModel = Literal["none", "rgb", "rgbw", "rgbaw", "cct"]


class FixtureType(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]*$")
    name: str
    manufacturer: str = "Generic"
    mode: str = ""
    builtin: bool = False
    channels: list[ChannelDef] = Field(min_length=1, max_length=64)
    beam: BeamDef = BeamDef()
    render: RenderDef = RenderDef()
    colorModel: ColorModel = "none"

    @field_validator("channels")
    @classmethod
    def _names_present(cls, v: list[ChannelDef]) -> list[ChannelDef]:
        for c in v:
            if not c.name.strip():
                raise ValueError("Kanalname darf nicht leer sein")
        return v

    @property
    def footprint(self) -> int:
        return len(self.channels)

    def has_role(self, role: ChannelRole) -> bool:
        return any(c.role == role for c in self.channels)


class FixtureTypeList(BaseModel):
    types: list[FixtureType] = Field(default_factory=list)
