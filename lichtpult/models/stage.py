import math

from pydantic import BaseModel, ConfigDict, Field


class Arc(BaseModel):
    """Kreisbogen in der XZ-Ebene (Mittelpunkt cx/cz, Radius r)."""

    cx: float = 0.0
    cz: float = -5.7
    r: float = 5.7


class LightArc(Arc):
    r: float = 6.3
    y: float = 2.45
    phiMaxDeg: float = 38.2
    fixtureDrop: float = 0.3

    def point(self, t: float) -> tuple[float, float, float]:
        """Position am Lichtbogen, t = 0 (links) … 1 (rechts), Fixture-Mitte unter dem Rohr."""
        phi = math.radians(-self.phiMaxDeg + 2 * self.phiMaxDeg * min(1.0, max(0.0, t)))
        return (
            round(self.cx + self.r * math.sin(phi), 4),
            round(self.y - self.fixtureDrop, 4),
            round(self.cz + self.r * math.cos(phi), 4),
        )


class Vault(BaseModel):
    halfWidth: float = 4.2
    springY: float = 2.0
    apexY: float = 3.3
    zFront: float = 5.0
    zBack: float = -4.5


class Prop(BaseModel):
    model_config = ConfigDict(extra="allow")

    kind: str
    name: str = ""
    position: list[float] = Field(min_length=3, max_length=3)
    size: list[float] = Field(default_factory=lambda: [1.0, 1.0, 1.0], min_length=3, max_length=3)
    rotationY: float = 0.0
    color: str = "#888888"


class StageGeometry(BaseModel):
    model_config = ConfigDict(extra="allow")

    version: int = 1
    stageWidth: float = 7.0
    stageDepth: float = 4.5
    stageHeight: float = 0.4
    frontArc: Arc = Arc()
    lightArc: LightArc = LightArc()
    vault: Vault = Vault()
    props: list[Prop] = Field(default_factory=list)
