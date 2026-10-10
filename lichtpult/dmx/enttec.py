"""Paketformat des ENTTEC DMX USB Pro (API 1.44)."""

START = 0x7E
END = 0xE7
LABEL_GET_PARAMS = 3
LABEL_SEND_DMX = 6
LABEL_GET_SERIAL = 10


def build_packet(label: int, data: bytes = b"") -> bytes:
    n = len(data)
    if n > 600:
        raise ValueError(f"Nutzdaten zu lang: {n}")
    return bytes([START, label, n & 0xFF, n >> 8]) + data + bytes([END])


def build_dmx_packet(frame: bytes | bytearray | list[int]) -> bytes:
    """frame: bis zu 512 Kanalwerte; vorangestellt wird Startcode 0."""
    frame = bytes(frame)
    if len(frame) > 512:
        raise ValueError("Ein DMX-Universum hat höchstens 512 Kanäle")
    return build_packet(LABEL_SEND_DMX, b"\x00" + frame)
