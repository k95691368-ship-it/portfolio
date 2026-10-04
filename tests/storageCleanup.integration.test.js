import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestDelete as deleteDocument } from '../server/api/documents/[id]/index.js'
import { onRequestDelete as deleteUser } from '../server/api/admin/users/[id]/index.js'
import { onRequestDelete as deleteRoom } from '../server/api/admin/rooms/[roomId]/index.js'
import { processStorageCleanup } from '../server/_lib/storageCleanup.js'
import { runRetention } from '../server/_lib/retention.js'
import { onRequestPost as recoverRecording } from '../server/api/rooms/[roomId]/interviews/[sessionId]/recordings/[recordingId]/upload-ticket.js'
import { onRequestPost as startRecording } from '../server/api/rooms/[roomId]/interviews/[sessionId]/recording/start.js'
import { onRequestPut as controlRecording } from '../server/api/rooms/[roomId]/interviews/[sessionId]/recording/[recordingId]/control.js'
import { CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH } from '../server/_lib/interviews.js'

const databases = []
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External access prohibited') })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks() })

function fixture(kind = 'document') {
  const db = sqliteApp(); databases.push(db)
  const owner = seedUser(db, 'owner')
  const admin = seedUser(db, 'admin', 'company', { admin: 1 })
  const documents = new Map(), recordings = new Map()
  const bucket = objects => ({ delete: vi.fn(async key => { objects.delete(key) }) })
  const env = { DB: db, DOCUMENTS: bucket(documents), INTERVIEW_RECORDINGS: bucket(recordings) }
  let parent, invoke
  if (kind === 'room') {
    db.sql.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code)
      VALUES ('room','admin','Test','closed','CLEANUPROOM1');
      INSERT INTO contract_terms (room_id,employer_name,employee_name) VALUES ('room','Company','Candidate');
      INSERT INTO interview_sessions (id,room_id,provider_meeting_id,title,status)
      VALUES ('session','room','test-meeting','Interview','ended');
      INSERT INTO interview_recordings (id,session_id,status,storage_status,r2_key)
      VALUES ('recording','session','available','stored','interviews/recording.webm');
      INSERT INTO signed_contracts (id,room_id,r2_key,filename,size_bytes,stored_by_user_id)
      VALUES ('signed','room','contracts/signed.pdf','contract.pdf',10,'admin');`)
    documents.set('contracts/signed.pdf', 'contract'); recordings.set('interviews/recording.webm', 'recording')
    parent = () => db.sql.prepare("SELECT * FROM interview_rooms WHERE id = 'room'").get()
    invoke = (body = {}) => deleteRoom({ env, data: { user: admin }, params: { roomId: 'room' },
      request: new Request('https://test.invalid/api/admin/rooms/room', { method: 'DELETE', body: JSON.stringify(body) }) })
  } else {
    db.sql.exec(`INSERT INTO documents (id,user_id,doc_type,filename,r2_key,size_bytes,content_type)
      VALUES ('doc','owner','resume','resume.pdf','documents/original.pdf',10,'application/pdf');`)
    documents.set('documents/original.pdf', 'resume')
    parent = () => db.sql.prepare(kind === 'user' ? "SELECT * FROM users WHERE id = 'owner'" : "SELECT * FROM documents WHERE id = 'doc'").get()
    invoke = () => kind === 'user'
      ? deleteUser({ env, data: { user: admin }, params: { id: 'owner' } })
      : deleteDocument({ env, data: { user: owner }, params: { id: 'doc' } })
  }
  return { db, env, owner, admin, documents, recordings, parent, invoke,
    receipts: () => db.sql.prepare('SELECT bucket,storage_key,operation_id FROM storage_cleanup_intents ORDER BY bucket,storage_key').all(),
    // Simulate both provider capability expiry and the retry backoff elapsing.
    due: () => db.sql.exec("UPDATE storage_cleanup_intents SET not_before = datetime('now','-1 minute'), next_attempt_at = datetime('now','-1 minute')") }
}

function failParentTransaction(db, kind, afterCommit) {
  const batch = db.batch.bind(db)
  const table = { document: 'documents', user: 'users', room: 'interview_rooms' }[kind]
  vi.spyOn(db, 'batch').mockImplementation(async statements => {
    if (!statements.some(statement => new RegExp(`DELETE FROM ${table}\\b`).test(statement.source))) return batch(statements)
    if (afterCommit) { await batch(statements); throw new Error('Lost commit acknowledgement') }
    return batch([...statements, db.prepare('SELECT simulated_transaction_failure()')])
  })
}

function recoveryContext(f) {
  const host = seedUser(f.db, 'host', 'company')
  f.db.sql.exec(`UPDATE interview_rooms SET company_user_id = 'host';
    INSERT INTO room_participants (room_id,user_id,role_in_room) VALUES ('room','host','company');
    INSERT INTO interview_session_members (session_id,user_id,role,custom_participant_id) VALUES ('session','host','host','host-member');
    UPDATE interview_recordings SET created_by_user_id = 'host', status = 'failed', storage_status = 'pending',
      started_at = datetime('now'), retention_until = datetime('now','+1 day');`)
  f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl = vi.fn(async key => ({ path: key, token: 'test-fixture' }))
  return { env: f.env, data: { user: host }, params: { roomId: 'room', sessionId: 'session', recordingId: 'recording' } }
}

it.each(['start', 'resume', 'recover'].flatMap(action => [
  [action, 'fresh', 0], [action, 'expired', 11],
]))('%s respects a %s room deletion lock', async (action, _age, minutes) => {
  const f = fixture('room'), context = recoveryContext(f)
  if (action === 'start') {
    f.db.sql.exec("UPDATE interview_rooms SET status = 'active'; UPDATE interview_sessions SET status = 'live'; DELETE FROM interview_recordings")
    f.db.sql.prepare('INSERT INTO interview_recording_consents (session_id,user_id,notice_version,notice_hash,granted) VALUES (?,?,?,?,1)')
      .run('session', 'host', CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH)
  } else if (action === 'resume') {
    f.db.sql.exec("UPDATE interview_rooms SET status = 'active'; UPDATE interview_recordings SET status = 'paused'")
  }
  f.db.sql.prepare("INSERT INTO interview_room_deletion_locks (room_id,lock_token,created_at) VALUES ('room','delete',datetime('now',?))")
    .run(`-${minutes} minutes`)
  const response = action === 'start' ? await startRecording(context)
    : action === 'recover' ? await recoverRecording(context)
      : await controlRecording({ ...context,
        request: new Request('https://test.invalid/control', { method: 'PUT', body: '{"action":"resume"}' }),
      })
  expect(response.status).toBe(minutes ? (action === 'start' ? 201 : 200) : 409)
  const statuses = f.db.sql.prepare('SELECT status FROM interview_recordings').all().map(row => row.status)
  expect(statuses).toEqual(minutes ? [action === 'recover' ? 'processing' : 'recording']
    : action === 'start' ? [] : [action === 'resume' ? 'paused' : 'failed'])
  expect(f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl).toHaveBeenCalledTimes(minutes && action !== 'resume' ? 1 : 0)
})

it('refuses a recovery ticket in the gap between deletion preflight and its parent transaction', async () => {
  const f = fixture('room'), context = recoveryContext(f), batch = f.db.batch.bind(f.db)
  let recovered
  vi.spyOn(f.db, 'batch').mockImplementation(async statements => {
    if (statements.some(statement => /DELETE FROM interview_rooms\b/.test(statement.source))) {
      recovered = await recoverRecording(context)
    }
    return batch(statements)
  })
  expect((await f.invoke()).status).toBe(200)
  expect(recovered.status).toBe(409)
  expect(f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl).not.toHaveBeenCalled()
  expect(f.parent()).toBeUndefined()
})

it('makes an earlier recovery visible as processing before issuing its ticket and blocks deletion', async () => {
  const f = fixture('room'), context = recoveryContext(f), observed = []
  f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl.mockImplementation(async key => {
    observed.push(f.db.sql.prepare("SELECT status FROM interview_recordings WHERE id = 'recording'").get().status)
    return { path: key, token: 'test-fixture' }
  })
  expect((await recoverRecording(context)).status).toBe(200)
  expect(observed).toEqual(['processing'])
  expect((await f.invoke()).status).toBe(409)
  expect(f.receipts()).toHaveLength(0)
  expect(f.env.INTERVIEW_RECORDINGS.delete).not.toHaveBeenCalled()
})

it('does not issue a recovery ticket when the processing claim acknowledgement is lost', async () => {
  const f = fixture('room'), context = recoveryContext(f), batch = f.db.batch.bind(f.db)
  vi.spyOn(f.db, 'batch').mockImplementationOnce(async statements => {
    await batch(statements); throw new Error('Lost claim acknowledgement')
  })
  expect((await recoverRecording(context)).status).toBe(503)
  expect(f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl).not.toHaveBeenCalled()
  expect((await f.invoke()).status).toBe(409)
})

it('does not reopen deletion when ticket creation fails but an earlier upload may still be in flight', async () => {
  const f = fixture('room'), context = recoveryContext(f)
  f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl.mockRejectedValueOnce(new Error('Provider unavailable'))
  expect((await recoverRecording(context)).status).toBe(503)
  expect(f.db.sql.prepare("SELECT status FROM interview_recordings WHERE id = 'recording'").get().status).toBe('processing')
  expect((await f.invoke()).status).toBe(409)
})

it('rejects a recording start if deletion begins after the session was read', async () => {
  const f = fixture('room'), context = recoveryContext(f), batch = f.db.batch.bind(f.db)
  f.db.sql.exec("UPDATE interview_rooms SET status = 'active'; UPDATE interview_sessions SET status = 'live'; DELETE FROM interview_recordings")
  f.db.sql.prepare('INSERT INTO interview_recording_consents (session_id,user_id,notice_version,notice_hash,granted) VALUES (?,?,?,?,1)')
    .run('session', 'host', CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH)
  vi.spyOn(f.db, 'batch').mockImplementationOnce(async statements => {
    f.db.sql.exec("UPDATE interview_sessions SET status = 'ended'; INSERT INTO interview_room_deletion_locks (room_id,lock_token) VALUES ('room','delete')")
    return batch(statements)
  })
  expect((await startRecording(context)).status).toBe(409)
  expect(f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl).not.toHaveBeenCalled()
  expect(f.db.sql.prepare('SELECT COUNT(*) AS n FROM interview_recordings').get().n).toBe(0)
})

it('keeps an ordinary consented recording start working through the guarded transaction', async () => {
  const f = fixture('room'), context = recoveryContext(f)
  f.db.sql.exec("UPDATE interview_rooms SET status = 'active'; UPDATE interview_sessions SET status = 'live'; DELETE FROM interview_recordings")
  f.db.sql.prepare('INSERT INTO interview_recording_consents (session_id,user_id,notice_version,notice_hash,granted) VALUES (?,?,?,?,1)')
    .run('session', 'host', CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH)
  expect((await startRecording(context)).status).toBe(201)
  expect(f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl).toHaveBeenCalledOnce()
  expect(f.db.sql.prepare('SELECT status FROM interview_recordings').get().status).toBe('recording')
})

it('keeps a cleanup receipt past upload-token/TUS expiry after start, abort, and room deletion', async () => {
  const f = fixture('room'), context = recoveryContext(f)
  f.db.sql.exec("UPDATE interview_rooms SET status = 'active'; UPDATE interview_sessions SET status = 'live'; DELETE FROM interview_recordings")
  f.recordings.clear()
  f.db.sql.prepare('INSERT INTO interview_recording_consents (session_id,user_id,notice_version,notice_hash,granted) VALUES (?,?,?,?,1)')
    .run('session', 'host', CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH)
  expect((await startRecording(context)).status).toBe(201)
  const recording = f.db.sql.prepare('SELECT id,r2_key FROM interview_recordings').get()
  expect((await controlRecording({ ...context, params: { ...context.params, recordingId: recording.id },
    request: new Request('https://test.invalid/control', { method: 'PUT', body: '{"action":"abort"}' }),
  })).status).toBe(200)
  f.db.sql.exec("UPDATE interview_sessions SET status = 'ended'")
  expect(await (await f.invoke()).json()).toMatchObject({ cleanupPending: true })
  const receipt = f.db.sql.prepare("SELECT storage_key,julianday(not_before)-julianday(created_at) AS days FROM storage_cleanup_intents WHERE bucket = 'interview-recordings'").get()
  expect(receipt.storage_key).toBe(recording.r2_key)
  expect(receipt.days).toBeCloseTo(2, 4)
  expect(f.env.INTERVIEW_RECORDINGS.delete).not.toHaveBeenCalled()
  // A capability issued before abort can still complete a late upload.
  f.recordings.set(recording.r2_key, 'late upload')
  await processStorageCleanup(f.env, { dryRun: false })
  expect(f.recordings.has(recording.r2_key)).toBe(true)
  expect(f.receipts()).toHaveLength(1)
  f.due()
  f.env.INTERVIEW_RECORDINGS.delete.mockRejectedValueOnce(new Error('Storage unavailable'))
  expect(await processStorageCleanup(f.env, { dryRun: false })).toMatchObject({ failed: 1 })
  expect(f.receipts()).toHaveLength(1)
  f.due()
  expect(await processStorageCleanup(f.env, { dryRun: false })).toMatchObject({ deleted: 1, failed: 0 })
  expect(f.recordings.has(recording.r2_key)).toBe(false)
  expect(f.receipts()).toHaveLength(0)
})

it('does not resume a stale paused recording after it failed and deletion was locked', async () => {
  const f = fixture('room'), context = recoveryContext(f), batch = f.db.batch.bind(f.db)
  f.db.sql.exec("UPDATE interview_rooms SET status = 'active'; UPDATE interview_recordings SET status = 'paused'")
  vi.spyOn(f.db, 'batch').mockImplementationOnce(async statements => {
    f.db.sql.exec("UPDATE interview_recordings SET status = 'failed'; INSERT INTO interview_room_deletion_locks (room_id,lock_token) VALUES ('room','delete')")
    return batch(statements)
  })
  expect((await controlRecording({ ...context,
    request: new Request('https://test.invalid/control', { method: 'PUT', body: '{"action":"resume"}' }),
  })).status).toBe(409)
  expect(f.db.sql.prepare("SELECT status FROM interview_recordings WHERE id = 'recording'").get().status).toBe('failed')
})

it.each(['document', 'user', 'room'])('rolls back %s metadata and cleanup intents together without touching storage', async kind => {
  const f = fixture(kind); failParentTransaction(f.db, kind, false)
  expect((await f.invoke()).status).toBe(503)
  expect(f.parent()).toBeDefined()
  expect(f.receipts()).toHaveLength(0)
  expect(f.env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(f.env.INTERVIEW_RECORDINGS.delete).not.toHaveBeenCalled()
  expect(f.documents.size).toBe(1)
  if (kind === 'room') expect(f.recordings.size).toBe(1)
})

it.each(['document', 'user', 'room'])('keeps committed %s cleanup targets after a lost DB acknowledgement for retention to finish', async kind => {
  const f = fixture(kind); failParentTransaction(f.db, kind, true)
  expect((await f.invoke()).status).toBe(503)
  expect(f.parent()).toBeUndefined()
  expect(f.receipts()).toHaveLength(kind === 'room' ? 2 : 1)
  expect(f.env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(f.env.INTERVIEW_RECORDINGS.delete).not.toHaveBeenCalled()
  f.due()
  const report = await runRetention(f.env, { dryRun: false })
  expect(report.storageCleanup).toMatchObject({ deleted: kind === 'room' ? 2 : 1, failed: 0 })
  expect(f.receipts()).toHaveLength(0)
  expect(f.documents.size + f.recordings.size).toBe(0)
})

it.each(['document', 'user', 'room'])('reports pending physical cleanup for %s when storage fails and safely retries exact keys', async kind => {
  const f = fixture(kind)
  f.env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('Storage unavailable'))
  const response = await f.invoke()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ ok: true, cleanupPending: true })
  expect(f.parent()).toBeUndefined()
  expect(f.receipts().map(row => row.storage_key).sort()).toEqual(kind === 'room'
    ? ['contracts/signed.pdf', 'interviews/recording.webm'] : ['documents/original.pdf'])
  f.due()
  expect(await processStorageCleanup(f.env, { dryRun: false })).toMatchObject({ failed: 0, deleted: kind === 'room' ? 2 : 1 })
  expect(f.receipts()).toHaveLength(0)
})

it('does not call storage until the parent transaction has committed', async () => {
  const f = fixture('room')
  const observed = []
  for (const storage of [f.env.DOCUMENTS, f.env.INTERVIEW_RECORDINGS]) storage.delete.mockImplementation(async () => {
    observed.push({ parentPresent: !!f.parent(), inTransaction: f.db.sql.isTransaction })
  })
  expect((await f.invoke()).status).toBe(200)
  f.due(); await processStorageCleanup(f.env, { dryRun: false })
  expect(f.env.DOCUMENTS.delete).toHaveBeenCalledOnce()
  expect(f.env.INTERVIEW_RECORDINGS.delete).toHaveBeenCalledOnce()
  expect(observed).toEqual([{ parentPresent: false, inTransaction: false }, { parentPresent: false, inTransaction: false }])
})

it.each(['provider', 'receipt'])('repeats deletion safely after an ambiguous %s acknowledgement', async stage => {
  const f = fixture()
  if (stage === 'provider') f.env.DOCUMENTS.delete.mockImplementationOnce(async key => {
    f.documents.delete(key); throw new Error('Lost provider acknowledgement')
  })
  else {
    const prepare = f.db.prepare.bind(f.db)
    let failed = false
    vi.spyOn(f.db, 'prepare').mockImplementation(source => {
      const statement = prepare(source)
      if (/DELETE FROM storage_cleanup_intents/.test(source)) {
        const run = statement.run.bind(statement)
        statement.run = async () => { if (!failed) { failed = true; throw new Error('DB unavailable') }; return run() }
      }
      return statement
    })
  }
  expect(await (await f.invoke()).json()).toMatchObject({ cleanupPending: true })
  expect(f.documents.size).toBe(0)
  expect(f.receipts()).toHaveLength(1)
  f.due(); await processStorageCleanup(f.env, { dryRun: false })
  expect(f.receipts()).toHaveLength(0)
  expect(f.env.DOCUMENTS.delete).toHaveBeenCalledTimes(2)
})

it('preserves a replacement uploaded after the delete request read the previous version', async () => {
  const f = fixture(), batch = f.db.batch.bind(f.db)
  vi.spyOn(f.db, 'batch').mockImplementationOnce(async statements => {
    f.db.sql.exec("UPDATE documents SET r2_key = 'documents/replacement.pdf' WHERE id = 'doc'")
    f.documents.set('documents/replacement.pdf', 'replacement')
    return batch(statements)
  })
  expect((await f.invoke()).status).toBe(409)
  expect(f.parent().r2_key).toBe('documents/replacement.pdf')
  expect(f.receipts()).toHaveLength(0)
  expect(f.env.DOCUMENTS.delete).not.toHaveBeenCalled()
})

it('protects a permanent contract archive even if a deleted room used the same storage key', async () => {
  const f = fixture('room')
  f.db.sql.exec(`INSERT INTO contract_archive (id,room_id,terms_json,signatures_json,document_key,document_sha256,document_bytes)
    VALUES ('archive','room','{}','[]','contracts/signed.pdf','fixture',10)`)
  expect(await (await f.invoke()).json()).toMatchObject({ cleanupPending: true })
  expect(f.documents.has('contracts/signed.pdf')).toBe(true)
  expect(f.env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(f.db.sql.prepare("SELECT source_deleted_at FROM contract_archive WHERE id = 'archive'").get().source_deleted_at).toBeTruthy()
  f.due(); await processStorageCleanup(f.env, { dryRun: false })
  expect(f.receipts()).toHaveLength(1)
})

it.each(['application', 'signed-contract'])('does not remove a document key still referenced by a live %s', async reference => {
  const f = fixture()
  if (reference === 'application') f.db.sql.exec(`INSERT INTO job_postings (id,title,description,created_by_user_id,status)
    VALUES ('posting','Role','Details','admin','open');
    INSERT INTO applications (id,posting_id,applicant_name,applicant_email,applicant_phone,consent_required)
    VALUES ('application','posting','Candidate','candidate@example.invalid','01012345678',1);
    INSERT INTO application_documents (id,application_id,doc_type,filename,r2_key,size_bytes,content_type)
    VALUES ('application-doc','application','resume','resume.pdf','documents/original.pdf',10,'application/pdf')`)
  else f.db.sql.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code)
    VALUES ('other-room','admin','Interview','signed','CLEANUPOTHER');
    INSERT INTO signed_contracts (id,room_id,r2_key,filename,size_bytes,stored_by_user_id)
    VALUES ('other-signed','other-room','documents/original.pdf','contract.pdf',10,'admin')`)
  expect(await (await f.invoke()).json()).toMatchObject({ cleanupPending: true })
  expect(f.parent()).toBeUndefined()
  expect(f.documents.has('documents/original.pdf')).toBe(true)
  expect(f.env.DOCUMENTS.delete).not.toHaveBeenCalled()
})

it('retains a queued recording key while any live recording row references it', async () => {
  const f = fixture('room')
  f.db.sql.exec(`INSERT INTO storage_cleanup_intents (bucket,storage_key,operation_id)
    VALUES ('interview-recordings','interviews/recording.webm','stale-request')`)
  expect(await processStorageCleanup(f.env, { dryRun: false })).toMatchObject({ protected: 1, deleted: 0 })
  expect(f.env.INTERVIEW_RECORDINGS.delete).not.toHaveBeenCalled()
  expect(f.recordings.size).toBe(1)
})

it.each(['held', 'active-session', 'active-recording', 'contract-hold'])('preserves room/file state when blocked by %s', async state => {
  const f = fixture('room')
  if (state === 'held') f.db.sql.exec("UPDATE interview_recordings SET retention_hold_reason = 'preserve'")
  if (state === 'active-session') f.db.sql.exec("UPDATE interview_sessions SET status = 'live'")
  if (state === 'active-recording') f.db.sql.exec("UPDATE interview_recordings SET status = 'processing'")
  if (state === 'contract-hold') f.db.sql.exec("UPDATE interview_rooms SET status = 'signed'")
  expect((await f.invoke()).status).toBe(409)
  expect(f.parent()).toBeDefined()
  expect(f.receipts()).toHaveLength(0)
  expect(f.env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(f.env.INTERVIEW_RECORDINGS.delete).not.toHaveBeenCalled()
})

it('keeps document ownership and administrator self/protected-account checks before cleanup', async () => {
  const f = fixture()
  expect((await deleteDocument({ env: f.env, data: { user: null }, params: { id: 'doc' } })).status).toBe(401)
  expect((await deleteDocument({ env: f.env, data: { user: f.admin }, params: { id: 'doc' } })).status).toBe(403)
  expect((await deleteUser({ env: f.env, data: { user: f.owner }, params: { id: 'owner' } })).status).toBe(403)
  f.db.sql.exec("UPDATE users SET is_developer = 1 WHERE id = 'owner'")
  expect((await deleteUser({ env: f.env, data: { user: f.admin }, params: { id: 'owner' } })).status).toBe(403)
  expect(f.receipts()).toHaveLength(0)
  expect(f.documents.size).toBe(1)
})

it('bounds retention cleanup and leaves dry-run, shared references, and concurrent attempts safe', async () => {
  const f = fixture()
  for (let i = 0; i < 30; i++) {
    const key = `unreferenced/${String(i).padStart(2, '0')}.pdf`; f.documents.set(key, 'file')
    f.db.sql.prepare("INSERT INTO storage_cleanup_intents (bucket,storage_key,operation_id) VALUES ('documents',?,'batch')").run(key)
  }
  expect(await processStorageCleanup(f.env, { limit: 100 })).toMatchObject({ pending: 25, deleted: 0 })
  expect(f.env.DOCUMENTS.delete).not.toHaveBeenCalled()
  await Promise.all(Array.from({ length: 3 }, () => processStorageCleanup(f.env, { dryRun: false, limit: 25 })))
  expect(f.env.DOCUMENTS.delete).toHaveBeenCalledTimes(25)
  expect(f.receipts()).toHaveLength(5)
  await processStorageCleanup(f.env, { dryRun: false })
  expect(f.receipts()).toHaveLength(0)
  f.db.sql.exec("INSERT INTO storage_cleanup_intents (bucket,storage_key,operation_id) VALUES ('documents','documents/original.pdf','shared')")
  expect(await processStorageCleanup(f.env, { dryRun: false })).toMatchObject({ protected: 1, deleted: 0 })
  expect(f.documents.has('documents/original.pdf')).toBe(true)
})
