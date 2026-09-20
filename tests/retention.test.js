import { afterEach, beforeEach, it, expect, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { runRetention, cleanExpiredRecoveryData } from '../server/_lib/retention.js'
import { serializeRecording } from '../server/_lib/interviews.js'
let db, env
beforeEach(() => {
  db = sqliteApp(); seedUser(db, 'host', 'company')
  db.sql.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('room','host','Test','closed','ABCD2345EFGH');
    INSERT INTO interview_sessions (id,room_id,provider_meeting_id,title,status) VALUES ('session','room','meeting','Test','ended');
    INSERT INTO interview_recordings (id,session_id,status,storage_status,r2_key,retention_until) VALUES ('recording','session','available','stored','recording.webm',datetime('now','-1 day'));
    INSERT INTO job_postings (id,title,description,created_by_user_id,status) VALUES ('posting','Role','Details','host','open');
    INSERT INTO applications (id,posting_id,applicant_name,applicant_email,applicant_phone,consent_required,created_at)
      VALUES ('app','posting','Name','old@example.invalid','01012345678',1,datetime('now','-4 years'));
    INSERT INTO application_documents (id,application_id,doc_type,filename,r2_key,size_bytes,content_type)
      VALUES ('doc','app','resume','resume.pdf','resume.pdf',10,'application/pdf');`)
  env = { DB: db, DOCUMENTS: { delete: vi.fn().mockResolvedValue() }, INTERVIEW_RECORDINGS: { delete: vi.fn().mockResolvedValue() } }
})
afterEach(() => db.close())
it('dry-run makes no deletion and expired data is not mislabeled as deleted', async () => {
  expect(await runRetention(env)).toMatchObject({ dryRun: true, recordings: 1, applications: 1 })
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(serializeRecording(db.sql.prepare('SELECT * FROM interview_recordings').get())).toMatchObject({ status: 'expired', storageStatus: 'stored', available: false })
})
it('keeps failed storage keys and retries without losing the deletion target', async () => {
  env.INTERVIEW_RECORDINGS.delete.mockRejectedValueOnce(new Error('storage unavailable'))
  expect(await runRetention(env, { dryRun: false })).toMatchObject({ failed: 1, deleted: 1 })
  expect(db.sql.prepare('SELECT r2_key FROM interview_recordings').get().r2_key).toBe('recording.webm')
  db.sql.exec("UPDATE retention_jobs SET updated_at = datetime('now','-6 minutes')")
  expect(await runRetention(env, { dryRun: false })).toMatchObject({ failed: 0, deleted: 1 })
  expect(db.sql.prepare('SELECT r2_key,status FROM interview_recordings').get()).toMatchObject({ r2_key: null, status: 'deleted' })
  expect(db.sql.prepare('SELECT applicant_name,purged_at FROM applications').get().purged_at).toBeTruthy()
  expect(db.sql.prepare('SELECT count(*) n FROM application_documents').get().n).toBe(0)
})
it('honors explicit retention holds for applications and recordings', async () => {
  db.sql.exec("UPDATE applications SET retention_hold_reason = 'review'; UPDATE interview_recordings SET retention_hold_reason = 'review'")
  expect(await runRetention(env, { dryRun: false })).toMatchObject({ deleted: 0, failed: 0 })
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(env.INTERVIEW_RECORDINGS.delete).not.toHaveBeenCalled()
})
it('cleans expired incomplete uploads while excluding an active recording', async () => {
  db.sql.exec("UPDATE interview_recordings SET status = 'processing'")
  expect(await runRetention(env)).toMatchObject({ recordings: 1 })
  db.sql.exec("UPDATE interview_recordings SET status = 'recording'")
  expect(await runRetention(env)).toMatchObject({ recordings: 0 })
})
it('bounds cleanup of expired or long-consumed proofs, preserving active and in-flight proofs', async () => {
  for (const [id, expiry, consumed] of [['expired','2000-01-01',null],['used','2099-01-01','2000-01-01'],['active','2099-01-01',null],['inflight','2099-01-01',new Date().toISOString()]]) {
    db.sql.prepare('INSERT INTO application_access_tokens(token_hash,email,expires_at,used_at) VALUES(?,?,?,?)').run(id,'test@example.invalid',expiry,consumed)
    db.sql.prepare('INSERT INTO application_access_sessions(token_hash,email,expires_at) VALUES(?,?,?)').run(id,'test@example.invalid',expiry)
    db.sql.prepare("INSERT INTO account_recovery_tokens(token_hash,user_id,purpose,email,password_snapshot,expires_at,consumed_at) VALUES(?,'host','reset_password','test@example.invalid','fixture',?,?)").run(id,expiry,consumed)
  }
  expect(await cleanExpiredRecoveryData(env)).toMatchObject({ pending: 5, deleted: 0 })
  expect(await cleanExpiredRecoveryData(env, { dryRun:false, limit:1 })).toMatchObject({ pending:3, deleted:3 })
  expect(await cleanExpiredRecoveryData(env, { dryRun:false })).toMatchObject({ pending:2, deleted:2 })
  for (const table of ['application_access_tokens','account_recovery_tokens']) {
    expect(db.sql.prepare(`SELECT token_hash FROM ${table} ORDER BY token_hash`).all().map(row=>row.token_hash)).toEqual(['active','inflight'])
  }
})
