"""Synthetisches Vogelgezwitscher (Stereo-WAV) – mehrere Vögel mit Trillern, Pfiffen und Rufen.

    uv run --group effekte python effekte/vogelgezwitscher.py [ziel.wav]
"""
import sys
import wave
from pathlib import Path

import numpy as np
SR = 48000
DUR = 90.0
rng = np.random.default_rng(7)
out = np.zeros((int(SR * DUR), 2))

def env(n, attack=0.15, release=0.4):
    e = np.ones(n)
    a, r = max(1, int(n * attack)), max(1, int(n * release))
    e[:a] = np.linspace(0, 1, a) ** 1.5
    e[-r:] = np.linspace(1, 0, r) ** 2
    return e

def chirp(f0, f1, dur, vib=0.0, vibf=30.0, curve=1.0):
    n = int(SR * dur)
    t = np.arange(n) / SR
    k = (t / dur) ** curve
    f = f0 + (f1 - f0) * k
    f = f * (1 + vib * np.sin(2 * np.pi * vibf * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) + 0.18 * np.sin(2 * ph) + 0.05 * np.sin(3 * ph)
    return s * env(n)

def place(sig, start, gain, pan):
    i = int(start * SR)
    j = min(len(out), i + len(sig))
    if i >= len(out): return
    sig = sig[: j - i] * gain
    out[i:j, 0] += sig * np.sqrt(1 - pan)
    out[i:j, 1] += sig * np.sqrt(pan)

def trill(start, base, gain, pan):            # schnelle Wiederholung kurzer Töne (Meise/Grasmücke)
    n = rng.integers(5, 14); step = rng.uniform(0.055, 0.09)
    for k in range(n):
        f = base * (1 + 0.05 * np.sin(k))
        place(chirp(f * 1.25, f * 0.8, step * 0.7), start + k * step, gain * (0.7 + 0.3 * rng.random()), pan)
    return start + n * step

def whistle(start, base, gain, pan):         # Amsel-artige Pfiffe
    t = start
    for _ in range(rng.integers(2, 5)):
        d = rng.uniform(0.12, 0.35)
        a, b = base * rng.uniform(0.8, 1.2), base * rng.uniform(0.7, 1.4)
        place(chirp(a, b, d, vib=0.01, vibf=7, curve=rng.uniform(0.5, 2)), t, gain, pan)
        t += d + rng.uniform(0.04, 0.12)
    return t

def call_(start, base, gain, pan):           # zwei-silbiger Ruf „zi-zi“
    t = start
    for _ in range(rng.integers(2, 4)):
        place(chirp(base * 1.4, base, 0.09), t, gain, pan)
        place(chirp(base * 1.1, base * 1.5, 0.07), t + 0.11, gain * 0.8, pan)
        t += rng.uniform(0.3, 0.45)
    return t

birds = [  # (Grundfrequenz, Lautstärke, Stereo-Position, Liedtypen, Pause)
    (4200, 0.22, 0.15, [trill, call_], (1.5, 5)),
    (2400, 0.28, 0.75, [whistle], (2.5, 7)),
    (5200, 0.14, 0.5, [trill], (3, 9)),
    (3300, 0.18, 0.9, [call_, whistle], (2, 6)),
    (6000, 0.08, 0.3, [trill, call_], (4, 12)),   # weiter weg
]
for base, gain, pan, songs, (p0, p1) in birds:
    t = rng.uniform(0, 3)
    while t < DUR - 2:
        song = songs[rng.integers(len(songs))]
        t = song(t, base * rng.uniform(0.93, 1.07), gain, pan) + rng.uniform(p0, p1)

# leises Blätterrauschen als Untergrund
noise = rng.normal(0, 1, len(out))
noise = np.convolve(noise, np.ones(40) / 40, mode="same")
mod = 0.5 + 0.5 * np.sin(2 * np.pi * np.arange(len(out)) / SR / 7.0)
out[:, 0] += noise * 0.012 * mod
out[:, 1] += np.roll(noise, 9000) * 0.012 * mod

# sanft ein-/ausblenden für nahtlose Schleife
f = int(SR * 2)
out[:f] *= np.linspace(0, 1, f)[:, None]
out[-f:] *= np.linspace(1, 0, f)[:, None]
out /= max(1e-9, np.abs(out).max()) / 0.8
ZIEL = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).resolve().parent.parent / "data" / "vogelgezwitscher.wav")
with wave.open(ZIEL, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("geschrieben:", ZIEL)
