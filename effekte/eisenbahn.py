"""Nachtzug: ruhiges Abteillicht, vorbeiziehende Laternen auf den LEDs, gelegentlich ein Tunnel."""
import math
import random
import time

from _pult import args, levels, raw, raw_off, running, save_scene

LEDS = [(49, 0.74), (61, 0.34), (73, 0.09)]   # (Adresse, Position am Rohr), Fahrtrichtung rechts → links
NIGHT = {"dimmer": 0.15, "r": 0.0, "g": 0.1, "b": 1.0, "w": 0.05, "a": 0.0}
SODIUM = (1.0, 0.45, 0.03, 0.0, 1.0)            # R, G, B, W, A
TUNNEL = (0.6, 0.6, 0.5, 1.0, 0.2)


def frame(pos, width, color, strength, dark=False):
    ch = {}
    for addr, t in LEDS:
        x = (t - pos) / width if pos is not None else 9
        lvl = strength * (0.5 + 0.5 * math.cos(math.pi * x)) if abs(x) < 1 else 0.0
        if lvl < 0.02 and not dark:
            vals = [None] * 8
        else:
            r, g, b, w, a = color
            vals = [round(255 * lvl), 0, round(255 * r), round(255 * g), round(255 * b), round(255 * w), round(255 * a), 0]
        ch.update({addr + i: v for i, v in enumerate(vals)})
    raw(ch)


def sweep(color, strength, speed, width=0.28, dark=False):
    pos = 1.3
    while pos > -0.3:
        frame(pos, width, color, strength, dark)
        time.sleep(0.04)
        pos -= speed * 0.04
    frame(None, width, color, 0, dark)


def main():
    a = args("Nachtzug mit vorbeiziehenden Lichtern")
    base = {f"f{i:02d}": {"dimmer": 0.0} for i in range(1, 17)}
    base.update({"f11": {"dimmer": 0.38}, "f15": {"dimmer": 0.38}, "f13": {"dimmer": 0.3},
                 "f03": {"dimmer": 0.28}, "f12": {"dimmer": 0.28},
                 "f02": NIGHT, "f05": {**NIGHT, "dimmer": 0.1}, "f10": NIGHT})
    raw_off()
    levels(base, fade=4)
    save_scene("Eisenbahn (Grundstimmung)", base, 4)
    time.sleep(3)
    try:
        while running(a.dauer):
            if random.random() < 0.12:
                for _ in range(random.randint(8, 16)):
                    sweep(TUNNEL, random.uniform(0.5, 0.8), random.uniform(4.5, 6.0), width=0.22, dark=True)
                    time.sleep(random.uniform(0.05, 0.2))
                frame(None, 1, TUNNEL, 0)
            else:
                sweep(SODIUM, random.uniform(0.45, 0.9), random.uniform(1.2, 2.2))
                if random.random() < 0.3:
                    time.sleep(random.uniform(0.15, 0.4))
                    sweep(SODIUM, random.uniform(0.4, 0.8), random.uniform(1.2, 2.2))
                time.sleep(random.uniform(1.0, 4.0))
    finally:
        raw_off()


if __name__ == "__main__":
    main()
