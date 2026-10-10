import argparse
import logging
from pathlib import Path

import uvicorn

from .config import DEFAULT_DATA_DIR
from .main import create_app


def main() -> None:
    p = argparse.ArgumentParser(prog="lichtpult", description="Lichtpult fürs Kellertheater")
    p.add_argument("--host", default="127.0.0.1", help="0.0.0.0 für Zugriff vom Tablet im WLAN")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--sim", action="store_true", help="ohne DMX-Interface (Simulation)")
    p.add_argument("--serial", help="Pfad zum Interface (Standard: automatisch suchen)")
    p.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    p.add_argument("--blackout-on-exit", action="store_true", help="beim Beenden alle Kanäle auf 0")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app = create_app(a.data_dir, sim=a.sim, serial_port=a.serial, blackout_on_exit=a.blackout_on_exit)
    uvicorn.run(app, host=a.host, port=a.port, ws="websockets", log_level="info")


if __name__ == "__main__":
    main()
