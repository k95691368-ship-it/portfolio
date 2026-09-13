import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPatch as updateAdminUser } from '../server/api/admin/users/[id]/index.js'
import { revokeActiveInterviewAccessForUser } from '../server/_lib/interviewUserAccess.js'

const SUPABASE_ENV = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function memberDb(writes = [], members = [{
  session_id: 'session-1',
  user_id: 'user-1',
  custom_participant_id: 'custom-user-1',
  provider_participant_id: 'participant-user-1',
  provider_meeting_id: 'meeting-1',
}], activeRecording = null) {
  return {
    prepare(sql) {
      const statement = {
        bind() { return statement },
        async all() { return { results: members } },
        async first() { return sql.includes('FROM interview_recordings') ? activeRecording : sql.includes('provider_meeting_id = ?') ? { id: 'session-1' } : null },
        async run() {
          writes.push(sql)
          return { meta: { changes: 1 } }
        },
      }
      return statement
    },
  }
}

function sentEvents(fetchMock) {
  return fetchMock.mock.calls.flatMap(([, options]) =>
    JSON.parse(options.body).messages.map((message) => message.payload.event)
  )
}

describe('관리자 계정 정지의 화상 면접 접근 폐기', () => {
  it('현재 참가자 연결을 Supabase Broadcast로 끊고 DB 입장 상태를 지운다', async () => {
    const writes = []
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(revokeActiveInterviewAccessForUser(
      { ...SUPABASE_ENV, DB: memberDb(writes) },
      'user-1'
    )).resolves.toEqual({ revokedMemberships: 1 })

    expect(sentEvents(fetchMock)).toEqual([])
    expect(writes.some((sql) => sql.includes('provider_participant_id = NULL'))).toBe(true)
  })

  it('개별 퇴장 신호가 실패하면 녹화를 멈추고 회의 전체 종료 신호를 보낸다', async () => {
    const writes = []
    let calls = 0
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const db = memberDb(writes, undefined, { id: 'recording-1', provider_recording_id: 'recording-1' })
    const prepare = db.prepare.bind(db)
    db.prepare = (sql) => {
      const st = prepare(sql), run = st.run
      st.run = async () => {
        if (sql.includes('custom_participant_id IN') && calls++ < 2) throw new Error('database temporarily unavailable')
        return run()
      }
      return st
    }
    await expect(revokeActiveInterviewAccessForUser(
      {
        ...SUPABASE_ENV,
        DB: db,
      },
      'user-1'
    )).resolves.toEqual({ revokedMemberships: 1 })

    expect(sentEvents(fetchMock)).toEqual([])
    expect(writes.some((sql) => sql.includes("SET status = 'processing'"))).toBe(true)
    expect(writes.some((sql) => sql.includes("SET status = 'failed'"))).toBe(true)
  })

  it('세션 삭제가 실패해도 Supabase 참가자 종료 요청은 독립적으로 실행한다', async () => {
    const writes = []
    const db = memberDb(writes)
    const originalPrepare = db.prepare.bind(db)
    db.prepare = (sql) => {
      const statement = originalPrepare(sql)
      statement.first = async () =>
        sql.includes('FROM users WHERE id')
          ? { id: 'user-1', email: 'user@example.test', is_admin: 0, is_developer: 0 }
          : sql.includes('provider_meeting_id = ?') ? { id: 'session-1' } : null
      const originalRun = statement.run
      statement.run = async () => {
        if (sql.includes('DELETE FROM sessions WHERE user_id')) throw new Error('session unavailable')
        return originalRun()
      }
      return statement
    }
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await updateAdminUser({
      request: new Request('https://example.test/api/admin/users/user-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSuspended: true }),
      }),
      env: { ...SUPABASE_ENV, DB: db },
      data: { user: { id: 'admin-1', is_developer: false } },
      params: { id: 'user-1' },
    })

    expect(response.status).toBe(500)
    expect(sentEvents(fetchMock)).toEqual([])
    expect(writes.some((sql) => sql.includes('provider_participant_id = NULL'))).toBe(true)
    await expect(response.json()).resolves.toMatchObject({
      accessRevocationPending: true,
      user: { isSuspended: true },
    })
  })
})
