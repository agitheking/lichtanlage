"""Sommer: warmes Sonnenlicht, Laubflirren auf den LEDs, Vogelgezwitscher in Schleife.

    uv run --group effekte python effekte/sommer.py            # bis Strg+C
    uv run --group effekte python effekte/sommer.py --ohne-ton 1
"""
import math
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

from _pult import args, levels, raw_off, running, save_scene

WAV = Path(__file__).resolve().parent.parent / "data" / "vogelgezwitscher.wav"
SUN = {"r": 1.0, "g": 0.75, "b": 0.2, "w": 0.7, "a": 0.6}
LEAF = {"r": 0.35, "g": 1.0, "b": 0.15, "w": 0.35, "a": 0.2}
SKY = {"r": 0.4, "g": 0.7, "b": 1.0, "w": 0.8, "a": 0.0}
LEDS = {"f02": (0.9, SUN), "f05": (0.55, LEAF), "f10": (0.7, SKY)}


def start_audio():
    if not WAV.exists():
        subprocess.run([sys.executable, str(Path(__file__).with_name("vogelgezwitscher.py")), str(WAV)], check=True)
    for cmd in (["mpv", "--no-video", "--really-quiet", "--loop-file=inf"], ["ffplay", "-nodisp", "-loglevel", "quiet", "-loop", "0"]):
        if shutil.which(cmd[0]):
            return subprocess.Popen(cmd + [str(WAV)])
    print("Kein Abspieler gefunden (mpv oder ffplay) – ohne Ton.")
    return None


def main():
    a = args("Sommerstimmung mit Vogelgezwitscher", **{"ohne-ton": (int, 0, "1 = kein Ton")})
    base = {f"f{i:02d}": {"dimmer": 0.75} for i in range(1, 16)}
    base.update({"f11": {"dimmer": 0.9}, "f15": {"dimmer": 0.9}, "f13": {"dimmer": 0.85},
                 "f14": {"dimmer": 0.5}, "f16": {"dimmer": 1.0},
                 **{fid: {"dimmer": d, **col} for fid, (d, col) in LEDS.items()}})
    raw_off()
    levels(base, fade=5)
    save_scene("Sommer", base, 5)
    audio = None if a.ohne_ton else start_audio()
    phases = {k: [random.uniform(0, 6.28) for _ in range(3)] for k in LEDS}
    t0 = time.time()
    try:
        while running(a.dauer):
            t = time.time() - t0
            lv = {}
            for fid, (d, _) in LEDS.items():
                wob = sum(math.sin(2 * math.pi * f * t + p) * amp
                          for f, p, amp in zip((0.13, 0.31, 0.71), phases[fid], (0.5, 0.3, 0.2)))
                lv[fid] = {"dimmer": max(0.0, min(1.0, d * (1 + 0.22 * wob)))}
            levels(lv)
            time.sleep(0.1)
    finally:
        if audio:
            audio.terminate()
        levels({fid: {"dimmer": d} for fid, (d, _) in LEDS.items()}, fade=1)


if __name__ == "__main__":
    main()
