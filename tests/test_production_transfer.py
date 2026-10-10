from fastapi.testclient import TestClient

from lichtpult.main import create_app


def _hamlet(client):
    client.post("/api/productions", json={"name": "Hamlet"})
    client.post("/api/levels", json={"levels": {"f01": {"dimmer": 0.4}}})
    client.post("/api/productions/hamlet/scenes/capture", json={"name": "Nacht", "fade": 3})
    client.post("/api/productions/hamlet/cues", json={"sceneId": "nacht", "fadeSeconds": 5, "note": "Auftritt"})
    client.post("/api/productions/hamlet/cues", json={"note": "Stichwort: Eisenbahn"})


def _productions(client):
    return client.get("/api/productions").json()


def _prod(client, pid):
    return next(p for p in _productions(client)["productions"] if p["id"] == pid)


def test_export_headers(client):
    _hamlet(client)
    r = client.get("/api/productions/hamlet/export")
    assert r.status_code == 200 and "lichtpult-produktion-hamlet.json" in r.headers["content-disposition"]
    data = r.json()
    assert data["format"] == "lichtpult-production" and data["version"] == 1 and data["exportedAt"]
    assert data["production"] == _prod(client, "hamlet")

    sc = client.get("/api/productions/hamlet/scenes/export").json()
    assert sc["format"] == "lichtpult-scenes" and [s["id"] for s in sc["scenes"]] == ["nacht"]
    lib = client.get("/api/scenes/export").json()
    assert lib["format"] == "lichtpult-scenes" and lib["scenes"] == client.get("/api/scenes").json()
    assert client.get("/api/productions/gibts-nicht/export").status_code == 404
    assert client.get("/api/productions/gibts-nicht/scenes/export").status_code == 404


def test_production_roundtrip_to_other_instance(client, tmp_path):
    _hamlet(client)
    exported = client.get("/api/productions/hamlet/export").json()
    with TestClient(create_app(tmp_path / "andere", sim=True)) as other:
        r = other.post("/api/productions/import", json=exported)
        assert r.status_code == 200 and r.json() == exported["production"]
        assert _prod(other, "hamlet") == exported["production"]
        assert other.get("/api/productions/hamlet/export").json()["production"] == exported["production"]


def test_production_import_collision_modes(client):
    _hamlet(client)
    exported = client.get("/api/productions/hamlet/export").json()
    exported["production"]["name"] = "Hamlet (Import)"
    before = _productions(client)
    r = client.post("/api/productions/import", json=exported)
    assert r.status_code == 409 and "existiert bereits" in r.json()["detail"]
    assert _productions(client) == before

    r = client.post("/api/productions/import", json=exported | {"mode": "new"}).json()
    assert r["id"] == "hamlet-2" and r["name"] == "Hamlet (Import)"
    r = client.post("/api/productions/import", json=exported | {"mode": "new"}).json()
    assert r["id"] == "hamlet-3"

    exported["production"]["cues"] = exported["production"]["cues"][:1]
    r = client.post("/api/productions/import", json=exported | {"mode": "replace"}).json()
    assert r["id"] == "hamlet"
    ids = [p["id"] for p in _productions(client)["productions"]]
    assert ids == ["beispiel", "hamlet", "hamlet-2", "hamlet-3"]  # ersetzt an gleicher Stelle
    assert _prod(client, "hamlet")["name"] == "Hamlet (Import)" and len(_prod(client, "hamlet")["cues"]) == 1
    assert client.post("/api/productions/import", json=exported | {"mode": "quatsch"}).status_code == 422


def test_production_import_validation_is_atomic(client):
    _hamlet(client)
    good = client.get("/api/productions/hamlet/export").json()
    before = _productions(client)
    bad_cases = [
        {"format": "lichtpult-scenes", "version": 1, "scenes": []},
        good | {"version": 2},
        {"format": "lichtpult-production", "version": 1},
        good | {"production": good["production"] | {"id": "mit leerzeichen"}},
        good | {"production": good["production"] | {"cues": [{"id": "a", "note": "x" * 301}]}},
        good | {"production": good["production"] | {"cues": [{"id": "a"}, {"id": "a"}]}},
        good | {"production": good["production"] | {"scenes": good["production"]["scenes"] * 2}},
    ]
    for bad in bad_cases:
        r = client.post("/api/productions/import", json=bad | {"mode": "replace"})
        assert r.status_code == 422, bad
        assert isinstance(r.json()["detail"], str)
    assert _productions(client) == before


def test_import_turns_dangling_cues_into_notes(client):
    _hamlet(client)
    exported = client.get("/api/productions/hamlet/export").json()
    exported["production"]["scenes"] = []
    r = client.post("/api/productions/import", json=exported | {"mode": "new"}).json()
    assert [(c["sceneId"], c["note"]) for c in r["cues"]] == [(None, "Auftritt"), (None, "Stichwort: Eisenbahn")]


def test_scene_import_formats_and_modes(client):
    _hamlet(client)
    sc = client.get("/api/productions/hamlet/scenes/export").json()["scenes"][0]
    tag = sc | {"id": "tag", "name": "Tag"}
    url = "/api/productions/hamlet/scenes/import"
    # Header-Format, merge: gleiche ID überschreibt, neue wird angehängt
    r = client.post(url, json={"format": "lichtpult-scenes", "version": 1,
                               "scenes": [sc | {"name": "Mondnacht"}, tag]}).json()
    assert [(s["id"], s["name"]) for s in r] == [("nacht", "Mondnacht"), ("tag", "Tag")]
    # rohe Liste mit Modus als Query-Parameter
    r = client.post(url + "?mode=merge", json=[sc | {"id": "morgen", "name": "Morgen"}]).json()
    assert [s["id"] for s in r] == ["nacht", "tag", "morgen"]
    # altes Format {"scenes": […]} mit replace: Cues auf entfernte Szenen werden Notiz-Cues
    r = client.post(url, json={"scenes": [tag], "mode": "replace"}).json()
    assert [s["id"] for s in r] == ["tag"]
    assert [c["sceneId"] for c in _prod(client, "hamlet")["cues"]] == [None, None]
    # Szenen aus einer ganzen Produktionsdatei
    prod = client.get("/api/productions/beispiel/export").json()
    r = client.post(url, json=prod).json()
    assert [s["id"] for s in r] == ["tag", "blackout"]
    assert client.post("/api/productions/gibts-nicht/scenes/import", json=[tag]).status_code == 404


def test_scene_import_errors_are_atomic(client):
    _hamlet(client)
    url = "/api/productions/hamlet/scenes/import"
    sc = client.get("/api/productions/hamlet/scenes/export").json()["scenes"][0]
    before = _prod(client, "hamlet")
    for bad, mode in [
        ([sc, {"id": "x", "name": "X", "fadeSeconds": 500}], None),
        ([sc, sc], None),
        ({"format": "lichtpult-production", "version": 9, "production": {}}, None),
        ({"format": "etwas-anderes", "scenes": [sc]}, None),
        ({"etwas": 1}, None),
        ([sc], "quatsch"),
    ]:
        r = client.post(url + (f"?mode={mode}" if mode else ""), json=bad)
        assert r.status_code == 422, bad
    assert _prod(client, "hamlet") == before


def test_library_export_import(client):
    lib = client.get("/api/scenes/export").json()
    one = lib["scenes"][0]
    r = client.post("/api/scenes/import", json={"scenes": [one | {"id": "neu", "name": "Neu"}]}).json()
    assert len(r) == len(lib["scenes"]) + 1 and r[-1]["id"] == "neu"
    r = client.post("/api/scenes/import", json=lib | {"mode": "replace"}).json()
    assert r == lib["scenes"] == client.get("/api/scenes").json()
    r = client.post("/api/scenes/import?mode=replace", json=[one]).json()
    assert [s["id"] for s in r] == [one["id"]]
    assert client.post("/api/scenes/import", json=[one, {"id": "x"}]).status_code == 422
    assert [s["id"] for s in client.get("/api/scenes").json()] == [one["id"]]


def test_library_import_ws_event(client):
    with client.websocket_connect("/ws") as ws:
        lib = client.get("/api/scenes/export").json()
        client.post("/api/scenes/import?mode=replace", json=lib["scenes"][:1])
        while (m := ws.receive_json())["type"] != "scenes":
            pass
        assert len(m["scenes"]) == 1


def test_full_backup_contains_productions(client, tmp_path):
    _hamlet(client)
    backup = client.get("/api/export").json()
    assert backup["productions.json"] == _productions(client)
    backup.pop("state.json")
    with TestClient(create_app(tmp_path / "andere", sim=True)) as other:
        assert other.post("/api/import", json=backup).status_code == 200
        assert _productions(other) == backup["productions.json"]


def test_full_backup_without_productions_keeps_them(client):
    _hamlet(client)
    before = _productions(client)
    backup = client.get("/api/export").json()
    for k in ("state.json", "productions.json"):
        backup.pop(k)
    assert client.post("/api/import", json=backup).status_code == 200
    assert _productions(client) == before


def test_full_backup_invalid_productions_changes_nothing(client):
    _hamlet(client)
    before = (_productions(client), client.get("/api/scenes").json())
    backup = client.get("/api/export").json()
    backup.pop("state.json")
    backup["scenes.json"] = {"scenes": []}
    backup["productions.json"]["productions"].append(backup["productions.json"]["productions"][0])
    assert client.post("/api/import", json=backup).status_code == 400
    assert (_productions(client), client.get("/api/scenes").json()) == before


def test_full_backup_import_stops_show_of_missing_production(client):
    _hamlet(client)
    backup = client.get("/api/export").json()
    backup.pop("state.json")
    backup["productions.json"]["productions"] = [p for p in backup["productions.json"]["productions"]
                                                 if p["id"] != "hamlet"]
    client.post("/api/show/start", json={"productionId": "hamlet"})
    assert client.post("/api/import", json=backup).status_code == 200
    assert client.get("/api/show").json()["running"] is False
