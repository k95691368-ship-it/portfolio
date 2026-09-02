import { describe, expect, it } from 'vitest'
import { onRequest as authMiddleware } from '../functions/api/_middleware.js'

function identityDb() {
  return {
    prepare(sql) {
      const statement = {
        bind() {
          return statement
        },
        async first() {
          if (sql.includes('sessions.scoped_room_id = ?')) {
            return { id: 'candidate-1', display_name: '지원자', is_suspended: 0 }
          }
          if (sql.includes('WHERE sessions.token_hash = ?')) {
            return { id: 'account-1', display_name: '회사 계정', is_suspended: 0 }
          }
          return null
        },
      }
      return statement
    },
  }
}

async function selectedUser(path, cookie) {
  const context = {
    request: new Request(`https://example.test${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env: { DB: identityDb() },
    data: {},
    async next() {
      return Response.json({ userId: context.data.user?.id ?? null })
    },
  }
  const response = await authMiddleware(context)
  return response.json()
}

describe('녹화 파일의 코드 신원 selector', () => {
  const filePath =
    '/api/rooms/room-1/interviews/session-1/recordings/recording-1/file?identity=code'

  it('녹화 파일 GET에서 room_session이 실제로 있을 때만 코드 신원을 고른다', async () => {
    await expect(
      selectedUser(filePath, 'session=account-token; room_session=code-token')
    ).resolves.toEqual({ userId: 'candidate-1' })
    await expect(selectedUser(filePath, 'session=account-token')).resolves.toEqual({
      userId: 'account-1',
    })
  })

  it('같은 query를 다른 API에 붙여도 계정 신원을 바꾸지 않는다', async () => {
    await expect(
      selectedUser(
        '/api/rooms/room-1/interviews/session-1/recordings?identity=code',
        'session=account-token; room_session=code-token'
      )
    ).resolves.toEqual({ userId: 'account-1' })
  })

  it('account를 명시하면 계정 쿠키가 없을 때 room_session으로 대신 로그인하지 않는다', async () => {
    await expect(
      selectedUser(
        '/api/rooms/room-1/interviews/session-1/recordings/recording-1/file?identity=account',
        'room_session=code-token'
      )
    ).resolves.toEqual({ userId: null })
  })
})
