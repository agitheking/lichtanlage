def test_status_sim(client):
    s = client.get("/api/status").json()
    assert s["dmx"]["mode"] == "sim"


def test_fixture_crud(client):
    new_id = client.get("/api/fixtures/new-id").json()["id"]
    assert new_id == "f17"
    fx = {"id": new_id, "name": "Neu", "typeId": "generic-dimmer-1ch", "address": 500, "mount": {"kind": "arc", "t": 0.5}}
    r = client.post("/api/fixtures", json=fx)
    assert r.status_code == 200
    created = next(f for f in r.json()["rig"]["fixtures"] if f["id"] == new_id)
    assert created["position"][1] == 2.15
    fx["address"] = 1  # Überschneidung mit f01 → Warnung, kein Fehler
    r = client.put(f"/api/fixtures/{new_id}", json=fx)
    assert any(c["kind"] == "overlap" for c in r.json()["conflicts"])
    assert client.delete(f"/api/fixtures/{new_id}").status_code == 200
    assert client.delete(f"/api/fixtures/{new_id}").status_code == 404


def test_validation_errors(client):
    bad = {"id": "x", "name": "x", "typeId": "generic-dimmer-1ch", "address": 600}
    assert client.post("/api/fixtures", json=bad).status_code == 422
    bad = {"id": "y", "name": "y", "typeId": "gibts-nicht", "address": 1}
    assert client.post("/api/fixtures", json=bad).status_code == 400


def test_type_lifecycle(client):
    dup = client.post("/api/fixture-types/generic-rgb-3ch/duplicate", json={"name": "Mein PAR"}).json()
    assert dup["id"] == "mein-par" and dup["builtin"] is False
    assert client.delete("/api/fixture-types/generic-rgb-3ch").status_code == 400
    dup["channels"].append({"name": "Weiß", "role": "white"})
    assert len(client.put("/api/fixture-types/mein-par", json=dup).json()["channels"]) == 4
    assert client.delete("/api/fixture-types/mein-par").status_code == 200


def test_levels_and_frame(client):
    client.post("/api/levels", json={"levels": {"f16": {"dimmer": 1}}})
    import time

    time.sleep(0.1)
    addr = next(f for f in client.get("/api/rig").json()["rig"]["fixtures"] if f["id"] == "f16")["address"]
    assert client.get("/api/dmx/frame").json()[addr - 1] == 255
    client.post("/api/blackout", json={"on": True})
    time.sleep(0.1)
    assert client.get("/api/dmx/frame").json()[addr - 1] == 0


def test_export_import(client):
    client.post("/api/scenes/capture", json={"name": "Test", "fade": 1})
    data = client.get("/api/export").json()
    assert "scenes.json" in data and "rig.json" in data
    data.pop("state.json", None)
    assert client.post("/api/import", json=data).status_code == 200
    assert client.post("/api/import", json={"evil.json": {}}).status_code == 400


def test_create_scene_from_levels(client):
    r = client.post("/api/scenes", json={"name": "Nacht", "fadeSeconds": 4, "levels": {"f02": {"dimmer": 0.3, "b": 1}, "gibts-nicht": {"dimmer": 1}}})
    assert r.status_code == 200
    sc = r.json()
    assert sc["id"] == "nacht" and list(sc["levels"]) == ["f02"]
    assert client.get("/api/state").json()["fixtures"].get("f02", {}).get("dimmer", 0) == 0  # Licht unverändert
