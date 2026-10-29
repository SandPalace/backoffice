"""Procedural score for the cartoon-lyric template: a 120 bpm spooky-pop track in A minor
with a harpsichord hook, cut to the page's sections.

  python3 score.py --out music.wav --duration 15 --events events.json

Events come from __meta.music.events: [{t, mode, chord}], sorted by t. A mode lasts until the
next event. Modes:
  intro    harpsichord 8th arpeggio, pad, light kick, finger snaps
  groove   + four-on-the-floor kick, clap on 2/4, 8th hats, octave bass
  dark     drums out: low drone, clock ticks, heartbeat, falling harpsichord notes
  build    groove + noise riser + snare roll into the next event
  drop     groove + 16th arpeggio, offbeat open hats, organ stabs, crash on entry
  thin     bass and hats only
  silence  hard stop (the mix is gated to zero)
  hit      impact, sub drop and a dissonant organ cluster that rings
  end      final strum + crash, rings out to the end
Everything is synthesised with numpy/scipy from a fixed seed: no samples, no licences.
"""
import argparse
import json
import wave

import numpy as np
from scipy.signal import lfilter

SR = 48000
BEAT = 0.5
rng = np.random.default_rng(11)

CHORDS = {
    "Am": [57, 60, 64], "F": [53, 57, 60], "Dm": [50, 53, 57], "E": [52, 56, 59],
    "C": [48, 52, 55], "G": [55, 59, 62], "cluster": [57, 58, 64, 65],
}


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def t_(dur):
    return np.arange(int(dur * SR)) / SR


def lp(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    return lfilter([1 - a], [1, -a], x)


def hp(x, cutoff):
    return x - lp(x, cutoff)


def kick(level=1.0):
    t = t_(0.4)
    f = 46 + 120 * np.exp(-t * 32)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8)
    click = rng.standard_normal(len(t)) * np.exp(-t * 400) * 0.3
    return (body + click) * level


def snare(level=1.0):
    t = t_(0.22)
    n = hp(rng.standard_normal(len(t)), 900) * np.exp(-t * 20)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    return (0.7 * n + 0.6 * tone) * level


def clap(level=1.0):
    t = t_(0.3)
    n = hp(rng.standard_normal(len(t)), 1200)
    env = np.exp(-t * 22)
    for d in (0.0, 0.011, 0.022):
        i = int(d * SR)
        env[i:i + int(0.006 * SR)] += 1.2
    return n * env * 0.5 * level


def snap(level=1.0):
    t = t_(0.08)
    return hp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 90) * 0.6 * level


def hat(open_=False, level=1.0):
    t = t_(0.25 if open_ else 0.05)
    n = hp(hp(rng.standard_normal(len(t)), 7000), 7000)
    return n * np.exp(-t * (11 if open_ else 70)) * 0.35 * level


def crash(level=1.0, dur=1.8):
    t = t_(dur)
    n = hp(rng.standard_normal(len(t)), 4000)
    return n * np.exp(-t * 2.2) * 0.45 * level


def saw(freq, t, n=10):
    return sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, n + 1))


def bass(note, dur=0.22, level=1.0, bright=900):
    t = t_(dur)
    x = saw(hz(note), t, 8) * 0.5 + np.sin(2 * np.pi * hz(note) * t)
    env = np.minimum(1, t / 0.004) * np.exp(-t * 6)
    env[-200:] *= np.linspace(1, 0, 200)
    return lp(x * env, bright) * 0.55 * level


def harpsichord(note, dur=0.7, level=1.0):
    t = t_(dur)
    f = hz(note)
    x = np.zeros_like(t)
    for k in range(1, 14):
        x += np.sin(2 * np.pi * f * k * 1.0007 ** k * t) / k ** 0.75 * np.exp(-t * (2.5 + k * 1.6))
    x += hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 300) * 0.2
    x[-300:] *= np.linspace(1, 0, 300)
    return x * 0.22 * level


def organ(notes, dur=0.18, level=1.0, decay=7.0):
    t = t_(dur)
    x = np.zeros_like(t)
    for m in notes:
        f = hz(m)
        x += sum(np.sin(2 * np.pi * f * k * t) / k for k in (1, 2, 3, 4, 6)) * 0.5
    env = np.minimum(1, t / 0.005) * np.exp(-t * decay)
    env[-400:] *= np.linspace(1, 0, 400)
    return lp(x * env, 2600) * 0.16 * level


def pad(notes, dur, level=1.0):
    t = t_(dur)
    x = np.zeros_like(t)
    for m in notes:
        for det in (-0.12, 0.0, 0.12):
            x += saw(hz(m + det), t, 6)
    env = np.minimum(1, t / 0.25) * np.minimum(1, (dur - t) / 0.2).clip(0, 1)
    return lp(x * env, 1400) * 0.025 * level


def drone(dur, level=1.0):
    t = t_(dur)
    x = np.sin(2 * np.pi * hz(33) * t) + 0.5 * saw(hz(45), t, 6) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * t))
    env = np.minimum(1, t / 0.15) * np.minimum(1, (dur - t) / 0.15).clip(0, 1)
    return lp(x * env, 500) * 0.3 * level


def tick(hi=True):
    t = t_(0.03)
    return np.sin(2 * np.pi * (2400 if hi else 1800) * t) * np.exp(-t * 250) * 0.35


def heart(level=1.0):
    t = t_(0.5)
    one = np.sin(2 * np.pi * 52 * t) * np.exp(-t * 14)
    out = one.copy()
    i = int(0.16 * SR)
    out[i:] += one[: len(out) - i] * 0.7
    return out * 0.9 * level


def riser(dur):
    t = t_(dur)
    n = rng.standard_normal(len(t))
    x = np.zeros_like(t)
    edges = np.linspace(0, len(t), 25).astype(int)
    for a, b, k in zip(edges[:-1], edges[1:], range(24)):
        x[a:b] = hp(lp(n[a:b], 600 + k * 260), 300 + k * 150)
    x += np.sin(2 * np.pi * np.cumsum(220 + 900 * (t / dur) ** 2) / SR) * 0.15
    return x * (t / dur) ** 2 * 0.5


def impact():
    t = t_(2.2)
    sub = np.sin(2 * np.pi * np.cumsum(70 * np.exp(-t * 1.4) + 28) / SR) * np.exp(-t * 1.6)
    burst = lp(rng.standard_normal(len(t)), 900) * np.exp(-t * 9)
    return sub * 1.0 + burst * 0.8


class Mix:
    def __init__(self, dur):
        self.n = int(dur * SR) + SR
        self.dry = np.zeros((2, self.n))
        self.wet = np.zeros(self.n)

    def add(self, sig, at, pan=0.0, gain=1.0, send=0.15):
        i = int(round(at * SR))
        if i >= self.n or i < 0:
            return
        sig = sig[: self.n - i] * gain
        lr = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
        self.dry[:, i:i + len(sig)] += lr[:, None] * sig
        self.wet[i:i + len(sig)] += sig * send

    def reverb(self):
        out = np.zeros((2, self.n))
        for ch, combs in enumerate(((1557, 1617, 1491, 1422), (1277, 1356, 1188, 1116))):
            acc = np.zeros(self.n)
            for d in combs:
                d = int(d * SR / 44100)
                a = np.zeros(d + 1)
                a[0], a[d] = 1, -0.8
                acc += lfilter([1], a, lp(self.wet, 5000))
            for d in (556, 441):
                d = int(d * SR / 44100)
                b = np.zeros(d + 1)
                b[0], b[d] = -0.5, 1
                a = np.zeros(d + 1)
                a[0], a[d] = 1, -0.5
                acc = lfilter(b, a, acc)
            out[ch] = acc * 0.12
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=float, required=True)
    ap.add_argument("--events", required=True)
    a = ap.parse_args()
    dur = a.duration
    ev = sorted(json.load(open(a.events)), key=lambda e: e["t"])
    ev.append({"t": dur + 1, "mode": "end", "chord": ev[-1]["chord"]})
    mx = Mix(dur)

    def at(t):
        for e, nxt in zip(ev, ev[1:]):
            if e["t"] <= t + 1e-6 < nxt["t"]:
                return e, nxt
        return ev[-2], ev[-1]

    # section-long layers and one-shots on section entry
    for e, nxt in zip(ev[:-1], ev[1:]):
        span = min(nxt["t"], dur) - e["t"]
        ch = CHORDS[e["chord"]]
        m = e["mode"]
        if m in ("intro", "groove", "build", "drop"):
            mx.add(pad(ch, span + 0.1, 1.4 if m == "intro" else 1.0), e["t"], send=0.3)
        if m == "dark":
            mx.add(drone(span), e["t"], gain=1.0, send=0.2)
            for k in range(int(span / BEAT)):
                mx.add(harpsichord(81 - [0, 1, 4, 5, 7, 8][k % 6], 1.2), e["t"] + k * BEAT, pan=0.3, gain=0.7, send=0.6)
            for k in range(int(span / 1.0) + 1):
                mx.add(heart(), e["t"] + k * 1.0 + 0.05, gain=0.9, send=0.05)
        if m == "build":
            mx.add(riser(span), e["t"], gain=0.7, send=0.2)
            roll = min(1.0, span)
            n16 = int(roll / (BEAT / 4))
            for k in range(n16):
                mx.add(snare(0.25 + 0.75 * k / n16), nxt["t"] - roll + k * BEAT / 4, gain=0.8, send=0.1)
        if m in ("drop",) and e.get("crash", True):
            mx.add(crash(), e["t"], gain=0.8, send=0.2)
        if m == "hit":
            mx.add(impact(), e["t"], gain=1.1, send=0.35)
            mx.add(crash(1.2, 2.5), e["t"], gain=0.9, send=0.4)
            mx.add(organ(CHORDS["cluster"] + [45], min(span, 1.0) + 0.05, 1.8, decay=1.6), e["t"], send=0.6)
            mx.add(drone(span), e["t"], gain=0.6, send=0.3)
        if m == "end":
            for k, note in enumerate([45, 57, 60, 64, 69, 72, 76]):
                mx.add(harpsichord(note, 1.4, 1.2), e["t"] + k * 0.018, pan=-0.3 + k * 0.1, send=0.4)
            mx.add(organ(ch + [ch[0] + 12], 0.9, 1.4, decay=2.5), e["t"], send=0.5)
            mx.add(kick(1.1), e["t"])
            mx.add(crash(1.0, 2.0), e["t"], send=0.4)
            mx.add(bass(ch[0] - 12, 0.6, 1.2), e["t"])

    # step sequencer on a 16th grid
    step = BEAT / 4
    for s in range(int(dur / step)):
        t = s * step
        e, nxt = at(t)
        m = e["mode"]
        ch = CHORDS[e["chord"]]
        beat, sub = divmod(s, 4)
        on_beat = sub == 0
        eighth = sub % 2 == 0
        tones = [n + 12 for n in ch] + [ch[0] + 24]
        last_beat = nxt["t"] - t <= BEAT + 1e-6
        if m == "intro":
            if eighth:
                mx.add(harpsichord(tones[[0, 2, 1, 2, 3, 2, 1, 2][(s // 2) % 8]]), t, pan=0.25, gain=0.9, send=0.35)
            if on_beat and beat % 2 == 0:
                mx.add(kick(0.6), t)
            if on_beat and beat % 2 == 1:
                mx.add(snap(), t, pan=-0.2, send=0.3)
        if m in ("groove", "build", "drop"):
            if on_beat and not (m == "build" and last_beat):
                mx.add(kick(), t)
            if on_beat and beat % 2 == 1:
                mx.add(clap(), t, send=0.25)
            if eighth:
                mx.add(hat(), t, pan=0.3, gain=0.8 if sub == 2 else 0.5)
                mx.add(bass(ch[0] - 12 + (12 if (s // 2) % 2 else 0)), t)
            if m == "drop":
                mx.add(harpsichord(tones[[0, 1, 2, 3, 2, 1, 3, 2][s % 8]], 0.4), t, pan=0.25, gain=0.8, send=0.25)
                if sub == 2:
                    mx.add(hat(True), t, pan=-0.3, gain=0.6)
                    mx.add(organ(ch), t, pan=-0.15, gain=1.0, send=0.2)
            elif eighth:
                mx.add(harpsichord(tones[[0, 2, 1, 2, 3, 2, 1, 2][(s // 2) % 8]]), t, pan=0.25, gain=0.85, send=0.3)
        if m == "dark" and eighth:
            mx.add(tick((s // 2) % 2 == 0), t, pan=0.5 if (s // 2) % 2 else -0.5, send=0.4)
        if m == "thin":
            if eighth:
                mx.add(bass(ch[0] - 12 + (12 if (s // 2) % 2 else 0), bright=420), t)
            mx.add(hat(), t, pan=0.3, gain=0.4)

    out = mx.dry + mx.reverb()
    # hard gate for silence sections (short fades so it does not click)
    for e, nxt in zip(ev[:-1], ev[1:]):
        if e["mode"] == "silence":
            a0, b0 = int(e["t"] * SR), int(nxt["t"] * SR)
            f = int(0.012 * SR)
            out[:, a0 - f:a0] *= np.linspace(1, 0, f)
            out[:, a0:b0] = 0
    out = out[:, : int(dur * SR)]
    fade = int(0.35 * SR)
    out[:, -fade:] *= np.linspace(1, 0, fade)
    out = np.tanh(out * 0.9)
    out /= max(1e-9, np.abs(out).max()) / 0.9
    pcm = (out.T * 32767).astype("<i2")
    with wave.open(a.out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()
