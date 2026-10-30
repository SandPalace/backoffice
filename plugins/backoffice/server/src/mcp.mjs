// MCP "backoffice". Por stdio (plugin, extensión .mcpb) corre en la computadora de la persona (no en la VM de Cowork),
// así que llega al servidor local aunque Cowork no pueda ver localhost. El servidor reusa `handle` para el MCP por
// HTTP en /mcp (Codex, OpenCode, Cursor...): una sola lista de herramientas, un solo despacho.
import { createInterface } from 'node:readline'
import { ensureServer, baseUrl, DOWN_MESSAGE } from './ensure.mjs'
import { isMain } from './paths.mjs'

// Optional project selector. Team agents are scoped to their own project; the Assistant works across all of them.
const WS = { type: 'string', description: 'Project (workspace) id. Team agents normally omit it (they work in their own project). The Assistant uses it to work across projects; ids come from backoffice_projects.' }
const WS_ALL = { type: 'string', description: 'Project (workspace) id, or "all" for a per-project summary. Team agents normally omit it (current project). The Assistant uses it to work across projects.' }

const LEAD_SOURCES = ['whatsapp', 'instagram', 'facebook', 'meta_form', 'email', 'web', 'referral', 'other']

// Agile planning: epics → stories → tasks, and sprints. Agents (normally the CEO or a lead) plan and move work forward;
// only the person closes it (done / cancelled / completed sprint) in the web. No tool approves or completes anything.
function agileTools() {
  const sch = (props, required = []) => ({ type: 'object', properties: { ...props, workspace: WS }, required })
  const epic = { title: { type: 'string', description: '1-200 chars' }, description: { type: 'string', description: 'Outcome and scope' }, owner_agent: { type: 'string', description: 'Agent id that owns it (e.g. ceo)' }, status: { type: 'string', enum: ['planning', 'active'] } }
  const story = {
    title: { type: 'string', description: '1-200 chars' },
    description: { type: 'string', description: 'User story ("As <who> I want <what> so that <why>") + acceptance criteria' },
    epic_id: { type: ['string', 'null'], description: 'Epic id (E-...)' },
    sprint_id: { type: ['string', 'null'], description: 'Sprint id (SP-...)' },
    points: { type: ['integer', 'null'], minimum: 0, maximum: 100, description: 'Estimate (story points)' },
    owner_agent: { type: 'string' },
    status: { type: 'string', enum: ['backlog', 'todo', 'doing', 'review'] },
  }
  const sprint = {
    name: { type: 'string', description: '1-120 chars, e.g. "Sprint 1"' },
    goal: { type: 'string', description: 'One sentence: what is true at the end of the sprint' },
    start_date: { type: 'string', description: 'YYYY-MM-DD' },
    end_date: { type: 'string', description: 'YYYY-MM-DD' },
    status: { type: 'string', enum: ['planning', 'active', 'review'] },
    report: { type: 'string', description: 'Sprint report: done, not done, why, next. Required to move to review.' },
  }
  const id = (p) => ({ id: { type: 'string', description: `${p} id` } })
  return [
    { name: 'backoffice_epic_create', description: 'Creates an epic: a big outcome that groups stories (e.g. "Lanzar tienda en línea"). Agents use planning or active; only the person marks an epic done or cancelled.', inputSchema: sch(epic, ['title']) },
    { name: 'backoffice_epic_list', description: 'Lists the epics of the project with story counts, points and task progress. Filter by status.', inputSchema: sch({ status: { type: 'string', enum: ['planning', 'active', 'done', 'cancelled'] } }) },
    { name: 'backoffice_epic_update', description: 'Updates an epic (partial). Agents may set planning or active; done/cancelled are the person\'s, and a closed epic is only reopened by the person.', inputSchema: sch({ ...id('Epic (E-...)'), ...epic }, ['id']) },
    { name: 'backoffice_story_create', description: 'Creates a user story with acceptance criteria, optionally inside an epic and a sprint, with points. Then create its tasks with backoffice_task_create story_id. Agents use backlog/todo/doing/review; only the person marks a story done or cancelled.', inputSchema: sch(story, ['title']) },
    { name: 'backoffice_story_list', description: 'Lists stories with their task progress. Filters: epic_id, sprint_id ("none" = without), status.', inputSchema: sch({ epic_id: { type: 'string' }, sprint_id: { type: 'string' }, status: { type: 'string', enum: ['backlog', 'todo', 'doing', 'review', 'done', 'cancelled'] } }) },
    { name: 'backoffice_story_update', description: 'Updates a story (partial): text, points, epic, sprint, status (backlog/todo/doing/review). Move it to review when its tasks are delivered; the person approves (done) or cancels it.', inputSchema: sch({ ...id('Story (S-...)'), ...story }, ['id']) },
    { name: 'backoffice_sprint_create', description: 'Creates a sprint (time box, usually 1-2 weeks) with a goal and dates. At most ONE active sprint per project. Agents use planning/active/review; only the person completes a sprint (in the web), which rolls unfinished work over.', inputSchema: sch(sprint, ['name']) },
    { name: 'backoffice_sprint_list', description: 'Lists sprints (active first) with progress: tasks by status, percent done, story points.', inputSchema: sch({ status: { type: 'string', enum: ['planning', 'active', 'review', 'completed'] } }) },
    { name: 'backoffice_sprint_update', description: 'Updates a sprint (partial). Start it with status active (only one active per project). At the end move it to review WITH a report; the person reads it and completes the sprint in the web. You can never complete it.', inputSchema: sch({ ...id('Sprint (SP-...)'), ...sprint }, ['id']) },
  ]
}

const TOOLS = [
  {
    name: 'backoffice_task_create',
    description: 'Crea una tarea en el tablero de Back Office. Úsala al empezar un trabajo que tomará más de un paso. Status todo (default) o backlog (planeada, aún no lista). Puede ir dentro de una historia (story_id; hereda su sprint) y/o un sprint (sprint_id).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Qué se va a hacer, en una frase' },
        description: { type: 'string' },
        agent: { type: 'string', description: 'Quién la hace (e.g. analyst, cmo)' },
        status: { type: 'string', enum: ['todo', 'backlog'] },
        story_id: { type: 'string', description: 'Story id (S-...) this task belongs to' },
        sprint_id: { type: 'string', description: 'Sprint id (SP-...); default = the story\'s sprint' },
        workspace: WS,
      },
      required: ['title'],
    },
  },
  {
    name: 'backoffice_task_update',
    description:
      'Cambia el estado de una tarea: backlog, todo, doing, blocked o review, y/o su historia (story_id) o sprint (sprint_id; null = quitarla). Para pasar a review debes indicar output_dir (carpeta con los entregables, ruta absoluta) o haber registrado un entregable con backoffice_task_deliver. Nunca marques done ni cancelled: la persona aprueba y cancela en la web. Si la tarea ya no tiene sentido, propón cancelarla con propose_cancel (el motivo): queda en review y la persona decide.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['backlog', 'todo', 'doing', 'blocked', 'review'] },
        story_id: { type: ['string', 'null'], description: 'Story id (S-...), or null to unlink' },
        sprint_id: { type: ['string', 'null'], description: 'Sprint id (SP-...), or null to move it back to the backlog pool' },
        propose_cancel: { type: 'string', description: 'Why this task should be cancelled. Moves it to review; only the person cancels.' },
        output_dir: { type: 'string', description: 'Ruta absoluta de la carpeta donde quedó el resultado' },
        workspace: WS,
      },
      required: ['id'],
    },
  },
  {
    name: 'backoffice_task_deliver',
    description:
      'Registers deliverables of a task. Preferred: `files` = workspace files/folders saved with backoffice_file_write (workspace-relative paths such as `marketing/acme/report.md`; a folder path delivers the whole folder) and/or inline `{name, content}` files. `path` (absolute disk path, or a URL when kind=link) is only for things that must live on disk, such as code projects. Give `files` or `path`.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id' },
        files: {
          type: 'array',
          description: 'Virtual deliverables (max 100). Each item: {path} of a workspace file/folder, or {name, content|content_base64, content_type?}. Optional per item: title, kind.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Workspace-relative path of a file or folder written with backoffice_file_write' },
              name: { type: 'string', description: 'File name for an inline file (no slashes)' },
              content: { type: 'string', description: 'utf-8 text of an inline file' },
              content_base64: { type: 'string' },
              content_type: { type: 'string' },
              title: { type: 'string' },
              kind: { type: 'string', enum: ['file', 'folder', 'report', 'image', 'markdown', 'artifact'] },
            },
          },
        },
        path: { type: 'string', description: 'Absolute disk path (or URL if kind=link). Only when the thing must live on disk.' },
        kind: { type: 'string', enum: ['file', 'folder', 'report', 'image', 'markdown', 'artifact', 'link'] },
        title: { type: 'string', description: 'Readable name' },
        workspace: WS,
      },
      required: ['id'],
    },
  },
  {
    name: 'backoffice_task_list',
    description: 'Lista las tareas del tablero, con sus entregables. Filtros: status, sprint_id, story_id ("none" = sin sprint/historia).',
    inputSchema: { type: 'object', properties: { status: { type: 'string' }, sprint_id: { type: 'string' }, story_id: { type: 'string' }, workspace: WS } },
  },
  ...agileTools(),
  {
    name: 'backoffice_lead_create',
    description: 'Creates a lead (prospect) in the Leads Kanban of the project. Agents may use any stage except "won" (only the person marks a lead as won). Stage "lost" requires lost_reason or notes.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person or business name (1-120 chars)' },
        company: { type: 'string' },
        contact: { type: 'string', description: 'Free text: phone, email, handle (max 200)' },
        source: { type: 'string', enum: LEAD_SOURCES },
        interest: { type: 'string', description: 'What they want (max 300)' },
        stage: { type: 'string', enum: ['new', 'contacted', 'qualified', 'proposal', 'lost'], description: 'Default new. Never "won".' },
        score: { type: 'integer', minimum: 0, maximum: 100, description: 'Lead temperature 0-100' },
        next_contact_at: { type: 'string', description: 'YYYY-MM-DD' },
        value: { type: 'number', description: 'Estimated deal value (MXN)' },
        notes: { type: 'string', description: 'Markdown notes (max 20000)' },
        lost_reason: { type: 'string', description: 'Required with stage "lost" unless notes explain it' },
        files: { type: 'string', description: 'Archivos folder prefix, e.g. ventas/prospectos/<slug>/' },
        workspace: WS,
      },
      required: ['name'],
    },
  },
  {
    name: 'backoffice_lead_update',
    description: 'Updates a lead (partial: send only the fields to change). Agents cannot set stage "won"; stage "lost" requires lost_reason or notes.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Lead id (L-...)' },
        name: { type: 'string' },
        company: { type: ['string', 'null'] },
        contact: { type: ['string', 'null'] },
        source: { type: 'string', enum: LEAD_SOURCES },
        interest: { type: ['string', 'null'] },
        stage: { type: 'string', enum: ['new', 'contacted', 'qualified', 'proposal', 'lost'] },
        score: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        next_contact_at: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
        value: { type: ['number', 'null'] },
        notes: { type: ['string', 'null'], description: 'Replaces the previous notes' },
        lost_reason: { type: ['string', 'null'] },
        files: { type: ['string', 'null'] },
        workspace: WS,
      },
      required: ['id'],
    },
  },
  {
    name: 'backoffice_lead_list',
    description: 'Lists the leads of the project, optionally filtered by stage and/or a text query (name, company, contact, interest, notes).',
    inputSchema: { type: 'object', properties: { stage: { type: 'string', enum: ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] }, query: { type: 'string' }, workspace: WS } },
  },
  {
    name: 'backoffice_whatsapp_inbox',
    description: 'Lists the WhatsApp chats of the project (people who wrote in), with the last messages, how many inbound messages are unanswered and the lead id. By default only chats with unanswered messages. Read-only.',
    inputSchema: { type: 'object', properties: { only_unanswered: { type: 'boolean', description: 'Default true' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, workspace: WS } },
  },
  {
    name: 'backoffice_whatsapp_draft',
    description: 'Creates a DRAFT reply for a WhatsApp chat that already wrote in (status "draft"). Agents never send: the person reviews and sends it from the web. Text up to 1500 characters; no cold outreach, no groups.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string', description: 'e.g. 5218112345678@c.us (from backoffice_whatsapp_inbox)' }, phone: { type: 'string', description: 'Alternative to chat_id (digits)' }, text: { type: 'string' }, lead_id: { type: 'string' }, workspace: WS }, required: ['text'] },
  },
  {
    name: 'backoffice_overview',
    description:
      'Foto del momento de Back Office: equipos, qué hace cada agente, tareas por estado, lo que espera a la persona y sesiones sueltas. Incluye `roster`: todos los equipos (campo `plugins`) y agentes instalados (descripción corta, in_active_team, working_now, open_tasks) y `not_in_active_team`. Sin `workspace` es el proyecto de la sesión; con un id de proyecto es ese proyecto; con "all" un resumen por proyecto. El Assistant empieza con backoffice_projects.',
    inputSchema: { type: 'object', properties: { workspace: WS_ALL } },
  },
  {
    name: 'backoffice_projects',
    description:
      "Lists ALL projects (workspaces) of the owner: id, name, root folder, teams (active one marked), open / in-review / blocked task counts and agents waiting on the person. Start here when you are the Assistant (one Assistant for every project); then use the project id as `workspace` in the other tools.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'backoffice_roster',
    description:
      'Roster completo de agentes y skills instalados (no sólo los del equipo activo), con la descripción completa. Sin argumentos devuelve todos los equipos; con `plugin` (id del equipo) devuelve ese equipo (agentes + skills); con `agent` devuelve ese agente con su equipo y skills. Un id desconocido da un error claro. Léela antes de recomendar un agente.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin: { type: 'string', description: 'Id del equipo (ej. dev-team); el parámetro conserva el nombre plugin' },
        agent: { type: 'string', description: 'Id del agente (ej. tech-lead)' },
      },
    },
  },
  {
    name: 'backoffice_team_context',
    description:
      'Devuelve el contexto que la persona definió para un agente en el equipo activo de Back Office. Úsala al empezar si no recibiste contexto automáticamente (por ejemplo en Cowork).',
    inputSchema: { type: 'object', properties: { agent: { type: 'string', description: 'Id del agente (ej. cmo)' } }, required: ['agent'] },
  },
  {
    name: 'backoffice_checkin',
    description:
      'Avisa a la oficina en qué estado está un agente (working, waiting, idle, error). Sirve donde los hooks no llegan, como Cowork.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
        status: { type: 'string', enum: ['working', 'waiting', 'idle', 'error'] },
        detail: { type: 'string', description: 'Qué está haciendo, en pocas palabras' },
      },
      required: ['agent'],
    },
  },
  {
    name: 'backoffice_file_write',
    description:
      "Saves a file in this workspace's Back Office storage (no disk path needed; the person sees it in the web). `path` is workspace-relative, e.g. `marketing/acme/facts.md`. Send `content` (utf-8 text) or `content_base64`. Overwrites by default. Max 50 MB.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path, e.g. marketing/acme/facts.md' },
        content: { type: 'string', description: 'utf-8 text content' },
        content_base64: { type: 'string', description: 'Binary content, base64' },
        content_type: { type: 'string', description: 'Optional; inferred from the extension' },
        overwrite: { type: 'boolean', description: 'Default true. false = fail if the file exists' },
        workspace: WS,
      },
      required: ['path'],
    },
  },
  {
    name: 'backoffice_file_read',
    description:
      'Reads a file from this workspace\'s Back Office storage. Returns utf-8 text (encoding "utf-8") or base64 with content_type for binary files. Limit 5 MB; larger files return a clear error.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path' },
        max_bytes: { type: 'integer', description: 'Optional: return only the first N bytes of a text file (truncated=true)' },
        workspace: WS,
      },
      required: ['path'],
    },
  },
  {
    name: 'backoffice_file_list',
    description:
      'Lists folders and files (size, mtime) under a workspace-relative prefix, one level by default. Trash is excluded. Up to 5,000 entries per page (next_cursor).',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Folder path, e.g. marketing/acme. Empty = workspace root' },
        recursive: { type: 'boolean', description: 'List every file below the prefix' },
        cursor: { type: 'string', description: 'next_cursor from a previous page' },
        workspace: WS,
      },
    },
  },
  {
    name: 'backoffice_file_delete',
    description: 'Soft-deletes a file or a whole folder: it moves to trash (nothing is erased). Not visible in listings afterwards.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative file or folder path' } }, required: ['path'] },
  },
  {
    name: 'backoffice_file_move',
    description: 'Moves or renames a file or folder inside the workspace storage. Fails if the destination exists.',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
  {
    name: 'backoffice_issue_report',
    description: 'Prepares a report about Back Office itself (the platform: office web, server, installer, plugins, agents) for its maintainers: a bug or a feature request. Use it when the person says something in Back Office is broken, confusing or missing, or asks to report/suggest something. Saves it locally and returns a prefilled GitHub issue link; give the link to the person, who reviews and submits it (you never submit). Not for problems in the person\'s own business. Never include passwords, tokens, client data or personal info.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'YOUR own agent id, as in your instructions (e.g. `coo` if you are Assistant, `cmo`, `sales-lead`, `cfo`). It is logged as the reporter.' },
        kind: { type: 'string', enum: ['bug', 'feature'], description: 'bug = something fails; feature = an idea or something missing' },
        title: { type: 'string', description: 'Short summary in the person\'s language (max 120)' },
        description: { type: 'string', description: 'What happens or what is needed, and why it matters (max 4000)' },
        steps: { type: 'string', description: 'Bug only: numbered steps to reproduce' },
        expected: { type: 'string', description: 'Bug only: what should happen' },
        actual: { type: 'string', description: 'Bug only: what happens instead, with the exact error text if any' },
      },
      required: ['agent', 'kind', 'title', 'description'],
    },
  },
  {
    name: 'backoffice_artifact_publish',
    description:
      'Publishes an artifact on Back Office Boards (web tab «Boards») so the person can review it (approve or request changes) in the web: anything they must look at and validate, such as a post draft, a quote, a report or a design. The result has `link` (opens the project and this card in the web): give that link to the person. Content: `path` of a workspace file saved with backoffice_file_write (it is copied, so later edits do not change what was reviewed) OR inline {name, content|content_base64, content_type?}. Supported: html, markdown, image, pdf, csv, text. Pass `artifact_id` to add a new version (nothing is overwritten; the old versions stay). Status becomes in_review (request_review=false keeps a draft); with artifact_id and no content it moves a draft to in_review. You can never approve: only the person does. Approving an artifact does not finish its task: still deliver the task with backoffice_task_deliver. `home: true` = the project home shown in the Inicio tab (one per project, workspace scope, no review: it stays a living page the person can comment on).',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'YOUR own agent id (e.g. cmo, sales-lead). Required.' },
        title: { type: 'string', description: 'Short title in the person\'s language (max 200). Required for a new artifact.' },
        scope_type: { type: 'string', enum: ['workspace', 'team', 'agent'], description: 'Board where it lives: the project, your team or your own (default agent). Not with artifact_id.' },
        scope_id: { type: 'string', description: 'Optional. Defaults: agent = you, team = your team in this project, workspace = this project.' },
        path: { type: 'string', description: 'Workspace-relative path of a file written with backoffice_file_write' },
        name: { type: 'string', description: 'File name of inline content (no slashes), e.g. post.md' },
        content: { type: 'string', description: 'utf-8 text of inline content' },
        content_base64: { type: 'string', description: 'Binary inline content (images, pdf), base64' },
        content_type: { type: 'string', description: 'Optional; inferred from the name' },
        description: { type: 'string', description: 'What the person should look at (max 2000)' },
        task_id: { type: 'string', description: 'Optional task this artifact belongs to' },
        artifact_id: { type: 'string', description: 'Existing artifact id (A-...) to add a new version to' },
        note: { type: 'string', description: 'What changed in this version (max 1000)' },
        request_review: { type: 'boolean', description: 'Default true (in_review). false = save as draft' },
        home: { type: 'boolean', description: 'Publish the project home (Inicio tab). Normally the agent in charge of the project builds it; any agent may. Replaces nothing: if the home exists it adds a new version of it (no artifact_id needed), otherwise it creates it. Never reviewed or approved.' },
        workspace: WS,
      },
      required: ['agent'],
    },
  },
  {
    name: 'backoffice_artifact_list',
    description: 'Lists Boards artifacts of the project (latest version, status, comment counts). Filter by scope_type/scope_id and status (draft, in_review, approved, changes_requested). With needs_action=true and `agent` = your id, returns only YOUR artifacts with changes requested or unread comments from the person: check it when you start working. is_home = 1 marks the project home (Inicio tab).',
    inputSchema: {
      type: 'object',
      properties: {
        scope_type: { type: 'string', enum: ['workspace', 'team', 'agent'] },
        scope_id: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'in_review', 'approved', 'changes_requested'] },
        needs_action: { type: 'boolean' },
        agent: { type: 'string', description: 'YOUR own agent id (required with needs_action)' },
        workspace: WS,
      },
    },
  },
  {
    name: 'backoffice_artifact_get',
    description: 'Reads one Boards artifact (is_home = 1 for the project home): its versions (with content_url) and the comment thread, including the person\'s decisions. Pass `agent` = your id: if it is your artifact, the person\'s comments are marked as read.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Artifact id (A-...)' }, agent: { type: 'string', description: 'YOUR own agent id' }, workspace: WS }, required: ['id'] },
  },
  {
    name: 'backoffice_artifact_comment',
    description: 'Adds your comment to a Boards artifact thread (e.g. answer the person\'s question or explain what you changed). It does not change the status; to send a fix publish a new version with backoffice_artifact_publish and artifact_id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Artifact id (A-...)' }, body: { type: 'string', description: 'Comment (max 4000)' }, agent: { type: 'string', description: 'YOUR own agent id' }, workspace: WS }, required: ['id', 'body', 'agent'] },
  },
  {
    name: 'backoffice_profile_read',
    description:
      "Reads the owner's profile (preferred name, about, personal goals, professional goals, current focus, work style) and the latest insights learned about them. Call it at the start of a conversation to adapt your tone and suggestions. Empty fields mean the person has not filled them in yet.",
    inputSchema: { type: 'object', properties: { insights: { type: 'integer', description: 'How many recent insights to return (default 20, max 200)' } } },
  },
  {
    name: 'backoffice_profile_update',
    description:
      "Edits the owner's profile. Partial: send only the fields to change; each one REPLACES the previous text (read first and merge). Use it only with what the person explicitly said or asked you to save. Never store passwords, payment data, health data or other secrets.",
    inputSchema: {
      type: 'object',
      properties: {
        preferred_name: { type: 'string', description: 'How to address the person (max 120 chars)' },
        about: { type: 'string', description: 'Who they are and their business (max 4000)' },
        personal_goals: { type: 'string', description: 'Max 4000' },
        professional_goals: { type: 'string', description: 'Max 4000' },
        current_focus: { type: 'string', description: 'What they are focused on this quarter (max 4000)' },
        work_style: { type: 'string', description: 'How they like to be helped, communication preferences (max 4000)' },
      },
    },
  },
  {
    name: 'backoffice_profile_note',
    description:
      'Records one short insight learned about the owner while talking (a durable preference, goal, context or communication style), so you adapt over time. Max 500 chars, one fact per note. Never record passwords, card or bank numbers, keys, health data or other sensitive information; obvious ones are rejected. Tell the person briefly that you noted it.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The insight, in the language the person speaks' },
        category: { type: 'string', enum: ['preference', 'goal', 'context', 'communication', 'other'] },
      },
      required: ['text'],
    },
  },
]

// El workspace sale de BACKOFFICE_WORKSPACE si está definido; si no, el servidor lo deduce de la carpeta de trabajo (cwd) de esta sesión.
// Así un agente del workspace B nunca ve las tareas ni los equipos del workspace A.
const scopeHeaders = () => (process.env.BACKOFFICE_WORKSPACE ? { 'x-backoffice-workspace': process.env.BACKOFFICE_WORKSPACE } : { 'x-backoffice-cwd': process.cwd() })

// Contexto de una llamada. stdio: este proceso (servidor por BACKOFFICE_PORT, arrancarlo si está apagado, alcance por env/cwd).
// HTTP (/mcp dentro del servidor): `base` = el propio servidor, `scope` = cabeceras de la petición, `agent` = X-BackOffice-Agent.
const STDIO = { base: baseUrl, scope: scopeHeaders, agent: () => process.env.BACKOFFICE_AGENT || null, ensure: true }

// Link that opens an artifact in the web (project + card). The web runs on BACKOFFICE_WEB_PORT (4781 by default).
export const canvasLink = (ws, id) => `http://localhost:${process.env.BACKOFFICE_WEB_PORT || 4781}/canvas?ws=${encodeURIComponent(ws)}&artifact=${encodeURIComponent(id)}`

async function request(ctx, method, path, body, workspace) {
  let r
  try {
    r = await fetch(ctx.base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(workspace ? { 'x-backoffice-workspace': workspace } : ctx.scope()) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(DOWN_MESSAGE) // se apagó después de ensureServer (o no se pudo arrancar)
  }
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* cuerpo no JSON */ }
  // Ruta que este servidor no conoce: el plugin (o la extensión) es más nuevo que la carpeta de Back Office de la persona.
  if (r.status === 404 && json?.error === 'not_found' && !json.message) throw new Error('No encontrado. Si es una herramienta nueva, tu servidor Back Office puede ser de otra versión que el plugin: corre ./bin/backoffice update en tu carpeta de Back Office.')
  if (!r.ok) throw new Error(json?.message || json?.error || `HTTP ${r.status}`)
  return json
}

// Valida el id de proyecto contra el servidor; el error lista los ids válidos.
async function targetWorkspace(api, id) {
  if (id === undefined || id === null || id === '') return undefined
  const list = await api('GET', '/api/workspaces')
  if (!list.some((w) => w.id === String(id))) throw new Error(`Unknown workspace "${id}". Valid project ids: ${list.map((w) => w.id).join(', ')} (see backoffice_projects).`)
  return String(id)
}

// Rename compat (one release): the pre-rename names `agentos_<x>` still work as aliases of `backoffice_<x>`. They are NOT
// listed in tools/list: listing ~25 duplicates would double every agent's tool context and invite the old names, while
// the callers that still use them (agent copies edited before the rename, HTTP MCP clients with old prompts) call by
// name and never need the list. Remove together with env.mjs.
export const LEGACY_TOOL_PREFIX = 'agentos_'
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name))
/** The current name of a tool: `agentos_x` → `backoffice_x` when that tool exists; any other name unchanged. */
export function canonicalTool(name) {
  if (typeof name !== 'string' || !name.startsWith(LEGACY_TOOL_PREFIX)) return name
  const n = 'backoffice_' + name.slice(LEGACY_TOOL_PREFIX.length)
  return TOOL_NAMES.has(n) ? n : name
}

async function callTool(name, a = {}, ctx = STDIO) {
  name = canonicalTool(name)
  if (ctx.ensure && !(await ensureServer())) throw new Error(DOWN_MESSAGE)
  const api = (method, path, body, workspace) => request(ctx, method, path, body, workspace)
  const me = ctx.agent()
  if (name === 'backoffice_projects') return api('GET', '/api/projects')
  if (name === 'backoffice_overview' && a.workspace === 'all') return { projects: await api('GET', '/api/projects'), hint: 'Per-project summary. Call backoffice_overview with a project id as `workspace` for the full detail.' }
  const { workspace, ...args } = a
  const ws = await targetWorkspace(api, workspace)
  a = args
  switch (name) {
    case 'backoffice_task_create':
      return api('POST', '/api/tasks', a, ws)
    case 'backoffice_task_update': {
      const { id, ...patch } = a
      return api('PATCH', `/api/tasks/${id}`, patch, ws)
    }
    case 'backoffice_task_deliver': {
      const { id, ...out } = a
      return api('POST', `/api/tasks/${id}/outputs`, out, ws)
    }
    case 'backoffice_file_write':
      return api('POST', '/api/files/write', a, ws)
    case 'backoffice_file_read':
      return api('GET', `/api/files/read?path=${encodeURIComponent(a.path ?? '')}${a.max_bytes ? `&max_bytes=${encodeURIComponent(a.max_bytes)}` : ''}`, undefined, ws)
    case 'backoffice_file_list':
      return api('GET', `/api/files/list?prefix=${encodeURIComponent(a.prefix ?? '')}${a.recursive ? '&recursive=1' : ''}${a.cursor ? `&cursor=${encodeURIComponent(a.cursor)}` : ''}`, undefined, ws)
    case 'backoffice_file_delete':
      return api('POST', '/api/files/delete', { path: a.path }, ws)
    case 'backoffice_file_move':
      return api('POST', '/api/files/move', { from: a.from, to: a.to }, ws)
    case 'backoffice_task_list': {
      const q = new URLSearchParams()
      for (const k of ['status', 'sprint_id', 'story_id']) if (a[k]) q.set(k, a[k])
      return api('GET', `/api/tasks${q.size ? `?${q}` : ''}`, undefined, ws)
    }
    case 'backoffice_epic_create': case 'backoffice_story_create': case 'backoffice_sprint_create':
    case 'backoffice_epic_list': case 'backoffice_story_list': case 'backoffice_sprint_list':
    case 'backoffice_epic_update': case 'backoffice_story_update': case 'backoffice_sprint_update': {
      const [, kind, op] = name.match(/^backoffice_(epic|story|sprint)_(create|list|update)$/)
      const base = `/api/${kind === 'story' ? 'stories' : kind + 's'}`
      if (op === 'create') return api('POST', base, { ...a, agent: a.owner_agent ? undefined : me || undefined }, ws)
      if (op === 'list') {
        const q = new URLSearchParams()
        for (const k of ['status', 'epic_id', 'sprint_id']) if (a[k]) q.set(k, a[k])
        return api('GET', `${base}${q.size ? `?${q}` : ''}`, undefined, ws)
      }
      const { id, ...patch } = a
      return api('PATCH', `${base}/${encodeURIComponent(id ?? '')}`, patch, ws)
    }
    case 'backoffice_issue_report':
      return api('POST', '/api/issues', { ...a, agent: a.agent || me }, ws)
    case 'backoffice_artifact_publish': {
      const r = await api('POST', '/api/canvas/publish', { ...a, agent: a.agent || me }, ws)
      return r?.id && r.workspace_id ? { ...r, link: canvasLink(r.workspace_id, r.id) } : r
    }
    case 'backoffice_artifact_list': {
      const q = new URLSearchParams()
      for (const k of ['scope_type', 'scope_id', 'status', 'agent']) if (a[k]) q.set(k, a[k])
      if (a.needs_action) q.set('needs_action', 'true')
      return api('GET', `/api/canvas?${q}`, undefined, ws)
    }
    case 'backoffice_artifact_get': {
      const r = await api('GET', `/api/canvas/${encodeURIComponent(a.id ?? '')}${a.agent ? `?agent=${encodeURIComponent(a.agent)}` : ''}`, undefined, ws)
      return { ...r, link: canvasLink(r.workspace_id, r.id), versions: r.versions.map((v) => ({ ...v, content_url: ctx.base + v.url })) }
    }
    case 'backoffice_artifact_comment':
      return api('POST', `/api/canvas/${encodeURIComponent(a.id ?? '')}/comments`, { body: a.body, agent: a.agent }, ws)
    case 'backoffice_lead_create':
      return api('POST', '/api/leads', a, ws)
    case 'backoffice_lead_update': {
      const { id, ...patch } = a
      return api('PATCH', `/api/leads/${id}`, patch, ws)
    }
    case 'backoffice_lead_list':
      return api('GET', `/api/leads?${a.stage ? `stage=${encodeURIComponent(a.stage)}&` : ''}${a.query ? `query=${encodeURIComponent(a.query)}` : ''}`, undefined, ws)
    case 'backoffice_whatsapp_inbox':
      return api('GET', `/api/whatsapp/chats?only_unanswered=${a.only_unanswered === false ? 0 : 1}&recent=5${a.limit ? `&limit=${encodeURIComponent(a.limit)}` : ''}`, undefined, ws)
    case 'backoffice_whatsapp_draft': {
      const d = await api('POST', '/api/whatsapp/drafts', { ...a, created_by: me || 'agent' }, ws)
      return { ...d, note: 'Borrador creado: la persona lo revisa y lo envía desde la web (los agentes no envían).' }
    }
    case 'backoffice_checkin':
      return api('POST', '/api/checkin', a)
    case 'backoffice_overview':
      return api('GET', '/api/overview', undefined, ws)
    case 'backoffice_roster':
      return api('GET', `/api/roster?${a.plugin ? `plugin=${encodeURIComponent(a.plugin)}&` : ''}${a.agent ? `agent=${encodeURIComponent(a.agent)}` : ''}`)
    case 'backoffice_profile_read':
      return api('GET', `/api/profile?insights=${encodeURIComponent(a.insights ?? 20)}`)
    case 'backoffice_profile_update':
      return api('PATCH', '/api/profile', a)
    case 'backoffice_profile_note':
      return api('POST', '/api/profile/insights', { text: a.text, category: a.category, source: 'assistant' })
    case 'backoffice_team_context':
      return api('GET', `/api/context?agent=${encodeURIComponent(a.agent ?? '')}`)
    default:
      throw new Error(`Herramienta desconocida: ${name}`)
  }
}

/** One JSON-RPC message → its response (null for notifications). `ctx` defaults to stdio; the server passes its own for /mcp. */
export async function handle(msg, ctx = STDIO) {
  const { id, method, params } = msg
  if (id === undefined) return null // notificaciones (initialized, cancelled...) no llevan respuesta
  const ok = (result) => ({ jsonrpc: '2.0', id, result })
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'backoffice', version: '0.1.0' },
      })
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: TOOLS })
    case 'tools/call':
      try {
        const out = await callTool(params?.name, params?.arguments, ctx)
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] })
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: e.message }] })
      }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Método no soportado: ${method}` } }
  }
}

export function runStdio() {
  const rl = createInterface({ input: process.stdin })
  rl.on('line', async (line) => {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    const res = await handle(msg)
    if (res) process.stdout.write(JSON.stringify(res) + '\n')
  })
}

if (isMain(import.meta.url)) runStdio()
