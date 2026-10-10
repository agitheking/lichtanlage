def test_hello_and_levels_broadcast(client):
    with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
        hello = a.receive_json()
        assert hello["type"] == "hello" and len(hello["rig"]["fixtures"]) == 16

        def until(ws, kind):
            while True:
                m = ws.receive_json()
                if m["type"] == kind:
                    return m

        until(b, "hello")
        a.send_json({"type": "set_levels", "levels": {"f01": {"dimmer": 0.5}}})
        m = until(b, "levels")
        assert m["fixtures"]["f01"]["dimmer"] == 0.5
        assert m["origin"] == hello["clientId"]
        a.send_json({"type": "quatsch"})
        assert until(a, "error")["message"].startswith("Unbekannter")
