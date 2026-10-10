"""Sanftes Lauflicht: weiche Lichtwelle über die Scheinwerfer am Rohr.

    uv run python effekte/lauflicht.py --tempo 3 --hell 0.7
"""
import math
import time

from _pult import args, raw, raw_off, rig, running

LED_TYPE = "par-rgbwa-uv-8ch"


def led_warm(d):
    return [round(255 * d), 0, 90, 50, 0, 255, 120, 0]   # Dim, Strobe, R, G, B, W, A, UV


def main():
    a = args("Sanftes Lauflicht", tempo=(float, 3.0, "Scheinwerfer pro Sekunde"),
             breite=(float, 1.6, "Breite der Welle in Scheinwerfern"), hell=(float, 0.7, "maximale Helligkeit 0–1"))
    fx = sorted((f for f in rig().values() if f["mount"]["kind"] == "arc"), key=lambda f: f["mount"]["t"])
    n = len(fx)
    start = time.time()
    try:
        while running(a.dauer):
            pos = ((time.time() - start) * a.tempo) % (n + 2 * a.breite) - a.breite
            ch = {}
            for i, f in enumerate(fx):
                x = (i - pos) / a.breite
                lvl = a.hell * (0.5 + 0.5 * math.cos(math.pi * x)) if abs(x) < 1 else 0.0
                vals = led_warm(lvl) if f["typeId"] == LED_TYPE else [round(255 * lvl)]
                for k, v in enumerate(vals):
                    ch[f["address"] + k] = v
            raw(ch, clear=True, solo=True)
            time.sleep(0.05)
    finally:
        raw_off()


if __name__ == "__main__":
    main()
