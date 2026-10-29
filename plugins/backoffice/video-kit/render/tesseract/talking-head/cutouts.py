"""Person cutouts for "type behind the person": Apple Vision matte -> pre-keyed ProRes 4444.

  python3 cutouts.py --edit edit.json [--shots 01,04]

For each shot that has `behind` graphics: render a person matte of the take with Vision
(personmatte.swift; tsrct 0.3.1's personMatte effect has no model and renders white), then
alphamerge it with the take over the shot's source range [a, b] into <cutouts_dir>/sh<NN>.mov
(ProRes 4444, premultiplied). Track mattes in tsrct 0.3.1 are unreliable, so the build places this
pre-keyed clip ABOVE the graphics instead. See knowledge/tools/tesseract.md §5–6.
Existing cutouts are kept; delete one to regenerate it.
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from voice import load_edit

BIN = os.path.join(HERE, ".bin", "personmatte")


def matte_tool():
    if not os.path.exists(BIN):
        os.makedirs(os.path.dirname(BIN), exist_ok=True)
        subprocess.run(["swiftc", "-O", os.path.join(HERE, "personmatte.swift"), "-o", BIN], check=True)
    return BIN


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--edit", required=True)
    ap.add_argument("--shots")
    a = ap.parse_args()
    e = load_edit(a.edit)
    only = set(a.shots.split(",")) if a.shots else None
    out_dir = os.path.join(e["_root"], e["cutouts_dir"])
    mattes = os.path.join(e["_work"], "mattes")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(mattes, exist_ok=True)
    for s in e["shots"]:
        n, (s0, s1) = s["n"], s["src"]
        if (only and n not in only) or not s.get("behind"):
            continue
        out = os.path.join(out_dir, f"sh{n}.mov")
        if os.path.exists(out):
            print(f"sh-{n}: keep {out}")
            continue
        take, matte = e["_takes"][n], os.path.join(mattes, f"sh{n}.mp4")
        if not os.path.exists(matte):
            subprocess.run([matte_tool(), take, matte], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{s0:.3f}", "-t", f"{s1 - s0:.3f}", "-i", take,
                        "-ss", f"{s0:.3f}", "-t", f"{s1 - s0:.3f}", "-i", matte,
                        "-filter_complex", "[1:v]format=gray[m];[0:v][m]alphamerge,premultiply=inplace=1",
                        "-an", "-c:v", "prores_ks", "-profile:v", "4444", "-qscale:v", "12",
                        "-pix_fmt", "yuva444p10le", out], check=True)
        print(f"sh-{n}: wrote {out}")


if __name__ == "__main__":
    main()
