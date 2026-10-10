import pytest


@pytest.fixture
def show(client):
    """Produktion „Hamlet“ mit zwei Szenen und Ablauf: Nacht · Notiz · Tag (Fade 7) · Nacht."""
    s = client.app.state.services
    clock = {"t": 1000.0}
    s.show.clock = lambda: clock["t"]  # Entprellung mit gesteuerter Zeit
    client.post("/api/productions", json={"name": "Hamlet"})
    client.post("/api/levels", json={"levels": {"f01": {"dimmer": 0.3}}})
    client.post("/api/productions/hamlet/scenes/capture", json={"name": "Nacht", "fade": 4})
    client.post("/api/levels", json={"levels": {"f01": {"dimmer": 0.9}}})
    client.post("/api/productions/hamlet/scenes/capture", json={"name": "Tag", "fade": 2})
    for cue in ({"sceneId": "nacht", "note": "Hamlet kommt raus"},
                {"note": "Stichwort: Eisenbahn"},
                {"sceneId": "tag", "fadeSeconds": 7, "othersOff": False},
                {"sceneId": "nacht"}):
        assert client.post("/api/productions/hamlet/cues", json=cue).status_code == 200

    calls = []
    orig = s.engine.apply_scene

    def spy(sc, fade_s=None, others_off=True):
        calls.append((sc.id, fade_s, others_off))
        return orig(sc, fade_s, others_off)

    s.engine.apply_scene = spy

    def step(action, **body):
        clock["t"] += 1  # ausreichend Abstand für die Entprellung
        return client.post(f"/api/show/{action}", json=body or None)

    return {"client": client, "calls": calls, "clock": clock, "step": step, "services": s}


def _dimmer(client):
    return client.get("/api/state").json()["fixtures"]["f01"]["dimmer"]


def test_initial_state(client):
    assert client.get("/api/show").json() == {"running": False, "productionId": None, "cueIndex": None,
                                              "atEnd": False}


def test_start_next_prev_with_fades(show):
    c, calls, step = show["client"], show["calls"], show["step"]
    r = step("start", productionId="hamlet").json()
    assert r == {"running": True, "productionId": "hamlet", "cueIndex": 0, "atEnd": False}
    assert calls == [("nacht", None, True)]  # kein Cue-Fade → apply_scene nimmt den Fade der Szene
    assert _dimmer(c) == 0.3

    r = step("next").json()  # Notiz-Cue: Licht bleibt
    assert r["cueIndex"] == 1 and len(calls) == 1 and _dimmer(c) == 0.3

    r = step("next").json()  # Cue-Fade 7 überschreibt den Szenen-Fade 2
    assert r["cueIndex"] == 2 and calls[-1] == ("tag", 7, False) and _dimmer(c) == 0.9

    r = step("prev").json()
    assert r["cueIndex"] == 1 and len(calls) == 2  # zurück auf Notiz: wieder kein Abruf
    r = step("prev").json()
    assert r["cueIndex"] == 0 and calls[-1] == ("nacht", None, True)
    r = step("prev").json()  # bei 0 bleibt es bei 0
    assert r["cueIndex"] == 0 and len(calls) == 3


def test_fade_none_uses_scene_fade(show):
    """Cue ohne Fade → Szenen-Fade (4 s) landet in der Fade-Engine."""
    s, step = show["services"], show["step"]
    seen = []
    orig = s.engine.set_levels
    s.engine.set_levels = lambda levels, fade_s=0.0: seen.append(fade_s) or orig(levels, fade_s)
    step("start", productionId="hamlet")
    assert seen == [4]


def test_next_at_end_stays(show):
    step, calls = show["step"], show["calls"]
    step("start", productionId="hamlet")
    step("goto", cueIndex=3)
    n = len(calls)
    r = step("next")
    assert r.status_code == 200
    assert r.json() == {"running": True, "productionId": "hamlet", "cueIndex": 3, "atEnd": True}
    assert len(calls) == n  # kein erneuter Abruf


def test_goto_and_errors(show):
    c, step, calls = show["client"], show["step"], show["calls"]
    for action in ("next", "prev", "stop"):
        assert step(action).status_code == 409
    assert step("goto", cueIndex=0).status_code == 409
    assert step("start", productionId="gibts-nicht").status_code == 404
    step("start")  # ohne productionId → aktive Produktion (Beispiel)
    assert c.get("/api/show").json()["productionId"] == "beispiel"
    step("start", productionId="hamlet")
    r = step("goto", cueIndex=2).json()
    assert r["cueIndex"] == 2 and calls[-1] == ("tag", 7, False)
    assert step("goto", cueIndex=4).status_code == 422
    assert step("goto", cueIndex=-1).status_code == 422
    assert c.get("/api/show").json()["cueIndex"] == 2
    r = step("stop").json()
    assert r == {"running": False, "productionId": None, "cueIndex": None, "atEnd": False}
    assert _dimmer(c) == 0.9  # Beenden lässt das Licht stehen
    assert step("next").status_code == 409


def test_start_without_cues_is_422(show):
    c = show["client"]
    c.post("/api/productions", json={"name": "Leer"})
    assert show["step"]("start", productionId="leer").status_code == 422
    assert c.get("/api/show").json()["running"] is False


def test_debounce_next_prev(show):
    c, clock = show["client"], show["clock"]
    show["step"]("start", productionId="hamlet")
    clock["t"] += 1
    assert c.post("/api/show/next").json()["cueIndex"] == 1
    clock["t"] += 0.1
    assert c.post("/api/show/next").json()["cueIndex"] == 1  # Doppeldruck ignoriert
    clock["t"] += 0.1
    assert c.post("/api/show/prev").json()["cueIndex"] == 1  # auch prev zählt
    clock["t"] += 0.3
    assert c.post("/api/show/next").json()["cueIndex"] == 2
    clock["t"] += 0.26
    assert c.post("/api/show/prev").json()["cueIndex"] == 1
    clock["t"] += 0.01
    assert c.post("/api/show/goto", json={"cueIndex": 3}).json()["cueIndex"] == 3  # goto nicht entprellt


def test_deleting_production_or_cues_updates_show(show):
    c, step = show["client"], show["step"]
    step("start", productionId="hamlet")
    step("goto", cueIndex=3)
    cues = next(p for p in c.get("/api/productions").json()["productions"] if p["id"] == "hamlet")["cues"]
    c.delete(f"/api/productions/hamlet/cues/{cues[3]['id']}")
    assert c.get("/api/show").json() == {"running": True, "productionId": "hamlet", "cueIndex": 2, "atEnd": True}
    c.delete("/api/productions/hamlet")
    assert c.get("/api/show").json()["running"] is False
    assert step("next").status_code == 409


def test_ws_show_event(show):
    c, step = show["client"], show["step"]

    def until(ws, kind):
        while True:
            m = ws.receive_json()
            if m["type"] == kind:
                return m

    with c.websocket_connect("/ws") as ws:
        hello = until(ws, "hello")
        assert hello["show"]["running"] is False
        step("start", productionId="hamlet")
        assert until(ws, "show")["show"]["cueIndex"] == 0
        step("next")
        assert until(ws, "show")["show"] == {"running": True, "productionId": "hamlet", "cueIndex": 1,
                                             "atEnd": False}
        step("stop")
        assert until(ws, "show")["show"]["running"] is False
    with c.websocket_connect("/ws") as ws:
        step("start", productionId="hamlet")
    with c.websocket_connect("/ws") as ws:
        assert until(ws, "hello")["show"]["productionId"] == "hamlet"
