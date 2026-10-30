import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ALL, NONE, defaultSprintFilter, filterTasks, progress, sortSprints } from './agile.ts'

test('default sprint filter: the active sprint, else all', () => {
  assert.equal(defaultSprintFilter([{ id: 'a', status: 'planning' }, { id: 'b', status: 'active' }]), 'b')
  assert.equal(defaultSprintFilter([{ id: 'a', status: 'completed' }]), ALL)
  assert.equal(defaultSprintFilter([]), ALL)
})

test('filterTasks by sprint (all / none / id) and by epic through the story', () => {
  const stories = [{ id: 's1', epic_id: 'e1' }, { id: 's2', epic_id: null }]
  const tasks = [
    { id: 1, sprint_id: 'x', story_id: 's1' },
    { id: 2, sprint_id: null, story_id: 's2' },
    { id: 3, sprint_id: 'x', story_id: null },
  ]
  const ids = (l: { id: number }[]) => l.map((t) => t.id)
  assert.deepEqual(ids(filterTasks(tasks, stories, ALL, ALL)), [1, 2, 3])
  assert.deepEqual(ids(filterTasks(tasks, stories, 'x', ALL)), [1, 3])
  assert.deepEqual(ids(filterTasks(tasks, stories, NONE, ALL)), [2])
  assert.deepEqual(ids(filterTasks(tasks, stories, ALL, 'e1')), [1])
  assert.deepEqual(ids(filterTasks(tasks, stories, NONE, 'e1')), [])
})

test('progress ignores cancelled tasks', () => {
  const p = progress([{ status: 'done' }, { status: 'doing' }, { status: 'cancelled' }, { status: 'done' }])
  assert.equal(p.total, 3)
  assert.equal(p.done, 2)
  assert.equal(p.percent, 67)
  assert.equal(progress([]).percent, 0)
})

test('sortSprints: active, review, planning by start date, completed last', () => {
  const s = (id: string, status: any, start_date: string | null) => ({ id, status, start_date, created_at: 0 })
  const out = sortSprints([s('c', 'completed', '2026-10-01'), s('p2', 'planning', '2026-12-01'), s('p1', 'planning', '2026-11-15'), s('a', 'active', '2026-11-01'), s('r', 'review', null)])
  assert.deepEqual(out.map((x) => x.id), ['a', 'r', 'p1', 'p2', 'c'])
})
