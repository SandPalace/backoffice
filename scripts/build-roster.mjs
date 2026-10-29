#!/usr/bin/env node
// Regenera plugins/backoffice/roster.json desde plugins/backoffice/teams/*/team.json, agents/*.md y skills/*/SKILL.md.
// Antes valida que cada agente y skill pertenezca a exactamente un equipo y que cada id listado exista (si no, sale con 1).
// Uso: node scripts/build-roster.mjs   (desde la carpeta del proyecto). `generated_at` sólo cambia si cambia el contenido.
import { readFileSync, writeFileSync } from "node:fs";
import {
  rosterContent,
  validateTeams,
  ROSTER_FILE,
} from "../plugins/backoffice/server/src/roster.mjs";

const errors = validateTeams();
if (errors.length) {
  console.error(
    `Teams are inconsistent (${errors.length}):\n- ${errors.join("\n- ")}`,
  );
  process.exit(1);
}
const content = rosterContent();
let prev = null;
try {
  prev = JSON.parse(readFileSync(ROSTER_FILE, "utf8"));
} catch {}
const same =
  prev && JSON.stringify({ plugins: prev.plugins }) === JSON.stringify(content);
if (same) console.log("roster.json already up to date");
else
  writeFileSync(
    ROSTER_FILE,
    JSON.stringify(
      { generated_at: new Date().toISOString(), ...content },
      null,
      2,
    ) + "\n",
  );
const ts = content.plugins;
console.log(
  `${ts.length} teams, ${ts.reduce((n, p) => n + p.agents.length, 0)} agents, ${ts.reduce((n, p) => n + p.skills.length, 0)} skills (1 plugin: backoffice)${same ? "" : " -> roster.json written"}`,
);
