# Instalar Back Office en tu computadora

Esta guía es para macOS (Linux es igual). Para Windows, ve a la sección **Windows** (instalador nativo, no necesitas WSL).

## Qué necesitas

- Una suscripción de Claude (Pro, Max o Team).
- **Claude Code** instalado (y, si quieres, Claude Desktop).
- **Node.js 24 LTS** (mínimo 22.13). Descárgalo de https://nodejs.org. Revisa con `node -v`.
- **Git**. En Mac, escribe `git --version` en la Terminal; si no está, macOS te ofrece instalarlo.
- Una cuenta de GitHub solo si quieres enviar reportes de fallas o ideas (el repositorio es público).

## Paso a paso

1. **Clona el repositorio dentro de la carpeta de tu proyecto**, en `.backoffice` (abre la app Terminal). Un Back Office por
   empresa: `Documentos/Acme/.backoffice` (Finder oculta las carpetas con punto: Cmd+Shift+. las muestra). Si tu proyecto
   es un repo de git, agrega `.backoffice/` a su `.gitignore`. No uses `Documentos/AgentOS`: ahí vive tu AgentOS viejo, del que traes los datos con `scripts/import-agentos.mjs` (README, «Empieza aquí»).
   ```
   cd ~/Documents/Acme && git clone https://github.com/SandPalace/backoffice.git .backoffice && cd .backoffice
   ```
   Todo lo que Back Office crea (datos, proyectos, logs, usuario y contraseña) se queda **dentro de esa carpeta**
   (`data/` para los datos y `workspaces/` para tus workspaces); no se instala nada en tu sistema (ni comandos globales, ni cambios al PATH). Esas dos carpetas nunca se suben a Git. Lo único fuera de la carpeta: la configuración de Claude, para que encuentre tus agentes.
   El repositorio es público: no necesitas cuenta ni iniciar sesión en GitHub.
2. **Instala** (tarda unos minutos, necesita internet):
   ```
   ./install.sh
   ```
   Primero te pregunta **el nombre de tu empresa** (Enter para omitirlo): con él tus agentes se instalan como un plugin
   propio, `backoffice-<empresa>` (por ejemplo `backoffice-acme`), y elige dos puertos libres para esta carpeta (4780/4781 si
   es tu primer Back Office; 4782/4783, … si ya tienes otro). Los guarda en `data/.env` y te los muestra.
   El instalador también te pregunta si Claude puede usar las herramientas de Back Office sin pedir aprobación; si aceptas,
   además le avisa a Claude dónde está tu carpeta de Back Office (en `~/.claude/settings.json`, con respaldo).
   Si ya tenías Back Office instalado antes (carpetas `~/.agentos` y `~/AgentOS`), no se mueve nada: con el servidor detenido corre
   `node scripts/migrate-to-project-folder.mjs` (muestra el plan) y luego con `--yes`, o pídele a Claude «migra Back Office a la carpeta del proyecto».
   Te pedirá elegir un **usuario y contraseña** para entrar a tu oficina. Al escribir la contraseña no verás nada: es normal.
3. **Arranca** (desde la carpeta de Back Office):
   ```
   ./bin/backoffice start
   ```
   Se abre el navegador en http://localhost:4781 (o en el puerto que te mostró el instalador).
4. **Entra** con el usuario y contraseña del paso 2.
5. **Cierra y abre Claude Desktop** (o tu terminal de Claude Code) para que cargue el plugin (`backoffice-<empresa>`, o
   `backoffice` si no pusiste empresa).
6. **Conecta Claude Desktop (Chat y Cowork)**: sigue la sección siguiente. Si un agente te dice que no tiene las herramientas
   de Back Office, no lo dejes «escribir directo en la carpeta»: conecta el plugin o la extensión y vuelve a preguntar.

## Configurar el plugin y el MCP en Claude Desktop

`<empresa>` es el nombre corto que te mostró el instalador (`./bin/backoffice status` lo repite: «Empresa: Acme (plugin
backoffice-acme)»). Tu plugin de empresa vive en `dist/company-plugin/` dentro de tu carpeta y se regenera solo en cada
`./bin/backoffice update`. Si instalaste sin empresa, cambia `backoffice-<empresa>` por `backoffice` en todo lo de abajo.

### A. Claude Code (terminal)

El instalador y `./bin/backoffice update` ya lo registran. Si quieres hacerlo a mano, desde la carpeta de Back Office:

```
node scripts/build-company-plugin.mjs                     # (re)genera dist/company-plugin
claude plugin marketplace add "$PWD/dist/company-plugin"
claude plugin install backoffice-<empresa>@backoffice-<empresa>
```

(o todo junto y también para actualizar: `node scripts/build-company-plugin.mjs --register`).

Para verificar, abre `claude` en tu carpeta:

1. `/plugin` → en **Installed** aparece `backoffice-<empresa>` activo.
2. `/mcp` → `plugin:backoffice-<empresa>:backoffice` dice **connected**.
3. `claude --agent backoffice-<empresa>:ceo` abre al CEO de esa empresa.

Si además ves el plugin genérico `backoffice` (cada agente dos veces: `backoffice:ceo` y `backoffice-<empresa>:ceo`), quítalo
con `claude plugin uninstall backoffice@backoffice`. El instalador y `update` te lo ofrecen.

### B. Claude Desktop: Chat y Cowork

Cowork no ve lo que se instaló con la terminal: se agrega desde Claude Desktop.

1. **Personalizar → Plugins → Agregar marketplace** → pega la ruta de tu carpeta `…/dist/company-plugin` (por ejemplo
   `/Users/ana/Documents/Acme/.backoffice/dist/company-plugin`).
2. Instala **backoffice-<empresa>** (su descripción empieza con «Back Office · <Empresa>»).
3. Cierra y abre Claude Desktop.

**Respaldo (si el plugin no se puede agregar o Cowork no ve las herramientas):** **Ajustes → Extensiones → Instalar
extensión…** → elige `dist/backoffice-<empresa>.mcpb` de tu carpeta. Se llama **«Back Office · <Empresa>»** y ya trae tu
carpeta en «Carpeta de Back Office»: no la cambies. Reinicia Claude Desktop. (Sin empresa: `dist/backoffice.mcpb` y en
«Carpeta de Back Office» elige tu carpeta; el plugin genérico se agrega con el marketplace `SandPalace/backoffice`.)

**Prueba:** en una sesión **nueva** de Chat o Cowork pregunta «¿Qué equipos tengo?» (o «¿Qué equipos y agentes tengo en Back
Office?»). Debe contestar usando las herramientas de Back Office (no leyendo archivos) con los equipos de ESA empresa. En la
pestaña **Code** de Claude Desktop no hace falta nada más que lo de la parte A.

### Cómo distinguir una empresa de otra

| Dónde | Empresa Acme | Empresa Beta |
| --- | --- | --- |
| Agentes | `backoffice-acme:ceo`, `backoffice-acme:cmo`, … | `backoffice-beta:ceo`, … |
| `/mcp` en Claude Code | `plugin:backoffice-acme:backoffice` | `plugin:backoffice-beta:backoffice` |
| Extensión de Claude Desktop | «Back Office · Acme» | «Back Office · Beta» |
| Oficina web | http://localhost:4781 | http://localhost:4783 |

## Varias empresas

**Una carpeta + un plugin + un par de puertos por empresa.** Para la segunda empresa clona otra vez en su propia carpeta
(`cd ~/Documents/Beta && git clone https://github.com/SandPalace/backoffice.git .backoffice`), corre `./install.sh` ahí y
escribe su nombre: el instalador ve que el 4780/4781 ya es de tu otro Back Office y le da el siguiente par libre.

- Puedes tener **varias encendidas a la vez**: `./bin/backoffice start` en cada carpeta; cada oficina abre en su puerto.
- Los agentes de cada plugin escriben **solo** en el Back Office de su empresa (su plugin trae la carpeta y el puerto).
- Claude carga todos tus plugins en todas las sesiones: elige el agente por su nombre (`backoffice-acme:ceo`) y abre las
  sesiones de cada empresa dentro de su carpeta.
- Para cambiar los puertos de una carpeta edita `BACKOFFICE_PORT` y `BACKOFFICE_WEB_PORT` en su `data/.env` y corre
  `./bin/backoffice update` (recompila la web y regenera su plugin).

Otros comandos: `./bin/backoffice status`, `./bin/backoffice stop`.

**WhatsApp (opcional):** `./bin/backoffice whatsapp` conecta un número de prueba para que los mensajes lleguen a Leads (el agente prepara, tú envías). Es una herramienta no oficial con riesgo de bloqueo; lee antes `plugins/backoffice/teams/sales-team/docs/WHATSAPP.md`. Funciona igual en Windows. Para un WhatsApp más estable, pídele al equipo de ventas «conecta mi WhatsApp con OpenWA».

## Instalar desde Claude Desktop (sin Terminal)

Abre **Claude Desktop → pestaña Code**, elige la **carpeta de tu proyecto** (la de tu empresa) y pega:

> Instálame Back Office en esta computadora. Revisa que tenga Git y Node 22.13 o más nuevo; si falta algo, dime cómo
> instalarlo y espera. Clona https://github.com/SandPalace/backoffice.git en .backoffice dentro de esta carpeta (si ya existe,
> detente y pregúntame; no toques Documentos/AgentOS; si esta carpeta es un repo de git, agrega .backoffice/ a su .gitignore). Lee su CLAUDE.md e INSTALL.md, pregúntame el nombre de mi empresa y el usuario y la contraseña de la oficina, corre el instalador
> (Mac: ./install.sh · Windows: .\install.ps1) y pídeme permiso antes de cambiar mi configuración de Claude. Arranca
> Back Office, haz el chequeo de salud y dime cómo conectar la extensión para Chat y Cowork. Si algo falla dos veces igual,
> detente y muéstrame el error.

La contraseña que le dictes queda escrita en esa conversación: usa una solo para la oficina.

## Actualizar

Desde la carpeta de Back Office:

```
./bin/backoffice update
```

Descarga la versión nueva, recompila y actualiza tu plugin (`backoffice-<empresa>`, que se regenera con tu carpeta y tus
puertos; o `backoffice` sin empresa) (si tenías la versión de 7 plugins, los quita y deja
uno solo; también corrige el permiso de Claude y Claude Desktop). Después reinicia Claude. Puedes repetirlo sin riesgo.

**Tu trabajo está a salvo al actualizar.** Todo lo que creas vive en `data/` (base de datos, archivos, entregas, tu
contraseña) y en `workspaces/` (las carpetas de tus proyectos, con los agentes que editas en Equipos). Git ignora esas dos
carpetas, así que actualizar (`git pull --ff-only` + `./bin/backoffice update`) nunca las toca. Solo si cambiaste a mano un
archivo que viene del repo (por ejemplo un agente en `plugins/backoffice/agents/`), `git pull` se detiene: Claude te lo
enseña y te pregunta si lo guardas aparte (`git stash`) o lo conservas. Nunca uses `git reset --hard`, `git clean` ni
fuerces el pull.

**¿Tu Back Office está en otra carpeta** (por ejemplo `~/AgentOS-app`, de la versión del 15 de octubre)? Abre Claude en esa
carpeta y dile **«mueve Back Office a Documentos»**: la detiene, la mueve a `<tu proyecto>/.backoffice` (con tus datos), vuelve a
correr el instalador para que Claude Code y Claude Desktop apunten a la carpeta nueva y limpia lo viejo preguntándote.

## Revisar que todo esté bien

```
./bin/backoffice status                                   # Servidor: corriendo (4780) · Oficina web: corriendo (4781) · Empresa: …
curl -s http://localhost:4780/api/auth/status          # {"enabled":true,"configured":true,...}  (usa tu puerto si no es 4780)
claude plugin list                                     # backoffice-<empresa>@backoffice-<empresa> ✔ enabled (sin empresa: backoffice@backoffice)
```

En Claude Desktop: Personalizar → Plugins muestra **backoffice-<empresa>** (o Ajustes → Extensiones, **Back Office · <Empresa>**), y en Chat o Cowork «¿Qué equipos y agentes tengo en
Back Office?» responde con tus equipos.

¿Algo raro? Abre Claude en la carpeta de Back Office y dile **«revisa y repara mi Back Office»**: sigue el manual de `CLAUDE.md`.

## Problemas comunes

- **"El puerto está ocupado"**: otro programa (u otro Back Office) usa tus puertos. Corre `./bin/backoffice stop`; si sigue,
  cambia `BACKOFFICE_PORT` y `BACKOFFICE_WEB_PORT` en `data/.env` (por ejemplo 4790 y 4791) y corre `./bin/backoffice update`.
- **"Node muy viejo"**: instala Node 24 LTS desde https://nodejs.org, abre una Terminal nueva y corre `./install.sh` otra vez.
- **Olvidé mi contraseña**: abre `data/.env` dentro de la carpeta de Back Office con cualquier editor (`open -e data/.env`), cambia `BACKOFFICE_PASSWORD=...`
  y guarda. No hace falta reiniciar. O corre `./install.sh --reset-login`.
- **No encuentra `claude`**: instala Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`) y corre `./install.sh` de nuevo.
- **La web se ve rota (errores 400 o en blanco) después de actualizar**: `./bin/backoffice stop`, `(cd web && node node_modules/next/dist/bin/next build)` y `./bin/backoffice start`.
- **Siguen apareciendo los plugins viejos o falta tu plugin** (`backoffice-<empresa>` o `backoffice@backoffice`): `node scripts/migrate-plugins.mjs` y reinicia Claude.
- **Logs**: `data/logs/` (dentro de la carpeta de Back Office).

## Windows

Instalador nativo para Windows 10/11 (PowerShell 5.1, el que ya trae Windows, o PowerShell 7). No necesitas WSL ni permisos de administrador.

### Requisitos

- **Node.js 24 LTS** (mínimo 22.13): instalador de https://nodejs.org (o `winget install OpenJS.NodeJS.LTS`). Revisa con `node -v`.
- **Git for Windows**: https://git-scm.com/download/win (o `winget install Git.Git`).
- **Claude Code** (y, si quieres, Claude Desktop): `winget install Anthropic.ClaudeCode` o `irm https://claude.ai/install.ps1 | iex`.
- Después de instalar cualquier cosa, **abre una terminal nueva**.

### Paso a paso

1. Abre **PowerShell** (menú Inicio > escribe "PowerShell").
2. Clona el repositorio:
   ```
   cd $HOME\Documents
   cd Acme
   git clone https://github.com/SandPalace/backoffice.git .backoffice
   cd .backoffice
   ```
   Igual que en Mac, todo (datos, proyectos, logs) se queda dentro de esa carpeta, en `data\` y `workspaces\`, y no se instala nada en tu sistema. Lo único fuera de la carpeta: la configuración de Claude, para que encuentre tus agentes.
   El repositorio es público: no necesitas iniciar sesión en GitHub.
3. Instala (tarda unos minutos). Windows bloquea scripts por defecto; por eso se corre así:
   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
   Te pedirá el **nombre de tu empresa** (elige los puertos y tu plugin `backoffice-<empresa>`), un **usuario y contraseña**
   para tu oficina (al escribir la contraseña no verás nada: es normal) y te preguntará si Claude puede usar las
   herramientas de Back Office sin pedir aprobación.
4. Arranca desde la carpeta de Back Office:
   ```
   .\bin\backoffice.cmd start
   ```
   Se abre el navegador en http://localhost:4781 (o el puerto que te mostró el instalador). Otros comandos: `.\bin\backoffice.cmd status`, `stop`, `update`.
5. Reinicia Claude Desktop y conecta Chat y Cowork igual que en Mac: sección «Configurar el plugin y el MCP en Claude
   Desktop» (`dist\company-plugin` o `dist\backoffice-<empresa>.mcpb`).

Opciones del instalador: `-ResetLogin`, `-NoClaude`, `-NoClaudeCli`, `-NoDesktop`, `-NoSettings`
(ej. `powershell -ExecutionPolicy Bypass -File .\install.ps1 -ResetLogin`).

### Problemas en Windows

- **"backoffice.cmd no se reconoce"**: estás fuera de la carpeta. Haz `cd $HOME\Documents\<Empresa>\.backoffice` y corre `.\bin\backoffice.cmd start`.
- **"la ejecución de scripts está deshabilitada"**: corre el instalador con `powershell -ExecutionPolicy Bypass -File .\install.ps1`.
- **Ventana del Firewall / antivirus preguntando por "node"**: elige **Permitir** (solo redes privadas). Back Office solo escucha en 127.0.0.1.
  Si tu antivirus bloquea `npm ci`, agrega una excepción para la carpeta del repo y vuelve a correr el instalador.
- **Puerto ocupado**: `.\bin\backoffice.cmd stop`; si sigue, cambia `BACKOFFICE_PORT` y `BACKOFFICE_WEB_PORT` en `data\.env` y corre `.\bin\backoffice.cmd update`.
- **Olvidé mi contraseña**: edita `data\.env` dentro de la carpeta de Back Office (`notepad data\.env`) o corre el instalador con `-ResetLogin`.
- **Logs**: `data\logs\` dentro de la carpeta de Back Office (`server.err.log`, `web.err.log`).

## Soporte

Abre un issue en este repositorio, o dile a Assistant «algo no funciona en Back Office» y te prepara el reporte.
