<#
.SYNOPSIS
  Instalador de Back Office para Windows (PowerShell 5.1 o 7). Se corre una vez despues de clonar el repo.
.DESCRIPTION
  Uso (recomendado, evita el bloqueo de scripts de Windows):
    powershell -ExecutionPolicy Bypass -File .\install.ps1
  Opciones: -ResetLogin  -NoClaude  -NoClaudeCli  -NoDesktop  -NoSettings
  Variables: BACKOFFICE_PORT (4780), BACKOFFICE_WEB_PORT (4781), BACKOFFICE_HOME (<repo>\data), BACKOFFICE_ROOT (<repo>\workspaces),
             BACKOFFICE_USER / BACKOFFICE_PASSWORD (modo no interactivo), BACKOFFICE_ALLOW_MCP=yes|no
#>
param(
  [switch]$ResetLogin,
  [switch]$NoClaude,
  [switch]$NoClaudeCli,
  [switch]$NoDesktop,
  [switch]$NoSettings
)
# Continue (no Stop): en PowerShell 5.1 los avisos por stderr de programas externos romperian el script con Stop.
$ErrorActionPreference = 'Continue'

$REPO = $PSScriptRoot
$MKT = 'backoffice'
$PLUGIN = 'backoffice'   # un solo plugin con todos los agentes y skills; los equipos se arman en la app
# Marca para web\package.json (postinstall): el instalador migra los plugins el mismo.
$env:BACKOFFICE_LAUNCHER = '3'
# AgentOS ahora se llama Back Office: por una version, cada variable AGENTOS_* vale como su BACKOFFICE_* si esta falta.
foreach ($v in @(Get-ChildItem Env: | Where-Object { $_.Name -like 'AGENTOS_*' })) {
  $n = 'BACKOFFICE_' + $v.Name.Substring(8)
  if (-not [Environment]::GetEnvironmentVariable($n)) { [Environment]::SetEnvironmentVariable($n, $v.Value) }
}
$PORT = if ($env:BACKOFFICE_PORT) { $env:BACKOFFICE_PORT } else { '4780' }
$WEB_PORT = if ($env:BACKOFFICE_WEB_PORT) { $env:BACKOFFICE_WEB_PORT } else { '4781' }
# Todo vive dentro de esta carpeta: datos en <repo>\data y workspaces en <repo>\workspaces.
# Si hay datos de una instalacion anterior y aun no existen los nuevos, el servidor sigue usando los viejos
# hasta que los migres; aqui hacemos lo mismo para no apuntar a una carpeta vacia.
# Si moviste esta carpeta, Claude todavia pasa las rutas viejas (BACKOFFICE_HOME/BACKOFFICE_ROOT de su configuracion): la
# carpeta data\ o workspaces\ de OTRA ubicacion de Back Office (otra copia, una que ya no existe o el residuo que dejo un
# hook) no vale aqui. Una ruta propia (otro nombre, o una carpeta con mas cosas) se respeta.
# Misma regla que foreignPath() en scripts\migrate-plugins.mjs y que bin\backoffice.ps1.
function Test-ForeignDir($p, $sub) {
  if (-not $p) { return $false }
  try { $full = [System.IO.Path]::GetFullPath($p).TrimEnd('\', '/') } catch { return $false }
  if ((Split-Path -Leaf $full) -ne $sub) { return $false }
  $x = Split-Path -Parent $full
  if ($x.TrimEnd('\', '/') -ieq $REPO.TrimEnd('\', '/')) { return $false }
  if (Test-Path (Join-Path $x '.claude-plugin\marketplace.json')) { return $true }
  if (-not (Test-Path $x)) { return $true }
  $other = @(Get-ChildItem -Force -LiteralPath $x -ErrorAction SilentlyContinue | Where-Object { @('data', 'workspaces', '.DS_Store') -notcontains $_.Name })
  return ($other.Count -eq 0)
}
if (Test-ForeignDir $env:BACKOFFICE_HOME 'data') {
  Write-Host "    !!  Ignoro BACKOFFICE_HOME=$($env:BACKOFFICE_HOME) (es de otra ubicacion de Back Office); uso esta carpeta." -ForegroundColor Yellow
  Remove-Item Env:\BACKOFFICE_HOME -ErrorAction SilentlyContinue
}
if (Test-ForeignDir $env:BACKOFFICE_ROOT 'workspaces') {
  Write-Host "    !!  Ignoro BACKOFFICE_ROOT=$($env:BACKOFFICE_ROOT) (es de otra ubicacion de Back Office); uso esta carpeta." -ForegroundColor Yellow
  Remove-Item Env:\BACKOFFICE_ROOT -ErrorAction SilentlyContinue
}
$LEGACY = $false
$legacyHome = Join-Path $env:USERPROFILE '.agentos'
$legacyRoot = Join-Path $env:USERPROFILE 'AgentOS'
if ($env:BACKOFFICE_HOME) { $BACKOFFICE_HOME = $env:BACKOFFICE_HOME }
elseif ((Test-Path $legacyHome) -and -not (Test-Path (Join-Path $REPO 'data'))) { $BACKOFFICE_HOME = $legacyHome; $LEGACY = $true }
else { $BACKOFFICE_HOME = Join-Path $REPO 'data' }
if ($env:BACKOFFICE_ROOT) { $ROOT_DIR = $env:BACKOFFICE_ROOT }
elseif ((Test-Path $legacyRoot) -and -not (Test-Path (Join-Path $REPO 'workspaces'))) { $ROOT_DIR = $legacyRoot; $LEGACY = $true }
else { $ROOT_DIR = Join-Path $REPO 'workspaces' }
$env:BACKOFFICE_HOME = $BACKOFFICE_HOME
$env:BACKOFFICE_ROOT = $ROOT_DIR

$DO_CLI = $true; $DO_DESKTOP = $true; $DO_SETTINGS = $true
if ($NoClaude) { $DO_CLI = $false; $DO_DESKTOP = $false; $DO_SETTINGS = $false }
if ($NoClaudeCli) { $DO_CLI = $false }
if ($NoDesktop) { $DO_DESKTOP = $false }
if ($NoSettings) { $DO_SETTINGS = $false }

function Step($m) { Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    !!  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host ''; Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Test-Interactive { return (-not [Console]::IsInputRedirected) -and [Environment]::UserInteractive }
function Write-Utf8NoBom($path, $text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}
# Corre un script de node guardado en un archivo temporal (evita problemas de comillas en PowerShell 5.1).
function Invoke-NodeScript($nodeExe, $code) {
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('backoffice-' + [guid]::NewGuid().ToString('N') + '.cjs')
  Write-Utf8NoBom $tmp $code
  try { & $nodeExe $tmp | Out-Host; return $LASTEXITCODE } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

if ((Test-Path $legacyHome) -or (Test-Path $legacyRoot)) {
  Warn 'Encontre datos de una instalacion anterior en %USERPROFILE%\.agentos / \AgentOS. Para pasarlos a esta carpeta corre: node scripts/migrate-to-project-folder.mjs (o pidele a Claude "migra Back Office a la carpeta del proyecto").'
}

if ($env:OS -ne 'Windows_NT') { Die 'Este instalador es para Windows. En macOS o Linux usa ./install.sh' }

# 1. Node, Git
Step '1/7 Revisando Node.js y Git'
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Die ('No encontre Node.js. Instalalo (version 24 LTS recomendada) desde https://nodejs.org o con: winget install OpenJS.NodeJS.LTS' + "`n" + '       Luego abre una terminal NUEVA y corre este instalador otra vez.')
}
$NODE_BIN = $nodeCmd.Source
$nodeV = (& node -v) 2>$null
$m = [regex]::Match([string]$nodeV, '^v(\d+)\.(\d+)')
$nodeOk = $false
if ($m.Success) {
  $maj = [int]$m.Groups[1].Value; $min = [int]$m.Groups[2].Value
  if ($maj -gt 22 -or ($maj -eq 22 -and $min -ge 13)) { $nodeOk = $true }
}
if ($nodeOk) {
  & node -e "require('node:sqlite')" *> $null
  if ($LASTEXITCODE -ne 0) { $nodeOk = $false }
}
if (-not $nodeOk) {
  Die ("Tu Node es $nodeV y es muy viejo (Back Office necesita 22.13 o mas nuevo; recomendamos 24 LTS). Actualiza desde https://nodejs.org o con: winget upgrade OpenJS.NodeJS.LTS" + "`n" + '       Luego abre una terminal NUEVA y vuelve a correr el instalador.')
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Die 'Node esta instalado pero falta npm. Reinstala Node desde https://nodejs.org' }
Ok "Node $nodeV ($NODE_BIN)"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Warn 'No encontre Git. Instalalo desde https://git-scm.com/download/win o con: winget install Git.Git'
  Warn 'Sin Git el comando ".\bin\backoffice.cmd update" no va a funcionar (lo demas si).'
} else { Ok 'Git encontrado' }

# 1b. Empresa y puertos
Step '1b Empresa y puertos'
# Un Back Office por empresa: cada empresa en su propia carpeta, con su plugin (backoffice-<empresa>) y sus dos puertos.
# Se guardan en data\.env; si ya estaban, se respetan (actualizar nunca te cambia de puerto).
$curCompany = ''
$envPath0 = Join-Path $BACKOFFICE_HOME '.env'
if (Test-Path $envPath0) {
  $l = Get-Content $envPath0 -ErrorAction SilentlyContinue | Where-Object { $_ -match '^BACKOFFICE_COMPANY=' } | Select-Object -Last 1
  if ($l) { $curCompany = ($l -replace '^BACKOFFICE_COMPANY=', '').Trim() }
}
$COMPANY = $env:BACKOFFICE_COMPANY
if (-not $curCompany -and -not $COMPANY -and (Test-Interactive)) {
  Write-Host '    De que empresa es este Back Office? Con el nombre, tus agentes se instalan como un plugin propio de la empresa'
  Write-Host '    (backoffice-<empresa>) y puedes tener varias empresas en esta computadora, cada una en su carpeta.'
  $COMPANY = (Read-Host '    Nombre de la empresa (Enter para omitir)').Trim()
}
$env:BACKOFFICE_HOME = $BACKOFFICE_HOME
$setupArgs = @('setup')
if ($COMPANY) { $setupArgs += @('--name', $COMPANY) }
$setupOut = & $NODE_BIN (Join-Path $REPO 'scripts\company.mjs') @setupArgs
if ($LASTEXITCODE -ne 0) { Die "No pude guardar la empresa y los puertos en $envPath0." }
$SLUG = ''
foreach ($line in $setupOut) {
  if ($line -match '^BACKOFFICE_PORT=(\d+)$') { $PORT = $Matches[1] }
  elseif ($line -match '^BACKOFFICE_WEB_PORT=(\d+)$') { $WEB_PORT = $Matches[1] }
  elseif ($line -match '^BACKOFFICE_COMPANY_SLUG=([a-z0-9-]*)$') { $SLUG = $Matches[1] }
}
$env:BACKOFFICE_PORT = $PORT; $env:BACKOFFICE_WEB_PORT = $WEB_PORT
if ($SLUG) {
  $MCP_KEY = "backoffice-$SLUG"; $RULE = "mcp__plugin_backoffice-$($SLUG)_backoffice"
  Ok "Empresa: plugin backoffice-$SLUG - puertos $PORT (servidor) y $WEB_PORT (oficina web)"
} else {
  $MCP_KEY = 'backoffice'; $RULE = 'mcp__plugin_backoffice_backoffice'
  Ok "Sin empresa (plugin backoffice) - puertos $PORT (servidor) y $WEB_PORT (oficina web)"
}

# 2. Claude CLI
Step '2/7 Revisando Claude Code'
$HAVE_CLAUDE = $false
if ($DO_CLI) {
  if (Get-Command claude -ErrorAction SilentlyContinue) { $HAVE_CLAUDE = $true; Ok 'claude encontrado' }
  else {
    Warn "No encontre el comando 'claude'. Instala Claude Code con alguna de estas opciones:"
    Write-Host '        winget install Anthropic.ClaudeCode'
    Write-Host '        irm https://claude.ai/install.ps1 | iex'
    Write-Host '        npm install -g @anthropic-ai/claude-code'
    Die 'Falta Claude Code. Instalalo, abre una terminal NUEVA y corre el instalador otra vez (o usa -NoClaudeCli).'
  }
} else { Ok 'Omitido (-NoClaude / -NoClaudeCli)' }

# 3. Web
Step '3/7 Instalando y compilando la oficina web (tarda unos minutos)'
Push-Location (Join-Path $REPO 'web')
try {
  if (Test-Path 'package-lock.json') { & npm ci --no-audit --no-fund } else { & npm install --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'Fallo npm. Revisa tu conexion a internet (y que el antivirus no bloquee npm) y corre el instalador otra vez.' }
  $env:NEXT_PUBLIC_BACKOFFICE_PORT = $PORT
  $env:NEXT_TELEMETRY_DISABLED = '1'
  & node (Join-Path 'node_modules' 'next\dist\bin\next') build
  if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'Fallo la compilacion de la web. Corre el instalador otra vez; si sigue, mandale la salida a tu instructor.' }
} finally { Pop-Location -ErrorAction SilentlyContinue }
Ok 'Web compilada'

# 4. Plugin
Step '4/7 Registrando el plugin de Back Office en Claude Code'
# Con empresa genera dist\company-plugin y registra/instala backoffice-<empresa>@backoffice-<empresa> en lugar del generico.
# Todo en un solo lugar (scripts\migrate-plugins.mjs, el mismo que usa update): registra el marketplace en esta carpeta
# (si apuntaba a otra, p. ej. porque moviste la carpeta, lo quita y lo vuelve a agregar), quita los 7 plugins viejos,
# instala o actualiza backoffice@backoffice, y corrige las rutas de Back Office que apunten a la ubicacion anterior en
# settings.json, Claude Desktop y la base (respaldo .backoffice-backup).
$migFlags = @()
if (-not $DO_SETTINGS) { $migFlags += '--no-settings' }
if (-not $DO_DESKTOP) { $migFlags += '--no-desktop' }
$migrate = Join-Path $REPO 'scripts\migrate-plugins.mjs'
if ($DO_CLI -and $HAVE_CLAUDE) {
  & $NODE_BIN $migrate @migFlags
  if ($LASTEXITCODE -ne 0) { Warn "No pude dejar listo $PLUGIN@$MKT (pruebalo a mano: claude plugin marketplace add `"$REPO`" y claude plugin install $PLUGIN@$MKT)" }
} elseif ($DO_SETTINGS -or $DO_DESKTOP) {
  & $NODE_BIN $migrate --no-claude @migFlags
} else { Ok 'Omitido' }

# 5. Claude Desktop
Step '5/7 Conectando Claude Desktop'
if ($DO_DESKTOP) {
  $cfgDirs = @()
  $cfgDirs += (Join-Path $env:APPDATA 'Claude')
  # Claude Desktop instalado desde Microsoft Store guarda su config en otra carpeta.
  if ($env:LOCALAPPDATA) {
    $pk = Join-Path $env:LOCALAPPDATA 'Packages'
    if (Test-Path $pk) {
      Get-ChildItem $pk -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue | ForEach-Object {
        $d = Join-Path $_.FullName 'LocalCache\Roaming\Claude'
        if (Test-Path $d) { $cfgDirs += $d }
      }
    }
  }
  $mergeJs = @'
const fs = require('fs');
const f = process.env.CFG;
let c = {};
if (fs.existsSync(f)) {
  const t = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim();
  if (t) { try { c = JSON.parse(t); } catch (e) { console.error('JSON invalido'); process.exit(3); } }
}
if (c === null || typeof c !== 'object' || Array.isArray(c)) process.exit(3);
c.mcpServers = c.mcpServers || {};
const e = { command: process.env.NODE_BIN, args: [process.env.MCP] };
e.env = process.env.LEGACY === '1' ? {} : { BACKOFFICE_HOME: process.env.BACKOFFICE_HOME, BACKOFFICE_ROOT: process.env.BACKOFFICE_ROOT };
const company = process.env.KEY !== 'backoffice';
if (company || process.env.PORT !== '4780') e.env.BACKOFFICE_PORT = process.env.PORT;
if (company) e.env.BACKOFFICE_WEB_PORT = process.env.WEB_PORT;
if (!Object.keys(e.env).length) delete e.env;
c.mcpServers[process.env.KEY] = e;
fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
'@
  $env:NODE_BIN = $NODE_BIN
  $env:MCP = Join-Path $REPO 'plugins\backoffice\server\src\mcp.mjs'
  $env:PORT = $PORT
  $env:WEB_PORT = $WEB_PORT
  $env:KEY = $MCP_KEY
  $env:LEGACY = if ($LEGACY) { '1' } else { '0' }
  foreach ($dir in $cfgDirs) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $cfg = Join-Path $dir 'claude_desktop_config.json'
    if (Test-Path $cfg) { Copy-Item $cfg "$cfg.backoffice-backup" -Force }
    $env:CFG = $cfg
    $rc = Invoke-NodeScript $NODE_BIN $mergeJs
    if ($rc -eq 0) { Ok "Claude Desktop configurado (MCP $MCP_KEY) en $cfg (respaldo: $cfg.backoffice-backup). Reinicia Claude Desktop." }
    else { Warn "No pude editar $cfg (JSON danado?). Tu archivo no se toco." }
  }
  Remove-Item Env:\CFG, Env:\NODE_BIN, Env:\MCP, Env:\PORT, Env:\WEB_PORT, Env:\KEY, Env:\LEGACY -ErrorAction SilentlyContinue
} else { Ok 'Omitido' }

# 5b. Permisos de Claude Code
Step '5b Permiso para las herramientas de Back Office en Claude Code'
# Cambia la configuracion de Claude de la persona: siempre se pregunta (o se decide con BACKOFFICE_ALLOW_MCP=yes|no).
$ALLOW = $env:BACKOFFICE_ALLOW_MCP
if ($DO_SETTINGS -and -not $ALLOW) {
  if (Test-Interactive) {
    Write-Host '    Tus agentes guardan tareas, leads y archivos con las herramientas de Back Office.'
    Write-Host '    Si no las permites, Claude te pedira aprobarlas cada vez (puedes elegir "Permitir siempre" ahi).'
    $ans = Read-Host '    Permitir que Claude use las herramientas de Back Office sin pedir aprobacion? [S/n]'
    if ($ans -match '^(n|no)$') { $ALLOW = 'no' } else { $ALLOW = 'yes' }
  } else {
    $ALLOW = 'no'
    Warn 'Sin terminal interactiva: no cambio tus permisos de Claude (usa $env:BACKOFFICE_ALLOW_MCP="yes" para hacerlo).'
  }
}
function Show-EnvJson {
  if ($SLUG) { return }   # con empresa el plugin trae su carpeta (company.json): no hace falta el env global de Claude
  Warn ('Para que los hooks y las herramientas de Claude encuentren tus datos, agrega esto a ' + (Join-Path $env:USERPROFILE '.claude\settings.json') + ':')
  $hj = $BACKOFFICE_HOME.Replace('\', '\\'); $rj = $ROOT_DIR.Replace('\', '\\')
  Write-Host ('        "env": {"BACKOFFICE_HOME": "' + $hj + '", "BACKOFFICE_ROOT": "' + $rj + '"}')
}
if ($DO_SETTINGS -and $ALLOW -ne 'yes') {
  Ok 'No cambie tus permisos. Cuando Claude pida aprobar una herramienta de Back Office, elige "Permitir siempre".'
  Show-EnvJson
  $DO_SETTINGS = $false
}
if ($DO_SETTINGS) {
  $setDir = Join-Path $env:USERPROFILE '.claude'
  $set = Join-Path $setDir 'settings.json'
  New-Item -ItemType Directory -Force -Path $setDir | Out-Null
  $allowJs = @'
const fs = require('fs');
const f = process.env.SET;
let c = {};
if (fs.existsSync(f)) {
  const t = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim();
  if (t) { try { c = JSON.parse(t); } catch (e) { process.exit(3); } }
}
if (c === null || typeof c !== 'object' || Array.isArray(c)) process.exit(3);
const rule = process.env.RULE;
const olds = ['mcp__plugin_agentos-core_agentos', 'mcp__plugin_agentos_agentos'];
c.permissions = c.permissions && typeof c.permissions === 'object' ? c.permissions : {};
if (!Array.isArray(c.permissions.allow)) c.permissions.allow = [];
const hadOld = c.permissions.allow.some((r) => olds.includes(r));
const env = c.env && typeof c.env === 'object' && !Array.isArray(c.env) ? c.env : {};
const legacy = process.env.LEGACY === '1' || process.env.COMPANY_MODE === '1'; // con empresa: el env global queda para el plugin generico
const hasRule = c.permissions.allow.includes(rule);
const hasEnv = legacy || (env.BACKOFFICE_HOME === process.env.BACKOFFICE_HOME && env.BACKOFFICE_ROOT === process.env.BACKOFFICE_ROOT);
if (hasRule && hasEnv && !hadOld) { console.log('    OK  La regla y las rutas ya estaban en ' + f); process.exit(0); }
if (fs.existsSync(f)) fs.copyFileSync(f, f + '.backoffice-backup');
c.permissions.allow = c.permissions.allow.filter((r) => !olds.includes(r));
if (!c.permissions.allow.includes(rule)) c.permissions.allow.push(rule);
if (!legacy) { env.BACKOFFICE_HOME = process.env.BACKOFFICE_HOME; env.BACKOFFICE_ROOT = process.env.BACKOFFICE_ROOT; c.env = env; }
fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
console.log('    OK  Agregue permissions.allow: ' + rule + ' y env BACKOFFICE_HOME/BACKOFFICE_ROOT en ' + f + ' (respaldo: ' + f + '.backoffice-backup)');
'@
  $env:SET = $set
  $env:RULE = $RULE
  $env:COMPANY_MODE = if ($SLUG) { '1' } else { '0' }
  $env:LEGACY = if ($LEGACY) { '1' } else { '0' }
  $rc = Invoke-NodeScript $NODE_BIN $allowJs
  Remove-Item Env:\SET, Env:\RULE, Env:\COMPANY_MODE, Env:\LEGACY -ErrorAction SilentlyContinue
  if ($rc -ne 0) { Warn "No pude editar $set (JSON danado?). No se toco. Sin este permiso Claude te pedira aprobar las herramientas de Back Office."; Show-EnvJson }
} elseif ($ALLOW -ne 'no') { Ok 'Omitido' }

# 6. Login
Step '6/7 Usuario y contrasena de la oficina web'
New-Item -ItemType Directory -Force -Path $BACKOFFICE_HOME | Out-Null
$ENVF = Join-Path $BACKOFFICE_HOME '.env'
$hasUser = (Test-Path $ENVF) -and (@(Get-Content $ENVF -ErrorAction SilentlyContinue | Where-Object { $_ -match '^(BACKOFFICE|AGENTOS)_USER=' }).Count -gt 0)
if ($hasUser -and -not $ResetLogin) {
  Ok "Ya hay usuario en $ENVF (usa -ResetLogin para cambiarlo)"
} else {
  $U = $env:BACKOFFICE_USER; $P = $env:BACKOFFICE_PASSWORD
  if (-not $U) {
    if (-not (Test-Interactive)) { Die 'No hay terminal interactiva. Define BACKOFFICE_USER y BACKOFFICE_PASSWORD.' }
    while (-not $U) { $U = (Read-Host '    Elige un usuario').Trim() }
    while ($true) {
      $s1 = Read-Host '    Elige una contrasena (min. 8 caracteres)' -AsSecureString
      $s2 = Read-Host '    Repitela' -AsSecureString
      $b1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1)
      $b2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2)
      try {
        $P = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b1)
        $P2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b2)
      } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b1)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b2)
      }
      if ($P.Length -ge 8 -and $P -ceq $P2) { break }
      Warn 'No coinciden o son menos de 8 caracteres. Intenta de nuevo.'
    }
  }
  if (-not $P) { Die 'Contrasena vacia.' }
  if (($U + $P) -match "[\r\n]") { Die 'Usuario y contrasena no pueden tener saltos de linea.' }
  # Solo cambia estas dos lineas: la empresa, los puertos y las llaves de WhatsApp que ya esten en el archivo se quedan.
  $env:BACKOFFICE_USER = $U; $env:BACKOFFICE_PASSWORD = $P
  & $NODE_BIN (Join-Path $REPO 'scripts\company.mjs') set-env BACKOFFICE_USER BACKOFFICE_PASSWORD
  $rcEnv = $LASTEXITCODE
  Remove-Item Env:\BACKOFFICE_PASSWORD -ErrorAction SilentlyContinue
  if ($rcEnv -ne 0) { Die "No pude escribir $ENVF." }
  # Solo tu usuario puede leer/escribir el archivo.
  & icacls $ENVF /inheritance:r /grant:r "$($env:USERNAME):(R,W)" *> $null
  if ($LASTEXITCODE -ne 0) { Warn 'No pude restringir los permisos del archivo (no es grave, es tu carpeta personal).' }
  Ok "Guardado en $ENVF"
}

# 7. Carpeta de trabajo
Step '7/7 Creando la carpeta de workspaces'
New-Item -ItemType Directory -Force -Path $ROOT_DIR | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $BACKOFFICE_HOME 'logs') | Out-Null
Ok $ROOT_DIR

Write-Host ''
Write-Host 'Listo. Siguiente paso, desde la carpeta de Back Office:'
Write-Host '    .\bin\backoffice.cmd start'
Write-Host '(el comando vive dentro de esta carpeta; no se instala nada en tu sistema)'
Write-Host "y entra con el usuario que acabas de crear (http://localhost:$WEB_PORT)."
Write-Host 'Si Windows pregunta por el Firewall para "node", elige "Permitir" (solo redes privadas).'
Write-Host ''
if ($SLUG) {
  Write-Host "Tu plugin de empresa es backoffice-$SLUG (agentes: backoffice-$($SLUG):ceo, backoffice-$($SLUG):cmo, ...)."
  Write-Host 'Para usarlo en Claude Desktop (Chat y Cowork):'
  Write-Host ('  1. Claude Desktop -> Personalizar -> Plugins -> Agregar marketplace -> elige la carpeta ' + (Join-Path $REPO 'dist\company-plugin') + " -> instala `"backoffice-$SLUG`".")
} else {
  Write-Host 'Para usar Back Office en Claude Desktop (Chat y Cowork):'
  Write-Host '  1. Claude Desktop -> Personalizar -> Plugins -> Agregar marketplace: SandPalace/backoffice -> instala "backoffice".'
}
Write-Host '  2. Abre una sesion NUEVA de Cowork y pregunta: "Que equipos y agentes tengo en Back Office?"'
$mcpbOut = & node (Join-Path $REPO 'scripts\build-mcpb.mjs') 2>$null
if ($LASTEXITCODE -eq 0 -and $mcpbOut) {
  Write-Host '  Si Cowork no ve las herramientas de Back Office, instala la extension (un clic):'
  Write-Host '     Claude Desktop -> Ajustes -> Extensiones -> Instalar extension... -> elige'
  Write-Host ("     " + (@($mcpbOut)[-1]))
}
