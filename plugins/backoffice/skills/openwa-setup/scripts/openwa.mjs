#!/usr/bin/env node
// OpenWA helper for Back Office (zero dependencies, Node 22.19+). Same commands on macOS, Windows and Linux.
// It never prints an API key: keys go to files with owner-only permissions and log lines are redacted.
//
//   node openwa.mjs preflight                  what is missing, in Spanish, before installing anything
//   node openwa.mjs install                    git clone + npm install + build (Node mode, no Docker)
//   node openwa.mjs start | stop | status      run OpenWA in the background (log in <home>/openwa.log)
//   node openwa.mjs agent-key                  create the agents' operator key -> <home>/agent.key
//   node openwa.mjs link <name>                create/start session <name> and save the QR as <home>/qr.png
//   node openwa.mjs pair <name> <phone>        8-character pairing code instead of the QR
//   node openwa.mjs wait <name>                wait until the session is ready (prints status only)
//   node openwa.mjs mcp-install                copy the MCP wrapper to <home>/mcp and npm install it
//   node openwa.mjs log                        last log lines, redacted
//
// <home> = $BACKOFFICE_HOME/openwa (the project's data/openwa). OpenWA itself lives in <home>/OpenWA.
// Mode: Node (default) or Docker if OPENWA_MODE=docker (then OpenWA runs with docker compose; see SKILL.md).
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, openSync, cpSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, totalmem, platform } from 'node:os';
import net from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIN = platform() === 'win32';
// AGENTOS_HOME: rename compat (one release); ~/.agentos: the layout before 2026-10-16.
const BACKOFFICE_HOME = process.env.BACKOFFICE_HOME || process.env.AGENTOS_HOME || join(homedir(), '.agentos');
const HOME = join(BACKOFFICE_HOME, 'openwa');
const REPO = join(HOME, 'OpenWA');
const PORT = Number(process.env.OPENWA_PORT || 2785);
const BASE = `http://127.0.0.1:${PORT}/api`;
const DOCKER = process.env.OPENWA_MODE === 'docker';
const REPO_URL = 'https://github.com/rmyndharis/OpenWA.git';
const say = (s = '') => console.log(s);
const die = (s) => { console.error(s); process.exit(1); };

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: WIN, ...opts });
  if (r.status !== 0) die(`Falló: ${cmd} ${args.join(' ')} (código ${r.status}). Revisa el mensaje de arriba.`);
}
function has(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: WIN });
  return r.status === 0 ? (r.stdout || r.stderr || '').trim().split('\n')[0] : null;
}
function secretFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.trim() + '\n', { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* Windows: user profile ACLs apply */ }
}
function adminKey() {
  if (DOCKER) return execFileSync('docker', ['exec', 'openwa-api', 'cat', '/app/data/.api-key'], { encoding: 'utf8' }).trim();
  const f = join(REPO, 'data', '.api-key');
  if (!existsSync(f)) die('Todavía no existe la llave de OpenWA: arráncalo primero (start) y espera a que diga «listo».');
  return readFileSync(f, 'utf8').trim();
}
const redact = (s) => s.replace(/[A-Za-z0-9_\-]{24,}/g, '<oculto>');
async function api(method, path, body, key = adminKey(), timeoutMs = 40000) {
  const res = await fetch(BASE + path, { method, headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${redact(text.slice(0, 300))}`);
  try { return JSON.parse(text); } catch { return text; }
}
async function healthy() {
  try { return (await fetch(BASE + '/health', { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}
function portFree(port) {
  return new Promise((r) => { const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(port, '127.0.0.1'); });
}
function openFile(p) {
  if (process.env.OPENWA_NO_OPEN === '1') return; // tests: save the QR, do not pop it up
  const [cmd, args] = WIN ? ['cmd', ['/c', 'start', '', p]] : platform() === 'darwin' ? ['open', [p]] : ['xdg-open', [p]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}
async function session(name) {
  const list = await api('GET', '/sessions');
  return list.find((s) => s.name === name);
}

const cmds = {
  async preflight() {
    const ok = (b, s, fix) => { say(`${b ? 'OK   ' : 'FALTA'} ${s}${b ? '' : `\n      -> ${fix}`}`); return b; };
    const [maj, min] = process.versions.node.split('.').map(Number);
    let all = true;
    all &= ok(maj > 22 || (maj === 22 && min >= 19), `Node ${process.versions.node} (se necesita 22.19 o más)`, 'Instala Node 24 LTS desde nodejs.org y abre una terminal nueva.');
    all &= ok(!!has('git'), 'Git', WIN ? 'Instala Git for Windows (git-scm.com) y abre una terminal nueva.' : 'macOS: xcode-select --install');
    all &= ok(!!has('npm'), 'npm', 'Viene con Node: reinstala Node.');
    // OpenWA's install-time WhatsApp fixes use `patch`; without it they are skipped (media and groups break).
    if (!DOCKER) all &= ok(!!has('patch'), 'Programa patch (aplica los arreglos de WhatsApp)', WIN
      ? 'Viene con Git for Windows. En esta terminal corre: $env:Path += ";C:\\Program Files\\Git\\usr\\bin"  y vuelve a correr preflight.'
      : 'macOS: xcode-select --install · Linux: sudo apt install patch');
    const gb = totalmem() / 2 ** 30;
    ok(gb >= 6, `Memoria ${gb.toFixed(1)} GB (recomendado 8 GB; cada número usa ~0.5 GB)`, 'Cierra programas pesados (Chrome con muchas pestañas) antes de vincular.');
    if (!DOCKER) ok(await portFree(PORT) || (await healthy()), `Puerto ${PORT} libre`, `Otro programa usa el puerto ${PORT}. Usa OPENWA_PORT=2786 en todos los comandos.`);
    if (DOCKER) all &= ok(!!has('docker', ['info', '--format', '{{.ServerVersion}}']), 'Docker encendido', 'Abre Docker Desktop y espera a que diga «Engine running».');
    ok(!WIN || !REPO.includes(' '), 'Ruta sin espacios', 'Mueve la carpeta de Back Office a una ruta sin espacios (p. ej. C:\\AgentOS).');
    say(all ? '\nTodo listo para instalar.' : '\nResuelve lo que dice FALTA y vuelve a correr preflight.');
    process.exit(all ? 0 : 1);
  },
  async install() {
    if (DOCKER) die('En modo Docker sigue la sección Docker de SKILL.md (docker compose).');
    mkdirSync(HOME, { recursive: true });
    if (!existsSync(join(REPO, '.git'))) run('git', ['clone', '--depth', '1', REPO_URL, REPO]);
    else run('git', ['-C', REPO, 'pull', '--ff-only']);
    say('Instalando dependencias (1-3 min; descarga el navegador que usa WhatsApp)...');
    const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: REPO, encoding: 'utf8', shell: WIN });
    const out = (r.stdout || '') + (r.stderr || '');
    writeFileSync(join(HOME, 'install.log'), redact(out));
    const skipped = out.split('\n').filter((l) => /patch-wwebjs|patch-baileys/.test(l) && /skip|warn|not applied|no `patch`/i.test(l) && !/intentionally skipped/.test(l));
    if (r.status !== 0) die(`npm install falló (código ${r.status}). Últimas líneas:\n${redact(out.split('\n').slice(-15).join('\n'))}`);
    if (skipped.length) say(`AVISO: algunos parches de WhatsApp no se aplicaron (enviar fotos o crear grupos puede fallar):\n${skipped.join('\n')}`);
    say('Compilando...');
    run('npm', ['run', 'build'], { cwd: REPO });
    run('npm', ['run', 'dashboard:build'], { cwd: REPO });
    say('Instalado. Siguiente: start');
  },
  async start() {
    if (await healthy()) return say(`OpenWA ya está corriendo en http://localhost:${PORT}`);
    if (DOCKER) { run('docker', ['compose', 'up', '-d'], { cwd: REPO }); }
    else {
      if (!existsSync(join(REPO, 'dist', 'main.js'))) die('OpenWA no está instalado todavía: corre install.');
      // Output goes to a file: on first boot OpenWA prints its admin key in the log.
      const fd = openSync(join(HOME, 'openwa.log'), 'a', 0o600);
      const p = spawn(process.execPath, ['dist/main'], { cwd: REPO, env: { ...process.env, PORT: String(PORT) }, detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
      writeFileSync(join(HOME, 'openwa.pid'), String(p.pid));
      p.unref();
    }
    for (let i = 0; i < 90; i++) { if (await healthy()) return say(`Listo: OpenWA en http://localhost:${PORT} (panel en el navegador).`); await new Promise((r) => setTimeout(r, 1000)); }
    die('OpenWA no respondió en 90 s. Corre: node openwa.mjs log');
  },
  async stop() {
    if (DOCKER) return run('docker', ['compose', 'stop', 'openwa-api'], { cwd: REPO });
    const f = join(HOME, 'openwa.pid');
    if (!existsSync(f)) return say('No hay un OpenWA iniciado por Back Office.');
    const pid = Number(readFileSync(f, 'utf8'));
    try { WIN ? spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']) : process.kill(pid, 'SIGTERM'); } catch { /* already stopped */ }
    rmSync(f, { force: true });
    say('OpenWA detenido (puede tardar unos segundos en cerrar el navegador).');
  },
  async status() {
    if (!(await healthy())) return say(`OpenWA no responde en el puerto ${PORT}. Arráncalo con: start`);
    const key = existsSync(join(HOME, 'agent.key')) ? readFileSync(join(HOME, 'agent.key'), 'utf8').trim() : adminKey();
    const list = await api('GET', '/sessions', undefined, key);
    say(`OpenWA en http://localhost:${PORT}`);
    for (const s of list) say(`- ${s.name}: ${s.status}${s.phone ? ` (${s.phone})` : ''}`);
    if (!list.length) say('Sin números vinculados. Siguiente: link <nombre>');
  },
  async ['agent-key']() {
    const out = join(HOME, 'agent.key');
    if (existsSync(out)) return say(`Ya existe la llave de los agentes en ${out}. Para rehacerla, bórrala primero.`);
    const r = await api('POST', '/auth/api-keys', { name: 'backoffice-ventas', role: 'operator' });
    const k = r.key || r.apiKey || r.plainKey || r.token || r.data?.key;
    if (!k) die(`OpenWA respondió sin llave (campos: ${Object.keys(r).join(', ')}). Créala desde el panel: API Keys.`);
    secretFile(out, k);
    say(`Llave de los agentes guardada en ${out} (solo tu usuario puede leerla). No la copies a ningún lado.`);
  },
  async link(name) {
    if (!/^[A-Za-z0-9-]{2,40}$/.test(name || '')) die('Uso: link <nombre> (letras, números y guiones; p. ej. ventas)');
    let s = await session(name);
    if (!s) s = await api('POST', '/sessions', { name });
    if (s.status !== 'ready') await api('POST', `/sessions/${s.id}/start`, undefined, undefined, 90000).catch(() => {});
    for (let i = 0; i < 60; i++) {
      const x = await api('GET', `/sessions/${s.id}`);
      if (x.status === 'ready') return say(`El número «${name}» ya está vinculado y listo.`);
      if (x.status === 'qr_ready') {
        const q = await api('GET', `/sessions/${s.id}/qr`);
        const b64 = String(q.qrCode || q.qr || '').replace(/^data:image\/png;base64,/, '');
        if (b64) {
          const png = join(HOME, 'qr.png'); writeFileSync(png, Buffer.from(b64, 'base64')); openFile(png);
          return say(`Se abrió el código QR (${png}).\nEn el teléfono: WhatsApp > Dispositivos vinculados > Vincular un dispositivo > escanéalo.\nEl QR cambia cada ~20 s: si caduca, corre link ${name} otra vez. Después: wait ${name}`);
        }
      }
      if (x.status === 'failed') die(`La sesión falló. Corre link ${name} de nuevo; si se repite: log`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    die('El QR no apareció en 2 minutos. Corre log y revisa la sección «Problemas» de SKILL.md.');
  },
  async pair(name, phone) {
    if (!/^\d{10,15}$/.test(phone || '')) die('Uso: pair <nombre> <teléfono con lada de país, solo dígitos; México: 52 + 10 dígitos>');
    const s = await session(name);
    if (!s) die(`No existe «${name}». Corre primero: link ${name}`);
    const r = await api('POST', `/sessions/${s.id}/pairing-code`, { phoneNumber: phone }, undefined, 60000);
    say(`Código: ${r.code || r.pairingCode || JSON.stringify(r)}\nEn el teléfono: Dispositivos vinculados > Vincular un dispositivo > «Vincular con número de teléfono» y escribe el código.`);
  },
  async wait(name) {
    const s = await session(name);
    if (!s) die(`No existe «${name}».`);
    for (let i = 0; i < 45; i++) {
      const x = await api('GET', `/sessions/${s.id}`);
      if (x.status === 'ready') return say(`Listo: «${name}» vinculado${x.phone ? ` (${x.phone})` : ''}.`);
      await new Promise((r) => setTimeout(r, 4000));
    }
    say(`«${name}» sigue sin vincularse. Si el teléfono se queda en «conectando», usa: pair ${name} <teléfono>`);
  },
  async ['mcp-install']() {
    const src = resolve(HERE, '../../../mcp/openwa');
    const dst = join(HOME, 'mcp');
    cpSync(src, dst, { recursive: true, filter: (p) => !p.includes('node_modules') });
    run('npm', ['ci', '--no-audit', '--no-fund', '--omit=dev'], { cwd: dst });
    say(`MCP instalado en ${dst}. Regístralo en Claude con el comando del paso 6 de SKILL.md.`);
  },
  async log() {
    const f = join(HOME, 'openwa.log');
    if (!existsSync(f)) return say('No hay log todavía.');
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-40);
    say(redact(lines.join('\n')));
  },
};

const [cmd, ...rest] = process.argv.slice(2);
if (!cmds[cmd]) die(`Comandos: ${Object.keys(cmds).join(', ')}`);
await cmds[cmd](...rest).catch((e) => die(redact(String(e.message || e))));
