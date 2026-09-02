import { describe, expect, it, vi } from 'vitest'
import {
  InterviewDeletionError,
  acquireInterviewRoomDeletionLocks,
  prepareInterviewRoomDeletion,
} from '../functions/_lib/interviewDeletion.js'
import { onRequestDelete as deleteAdminRoom } from '../functions/api/admin/rooms/[roomId]/index.js'

function deletionDb({ activeSessions = 0, activeRecordings = 0, files = [] } = {}) {
  return {
    prepare(sql) {
      const statement = {
        bind() {
          return statement
        },
        async first() {
          if (sql.includes('AS active_sessions')) {
            return {
              active_sessions: activeSessions,
              active_recordings: activeRecordings,
            }
          }
          return null
        },
        async all() {
          return { results: files.map((r2_key) => ({ r2_key })) }
        },
      }
      return statement
    },
  }
}

describe('화상 면접이 있는 방 삭제 준비', () => {
  it('중단된 삭제 요청의 10분 지난 lock을 같은 원자 batch에서 정리한 뒤 잠근다', async () => {
    const statements = []
    const db = {
      prepare(sql) {
        const statement = {
          sql,
          bind() {
            return statement
          },
        }
        return statement
      },
      async batch(items) {
        statements.push(...items.map((item) => item.sql))
        return items.map(() => ({ meta: { changes: 1 } }))
      },
    }
    await acquireInterviewRoomDeletionLocks({ DB: db }, ['room-1'], 'lock-1')
    expect(statements[0]).toContain("datetime('now', '-10 minutes')")
    expect(statements[1]).toContain('INSERT INTO interview_room_deletion_locks')
  })

  it('관리자 방 삭제는 화상 preflight 차단 전에 계약 기록·PDF·D1을 변경하지 않는다', async () => {
    const mutations = []
    const removeDocument = vi.fn()
    const db = {
      prepare(sql) {
        const statement = {
          bind() {
            return statement
          },
          async first() {
            if (sql.includes('FROM interview_rooms')) {
              return { id: 'room-1', title: '면접방', status: 'active' }
            }
            if (sql.includes('AS active_sessions')) {
              return { active_sessions: 1, active_recordings: 0 }
            }
            return null
          },
          async all() {
            return { results: [] }
          },
          async run() {
            mutations.push(sql)
            return { meta: { changes: 1 } }
          },
        }
        return statement
      },
      async batch(statements) {
        mutations.push(...statements)
        return []
      },
    }
    const response = await deleteAdminRoom({
      request: new Request('https://example.test/api/admin/rooms/room-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgeRetention: true }),
      }),
      env: { DB: db, DOCUMENTS: { delete: removeDocument } },
      data: { user: { id: 'admin-1' } },
      params: { roomId: 'room-1' },
    })
    expect(response.status).toBe(409)
    expect(mutations).toHaveLength(0)
    expect(removeDocument).not.toHaveBeenCalled()
  })

  it('미종료 세션이나 처리 중 녹화가 있으면 R2와 D1 삭제 전에 막는다', async () => {
    const remove = vi.fn()
    await expect(
      prepareInterviewRoomDeletion(
        {
          DB: deletionDb({ activeSessions: 1, files: ['interviews/file.mp4'] }),
          INTERVIEW_RECORDINGS: { delete: remove },
        },
        ['room-1']
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(remove).not.toHaveBeenCalled()
  })

  it('R2 키가 있는데 binding이 없으면 DB 삭제로 진행하지 않는다', async () => {
    await expect(
      prepareInterviewRoomDeletion(
        { DB: deletionDb({ files: ['interviews/file.mp4'] }) },
        ['room-1']
      )
    ).rejects.toEqual(expect.objectContaining({
      name: 'InterviewDeletionError',
      status: 503,
    }))
  })

  it('R2 객체 삭제가 하나라도 실패하면 fail-closed 한다', async () => {
    const remove = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('r2 unavailable'))
    await expect(
      prepareInterviewRoomDeletion(
        {
          DB: deletionDb({ files: ['interviews/a.mp4', 'interviews/b.mp4'] }),
          INTERVIEW_RECORDINGS: { delete: remove },
        },
        ['room-1']
      )
    ).rejects.toBeInstanceOf(InterviewDeletionError)
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('모든 R2 객체 삭제가 끝난 경우에만 D1 삭제를 계속할 수 있다', async () => {
    const remove = vi.fn(async () => undefined)
    await expect(
      prepareInterviewRoomDeletion(
        {
          DB: deletionDb({ files: ['interviews/a.mp4'] }),
          INTERVIEW_RECORDINGS: { delete: remove },
        },
        ['room-1']
      )
    ).resolves.toEqual({ recordingsDeleted: 1 })
  })
})
