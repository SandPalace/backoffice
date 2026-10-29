// Render an HTML + GSAP composition to MP4, one deterministic frame at a time.
//
// The page must build ONE paused GSAP timeline and expose:
//   window.__ready    Promise resolved when fonts and layout are done
//   window.__seek(t)  set the timeline to t seconds (tl.totalTime(t))
//   window.__meta     {width, height, duration, cues: [{at, sfx}], music: {...}, sfx: {...}}
//   window.__check()  optional: list of layout problems (overflow, safe-area), [] when clean
// Nothing may run on wall-clock time (no CSS transitions, no Math.random, no Date.now).
//
// Usage:
//   node render.mjs --page <template>/index.html --props <spot>/props.json --out <spot>/<name>.mp4
//        [--fps 60] [--frames 0,1.5,3]  (stills only → <out-dir>/frames/) [--no-audio] [--gpu] [--jpeg] [--crf 14] [--audio-only]
// --gpu renders WebGL on the Metal GPU instead of SwiftShader (needed for the fluid templates).
// window.__fps is set before the page loads, so a simulation can step one fixed dt per frame.
// meta.music.script (a path relative to the page) replaces the stock bed: it is called as
//   python3 <script> --out <wav> --duration <s> --events <json>  with meta.music.events.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
// Browser: $CHROME_PATH, else Remotion's chrome-headless-shell if present, else Playwright's own
// (npx playwright install chromium-headless-shell).
const REMOTION_CHROME = path.join(REPO, "render/node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const CHROME = process.env.CHROME_PATH || (fs.existsSync(REMOTION_CHROME) ? REMOTION_CHROME : undefined);
// Procedural SFX presets come with the Tesseract skills (tesseract-motion/scripts/tesseract_sound.py).
const SOUND = [".agents/skills", ".claude/skills"].map((d) => path.join(REPO, d, "tesseract-motion/scripts/tesseract_sound.py"))
  .find((p) => fs.existsSync(p));
const MUSIC = path.join(REPO, "render/tesseract/templates/kinetic-offer/music.py");
const GSAP_FILES = ["gsap.min.js", "SplitText.min.js", "DrawSVGPlugin.min.js", "MorphSVGPlugin.min.js", "CustomEase.min.js"]
  .map((f) => path.join(HERE, "node_modules/gsap/dist", f));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const fps = Number(args.fps ?? 60);
const out = path.resolve(args.out);
const work = path.join(path.dirname(out), ".gsap-work");
fs.mkdirSync(work, { recursive: true });

const props = JSON.parse(fs.readFileSync(path.resolve(args.props), "utf8"));
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: args.gpu ? ["--use-angle=metal", "--enable-gpu"] : [] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
await page.addInitScript(`window.__props = ${JSON.stringify(props)}; window.__fps = ${fps};`);
for (const f of GSAP_FILES) await page.addInitScript({ path: f });
await page.goto(pathToFileURL(path.resolve(args.page)).href);
await page.evaluate(() => window.__ready);
const meta = await page.evaluate(() => window.__meta);

const problems = await page.evaluate(() => (window.__check ? window.__check() : []));
if (problems.length) console.warn("layout check:\n  " + problems.join("\n  "));

if (args.frames) {
  const dir = path.join(path.dirname(out), "frames");
  fs.mkdirSync(dir, { recursive: true });
  for (const t of String(args.frames).split(",").map(Number)) {
    await page.evaluate((s) => { window.__seek(s); }, t);
    await page.screenshot({ path: path.join(dir, `t${t.toFixed(2)}.png`) });
  }
  console.log(`stills → ${dir}`);
  await browser.close();
  process.exit();
}

// Video: PNG frames piped straight into ffmpeg. --audio-only reuses <out-dir>/.gsap-work/video.mp4.
const total = Math.round(meta.duration * fps);
const silent = path.join(work, "video.mp4");
if (!args["audio-only"]) {
// --jpeg captures JPEG q95 instead of PNG: much faster for noisy, grainy frames (fluid templates).
const jpeg = Boolean(args.jpeg);
const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", ...(jpeg ? ["-c:v", "mjpeg"] : []),
  "-framerate", String(fps), "-i", "-",
  "-c:v", "libx264", "-preset", "slow", "-crf", String(args.crf ?? 14), "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent],
{ stdio: ["pipe", "inherit", "inherit"] });
const shot = async () => {
  for (let k = 0; ; k++) {
    try { return await page.screenshot(jpeg ? { type: "jpeg", quality: 95, timeout: 90000 } : { type: "png", timeout: 90000 }); }
    catch (e) { if (k >= 2) throw e; console.warn(`\nscreenshot retry ${k + 1}: ${e.message.split("\n")[0]}`); }
  }
};
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  await page.evaluate((s) => { window.__seek(s); }, i / fps);
  const png = await shot();
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % fps === 0) process.stdout.write(`\rframe ${i}/${total}`);
}
ff.stdin.end();
await new Promise((r, j) => ff.on("close", (c) => (c ? j(new Error(`ffmpeg ${c}`)) : r())));
await browser.close();
console.log(`\rrendered ${total} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} else await browser.close();

if (args["no-audio"]) {
  fs.copyFileSync(silent, out);
  process.exit();
}

// Audio: original music bed + procedural accents placed at the page's cue times.
const sfxDir = path.join(work, "sfx");
fs.rmSync(sfxDir, { recursive: true, force: true });
fs.mkdirSync(sfxDir, { recursive: true });
if (Object.keys(meta.sfx ?? {}).length && !SOUND) throw new Error("SFX presets need the tesseract-motion skill (tesseract_sound.py)");
for (const [key, s] of Object.entries(meta.sfx ?? {})) {
  execFileSync("python3", [SOUND, "make", "--preset", s.preset, "--output", path.join(sfxDir, `${key}.wav`),
    "--seed", String(s.seed ?? 7), "--peak-db", String(s.peak_db ?? -6),
    ...(s.dur_ms ? ["--duration-ms", String(s.dur_ms)] : [])], { stdio: "ignore" });
}
const m = meta.music;
const musicWav = path.join(sfxDir, "music.wav");
if (m.script) {
  const events = path.join(work, "music-events.json");
  fs.writeFileSync(events, JSON.stringify(m.events ?? []));
  execFileSync("python3", [path.resolve(path.dirname(path.resolve(args.page)), m.script), "--out", musicWav,
    "--duration", String(meta.duration), "--events", events], { stdio: "inherit" });
} else {
  execFileSync("python3", [MUSIC, "--out", musicWav, "--duration", String(meta.duration), "--bpm", String(m.bpm),
    "--lift", String(m.lift), "--drop", String(m.drop[0]), String(m.drop[1]), "--seed", String(m.seed ?? 3)],
  { stdio: "ignore" });
}

const inputs = ["-i", musicWav];
const chains = [`[0:a]volume=${m.gain ?? 1}[m]`];
meta.cues.forEach((c, i) => {
  const s = meta.sfx[c.sfx];
  const delay = Math.max(0, Math.round(c.at * 1000) - (s.lead_ms ?? 0));
  inputs.push("-i", path.join(sfxDir, `${c.sfx}.wav`));
  chains.push(`[${i + 1}:a]volume=${s.gain},adelay=${delay}|${delay}[c${i}]`);
});
const labels = ["[m]", ...meta.cues.map((_, i) => `[c${i}]`)].join("");
const graph = `${chains.join(";")};${labels}amix=inputs=${meta.cues.length + 1}:normalize=0:duration=first[mix]`;
const premix = path.join(work, "mix.wav");
execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[mix]",
  "-t", String(meta.duration), premix]);

// Two-pass loudnorm to -15 LUFS / -1.5 dBTP on the mix, then mux.
const probe = spawnSync("ffmpeg", ["-hide_banner", "-i", premix, "-af",
  "loudnorm=I=-15:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
const ln = JSON.parse(probe.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
const norm = `loudnorm=I=-15:TP=-1.5:LRA=11:measured_I=${ln.input_i}:measured_TP=${ln.input_tp}:` +
  `measured_LRA=${ln.input_lra}:measured_thresh=${ln.input_thresh}:offset=${ln.target_offset}:linear=true`;
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", silent, "-i", premix, "-map", "0:v", "-map", "1:a",
  "-c:v", "copy", "-af", norm, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest",
  "-movflags", "+faststart", out]);
console.log(`wrote ${out}`);

