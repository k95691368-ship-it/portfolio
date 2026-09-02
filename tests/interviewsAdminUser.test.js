import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPatch as updateAdminUser } from '../functions/api/admin/users/[id]/index.js'
import { revokeActiveInterviewAccessForUser } from '../functions/_lib/interviewUserAccess.js'

const RTK_ENV = {
  CLOUDFLARE_ACCOUNT_ID: 'account-1',
  REALTIMEKIT_APP_ID: 'app-1',
  REALTIMEKIT_API_TOKEN: 'secret',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function memberDb(
  writes = [],
  members = [
    {
      session_id: 'session-1',
      user_id: 'user-1',
      custom_participant_id: 'custom-user-1',
      provider_participant_id: 'provider-user-1',
      provider_meeting_id: 'meeting-1',
    },
  ],
  activeRecording = null
) {
  return {
    prepare(sql) {
      const statement = {
        bind() {
          return statement
        },
        async all() {
          return { results: members }
        },
        async first() {
          return sql.includes('FROM interview_recordings') ? activeRecording : null
        },
        async run() {
          writes.push(sql)
          return { meta: { changes: 1 } }
        },
      }
      return statement
    },
  }
}

describe('관리자 계정 정지의 화상 면접 접근 폐기', () => {
  it('현재 연결 kick과 participant token 삭제를 모두 확인한다', async () => {
    const writes = []
    const fetchMock = vi.fn(async () => Response.json({ success: true, data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      revokeActiveInterviewAccessForUser(
        { ...RTK_ENV, DB: memberDb(writes) },
        'user-1'
      )
    ).resolves.toEqual({ revokedMemberships: 1 })
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/active-session/kick'))
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          String(url).endsWith('/participants/provider-user-1') && options.method === 'DELETE'
      )
    ).toBe(true)
    expect(writes.some((sql) => sql.includes('provider_participant_id = NULL'))).toBe(true)
  })

  it('개별 폐기 중 하나라도 불확실하면 meeting 전체를 INACTIVE로 닫는다', async () => {
    const writes = []
    const fetchMock = vi.fn(async (url, options) => {
      if (
        options.method === 'PATCH' ||
        options.method === 'PUT' ||
        String(url).includes('/active-session/kick-all')
      ) {
        return Response.json({ success: true, data: { status: 'INACTIVE' } })
      }
      return Response.json(
        { success: false, errors: [{ message: 'participant unavailable' }] },
        { status: 503 }
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    await revokeActiveInterviewAccessForUser(
      {
        ...RTK_ENV,
        DB: memberDb(writes, undefined, {
          id: 'recording-1',
          provider_recording_id: 'provider-recording-1',
        }),
      },
      'user-1'
    )
    const methods = fetchMock.mock.calls.map(([, options]) => options.method)
    expect(methods).toContain('PUT')
    const kickAllIndex = fetchMock.mock.calls.findIndex(([url]) =>
      String(url).includes('/active-session/kick-all')
    )
    expect(methods.indexOf('PUT')).toBeLessThan(kickAllIndex)
    expect(kickAllIndex).toBeLessThan(methods.indexOf('PATCH'))
    expect(writes.some((sql) => sql.includes("SET status = 'failed'"))).toBe(true)
    expect(writes.some((sql) => sql.includes("SET status = 'processing'"))).toBe(true)
  })

  it('provider 전체 종료도 실패하면 계정은 정지 상태로 유지하고 성공 응답을 내지 않는다', async () => {
    const writes = []
    const db = memberDb(writes)
    const originalPrepare = db.prepare.bind(db)
    db.prepare = (sql) => {
      const statement = originalPrepare(sql)
      statement.first = async () =>
        sql.includes('FROM users WHERE id')
          ? { id: 'user-1', email: 'user@example.test', is_admin: 0, is_developer: 0 }
          : null
      return statement
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { success: false, errors: [{ message: 'provider unavailable' }] },
          { status: 503 }
        )
      )
    )
    const response = await updateAdminUser({
      request: new Request('https://example.test/api/admin/users/user-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSuspended: true, isRecruiter: true }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'admin-1', is_developer: false } },
      params: { id: 'user-1' },
    })
    expect(response.status).toBe(502)
    expect(writes[0]).toContain('UPDATE users SET is_suspended = 1')
    const payload = await response.json()
    expect(payload).toMatchObject({
      ok: false,
      accessRevocationPending: true,
      user: { id: 'user-1', isSuspended: true, isRecruiter: true },
    })
    expect(writes[0]).toContain('is_recruiter = ?')
    expect(writes.some((sql) => sql.includes('INSERT INTO admin_audit_log'))).toBe(true)
  })

  it('한 세션 정리가 실패해도 나머지 모든 active membership을 계속 정리한다', async () => {
    const writes = []
    const members = [
      {
        session_id: 'session-1',
        user_id: 'user-1',
        custom_participant_id: 'custom-user-1',
        provider_participant_id: 'provider-user-1',
        provider_meeting_id: 'meeting-1',
      },
      {
        session_id: 'session-2',
        user_id: 'user-1',
        custom_participant_id: 'custom-user-2',
        provider_participant_id: 'provider-user-2',
        provider_meeting_id: 'meeting-2',
      },
    ]
    const fetchMock = vi.fn(async () =>
      Response.json(
        { success: false, errors: [{ message: 'provider unavailable' }] },
        { status: 503 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      revokeActiveInterviewAccessForUser(
        { ...RTK_ENV, DB: memberDb(writes, members) },
        'user-1'
      )
    ).rejects.toMatchObject({ status: 502 })
    expect(
      fetchMock.mock.calls.filter(([, options]) => options.method === 'PATCH')
    ).toHaveLength(2)
  })

  it('app session 삭제가 실패해도 RTK 참가자 정리를 독립적으로 끝까지 시도한다', async () => {
    const writes = []
    const db = memberDb(writes)
    const originalPrepare = db.prepare.bind(db)
    db.prepare = (sql) => {
      const statement = originalPrepare(sql)
      statement.first = async () =>
        sql.includes('FROM users WHERE id')
          ? { id: 'user-1', email: 'user@example.test', is_admin: 0, is_developer: 0 }
          : null
      const originalRun = statement.run
      statement.run = async () => {
        if (sql.includes('DELETE FROM sessions WHERE user_id')) {
          throw new Error('session store unavailable')
        }
        return originalRun()
      }
      return statement
    }
    const fetchMock = vi.fn(async () => Response.json({ success: true, data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await updateAdminUser({
      request: new Request('https://example.test/api/admin/users/user-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSuspended: true }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'admin-1', is_developer: false } },
      params: { id: 'user-1' },
    })
    expect(response.status).toBe(500)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/active-session/kick'))).toBe(true)
    expect(
      fetchMock.mock.calls.some(([, options]) => options.method === 'DELETE')
    ).toBe(true)
    await expect(response.json()).resolves.toMatchObject({
      accessRevocationPending: true,
      user: { isSuspended: true },
    })
  })
})
