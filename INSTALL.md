# Instalar Back Office en tu computadora

Esta guía es para macOS (Linux es igual). Para Windows, ve a la sección **Windows** (instalador nativo, no necesitas WSL).

## Qué necesitas

- Una suscripción de Claude (Pro, Max o Team).
- **Claude Code** instalado (y, si quieres, Claude Desktop).
- **Node.js 24 LTS** (mínimo 22.13). Descárgalo de https://nodejs.org. Revisa con `node -v`.
- **Git**. En Mac, escribe `git --version` en la Terminal; si no está, macOS te ofrece instalarlo.
- Una cuenta de GitHub solo si quieres enviar reportes de fallas o ideas (el repositorio es público).

## Paso a paso

1. **Clona el repositorio en Documentos** (abre la app Terminal). Usa exactamente `Documentos/AgentOS`: ahí la buscan la
   extensión de Claude Desktop y las actualizaciones.
   ```
   cd ~/Documents && git clone https://github.com/SandPalace/agentos.git AgentOS && cd AgentOS
   ```
   Todo lo que Back Office crea (datos, proyectos, logs, usuario y contraseña) se queda **dentro de esa carpeta**
   (`data/` para los datos y `workspaces/` para tus workspaces); no se instala nada en tu sistema (ni comandos globales, ni cambios al PATH). Esas dos carpetas nunca se suben a Git. Lo único fuera de la carpeta: la configuración de Claude, para que encuentre tus agentes.
   El repositorio es público: no necesitas cuenta ni iniciar sesión en GitHub.
2. **Instala** (tarda unos minutos, necesita internet):
   ```
   ./install.sh
   ```
   El instalador también te pregunta si Claude puede usar las herramientas de Back Office sin pedir aprobación; si aceptas,
   además le avisa a Claude dónde está tu carpeta de Back Office (en `~/.claude/settings.json`, con respaldo).
   Si ya tenías Back Office instalado antes (carpetas `~/.agentos` y `~/AgentOS`), no se mueve nada: con el servidor detenido corre
   `node scripts/migrate-to-project-folder.mjs` (muestra el plan) y luego con `--yes`, o pídele a Claude «migra Back Office a la carpeta del proyecto».
   Te pedirá elegir un **usuario y contraseña** para entrar a tu oficina. Al escribir la contraseña no verás nada: es normal.
3. **Arranca** (desde la carpeta de Back Office):
   ```
   ./bin/backoffice start
   ```
   Se abre el navegador en http://localhost:4781.
4. **Entra** con el usuario y contraseña del paso 2.
5. **Cierra y abre Claude Desktop** (o tu terminal de Claude Code) para que cargue el plugin `backoffice`.
6. **Conecta Claude Desktop (Chat y Cowork).** Cowork no usa lo que el instalador registró para Claude Code; se conecta así:
   - **Extensión (un clic, probada):** Claude Desktop → **Ajustes → Extensiones → Instalar extensión…** → elige
     `Documentos/AgentOS/dist/backoffice.mcpb`. En «Carpeta de Back Office» deja `Documentos/AgentOS`. Reinicia Claude Desktop.
   - **O el plugin completo (agentes y skills también):** Claude Desktop → **Personalizar → Plugins → Agregar marketplace** →
     `SandPalace/agentos` → instala **backoffice**.
   - **Prueba:** en una sesión **nueva** de Chat o Cowork pregunta «¿Qué equipos y agentes tengo en Back Office?». Debe usar
     las herramientas de Back Office (no leer archivos). En la pestaña **Code** de Claude Desktop no hace falta nada más.
   - Si un agente te dice que no tiene las herramientas de Back Office, no lo dejes «escribir directo en la carpeta»: conecta la
     extensión y vuelve a preguntar.

Otros comandos: `./bin/backoffice status`, `./bin/backoffice stop`.

**WhatsApp (opcional):** `./bin/backoffice whatsapp` conecta un número de prueba para que los mensajes lleguen a Leads (el agente prepara, tú envías). Es una herramienta no oficial con riesgo de bloqueo; lee antes `plugins/backoffice/teams/sales-team/docs/WHATSAPP.md`. Funciona igual en Windows. Para un WhatsApp más estable, pídele al equipo de ventas «conecta mi WhatsApp con OpenWA».

## Instalar desde Claude Desktop (sin Terminal)

Abre **Claude Desktop → pestaña Code**, elige tu carpeta **Documentos** como proyecto y pega:

> Instálame Back Office en esta computadora. Revisa que tenga Git y Node 22.13 o más nuevo; si falta algo, dime cómo
> instalarlo y espera. Clona https://github.com/SandPalace/agentos.git en Documentos/AgentOS (si ya existe, detente y
> pregúntame). Lee su CLAUDE.md e INSTALL.md, pregúntame el usuario y la contraseña de la oficina, corre el instalador
> (Mac: ./install.sh · Windows: .\install.ps1) y pídeme permiso antes de cambiar mi configuración de Claude. Arranca
> Back Office, haz el chequeo de salud y dime cómo conectar la extensión para Chat y Cowork. Si algo falla dos veces igual,
> detente y muéstrame el error.

La contraseña que le dictes queda escrita en esa conversación: usa una solo para la oficina.

## Actualizar

Desde la carpeta de Back Office:

```
./bin/backoffice update
```

Descarga la versión nueva, recompila y actualiza el plugin `backoffice` (si tenías la versión de 7 plugins, los quita y deja
uno solo; también corrige el permiso de Claude y Claude Desktop). Después reinicia Claude. Puedes repetirlo sin riesgo.

**Tu trabajo está a salvo al actualizar.** Todo lo que creas vive en `data/` (base de datos, archivos, entregas, tu
contraseña) y en `workspaces/` (las carpetas de tus proyectos, con los agentes que editas en Equipos). Git ignora esas dos
carpetas, así que actualizar (`git pull --ff-only` + `./bin/backoffice update`) nunca las toca. Solo si cambiaste a mano un
archivo que viene del repo (por ejemplo un agente en `plugins/backoffice/agents/`), `git pull` se detiene: Claude te lo
enseña y te pregunta si lo guardas aparte (`git stash`) o lo conservas. Nunca uses `git reset --hard`, `git clean` ni
fuerces el pull.

**¿Tu Back Office está en otra carpeta** (por ejemplo `~/AgentOS-app`, de la versión del 15 de octubre)? Abre Claude en esa
carpeta y dile **«mueve Back Office a Documentos»**: la detiene, la mueve a `Documentos/AgentOS` (con tus datos), vuelve a
correr el instalador para que Claude Code y Claude Desktop apunten a la carpeta nueva y limpia lo viejo preguntándote.

## Revisar que todo esté bien

```
./bin/backoffice status                                   # Servidor: corriendo (4780) · Oficina web: corriendo (4781)
curl -s http://localhost:4780/api/auth/status          # {"enabled":true,"configured":true,...}
claude plugin list                                     # backoffice@backoffice  ✔ enabled  (y ningún otro @backoffice)
```

En Claude Desktop: Ajustes → Extensiones muestra **Back Office** activa, y en Chat o Cowork «¿Qué equipos y agentes tengo en
Back Office?» responde con tus equipos.

¿Algo raro? Abre Claude en la carpeta de Back Office y dile **«revisa y repara mi Back Office»**: sigue el manual de `CLAUDE.md`.

## Problemas comunes

- **"El puerto está ocupado"**: otro programa usa el 4780 o el 4781. Corre `./bin/backoffice stop`; si sigue, usa otros puertos:
  `BACKOFFICE_PORT=4790 BACKOFFICE_WEB_PORT=4791 ./bin/backoffice start` (instala con las mismas variables si cambias el 4780).
- **"Node muy viejo"**: instala Node 24 LTS desde https://nodejs.org, abre una Terminal nueva y corre `./install.sh` otra vez.
- **Olvidé mi contraseña**: abre `data/.env` dentro de la carpeta de Back Office con cualquier editor (`open -e data/.env`), cambia `BACKOFFICE_PASSWORD=...`
  y guarda. No hace falta reiniciar. O corre `./install.sh --reset-login`.
- **No encuentra `claude`**: instala Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`) y corre `./install.sh` de nuevo.
- **La web se ve rota (errores 400 o en blanco) después de actualizar**: `./bin/backoffice stop`, `(cd web && node node_modules/next/dist/bin/next build)` y `./bin/backoffice start`.
- **Siguen apareciendo los plugins viejos o falta `backoffice@backoffice`**: `node scripts/migrate-plugins.mjs` y reinicia Claude.
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
   git clone https://github.com/SandPalace/agentos.git AgentOS
   cd AgentOS
   ```
   Igual que en Mac, todo (datos, proyectos, logs) se queda dentro de esa carpeta, en `data\` y `workspaces\`, y no se instala nada en tu sistema. Lo único fuera de la carpeta: la configuración de Claude, para que encuentre tus agentes.
   El repositorio es público: no necesitas iniciar sesión en GitHub.
3. Instala (tarda unos minutos). Windows bloquea scripts por defecto; por eso se corre así:
   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
   Te pedirá un **usuario y contraseña** para tu oficina (al escribir la contraseña no verás nada: es normal) y
   te preguntará si Claude puede usar las herramientas de Back Office sin pedir aprobación.
4. Arranca desde la carpeta de Back Office:
   ```
   .\bin\backoffice.cmd start
   ```
   Se abre el navegador en http://localhost:4781. Otros comandos: `.\bin\backoffice.cmd status`, `stop`, `update`.
5. Reinicia Claude Desktop y conecta Chat y Cowork igual que en Mac (paso 6): Ajustes → Extensiones → Instalar
   extensión… → `Documentos\AgentOS\dist\backoffice.mcpb`, o Personalizar → Plugins → `SandPalace/agentos`.

Opciones del instalador: `-ResetLogin`, `-NoClaude`, `-NoClaudeCli`, `-NoDesktop`, `-NoSettings`
(ej. `powershell -ExecutionPolicy Bypass -File .\install.ps1 -ResetLogin`).

### Problemas en Windows

- **"backoffice.cmd no se reconoce"**: estás fuera de la carpeta. Haz `cd $HOME\Documents\AgentOS` y corre `.\bin\backoffice.cmd start`.
- **"la ejecución de scripts está deshabilitada"**: corre el instalador con `powershell -ExecutionPolicy Bypass -File .\install.ps1`.
- **Ventana del Firewall / antivirus preguntando por "node"**: elige **Permitir** (solo redes privadas). Back Office solo escucha en 127.0.0.1.
  Si tu antivirus bloquea `npm ci`, agrega una excepción para la carpeta del repo y vuelve a correr el instalador.
- **Puerto ocupado**: `.\bin\backoffice.cmd stop`; si sigue, `$env:BACKOFFICE_PORT=4790; $env:BACKOFFICE_WEB_PORT=4791; .\bin\backoffice.cmd start`.
- **Olvidé mi contraseña**: edita `data\.env` dentro de la carpeta de Back Office (`notepad data\.env`) o corre el instalador con `-ResetLogin`.
- **Logs**: `data\logs\` dentro de la carpeta de Back Office (`server.err.log`, `web.err.log`).

## Soporte

Abre un issue en este repositorio, o dile a Assistant «algo no funciona en Back Office» y te prepara el reporte.
