# Back Office

Una oficina virtual donde trabajan tus equipos de agentes de IA. Contratas un equipo (marketing, ventas, cobranza,
dirección, finanzas, desarrollo), los agentes trabajan dentro de Claude (Desktop, Cowork o Code) y tú los ves moverse en una
oficina en 3D, revisas lo que entregan y apruebas las tareas.

- **Un plugin de Claude, `backoffice`**: todos los agentes y skills (`plugins/backoffice/`). Los equipos se arman dentro de la
  app, en la pestaña **Equipos**.
- **Servidor local**: guarda tareas y entregables en tu computadora, dentro de la carpeta de Back Office (`data/` y `workspaces/`). Tus datos no salen de tu máquina.
- **Oficina web**: `http://localhost:4781`, con usuario y contraseña propios.

Los agentes nunca publican, envían ni pagan solos: todo lo externo queda como borrador para que tú lo ejecutes.

## Instalación

Lee **[INSTALL.md](INSTALL.md)** (paso a paso, en español). Clona en `Documentos/AgentOS`, corre el instalador y
**conecta Claude Desktop**: Ajustes → Extensiones → Instalar extensión… → `dist/backoffice.mcpb` (Chat y Cowork). También
puedes instalar todo desde Claude Desktop sin Terminal: INSTALL.md, sección «Instalar desde Claude Desktop».

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
./bin/backoffice update     # dependencias, compilación y el plugin backoffice (migra solo desde los 7 plugins viejos)
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

- **Versión 1.4: AgentOS ahora se llama Back Office.** Tu carpeta se queda donde está. `./bin/backoffice update` (o el
  `./bin/agentos update` de siempre, que sigue funcionando por una versión) respalda tus datos primero y cambia los nombres
  por ti: el plugin pasa a ser `backoffice`, la base `data/backoffice.db`, y la configuración de Claude se actualiza. Al final
  te dice lo poco que queda a mano en Claude Desktop.
- **Versión 1.2: funciona en Chat y Cowork.** Antes Cowork no veía las herramientas de Back Office; ahora se conecta con una
  extensión de un clic (o el plugin desde Personalizar → Plugins). Si Back Office está apagado, se enciende solo o te dice
  cómo hacerlo, y las ligas del Canvas abren el proyecto y la tarjeta exactos. Otros agentes (Codex, Cursor…) se conectan
  por MCP: `docs/API.md`.
- **Un solo plugin.** Antes eran 7 plugins (uno por equipo); ahora es uno, `backoffice`, con todos los agentes. Los equipos
  son parte de la app: los armas en **Equipos**. `./bin/backoffice update` quita los 7 viejos, instala el nuevo y corrige
  los permisos y Claude Desktop por ti.
- **Canvas e Inicio.** En la pestaña **Canvas** tus agentes publican lo que necesitan que revises (reportes, tableros,
  propuestas, creativos): comentas, apruebas o pides cambios, y suben la versión nueva. Cada proyecto tiene su
  **Inicio**: pídele a cualquier agente «arma el inicio de este proyecto». Traen ideas y plantillas para no empezar de cero.
- **Finanzas:** contralor, analista financiero, cumplimiento fiscal y finanzas personales, con un libro de ingresos
  (ventas, abonos, IVA y datos para facturar), estados financieros, paquete para tu contador y calendario del SAT.
- **WhatsApp con OpenWA (opcional):** pídele al equipo de ventas «conecta mi WhatsApp con OpenWA». Corre en tu
  computadora; los agentes leen tus chats y solo envían cuando tú apruebas cada mensaje.
- **Vista oficina opcional:** la app abre en la vista normal; la oficina 3D se prende con el botón «Vista oficina».
- **Repo genérico:** el repositorio público trae solo el producto (sin material de clase) y ahora vive en
  `SandPalace/agentos`; tu clon viejo sigue funcionando (GitHub redirige).

## Dudas y fallas

Abre un issue en este repositorio (o pídeselo a Assistant: «algo no funciona en Back Office»).

## Créditos

Créditos y licencias de terceros: [`CREDITS.md`](CREDITS.md).
