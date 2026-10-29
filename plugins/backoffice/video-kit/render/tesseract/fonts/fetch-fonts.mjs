#!/usr/bin/env node
// Downloads the open fonts the video templates use (they are NOT stored in the repo). Zero dependencies, Node 18+.
// Run it inside the scratch copy of the kit before rendering:  node render/tesseract/fonts/fetch-fonts.mjs
// Files land next to this script (fonts/<dir>/<file>), where the templates expect them. A per-computer cache in
// $BACKOFFICE_HOME/fonts (the project's data/fonts) means the internet is needed only the first time.
// Source: Fontsource CDN (latin subset: Spanish and English), licences from the google/fonts repo.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(
  // AGENTOS_HOME: rename compat (one release); ~/.agentos: the layout before 2026-10-16.
  process.env.BACKOFFICE_HOME || process.env.AGENTOS_HOME || join(homedir(), ".agentos"),
  "fonts",
);
const { fonts } = JSON.parse(readFileSync(join(HERE, "fonts.json"), "utf8"));
const CDN = "https://cdn.jsdelivr.net/fontsource/fonts";

async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
async function place(rel, url, check) {
  const dst = join(HERE, rel),
    cached = join(CACHE, rel);
  if (existsSync(dst)) return "ok";
  mkdirSync(dirname(dst), { recursive: true });
  if (!existsSync(cached)) {
    const buf = await get(url);
    if (check && !check(buf)) throw new Error(`Not a font file: ${url}`);
    mkdirSync(dirname(cached), { recursive: true });
    writeFileSync(cached, buf);
  }
  copyFileSync(cached, dst);
  return "new";
}
// TrueType starts with 0x00010000 or "true"; reject HTML error pages saved as .ttf.
const isTtf = (b) =>
  b.length > 1000 &&
  (b.readUInt32BE(0) === 0x00010000 || b.subarray(0, 4).toString() === "true");

let added = 0,
  failed = 0;
for (const f of fonts) {
  for (const v of f.files) {
    try {
      if (
        (await place(
          `${f.dir}/${v.file}`,
          `${CDN}/${f.fontsource}@latest/latin-${v.weight}-${v.style}.ttf`,
          isTtf,
        )) === "new"
      )
        added++;
    } catch (e) {
      failed++;
      console.error(`No pude bajar ${f.dir}/${v.file}: ${e.message}`);
    }
  }
  try {
    await place(`${f.dir}/${f.license.file}`, f.license.url);
  } catch (e) {
    console.error(`Licencia de ${f.dir}: ${e.message}`);
  }
}
if (failed) {
  console.error(
    `Faltan ${failed} fuentes: revisa tu conexión y vuelve a correr el script.`,
  );
  process.exit(1);
}
console.log(
  added
    ? `Fuentes listas (${added} nuevas; copia en ${CACHE}).`
    : "Fuentes listas (ya estaban).",
);
