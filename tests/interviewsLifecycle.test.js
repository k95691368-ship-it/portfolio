import { describe, expect, it } from 'vitest'
import { onRequestPost as closeRoom } from '../functions/api/rooms/[roomId]/close.js'
import { onRequestPost as archiveRoom } from '../functions/api/rooms/[roomId]/archive.js'

function lifecycleDb() {
  const writes = []
  return {
    writes,
    prepare(sql) {
      const statement = {
        bind() {
          return statement
        },
        async first() {
          if (sql.includes('SELECT role_in_room FROM room_participants')) {
            return { role_in_room: 'company' }
          }
          if (sql.includes('SELECT id, title, status, archived_at FROM interview_rooms')) {
            return {
              id: 'room-1',
              title: '면접방',
              status: 'active',
              archived_at: null,
            }
          }
          if (sql.includes('LEFT JOIN room_participants')) {
            return {
              id: 'room-1',
              title: '면접방',
              status: 'active',
              archived_at: null,
              role_in_room: 'company',
            }
          }
          return null
        },
        async all() {
          return { results: [] }
        },
        async run() {
          writes.push(sql)
          if (sql.includes('UPDATE interview_rooms')) return { meta: { changes: 0 } }
          return { meta: { changes: 1 } }
        },
      }
      return statement
    },
  }
}

describe('면접방 lifecycle과 화상 세션', () => {
  it('활성·예정 화상 세션과 녹화가 있으면 room close를 원자적으로 차단한다', async () => {
    const db = lifecycleDb()
    const response = await closeRoom({
      request: new Request('https://example.test/api/rooms/room-1/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'position_cancelled' }),
      }),
      env: { DB: db },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1' },
    })
    expect(response.status).toBe(409)
    const update = db.writes.find((sql) => sql.includes('UPDATE interview_rooms'))
    expect(update).toContain("video_session.status IN ('scheduled','waiting','live')")
    expect(update).toContain("video_recording.status IN ('starting','recording','paused','stopping','processing')")
  })

  it('활성·예정 화상 세션과 녹화가 있으면 room archive를 원자적으로 차단한다', async () => {
    const db = lifecycleDb()
    const response = await archiveRoom({
      request: new Request('https://example.test/api/rooms/room-1/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      env: { DB: db },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1' },
    })
    expect(response.status).toBe(409)
    const update = db.writes.find((sql) => sql.includes('UPDATE interview_rooms'))
    expect(update).toContain("video_session.status IN ('scheduled','waiting','live')")
    expect(update).toContain("video_recording.status IN ('starting','recording','paused','stopping','processing')")
  })
})
