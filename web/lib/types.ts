export type SessionStatus = 'idle' | 'working' | 'waiting' | 'error' | 'offline'

export interface Session {
  id: string
  cwd: string | null
  project: string | null
  agent: string | null
  status: SessionStatus
  tool: string | null
  detail: string | null
  subagents: number
  started_at: number
  last_event_at: number
  ended_at: number | null
}

export type TaskStatus = 'backlog' | 'todo' | 'doing' | 'blocked' | 'review' | 'done' | 'cancelled'
export type OutputKind = 'file' | 'folder' | 'report' | 'image' | 'markdown' | 'artifact' | 'link'

export interface Output {
  id: number
  task_id: string
  /** Disk path; null for virtual deliveries that live only in workspace storage. */
  path: string | null
  virtual?: boolean
  kind: OutputKind
  title: string | null
  exists: boolean
  workspace_id?: string
  bucket?: string | null
  storage_key?: string | null
  size?: number | null
  content_type?: string | null
  uploaded_at?: number | null
  storage_error?: string | null
  stored?: boolean
}

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  agent: string | null
  output_dir: string | null
  output_dir_exists: boolean | null
  outputs: Output[]
  /** Agile links (null = backlog pool / no story) */
  story_id?: string | null
  sprint_id?: string | null
  /** An agent proposed cancelling it (reason); the task waits in review for the person */
  cancel_proposal?: string | null
  created_at: number
  updated_at: number
}

export type EpicStatus = 'planning' | 'active' | 'done' | 'cancelled'
export type StoryStatus = 'backlog' | 'todo' | 'doing' | 'review' | 'done' | 'cancelled'
export type SprintStatus = 'planning' | 'active' | 'review' | 'completed'

export interface Epic {
  id: string
  workspace_id: string
  title: string
  description: string | null
  status: EpicStatus
  owner_agent: string | null
  created_at: number
  updated_at: number
}

export interface Story {
  id: string
  workspace_id: string
  epic_id: string | null
  sprint_id: string | null
  title: string
  description: string | null
  status: StoryStatus
  points: number | null
  owner_agent: string | null
  created_at: number
  updated_at: number
}

export interface Sprint {
  id: string
  workspace_id: string
  name: string
  goal: string | null
  start_date: string | null
  end_date: string | null
  status: SprintStatus
  report: string | null
  completed_at: number | null
  created_at: number
  updated_at: number
}

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost'
export type LeadSource = 'whatsapp' | 'instagram' | 'facebook' | 'meta_form' | 'email' | 'web' | 'referral' | 'other'

export interface Lead {
  id: string
  workspace_id: string
  name: string
  company: string | null
  contact: string | null
  source: LeadSource
  interest: string | null
  stage: LeadStage
  score: number | null
  /** YYYY-MM-DD */
  next_contact_at: string | null
  value: number | null
  notes: string | null
  lost_reason: string | null
  /** Archivos folder prefix, e.g. ventas/prospectos/<slug>/ */
  files: string | null
  agent: string | null
  position: number
  created_at: number
  updated_at: number
}

export interface TeamMember {
  agent_id: string
  display_name: string
  avatar: number | null
  context: string
  /** Conversación existente en Claude: enlace o id de sesión (opcional). */
  session_ref: string | null
}

export interface Team {
  id: string
  name: string
  members: TeamMember[]
}

export interface SystemAgent {
  agent_id: string
  display_name: string
  avatar: number | null
  context: string
  /** Conversación existente en Claude: enlace o id de sesión (opcional). */
  session_ref: string | null
}

export interface Workspace {
  id: string
  name: string
  root: string
  bucket: string
  counts: { tasks: number; tasks_open: number; teams: number; outputs: number; sessions_active: number }
}

export interface ImportState { running: boolean; workspace: string | null; total: number; imported: number; skipped_existing: number; skipped_other: number; failed: number; bytes: number; started_at: number | null; finished_at: number | null; errors: unknown[]; capped: boolean }

export interface StorageStatus {
  /** The built-in local store is the only backend. */
  backend: 'local'
  /** Folder of the store on this computer (what to copy for a backup). */
  root?: string
  usage?: { files: number; bytes: number }
  import?: ImportState
  limits?: { max_file_bytes: number; max_read_bytes: number; max_list_page: number }
}

export interface FilesEvent { workspace_id?: string; op: 'put' | 'delete' | 'move' | 'folder' | 'import'; key?: string; from?: string; to?: string; count?: number }

export interface OutputFile {
  rel: string
  size: number
  content_type: string
  stored: boolean
}

export interface OutputFiles {
  kind: OutputKind
  stored: boolean
  storage_error: string | null
  files: OutputFile[]
  skipped: { rel: string; reason: string }[]
}

// ── WhatsApp (open-wa) ──
export interface WaMessage { id: string; workspace_id: string; chat_id: string; phone: string | null; name: string | null; direction: 'in' | 'out'; body: string | null; type: string | null; ts: number; lead_id: string | null }
export interface WaDraft { id: string; workspace_id: string; chat_id: string; phone: string | null; lead_id: string | null; text: string; status: 'draft' | 'sent' | 'discarded' | 'failed'; error: string | null; created_by: string | null; created_at: number; sent_at: number | null }
export interface WaChat { chat_id: string; phone: string | null; name: string | null; lead_id: string | null; last_message: { direction: 'in' | 'out'; body: string | null; type: string | null; ts: number }; unanswered: number; pending_drafts: number }
export interface WaStatus { configured: boolean; connected: boolean; workspace: string; limits: { max_per_hour: number; max_per_day: number; max_text_length: number }; sent_last_hour: number }

// ── Canvas: artefactos que los agentes publican para que la persona los revise ──
export type ArtifactStatus = 'draft' | 'in_review' | 'approved' | 'changes_requested'
export type ArtifactScope = 'workspace' | 'team' | 'agent'
export type ArtifactKind = 'html' | 'markdown' | 'image' | 'pdf' | 'csv' | 'text'
export interface Artifact {
  id: string
  workspace_id: string
  scope_type: ArtifactScope
  scope_id: string
  title: string
  description: string | null
  kind: ArtifactKind
  status: ArtifactStatus
  author_agent: string | null
  task_id: string | null
  current_version: number
  created_at: number
  updated_at: number
  /** Latest version */
  content_type: string | null
  size: number | null
  version_at: number | null
  comments: number
  /** Comments of the person the author agent has not read yet */
  unread_human: number
  /** 1 = the project home (Inicio tab): one per workspace, built by the Assistant, never reviewed */
  is_home: number
}
/** GET /api/workspaces/:id/canvas/home (null when the Assistant has not built it yet) */
export interface HomeArtifact extends Artifact { url: string; version_note: string | null; version_author: string | null }
export interface ArtifactVersion { n: number; content_type: string; size: number; note: string | null; author: string | null; created_at: number; url: string }
export interface ArtifactComment { id: number; version_n: number | null; author: string; body: string; decision: 'approved' | 'changes_requested' | null; read_by_agent: number; created_at: number }
export interface ArtifactDetail extends Omit<Artifact, 'comments'> { versions: ArtifactVersion[]; comments: ArtifactComment[]; task: { id: string; title: string; status: TaskStatus } | null }
