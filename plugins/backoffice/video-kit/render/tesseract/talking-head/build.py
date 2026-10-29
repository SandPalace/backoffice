"""Build a talking-head edit in Tesseract from an edit.json, a brand kit, and the voice analysis.

  python3 build.py --edit edit.json [--no-import]

Reads:
  edit.json                 takes, transcript, shots (source range, face position, path colour, graphics)
  kits/<kit>.json           palette, fonts, sizes, motion curve (e.g. kits/example.json)
  <work>/analysis.json      voice.py analyze: trims and pause cuts per shot
  <work>/emphasis.json      camera plan: sections + super zooms, validated against the transcript
Writes <root>/<name>.tsrct and <work>/{document,actions,edit-map,imports}.json.

What it makes (knowledge/craft/talking-head-editing.md):
  - each shot = segments of the take with silences removed, 12 ms audio fades on every seam;
  - camera on the footage + person cutout only: framing snaps base/tight on each section start and
    jump cut, a super zoom on validated emphasis words, slow drift, settle on each shot cut;
  - kit graphics: hero word on a path-colour band behind the person (or in front, `front`),
    chips with strike, labels, agent counter, captions per word chunk, a neobrutal CTA;
  - SFX at their cues (roles.json) and the music bed with fades.
tsrct 0.3.1 caveats handled here: point text inside a zoomed group wraps (hence camera-only zoom
and root-level front heroes); timeline animators read layer-local time.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.normpath(os.path.join(HERE, "..", "fonts"))
TSRCT = os.path.expanduser("~/Library/Application Support/Tesseract/bin/tsrct")
ENV = {**os.environ, "TESSERACT_SKILL": "tesseract-video"}
sys.path.insert(0, HERE)
from voice import load_edit


def hexc(h, a=1.0):
    h = h.lstrip("#")
    return [round(int(h[i:i + 2], 16) / 255, 4) for i in (0, 2, 4)] + [a]


def tsrct(*args):
    r = subprocess.run([TSRCT, *args], capture_output=True, text=True, env=ENV, check=False)
    if r.returncode:
        sys.exit(f"tsrct {' '.join(args[:2])} failed: {r.stderr or r.stdout}")
    return r.stdout


def ms(s):
    return round(s * 1000)


def tf(x=0, y=0, ax=0, ay=0, s=100, op=100):
    return {"anchorPoint": [ax, ay], "position": [x, y], "scale": [s, s], "rotation": 0, "opacity": op}


def window(start_ms, dur_ms, out_start_ms=0):
    return {"type": "windowed", "inputRange": {"start": start_ms, "duration": dur_ms},
            "mapping": {"type": "linear", "input": {"start": start_ms, "duration": dur_ms},
                        "output": {"start": out_start_ms, "duration": dur_ms}},
            "inputOffsetMs": 0}


def ease_js(curve):
    x1, y1, x2, y2 = curve
    return ("function cl(x){return Math.max(0,Math.min(1,x));}"
            "function bz(p){if(p<=0)return 0;if(p>=1)return 1;var u=p;for(var i=0;i<8;i++){"
            f"var x=3*{x1}*u*(1-u)*(1-u)+3*{x2}*u*u*(1-u)+u*u*u-p;"
            f"var dx=3*{x1}*(1-u)*(1-u)+6*({x2}-{x1})*u*(1-u)+3*(1-{x2})*u*u;if(Math.abs(dx)<1e-6)break;u-=x/dx;"
            "u=Math.max(0,Math.min(1,u));}"
            f"return 3*{y1}*u*(1-u)*(1-u)+3*{y2}*u*u*(1-u)+u*u*u;}}"
            "function cub(p){return 1-Math.pow(1-p,3);}")


def settle_camera(snaps, jumps, supers, ends, dur, m):
    """Give every camera state at least `m` seconds (knowledge/craft/talking-head-editing.md §2).

    snaps: framing changes (jump cuts + kept clause starts); jumps: the jump cuts (never moved);
    supers/ends: super-zoom word starts and ends. Returns (snaps, starts, ramps, ends) where a super
    starts at `starts[j]` with an ease-in of `ramps[j]` s (0 = it starts ON a cut, the cut is the punch).
    Rules: a super lasts >= m; a super that would start within m after a cut (shot start or jump)
    starts exactly on that cut; a clause snap within m of a super is dropped; a jump within m after a
    super's end extends the super to the jump; a super ending within m of the shot end holds to the end;
    two supers less than m apart merge."""
    cuts = [0.0] + list(jumps)
    starts, ramps, outs = [], [], []
    for e, x in zip(supers, ends):
        a, r = e - 0.08, 0.10
        before = [c for c in cuts if 0 <= e - c < m + 0.08]
        if before:
            a, r = max(before), 0.0
        x = max(x, a + m)
        after = [c for c in jumps if 0 <= c - x < m]
        if after:
            x = min(after)
        if dur - x < m:
            x = dur
        if starts and a - (outs[-1] + 0.15) < m:  # merge with the previous super
            outs[-1] = max(outs[-1], x)
            continue
        starts.append(a)
        ramps.append(r)
        outs.append(x)
    jump_set = {round(j, 3) for j in jumps}
    kept = [sn for sn in snaps if round(sn, 3) in jump_set
            or all(not (a - m <= sn <= x + 0.15 + m) for a, x in zip(starts, outs))]
    return kept, [round(a, 3) for a in starts], ramps, [round(x, 3) for x in outs]


def grade_effects(nid, g):
    return [{"id": nid(), "enabled": True, "effect": {"type": "primaryGrade", "semanticVersion": 1, **g}}]


class Builder:
    def __init__(self, e):
        self.e = e
        with open(os.path.join(HERE, "kits", f"{e['kit']}.json")) as f:
            self.kit = json.load(f)
        for section, values in e.get("kit_overrides", {}).items():  # per-edit tweaks, e.g. an older caption style
            self.kit[section] = {**self.kit.get(section, {}), **values} if isinstance(values, dict) else values
        k = self.kit
        self.pal = {name: hexc(v) for name, v in k["palette"].items()}
        self.on = {name: self.pal[v] for name, v in k["on"].items()}
        self.EASE = ease_js(k["curve"])
        self.project = os.path.join(e["_root"], e["name"] + ".tsrct")
        self.work = e["_work"]
        with open(os.path.join(self.work, "analysis.json")) as f:
            self.analysis = {x["shot"]: x for x in json.load(f)}
        with open(os.path.join(self.work, "emphasis.json")) as f:
            self.plan = json.load(f)
        self.actions, self.n, self._pil, self.fonts = [], 100, {}, {}
        self.grade = e.get("grade", {"exposure": 0.0, "contrast": 0.16, "highlights": -0.08, "shadows": 0.0,
                                     "whites": 0.0, "blacks": -0.04, "saturation": 0.10, "vibrance": 0.08,
                                     "temperature": 0.02, "tint": 0.0})

    # --- helpers -----------------------------------------------------------------------
    def nid(self):
        self.n += 1
        return self.n

    def width(self, key, text, size, tracking=0):
        from PIL import ImageFont
        if key not in self._pil:
            self._pil[key] = ImageFont.truetype(os.path.join(FONTS, self.kit["fonts"][key]), 1000)
        return self._pil[key].getlength(text) / 1000 * size + tracking / 1000 * size * max(0, len(text) - 1)

    def anim(self, lid, prop, code):
        self.actions.append({"type": "setFxPropertyAnimator", "compositionId": "main",
                             "property": {"layerId": lid, "propertyType": prop},
                             "animator": {"type": "jsScript", "layerTimeJsCode": code}, "dependencies": []})

    def slide_x(self, lid, x, t0=0.0, dist=90, dur=0.6):
        self.anim(lid, "positionX", f"{self.EASE}var t=input.time.seconds;return {x:.1f}-{dist}*(1-bz(cl((t-({t0:.3f}))/{dur})));")

    def wipe_in(self, lid, t0=0.0, dur=0.36):
        self.anim(lid, "scaleX", f"{self.EASE}var t=input.time.seconds;return 100*bz(cl((t-({t0:.3f}))/{dur}));")

    def show(self, lid, t0=0.0, t_out=None, dur=0.12):
        out = f"if(t>{t_out:.3f})return 100*(1-cl((t-{t_out:.3f})/0.12));" if t_out is not None else ""
        self.anim(lid, "opacity", f"{self.EASE}var t=input.time.seconds;{out}return 100*cl((t-({t0:.3f}))/{dur});")

    def text(self, lid, name, start, dur, s, key, size, color, x, y, just="center", tracking=0):
        fam, style = self.fonts[key]
        return {"type": "Text", "id": lid, "name": name, "blendMode": "normal",
                "activeRange": {"start": start, "duration": dur}, "transform": tf(x, y),
                "sourceText": {"text": s, "fontFamily": fam, "fontStyle": style, "fontSize": size, "fillColor": color,
                               "justification": just, "tracking": tracking, "boxText": False}}

    def rect(self, lid, name, start, dur, x, y, w, h, color, ax=0, ay=0, stroke=None):
        r = {"size": [w, h], "fillColor": color, "roundness": 0}
        if stroke:
            r.update(strokeEnabled=True, strokeColor=stroke[0], strokeWidth=stroke[1], strokeJoin="miter")
        return {"type": "Rect", "id": lid, "name": name, "blendMode": "normal",
                "activeRange": {"start": start, "duration": dur}, "transform": tf(x, y, ax, ay), "rect": r}

    def grid(self, v, step=None):
        step = step or self.kit["grid"]
        return round(v / step) * step

    def label(self, txt, at, until, y, fg, bg, size=40, x=None, tag=None):
        lk = self.kit["label"]
        w = self.width(lk["font"], txt, size, lk["tracking"]) + 48
        x0 = 90 if x is None else x
        rid, tid = self.nid(), self.nid()
        out = [self.text(tid, f"Etiqueta · {txt}", at, until - at, txt, lk["font"], size, fg, x0 + 24, y + size * 0.95,
                         just="left", tracking=lk["tracking"]),
               self.rect(rid, f"Etiqueta fondo · {txt}", at, until - at, x0, y, self.grid(w, 30), round(size * 1.5), bg)]
        self.wipe_in(rid, 0, 0.36)
        self.show(tid, 0.12, (until - at) / 1000 - 0.12)
        self.show(rid, 0, (until - at) / 1000 - 0.12, 0.01)
        if tag is not None:
            sid = self.nid()
            out.append(self.rect(sid, "Cuadro path", at, until - at, x0 - 30, y, 30, round(size * 1.5), tag))
            self.show(sid, 0.12, (until - at) / 1000 - 0.12, 0.01)
        return out

    # --- imports -----------------------------------------------------------------------
    def do_imports(self, fresh):
        e, path = self.e, os.path.join(self.work, "imports.json")
        if fresh:
            if os.path.exists(self.project):
                os.remove(self.project)  # the build owns this file; earlier versions have other names
            tsrct("project", "create", "--project", self.project)
            meta = {}
            for s in e["shots"]:
                n = s["n"]
                meta[n] = json.loads(tsrct("project", "import-video", "--project", self.project, "--file",
                                           e["_takes"][n], "--asset-id", f"sh{n}"))
                cut = self.cutout_path(n)
                if cut:
                    tsrct("project", "import-video", "--project", self.project, "--file", cut, "--asset-id", f"cut{n}")
            fonts = {}
            for key, f in self.kit["fonts"].items():
                r = json.loads(tsrct("project", "import-font", "--project", self.project, "--file", os.path.join(FONTS, f)))
                fonts[key] = (r["fontFamily"], r["fontStyle"])
            sfx = {}
            sdir = os.path.join(e["_root"], e["sfx"]["dir"])
            for fn in sorted(os.listdir(sdir)):
                if fn.endswith(".wav"):
                    tsrct("project", "import-asset", "--project", self.project, "--file", os.path.join(sdir, fn),
                          "--asset-id", "sfx-" + fn[:-4], "--kind", "audio")
                    sfx[fn[:-4]] = "sfx-" + fn[:-4]
            with open(path, "w") as f:
                json.dump({"meta": meta, "fonts": fonts, "sfx": sfx}, f)
        with open(path) as f:
            imp = json.load(f)
        self.fonts = {k: tuple(v) for k, v in imp["fonts"].items()}
        return imp

    def cutout_path(self, n):
        p = os.path.join(self.e["_root"], self.e["cutouts_dir"], f"sh{n}.mov")
        return p if os.path.exists(p) else None

    # --- the edit ----------------------------------------------------------------------
    def run(self, fresh=True):
        e, k, pal, on = self.e, self.kit, self.pal, self.on
        imp = self.do_imports(fresh)
        meta = imp["meta"]
        lv = self.plan["levels"]
        cam_cfg = {"merge_s": 0.25, "drift_per_s": 0.006, "settle": 0.06, "eye_dy": 150,
                   "min_hold": 0.0, "super_mode": "fixed", "min_state": 0.0}
        cam_cfg.update(e.get("camera", {}))
        keywords = {w.lower() for w in e.get("keywords", [])}
        norm = lambda w: w.lower().strip(",.¿?¡!«»")
        hk, ck = k["hero"], k["caption"]
        groups, captions, overlays, cues, edit_map = [], [], [], [], []
        t = 0
        for i, s in enumerate(e["shots"]):
            n, (a, b) = s["n"], s["src"]
            an, plan = self.analysis[n], self.plan["shots"][n]
            t0, t1 = an["trim"]
            t1 = self.plan.get("tail_override", {}).get(n, t1)
            segs, cur = [], t0
            for c in an["cuts"]:
                segs.append((cur, c["cut"][0]))
                cur = c["cut"][1]
            segs.append((cur, t1))
            seg_edit, acc = [], 0.0
            for s0, s1 in segs:
                seg_edit.append(acc)
                acc += s1 - s0
            dur = ms(acc)

            def f(src, segs=segs, seg_edit=seg_edit):
                """Source seconds -> shot-local edit seconds (inside a cut: snaps to the next seam)."""
                for (s0, s1), e0 in zip(segs, seg_edit):
                    if src < s1:
                        return e0 + max(0.0, src - s0)
                return seg_edit[-1] + segs[-1][1] - segs[-1][0]

            ems = lambda src, f=f: ms(f(src))
            gid = self.nid()
            path = pal[s["path"]]
            path_on = on[s["path"]]
            children, front = [], []
            for bt in s.get("behind", []):
                mult = bt.get("mult", 1)
                size = bt.get("size") or min(hk["max_size"], int(hk["max_width"] / self.width(hk["font"], bt["text"], 1, hk["tracking"])))
                cap = 0.70 * size * mult
                base = s["head"] + 0.55 * cap + bt.get("base_dy", 0)
                start = ems(bt["at"]) - 120
                end = ems(bt["until"]) if "until" in bt else dur
                t_out = (end - start) / 1000 - 0.12 if "until" in bt else None
                band = bt.get("band", True)
                color = path_on if band else path
                wid, word_w = self.nid(), self.width(hk["font"], bt["text"], size * mult, hk["tracking"])
                layer = self.text(wid, f"Héroe · {bt['text']}", start, end - start, bt["text"], hk["font"], size, color,
                                  90, base, just="left", tracking=hk["tracking"])
                if mult != 1:
                    layer["transform"].update(anchorPoint=[0, 0], scale=[100 * mult, 100 * mult])
                if not band:
                    layer["transform"]["position"] = [540 - word_w / 2, base]
                children.append(layer)
                self.slide_x(wid, layer["transform"]["position"][0], 0.12, 90, 0.6)
                self.show(wid, 0.12, t_out)
                if band:
                    bh = hk["band_h"]
                    top = self.grid(base - cap - (bh - cap) / 2)
                    if bt.get("front"):
                        layer["transform"]["position"][1] += bt["front"] - top
                        top = bt["front"]
                    elif top < hk["min_top"]:
                        shift = hk["min_top"] - top
                        top += shift
                        layer["transform"]["position"][1] += shift
                    bid, sq = self.nid(), self.nid()
                    children.append(self.rect(bid, f"Bloque · {bt['text']}", start, end - start, 0, top,
                                              max(990, min(1080, self.grid(90 + word_w + 90))), bh, path))
                    self.wipe_in(bid, 0, 0.36)
                    self.show(bid, 0, t_out, 0.01)
                    children.insert(len(children) - 2, self.rect(sq, "Cuadro tinta", start, end - start, 990 - 90, top - 90,
                                                                 90, 90, pal[hk["corner_square"]]))
                    self.wipe_in(sq, 0.24, 0.24)
                    self.show(sq, 0.24, t_out, 0.01)
                if bt.get("front"):
                    n_new = 3 if band else 1
                    front += children[-n_new:]
                    del children[-n_new:]
                if bt.get("sfx"):
                    cues.append((bt["sfx"], t + start + 120))
            # camera
            jumps = sorted({round(x, 3) for x in seg_edit[1:]})
            sections = sorted({round(f(x), 3) for x in plan["sections"]})
            if cam_cfg["min_hold"] > 0:
                # Jump cuts always change the framing (that is what hides them); a section start
                # only does when it is at least min_hold from the shot start and every other change.
                snaps = list(jumps)
                for x in sections:
                    if x >= cam_cfg["min_hold"] and all(abs(x - y) >= cam_cfg["min_hold"] for y in snaps) \
                            and dur / 1000 - x >= cam_cfg["min_hold"] * 0.5:
                        snaps.append(x)
                snaps.sort()
            else:
                snaps = []
                for x in sorted(set(jumps) | set(sections)):
                    if not snaps or x - snaps[-1] > cam_cfg["merge_s"]:
                        snaps.append(x)
            supers = [round(f(x["at"]), 3) for x in plan["super"]]
            if cam_cfg["super_mode"] == "word":
                # hold the super zoom exactly while the word is being said
                ends = []
                for x in plan["super"]:
                    w = min(e["_words"][n], key=lambda w, at=x["at"]: abs(w[1] - at))
                    ends.append(round(max(f(w[2]), f(x["at"]) + 0.2), 3))
                env = ("var u=bz(cl((T-(E[j]-0.08))/0.10))*(1-bz(cl((T-X[j])/0.15)));")
                if cam_cfg["min_state"] > 0:
                    snaps, starts, ramps, ends = settle_camera(snaps, jumps, supers, ends, dur / 1000,
                                                               cam_cfg["min_state"])
                    supers = starts
                    env = ("var u=(R[j]>0?bz(cl((T-E[j])/R[j])):(T>=E[j]?1:0))*(1-bz(cl((T-X[j])/0.15)));")
            else:
                ends = [x + 0.5 for x in supers]
                env = ("var u=bz(cl((T-(E[j]-0.06))/0.12))*(1-bz(cl((T-(E[j]+0.5))/0.3)));")
            fx, fy = s["cx"], s["head"] + cam_cfg["eye_dy"]
            dr = cam_cfg["drift_per_s"]
            cam = (f"var S=[{','.join(f'{x:.3f}' for x in snaps)}];var E=[{','.join(f'{x:.3f}' for x in supers)}];"
                   + (f"var X=[{','.join(f'{x:.3f}' for x in ends)}];" if cam_cfg["super_mode"] == "word" else "")
                   + (f"var R=[{','.join(f'{x:.3f}' for x in ramps)}];" if cam_cfg["min_state"] > 0 else "")
                   + "var k=0;for(var i=0;i<S.length;i++)if(T>=S[i])k++;"
                   f"var z=100*(k%2?{lv['tight']}:{lv['base']})*(1+T*{dr});"
                   + (f"z*=1+{cam_cfg['settle']}*(1-bz(cl(T/0.36)));" if i else "")
                   + f"for(var j=0;j<E.length;j++){{{env}"
                   f"z=z+(100*{lv['super']}*(1+T*{dr})-z)*u;}}return z;")
            foots, cuts_v = [], []
            gain = s.get("gain", 1.0)
            has_cut = bool(s.get("behind")) and self.cutout_path(n)
            for (s0, s1), e0 in zip(segs, seg_edit):
                st, d = ms(e0), ms(s1 - s0)
                code = f"{self.EASE}var t=input.time.seconds;var T=t+{e0:.3f};{cam}"
                vid = self.nid()
                foots.append({"type": "Video", "id": vid, "effects": grade_effects(self.nid, self.grade),
                              "name": f"{e.get('subject', 'Toma')} sh-{n} {s0:.2f}–{s1:.2f}",
                              "playback": window(st, d, ms(s0)), "sourceRange": {"start": ms(s0), "duration": d},
                              "sourceIntrinsicDuration": meta[n]["durationMs"], "volume": gain,
                              "transform": tf(fx, fy, fx, fy), "source": {"assetId": f"sh{n}", "fit": "cover"}})
                self.anim(vid, "scaleX", code)
                self.anim(vid, "scaleY", code)
                self.anim(vid, "volume", f"var t=input.time.seconds;return {gain}*Math.max(0,Math.min(1,t/0.012,({s1 - s0:.3f}-t)/0.012));")
                if has_cut:
                    cid = self.nid()
                    cuts_v.append({"type": "Video", "id": cid, "name": f"Recorte {e.get('subject', '')} sh-{n} {s0:.2f}–{s1:.2f}".replace("  ", " "),
                                   "playback": window(st, d, ms(s0 - a)), "sourceRange": {"start": ms(s0 - a), "duration": d},
                                   "sourceIntrinsicDuration": ms(b - a), "volume": None, "transform": tf(fx, fy, fx, fy),
                                   "source": {"assetId": f"cut{n}", "fit": "cover"},
                                   "effects": grade_effects(self.nid, self.grade)})
                    self.anim(cid, "scaleX", code)
                    self.anim(cid, "scaleY", code)
            children[:0] = cuts_v
            children += foots
            for layer in front:
                layer["activeRange"]["start"] += t
            overlays += front
            groups.append({"type": "Group", "id": gid, "name": f"Plano {i + 1:02d} · sh-{n}", "blendMode": "normal",
                           "playback": window(t, dur), "transform": tf(), "layers": children})
            if s.get("whoosh"):
                cues.append(("whoosh", t))
            for x in s.get("sfx", []):
                # extra cues: at "start"/"end" of the shot or a source second; a role's lead_ms
                # places its hit there (a swell with lead_ms = its length ends on the cut)
                cues.append((x["role"], t if x["at"] == "start" else t + dur if x["at"] == "end" else t + ems(x["at"])))
            lk = k["label"]
            if "agent" in s:
                overlays += self.label(s["agent"], t + 120, t + dur, lk["counter_y"], pal["ink"], pal[lk["counter_bg"]],
                                       40, x=120, tag=path)
            if "pill" in s:
                p = s["pill"]
                overlays += self.label(p["text"], t + ems(p["at"]), t + ems(p["until"]), p["y"], path_on, path, 44)
                if p.get("sfx", "pop"):
                    cues.append((p.get("sfx", "pop"), t + ems(p["at"])))
            chk = k["chip"]
            for c in s.get("chips", []):
                st, sk = t + ems(c["at"]), t + ems(c["strike"])
                w = self.width(lk["font"], c["text"], chk["size"], lk["tracking"]) + 48
                kid = self.nid()
                overlays.append(self.rect(kid, f"Tachado · {c['text']}", sk, t + dur - sk, 90 + 16, c["y"] + 33, w - 32, 12,
                                          pal[chk["strike"]], 0, 6))
                self.wipe_in(kid, 0, 0.24)
                overlays += self.label(c["text"], st, t + dur, c["y"], pal[chk["fg"]], pal[chk["bg"]], chk["size"])
                if c.get("pop", True):
                    cues.append(("pop", st))
                cues.append((c.get("sfx", "pop"), sk))
            if s.get("cta"):
                cta, ctk = s["cta"], k["cta"]
                st = t + ems(cta["at"])
                txt, size, h = cta["text"], ctk["size"], ctk["h"]
                w = self.grid(self.width(lk["font"], txt, size, 40) + 96, 30)
                x0, y0, sd = 540 - w / 2, ctk["y"], ctk["shadow"]
                sh, rid, tid = self.nid(), self.nid(), self.nid()
                overlays += [
                    self.text(tid, "CTA texto", st, t + dur - st, txt, lk["font"], size, pal[ctk["fg"]], 540,
                              y0 + h / 2 + size * 0.36, tracking=40),
                    self.rect(rid, "CTA", st, t + dur - st, x0, y0, w, h, pal[ctk["bg"]], stroke=(pal["ink"], ctk["border"])),
                    self.rect(sh, "CTA sombra dura", st, t + dur - st, x0 + sd, y0 + sd, w, h, pal["ink"]),
                ]
                sink = (dur - ems(cta["at"])) / 1000 - 1.2
                for lid, base_y in ((tid, y0 + h / 2 + size * 0.36), (rid, y0)):
                    self.anim(lid, "positionY", f"{self.EASE}var t=input.time.seconds;var y={base_y:.1f}+60*(1-bz(cl(t/0.36)));"
                                                f"var d=t-{sink:.3f};if(d>0&&d<0.6)y+={sd}*(d<0.24?bz(d/0.24):1-bz((d-0.24)/0.36));"
                                                f"return y;")
                    self.anim(lid, "positionX", f"{self.EASE}var t=input.time.seconds;var x={(540 if lid == tid else x0):.1f};"
                                                f"var d=t-{sink:.3f};if(d>0&&d<0.6)x+={sd}*(d<0.24?bz(d/0.24):1-bz((d-0.24)/0.36));"
                                                f"return x;")
                self.anim(sh, "positionY", f"{self.EASE}var t=input.time.seconds;return {y0 + sd:.1f}+60*(1-bz(cl(t/0.36)));")
                self.show(sh, 0.12, None, 0.01)
                cues.append(("ding", st))
            # captions
            words = [w for w in e["_words"][n] if a - 0.05 <= w[1] < b]
            chunks, cur = [], []
            for w in words:
                cur.append(w)
                if len(cur) == 3 or w[0][-1] in ",." or w[0].lower().strip(",.") in keywords:
                    chunks.append(cur)
                    cur = []
            if cur:
                chunks.append(cur)
            hot_words = keywords | {norm(x["word"]) for x in plan["super"]}
            for j, ch in enumerate(chunks):
                st = max(0, ems(ch[0][1]) - 40)
                if ck.get("style") == "stroke":
                    en = ems(chunks[j + 1][0][1]) - 40 if j + 1 < len(chunks) else min(dur, ems(ch[-1][2]) + 250)
                    captions += self.stroke_caption(ch, t + st, max(120, en - st), hot_words, s["path"])
                    continue
                en = ems(chunks[j + 1][0][1]) - 40 if j + 1 < len(chunks) else min(dur, ems(ch[-1][2]) + 250)
                txt = " ".join(w[0].strip(",.") for w in ch)
                txt = txt[0].upper() + txt[1:]
                hot = any(w[0].lower().strip(",.") in keywords for w in ch)
                bg_name = s["path"] if hot else ck["bg"]
                size = ck["size"]
                while self.width(ck["font"], txt, size, ck["tracking"]) > ck["max_w"]:
                    size -= 2
                w = self.width(ck["font"], txt, size, ck["tracking"]) + 60
                cid, rid = self.nid(), self.nid()
                d = max(120, en - st)
                captions += [self.text(cid, f"Subtítulo · {txt}", t + st, d, txt, ck["font"], size, on[bg_name], 540,
                                       ck["y"] + size * 0.36, tracking=ck["tracking"]),
                             self.rect(rid, f"Subtítulo fondo · {txt}", t + st, d, 540, ck["y"], w, round(size * 1.6),
                                       pal[bg_name], w / 2, round(size * 1.6) / 2)]
            edit_map.append({"shot": n, "file": e["takes"][n], "edit_start_ms": t, "duration_ms": dur,
                             "segments": [{"src": [round(s0, 3), round(s1, 3)], "edit_s": round(t / 1000 + e0, 3)}
                                          for (s0, s1), e0 in zip(segs, seg_edit)],
                             "snaps_s": [round(t / 1000 + x, 3) for x in snaps],
                             "super_s": [{"t": round(t / 1000 + f(x["at"]), 3), "word": x["word"]} for x in plan["super"]],
                             "zoom_s": [[round(t / 1000 + z0, 3), round(t / 1000 + z1, 3)]
                                        for z0, z1 in zip(supers, ends if cam_cfg["super_mode"] == "word" else
                                                          [x + 0.5 for x in supers])]})
            t += dur

        layers = captions + overlays + list(reversed(groups))
        audio = self.sound_layers(imp.get("sfx", {}), cues, t)
        doc = {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json",
               "formatVersion": 1, "dimensions": {"width": 1080, "height": 1920}, "duration": t / 1000,
               "composition": {"id": "main", "name": e.get("title", e["name"]), "layers": layers + audio}}
        for name, data in (("document", doc), ("actions", self.actions),
                           ("edit-map", {"edit": edit_map, "cues": cues, "duration_ms": t})):
            with open(os.path.join(self.work, f"{name}.json"), "w") as fh:
                json.dump(data, fh, indent=1, ensure_ascii=False)
        tsrct("project", "commit", "--project", self.project, "--file", os.path.join(self.work, "document.json"))
        tsrct("project", "apply", "--project", self.project, "--actions", os.path.join(self.work, "actions.json"))
        print(f"built {self.project}: {t / 1000:.2f}s, {len(layers)} layers, {len(self.actions)} animators, {len(audio)} audio")

    def stroke_caption(self, chunk, start, dur, hot_words, path):
        """One caption chunk as bare text with an outline (no box). Emphasis words are set in the
        hot font, larger, in the shot's path colour with the kit's contrast colour as outline;
        the rest in the body font, white with an ink outline. Words are laid out one layer each
        on a shared baseline, measured with the real fonts."""
        ck, pal, on = self.kit["caption"], self.pal, self.on
        toks = [(w[0].strip(",."), w[0].lower().strip(",.¿?¡!«»") in hot_words) for w in chunk]
        toks[0] = (toks[0][0][:1].upper() + toks[0][0][1:], toks[0][1])
        size = ck["size"]

        def layout(sz):
            out, x = [], 0.0
            for i, (tx, hot) in enumerate(toks):
                fs = round(sz * ck["hot_scale"]) if hot else sz
                font = ck["hot_font"] if hot else ck["font"]
                w = self.width(font, tx, fs, ck["tracking"])
                out.append((tx, hot, fs, font, x))
                x += w + (self.width(ck["font"], " ", sz) if i < len(toks) - 1 else 0)
            return out, x
        words, total = layout(size)
        while total > ck["max_w"] and size > 30:
            size -= 2
            words, total = layout(size)
        x0, base = 540 - total / 2, ck["y"] + size * 0.36
        hot_fill = pal[path] if ck.get("hot_color", "path") == "path" else pal[ck["hot_color"]]
        hot_line = on[path] if ck.get("hot_color", "path") == "path" else pal[ck["stroke"]]
        layers = []
        for tx, hot, fs, font, x in words:
            lay = self.text(self.nid(), f"Subtítulo · {tx}", start, dur, tx, font, fs,
                            hot_fill if hot else pal[ck["fill"]], x0 + x, base, just="left", tracking=ck["tracking"])
            lay["sourceText"].update(applyStroke=True, strokeColor=hot_line if hot else pal[ck["stroke"]],
                                     strokeWidth=ck["hot_stroke_w"] if hot else ck["stroke_w"], strokeOverFill=False)
            layers.append(lay)
        return layers

    def sound_layers(self, sfx, cues, total):
        with open(os.path.join(self.e["_root"], self.e["sfx"]["roles"])) as fh:
            roles = json.load(fh)
        out = []
        # sfx_variants {"pop": ["pop", "pop2"]}: successive cues of a role cycle through the
        # listed roles, so a repeated accent does not sound identical every time
        variants = self.e.get("sfx_variants", {})
        seen = {}
        for role, at in (sorted(cues, key=lambda c: c[1]) if variants else cues):
            if role in variants:
                k = seen.get(role, 0)
                seen[role] = k + 1
                role = variants[role][k % len(variants[role])]
            r = roles.get(role)
            if not r or r["key"] not in sfx:
                continue
            start = max(0, at - r.get("lead_ms", 0))
            d = min(r["dur_ms"], total - start)
            out.append({"type": "Audio", "id": self.nid(), "name": f"SFX {role} @{at / 1000:.2f}s",
                        "playback": window(start, d), "sourceRange": {"start": 0, "duration": d},
                        "sourceIntrinsicDuration": r["dur_ms"], "source": {"assetId": sfx[r["key"]]},
                        "volume": r["gain"], "captionsEnabled": False})
        m = roles["music"]
        d = min(total, m["dur_ms"])
        lid = self.nid()
        out.append({"type": "Audio", "id": lid, "name": "Música · cama", "playback": window(0, d),
                    "sourceRange": {"start": 0, "duration": d}, "sourceIntrinsicDuration": m["dur_ms"],
                    "source": {"assetId": sfx[m["key"]]}, "volume": m["gain"], "captionsEnabled": False})
        T = total / 1000
        self.anim(lid, "volume", f"var t=input.time.seconds;var g={m['gain']};"
                                 f"if(t<0.3)return g*t/0.3;if(t>{T - 1.2:.2f})return g*Math.max(0,({T:.2f}-t)/1.2);return g;")
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--edit", required=True)
    ap.add_argument("--no-import", action="store_true")
    a = ap.parse_args()
    Builder(load_edit(a.edit)).run(fresh=not a.no_import)


if __name__ == "__main__":
    main()
