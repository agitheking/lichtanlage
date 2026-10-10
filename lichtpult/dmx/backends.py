from typing import Protocol

import serial

from .enttec import build_dmx_packet


class DmxBackend(Protocol):
    port: str | None

    def send(self, frame: bytes) -> None: ...
    def close(self) -> None: ...


class SimBackend:
    """Kein Interface: Frames werden nur gezählt."""

    port = None

    def __init__(self) -> None:
        self.frames = 0

    def send(self, frame: bytes) -> None:
        self.frames += 1

    def close(self) -> None:
        pass


class SerialBackend:
    def __init__(self, port: str) -> None:
        self.port = port
        # Die Baudrate ist beim FTDI-USB-Pro bedeutungslos, DMX-Timing erzeugt das Gerät.
        self._ser = serial.Serial(port, baudrate=57600, timeout=0.1, write_timeout=0.5)

    def send(self, frame: bytes) -> None:
        self._ser.write(build_dmx_packet(frame))

    def close(self) -> None:
        try:
            self._ser.close()
        except Exception:
            pass
