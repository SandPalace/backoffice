"""Voice analysis for talking-head edits: silences to cut and loudness peaks for emphasis.

  python3 voice.py analyze --edit edit.json   -> <work>/analysis.json + analysis.md
  python3 voice.py propose --edit edit.json   -> <work>/emphasis.draft.json (to review, then save
                                                 as emphasis.json; never use the draft unread)

Rules (knowledge/craft/talking-head-editing.md):
  - pauses are found from the AUDIO (10 ms energy frames, speech gate edit.voice.speech_db),
    not from transcript timestamps: ASR word times are packed end-to-start and hide pauses;
  - heads/tails trim to the first/last speech, internal pauses >= min_pause shrink to
    keep_tail (after the word) + keep_lead (before the next) of air;
  - loudness peaks: 50 ms windows vs. the take's median speech level; each peak is mapped to
    the transcript word it falls in. A peak is only a candidate: `propose` drops function words
    and words repeated across shots, and the editor validates the rest against the meaning.
"""
import argparse
import json
import os
import re
import subprocess

import numpy as np

SR, HOP = 16000, 0.010
FUNCTION_WORDS = {"a", "al", "ante", "con", "de", "del", "desde", "el", "en", "entre", "es", "la", "las", "le", "les", "lo", "los", "mi", "mis", "o", "para", "por", "que", "se", "si", "sin", "su", "sus", "te", "tu", "tus", "un", "una", "uno", "unos", "unas", "y", "ya", "yo", "me", "nos", "no", "ni", "pero", "como", "más", "muy"}


def load_edit(path):
    with open(path) as f:
        e = json.load(f)
    base = os.path.dirname(os.path.abspath(path))
    root = os.path.normpath(os.path.join(base, e.get("root", ".")))
    e["_root"] = root
    e["_work"] = os.path.join(root, e["work"])
    e["_takes"] = {k: os.path.join(root, e["takes_dir"], v) for k, v in e["takes"].items()}
    with open(os.path.join(root, e["transcript"])) as f:
        e["_words"] = json.load(f)
    os.makedirs(e["_work"], exist_ok=True)
    return e


def voice_cfg(e):
    v = {"speech_db": -32.0, "min_pause": 0.30, "keep_tail": 0.09, "keep_lead": 0.06, "emph_db": 3.0}
    v.update(e.get("voice", {}))
    return v


def frames_db(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    hop = int(SR * HOP)
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms + 1e-9)


def silences(db, a, b, gate, min_len=0.20):
    seg = db[int(a / HOP):int(b / HOP)]
    s = 10 * np.log10(np.convolve(10 ** (seg / 10), np.ones(3) / 3, "same") + 1e-12)
    quiet, runs, i = s < gate, [], 0
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]:
                j += 1
            if (j - i) * HOP >= min_len:
                runs.append((a + i * HOP, a + j * HOP))
            i = j
        else:
            i += 1
    return runs


def word_at(words, t):
    return min(words, key=lambda w: 0 if w["s"] <= t < w["e"] else min(abs(t - w["s"]), abs(t - w["e"])))


def analyze(e):
    v = voice_cfg(e)
    out, t_edit, lines = [], 0.0, []
    for shot in e["shots"]:
        n, (a, b) = shot["n"], shot["src"]
        db = frames_db(e["_takes"][n])
        floor = float(np.percentile(db[int(a / HOP):int(b / HOP)], 10))
        words = [{"w": w, "s": s, "e": en} for w, s, en in e["_words"][n] if a - 0.05 <= s < b]
        runs = silences(db, a, b, v["speech_db"])
        new_a, new_b = a, b
        if runs and runs[0][0] <= a + 0.02:
            new_a = max(a, runs[0][1] - v["keep_lead"])
            runs = runs[1:]
        if runs and runs[-1][1] >= b - 0.02:
            new_b = min(b, runs[-1][0] + v["keep_tail"] + 0.03)
            runs = runs[:-1]
        cuts = []
        for r0, r1 in runs:
            if r1 - r0 < v["min_pause"]:
                continue
            c0, c1 = r0 + v["keep_tail"], r1 - v["keep_lead"]
            before = [w for w in words if w["e"] <= r0 + 0.15]
            after = [w for w in words if w["s"] >= r1 - 0.25]
            cuts.append({"pause": [round(r0, 2), round(r1, 2)], "len": round(r1 - r0, 2), "cut": [round(c0, 3), round(c1, 3)],
                         "removed": round(c1 - c0, 3), "after": before[-1]["w"] if before else "",
                         "before": after[0]["w"] if after else ""})
        win = 5
        lo, hi = int(new_a / HOP), int(new_b / HOP)
        env = 10 * np.log10(np.convolve(10 ** (db[lo:hi] / 10), np.ones(win) / win, "same") + 1e-12)
        speech = env[env > v["speech_db"]]
        med = float(np.median(speech)) if len(speech) else -20.0
        peaks = []
        for i in range(win, len(env) - win):
            if env[i] == env[i - win:i + win + 1].max() and env[i] >= med + v["emph_db"] and words:
                t = (lo + i) * HOP
                peaks.append({"t": round(t, 2), "db": round(float(env[i]), 1), "rel": round(float(env[i]) - med, 1),
                              "word": word_at(words, t)["w"]})
        kept = (new_b - new_a) - sum(c["removed"] for c in cuts)
        out.append({"shot": n, "src": [a, b], "trim": [round(new_a, 3), round(new_b, 3)], "floor_db": round(floor, 1),
                    "speech_median_db": round(med, 1), "words": words, "cuts": cuts, "peaks": peaks,
                    "edit_start": round(t_edit, 3), "before_s": round(b - a, 3), "after_s": round(kept, 3)})
        lines.append(f"\n### sh-{n} · edit {t_edit:.2f}s · {b - a:.2f}s → {kept:.2f}s · piso {floor:.1f} dB · voz mediana {med:.1f} dB")
        lines.append("> " + " ".join(w["w"] for w in words))
        lines.append(f"- recorte cabeza/cola: {a:.2f}–{b:.2f} → {new_a:.2f}–{new_b:.2f} (−{(new_a - a) + (b - new_b):.2f}s)")
        for c in cuts:
            lines.append(f"- pausa {c['len']:.2f}s entre «{c['after']}» y «{c['before']}» "
                         f"[{c['pause'][0]:.2f}–{c['pause'][1]:.2f}] → se quitan {c['removed']:.2f}s")
        lines.append("- picos: " + ", ".join(f"«{p['word']}» {p['rel']:+.1f} @{p['t']:.2f}" for p in peaks))
        t_edit += kept
    total = sum(s["src"][1] - s["src"][0] for s in e["shots"])
    lines.insert(0, f"# Análisis de voz — {e['name']}\n\nDuración {total:.2f}s → {t_edit:.2f}s (−{total - t_edit:.2f}s). "
                    f"Voz > {v['speech_db']} dB; pausa cortable ≥ {v['min_pause']}s; colchón "
                    f"{v['keep_tail'] * 1000:.0f}/{v['keep_lead'] * 1000:.0f} ms.")
    with open(os.path.join(e["_work"], "analysis.json"), "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    with open(os.path.join(e["_work"], "analysis.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


def norm(w):
    return re.sub(r"[^\wáéíóúñü]", "", w.lower())


def propose(e):
    """A first camera plan for the editor to validate: never applied unread."""
    with open(os.path.join(e["_work"], "analysis.json")) as f:
        an = json.load(f)
    counts = {}
    for s in an:
        for w in {norm(x["w"]) for x in s["words"]}:
            counts[w] = counts.get(w, 0) + 1
    shots = {}
    for s in an:
        best, rejected = {}, []
        for p in s["peaks"]:
            w = norm(p["word"])
            why = "palabra función" if w in FUNCTION_WORDS else ("se repite en ≥3 tomas" if counts.get(w, 0) >= 3 else None)
            if why:
                rejected.append({"word": p["word"], "db": p["rel"], "why": why})
            elif w not in best or p["rel"] > best[w]["rel"]:
                best[w] = p
        ranked = sorted(best.values(), key=lambda p: -p["rel"])
        dur = s["after_s"]
        supers = []
        for p in ranked:  # one per ~4 s of shot, at least 2.5 s apart
            if len(supers) >= max(1, round(dur / 4)):
                break
            if all(abs(p["t"] - q["t"]) >= 2.5 for q in supers):
                w = next(x for x in s["words"] if norm(x["w"]) == norm(p["word"]))
                supers.append({"at": w["s"], "word": p["word"].strip(",."), "db": p["rel"], "t": p["t"],
                               "why": "TODO: validar contra el sentido de la frase"})
        sections = [w["s"] for prev, w in zip(s["words"], s["words"][1:])
                    if prev["w"][-1:] in ",." or norm(w["w"]) in {"que", "y", "porque", "sin", "pero"}]
        dedup = {}
        for r in rejected:
            if r["word"] not in dedup or r["db"] > dedup[r["word"]]["db"]:
                dedup[r["word"]] = r
        shots[s["shot"]] = {"sections": sections, "super": [{k: v for k, v in x.items() if k != "t"} for x in supers],
                            "rejected": list(dedup.values())}
    draft = {"_doc": "DRAFT from voice.py propose. Review every super against the sentence, prune sections to "
                     "real clause starts, then save as emphasis.json.",
             "levels": {"base": 1.0, "tight": 1.10, "super": 1.28}, "tail_override": {}, "shots": shots}
    path = os.path.join(e["_work"], "emphasis.draft.json")
    with open(path, "w") as f:
        json.dump(draft, f, indent=1, ensure_ascii=False)
    print(f"wrote {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["analyze", "propose"])
    ap.add_argument("--edit", required=True)
    a = ap.parse_args()
    e = load_edit(a.edit)
    analyze(e) if a.cmd == "analyze" else propose(e)


if __name__ == "__main__":
    main()
