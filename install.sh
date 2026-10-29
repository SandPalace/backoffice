#!/usr/bin/env bash
# Instalador de Back Office (macOS / Linux). Se corre una vez después de clonar el repo.
# Opciones: --reset-login  --no-claude  --no-claude-cli  --no-desktop  --no-settings
# Variables: BACKOFFICE_PORT (4780), BACKOFFICE_WEB_PORT (4781), BACKOFFICE_HOME (<repo>/data), BACKOFFICE_ROOT (<repo>/workspaces),
#            BACKOFFICE_USER / BACKOFFICE_PASSWORD (modo no interactivo)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MKT="backoffice"
PLUGIN="backoffice"   # un solo plugin con todos los agentes y skills; los equipos se arman en la app
# Marca para web/package.json (postinstall): el instalador migra los plugins él mismo.
export BACKOFFICE_LAUNCHER=3
# AgentOS ahora se llama Back Office: por una versión, cada variable AGENTOS_* vale como su BACKOFFICE_* si esta falta.
for _v in $(compgen -e | grep '^AGENTOS_'); do
  _n="BACKOFFICE_${_v#AGENTOS_}"; [ -n "${!_n:-}" ] || export "$_n=${!_v}"
done
unset _v _n
PORT="${BACKOFFICE_PORT:-4780}"
# Si moviste esta carpeta, Claude todavía pasa las rutas viejas (BACKOFFICE_HOME/BACKOFFICE_ROOT de su configuración) a lo
# que corre: la carpeta data/ o workspaces/ de OTRA ubicación de Back Office (otra copia, una que ya no existe o el residuo
# que dejó un hook) no vale aquí. Una ruta propia (otro nombre, o una carpeta con más cosas) se respeta.
# Misma regla que foreignPath() en scripts/migrate-plugins.mjs y que bin/backoffice.
foreign_dir() { # <ruta> <data|workspaces>
  local x; [ "$(basename "$1")" = "$2" ] || return 1; x="$(dirname "$1")"
  [ -d "$x" ] && [ "$(cd "$x" && pwd -P)" = "$(cd "$REPO" && pwd -P)" ] && return 1
  [ -f "$x/.claude-plugin/marketplace.json" ] || [ ! -d "$x" ] || [ -z "$(ls -A "$x" 2>/dev/null | grep -vxE 'data|workspaces|\.DS_Store')" ]
}
if [ -n "${BACKOFFICE_HOME:-}" ] && foreign_dir "$BACKOFFICE_HOME" data; then
  printf '    !!  Ignoro BACKOFFICE_HOME=%s (es de otra ubicación de Back Office); uso esta carpeta.\n' "$BACKOFFICE_HOME"; unset BACKOFFICE_HOME
fi
if [ -n "${BACKOFFICE_ROOT:-}" ] && foreign_dir "$BACKOFFICE_ROOT" workspaces; then
  printf '    !!  Ignoro BACKOFFICE_ROOT=%s (es de otra ubicación de Back Office); uso esta carpeta.\n' "$BACKOFFICE_ROOT"; unset BACKOFFICE_ROOT
fi
# Todo vive dentro de esta carpeta: datos en <repo>/data y workspaces en <repo>/workspaces.
# Si hay datos de una instalación anterior (~/.agentos, ~/AgentOS) y aún no existen los nuevos, el servidor
# sigue usando los viejos hasta que los migres; aquí hacemos lo mismo para no apuntar a una carpeta vacía.
LEGACY=0
if [ -z "${BACKOFFICE_HOME:-}" ] && [ -d "$HOME/.agentos" ] && [ ! -d "$REPO/data" ]; then BACKOFFICE_HOME="$HOME/.agentos"; LEGACY=1; fi
if [ -z "${BACKOFFICE_ROOT:-}" ] && [ -d "$HOME/AgentOS" ] && [ ! -d "$REPO/workspaces" ]; then BACKOFFICE_ROOT="$HOME/AgentOS"; LEGACY=1; fi
export BACKOFFICE_HOME="${BACKOFFICE_HOME:-$REPO/data}"
export BACKOFFICE_ROOT="${BACKOFFICE_ROOT:-$REPO/workspaces}"
RESET_LOGIN=0; DO_CLI=1; DO_DESKTOP=1; DO_SETTINGS=1
for a in "$@"; do
  case "$a" in
    --reset-login) RESET_LOGIN=1 ;;
    --no-claude) DO_CLI=0; DO_DESKTOP=0; DO_SETTINGS=0 ;;
    --no-settings) DO_SETTINGS=0 ;;
    --no-claude-cli) DO_CLI=0 ;;
    --no-desktop) DO_DESKTOP=0 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $a"; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
ok()   { printf '    OK  %s\n' "$*"; }
warn() { printf '    !!  %s\n' "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

if [ -d "$HOME/.agentos" ] || [ -d "$HOME/AgentOS" ]; then
  warn "Encontré datos de una instalación anterior en ~/.agentos / ~/AgentOS. Para pasarlos a esta carpeta corre: node scripts/migrate-to-project-folder.mjs (o pídele a Claude «migra Back Office a la carpeta del proyecto»)."
fi

OS="$(uname -s)"
case "$OS" in Darwin|Linux) ;; *) die "Este instalador es para macOS o Linux. En Windows usa WSL (ver INSTALL.md).";; esac

# 1. Node
step "1/7 Revisando Node.js"
if ! command -v node >/dev/null 2>&1; then
  die "No encontré Node.js. Instálalo (versión 24 LTS recomendada) desde https://nodejs.org o con: brew install node   (en Mac con Homebrew). Luego abre una terminal nueva y corre ./install.sh otra vez."
fi
NODE_BIN="$(command -v node)"
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null \
   || ! node -e 'require("node:sqlite")' >/dev/null 2>&1; then
  die "Tu Node es $(node -v) y es muy viejo (Back Office necesita 22.13 o más nuevo; recomendamos 24 LTS). Actualiza desde https://nodejs.org o con: brew upgrade node. Luego abre una terminal nueva y vuelve a correr ./install.sh"
fi
command -v npm >/dev/null 2>&1 || die "Node está instalado pero falta npm. Reinstala Node desde https://nodejs.org"
ok "Node $(node -v)"

# 2. Claude CLI
step "2/7 Revisando Claude Code"
HAVE_CLAUDE=0
if [ "$DO_CLI" = 1 ]; then
  if command -v claude >/dev/null 2>&1; then HAVE_CLAUDE=1; ok "claude encontrado"
  else
    warn "No encontré el comando 'claude'. Instala Claude Code con:"
    echo "        curl -fsSL https://claude.ai/install.sh | bash"
    echo "        (o: npm install -g @anthropic-ai/claude-code). Luego corre ./install.sh otra vez."
    die "Falta Claude Code."
  fi
else ok "Omitido (--no-claude)"; fi

# 3. Web
step "3/7 Instalando y compilando la oficina web (tarda unos minutos)"
(
  cd "$REPO/web"
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
  NEXT_PUBLIC_BACKOFFICE_PORT="$PORT" NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build
) || die "Falló la instalación o compilación de la web. Revisa tu conexión a internet y corre ./install.sh otra vez."
ok "Web compilada"

# 4. Plugin
step "4/7 Registrando el plugin backoffice en Claude Code"
# Todo en un solo lugar (scripts/migrate-plugins.mjs, el mismo que usa ./bin/backoffice update): registra el marketplace
# '$MKT' en esta carpeta (si apuntaba a otra, p. ej. porque moviste la carpeta, lo quita y lo vuelve a agregar), quita
# los 7 plugins viejos, instala o actualiza $PLUGIN@$MKT, y si las rutas de Back Office en ~/.claude/settings.json, en
# Claude Desktop o en la base apuntan a la ubicación anterior de esta carpeta, las corrige (respaldo .backoffice-backup).
MIG_FLAGS=""
[ "$DO_SETTINGS" = 1 ] || MIG_FLAGS="$MIG_FLAGS --no-settings"
[ "$DO_DESKTOP" = 1 ] || MIG_FLAGS="$MIG_FLAGS --no-desktop"
if [ "$DO_CLI" = 1 ] && [ "$HAVE_CLAUDE" = 1 ]; then
  # shellcheck disable=SC2086
  node "$REPO/scripts/migrate-plugins.mjs" $MIG_FLAGS || warn "No pude dejar listo $PLUGIN@$MKT (pruébalo a mano: claude plugin marketplace add \"$REPO\" y claude plugin install $PLUGIN@$MKT)"
elif [ "$DO_SETTINGS" = 1 ] || [ "$DO_DESKTOP" = 1 ]; then
  # shellcheck disable=SC2086
  node "$REPO/scripts/migrate-plugins.mjs" --no-claude $MIG_FLAGS || true
else ok "Omitido"; fi

# 5. Claude Desktop
step "5/7 Conectando Claude Desktop"
if [ "$DO_DESKTOP" = 1 ] && [ "$OS" = Darwin ]; then
  CFG_DIR="$HOME/Library/Application Support/Claude"
  mkdir -p "$CFG_DIR"
  CFG="$CFG_DIR/claude_desktop_config.json"
  [ -f "$CFG" ] && cp "$CFG" "$CFG.backoffice-backup" 
  if CFG="$CFG" LEGACY="$LEGACY" NODE_BIN="$NODE_BIN" MCP="$REPO/plugins/backoffice/server/src/mcp.mjs" PORT="$PORT" node -e '
    const fs=require("fs");const f=process.env.CFG;let c={};
    if(fs.existsSync(f)){const t=fs.readFileSync(f,"utf8").trim();if(t){try{c=JSON.parse(t)}catch(e){console.error("JSON inválido");process.exit(3)}}}
    c.mcpServers=c.mcpServers||{};
    const e={command:process.env.NODE_BIN,args:[process.env.MCP]};
    e.env=process.env.LEGACY==="1"?{}:{BACKOFFICE_HOME:process.env.BACKOFFICE_HOME,BACKOFFICE_ROOT:process.env.BACKOFFICE_ROOT};
    if(process.env.PORT!=="4780")e.env.BACKOFFICE_PORT=process.env.PORT;
    if(!Object.keys(e.env).length)delete e.env;
    c.mcpServers.backoffice=e;
    fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n");'; then
    ok "Claude Desktop configurado (respaldo: $CFG.backoffice-backup). Reinicia Claude Desktop."
  else warn "No pude editar $CFG (¿JSON dañado?). Tu archivo no se tocó."; fi
elif [ "$DO_DESKTOP" = 1 ]; then ok "Omitido (solo macOS)"; else ok "Omitido"; fi

# 5b. Permisos de Claude Code
step "5b Permiso para las herramientas de Back Office en Claude Code"
# Cambia la configuración de Claude de la persona: siempre se pregunta (o se decide con BACKOFFICE_ALLOW_MCP=yes|no).
ALLOW="${BACKOFFICE_ALLOW_MCP:-}"
if [ "$DO_SETTINGS" = 1 ] && [ -z "$ALLOW" ]; then
  if [ -r /dev/tty ]; then
    echo "    Tus agentes guardan tareas, leads y archivos con las herramientas de Back Office."
    echo "    Si no las permites, Claude te pedirá aprobarlas cada vez (puedes elegir «Permitir siempre» ahí)."
    if read -r -p "    ¿Permitir que Claude use las herramientas de Back Office sin pedir aprobación? [S/n] " ANS </dev/tty 2>/dev/null; then
      case "$(printf '%s' "$ANS" | tr '[:upper:]' '[:lower:]')" in n|no) ALLOW=no ;; *) ALLOW=yes ;; esac
    else
      ALLOW=no; warn "No pude preguntarte: no cambio tus permisos de Claude (usa BACKOFFICE_ALLOW_MCP=yes para hacerlo)."
    fi
  else
    ALLOW=no; warn "Sin terminal interactiva: no cambio tus permisos de Claude (usa BACKOFFICE_ALLOW_MCP=yes para hacerlo)."
  fi
fi
print_env_json() {
  # Solo avisa si settings.json todavía no tiene estas rutas (el paso 4 ya las corrige cuando venían de otra carpeta).
  if node -e 'const f=require("path").join(process.env.HOME,".claude","settings.json");let e={};try{e=JSON.parse(require("fs").readFileSync(f,"utf8"))["env"]||{}}catch{};process.exit(e.BACKOFFICE_HOME===process.argv[1]&&e.BACKOFFICE_ROOT===process.argv[2]?0:1)' "$BACKOFFICE_HOME" "$BACKOFFICE_ROOT" 2>/dev/null; then return 0; fi
  warn "Para que los hooks y las herramientas de Claude encuentren tus datos, agrega esto a $HOME/.claude/settings.json:"
  printf '        "env": {"BACKOFFICE_HOME": "%s", "BACKOFFICE_ROOT": "%s"}\n' "$BACKOFFICE_HOME" "$BACKOFFICE_ROOT"
}
if [ "$DO_SETTINGS" = 1 ] && [ "$ALLOW" != yes ]; then
  ok "No cambié tus permisos. Cuando Claude pida aprobar una herramienta de Back Office, elige «Permitir siempre»."
  print_env_json
  DO_SETTINGS=0
fi
if [ "$DO_SETTINGS" = 1 ]; then
  SET_DIR="$HOME/.claude"; SET="$SET_DIR/settings.json"
  mkdir -p "$SET_DIR"
  if SET="$SET" LEGACY="$LEGACY" node -e '
    const fs=require("fs");const f=process.env.SET;let c={};
    if(fs.existsSync(f)){const t=fs.readFileSync(f,"utf8").trim();if(t){try{c=JSON.parse(t)}catch(e){process.exit(3)}}}
    if(c===null||typeof c!=="object"||Array.isArray(c))process.exit(3);
    const rule="mcp__plugin_backoffice_backoffice";const olds=["mcp__plugin_agentos-core_agentos","mcp__plugin_agentos_agentos"];
    c.permissions=c.permissions&&typeof c.permissions==="object"?c.permissions:{};
    if(!Array.isArray(c.permissions.allow))c.permissions.allow=[];
    const hadOld=c.permissions.allow.some((r)=>olds.includes(r));
    const env=c.env&&typeof c.env==="object"&&!Array.isArray(c.env)?c.env:{};
    const hasRule=c.permissions.allow.includes(rule);
    const legacy=process.env.LEGACY==="1";
    const hasEnv=legacy||(env.BACKOFFICE_HOME===process.env.BACKOFFICE_HOME&&env.BACKOFFICE_ROOT===process.env.BACKOFFICE_ROOT);
    if(hasRule&&hasEnv&&!hadOld){console.log("    OK  La regla y las rutas ya estaban en "+f);process.exit(0)}
    if(fs.existsSync(f))fs.copyFileSync(f,f+".backoffice-backup");
    c.permissions.allow=c.permissions.allow.filter((r)=>!olds.includes(r));
    if(!c.permissions.allow.includes(rule))c.permissions.allow.push(rule);
    if(!legacy){env.BACKOFFICE_HOME=process.env.BACKOFFICE_HOME;env.BACKOFFICE_ROOT=process.env.BACKOFFICE_ROOT;c.env=env}
    fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n");
    console.log("    OK  Agregué permissions.allow: "+rule+" y env BACKOFFICE_HOME/BACKOFFICE_ROOT en "+f+" (respaldo: "+f+".backoffice-backup)");'; then :
  else warn "No pude editar $SET (¿JSON dañado?). No se tocó. Sin este permiso Claude te pedirá aprobar las herramientas de Back Office."; print_env_json; fi
elif [ "$ALLOW" != no ]; then ok "Omitido"; fi

# 6. Login
step "6/7 Usuario y contraseña de la oficina web"
mkdir -p "$BACKOFFICE_HOME"
ENVF="$BACKOFFICE_HOME/.env"
if [ -f "$ENVF" ] && [ "$RESET_LOGIN" = 0 ]; then
  ok "Ya existe $ENVF (usa --reset-login para cambiarlo)"
else
  U="${BACKOFFICE_USER:-}"; P="${BACKOFFICE_PASSWORD:-}"
  if [ -z "$U" ]; then
    [ -r /dev/tty ] || die "No hay terminal interactiva. Define BACKOFFICE_USER y BACKOFFICE_PASSWORD."
    while [ -z "$U" ]; do read -r -p "    Elige un usuario: " U </dev/tty; done
    while true; do
      read -r -s -p "    Elige una contraseña (mín. 8 caracteres): " P </dev/tty; echo
      read -r -s -p "    Repítela: " P2 </dev/tty; echo
      [ "${#P}" -ge 8 ] && [ "$P" = "$P2" ] && break
      warn "No coinciden o son menos de 8 caracteres. Intenta de nuevo."
    done
  fi
  [ -n "$P" ] || die "Contraseña vacía."
  case "$U$P" in *$'\n'*) die "Usuario y contraseña no pueden tener saltos de línea.";; esac
  ( umask 077; printf 'BACKOFFICE_USER=%s\nBACKOFFICE_PASSWORD=%s\n' "$U" "$P" >"$ENVF" )
  chmod 600 "$ENVF"
  ok "Guardado en $ENVF"
fi

# 7. Carpeta de trabajo
step "7/7 Creando la carpeta de workspaces"
mkdir -p "$BACKOFFICE_ROOT" "$BACKOFFICE_HOME/logs"
ok "$BACKOFFICE_ROOT"

chmod +x "$REPO/bin/backoffice"

# Extensión de Claude Desktop (respaldo para Chat y Cowork si el plugin no se puede agregar desde Personalizar → Plugins).
MCPB="$REPO/dist/backoffice.mcpb"
node "$REPO/scripts/build-mcpb.mjs" >/dev/null 2>&1 || MCPB=""

cat <<MSG

Listo. Siguiente paso:
    cd "$REPO" && ./bin/backoffice start
(el comando vive dentro de esta carpeta; no se instala nada en tu sistema)
y entra con el usuario que acabas de crear (http://localhost:${BACKOFFICE_WEB_PORT:-4781}).

Para usar Back Office en Claude Desktop (Chat y Cowork):
  1. Claude Desktop → Personalizar → Plugins → Agregar marketplace: SandPalace/agentos → instala «backoffice».
  2. Abre una sesión NUEVA de Cowork y pregunta: «¿Qué equipos y agentes tengo en Back Office?»
MSG
[ -n "$MCPB" ] && cat <<MSG
  Si Cowork no ve las herramientas de Back Office, instala la extensión (un clic):
     Claude Desktop → Ajustes → Extensiones → Instalar extensión… → elige
     $MCPB
MSG
