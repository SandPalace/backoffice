# Back Office

Una oficina virtual donde trabajan tus equipos de agentes de IA. Contratas un equipo (marketing, ventas, cobranza,
dirección, finanzas, desarrollo), los agentes trabajan dentro de Claude (Desktop, Cowork o Code) y tú los ves moverse en una
oficina en 3D, revisas lo que entregan y apruebas las tareas.

- **Un plugin de Claude por empresa, `backoffice-<empresa>`**: todos los agentes y skills (`plugins/backoffice/`), conectados al
  Back Office de esa empresa. Sin nombre de empresa se usa el genérico `backoffice`. Los equipos se arman dentro de la app, en
  la pestaña **Equipos**.
- **Servidor local**: guarda tareas y entregables en tu computadora, dentro de la carpeta de Back Office (`data/` y `workspaces/`). Tus datos no salen de tu máquina.
- **Oficina web**: `http://localhost:4781` (la segunda empresa en `4783`, …), con usuario y contraseña propios.

Los agentes nunca publican, envían ni pagan solos: todo lo externo queda como borrador para que tú lo ejecutes.

**Un Back Office = una empresa.** Cada Back Office es una copia de este repo, con plantillas de agentes y skills, que se
adapta a UNA empresa. Si tienes varias empresas, instala un Back Office por empresa, cada uno en su propia carpeta, con su
plugin y sus puertos: pueden estar encendidos al mismo tiempo.

## Empieza aquí: instala tu Back Office y trae lo que tenías en AgentOS

Abre Claude Desktop → pestaña **Code**, con la **carpeta de tu proyecto** abierta (la de tu empresa, por ejemplo
`Documentos/Acme`; o `claude` en la terminal, dentro de ella). Back Office se instala adentro, en `.backoffice`. Cambia `<Empresa>` por el nombre corto de tu empresa y pega este prompt completo:

> Quiero instalar Back Office para mi empresa <Empresa> como proyecto nuevo y traer lo que tenía en AgentOS.
>
> 1. Clona https://github.com/SandPalace/backoffice.git en `.backoffice` dentro de esta carpeta (la de mi proyecto; si
>    ya existe, detente y pregúntame). Si esta carpeta es un repo de git, agrega `.backoffice/` a su `.gitignore`. No toques mi carpeta vieja `Documentos/AgentOS`: solo se lee, nunca se borra ni se mueve.
> 2. Entra a `.backoffice`, lee su `CLAUDE.md` y sigue la sección «Instalación nueva»: corre el instalador con el nombre
>    de mi empresa (<Empresa>), que me pida mi usuario y contraseña de la oficina (yo los escribo), arranca Back Office y haz
>    el chequeo de salud.
> 3. Si `Documentos/AgentOS` existe, sigue la sección «Traer datos de AgentOS» del `CLAUDE.md`: muéstrame mis proyectos
>    viejos (`node scripts/import-agentos.mjs --from ~/Documents/AgentOS --list`), yo elijo cuál es <Empresa>, muéstrame
>    el plan y solo con mi OK copia los datos.
> 4. Ábreme la oficina web en el puerto que eligió el instalador (http://localhost:4781 si es mi primer Back Office) y dime
>    qué ves (equipos, tareas, leads y archivos que llegaron).
> 5. Dime cómo conectar el plugin de mi empresa en Claude Desktop (sección «Configurar el plugin y el MCP en Claude Desktop»
>    de INSTALL.md) y cómo abrir al CEO para el arranque de la empresa.
>
> Nunca me pidas ni muestres contraseñas, llaves o el contenido de `.env`; nunca borres carpetas ni hagas `git reset --hard`.
> Si algo falla dos veces igual, detente y muéstrame el error.

Después, **arranca tu empresa con el CEO**. En la terminal, dentro de la carpeta de tu proyecto:

```bash
claude --agent backoffice-<empresa>:ceo
```

`<empresa>` es el nombre corto que te dio el instalador (`./bin/backoffice status` lo muestra, por ejemplo `backoffice-acme:ceo`).
Si instalaste sin nombre de empresa, es `claude --agent backoffice:ceo`. (O en Claude Desktop → Code, en esa carpeta: «usa al
agente ceo».) Dile:

> Arranca mi empresa con el checklist del C-board.

El CEO sigue el skill `company-kickoff`: revisa la instalación y la migración, te recomienda qué equipos activar, te hace
preguntas en rondas cortas para formar la base de conocimiento de tu empresa (`company/` en Archivos), coordina a los demás
agentes (finanzas, marketing, ventas), publica en **Inicio** (y en **Boards**) un tablero con el estado general de la empresa
y te deja un plan con los siguientes pasos, uno por uno, como tareas en **Tareas**.

¿Varias empresas? Repite el prompt con otro nombre: cada una tiene su carpeta, sus datos, su plugin
(`backoffice-<empresa>`), su CEO y su par de puertos (el instalador toma el siguiente libre: 4782/4783, …). Puedes tener
varias encendidas a la vez; cada oficina abre en su puerto. Detalle: INSTALL.md, sección «Varias empresas».

## Instalación

Lee **[INSTALL.md](INSTALL.md)** (paso a paso, en español). Clona en `<tu proyecto>/.backoffice` (o usa el prompt de arriba), corre el instalador y
**conecta Claude Desktop** (siguiente sección). También puedes instalar todo desde Claude Desktop sin Terminal: INSTALL.md,
sección «Instalar desde Claude Desktop».

## Configurar el plugin y el MCP en Claude Desktop

Resumen (el paso a paso, con lo que debes ver en cada pantalla, está en INSTALL.md, sección del mismo nombre):

1. **Claude Code (terminal):** el instalador ya registra tu plugin. Para comprobarlo abre `claude` en tu carpeta: `/plugin`
   muestra `backoffice-<empresa>` instalado y `/mcp` muestra `plugin:backoffice-<empresa>:backoffice` conectado. Si no:
   `node scripts/build-company-plugin.mjs --register`.
2. **Claude Desktop (Chat y Cowork):** Personalizar → Plugins → Agregar marketplace → la carpeta `dist/company-plugin` de tu
   Back Office → instala **backoffice-<empresa>**. Si no se puede: Ajustes → Extensiones → Instalar extensión… →
   `dist/backoffice-<empresa>.mcpb` (se llama «Back Office · <Empresa>»). Reinicia Claude Desktop.
3. **Prueba:** en una sesión nueva pregunta «¿Qué equipos tengo?»: debe responder con los equipos de esa empresa.
4. **Varias empresas:** cada agente lleva el nombre de su empresa (`backoffice-acme:ceo`, `backoffice-beta:ceo`) y cada extensión
   también («Back Office · Acme»). Sin nombre de empresa todo se llama `backoffice` y la extensión es `dist/backoffice.mcpb`.

## Actualizar a la versión nueva

Abre Claude (Code en la terminal o la pestaña **Code** de Claude Desktop) **en la carpeta de Back Office** y dile:

> Actualiza Back Office

Eso corre el skill `update-backoffice`: primero revisa dónde están tus datos, qué versión tienes y cuál es la nueva
(`./bin/backoffice check`), te explica el plan, respalda `data/` y `workspaces/` en `backups/` (`./bin/backoffice backup`) y
solo entonces actualiza; te pregunta antes de detener la oficina o de apartar un archivo que hayas editado. Desde Cowork o
Chat no puede: usa la pestaña Code.

O hazlo a mano (Mac/Linux; en Windows usa `.\bin\backoffice.cmd`):

```bash
./bin/backoffice backup     # respaldo de tus datos en backups/ (ignorado por git)
./bin/backoffice stop
git pull --ff-only
./bin/backoffice update     # dependencias, compilación y tu plugin (backoffice-<empresa> o backoffice; migra los viejos)
./bin/backoffice start
```

Después cierra y abre Claude Desktop. Puedes repetir `./bin/backoffice update` las veces que quieras: no rompe nada.

### Tu trabajo está a salvo al actualizar

Tus datos (`data/`: base de datos, archivos, entregas, contraseña) y tus proyectos (`workspaces/`, con los agentes que
editas en Equipos) están ignorados por git: `git pull --ff-only` y `./bin/backoffice update` nunca los tocan. Si cambiaste a
mano un archivo que viene del repo, el pull se detiene y Claude te pregunta si lo guardas aparte (`git stash`) o lo
conservas; nunca borra tus cambios (nada de `git reset --hard`, `git clean` ni pull forzado).

¿Instalaste Back Office en otra carpeta (por ejemplo `~/AgentOS-app`)? Pídele a Claude **«mueve Back Office a Documentos»**.

## Si algo falla

Abre Claude en la carpeta de Back Office y dile:

> Revisa y repara mi Back Office.

Claude sigue el manual de `CLAUDE.md` de esta carpeta: revisa el servidor, la web, el plugin, los permisos y Claude
Desktop, te dice qué encontró y lo arregla (te pregunta antes de borrar o cambiar algo). Si es una falla de Back Office,
prepara un reporte para GitHub y tú lo envías.

## Qué hay de nuevo

- **Varias empresas en una computadora.** El instalador pregunta el nombre de tu empresa: tus agentes se instalan como el
  plugin `backoffice-<empresa>` (agentes `backoffice-<empresa>:ceo`, …) y cada carpeta tiene su par de puertos (4780/4781,
  4782/4783, …), así que puedes tener varias empresas encendidas a la vez y los agentes de cada una escriben solo en la suya.
  También hay una extensión de Claude Desktop por empresa («Back Office · <Empresa>»).
- **Versión 1.6: varias empresas a la vez y agile completo.** Cada empresa tiene su carpeta, su par de puertos y su propio
  plugin `backoffice-<empresa>` (y su extensión «Back Office · <Empresa>»), así que puedes tener varios Back Office abiertos y
  cada agente escribe en el suyo. En **Tareas** hay estados Backlog y Cancelada, y una vista **Plan** con épicas, historias y
  sprints: los agentes planean; tú apruebas, cancelas y completas sprints.
- **Versión 1.5: un Back Office por empresa.** Ya no hay selector de proyectos: cada Back Office es de una sola empresa y se
  adapta a ella. `scripts/import-agentos.mjs` trae los datos de UN proyecto de tu AgentOS viejo (tareas, leads, entregas,
  archivos, Boards, equipos), sin tocar la carpeta vieja. El CEO trae el skill `company-kickoff` (checklist del C-board).
  La pestaña **Canvas** ahora se llama **Boards**.

- **Versión 1.4: AgentOS ahora se llama Back Office.** Tu carpeta se queda donde está. `./bin/backoffice update` (o el
  `./bin/agentos update` de siempre, que sigue funcionando por una versión) respalda tus datos primero y cambia los nombres
  por ti: el plugin pasa a ser `backoffice`, la base `data/backoffice.db`, y la configuración de Claude se actualiza. Al final
  te dice lo poco que queda a mano en Claude Desktop.
- **Versión 1.2: funciona en Chat y Cowork.** Antes Cowork no veía las herramientas de Back Office; ahora se conecta con una
  extensión de un clic (o el plugin desde Personalizar → Plugins). Si Back Office está apagado, se enciende solo o te dice
  cómo hacerlo, y las ligas de Boards abren el proyecto y la tarjeta exactos. Otros agentes (Codex, Cursor…) se conectan
  por MCP: `docs/API.md`.
- **Un solo plugin.** Antes eran 7 plugins (uno por equipo); ahora es uno, `backoffice`, con todos los agentes. Los equipos
  son parte de la app: los armas en **Equipos**. `./bin/backoffice update` quita los 7 viejos, instala el nuevo y corrige
  los permisos y Claude Desktop por ti.
- **Boards e Inicio.** En la pestaña **Boards** tus agentes publican lo que necesitan que revises (reportes, tableros,
  propuestas, creativos): comentas, apruebas o pides cambios, y suben la versión nueva. Cada proyecto tiene su
  **Inicio**: pídele a cualquier agente «arma el inicio de este proyecto». Traen ideas y plantillas para no empezar de cero.
- **Finanzas:** contralor, analista financiero, cumplimiento fiscal y finanzas personales, con un libro de ingresos
  (ventas, abonos, IVA y datos para facturar), estados financieros, paquete para tu contador y calendario del SAT.
- **WhatsApp con OpenWA (opcional):** pídele al equipo de ventas «conecta mi WhatsApp con OpenWA». Corre en tu
  computadora; los agentes leen tus chats y solo envían cuando tú apruebas cada mensaje.
- **Vista oficina opcional:** la app abre en la vista normal; la oficina 3D se prende con el botón «Vista oficina».
- **Repo genérico:** el repositorio público trae solo el producto (sin material de clase) y ahora vive en
  `SandPalace/backoffice`. Si tu clon apunta a `SandPalace/agentos` o `kikirrins/agentos`, cámbialo con
  `git remote set-url origin https://github.com/SandPalace/backoffice.git` (lo hace `update-backoffice`).

## Dudas y fallas

Abre un issue en este repositorio (o pídeselo a Assistant: «algo no funciona en Back Office»).

## Créditos

Créditos y licencias de terceros: [`CREDITS.md`](CREDITS.md).
