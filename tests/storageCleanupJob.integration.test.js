import { afterEach, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { handleStorageCleanupJob } from '../server/_lib/storageCleanupJob.js'

const databases = []
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks() })
const request = dryRun => new Request('https://fixture.invalid/storage-cleanup', {
  method: 'POST', headers: { Authorization: 'Bearer fixture-job', 'Content-Type': 'application/json' },
  body: JSON.stringify({ dryRun }),
})

function fixture() {
  const db = sqliteApp(); databases.push(db)
  seedUser(db, 'owner')
  db.sql.exec(`INSERT INTO documents (id,user_id,doc_type,filename,r2_key,size_bytes,content_type)
    VALUES ('live','owner','resume','live.pdf','live.pdf',10,'application/pdf');
    INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code)
    VALUES ('room','owner','Fixture','closed','CLEANUPJOB');
    INSERT INTO interview_sessions (id,room_id,provider_meeting_id,title,status)
    VALUES ('session','room','fixture','Fixture','ended');
    INSERT INTO interview_recordings (id,session_id,status,storage_status,r2_key,retention_until)
    VALUES ('expired','session','available','stored','expired.webm',datetime('now','-1 day'));
    INSERT INTO account_recovery_tokens (token_hash,user_id,purpose,email,expires_at,password_snapshot)
    VALUES ('fixture-expired-token','owner','reset_password','fixture@example.invalid',datetime('now','-1 day'),'unused');`)
  const deleted = []
  const env = { DB: db, STORAGE_CLEANUP_JOB_SECRET: 'fixture-job', STORAGE_CLEANUP_EXECUTE: '1',
    RETENTION_EXECUTE: '1', DOCUMENTS: { delete: vi.fn(async key => { deleted.push(key) }) },
    INTERVIEW_RECORDINGS: { delete: vi.fn(async key => { deleted.push(key) }) } }
  return { db, env, deleted }
}

it('handles only queued due targets, retains referenced/deferred files and never runs broader retention', async () => {
  const blockedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External access prohibited') })
  const f = fixture()
  f.db.sql.exec(`INSERT INTO storage_cleanup_intents (bucket,storage_key,operation_id) VALUES
    ('documents','removed.pdf','removed'),('documents','live.pdf','protected');
    INSERT INTO storage_cleanup_intents (bucket,storage_key,operation_id,not_before) VALUES
    ('interview-recordings','deferred.webm','deferred',datetime('now','+2 days'));`)
  const before = f.db.sql.prepare('SELECT * FROM storage_cleanup_intents ORDER BY storage_key').all()
  expect(await (await handleStorageCleanupJob(request(true), f.env)).json()).toEqual({ dryRun: true, pending: 2, deleted: 0, failed: 0, protected: 0 })
  expect(f.db.sql.prepare('SELECT * FROM storage_cleanup_intents ORDER BY storage_key').all()).toEqual(before)
  expect(f.deleted).toEqual([])
  expect(await (await handleStorageCleanupJob(request(false), f.env)).json()).toEqual({ dryRun: false, pending: 2, deleted: 1, failed: 0, protected: 1 })
  expect(f.deleted).toEqual(['removed.pdf'])
  expect(f.db.sql.prepare('SELECT storage_key FROM storage_cleanup_intents ORDER BY storage_key').all()).toEqual([
    { storage_key: 'deferred.webm' }, { storage_key: 'live.pdf' },
  ])
  expect(f.db.sql.prepare("SELECT r2_key,status,deleted_at FROM interview_recordings WHERE id='expired'").get())
    .toEqual({ r2_key: 'expired.webm', status: 'available', deleted_at: null })
  expect(f.db.sql.prepare('SELECT count(*) AS count FROM account_recovery_tokens').get().count).toBe(1)
  expect(f.db.sql.prepare('SELECT count(*) AS count FROM retention_jobs').get().count).toBe(0)
  expect(blockedFetch).not.toHaveBeenCalled()
})

it('deletes at most 25 queued targets per call and leaves the next batch for a later run', async () => {
  const f = fixture()
  for (let index = 0; index < 30; index++) f.db.sql.prepare('INSERT INTO storage_cleanup_intents (bucket,storage_key,operation_id) VALUES (?,?,?)')
    .run('documents', `removed-${String(index).padStart(2, '0')}.pdf`, 'batch')
  expect(await (await handleStorageCleanupJob(request(false), f.env)).json()).toEqual({ dryRun: false, pending: 25, deleted: 25, failed: 0, protected: 0 })
  expect(f.deleted).toHaveLength(25)
  expect(f.db.sql.prepare('SELECT count(*) AS count FROM storage_cleanup_intents').get().count).toBe(5)
})

it('keeps a failed target durable while the independent job retries other due targets', async () => {
  const f = fixture()
  f.db.sql.exec("INSERT INTO storage_cleanup_intents (bucket,storage_key,operation_id) VALUES ('documents','provider-failed.pdf','retry')")
  f.env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('fixture provider failure'))
  expect(await (await handleStorageCleanupJob(request(false), f.env)).json()).toEqual({ dryRun: false, pending: 1, deleted: 0, failed: 1, protected: 0 })
  expect(f.db.sql.prepare('SELECT storage_key,attempts FROM storage_cleanup_intents').get()).toEqual({ storage_key: 'provider-failed.pdf', attempts: 1 })
  expect(await (await handleStorageCleanupJob(request(false), f.env)).json()).toEqual({ dryRun: false, pending: 0, deleted: 0, failed: 0, protected: 0 })
  f.db.sql.exec("UPDATE storage_cleanup_intents SET next_attempt_at=datetime('now','-1 minute')")
  expect(await (await handleStorageCleanupJob(request(false), f.env)).json()).toEqual({ dryRun: false, pending: 1, deleted: 1, failed: 0, protected: 0 })
})
