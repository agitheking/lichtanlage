"""Hardware-Test ohne Web-Oberfläche.

    uv run python scripts/dmx_smoke.py --channel 1 --value 255      # Kanal 1 auf voll (Strg+C beendet)
    uv run python scripts/dmx_smoke.py --chase --start 1 --end 64   # Lauflicht über Kanäle
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lichtpult.dmx.backends import SerialBackend  # noqa: E402
from lichtpult.dmx.discover import find_port  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--serial")
    p.add_argument("--channel", type=int, default=1)
    p.add_argument("--value", type=int, default=255)
    p.add_argument("--chase", action="store_true")
    p.add_argument("--start", type=int, default=1)
    p.add_argument("--end", type=int, default=32)
    p.add_argument("--step", type=float, default=0.5, help="Sekunden pro Kanal beim Lauflicht")
    a = p.parse_args()

    port = find_port(a.serial)
    if not port:
        sys.exit("Kein DMX-Interface gefunden")
    out = SerialBackend(port)
    print(f"Interface: {port}")
    frame = bytearray(512)
    try:
        if a.chase:
            while True:
                for ch in range(a.start, a.end + 1):
                    frame[:] = bytes(512)
                    frame[ch - 1] = a.value
                    print(f"\rKanal {ch:3d}", end="", flush=True)
                    t_end = time.monotonic() + a.step
                    while time.monotonic() < t_end:
                        out.send(bytes(frame))
                        time.sleep(0.025)
        else:
            frame[a.channel - 1] = a.value
            print(f"Kanal {a.channel} = {a.value} (Strg+C zum Beenden)")
            while True:
                out.send(bytes(frame))
                time.sleep(0.025)
    except KeyboardInterrupt:
        pass
    finally:
        out.send(bytes(512))
        out.close()
        print("\nAlles aus.")


if __name__ == "__main__":
    main()
