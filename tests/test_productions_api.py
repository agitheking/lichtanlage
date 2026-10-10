import json

from fastapi.testclient import TestClient

from lichtpult.config import DEFAULTS_DIR
from lichtpult.main import create_app


def _new(client, name="Hamlet"):
    r = client.post("/api/productions", json={"name": name})
    assert r.status_code == 200
    return r.json()


def test_default_example_production(client):
    data = client.get("/api/productions").json()
    assert data["version"] == 1 and data["activeProductionId"] == "beispiel"
    p = data["productions"][0]
    assert [s["name"] for s in p["scenes"]] == ["Blackout"]
    assert len(p["cues"]) == 2 and p["cues"][0]["sceneId"] == "blackout" and p["cues"][1]["sceneId"] is None
    # Bibliothek bleibt unangetastet
    lib = json.loads((DEFAULTS_DIR / "scenes.default.json").read_text(encoding="utf-8"))["scenes"]
    assert len(client.get("/api/scenes").json()) == len(lib)


def test_production_crud_and_slugs(client):
    a = _new(client, "Hamlet")
    b = _new(client, "Hamlet")
    assert (a["id"], b["id"]) == ("hamlet", "hamlet-2")
    r = client.put("/api/productions/hamlet", json={"name": "Hamlet (Premiere)"}).json()
    assert r["id"] == "hamlet" and r["name"] == "Hamlet (Premiere)"
    assert client.post("/api/productions/hamlet-2/activate").json()["activeProductionId"] == "hamlet-2"
    assert client.delete("/api/productions/hamlet-2").status_code == 200
    data = client.get("/api/productions").json()
    assert data["activeProductionId"] == "beispiel"  # aktive gelöscht → erste verbleibende
    assert [p["id"] for p in data["productions"]] == ["beispiel", "hamlet"]
    assert client.delete("/api/productions/hamlet-2").status_code == 404
    assert client.post("/api/productions/gibts-nicht/activate").status_code == 404
    assert client.post("/api/productions", json={"name": ""}).status_code == 422


def test_scenes_capture_update_reorder(client):
    _new(client)
    lib_before = client.get("/api/scenes").json()
    client.post("/api/levels", json={"levels": {"f01": {"dimmer": 0.7}}})
    sc = client.post("/api/productions/hamlet/scenes/capture", json={"name": "Nacht", "fade": 3}).json()
    assert sc["id"] == "nacht" and sc["levels"]["f01"]["dimmer"] == 0.7
    sc2 = client.post("/api/productions/hamlet/scenes/capture", json={"name": "Nacht", "fade": 1}).json()
    assert sc2["id"] == "nacht-2"
    client.post("/api/levels", json={"levels": {"f01": {"dimmer": 0.2}}})
    upd = client.post("/api/productions/hamlet/scenes/capture", json={"name": "", "fade": 5, "sceneId": "nacht"})
    assert upd.status_code == 422  # leerer Name wie in der Bibliothek nicht erlaubt
    upd = client.post("/api/productions/hamlet/scenes/capture",
                      json={"name": "Nacht", "fade": 5, "sceneId": "nacht"}).json()
    assert upd["levels"]["f01"]["dimmer"] == 0.2 and upd["fadeSeconds"] == 5
    r = client.put("/api/productions/hamlet/scenes/nacht", json={"name": "Mondnacht", "fadeSeconds": 4}).json()
    assert r["name"] == "Mondnacht" and r["id"] == "nacht"
    order = client.post("/api/productions/hamlet/scenes/reorder", json={"ids": ["nacht-2", "nacht"]}).json()
    assert [s["id"] for s in order] == ["nacht-2", "nacht"]
    assert [s["id"] for s in client.get("/api/productions/hamlet/scenes").json()] == ["nacht-2", "nacht"]
    assert client.put("/api/productions/hamlet/scenes/xyz", json={"name": "x"}).status_code == 404
    # Bibliothek unberührt
    assert client.get("/api/scenes").json() == lib_before


def test_cue_crud_and_validation(client):
    _new(client)
    client.post("/api/productions/hamlet/scenes/capture", json={"name": "Nacht", "fade": 2})
    c1 = client.post("/api/productions/hamlet/cues", json={"sceneId": "nacht", "note": "Hamlet kommt raus"}).json()
    c2 = client.post("/api/productions/hamlet/cues", json={"note": "Stichwort: Eisenbahn"}).json()
    c3 = client.post("/api/productions/hamlet/cues", json={"sceneId": "nacht", "fadeSeconds": 0}).json()
    assert c1["id"] != c3["id"] and c2["sceneId"] is None and c3["fadeSeconds"] == 0
    assert client.post("/api/productions/hamlet/cues", json={"sceneId": "gibts-nicht", "note": "x"}).status_code == 422
    assert client.post("/api/productions/hamlet/cues", json={"note": "x" * 301}).status_code == 422
    assert client.post("/api/productions/hamlet/cues", json={"fadeSeconds": 121}).status_code == 422
    assert client.put(f"/api/productions/hamlet/cues/{c2['id']}", json={"sceneId": "gibts-nicht"}).status_code == 422
    # Teil-Update: nur Notiz ändern, Szene bleibt
    r = client.put(f"/api/productions/hamlet/cues/{c1['id']}", json={"note": "Hamlet tritt auf"}).json()
    assert r["sceneId"] == "nacht" and r["note"] == "Hamlet tritt auf"
    # explizites null → Notiz-Cue bzw. Fade der Szene
    r = client.put(f"/api/productions/hamlet/cues/{c3['id']}", json={"sceneId": None, "fadeSeconds": None}).json()
    assert r["sceneId"] is None and r["fadeSeconds"] is None
    assert client.put(f"/api/productions/hamlet/cues/{c3['id']}", json={"note": None}).status_code == 422
    ids = [c3["id"], c1["id"], c2["id"]]
    assert [c["id"] for c in client.post("/api/productions/hamlet/cues/reorder", json={"ids": ids}).json()] == ids
    assert client.delete(f"/api/productions/hamlet/cues/{c3['id']}").status_code == 200
    assert client.delete(f"/api/productions/hamlet/cues/{c3['id']}").status_code == 404
    p = next(p for p in client.get("/api/productions").json()["productions"] if p["id"] == "hamlet")
    assert [c["id"] for c in p["cues"]] == [c1["id"], c2["id"]]


def test_delete_scene_turns_cues_into_notes(client):
    _new(client)
    client.post("/api/productions/hamlet/scenes/capture", json={"name": "Nacht", "fade": 2})
    for note in ("eins", "zwei"):
        client.post("/api/productions/hamlet/cues", json={"sceneId": "nacht", "note": note})
    assert client.delete("/api/productions/hamlet/scenes/nacht").status_code == 200
    p = next(p for p in client.get("/api/productions").json()["productions"] if p["id"] == "hamlet")
    assert p["scenes"] == []
    assert [(c["sceneId"], c["note"]) for c in p["cues"]] == [(None, "eins"), (None, "zwei")]


def test_copy_from_library_is_independent(client):
    _new(client)
    lib = client.get("/api/scenes").json()
    src = lib[0]
    copies = client.post("/api/productions/hamlet/scenes/copy-from-library",
                         json={"sceneIds": [src["id"], src["id"]]}).json()
    assert len(copies) == 2 and copies[0]["id"] != copies[1]["id"]
    assert copies[0]["levels"] == src["levels"] and copies[0]["name"] == src["name"]
    # Änderungen an der Kopie wirken nicht auf die Bibliothek und umgekehrt
    client.put(f"/api/productions/hamlet/scenes/{copies[0]['id']}", json={"name": "Geändert", "fadeSeconds": 9})
    client.delete(f"/api/scenes/{src['id']}")
    assert all(s["id"] != src["id"] for s in client.get("/api/scenes").json())
    scenes = client.get("/api/productions/hamlet/scenes").json()
    assert [s["name"] for s in scenes] == ["Geändert", src["name"]]
    assert scenes[1]["levels"] == src["levels"]
    # unbekannte ID → nichts wird kopiert
    r = client.post("/api/productions/hamlet/scenes/copy-from-library", json={"sceneIds": [lib[1]["id"], "gibts-nicht"]})
    assert r.status_code == 404 and len(client.get("/api/productions/hamlet/scenes").json()) == 2


def test_recall_matches_library(client):
    _new(client)
    src = client.get("/api/scenes").json()[0]
    copy = client.post("/api/productions/hamlet/scenes/copy-from-library", json={"sceneIds": [src["id"]]}).json()[0]

    def recall(url, body):
        client.post("/api/all", json={"dimmer": 0.5})
        client.post("/api/levels", json={"levels": {"f01": {"r": 0.1}}})
        client.post(url, json=body)
        return client.get("/api/state").json()["fixtures"]

    for body in ({"fade": 0}, {"fade": 0, "othersOff": False}):
        lib_state = recall(f"/api/scenes/{src['id']}/recall", body)
        prod_state = recall(f"/api/productions/hamlet/scenes/{copy['id']}/recall", body)
        assert lib_state == prod_state
    assert client.post("/api/productions/hamlet/scenes/xyz/recall").status_code == 404


def test_persistence_across_restart(tmp_path):
    with TestClient(create_app(tmp_path, sim=True)) as c:
        _new(c)
        c.post("/api/productions/hamlet/scenes/capture", json={"name": "Nacht", "fade": 2})
        cue = c.post("/api/productions/hamlet/cues", json={"sceneId": "nacht", "note": "Auftritt"}).json()
        c.post("/api/productions/hamlet/activate")
    assert (tmp_path / "productions.json").exists() and not (tmp_path / "productions.json.tmp").exists()
    with TestClient(create_app(tmp_path, sim=True)) as c:
        data = c.get("/api/productions").json()
        assert data["activeProductionId"] == "hamlet"
        p = next(p for p in data["productions"] if p["id"] == "hamlet")
        assert [s["id"] for s in p["scenes"]] == ["nacht"] and p["cues"] == [cue]


def test_ws_productions_event(client):
    def until(ws, kind):
        while True:
            m = ws.receive_json()
            if m["type"] == kind:
                return m

    with client.websocket_connect("/ws") as ws:
        hello = until(ws, "hello")
        assert hello["activeProductionId"] == "beispiel" and hello["productions"][0]["id"] == "beispiel"
        _new(client)
        m = until(ws, "productions")
        assert [p["id"] for p in m["productions"]] == ["beispiel", "hamlet"]
        assert m["activeProductionId"] == "beispiel"
        client.post("/api/productions/hamlet/cues", json={"note": "Pause"})
        m = until(ws, "productions")
        assert m["productions"][1]["cues"][0]["note"] == "Pause"
