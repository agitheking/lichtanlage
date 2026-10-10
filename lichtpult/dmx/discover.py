import glob

from serial.tools import list_ports

from ..config import ENTTEC_BY_ID_GLOB, FTDI_PID, FTDI_VID


def find_port(preferred: str | None = None) -> str | None:
    """Sucht das Interface: expliziter Pfad → /dev/serial/by-id → FTDI per VID/PID."""
    if preferred:
        return preferred
    by_id = sorted(glob.glob(ENTTEC_BY_ID_GLOB))
    if by_id:
        return by_id[0]
    for p in list_ports.comports():
        if p.vid == FTDI_VID and p.pid == FTDI_PID:
            return p.device
    return None
