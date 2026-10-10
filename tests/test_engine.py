from conftest import default_fixture_count

import time

from lichtpult.core.engine import Engine
from lichtpult.core.store import Store


def test_defaults_loaded_without_conflicts(engine):
    payload = engine.rig_payload()
    assert len(payload["rig"]["fixtures"]) == default_fixture_count()
    assert payload["conflicts"] == []


def test_raw_override_and_solo(engine):
    a = engine.rig.get("f01").address - 1
    engine.set_levels({"f01": {"dimmer": 1}})
    engine.set_raw({100: 200})
    fr = engine.compute_frame(time.monotonic())
    assert fr[a] == 255 and fr[99] == 200
    engine.set_raw({}, solo=True)
    fr = engine.compute_frame(time.monotonic())
    assert fr[a] == 0 and fr[99] == 200
    engine.clear_raw()
    assert engine.compute_frame(time.monotonic())[99] == 0


def test_identify_blinks_with_highlight(engine):
    fx = engine.rig.get("f02")  # LED-PAR: Dimmer, Strobe, R, G, B, …
    assert fx.typeId == "par-rgbwa-uv-8ch"
    a = fx.address - 1
    engine.set_identify("f02", True)
    on = engine.compute_frame(0.1)
    off = engine.compute_frame(0.3)
    assert on[a] == 255 and on[a + 1] == 0  # Strobe-Highlight ist 0
    assert off[a] == 0


def test_identify_with_unsaved_address(engine):
    engine.set_identify("f03", True, address=300, type_id="generic-dimmer-1ch")
    assert engine.compute_frame(0.1)[299] == 255


def test_default_scenes_reference_existing_fixtures(engine):
    names = [s.name for s in engine.scenes]
    assert "Allgemeines Licht" in names and "Arbeitslicht" in names
    for sc in engine.scenes:
        assert all(engine.rig.get(fid) for fid in sc.levels), sc.name


def test_scene_capture_and_recall(engine):
    engine.set_levels({"f01": {"dimmer": 0.8}, "f02": {"dimmer": 0.3}})
    sc = engine.capture_scene("Abend", 0)
    engine.set_all(0)
    engine.set_levels({"f05": {"dimmer": 1}})
    engine.recall_scene(sc.id)
    assert engine.state.fixtures["f01"].dimmer == 0.8
    assert engine.state.fixtures["f05"].dimmer == 0  # othersOff


def test_persistence_roundtrip(tmp_path):
    e = Engine(Store(tmp_path))
    fx = e.rig.get("f01").model_copy(update={"address": 200, "verified": True})
    e.upsert_fixture(fx)
    e.set_levels({"f01": {"dimmer": 0.5}})
    e.autosave()
    e2 = Engine(Store(tmp_path))
    assert e2.rig.get("f01").address == 200
    assert e2.state.fixtures["f01"].dimmer == 0.5


def test_broken_file_falls_back_to_default(tmp_path):
    (tmp_path / "rig.json").write_text("{kaputt")
    e = Engine(Store(tmp_path))
    assert len(e.rig.fixtures) == default_fixture_count()
    assert (tmp_path / "rig.json.broken").exists()


def test_arc_positions_are_symmetric(engine):
    left = engine.stage.lightArc.point(0.0)
    right = engine.stage.lightArc.point(1.0)
    assert abs(left[0] + right[0]) < 1e-6 and abs(left[2] - right[2]) < 1e-6
