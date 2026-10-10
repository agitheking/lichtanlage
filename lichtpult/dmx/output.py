"""DMX-Ausgabe in eigenem Thread mit festem Takt und automatischem Wiederverbinden."""

import logging
import threading
import time
from collections.abc import Callable

from ..config import DMX_FPS, RECONNECT_INTERVAL_S
from .backends import DmxBackend, SerialBackend, SimBackend
from .discover import find_port

log = logging.getLogger(__name__)


class DmxOutput:
    def __init__(
        self,
        compute_frame: Callable[[float], bytes],
        *,
        sim: bool = False,
        port: str | None = None,
        fps: int = DMX_FPS,
        on_status: Callable[[dict], None] | None = None,
    ) -> None:
        self._compute = compute_frame
        self._force_sim = sim
        self._port_pref = port
        self._period = 1.0 / fps
        self._on_status = on_status or (lambda s: None)
        self._backend: DmxBackend = SimBackend()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._next_reconnect = 0.0
        self.fps = fps
        self.frames_sent = 0
        self.last_error: str | None = None
        self.last_frame = bytes(512)

    # --- Status -------------------------------------------------------------

    @property
    def connected(self) -> bool:
        return isinstance(self._backend, SerialBackend)

    def status(self) -> dict:
        return {
            "mode": "sim" if self._force_sim else "serial",
            "connected": self.connected,
            "port": self._backend.port,
            "fps": self.fps,
            "framesSent": self.frames_sent,
            "lastError": self.last_error,
        }

    def _emit(self) -> None:
        try:
            self._on_status(self.status())
        except Exception:
            log.exception("Status-Callback fehlgeschlagen")

    # --- Verbindung ---------------------------------------------------------

    def _try_connect(self) -> None:
        if self._force_sim or self.connected:
            return
        port = find_port(self._port_pref)
        if not port:
            if self.last_error != "Kein DMX-Interface gefunden":
                self.last_error = "Kein DMX-Interface gefunden"
                self._emit()
            return
        try:
            self._backend = SerialBackend(port)
        except Exception as e:  # noqa: BLE001 – Rechte, belegt, abgezogen …
            msg = f"{port}: {e}"
            if msg != self.last_error:
                self.last_error = msg
                log.warning("DMX-Interface nicht verfügbar: %s", msg)
                self._emit()
            return
        self.last_error = None
        log.info("DMX-Interface verbunden: %s", port)
        self._emit()

    def _disconnect(self, err: Exception) -> None:
        log.warning("DMX-Interface getrennt: %s", err)
        self._backend.close()
        self._backend = SimBackend()
        self.last_error = f"Verbindung verloren: {err}"
        self._next_reconnect = time.monotonic() + RECONNECT_INTERVAL_S
        self._emit()

    def reconnect(self) -> None:
        self._next_reconnect = 0.0
        if self.connected:
            self._backend.close()
            self._backend = SimBackend()

    # --- Loop ---------------------------------------------------------------

    def start(self) -> None:
        self._try_connect()
        self._thread = threading.Thread(target=self._run, name="dmx-output", daemon=True)
        self._thread.start()

    def stop(self, blackout: bool = False) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        if blackout:
            try:
                self._backend.send(bytes(512))
            except Exception:
                pass
        self._backend.close()

    def _run(self) -> None:
        next_tick = time.monotonic()
        while not self._stop.is_set():
            now = time.monotonic()
            if not self.connected and now >= self._next_reconnect:
                self._next_reconnect = now + RECONNECT_INTERVAL_S
                self._try_connect()
            try:
                frame = self._compute(now)
                self.last_frame = frame
                self._backend.send(frame)
                self.frames_sent += 1
            except (OSError, ValueError) as e:  # SerialException ist ein OSError
                self._disconnect(e)
            except Exception:
                log.exception("Fehler im DMX-Loop")
            next_tick += self._period
            delay = next_tick - time.monotonic()
            if delay < -0.5:  # stark im Rückstand (z. B. Suspend) → neu takten
                next_tick = time.monotonic()
                delay = 0
            self._stop.wait(max(0.0, delay))
