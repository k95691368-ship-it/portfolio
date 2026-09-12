import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { onRequestGet as list } from '../server/api/posting-drafts/index.js'
import { onRequestGet as get, onRequestPut as save } from '../server/api/posting-drafts/[id].js'
import { onRequestPost as publish } from '../server/api/postings/index.js'
import { onRequestGet as publicList } from '../server/api/jobs/index.js'
import { onRequestGet as publicGet } from '../server/api/jobs/[id]/index.js'
import { EXAMPLE_POSTING } from '../shared/jobPostingTemplate.js'

const migration = readFileSync(new URL('../supabase/migrations/202609120002_posting_drafts.sql', import.meta.url), 'utf8')
const id = 'd60aa272-4c7e-4d3c-8e59-5ef1b06f994b'
const author = { id: 'author', is_recruiter: 1 }
const otherAdmin = { id: 'other', is_admin: 1, is_developer: 1 }
let sql, env
function context(user = author, body, draftId = id) {
  return { env, data: { user }, params: { id: draftId },
    request: new Request('https://test.invalid', { method: 'POST', body: JSON.stringify(body ?? {}) }) }
}
beforeEach(() => {
  sql = new DatabaseSync(':memory:')
  sql.exec(`CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('author'),('other');
    CREATE TABLE job_postings (id TEXT PRIMARY KEY, created_by_user_id TEXT, title TEXT, department TEXT,
      employment_type TEXT, location TEXT, description TEXT NOT NULL, deadline TEXT,
      wage_type TEXT, wage_min REAL, wage_max REAL, work_hours_start TEXT, work_hours_end TEXT, work_days TEXT,
      status TEXT DEFAULT 'open', created_at TEXT DEFAULT CURRENT_TIMESTAMP);`)
  sql.exec(migration.replaceAll('public.', '').replace(/ALTER TABLE[^;]+;/g, '').replace(/REVOKE[^;]+;/g, ''))
  const DB = { prepare(query) {
    let values = []
    const st = { bind(...v) { values = v; return st },
      async first() { return sql.prepare(query).get(...values) ?? null },
      async all() { return { results: sql.prepare(query).all(...values) } },
      async run() { const r = sql.prepare(query).run(...values); return { meta: { changes: Number(r.changes) } } },
    }; return st
  }, async batch(statements) {
    sql.exec('BEGIN')
    try { const results = []; for (const st of statements) results.push(await st.run()); sql.exec('COMMIT'); return results }
    catch (err) { sql.exec('ROLLBACK'); throw err }
  } }
  env = { DB }
})
afterEach(() => sql.close())

describe('private posting drafts — real SQL handler execution (local SQLite)', () => {
  it('saves incomplete fields and emoji without publishing; reload preserves all fields', async () => {
    const fields = { ...EXAMPLE_POSTING, title: '', wageMin: '입력 중', deadline: '', description: '📋 초안\n  공백 보존' }
    expect((await save(context(author, { fields, revision: 0 }))).status).toBe(200)
    const restored = (await (await get(context())).json()).draft
    expect(restored.fields).toEqual(fields)
    expect(restored.revision).toBe(1)
    expect((await (await list(context())).json()).drafts).toHaveLength(1)
    expect((await (await publicList({ env })).json()).postings).toHaveLength(0)
    expect((await publicGet(context())).status).toBe(404)
  })
  it('blocks read, list, overwrite and publication by a different administrator', async () => {
    await save(context(author, { fields: EXAMPLE_POSTING, revision: 0 }))
    expect((await (await list(context(otherAdmin))).json()).drafts).toHaveLength(0)
    expect((await get(context(otherAdmin))).status).toBe(404)
    expect((await save(context(otherAdmin, { fields: { title: 'stolen' }, revision: 1 }))).status).toBe(409)
    expect((await save(context(otherAdmin, { fields: EXAMPLE_POSTING, revision: 0 }))).status).toBe(409)
    expect((await publish(context(otherAdmin, { ...EXAMPLE_POSTING, draftId: id, draftRevision: 1 }))).status).toBe(409)
    expect(sql.prepare('SELECT count(*) AS n FROM job_postings').get().n).toBe(0)
  })
  it.each([null, { id: 'author', role: 'candidate' }])('denies missing or insufficient authorization', async user => {
    for (const handler of [list, get, save]) expect((await handler(context(user, { fields: {}, revision: 0 }))).status).toBe(user ? 403 : 401)
  })
  it('retains exactly one record on a retry and rejects stale edits', async () => {
    const initial = { fields: EXAMPLE_POSTING, revision: 0 }
    await save(context(author, initial))
    expect((await save(context(author, initial))).status).toBe(200)
    expect(sql.prepare('SELECT count(*) AS n FROM posting_drafts').get().n).toBe(1)
    expect((await save(context(author, { fields: { title: '새 내용' }, revision: 1 }))).status).toBe(200)
    expect((await save(context(author, { fields: { title: '오래된 창' }, revision: 1 }))).status).toBe(409)
    expect((await (await get(context())).json()).draft.fields.title).toBe('새 내용')
  })
  it('validates publication, claims once, and removes published drafts from the draft list', async () => {
    await save(context(author, { fields: EXAMPLE_POSTING, revision: 0 }))
    expect((await publish(context(author, { ...EXAMPLE_POSTING, title: '', draftId: id, draftRevision: 1 }))).status).toBe(400)
    expect((await (await list(context())).json()).drafts).toHaveLength(1)
    const body = { ...EXAMPLE_POSTING, draftId: id, draftRevision: 1 }
    expect((await publish(context(author, body))).status).toBe(201)
    expect((await publish(context(author, body))).status).toBe(409)
    expect((await get(context())).status).toBe(404)
    expect((await (await list(context())).json()).drafts).toHaveLength(0)
    expect((await (await publicList({ env })).json()).postings).toHaveLength(1)
    expect(sql.prepare('SELECT description FROM job_postings').get().description).toBe(EXAMPLE_POSTING.description)
    expect((await save(context(author, { fields: EXAMPLE_POSTING, revision: 2 }))).status).toBe(409)
  })
  it('rolls the draft claim back when the posting insert fails', async () => {
    await save(context(author, { fields: EXAMPLE_POSTING, revision: 0 }))
    sql.exec("CREATE TRIGGER fail_post BEFORE INSERT ON job_postings BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    await expect(publish(context(author, { ...EXAMPLE_POSTING, draftId: id, draftRevision: 1 }))).rejects.toThrow('test failure')
    const row = sql.prepare('SELECT published_at, revision FROM posting_drafts').get()
    expect(row.published_at).toBeNull(); expect(row.revision).toBe(1)
  })
  it.each([{ description: 'x'.repeat(20001) }, { title: 5 }])('rejects invalid input without truncating stored content', async fields => {
    expect((await save(context(author, { fields, revision: 0 }))).status).toBe(400)
    expect(sql.prepare('SELECT count(*) AS n FROM posting_drafts').get().n).toBe(0)
  })
  it('ignores client-supplied owner and publication fields and disables direct public database access', async () => {
    await save(context(author, { fields: { title: '초안', user_id: 'other', published_at: 'now' }, revision: 0 }))
    const row = sql.prepare('SELECT user_id,payload,published_at FROM posting_drafts').get()
    expect(row.user_id).toBe('author'); expect(row.published_at).toBeNull()
    expect(JSON.parse(row.payload)).not.toHaveProperty('user_id')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON public.posting_drafts FROM anon, authenticated')
  })
})
