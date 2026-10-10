"""Logische Scheinwerferwerte → 512-Byte-DMX-Frame."""

from ..config import DMX_CHANNELS
from ..models.fixture_type import ChannelRole as R
from ..models.fixture_type import FixtureType
from ..models.rig import Fixture, Rig
from ..models.state import FixtureLevels, StageState

_COLOR_ATTR = {R.RED: "r", R.GREEN: "g", R.BLUE: "b", R.WHITE: "w", R.AMBER: "a"}


def _b(x: float) -> int:
    return max(0, min(255, round(x * 255)))


def fixture_values(ftype: FixtureType, lv: FixtureLevels, master: float) -> list[int]:
    """Kanalwerte eines Scheinwerfers; master = Grand Master × (Blackout ? 0 : 1)."""
    dim = lv.dimmer * master
    has_dimmer = ftype.has_role(R.DIMMER)
    # Ohne eigenen Dimmerkanal wird die Helligkeit in die Farbkanäle gerechnet.
    scale = 1.0 if has_dimmer else dim
    out: list[int] = []
    for ch in ftype.channels:
        if ch.role == R.DIMMER:
            out.append(_b(dim))
        elif ch.role in _COLOR_ATTR:
            out.append(_b(getattr(lv, _COLOR_ATTR[ch.role]) * scale))
        elif ch.role == R.CCT:
            out.append(_b(lv.cct))
        elif ch.role == R.WARM:
            out.append(_b((1 - lv.cct) * scale))
        elif ch.role == R.COLD:
            out.append(_b(lv.cct * scale))
        elif ch.role == R.STROBE:
            out.append(_b(lv.strobe) if lv.strobe > 0 else ch.default)
        else:
            out.append(ch.default)
    return out


def highlight_values(ftype: FixtureType) -> list[int]:
    return [c.highlight for c in ftype.channels]


def build_frame(rig: Rig, types: dict[str, FixtureType], state: StageState) -> list[int]:
    frame = [0] * DMX_CHANNELS
    master = 0.0 if state.blackout else state.grandMaster
    for fx in rig.fixtures:
        ftype = types.get(fx.typeId)
        if not fx.enabled or ftype is None:
            continue
        lv = state.fixtures.get(fx.id) or FixtureLevels()
        write(frame, fx.address, fixture_values(ftype, lv, master))
    return frame


def write(frame: list[int], address: int, values: list[int]) -> None:
    for k, v in enumerate(values):
        idx = address - 1 + k
        if 0 <= idx < len(frame):
            frame[idx] = v


def find_conflicts(rig: Rig, types: dict[str, FixtureType]) -> list[dict]:
    """Überlappende Adressbereiche und Bereiche über Kanal 512 hinaus."""
    spans: list[tuple[Fixture, int, int]] = []
    out: list[dict] = []
    for fx in rig.fixtures:
        ftype = types.get(fx.typeId)
        if ftype is None:
            out.append({"kind": "unknown_type", "fixtures": [fx.id], "message": f"{fx.name}: Gerätetyp „{fx.typeId}“ fehlt"})
            continue
        end = fx.address + ftype.footprint - 1
        if end > DMX_CHANNELS:
            out.append({"kind": "out_of_range", "fixtures": [fx.id], "message": f"{fx.name}: Kanäle {fx.address}–{end} gehen über 512 hinaus"})
        if fx.enabled:
            spans.append((fx, fx.address, end))
    for i, (a, a0, a1) in enumerate(spans):
        for b, b0, b1 in spans[i + 1 :]:
            if a0 <= b1 and b0 <= a1:
                out.append({
                    "kind": "overlap",
                    "fixtures": [a.id, b.id],
                    "message": f"{a.name} ({a0}–{a1}) überschneidet sich mit {b.name} ({b0}–{b1})",
                })
    return out
