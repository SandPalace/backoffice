// Pure helpers for the agile views (Tareas filters and the Plan view). No React, no fetch: unit-tested in agile.test.ts.
import type { Sprint, Story, Task, TaskStatus } from './types'

/** Sprint filter value: 'all', 'none' (tasks without a sprint) or a sprint id. */
export type SprintFilter = string
export const ALL = 'all'
export const NONE = 'none'

/** Default sprint filter: the active sprint if there is one, otherwise everything. */
export const defaultSprintFilter = (sprints: Pick<Sprint, 'id' | 'status'>[]): SprintFilter => sprints.find((s) => s.status === 'active')?.id ?? ALL

/** Tasks visible with the sprint and epic filters (epic: 'all' or an epic id, matched through the task's story). */
export function filterTasks<T extends Pick<Task, 'sprint_id' | 'story_id'>>(tasks: T[], stories: Pick<Story, 'id' | 'epic_id'>[], sprint: SprintFilter, epic: string): T[] {
  const epicOf = new Map(stories.map((s) => [s.id, s.epic_id]))
  return tasks.filter((t) => {
    if (sprint === NONE ? t.sprint_id : sprint !== ALL && t.sprint_id !== sprint) return false
    if (epic !== ALL && (!t.story_id || epicOf.get(t.story_id) !== epic)) return false
    return true
  })
}

/** Progress of a set of tasks: cancelled ones do not count; percent = done / (total - cancelled). */
export function progress(tasks: Pick<Task, 'status'>[]) {
  const by = {} as Record<TaskStatus, number>
  for (const t of tasks) by[t.status] = (by[t.status] ?? 0) + 1
  const total = tasks.length - (by.cancelled ?? 0)
  const done = by.done ?? 0
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0, by }
}

const SPRINT_ORDER: Record<Sprint['status'], number> = { active: 0, review: 1, planning: 2, completed: 3 }
/** Active first, then in review, planned (by start date), completed last (most recent first). */
export const sortSprints = <S extends Pick<Sprint, 'status' | 'start_date' | 'created_at'>>(list: S[]): S[] =>
  [...list].sort((a, b) => SPRINT_ORDER[a.status] - SPRINT_ORDER[b.status] ||
    (a.status === 'completed' ? (b.start_date ?? '').localeCompare(a.start_date ?? '') : (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999')) ||
    a.created_at - b.created_at)
