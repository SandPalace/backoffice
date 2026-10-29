"""Export, loudness-normalise and check a talking-head edit.

  python3 finish.py --edit edit.json [--skip-export]

1. tsrct export -> <work>/<name>-premaster.mp4 (the editable mix stays untouched)
2. two-pass ffmpeg loudnorm (I=-15 LUFS, TP=-1.5 dBTP, linear) -> <root>/<name>.mp4, video copied
3. measure loudness (tesseract_sound.py measure) -> <work>/loudness-final.json
4. seam check: the largest sample step around every jump cut and shot cut vs. the take's p99.9
   (a click shows as a spike) -> printed, and recorded in <work>/seams.json
5. overview contact sheet -> <root>/Previews/<name>-overview.png
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from voice import load_edit

TSRCT = os.path.expanduser("~/Library/Application Support/Tesseract/bin/tsrct")
SOUND = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".agents", "skills", "tesseract-motion", "scripts",
                                      "tesseract_sound.py"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--edit", required=True)
    ap.add_argument("--skip-export", action="store_true")
    a = ap.parse_args()
    e = load_edit(a.edit)
    root, work, name = e["_root"], e["_work"], e["name"]
    project, pre, final = (os.path.join(root, f"{name}.tsrct"), os.path.join(work, f"{name}-premaster.mp4"),
                           os.path.join(root, f"{name}.mp4"))
    if not a.skip_export:
        subprocess.run([TSRCT, "export", "--project", project, "--output", pre], check=True,
                       env={**os.environ, "TESSERACT_SKILL": "tesseract-video"})
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", pre, "-af", "loudnorm=I=-15:TP=-1.5:LRA=11:print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True, check=False)
    m = json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])
    norm = (f"loudnorm=I=-15:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
            f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", pre, "-c:v", "copy", "-af", norm, "-ar", "48000", "-c:a", "aac",
                    "-b:a", "192k", "-movflags", "+faststart", final], check=True)
    report = os.path.join(work, "loudness-final.json")
    if os.path.exists(report):
        os.remove(report)
    out = subprocess.run([sys.executable, SOUND, "measure", final, "--report", report], capture_output=True, text=True,
                         check=True)
    meas = json.loads(out.stdout)
    print(f"{final}: {meas['integrated_lufs']} LUFS, {meas['true_peak_dbtp']} dBTP")

    with open(os.path.join(work, "edit-map.json")) as f:
        em = json.load(f)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", final, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    dx = np.abs(np.diff(x))
    ref = float(np.percentile(dx, 99.9))
    seams = []
    for sh in em["edit"]:
        for seg in sh["segments"]:
            i = int(seg["edit_s"] * 48000)
            step = float(dx[max(0, i - 240):i + 240].max())
            seams.append({"shot": sh["shot"], "t": seg["edit_s"], "max_step": round(step, 4),
                          "flag": step > ref * 1.5})
    with open(os.path.join(work, "seams.json"), "w") as f:
        json.dump({"p999": round(ref, 4), "seams": seams}, f, indent=1)
    bad = [s for s in seams if s["flag"]]
    print(f"seams: {len(seams)} checked, {len(bad)} flagged" + "".join(f"\n  CHECK sh-{s['shot']} @{s['t']}s" for s in bad))

    prev = os.path.join(root, "Previews")
    os.makedirs(prev, exist_ok=True)
    dur = em["duration_ms"] / 1000
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", final, "-vf", f"fps=16/{dur:.2f},scale=216:384,tile=8x2",
                    "-frames:v", "1", os.path.join(prev, f"{name}-overview.png")], check=True)
    print(f"overview: {os.path.join(prev, name + '-overview.png')}")


if __name__ == "__main__":
    main()
