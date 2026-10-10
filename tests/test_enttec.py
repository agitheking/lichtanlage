from lichtpult.dmx.enttec import END, LABEL_SEND_DMX, START, build_dmx_packet, build_packet


def test_full_universe_packet():
    frame = bytes(range(256)) * 2
    pkt = build_dmx_packet(frame)
    assert len(pkt) == 4 + 513 + 1
    assert pkt[:4] == bytes([START, LABEL_SEND_DMX, 0x01, 0x02])  # 513 = 0x0201
    assert pkt[4] == 0  # Startcode
    assert pkt[5:-1] == frame
    assert pkt[-1] == END


def test_empty_packet():
    assert build_packet(10) == bytes([0x7E, 10, 0, 0, 0xE7])


def test_too_long_frame_rejected():
    import pytest

    with pytest.raises(ValueError):
        build_dmx_packet(bytes(513))
