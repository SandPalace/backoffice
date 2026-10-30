import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { backofficeHome, backofficeRoot, defaultWorkspaceRoot } from './paths.mjs'

export const DB_FILE = 'backoffice.db'
export const LEGACY_DB_FILE = 'agentos.db' // its name before the AgentOS → Back Office rename
/**
 * The database file in `home`: backoffice.db, or an existing agentos.db while there is no backoffice.db yet (an install
 * not migrated yet keeps working; scripts/migrate-backoffice.mjs renames it with the server stopped).
 */
export function dbFileIn(home) {
  const f = join(home, DB_FILE), old = join(home, LEGACY_DB_FILE)
  return !existsSync(f) && existsSync(old) ? old : f
}
export const defaultDbPath = () => process.env.BACKOFFICE_DB || dbFileIn(backofficeHome())

// Carpetas de trabajo (<proyecto>/workspaces; antes ~/AgentOS); contiene `default` y los demás workspaces.
export const defaultRoot = () => backofficeRoot()

const hasCol = (db, table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)
const addCol = (db, table, col, def) => { if (!hasCol(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`) }

// Cada entrada es SQL o una función (db) => void. Se ejecutan una vez, en orden; sólo se agregan al final.
export const MIGRATIONS = [
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     cwd TEXT, project TEXT,
     agent TEXT,
     status TEXT NOT NULL DEFAULT 'idle',   -- idle | working | waiting | error | offline
     tool TEXT, detail TEXT,
     subagents INTEGER NOT NULL DEFAULT 0,
     started_at INTEGER NOT NULL,
     last_event_at INTEGER NOT NULL,
     ended_at INTEGER
   );
   CREATE TABLE events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     session_id TEXT,
     event TEXT NOT NULL,
     tool TEXT,
     payload TEXT
   );
   CREATE INDEX events_session ON events(session_id, id);
   CREATE TABLE tasks (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     description TEXT,
     status TEXT NOT NULL DEFAULT 'todo',   -- todo | doing | blocked | review | done
     agent TEXT, session_id TEXT,
     output_dir TEXT,                       -- carpeta donde quedó el entregable
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE outputs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id TEXT REFERENCES tasks(id),
     session_id TEXT,
     path TEXT NOT NULL,                    -- ruta absoluta del archivo o carpeta
     kind TEXT NOT NULL DEFAULT 'file',     -- file | folder | report | image | markdown | artifact | link
     title TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX outputs_task ON outputs(task_id);`,
  `CREATE TABLE teams (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 0,     -- sólo un equipo activo a la vez
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE team_members (
     team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
     agent_id TEXT NOT NULL,                -- id del agente en el roster (ej. cmo)
     context TEXT NOT NULL DEFAULT '',      -- contexto que se adjunta a la conversación de ese agente
     position INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (team_id, agent_id)
   );`,
  `ALTER TABLE team_members ADD COLUMN display_name TEXT NOT NULL DEFAULT '';`, // nombre propio del agente en ese equipo
  `ALTER TABLE team_members ADD COLUMN avatar INTEGER;`, // cara de voxel (0-20); NULL = la del roster
  `CREATE TABLE system_agents (
     agent_id TEXT PRIMARY KEY,             -- agentes que existen siempre, fuera de los equipos (hoy sólo 'coo')
     display_name TEXT NOT NULL DEFAULT '',
     avatar INTEGER,                        -- cara de voxel (0-20); NULL = la del roster
     context TEXT NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL
   );
   INSERT INTO system_agents (agent_id, updated_at) VALUES ('coo', 0);`,
  // 5 · Workspaces (cuentas/proyectos). Todo lo existente queda en `default`.
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       root TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       archived_at INTEGER
     )`)
    const ts = Date.now()
    db.prepare(`INSERT OR IGNORE INTO workspaces (id, name, root, created_at, updated_at) VALUES ('default', 'Default', ?, ?, ?)`).run(defaultWorkspaceRoot(), ts, ts)
  },
  // 6 · workspace_id en sesiones, tareas, entregables, equipos y eventos; COO por workspace.
  (db) => {
    for (const t of ['sessions', 'tasks', 'outputs', 'teams', 'events']) {
      addCol(db, t, 'workspace_id', "TEXT NOT NULL DEFAULT 'default'")
      db.exec(`CREATE INDEX IF NOT EXISTS ${t}_workspace ON ${t}(workspace_id)`)
    }
    // El COO se configura por workspace. Un workspace sin fila propia usa valores en blanco (no hereda el contexto de otro).
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_agents (
       workspace_id TEXT NOT NULL REFERENCES workspaces(id),
       agent_id TEXT NOT NULL,
       display_name TEXT NOT NULL DEFAULT '',
       avatar INTEGER,
       context TEXT NOT NULL DEFAULT '',
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (workspace_id, agent_id)
     )`)
    db.exec(`INSERT OR IGNORE INTO workspace_agents (workspace_id, agent_id, display_name, avatar, context, updated_at)
             SELECT 'default', agent_id, display_name, avatar, context, updated_at FROM system_agents`)
  },
  // 7 · Archivos en el almacenamiento interno (carpeta local ~/.agentos/store). `bucket` = carpeta del workspace (ws-<id>);
  //     `uploaded_at` y `storage_error` son campos históricos de la época S3: ya no se escriben a propósito.
  (db) => {
    addCol(db, 'outputs', 'bucket', 'TEXT')
    addCol(db, 'outputs', 'storage_key', 'TEXT')   // archivo: clave del objeto; carpeta: prefijo (termina en /)
    addCol(db, 'outputs', 'size', 'INTEGER')
    addCol(db, 'outputs', 'content_type', 'TEXT')
    addCol(db, 'outputs', 'sha256', 'TEXT')
    addCol(db, 'outputs', 'uploaded_at', 'INTEGER')
    addCol(db, 'outputs', 'storage_error', 'TEXT')
    addCol(db, 'outputs', 'files', 'TEXT')         // carpeta: JSON {files:[{rel,key,size,content_type,sha256}], skipped:[{rel,reason}]}
  },
  // 8: ids de agentes en inglés (los agentes y skills se tradujeron). Renombra en las tablas que guardan el id.
  (db) => {
    const MAP = {
      'lider-tecnico': 'tech-lead',
      'disenador-frontend': 'frontend-designer',
      'ingeniero-frontend': 'frontend-engineer',
      'ingeniero-backend': 'backend-engineer',
      'qa-web': 'web-qa',
      'jefe-de-ventas': 'sales-lead',
      'calificador': 'lead-qualifier',
      'propuestas': 'proposal-writer',
      'seguimiento': 'follow-up',
      'jefe-de-cobranza': 'collections-lead',
      'analista-de-cartera': 'portfolio-analyst',
      'gestor-de-cobro': 'collections-agent',
      'conciliador': 'reconciler',
      'investigador': 'researcher',
      'creativo': 'creative',
      'analista': 'analyst',
      'desarrollador-web': 'frontend-engineer',
    }
    const upd = (table, col) => {
      for (const [from, to] of Object.entries(MAP)) {
        if (table === 'team_members') {
          // (team_id, agent_id) es clave primaria: si el nuevo ya existe en ese equipo, se descarta el viejo
          db.prepare(`DELETE FROM team_members WHERE agent_id = ? AND team_id IN (SELECT team_id FROM team_members WHERE agent_id = ?)`).run(from, to)
        }
        db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).run(to, from)
      }
    }
    upd('team_members', 'agent_id')
    upd('sessions', 'agent')
    upd('tasks', 'agent')
  },
  // 9 · Ajustes del servidor (preferencia de almacenamiento, importaciones únicas...). Clave/valor en JSON.
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  // 10 · Sesiones de la web (autenticación local). Sólo se guarda el hash del token y una huella de las credenciales con las que se abrió
  //      (si el usuario cambia su contraseña en el .env, las sesiones viejas dejan de valer).
  `CREATE TABLE IF NOT EXISTS auth_sessions (
     token_hash TEXT PRIMARY KEY,
     fp TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );`,
  // 11 · Perfil de la persona (global por instalación, una sola fila) y lo que el Assistant va aprendiendo de ella.
  `CREATE TABLE IF NOT EXISTS user_profile (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     preferred_name TEXT NOT NULL DEFAULT '',
     about TEXT NOT NULL DEFAULT '',
     personal_goals TEXT NOT NULL DEFAULT '',
     professional_goals TEXT NOT NULL DEFAULT '',
     current_focus TEXT NOT NULL DEFAULT '',
     work_style TEXT NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL DEFAULT 0
   );
   INSERT OR IGNORE INTO user_profile (id) VALUES (1);
   CREATE TABLE IF NOT EXISTS profile_insights (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     text TEXT NOT NULL,
     category TEXT NOT NULL,
     source TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );`,
  `ALTER TABLE team_members ADD COLUMN session_ref TEXT; ALTER TABLE workspace_agents ADD COLUMN session_ref TEXT;`, // conversación existente de Claude (enlace o id)
  // · El proyecto por defecto se llama «Back Office» (existe desde el principio). Sólo cambia el nombre de fábrica «Default»;
  //   si la persona ya le puso otro, se respeta.
  `UPDATE workspaces SET name = 'Back Office' WHERE id = 'default' AND name = 'Default';`,
  // 12 · Leads (prospectos): entidad propia con su Kanban, separada de las tareas.
  `CREATE TABLE IF NOT EXISTS leads (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL DEFAULT 'default',
     name TEXT NOT NULL,
     company TEXT,
     contact TEXT,
     source TEXT NOT NULL DEFAULT 'other',
     interest TEXT,
     stage TEXT NOT NULL DEFAULT 'new',
     score INTEGER,
     next_contact_at TEXT,
     value REAL,
     notes TEXT,
     lost_reason TEXT,
     files TEXT,
     agent TEXT,
     position REAL NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS leads_workspace ON leads(workspace_id, stage);`,
  // 13 · WhatsApp (open-wa): mensajes y borradores. Los agentes sólo crean borradores; la persona envía.
  `CREATE TABLE IF NOT EXISTS wa_messages (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL DEFAULT 'default',
     chat_id TEXT NOT NULL,
     phone TEXT,
     name TEXT,
     direction TEXT NOT NULL,
     body TEXT,
     type TEXT,
     ts INTEGER NOT NULL,
     lead_id TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS wa_messages_chat ON wa_messages(workspace_id, chat_id, ts);
   CREATE TABLE IF NOT EXISTS wa_drafts (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL DEFAULT 'default',
     chat_id TEXT NOT NULL,
     phone TEXT,
     lead_id TEXT,
     text TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'draft',
     error TEXT,
     created_by TEXT,
     created_at INTEGER NOT NULL,
     sent_at INTEGER,
     sent_message_id TEXT
   );
   CREATE INDEX IF NOT EXISTS wa_drafts_ws ON wa_drafts(workspace_id, status, created_at);`,
  // · Limpieza del botón «Simular actividad» (eliminado): sus check-ins dejaban agentes en la oficina que no eran de ningún
  //   equipo y no se podían borrar, más una tarea de ejemplo. Solo borra lo que tiene exactamente los textos del demo.
  `DELETE FROM events WHERE session_id IN (SELECT id FROM sessions WHERE id LIKE 'mcp:%' AND (
     (agent = 'cmo' AND detail = 'Coordinando el periodo') OR (agent = 'researcher' AND detail = 'WebSearch: precios de renta en San Nicolás')
     OR (agent = 'creative' AND detail = 'Necesita tu firma en el copy') OR (agent = 'analyst' AND detail = 'Listo')
     OR id IN ('mcp:investigador', 'mcp:creativo', 'mcp:analista')));
   DELETE FROM sessions WHERE id LIKE 'mcp:%' AND (
     (agent = 'cmo' AND detail = 'Coordinando el periodo') OR (agent = 'researcher' AND detail = 'WebSearch: precios de renta en San Nicolás')
     OR (agent = 'creative' AND detail = 'Necesita tu firma en el copy') OR (agent = 'analyst' AND detail = 'Listo')
     OR id IN ('mcp:investigador', 'mcp:creativo', 'mcp:analista'));
   DELETE FROM outputs WHERE task_id IN (SELECT id FROM tasks WHERE title = 'Reporte de leads de la semana (demo)');
   DELETE FROM tasks WHERE title = 'Reporte de leads de la semana (demo)';`,
  // · Reportes de la plataforma (bugs e ideas) que los agentes preparan con backoffice_issue_report; la persona los envía a GitHub.
  `CREATE TABLE IF NOT EXISTS issue_reports (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     workspace_id TEXT NOT NULL DEFAULT 'default',
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     url TEXT NOT NULL,
     agent TEXT,
     created_at INTEGER NOT NULL
   );`,
  // · Canvas: artefactos que los agentes publican para que la persona los revise. Cada versión es un objeto nuevo en el
  //   almacenamiento (nada se sobrescribe); los comentarios guardan la decisión de la persona (approved | changes_requested).
  `CREATE TABLE IF NOT EXISTS artifacts (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL DEFAULT 'default',
     scope_type TEXT NOT NULL,              -- workspace | team | agent
     scope_id TEXT NOT NULL,
     title TEXT NOT NULL,
     description TEXT,
     kind TEXT NOT NULL,                    -- html | markdown | image | pdf | csv | text (el de la última versión)
     status TEXT NOT NULL DEFAULT 'draft',  -- draft | in_review | approved | changes_requested
     author_agent TEXT,
     task_id TEXT,
     current_version INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS artifacts_ws ON artifacts(workspace_id, scope_type, scope_id, updated_at);
   CREATE TABLE IF NOT EXISTS artifact_versions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
     n INTEGER NOT NULL,
     storage_key TEXT NOT NULL,
     content_type TEXT NOT NULL,
     size INTEGER NOT NULL,
     note TEXT,
     author TEXT,
     created_at INTEGER NOT NULL,
     UNIQUE (artifact_id, n)
   );
   CREATE TABLE IF NOT EXISTS artifact_comments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
     version_n INTEGER,
     author TEXT NOT NULL,                  -- 'humano' o el id del agente
     body TEXT NOT NULL,
     decision TEXT,                         -- approved | changes_requested (sólo la persona)
     read_by_agent INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS artifact_comments_a ON artifact_comments(artifact_id, id);`,
  // · Inicio del proyecto: a lo más UN artefacto «home» por workspace (alcance workspace), lo arma y versiona el encargado del proyecto o cualquier agente.
  (db) => {
    addCol(db, 'artifacts', 'is_home', 'INTEGER NOT NULL DEFAULT 0')
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS artifacts_home ON artifacts(workspace_id) WHERE is_home = 1')
  },
  // · AgentOS → Back Office: the default project keeps the product's name unless the person renamed it.
  `UPDATE workspaces SET name = 'Back Office' WHERE id = 'default' AND name = 'AgentOS';`,
  // · Agile: epics → stories → tasks, and sprints. Task statuses gain backlog and cancelled (TEXT, no CHECK: nothing to migrate).
  //   Only the person closes things (done / cancelled / completed); agents propose cancelling a task with `cancel_proposal`.
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS epics (
       id TEXT PRIMARY KEY,
       workspace_id TEXT NOT NULL DEFAULT 'default',
       title TEXT NOT NULL,
       description TEXT,
       status TEXT NOT NULL DEFAULT 'planning', -- planning | active | done | cancelled
       owner_agent TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS epics_ws ON epics(workspace_id, status);
     CREATE TABLE IF NOT EXISTS sprints (
       id TEXT PRIMARY KEY,
       workspace_id TEXT NOT NULL DEFAULT 'default',
       name TEXT NOT NULL,
       goal TEXT,
       start_date TEXT,                         -- YYYY-MM-DD
       end_date TEXT,
       status TEXT NOT NULL DEFAULT 'planning', -- planning | active | review | completed
       report TEXT,
       completed_at INTEGER,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS sprints_ws ON sprints(workspace_id, status);
     CREATE UNIQUE INDEX IF NOT EXISTS sprints_one_active ON sprints(workspace_id) WHERE status = 'active';
     CREATE TABLE IF NOT EXISTS stories (
       id TEXT PRIMARY KEY,
       workspace_id TEXT NOT NULL DEFAULT 'default',
       epic_id TEXT,
       sprint_id TEXT,
       title TEXT NOT NULL,
       description TEXT,                        -- user story + acceptance criteria
       status TEXT NOT NULL DEFAULT 'backlog',  -- backlog | todo | doing | review | done | cancelled
       points INTEGER,
       owner_agent TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS stories_ws ON stories(workspace_id, status);
     CREATE INDEX IF NOT EXISTS stories_epic ON stories(epic_id);
     CREATE INDEX IF NOT EXISTS stories_sprint ON stories(sprint_id);`)
    addCol(db, 'tasks', 'story_id', 'TEXT')
    addCol(db, 'tasks', 'sprint_id', 'TEXT')
    addCol(db, 'tasks', 'cancel_proposal', 'TEXT')
    db.exec('CREATE INDEX IF NOT EXISTS tasks_story ON tasks(story_id); CREATE INDEX IF NOT EXISTS tasks_sprint ON tasks(sprint_id);')
  },
]

export function openDb(path = defaultDbPath()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (n INTEGER PRIMARY KEY)')
  const done = new Set(db.prepare('SELECT n FROM _migrations').all().map((r) => r.n))
  MIGRATIONS.forEach((sql, n) => {
    if (done.has(n)) return
    db.exec('BEGIN')
    try {
      if (typeof sql === 'function') sql(db)
      else db.exec(sql)
      db.prepare('INSERT INTO _migrations (n) VALUES (?)').run(n)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  })
  return db
}
