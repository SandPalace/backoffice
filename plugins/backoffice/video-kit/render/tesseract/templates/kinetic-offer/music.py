"""Original synthesized bed for Kinetic Offer spots (no samples, no third-party material).

Calm, warm and on a strict grid so the picture can land on beats: soft kick on 1 and 3, a quiet
shaker in eighths, electric-piano chords (I-V-vi-IV in D), a sub under each chord, and a pluck
arpeggio that enters at --lift. Between the two --drop times the drums and arpeggio drop out,
which leaves room before the offer lands. Fades out over the last 0.9 s.

Usage: python3 music.py --out bed.wav --duration 15 --bpm 120 --lift 7.0 --drop 10.9 11.5
"""
import argparse
import wave

import numpy as np

SR = 48000
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--duration", type=float, required=True)
ap.add_argument("--bpm", type=float, default=120)
ap.add_argument("--lift", type=float, default=7.0)
ap.add_argument("--drop", type=float, nargs=2, default=(10.9, 11.5))
ap.add_argument("--seed", type=int, default=3)
a = ap.parse_args()

beat = 60 / a.bpm
n = int(SR * (a.duration + 2))
mix = np.zeros((n, 2))
rng = np.random.default_rng(a.seed)


def add(sig, t, pan=0.0, gain=1.0):
    i = int(t * SR)
    if i >= n or t < 0:
        return
    sig = sig[: n - i] * gain
    mix[i:i + len(sig), 0] += sig * (1 - max(0, pan))
    mix[i:i + len(sig), 1] += sig * (1 + min(0, pan))


def ts(length):
    return np.arange(int(length * SR)) / SR


def kick():
    t = ts(0.4)
    f = 48 + 70 * np.exp(-t * 28)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8)
    click = np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 300) * 0.08  # audible on phone speakers
    return body + click


def shaker():
    t = ts(0.07)
    s = np.diff(rng.standard_normal(len(t) + 1)) * np.minimum(1, t / 0.008) * np.exp(-t * 60)
    return s * 0.12


def epiano(freq, length):
    t = ts(length)
    tone = (np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t * 3)
            + 0.12 * np.sin(2 * np.pi * 3 * freq * t) * np.exp(-t * 6))
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.5 * t)
    return tone * trem * np.minimum(1, t / 0.012) * np.exp(-t * 0.6) * 0.2


def sub(freq, length):
    t = ts(length)
    return np.sin(2 * np.pi * freq * t) * np.minimum(1, t / 0.02) * np.minimum(1, (length - t) / 0.12) * 0.22


def pluck(freq):
    t = ts(0.5)
    s = sum(np.sin(2 * np.pi * freq * k * t) / k ** 1.8 for k in (1, 2, 3, 4))
    return s * np.minimum(1, t / 0.003) * np.exp(-t * 7) * 0.10


def hz(m):
    return 440 * 2 ** ((m - 69) / 12)


# D - A - Bm - G, one chord per bar.
CHORDS = [(50, [62, 66, 69, 74]), (45, [61, 64, 69, 73]), (47, [62, 66, 71, 74]), (43, [62, 67, 71, 74])]
bar = 4 * beat
for b in range(int(a.duration / bar) + 1):
    t0 = b * bar
    root, voicing = CHORDS[b % 4]
    for k, m in enumerate(voicing):
        add(epiano(hz(m), bar * 1.1), t0 + k * 0.008, pan=(-0.35, -0.1, 0.1, 0.35)[k])
    add(sub(hz(root - 12), bar + 0.1), t0)  # overlaps the next bar: no gap at the change
    for i in range(8):
        te = t0 + i * beat / 2
        if a.drop[0] <= te < a.drop[1]:
            continue
        if i in (0, 4):
            add(kick(), te, gain=0.75)
        add(shaker(), te, pan=0.25, gain=1.0 if i % 2 else 0.6)
        if te >= a.lift - 0.01:
            add(pluck(hz(voicing[(i * 3) % 4] + 12)), te, pan=(-0.3, 0.3)[i % 2])

mix = mix[: int(a.duration * SR)]
fade = int(0.9 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
mix *= 10 ** (-3 / 20) / np.abs(mix).max()
with wave.open(a.out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"wrote {a.out}: {a.duration:.2f}s at {a.bpm:g} BPM")
