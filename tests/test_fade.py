from lichtpult.core.fade import FadeEngine


def test_instant_without_fade():
    f = FadeEngine(4)
    f.set_target(0, 200, 0, now=10.0)
    assert f.current(0, 10.0) == 200


def test_linear_fade():
    f = FadeEngine(4)
    f.set_target(0, 200, 2.0, now=0.0)
    assert f.current(0, 0.0) == 0
    assert f.current(0, 1.0) == 100
    assert f.current(0, 2.0) == 200
    assert f.current(0, 5.0) == 200


def test_running_fade_is_taken_over():
    f = FadeEngine(4)
    f.set_target(0, 200, 2.0, now=0.0)
    f.set_target(0, 0, 1.0, now=1.0)  # bei 100 umdrehen
    assert f.current(0, 1.0) == 100
    assert f.current(0, 1.5) == 50
    assert f.current(0, 2.0) == 0


def test_set_targets_keeps_unchanged_channels_fading():
    f = FadeEngine(2)
    f.set_targets([200, 0], 2.0, now=0.0)
    f.set_targets([200, 100], 0.0, now=1.0)
    assert f.current(0, 1.0) == 100  # läuft weiter
    assert f.current(1, 1.0) == 100
    assert f.busy(1.5) and not f.busy(2.0)
