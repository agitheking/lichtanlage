"""Gewitter: blaue Grundstimmung auf den LEDs, laufende Blitze von LED zu LED.

    uv run python effekte/gewitter.py            # bis Strg+C
    uv run python effekte/gewitter.py --dauer 300
"""
import random
import time

from _pult import args, levels, raw, raw_off, running, save_scene

ORDER = [73, 61, 49]                  # LED-PARs von links nach rechts (Dim, Strobe, R, G, B, W, A, UV)
FLASH = [255, 0, 180, 200, 255, 255, 0, 0]
BLUE = {"dimmer": 0.35, "r": 0.0, "g": 0.12, "b": 1.0, "w": 0.0, "a": 0.0}


def led(addr, level):
    if level:
        raw({addr + i: (round(v * level) if i == 0 else v) for i, v in enumerate(FLASH)})
    else:
        raw({addr + i: None for i in range(len(FLASH))})


def strike():
    seq = ORDER if random.random() < 0.5 else ORDER[::-1]
    if random.random() < 0.3:
        k = random.randint(0, 1)
        seq = seq[k:k + 2]
    for _ in range(random.randint(1, 3)):
        level = random.uniform(0.6, 1.0)
        for a in seq:
            led(a, level)
            time.sleep(random.uniform(0.03, 0.06))
            led(a, 0)
            time.sleep(random.uniform(0.02, 0.08))
        time.sleep(random.uniform(0.05, 0.25))


def main():
    a = args("Gewitter mit laufenden Blitzen")
    base = {f"f{i:02d}": {"dimmer": 0.0} for i in range(1, 17)}
    base.update({"f02": BLUE, "f05": {**BLUE, "dimmer": 0.25}, "f10": BLUE})
    raw_off()
    levels(base, fade=4)
    save_scene("Gewitter (Grundstimmung)", base, 4)
    time.sleep(2)
    try:
        while running(a.dauer):
            time.sleep(random.uniform(0.3, 1.5) if random.random() < 0.3 else random.uniform(1, 5))
            strike()
    finally:
        raw_off()


if __name__ == "__main__":
    main()
