"""Gemeinsame Hilfen für die Effekt-Skripte: Zugriff auf die Lichtpult-API, sauberes Beenden."""

import argparse
import json
import os
import signal
import time
import urllib.request

BASE = os.environ.get("LICHTPULT_URL", "http://localhost:8000")
_stop = False


def call(method: str, path: str, body=None):
    req = urllib.request.Request(
        BASE + path,
        json.dumps(body).encode() if body is not None else None,
        {"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        data = r.read()
    return json.loads(data) if data else None


def levels(lv: dict, fade: float = 0.0):
    call("POST", "/api/levels", {"levels": lv, "fade": fade})


def raw(channels: dict, *, clear: bool = False, solo: bool | None = None):
    body = {"channels": {str(k): v for k, v in channels.items()}, "clear": clear}
    if solo is not None:
        body["solo"] = solo
    call("POST", "/api/dmx/raw", body)


def raw_off():
    call("DELETE", "/api/dmx/raw")


def save_scene(name: str, lv: dict, fade: float):
    """Grundstimmung als Szene ablegen (nur beim ersten Mal)."""
    if not any(s["name"] == name for s in call("GET", "/api/scenes")):
        call("POST", "/api/scenes", {"name": name, "fadeSeconds": fade, "levels": lv})


def rig():
    return {f["id"]: f for f in call("GET", "/api/rig")["rig"]["fixtures"]}


def types():
    return {t["id"]: t for t in call("GET", "/api/fixture-types")}


def args(description: str, **extra) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=description)
    p.add_argument("--dauer", type=float, default=0, help="Sekunden (0 = bis Strg+C)")
    for name, (typ, default, hilfe) in extra.items():
        p.add_argument(f"--{name}", type=typ, default=default, help=hilfe)
    return p.parse_args()


def running(dauer: float, _start=[None]) -> bool:
    """True, solange weder Strg+C/SIGTERM kam noch die Dauer abgelaufen ist."""
    if _start[0] is None:
        _start[0] = time.time()
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: globals().__setitem__("_stop", True))
    return not _stop and (dauer <= 0 or time.time() - _start[0] < dauer)
