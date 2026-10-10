"""Überblendung auf DMX-Kanalebene."""

from ..config import DMX_CHANNELS


class FadeEngine:
    def __init__(self, size: int = DMX_CHANNELS) -> None:
        self.size = size
        self.start = [0] * size
        self.target = [0] * size
        self.t0 = [0.0] * size
        self.t1 = [0.0] * size

    def current(self, i: int, now: float) -> int:
        if now >= self.t1[i] or self.t1[i] <= self.t0[i]:
            return self.target[i]
        k = (now - self.t0[i]) / (self.t1[i] - self.t0[i])
        return round(self.start[i] + (self.target[i] - self.start[i]) * k)

    def set_target(self, i: int, value: int, fade_s: float, now: float) -> None:
        if value == self.target[i] and now >= self.t1[i]:
            return
        # laufende Überblendung wird vom aktuellen Wert aus übernommen
        self.start[i] = self.current(i, now)
        self.target[i] = value
        self.t0[i] = now
        self.t1[i] = now + max(0.0, fade_s)

    def set_targets(self, frame: list[int], fade_s: float, now: float) -> None:
        # unveränderte Kanäle behalten ihre laufende Überblendung
        for i, v in enumerate(frame):
            if v != self.target[i]:
                self.set_target(i, v, fade_s, now)

    def frame(self, now: float) -> list[int]:
        return [self.current(i, now) for i in range(self.size)]

    def busy(self, now: float) -> bool:
        return any(now < t for t in self.t1)
