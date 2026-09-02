import { describe, expect, it, vi } from 'vitest'
import {
  onRequestGet as getMessages,
  onRequestPost as postMessage,
} from '../functions/api/rooms/[roomId]/messages.js'

function messageDb({ videoRole = 'interviewer', messages = [] } = {}) {
  const calls = []
  const batches = []
  return {
    calls,
    batches,
    prepare(sql) {
      let values = []
      const statement = {
        bind(...bound) {
          values = bound
          calls.push({ sql, values })
          return statement
        },
        async first() {
          if (sql.includes('JOIN interview_sessions s')) {
            return {
              id: 'room-1',
              company_user_id: 'host-1',
              title: '개발자 면접',
              status: 'active',
              archived_at: null,
              last_message_email_at: null,
              interview_session_id: 'session-1',
              video_role: videoRole,
            }
          }
          if (sql.includes('INSERT INTO chat_messages')) {
            return { id: 31, created_at: '2026-09-03 00:00:00' }
          }
          if (sql.includes('room_participants rp JOIN users')) return null
          return null
        },
        async all() {
          if (sql.includes('FROM chat_messages m')) return { results: messages }
          return { results: [] }
        },
        async run() {
          return { meta: { changes: 1 } }
        },
      }
      return statement
    },
    async batch(statements) {
      batches.push(statements)
      return statements.map(() => ({ success: true }))
    },
  }
}

const interviewer = {
  id: 'interviewer-1',
  display_name: '면접관',
  company_name: '회사',
  is_admin: 0,
}

describe('화상 면접 공개 채팅 권한', () => {
  it('세션 모드 GET은 등록된 면접관에게 해당 세션 메시지만 조회한다', async () => {
    const db = messageDb({
      messages: [
        {
          id: 30,
          sender_user_id: 'candidate-1',
          sender_name: '지원자',
          body: '안녕하세요.',
          created_at: '2026-09-03 00:00:00',
          interview_session_id: 'session-1',
        },
      ],
    })
    const response = await getMessages({
      request: new Request(
        'https://example.test/api/rooms/room-1/messages?after=20&interviewSessionId=session-1'
      ),
      env: { DB: db },
      data: { user: interviewer },
      params: { roomId: 'room-1' },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      messages: [{ id: 30, interviewSessionId: 'session-1' }],
    })
    const query = db.calls.find((call) => call.sql.includes('FROM chat_messages m'))
    expect(query.sql).toContain('m.interview_session_id = ?')
    expect(query.values).toEqual(['room-1', 20, 'session-1', 'session-1'])
  })

  it('세션 모드 POST는 세션 ID를 저장하면서 기존 처우 추출 흐름을 그대로 탄다', async () => {
    const db = messageDb()
    const response = await postMessage({
      request: new Request('https://example.test/api/rooms/room-1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: '월 급여는 300만원입니다.',
          interviewSessionId: 'session-1',
        }),
      }),
      env: { DB: db },
      data: { user: interviewer },
      params: { roomId: 'room-1' },
      waitUntil: vi.fn(),
    })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      id: 31,
      interviewSessionId: 'session-1',
      negotiationAdded: [{ field: 'wageBaseAmount' }],
    })
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO chat_messages'))
    expect(insert.values).toEqual([
      'room-1',
      'interviewer-1',
      '월 급여는 300만원입니다.',
      'session-1',
    ])
    expect(db.batches).toHaveLength(1)
  })

  it('observer와 관리자는 세션 ID를 붙여도 공개 채팅을 사용할 수 없다', async () => {
    const observerDb = messageDb({ videoRole: 'observer' })
    const observerResponse = await getMessages({
      request: new Request(
        'https://example.test/api/rooms/room-1/messages?interviewSessionId=session-1'
      ),
      env: { DB: observerDb },
      data: { user: { ...interviewer, id: 'observer-1' } },
      params: { roomId: 'room-1' },
    })
    expect(observerResponse.status).toBe(403)
    expect(observerDb.calls.some((call) => call.sql.includes('FROM chat_messages m'))).toBe(false)

    const adminResponse = await getMessages({
      request: new Request(
        'https://example.test/api/rooms/room-1/messages?interviewSessionId=session-1'
      ),
      env: { DB: messageDb() },
      data: { user: { ...interviewer, id: 'admin-1', is_admin: 1 } },
      params: { roomId: 'room-1' },
    })
    expect(adminResponse.status).toBe(403)
  })

  it('POST query에만 세션 ID가 있으면 일반 방 메시지로 저장하지 않는다', async () => {
    const db = messageDb()
    const response = await postMessage({
      request: new Request(
        'https://example.test/api/rooms/room-1/messages?interviewSessionId=session-1',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'scope 없는 메시지' }),
        }
      ),
      env: { DB: db },
      data: { user: interviewer },
      params: { roomId: 'room-1' },
    })
    expect(response.status).toBe(400)
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO chat_messages'))).toBe(false)
  })
})
