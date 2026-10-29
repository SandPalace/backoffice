"""Kinetic Offer — a 15 s vertical motion-graphics spot built natively in Tesseract.

Pure typography and vector shapes on a flat paper background: a hook headline, a word that
gets struck and replaced, a checklist of what the buyer gets, and an offer card with a button.
Every scene rises in on an ease-out and leaves upward; one accent colour, no bounce, no spin.
All copy, palette, fonts, timing and sound cues come from a props JSON, so a new brand is a
new props file, not new code.

Usage:
  python3 build.py --props /abs/props.json --root /abs/project-root [--no-audio]

Writes <root>/<name>.tsrct and <root>/.tesseract-work/{document,actions,imports}.json.
Render and review with tsrct preview / filmstrip / export (see README.md).
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "fonts"))
SKILL = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", ".agents", "skills", "tesseract-motion"))
TSRCT = os.path.expanduser("~/Library/Application Support/Tesseract/bin/tsrct")
ENV = {**os.environ, "TESSERACT_SKILL": "tesseract-motion"}
W, H = 1080, 1920
CX = W / 2

EASE = ("function cl(v){return Math.max(0,Math.min(1,v));}"
        "function eo(p){return 1-Math.pow(1-p,4);}"
        "function ei(p){return p*p*p;}")
RISE_S = 0.55   # entrance duration
EXIT_S = 0.30   # exit duration
RISE_PX = 64    # entrance travel
EXIT_PX = 80    # exit travel


def tsrct(*args):
    r = subprocess.run([TSRCT, *args], capture_output=True, text=True, env=ENV, check=False)
    if r.returncode:
        sys.exit(f"tsrct {' '.join(args[:2])} failed: {r.stderr or r.stdout}")
    return r.stdout


def hex_rgba(h, a=1.0):
    h = h.lstrip("#")
    return [round(int(h[i:i + 2], 16) / 255, 4) for i in (0, 2, 4)] + [a]


def ms(s):
    return round(s * 1000)


def tf(x=0.0, y=0.0, ax=0.0, ay=0.0, s=100, op=100):
    return {"anchorPoint": [ax, ay], "position": [x, y], "scale": [s, s], "rotation": 0, "opacity": op}


def window(start_ms, dur_ms):
    return {"type": "windowed", "inputRange": {"start": start_ms, "duration": dur_ms},
            "mapping": {"type": "linear", "input": {"start": start_ms, "duration": dur_ms},
                        "output": {"start": 0, "duration": dur_ms}},
            "inputOffsetMs": 0}


class Build:
    def __init__(self, props, root):
        self.p = props
        self.root = root
        self.work = os.path.join(root, ".tesseract-work")
        self.project = os.path.join(root, props["name"] + ".tsrct")
        self.pal = {k: hex_rgba(v) for k, v in props["palette"].items()}
        self.actions = []
        self.cues = []
        self.n = 100
        self._pil = {}

    def nid(self):
        self.n += 1
        return self.n

    # --- measurement -------------------------------------------------------------------
    def width(self, font_key, text, size, tracking=0):
        from PIL import ImageFont
        file = self.p["fonts"][font_key]
        if file not in self._pil:
            self._pil[file] = ImageFont.truetype(os.path.join(FONT_DIR, file), 1000)
        return self._pil[file].getlength(text) / 1000 * size + tracking / 1000 * size * (len(text) - 1)

    def wrap(self, font_key, text, size, max_w):
        lines, cur = [], ""
        for word in text.split():
            trial = f"{cur} {word}".strip()
            if cur and self.width(font_key, trial, size) > max_w:
                lines.append(cur)
                cur = word
            else:
                cur = trial
        return lines + [cur]

    # --- animation ---------------------------------------------------------------------
    def anim(self, lid, prop, code):
        self.actions.append({"type": "setFxPropertyAnimator", "compositionId": "main",
                             "property": {"layerId": lid, "propertyType": prop},
                             "animator": {"type": "jsScript", "layerTimeJsCode": code},
                             "dependencies": []})

    def rise(self, lid, y, a, x, dim=None):
        """Ease-out rise at scene-local `a`, upward exit at `x`; optional dim (at, to%)."""
        head = f"{EASE}var t=input.time.seconds;var p=eo(cl((t-({a:.3f}))/{RISE_S}));" \
               f"var q=ei(cl((t-({x:.3f}))/{EXIT_S}));"
        self.anim(lid, "positionY", head + f"return {y:.1f}+{RISE_PX}*(1-p)-{EXIT_PX}*q;")
        d = ""
        if dim:
            d = f"*(1-{1 - dim[1] / 100:.3f}*eo(cl((t-({dim[0]:.3f}))/0.3)))"
        self.anim(lid, "opacity", head + f"return 100*p*(1-q){d};")

    def grow_x(self, lid, a, dur, x=None):
        code = f"{EASE}var t=input.time.seconds;return 100*eo(cl((t-({a:.3f}))/{dur}));"
        self.anim(lid, "scaleX", code)
        if x is not None:
            self.anim(lid, "opacity", f"{EASE}var t=input.time.seconds;"
                                      f"return 100*(t<{a:.3f}?0:1)*(1-ei(cl((t-({x:.3f}))/{EXIT_S})));")

    # --- layers ------------------------------------------------------------------------
    def text(self, name, dur, text, font_key, size, color, x, y, just="center", tracking=0):
        lid = self.nid()
        fam, style = self.fonts[font_key]
        return lid, {"type": "Text", "id": lid, "name": name, "blendMode": "normal",
                     "activeRange": {"start": 0, "duration": dur}, "transform": tf(x, y),
                     "sourceText": {"text": text, "fontFamily": fam, "fontStyle": style,
                                    "fontSize": size, "fillColor": color, "justification": just,
                                    "tracking": tracking, "boxText": False}}

    def rect(self, name, dur, x, y, w, h, color, ax, ay, roundness=0):
        lid = self.nid()
        return lid, {"type": "Rect", "id": lid, "name": name, "blendMode": "normal",
                     "activeRange": {"start": 0, "duration": dur}, "transform": tf(x, y, ax, ay),
                     "rect": {"size": [w, h], "fillColor": color, "roundness": roundness}}

    def check(self, name, dur, x, y, color, size=44):
        lid = self.nid()
        s = size / 44
        pts = [(0, 22), (15, 37), (44, 6)]
        cmds = [{"type": "moveTo", "x": pts[0][0] * s, "y": pts[0][1] * s}] + \
               [{"type": "lineTo", "x": px * s, "y": py * s} for px, py in pts[1:]]
        return lid, {"type": "Shape", "id": lid, "name": name, "blendMode": "normal",
                     "activeRange": {"start": 0, "duration": dur}, "transform": tf(x, y),
                     "shape": {"path": {"commands": cmds}, "fills": [],
                               "strokes": [{"paint": {"type": "solid", "color": color}, "width": 7 * s,
                                            "cap": "round", "join": "round", "miterLimit": 4,
                                            "blendMode": "normal", "opacity": 100, "enabled": True}],
                               "trim": {"start": 0, "end": 100, "mode": "simultaneously"}}}

    # --- scenes ------------------------------------------------------------------------
    def scene(self, sc):
        s0, s1 = sc["start"], sc["end"]
        dur = ms(s1 - s0)
        x = sc["exit"] - s0
        kids = []
        named = {}
        for el in sc["elements"]:
            a = el["at"] - s0
            kind = el["kind"]
            color = self.pal[el.get("color", "ink")]
            if kind == "line":
                lid, layer = self.text(f"{sc['id']} · {el['text']}", dur, el["text"], el["font"],
                                       el["size"], color, CX, el["y"], tracking=el.get("tracking", 0))
                kids.append(layer)
                dim = (el["dim_at"] - s0, el["dim_to"]) if "dim_at" in el else None
                self.rise(lid, el["y"], a, x, dim)
                named[el.get("ref", lid)] = el
            elif kind == "strike":
                tgt = named[el["target"]]
                w = self.width(tgt["font"], tgt["text"], tgt["size"], tgt.get("tracking", 0)) + 36
                y = tgt["y"] - 0.34 * tgt["size"]
                lid, layer = self.rect(f"{sc['id']} · tachado", dur, CX - w / 2, y, w, el.get("h", 12),
                                       color, 0, el.get("h", 12) / 2, roundness=el.get("h", 12) / 2)
                kids.insert(0, layer)
                self.grow_x(lid, a, 0.28, x)
                self.anim(lid, "positionY", f"{EASE}var t=input.time.seconds;"
                                            f"return {y:.1f}-{EXIT_PX}*ei(cl((t-({x:.3f}))/{EXIT_S}));")
            elif kind == "rule":
                w = el.get("w", 880)
                lid, layer = self.rect(f"{sc['id']} · filete", dur, CX, el["y"], w, 2,
                                       self.pal[el.get("color", "rule")], w / 2, 1)
                kids.append(layer)
                self.grow_x(lid, a, 0.5, x)
                self.anim(lid, "positionY", f"{EASE}var t=input.time.seconds;"
                                            f"return {el['y']:.1f}-{EXIT_PX}*ei(cl((t-({x:.3f}))/{EXIT_S}));")
            elif kind == "check_row":
                left, size = el.get("x", 120), el["size"]
                text_x = left + 78
                lines = self.wrap(el["font"], el["text"], size, W - text_x - 110)
                lead = el.get("leading", 1.22) * size
                for i, ln in enumerate(lines):
                    ly = el["y"] + i * lead
                    lid, layer = self.text(f"{sc['id']} · {ln}", dur, ln, el["font"], size, color,
                                           text_x, ly, just="left")
                    kids.append(layer)
                    self.rise(lid, ly, a + 0.04 * i, x)
                cid, layer = self.check(f"{sc['id']} · check", dur, left, el["y"] - 0.78 * size,
                                        self.pal[el.get("check_color", "accent")])
                kids.append(layer)
                self.rise(cid, el["y"] - 0.78 * size, a, x)
                self.anim(cid, "trimEnd", f"{EASE}var t=input.time.seconds;"
                                          f"return 100*eo(cl((t-({a + 0.12:.3f}))/0.32));")
            elif kind == "button":
                bw, bh = el.get("w", 780), el.get("h", 128)
                tid, tlayer = self.text(f"{sc['id']} · botón texto", dur, el["text"], el["font"],
                                        el["size"], self.pal[el.get("text_color", "white")], CX,
                                        el["y"] + 0.36 * el["size"])
                rid, rlayer = self.rect(f"{sc['id']} · botón", dur, CX, el["y"], bw, bh, color,
                                        bw / 2, bh / 2, roundness=bh / 2)
                kids += [tlayer, rlayer]
                self.rise(tid, el["y"] + 0.36 * el["size"], a + 0.05, x)
                self.rise(rid, el["y"], a, x)
                code = f"{EASE}var t=input.time.seconds;return 94+6*eo(cl((t-({a:.3f}))/{RISE_S}));"
                self.anim(rid, "scaleX", code)
                self.anim(rid, "scaleY", code)
            else:
                sys.exit(f"unknown element kind {kind}")
            if el.get("sfx"):
                self.cues.append((el["sfx"], el["at"] + el.get("sfx_offset", 0)))
            # Overflow guard: point text must stay inside the safe width.
            if kind == "line":
                w = self.width(el["font"], el["text"], el["size"], el.get("tracking", 0))
                if w > self.p.get("max_text_w", 920):
                    sys.exit(f"'{el['text']}' is {w:.0f}px wide (max {self.p.get('max_text_w', 920)})")
        if sc.get("exit_sfx"):
            self.cues.append((sc["exit_sfx"], sc["exit"]))
        gid = self.nid()
        group = {"type": "Group", "id": gid, "name": f"Escena {sc['id']}", "blendMode": "normal",
                 "playback": window(ms(s0), dur), "transform": tf(CX, H / 2, CX, H / 2), "layers": kids}
        # A slow push keeps holds alive without moving anything the eye is reading.
        drift = sc.get("drift", 1.5) / max(0.1, s1 - s0)
        code = f"var t=input.time.seconds;return 100+t*{drift:.4f};"
        self.anim(gid, "scaleX", code)
        self.anim(gid, "scaleY", code)
        return group

    # --- audio -------------------------------------------------------------------------
    def make_audio(self):
        sfx_dir = os.path.join(self.work, "sfx")
        os.makedirs(sfx_dir, exist_ok=True)
        snd = os.path.join(SKILL, "scripts", "tesseract_sound.py")
        made = {}
        for key, spec in self.p["sfx"].items():
            out = os.path.join(sfx_dir, f"{key}.wav")
            if os.path.exists(out):
                os.remove(out)  # the helper refuses to overwrite; these are regenerated each build
            subprocess.run([sys.executable, snd, "make", "--preset", spec["preset"], "--output", out,
                            "--seed", str(spec.get("seed", 7)), "--peak-db", str(spec.get("peak_db", -6))]
                           + (["--duration-ms", str(spec["dur_ms"])] if "dur_ms" in spec else []),
                           check=True, capture_output=True)
            made[key] = out
        m = self.p["music"]
        music = os.path.join(sfx_dir, "music.wav")
        subprocess.run([sys.executable, os.path.join(HERE, "music.py"), "--out", music,
                        "--duration", str(self.p["duration"]), "--bpm", str(m["bpm"]),
                        "--lift", str(m["lift"]), "--drop", str(m["drop"][0]), str(m["drop"][1]),
                        "--seed", str(m.get("seed", 3))], check=True, capture_output=True)
        made["music"] = music
        return made

    def wav_ms(self, path):
        import wave
        with wave.open(path) as w:
            return int(w.getnframes() / w.getframerate() * 1000)

    def audio_layers(self, assets):
        out, total = [], ms(self.p["duration"])
        for key, at in self.cues:
            spec = self.p["sfx"][key]
            length = self.wav_ms(assets[key])
            start = max(0, ms(at) - spec.get("lead_ms", 0))
            d = min(length, total - start)
            out.append({"type": "Audio", "id": self.nid(), "name": f"SFX {key} @{at:.2f}s",
                        "playback": window(start, d), "sourceRange": {"start": 0, "duration": d},
                        "sourceIntrinsicDuration": length, "source": {"assetId": f"sfx-{key}"},
                        "volume": spec["gain"], "captionsEnabled": False})
        m = self.p["music"]
        length = self.wav_ms(assets["music"])
        d = min(total, length)
        lid = self.nid()
        out.append({"type": "Audio", "id": lid, "name": "Música · cama original", "playback": window(0, d),
                    "sourceRange": {"start": 0, "duration": d}, "sourceIntrinsicDuration": length,
                    "source": {"assetId": "sfx-music"}, "volume": m["gain"], "captionsEnabled": False})
        T = self.p["duration"]
        self.anim(lid, "volume", f"var t=input.time.seconds;var g={m['gain']};"
                                 f"if(t<0.15)return g*t/0.15;"
                                 f"if(t>{T - 0.9:.2f})return g*Math.max(0,({T:.2f}-t)/0.9);return g;")
        return out

    # --- build -------------------------------------------------------------------------
    def run(self, audio=True):
        os.makedirs(self.work, exist_ok=True)
        if os.path.exists(self.project):
            os.remove(self.project)  # this script owns the file; versions live under Versions/
        tsrct("project", "create", "--project", self.project)
        self.fonts = {}
        for key, file in self.p["fonts"].items():
            r = json.loads(tsrct("project", "import-font", "--project", self.project,
                                 "--file", os.path.join(FONT_DIR, file)))
            self.fonts[key] = (r["fontFamily"], r["fontStyle"])
        assets = {}
        if audio:
            assets = self.make_audio()
            for key, path in assets.items():
                tsrct("project", "import-asset", "--project", self.project, "--file", path,
                      "--asset-id", f"sfx-{key}", "--kind", "audio")

        layers = []
        badge = self.p.get("badge")
        if badge:
            dur = ms(self.p["duration"])
            lid, layer = self.text("Firma · " + badge["text"], dur, badge["text"], badge["font"],
                                   badge["size"], self.pal[badge.get("color", "accent")], CX, badge["y"],
                                   tracking=badge.get("tracking", 0))
            layers.append(layer)
            if badge.get("fade_in", True):
                self.anim(lid, "opacity", f"{EASE}var t=input.time.seconds;return 100*eo(cl(t/0.25));")
        groups = [self.scene(sc) for sc in self.p["scenes"]]
        layers += list(reversed(groups))
        audio_layers = self.audio_layers(assets) if audio else []

        doc = {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json",
               "formatVersion": 1, "dimensions": {"width": W, "height": H}, "duration": self.p["duration"],
               "backgroundColor": self.pal["paper"],
               "composition": {"id": "main", "name": self.p["title"], "layers": layers + audio_layers}}
        paths = {k: os.path.join(self.work, f"{k}.json") for k in ("document", "actions", "imports")}
        for key, data in (("document", doc), ("actions", self.actions),
                          ("imports", {"fonts": self.fonts, "cues": self.cues})):
            with open(paths[key], "w") as f:
                json.dump(data, f, indent=1, ensure_ascii=False)
        tsrct("project", "commit", "--project", self.project, "--file", paths["document"])
        tsrct("project", "apply", "--project", self.project, "--actions", paths["actions"])
        print(f"built {self.project}: {self.p['duration']}s, {len(self.p['scenes'])} scenes, "
              f"{len(self.actions)} animators, {len(audio_layers)} audio layers")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--props", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--no-audio", action="store_true")
    a = ap.parse_args()
    with open(a.props) as f:
        props = json.load(f)
    Build(props, os.path.abspath(a.root)).run(audio=not a.no_audio)


if __name__ == "__main__":
    main()
