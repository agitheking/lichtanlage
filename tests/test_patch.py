from lichtpult.core import patch
from lichtpult.models.fixture_type import ChannelDef, FixtureType
from lichtpult.models.rig import Fixture, Rig
from lichtpult.models.state import FixtureLevels, StageState


def T(id, *roles):
    return FixtureType(id=id, name=id, channels=[ChannelDef(name=r, role=r) for r in roles])


TYPES = {
    t.id: t
    for t in [
        T("dim", "dimmer"),
        T("drgb", "dimmer", "red", "green", "blue"),
        T("rgb", "red", "green", "blue"),
        T("cct", "dimmer", "warm", "cold"),
        T("prog", "dimmer", "strobe", "program"),
    ]
}


def rig(*fx):
    return Rig(fixtures=[Fixture(id=i, name=i, typeId=t, address=a) for i, t, a in fx])


def test_dimmer_and_color_channels():
    r = rig(("a", "drgb", 10))
    st = StageState(fixtures={"a": FixtureLevels(dimmer=0.5, r=1, g=0, b=0.2)})
    fr = patch.build_frame(r, TYPES, st)
    assert fr[9:13] == [128, 255, 0, 51]


def test_rgb_without_dimmer_scales_colors():
    r = rig(("a", "rgb", 1))
    st = StageState(fixtures={"a": FixtureLevels(dimmer=0.5, r=1, g=1, b=0)})
    assert patch.build_frame(r, TYPES, st)[:3] == [128, 128, 0]


def test_grandmaster_and_blackout():
    r = rig(("a", "dim", 1), ("b", "rgb", 2))
    st = StageState(grandMaster=0.5, fixtures={"a": FixtureLevels(dimmer=1), "b": FixtureLevels(dimmer=1)})
    assert patch.build_frame(r, TYPES, st)[:4] == [128, 128, 128, 128]
    st.blackout = True
    assert patch.build_frame(r, TYPES, st)[:4] == [0, 0, 0, 0]


def test_warm_cold():
    r = rig(("a", "cct", 1))
    st = StageState(fixtures={"a": FixtureLevels(dimmer=1, cct=0.25)})
    assert patch.build_frame(r, TYPES, st)[:3] == [255, 191, 64]


def test_strobe_and_program_stay_default():
    r = rig(("a", "prog", 1))
    st = StageState(fixtures={"a": FixtureLevels(dimmer=1)})
    assert patch.build_frame(r, TYPES, st)[:3] == [255, 0, 0]


def test_disabled_and_unknown_fixtures_are_skipped():
    r = rig(("a", "dim", 1), ("b", "nope", 2))
    r.fixtures[0].enabled = False
    st = StageState(fixtures={"a": FixtureLevels(dimmer=1), "b": FixtureLevels(dimmer=1)})
    assert patch.build_frame(r, TYPES, st)[:2] == [0, 0]


def test_conflicts():
    r = rig(("a", "drgb", 1), ("b", "dim", 4), ("c", "drgb", 510), ("d", "nope", 100))
    kinds = sorted(c["kind"] for c in patch.find_conflicts(r, TYPES))
    assert kinds == ["out_of_range", "overlap", "unknown_type"]
