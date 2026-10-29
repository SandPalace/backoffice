"""Procedural score for the myth-fluid template: pads, pipes, bells, a heartbeat and a splash.

  python3 score.py --out music.wav --duration 55 --events events.json

The page reports every musical event in __meta.music.events, so the score is cut to the
picture, not the other way round. Event kinds:
  section {chord: [midi], level, bright, pulse?: bpm, bend?: semitones, glide?: s}
  pluck {note, pan}   bell {note}   tick {note}   hit {level}   swell {dur}
  whoosh {dur, up?, level?}   riser {dur}   heart {until, from_bpm, to_bpm}
  fall {dur} (ducks the mix into the impact)   splash   fade {dur}
Everything is synthesised with numpy from a fixed seed: no samples, no licences.
"""
import argparse
import json
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(5)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env_adsr(n, a, r):
    e = np.ones(n)
    na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    if na:
        e[:na] = np.linspace(0, 1, na) ** 2
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr) ** 1.5
    return e


def onepole(x, coef):
    """Low-pass with a per-sample coefficient (0..1, higher = brighter)."""
    y = np.empty_like(x)
    s = 0.0
    c = np.broadcast_to(coef, x.shape)
    for i in range(len(x)):
        s += c[i] * (x[i] - s)
        y[i] = s
    return y


class Mix:
    def __init__(self, dur):
        self.n = int(dur * SR) + SR
        self.dry = np.zeros((2, self.n))
        self.wet = np.zeros((2, self.n))
        self.fx = np.zeros((2, self.n))     # not ducked, not faded by the fall

    def add(self, sig, at, pan=0.0, gain=1.0, send=0.3, bus="dry"):
        i = int(at * SR)
        if i >= self.n:
            return
        sig = sig[: self.n - i] * gain
        lr = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)])[:, None] * np.sqrt(2)
        target = self.fx if bus == "fx" else self.dry
        target[:, i:i + len(sig)] += lr * sig
        self.wet[:, i:i + len(sig)] += lr * sig * send


def pad(chord, dur, bright, bend=0.0, glide=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    harm = int(3 + bright * 9)
    bendf = 2 ** (bend / 12 * np.clip(t / max(glide, 1e-3), 0, 1))
    for m in chord:
        for det in (-0.07, 0.0, 0.065):
            f = hz(m) * 2 ** (det / 12) * bendf
            ph = 2 * np.pi * np.cumsum(f) / SR + rng.uniform(0, 6.28)
            for h in range(1, harm + 1):
                if hz(m) * h > 9000:
                    break
                out += np.sin(ph * h) / h ** 1.25 * (0.35 if h > 1 else 1.0)
    trem = 1 + 0.06 * np.sin(2 * np.pi * 0.23 * t)
    return out * trem / (len(chord) * 3)


def pluck(m, dur=1.8, bright=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = sum(np.sin(2 * np.pi * f * k * t) / k * np.exp(-t * (1.4 + k * 1.6 / bright)) for k in range(1, 9))
    s += rng.normal(0, 1, n) * np.exp(-t * 90) * 0.25
    return s * 0.5


def bell(m, dur=3.0):
    t = np.arange(int(dur * SR)) / SR
    f = hz(m)
    mod = 2.2 * np.exp(-t * 2.5) * np.sin(2 * np.pi * f * 2.76 * t)
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t / 1.1) * 0.5


def thump(f0=58, dur=0.35):
    t = np.arange(int(dur * SR)) / SR
    f = f0 * (1 + 0.6 * np.exp(-t * 30))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14)


def boom(dur=1.6):
    t = np.arange(int(dur * SR)) / SR
    f = 40 + 55 * np.exp(-t * 6)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.6)


def noise_sweep(dur, c0, c1, shape):
    n = int(dur * SR)
    x = rng.normal(0, 1, n)
    coef = np.geomspace(c0, c1, n)
    return onepole(x, coef) * shape(np.linspace(0, 1, n))


def reverb(x, secs=3.2):
    n = int(secs * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.normal(0, 1, n) * np.exp(-t * 6.9 / secs)
        ir = onepole(ir, 0.35)
        ir[: int(0.012 * SR)] = 0
        size = 1 << int(np.ceil(np.log2(x.shape[1] + n)))
        out[ch] = np.fft.irfft(np.fft.rfft(x[ch], size) * np.fft.rfft(ir, size), size)[: x.shape[1]]
    return out / np.max(np.abs(out) + 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=float, required=True)
    ap.add_argument("--events", required=True)
    a = ap.parse_args()
    events = json.load(open(a.events))
    M = Mix(a.duration)
    dur = a.duration

    sections = [e for e in events if e["kind"] == "section"]
    for k, e in enumerate(sections):
        end = sections[k + 1]["at"] if k + 1 < len(sections) else dur
        length = end - e["at"] + 1.6
        s = pad(e["chord"], length, e.get("bright", 0.5), e.get("bend", 0.0), e.get("glide", 1.0))
        s *= env_adsr(len(s), 1.2 if k else 2.5, 1.8)
        M.add(s, e["at"], gain=0.42 * e.get("level", 0.5), send=0.45)
        # a low drone under every section: the root two octaves down
        d = pad([e["chord"][0] - 12], length, 0.1) * env_adsr(int(length * SR), 1.5, 1.8)
        M.add(d, e["at"], gain=0.5 * e.get("level", 0.5), send=0.1)
        if e.get("pulse"):
            step = 60 / e["pulse"] / 2
            notes = [m + 12 for m in e["chord"][1:]] + [e["chord"][-1] + 12]
            for j, tt in enumerate(np.arange(e["at"] + 0.4, end, step)):
                M.add(pluck(notes[j % len(notes)], 0.6, 0.6), tt, pan=0.35 * np.sin(j), gain=0.07, send=0.5)

    for e in events:
        k, at = e["kind"], e["at"]
        if k == "pluck":
            M.add(pluck(e["note"]), at, pan=e.get("pan", 0), gain=0.32, send=0.5)
        elif k == "bell":
            M.add(bell(e["note"]), at, gain=0.22, send=0.6)
            M.add(bell(e["note"] + 12, 2.0), at + 0.01, gain=0.06, send=0.7)
        elif k == "tick":
            M.add(bell(e["note"], 1.6) * 0.7, at, pan=rng.uniform(-0.6, 0.6), gain=0.16, send=0.6)
        elif k == "hit":
            M.add(boom(), at, gain=0.55 * e.get("level", 1), send=0.25)
            M.add(noise_sweep(0.5, 0.25, 0.02, lambda u: np.exp(-u * 8)), at, gain=0.2, send=0.4)
        elif k == "swell":
            M.add(noise_sweep(e["dur"], 0.02, 0.12, lambda u: np.sin(np.pi * u) ** 2), at, gain=0.12, send=0.6)
        elif k == "whoosh":
            d = e["dur"]
            c0, c1 = (0.03, 0.4) if e.get("up") else (0.08, 0.2)
            M.add(noise_sweep(d, c0, c1, lambda u: np.sin(np.pi * u) ** 1.5), at, pan=rng.uniform(-0.4, 0.4),
                  gain=0.22 * e.get("level", 1), send=0.3)
        elif k == "riser":
            d = e["dur"]
            n = int(d * SR)
            t = np.arange(n) / SR
            f = 180 * (5.0 ** (t / d))
            tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / d) ** 2.2
            M.add(tone, at, gain=0.09, send=0.6)
            M.add(noise_sweep(d, 0.02, 0.5, lambda u: u ** 2.5), at, gain=0.16, send=0.4)
        elif k == "heart":
            tt = at
            while tt < e["until"]:
                u = (tt - at) / (e["until"] - at)
                bpm = e["from_bpm"] + (e["to_bpm"] - e["from_bpm"]) * u
                M.add(thump(), tt, gain=0.5, send=0.05)
                M.add(thump(50), tt + 0.16, gain=0.3, send=0.05)
                tt += 60 / bpm
        elif k == "fall":
            d = e["dur"]
            n = int(d * SR)
            t = np.arange(n) / SR
            f = 1100 * np.exp(-t / d * 2.4)
            whistle = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / d) ** 1.2
            M.add(whistle, at, gain=0.06, send=0.5)
            M.add(noise_sweep(d, 0.01, 0.35, lambda u: u ** 2), at, gain=0.3, send=0.2)
            # duck the whole mix for the held breath before the impact
            i0, i1 = int((at + d - 0.55) * SR), int((at + d) * SR)
            duck = np.ones(M.n)
            duck[i0:i1] = np.linspace(1, 0.08, i1 - i0)
            i2 = i1 + int(1.4 * SR)
            duck[i1:i2] = np.linspace(0.08, 1, i2 - i1)
            M.dry *= duck
            M.wet *= duck
        elif k == "splash":
            M.add(boom(2.4), at, gain=0.9, send=0.3, bus="fx")
            M.add(noise_sweep(2.2, 0.6, 0.015, lambda u: np.exp(-u * 4)), at, gain=0.55, send=0.5, bus="fx")
            for _ in range(46):
                tb = at + 0.15 + rng.exponential(0.5)
                n = int(0.05 * SR)
                t = np.arange(n) / SR
                f = rng.uniform(350, 900) * (1 + t * 30)
                b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 60)
                M.add(b, tb, pan=rng.uniform(-0.7, 0.7), gain=0.06, send=0.6, bus="fx")

    wet = reverb(M.wet)
    mix = M.dry + M.fx + wet * 0.32
    for e in events:
        if e["kind"] == "fade":
            i0 = int((e["at"]) * SR)
            i1 = min(M.n, i0 + int(e["dur"] * SR))
            mix[:, i0:i1] *= np.linspace(1, 0, i1 - i0) ** 2
            mix[:, i1:] = 0
    mix = mix[:, : int(dur * SR)]
    mix = np.tanh(mix / (np.max(np.abs(mix)) + 1e-9) * 1.2) * 0.89
    pcm = (mix.T * 32767).astype("<i2")
    with wave.open(a.out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"score → {a.out} ({dur:.1f}s, {len(events)} events)")


if __name__ == "__main__":
    main()
