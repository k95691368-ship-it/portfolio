import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CONSENT_NOTICE,
  CONSENT_NOTICE_HASH,
  configuredPresetForRole,
  consentIsCurrent,
  getInterviewSessionAccess,
  mapProviderRecordingStatus,
  mapProviderSessionStatus,
  presetForRole,
  retentionHasExpired,
  roleFromRoomRole,
  serializeSession,
  normalizeProviderRecording,
} from '../functions/_lib/interviews.js'
import {
  RealtimeKitConfigError,
  addParticipant,
  createMeeting,
  deleteMeeting,
  getRealtimeKitConfig,
  startRecording,
} from '../functions/_lib/realtimekit.js'
import {
  adoptDirectRecordingFromR2,
  directRecordingKey,
  recordingFilePrefix,
} from '../functions/_lib/interviewRecordings.js'
import { onRequestPost as storeConsent } from '../functions/api/rooms/[roomId]/interviews/[sessionId]/consent.js'
import { onRequestPost as createInterviewSession } from '../functions/api/rooms/[roomId]/interviews/index.js'
import { onRequestPost as issueJoinToken } from '../functions/api/rooms/[roomId]/interviews/[sessionId]/join-token.js'
import { onRequestPost as startInterviewRecording } from '../functions/api/rooms/[roomId]/interviews/[sessionId]/recording/start.js'
import { onRequestPatch as updateInterviewSession } from '../functions/api/rooms/[roomId]/interviews/[sessionId]/index.js'
import { parseRange } from '../functions/api/rooms/[roomId]/interviews/[sessionId]/recordings/[recordingId]/file.js'
import { onRequestPost as retryRecordingStorage } from '../functions/api/rooms/[roomId]/interviews/[sessionId]/recordings/[recordingId]/retry.js'
import {
  onRequestPost as handleRealtimeKitWebhook,
  applyEvent,
  parseRealtimeKitEvent,
  loadWebhookPublicKey,
  verifyWebhookSignature,
} from '../functions/webhooks/realtimekit.js'

const RTK_ENV = {
  CLOUDFLARE_ACCOUNT_ID: 'account-1',
  REALTIMEKIT_APP_ID: 'app-1',
  REALTIMEKIT_API_TOKEN: 'server-secret',
  REALTIMEKIT_HOST_PRESET: 'interview_host',
  REALTIMEKIT_INTERVIEWER_PRESET: 'interview_interviewer',
  REALTIMEKIT_CANDIDATE_PRESET: 'interview_candidate',
  REALTIMEKIT_OBSERVER_PRESET: 'interview_observer',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('화상 면접 정책', () => {
  it('방 역할과 화상 역할을 분리한다', () => {
    expect(roleFromRoomRole('company')).toBe('host')
    expect(roleFromRoomRole('candidate')).toBe('candidate')
    expect(roleFromRoomRole('admin')).toBeNull()
    expect(presetForRole({}, 'host')).toBe('group_call_host')
    expect(presetForRole({}, 'candidate')).toBe('group_call_participant')
    expect(configuredPresetForRole(RTK_ENV, 'candidate')).toBe('interview_candidate')
  })

  it('녹화 동의문 해시가 화면에 내려가는 실제 문구와 일치한다', async () => {
    const noticeText = [
      `목적: ${CONSENT_NOTICE.purpose}`,
      `수집·이용 항목: ${CONSENT_NOTICE.items}`,
      `보유 기간: ${CONSENT_NOTICE.retention}`,
      `동의 거부 시 영향: ${CONSENT_NOTICE.refusalEffect}`,
    ].join('\n')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(noticeText))
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    expect(hex).toBe(CONSENT_NOTICE_HASH)
    expect(CONSENT_NOTICE.refusalEffect).toContain('입장할 수 없습니다')
  })

  it('현재 버전·해시의 허용만 유효한 동의다', () => {
    const current = {
      granted: 1,
      notice_version: CONSENT_NOTICE.version,
      notice_hash: CONSENT_NOTICE.hash,
      revoked_at: null,
    }
    expect(consentIsCurrent(current)).toBe(true)
    expect(consentIsCurrent({ ...current, granted: 0 })).toBe(false)
    expect(consentIsCurrent({ ...current, notice_hash: 'old' })).toBe(false)
    expect(consentIsCurrent({ ...current, revoked_at: '2026-09-02' })).toBe(false)
  })

  it('동의 미응답과 명시 거절을 별도 값으로 직렬화한다', () => {
    expect(
      serializeSession({
        id: 's1',
        room_id: 'r1',
        title: '면접',
        status: 'scheduled',
        recording_required: 1,
        my_consent_decided: 0,
        my_consent_granted: 0,
      })
    ).toMatchObject({ myConsentDecided: false, myConsentGranted: false })
    expect(
      serializeSession({
        id: 's1',
        room_id: 'r1',
        title: '면접',
        status: 'scheduled',
        recording_required: 1,
        my_consent_decided: 1,
        my_consent_granted: 0,
      })
    ).toMatchObject({ myConsentDecided: true, myConsentGranted: false })
  })

  it('공급자 상태를 알려진 내부 상태만으로 제한한다', () => {
    expect(mapProviderSessionStatus('LIVE')).toBe('live')
    expect(mapProviderSessionStatus('unknown')).toBeNull()
    expect(mapProviderRecordingStatus('INVOKED')).toBe('starting')
    expect(mapProviderRecordingStatus('UPLOADED')).toBe('available')
    expect(mapProviderRecordingStatus('something-new')).toBeNull()
  })

  it('공급자 recording 중첩 응답도 같은 구조로 정규화한다', () => {
    expect(
      normalizeProviderRecording({
        recording: {
          id: 'recording-1',
          status: 'UPLOADED',
          output_file_name: 'recording_local_meeting.mp4',
          file_size: '1024',
        },
      })
    ).toMatchObject({
      providerRecordingId: 'recording-1',
      status: 'available',
      filename: 'recording_local_meeting.mp4',
      sizeBytes: 1024,
    })
  })

  it('잘못된 보존 만료 값은 파일을 계속 열어 두지 않는다', () => {
    expect(retentionHasExpired(null)).toBe(false)
    expect(retentionHasExpired('읽을 수 없는 날짜')).toBe(true)
    expect(retentionHasExpired('2026-09-02 00:00:00', Date.UTC(2026, 8, 3))).toBe(true)
    expect(retentionHasExpired('2026-09-04T00:00:00Z', Date.UTC(2026, 8, 3))).toBe(false)
  })

  it('한 면접방에는 예정·대기·진행 세션 하나만 허용하는 D1 제약이 있다', () => {
    const migration = readFileSync(
      new URL('../migrations/0056_video_interviews.sql', import.meta.url),
      'utf8'
    )
    expect(migration).toContain('CREATE UNIQUE INDEX idx_interview_sessions_one_active_per_room')
    expect(migration).toContain("WHERE status IN ('scheduled', 'waiting', 'live')")
  })
})

describe('RealtimeKit 서버 API 래퍼', () => {
  it('필수 설정이 빠지면 외부 요청 전에 중단한다', () => {
    expect(() => getRealtimeKitConfig({})).toThrow(RealtimeKitConfigError)
  })

  it('회의 자동 녹화와 공급자 채팅 보존을 끄고 생성한다', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ success: true, data: { id: 'meeting-1' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(createMeeting(RTK_ENV, { title: '개발 면접' })).resolves.toEqual({
      id: 'meeting-1',
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account-1/realtime/kit/app-1/meetings'
    )
    expect(options.headers.Authorization).toBe('Bearer server-secret')
    expect(JSON.parse(options.body)).toEqual({
      title: '개발 면접',
      record_on_start: false,
      persist_chat: false,
    })
  })

  it('authToken 응답 변형을 내부 token 필드로 정규화한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ success: true, data: { id: 'participant-1', authToken: 'short-lived' } })
      )
    )
    const result = await addParticipant(RTK_ENV, {
      meetingId: 'meeting-1',
      customParticipantId: 'opaque-uuid',
      presetName: 'group_call_participant',
      name: '지원자',
    })
    expect(result).toMatchObject({ id: 'participant-1', token: 'short-lived' })
  })

  it('녹화 요청에 H264 영상 설정을 명시한다', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ success: true, data: { id: 'recording-1', status: 'INVOKED' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    await startRecording(
      {
        ...RTK_ENV,
        INTERVIEW_R2_ACCESS_KEY_ID: 'must-not-be-sent',
        INTERVIEW_R2_SECRET_ACCESS_KEY: 'must-not-be-sent-either',
      },
      { meetingId: 'meeting-1', fileNamePrefix: 'recording_local_1' }
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      meeting_id: 'meeting-1',
      allow_multiple_recordings: false,
      file_name_prefix: 'recording_local_1',
      video_config: { codec: 'H264' },
    })
    expect(fetchMock.mock.calls[0][1].body).not.toContain('must-not-be-sent')
  })

  it('앱 수준 R2 업로드 파일은 로컬 녹화 ID 접두사와 안전한 경로만 채택한다', async () => {
    const id = '018f23ad-6c37-7b03-9000-fd82908aa111'
    const filename = `${recordingFilePrefix(id)}_meeting_20260902.mp4`
    const writes = []
    const env = {
      REALTIMEKIT_DIRECT_R2_PATH: 'interviews',
      INTERVIEW_RECORDINGS: {
        head: vi.fn(async () => ({
          size: 4096,
          httpMetadata: { contentType: 'video/mp4' },
        })),
      },
      DB: {
        prepare(sql) {
          const statement = {
            bind(...values) {
              writes.push({ sql, values })
              return statement
            },
            async run() {
              return { meta: { changes: 1 } }
            },
          }
          return statement
        },
      },
    }
    expect(directRecordingKey(env, { id, filename })).toBe(`interviews/${filename}`)
    const koreanFilename = `${recordingFilePrefix(id)}_개발자_면접_20260902.mp4`
    expect(directRecordingKey(env, { id, filename: koreanFilename })).toBe(
      `interviews/${koreanFilename}`
    )
    expect(
      directRecordingKey(env, { id, filename: '../recording_other_file.mp4' })
    ).toBeNull()
    expect(
      directRecordingKey(env, { id, filename: `${recordingFilePrefix(id)}_bad\\name.mp4` })
    ).toBeNull()
    await expect(
      adoptDirectRecordingFromR2(env, {
        id,
        filename,
        stoppedAt: '2026-09-02T12:00:00Z',
      })
    ).resolves.toMatchObject({ key: `interviews/${filename}`, size: 4096 })
    expect(writes[0].sql).toContain("storage_status = 'stored'")
    expect(writes[0].sql).toContain("status = 'available'")
    expect(writes[0].sql).toContain("datetime('now', '-10 minutes')")
    expect(writes[0].sql).toContain("COALESCE(\n              datetime(?, '+30 days')")
    expect(JSON.stringify(writes)).not.toContain('secret')
  })

  it('방 삭제 잠금과 경합한 direct 녹화는 DB에 채택하지 않고 R2 객체를 정리한다', async () => {
    const id = '018f23ad-6c37-7b03-9000-fd82908aa444'
    const filename = `${recordingFilePrefix(id)}_삭제경합.mp4`
    const remove = vi.fn(async () => undefined)
    const env = {
      REALTIMEKIT_DIRECT_R2_PATH: 'interviews',
      INTERVIEW_RECORDINGS: {
        head: vi.fn(async () => ({ size: 2048 })),
        delete: remove,
      },
      DB: {
        prepare() {
          const statement = {
            bind() {
              return statement
            },
            async run() {
              return { meta: { changes: 0 } }
            },
          }
          return statement
        },
      },
    }
    await expect(
      adoptDirectRecordingFromR2(env, { id, filename })
    ).resolves.toBeNull()
    expect(remove).toHaveBeenCalledWith(`interviews/${filename}`)
  })

  it('삭제 API가 없는 공급자 회의는 INACTIVE로 비활성화한다', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ success: true, data: { id: 'meeting-1', status: 'INACTIVE' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    await deleteMeeting(RTK_ENV, { meetingId: 'meeting-1' })
    expect(fetchMock.mock.calls[0][0]).toContain('/meetings/meeting-1')
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'INACTIVE' })
  })
})

function routeDb({
  consented,
  missingConsentCount = 0,
  presentCount = 0,
  role = 'candidate',
  admitted = false,
  activeRecording = null,
  timeline = null,
  consentWriteFails = false,
  recordingLinkWriteFails = false,
  consentReadSequence = null,
  memberReadSequence = null,
  userActiveSequence = null,
  admittedWriteChanges = 1,
  recordingRequired = true,
}) {
  const writes = []
  const queries = []
  const room = {
    id: 'room-1',
    company_user_id: 'company-1',
    title: '개발자 면접',
    status: 'active',
    archived_at: null,
  }
  const session = {
    id: 'session-1',
    room_id: 'room-1',
    provider_meeting_id: 'meeting-1',
    title: '개발자 면접',
    status: 'waiting',
    recording_required: recordingRequired ? 1 : 0,
    my_role: role === 'company' ? 'host' : 'candidate',
    my_consent_decided: consented ? 1 : 0,
    my_consent_granted: consented ? 1 : 0,
  }
  const member = {
    session_id: 'session-1',
    user_id: role === 'company' ? 'company-1' : 'candidate-1',
    role: role === 'company' ? 'host' : 'candidate',
    custom_participant_id: 'opaque-member-id',
    provider_participant_id: admitted ? 'provider-participant-1' : null,
    admitted_at: admitted ? '2026-09-02 12:00:00' : null,
    joined_at: admitted ? '2026-09-02 12:00:01' : null,
    left_at: null,
  }
  const consent = consented
    ? {
        granted: 1,
        notice_version: CONSENT_NOTICE.version,
        notice_hash: CONSENT_NOTICE.hash,
        revoked_at: null,
      }
    : null
  let consentReadIndex = 0
  let memberReadIndex = 0
  let userActiveReadIndex = 0

  return {
    writes,
    queries,
    prepare(sql) {
      queries.push(sql)
      let values = []
      const statement = {
        bind(...bound) {
          values = bound
          return statement
        },
        async first() {
          if (sql.includes('JOIN interview_sessions s')) {
            return {
              ...room,
              interview_session_id: session.id,
              video_role: session.my_role,
            }
          }
          if (sql.includes('FROM interview_rooms WHERE')) return room
          if (sql.includes('SELECT role_in_room FROM room_participants')) {
            return { role_in_room: role }
          }
          if (sql.includes('FROM interview_sessions s')) return session
          if (sql.includes('COUNT(*) AS count') && sql.includes('interview_session_members m')) {
            return {
              count: sql.includes('interview_recording_consents')
                ? missingConsentCount
                : presentCount,
            }
          }
          if (sql.includes('FROM interview_session_members WHERE')) {
            if (memberReadSequence) {
              const patch = memberReadSequence[
                Math.min(memberReadIndex++, memberReadSequence.length - 1)
              ]
              return { ...member, ...patch }
            }
            return member
          }
          if (sql.includes('FROM interview_recording_consents')) {
            if (consentReadSequence) {
              const granted = consentReadSequence[
                Math.min(consentReadIndex++, consentReadSequence.length - 1)
              ]
              return granted ? consent : null
            }
            return consent
          }
          if (sql.includes('SELECT is_suspended FROM users')) {
            const active = userActiveSequence
              ? userActiveSequence[
                  Math.min(userActiveReadIndex++, userActiveSequence.length - 1)
                ]
              : true
            return active ? { is_suspended: 0 } : { is_suspended: 1 }
          }
          if (sql.includes('FROM interview_recordings')) return activeRecording
          return null
        },
        async all() {
          return { results: [] }
        },
        async run() {
          if (consentWriteFails && sql.includes('INSERT INTO interview_recording_consents')) {
            throw new Error('d1 unavailable')
          }
          if (
            recordingLinkWriteFails &&
            sql.includes('SET provider_recording_id = ?, provider_session_id = ?')
          ) {
            throw new Error('d1 recording link unavailable')
          }
          writes.push({ sql, values })
          if (timeline) {
            timeline.push(
              sql.includes('INSERT INTO interview_recording_consents')
                ? 'consent-written'
                : sql.includes("status = 'cancelled'")
                  ? 'cancelled-written'
                : 'db-write'
            )
          }
          return {
            meta: {
              changes: sql.includes('UPDATE interview_session_members') &&
                sql.includes('active_user.is_suspended')
                ? admittedWriteChanges
                : 1,
            },
          }
        },
      }
      return statement
    },
  }
}

describe('입장과 녹화 서버 차단', () => {
  it('기존 active 세션이 있으면 새 provider meeting을 만들기 전에 409로 반환한다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const db = {
      prepare(sql) {
        const statement = {
          bind() {
            return statement
          },
          async first() {
            if (sql.includes('FROM interview_rooms WHERE')) {
              return {
                id: 'room-1',
                company_user_id: 'company-1',
                title: '개발자 면접',
                status: 'active',
                archived_at: null,
              }
            }
            if (sql.includes('SELECT role_in_room FROM room_participants')) {
              return { role_in_room: 'company' }
            }
            if (sql.includes("status IN ('scheduled','waiting','live')")) {
              return { id: 'session-existing' }
            }
            if (sql.includes('FROM interview_sessions s')) {
              return {
                id: 'session-existing',
                room_id: 'room-1',
                title: '기존 면접',
                status: 'waiting',
                recording_required: 1,
                my_role: 'host',
              }
            }
            return null
          },
        }
        return statement
      },
    }
    const response = await createInterviewSession({
      request: new Request('https://example.test/api/rooms/room-1/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '중복 면접' }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'company-1' } },
      params: { roomId: 'room-1' },
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      session: { id: 'session-existing' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('관리자 삭제 잠금과 경합한 세션 생성은 D1 저장을 거부하고 provider meeting을 정리한다', async () => {
    const prepared = []
    const db = {
      prepare(sql) {
        prepared.push(sql)
        const statement = {
          sql,
          bind() {
            return statement
          },
          async first() {
            if (sql.includes('FROM interview_rooms WHERE')) {
              return {
                id: 'room-1',
                company_user_id: 'company-1',
                title: '개발자 면접',
                status: 'active',
                archived_at: null,
              }
            }
            if (sql.includes('SELECT role_in_room FROM room_participants')) {
              return { role_in_room: 'company' }
            }
            return null
          },
          async all() {
            if (sql.includes('user_id, role_in_room FROM room_participants')) {
              return { results: [{ user_id: 'company-1', role_in_room: 'company' }] }
            }
            return { results: [] }
          },
        }
        return statement
      },
      async batch(statements) {
        return statements.map((_, index) => ({ meta: { changes: index === 0 ? 0 : 1 } }))
      },
    }
    const fetchMock = vi.fn(async (_url, options) =>
      options.method === 'POST'
        ? Response.json({ success: true, data: { id: 'provider-meeting-race' } })
        : Response.json({ success: true, data: { status: 'INACTIVE' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = await createInterviewSession({
      request: new Request('https://example.test/api/rooms/room-1/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '경합 면접' }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'company-1' } },
      params: { roomId: 'room-1' },
    })
    expect(response.status).toBe(500)
    expect(prepared.some((sql) => sql.includes('interview_room_deletion_locks'))).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ status: 'INACTIVE' })
  })

  it('현재 녹화 동의가 없으면 공급자 토큰을 요청하지 않는다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const env = { ...RTK_ENV, DB: routeDb({ consented: false }) }
    const response = await issueJoinToken({
      env,
      data: { user: { id: 'candidate-1', display_name: '지원자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('동의') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('동의한 참가자에게만 단기 토큰을 돌려주고 DB에는 토큰을 쓰지 않는다', async () => {
    const db = routeDb({ consented: true })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          success: true,
          data: { id: 'participant-1', authToken: 'do-not-persist-this-token' },
        })
      )
    )
    const response = await issueJoinToken({
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'candidate-1', display_name: '지원자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ authToken: 'do-not-persist-this-token' })
    expect(JSON.stringify(db.writes)).not.toContain('do-not-persist-this-token')
    expect(
      db.writes.some(
        (write) =>
          write.sql.includes('UPDATE interview_session_members') &&
          write.sql.includes('left_at = NULL')
      )
    ).toBe(true)
  })

  it('공급자 토큰 반환 직전 동의가 철회되면 토큰을 반환하지 않고 참가자를 폐기한다', async () => {
    const db = routeDb({ consented: true, consentReadSequence: [true, true, false] })
    const fetchMock = vi.fn(async () =>
      Response.json({
        success: true,
        data: { id: 'participant-1', authToken: 'must-never-be-returned' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = await issueJoinToken({
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'candidate-1', display_name: '지원자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('must-never-be-returned')
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/active-session/kick'))
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          String(url).endsWith('/participants/participant-1') && options.method === 'DELETE'
      )
    ).toBe(true)
  })

  it('동의 경합에서 개별 kick 또는 delete가 실패하면 녹화·현재 session·meeting을 모두 닫는다', async () => {
    const db = routeDb({
      consented: true,
      consentReadSequence: [true, true, false],
      activeRecording: {
        id: 'recording-local-race',
        provider_recording_id: 'recording-provider-race',
        status: 'recording',
      },
    })
    const fetchMock = vi.fn(async (url, options) => {
      const target = String(url)
      if (target.endsWith('/participants') && options.method === 'POST') {
        return Response.json({
          success: true,
          data: { id: 'participant-race', authToken: 'must-not-escape' },
        })
      }
      if (target.includes('/active-session/kick-all')) {
        return Response.json({ success: true, data: { kicked: true } })
      }
      if (target.includes('/active-session/kick')) {
        return Response.json(
          { success: false, errors: [{ message: 'kick unavailable' }] },
          { status: 503 }
        )
      }
      if (target.endsWith('/participants/participant-race') && options.method === 'DELETE') {
        return Response.json(
          { success: false, errors: [{ message: 'delete unavailable' }] },
          { status: 503 }
        )
      }
      if (target.includes('/recordings/recording-provider-race')) {
        return Response.json({
          success: true,
          data: { id: 'recording-provider-race', status: 'UPLOADING' },
        })
      }
      return Response.json({ success: true, data: { status: 'INACTIVE' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const response = await issueJoinToken({
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'candidate-1', display_name: '지원자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('must-not-escape')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/recordings/recording-provider-race'))).toBe(true)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/active-session/kick-all'))).toBe(true)
    expect(fetchMock.mock.calls.some(([, options]) => options.method === 'PATCH')).toBe(true)
    expect(db.writes.some((write) => write.sql.includes("SET status = 'failed'"))).toBe(true)
  })

  it('비녹화 세션도 provider 참가자 생성 중 계정이 정지되면 토큰을 반환하지 않는다', async () => {
    const db = routeDb({
      consented: false,
      recordingRequired: false,
      admittedWriteChanges: 0,
      userActiveSequence: [false],
    })
    const fetchMock = vi.fn(async (url, options) => {
      const target = String(url)
      if (target.endsWith('/participants') && options.method === 'POST') {
        return Response.json({
          success: true,
          data: { id: 'participant-suspended', authToken: 'must-not-be-returned' },
        })
      }
      return Response.json({ success: true, data: { removed: true } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const response = await issueJoinToken({
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'candidate-1', display_name: '지원자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('must-not-be-returned')
    expect(
      db.writes.find((write) =>
        write.sql.includes('active_user.is_suspended = 0')
      )?.values
    ).toBeTruthy()
    expect(db.queries.filter((sql) => sql.includes('SELECT is_suspended FROM users'))).toHaveLength(1)
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/active-session/kick'))
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          String(url).endsWith('/participants/participant-suspended') &&
          options.method === 'DELETE'
      )
    ).toBe(true)
  })

  it('철회 저장 직전에 입장된 참가자는 최신 member를 다시 읽어 퇴장시킨다', async () => {
    const db = routeDb({
      consented: true,
      memberReadSequence: [
        { admitted_at: null, joined_at: null, provider_participant_id: null },
        {
          admitted_at: '2026-09-03 00:00:00',
          joined_at: null,
          left_at: '2026-09-03 00:00:01',
          provider_participant_id: 'provider-participant-race',
        },
      ],
    })
    const fetchMock = vi.fn(async () => Response.json({ success: true, data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await storeConsent({
      request: new Request('https://example.test/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          granted: false,
          noticeVersion: CONSENT_NOTICE.version,
          noticeHash: CONSENT_NOTICE.hash,
        }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'candidate-1', display_name: '지원자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(200)
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          String(url).endsWith('/participants/provider-participant-race') &&
          options.method === 'DELETE'
      )
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/active-session/kick'))
    ).toBe(true)
  })

  it('역할별 전용 preset이 없으면 공급자 참가자를 만들기 전에 차단한다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await issueJoinToken({
      env: {
        ...RTK_ENV,
        REALTIMEKIT_CANDIDATE_PRESET: '',
        DB: routeDb({ consented: true }),
      },
      data: { user: { id: 'candidate-1', display_name: '지원자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('이미 입장한 사람 중 한 명이라도 미동의면 녹화 시작을 차단한다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const db = routeDb({ consented: true, missingConsentCount: 1, role: 'company' })
    const response = await startInterviewRecording({
      env: {
        ...RTK_ENV,
        DB: db,
      },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ missingConsentCount: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      db.queries.find((sql) => sql.includes('COUNT(*) AS count'))
    ).toContain('m.left_at IS NULL')
  })

  it('직접 R2 보관 설정이 없으면 공급자 녹화를 시작하지 않는다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const db = routeDb({ consented: true, role: 'company' })
    const response = await startInterviewRecording({
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.writes.some((write) => write.sql.includes('INSERT INTO interview_recordings'))).toBe(false)
  })

  it('provider 녹화 시작 후 D1 연결 저장·stop이 실패하면 session 종료와 INACTIVE까지 확인한다', async () => {
    const db = routeDb({
      consented: true,
      role: 'company',
      recordingLinkWriteFails: true,
    })
    const fetchMock = vi.fn(async (url, options) => {
      if (String(url).endsWith('/recordings') && options.method === 'POST') {
        return Response.json({
          success: true,
          data: { id: 'provider-recording-race', status: 'RECORDING' },
        })
      }
      if (options.method === 'PUT') {
        return Response.json(
          { success: false, errors: [{ message: 'stop unavailable' }] },
          { status: 503 }
        )
      }
      return Response.json({ success: true, data: { status: 'INACTIVE' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const response = await startInterviewRecording({
      env: {
        ...RTK_ENV,
        DB: db,
        REALTIMEKIT_DIRECT_R2_PATH: 'interviews',
        INTERVIEW_RECORDINGS: {},
      },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[1][0]).toContain('/recordings/provider-recording-race')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: 'stop' })
    expect(fetchMock.mock.calls[2][0]).toContain('/active-session/kick-all')
    expect(fetchMock.mock.calls[3][1].method).toBe('PATCH')
    expect(
      db.writes.some((write) => write.sql.includes("status = 'failed'"))
    ).toBe(true)
  })

  it('녹화 start 응답이 유실되면 session 종료와 INACTIVE를 확인해 orphan 녹화를 막는다', async () => {
    const db = routeDb({ consented: true, role: 'company' })
    const fetchMock = vi.fn(async (url, _options) => {
      if (String(url).endsWith('/recordings')) {
        return Response.json(
          { success: false, errors: [{ message: 'upstream timeout' }] },
          { status: 504 }
        )
      }
      return Response.json({ success: true, data: { status: 'INACTIVE' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const response = await startInterviewRecording({
      env: {
        ...RTK_ENV,
        DB: db,
        REALTIMEKIT_DIRECT_R2_PATH: 'interviews',
        INTERVIEW_RECORDINGS: {},
      },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toContain('/active-session/kick-all')
    expect(fetchMock.mock.calls[2][1].method).toBe('PATCH')
  })

  it('provider recording ID만 있고 상태가 빠진 응답은 해당 녹화를 stop한다', async () => {
    const db = routeDb({ consented: true, role: 'company' })
    const fetchMock = vi.fn(async (url, options) =>
      String(url).endsWith('/recordings') && options.method === 'POST'
        ? Response.json({ success: true, data: { id: 'provider-recording-incomplete' } })
        : Response.json({
            success: true,
            data: { id: 'provider-recording-incomplete', status: 'UPLOADING' },
          })
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = await startInterviewRecording({
      env: {
        ...RTK_ENV,
        DB: db,
        REALTIMEKIT_DIRECT_R2_PATH: 'interviews',
        INTERVIEW_RECORDINGS: {},
      },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('/recordings/provider-recording-incomplete')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: 'stop' })
  })

  it('세션에 등록한 면접관은 일반 방 참여자가 아니어도 그 세션에 접근한다', async () => {
    let roomAccessQueried = false
    const db = {
      prepare(sql) {
        const statement = {
          bind() {
            return statement
          },
          async first() {
            if (sql.includes('JOIN interview_sessions s')) {
              return {
                id: 'room-1',
                company_user_id: 'host-1',
                title: '면접',
                status: 'active',
                archived_at: null,
                interview_session_id: 'session-1',
                video_role: 'interviewer',
              }
            }
            if (sql.includes('room_participants')) roomAccessQueried = true
            return null
          },
        }
        return statement
      },
    }
    await expect(
      getInterviewSessionAccess(db === null ? null : { DB: db }, 'room-1', 'session-1', {
        id: 'interviewer-1',
      })
    ).resolves.toMatchObject({ videoRole: 'interviewer' })
    expect(roomAccessQueried).toBe(false)
  })

  it('세션 멤버가 아닌 회사 참가자는 owner가 아니면 host가 아니라 interviewer다', async () => {
    const db = {
      prepare(sql) {
        const statement = {
          bind() {
            return statement
          },
          async first() {
            if (sql.includes('JOIN interview_sessions s')) {
              return {
                id: 'room-1',
                company_user_id: 'owner-1',
                title: '면접',
                status: 'active',
                archived_at: null,
                interview_session_id: 'session-1',
                video_role: null,
              }
            }
            if (sql.includes('room_participants')) return { role_in_room: 'company' }
            return null
          },
        }
        return statement
      },
    }
    await expect(
      getInterviewSessionAccess({ DB: db }, 'room-1', 'session-1', {
        id: 'interviewer-1',
      })
    ).resolves.toMatchObject({ videoRole: 'interviewer' })
  })

  it('D1에서 재입장을 먼저 차단한 뒤 현재 참가자를 퇴장시키고 공급자 참가 토큰을 폐기한다', async () => {
    const timeline = []
    const db = routeDb({ consented: true, admitted: true, timeline })
    const fetchMock = vi.fn(async () => {
      timeline.push('provider-removal')
      return Response.json({ success: true, data: { action: 'done' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const response = await storeConsent({
      request: new Request('https://example.test/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          granted: false,
          noticeVersion: CONSENT_NOTICE.version,
          noticeHash: CONSENT_NOTICE.hash,
        }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'candidate-1', display_name: '지원자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining('/active-session/kick'),
      expect.stringContaining('/participants/provider-participant-1'),
    ])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      custom_participant_ids: ['opaque-member-id'],
    })
    expect(db.writes.some((write) => write.sql.includes('interview_recording_consents'))).toBe(true)
    expect(timeline.indexOf('consent-written')).toBeLessThan(
      timeline.indexOf('provider-removal')
    )
  })

  it('참가자 퇴장 실패여도 철회 상태를 유지하고 활성 녹화를 안전 중지한다', async () => {
    const timeline = []
    const db = routeDb({
      consented: true,
      admitted: true,
      timeline,
      activeRecording: {
        id: 'recording-local-1',
        provider_recording_id: 'recording-provider-1',
        status: 'recording',
      },
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        timeline.push('provider-removal')
        return Response.json(
          { success: false, errors: [{ message: 'kick failed' }] },
          { status: 500 }
        )
      })
      .mockResolvedValueOnce(
        Response.json(
          { success: false, errors: [{ message: 'delete failed' }] },
          { status: 500 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: { id: 'recording-provider-1', status: 'UPLOADING' },
        })
      )
      .mockResolvedValueOnce(
        Response.json({ success: true, data: { kicked: true } })
      )
      .mockResolvedValueOnce(
        Response.json({ success: true, data: { id: 'meeting-1', status: 'INACTIVE' } })
      )
    vi.stubGlobal('fetch', fetchMock)
    const response = await storeConsent({
      request: new Request('https://example.test/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          granted: false,
          noticeVersion: CONSENT_NOTICE.version,
          noticeHash: CONSENT_NOTICE.hash,
        }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'candidate-1', display_name: '지원자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      granted: false,
      participantRemoved: false,
      recordingSafetyStopped: true,
      activeSessionEnded: true,
      meetingDeactivated: true,
      localSessionClosed: true,
    })
    expect(fetchMock.mock.calls[1][0]).toContain('/participants/provider-participant-1')
    expect(fetchMock.mock.calls[2][0]).toContain('/recordings/recording-provider-1')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: 'stop' })
    expect(fetchMock.mock.calls[3][0]).toContain('/active-session/kick-all')
    expect(fetchMock.mock.calls[4][0]).toContain('/meetings/meeting-1')
    expect(db.writes.some((write) => write.sql.includes('INSERT INTO interview_recording_consents'))).toBe(true)
    expect(timeline.indexOf('consent-written')).toBeLessThan(
      timeline.indexOf('provider-removal')
    )
  })

  it('철회 DB 쓰기가 실패하면 공급자 상태를 건드리기 전에 중단한다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      storeConsent({
        request: new Request('https://example.test/api/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            granted: false,
            noticeVersion: CONSENT_NOTICE.version,
            noticeHash: CONSENT_NOTICE.hash,
          }),
        }),
        env: {
          ...RTK_ENV,
          DB: routeDb({ consented: true, admitted: true, consentWriteFails: true }),
        },
        data: { user: { id: 'candidate-1', display_name: '지원자' } },
        params: { roomId: 'room-1', sessionId: 'session-1' },
      })
    ).rejects.toThrow('d1 unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('기존 세션의 녹화 필수 여부는 같은 값으로도 PATCH할 수 없다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const db = routeDb({ consented: true, role: 'company' })
    const response = await updateInterviewSession({
      request: new Request('https://example.test/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingRequired: true }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('만들 때 확정'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.writes).toHaveLength(0)
    expect(db.queries.some((sql) => sql.includes('COUNT(*) AS count'))).toBe(false)
  })

  it('대기 참가자가 있어도 공급자 회의를 비활성화해 일정 취소와 토큰 폐기를 완료한다', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ success: true, data: { id: 'meeting-1', status: 'INACTIVE' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = await updateInterviewSession({
      request: new Request('https://example.test/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      }),
      env: {
        ...RTK_ENV,
        DB: routeDb({ consented: true, role: 'company', presentCount: 1 }),
      },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/active-session/kick-all')
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ status: 'INACTIVE' })
  })

  it('진행 중인 녹화가 있으면 공급자 meeting과 로컬 일정을 그대로 둔다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const db = routeDb({
      consented: true,
      role: 'company',
      activeRecording: { id: 'recording-1', status: 'recording' },
    })
    const response = await updateInterviewSession({
      request: new Request('https://example.test/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.writes.some((write) => write.sql.includes("status = 'cancelled'"))).toBe(false)
  })

  it('공급자 회의를 먼저 비활성화한 뒤에만 로컬 일정을 취소한다', async () => {
    const timeline = []
    const db = routeDb({ consented: true, role: 'company', timeline })
    const fetchMock = vi.fn(async (_url, options) => {
      timeline.push(options.method === 'POST' ? 'provider-kick-all' : 'provider-inactive')
      return Response.json({ success: true, data: { id: 'meeting-1', status: 'INACTIVE' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const response = await updateInterviewSession({
      request: new Request('https://example.test/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(200)
    expect(timeline.indexOf('provider-kick-all')).toBeLessThan(
      timeline.indexOf('provider-inactive')
    )
    expect(timeline.indexOf('provider-inactive')).toBeLessThan(
      timeline.indexOf('cancelled-written')
    )
  })

  it('공급자 비활성화가 실패하면 로컬 일정을 취소하지 않는다', async () => {
    const db = routeDb({ consented: true, role: 'company' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { success: false, errors: [{ message: 'provider unavailable' }] },
          { status: 503 }
        )
      )
    )
    const response = await updateInterviewSession({
      request: new Request('https://example.test/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      }),
      env: { ...RTK_ENV, DB: db },
      data: { user: { id: 'company-1', display_name: '담당자' } },
      params: { roomId: 'room-1', sessionId: 'session-1' },
    })
    expect(response.status).toBe(502)
    expect(db.writes.some((write) => write.sql.includes("status = 'cancelled'"))).toBe(false)
  })
})

describe('Webhook과 영상 구간 요청', () => {
  it('meeting.ended는 공급자 meeting 비활성화 성공 뒤에만 로컬 종료를 확정한다', async () => {
    const timeline = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        timeline.push('provider-inactive')
        return Response.json({ success: true, data: { status: 'INACTIVE' } })
      })
    )
    const env = {
      ...RTK_ENV,
      DB: {
        prepare() {
          const statement = {
            bind() {
              return statement
            },
            async run() {
              timeline.push('local-ended')
              return { meta: { changes: 1 } }
            },
          }
          return statement
        },
      },
    }
    await applyEvent(
      env,
      {
        type: 'meeting.ended',
        providerSessionId: 'provider-session-1',
        endedAt: '2026-09-03T00:00:00Z',
      },
      { id: 'session-1', provider_meeting_id: 'meeting-1' }
    )
    expect(timeline).toEqual(['provider-inactive', 'local-ended'])
  })

  it('meeting.ended의 공급자 비활성화가 실패하면 로컬 ended를 쓰지 않는다', async () => {
    const writes = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { success: false, errors: [{ message: 'provider unavailable' }] },
          { status: 503 }
        )
      )
    )
    await expect(
      applyEvent(
        {
          ...RTK_ENV,
          DB: {
            prepare(sql) {
              const statement = {
                bind() {
                  return statement
                },
                async run() {
                  writes.push(sql)
                  return { meta: { changes: 1 } }
                },
              }
              return statement
            },
          },
        },
        { type: 'meeting.ended', providerSessionId: null, endedAt: null },
        { id: 'session-1', provider_meeting_id: 'meeting-1' }
      )
    ).rejects.toBeInstanceOf(Error)
    expect(writes).toHaveLength(0)
  })

  it('이미 INACTIVE인 meeting.ended 재시도는 로컬 종료를 멱등 확정한다', async () => {
    const writes = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { success: false, errors: [{ message: 'Meeting is already INACTIVE' }] },
          { status: 409 }
        )
      )
    )
    await applyEvent(
      {
        ...RTK_ENV,
        DB: {
          prepare(sql) {
            const statement = {
              bind() {
                return statement
              },
              async run() {
                writes.push(sql)
                return { meta: { changes: 1 } }
              },
            }
            return statement
          },
        },
      },
      { type: 'meeting.ended', providerSessionId: null, endedAt: null },
      { id: 'session-1', provider_meeting_id: 'meeting-1' }
    )
    expect(writes.some((sql) => sql.includes("SET status = 'ended'"))).toBe(true)
  })

  it('failed 세션은 늦게 도착한 meeting.started로 live에 복귀하지 않는다', async () => {
    const statements = []
    await applyEvent(
      {
        DB: {
          prepare(sql) {
            statements.push(sql)
            const statement = {
              bind() {
                return statement
              },
              async run() {
                return { meta: { changes: 0 } }
              },
            }
            return statement
          },
        },
      },
      { type: 'meeting.started', providerSessionId: null, startedAt: null },
      { id: 'session-1', provider_meeting_id: 'meeting-1' }
    )
    expect(statements[0]).toContain("status NOT IN ('ended','cancelled','failed')")
  })

  it('processing 녹화는 늦게 도착한 recording 이벤트로 recording 상태에 복귀하지 않는다', async () => {
    const writes = []
    await applyEvent(
      {
        DB: {
          prepare(sql) {
            const statement = {
              bind() {
                return statement
              },
              async first() {
                if (sql.includes('SELECT * FROM interview_recordings')) {
                  return {
                    id: 'recording-1',
                    session_id: 'session-1',
                    provider_recording_id: 'provider-recording-1',
                    status: 'processing',
                    storage_status: 'copy_failed',
                    deleted_at: null,
                  }
                }
                return null
              },
              async run() {
                writes.push(sql)
                return { meta: { changes: 1 } }
              },
            }
            return statement
          },
        },
      },
      {
        type: 'recording.statusUpdate',
        recording: {
          providerRecordingId: 'provider-recording-1',
          status: 'recording',
        },
      },
      { id: 'session-1', provider_meeting_id: 'meeting-1' }
    )
    expect(writes).toHaveLength(0)
  })

  it('철회·종료 뒤 늦게 도착한 participantJoined는 멤버를 다시 활성화하지 않는다', async () => {
    const statements = []
    await applyEvent(
      {
        DB: {
          prepare(sql) {
            statements.push(sql)
            const statement = {
              bind() {
                return statement
              },
              async run() {
                return { meta: { changes: 0 } }
              },
            }
            return statement
          },
        },
      },
      {
        type: 'meeting.participantJoined',
        participant: {
          peerId: 'peer-late',
          joinedAt: '2026-09-03T00:00:00Z',
          customParticipantId: 'custom-1',
        },
      },
      { id: 'session-1', provider_meeting_id: 'meeting-1' }
    )
    expect(statements[0]).toContain("s.status IN ('scheduled','waiting','live')")
    expect(statements[0]).toContain('c.granted = 1 AND c.revoked_at IS NULL')
    expect(statements[0]).toContain('datetime(COALESCE(?, \'now\')) > datetime(left_at)')
  })

  it('원문 body의 RSA-SHA256 서명을 확인한다', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )
    const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey)
    const pemBody = Buffer.from(spki).toString('base64').match(/.{1,64}/g).join('\n')
    const pem = `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----`
    const body = new TextEncoder().encode('{"event":"meeting.started"}')
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, body)
    const encodedSignature = Buffer.from(signature).toString('base64')
    await expect(verifyWebhookSignature(pem, encodedSignature, body)).resolves.toBe(true)
    await expect(
      verifyWebhookSignature(pem, encodedSignature, new TextEncoder().encode('{}'))
    ).resolves.toBe(false)
  })

  it('공식 Webhook 필드를 내부 구조로 격리해 읽는다', () => {
    expect(
      parseRealtimeKitEvent({
        event: 'recording.statusUpdate',
        meeting: { id: 'meeting-1', sessionId: 'provider-session-1' },
        recording: {
          recordingId: 'recording-1',
          status: 'UPLOADED',
          downloadUrl: 'https://recordings.example.test/file.mp4',
          fileSize: '2048',
        },
      })
    ).toMatchObject({
      type: 'recording.statusUpdate',
      providerMeetingId: 'meeting-1',
      providerSessionId: 'provider-session-1',
      recording: {
        providerRecordingId: 'recording-1',
        status: 'available',
        sizeBytes: 2048,
      },
    })
  })

  it('고정된 Cloudflare 주소에서만 Webhook 공개 키를 가져온다', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        success: true,
        data: { publicKey: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadWebhookPublicKey({})).resolves.toContain('BEGIN PUBLIC KEY')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.realtime.cloudflare.com/.well-known/webhooks.json',
      expect.any(Object)
    )
  })

  it('같은 webhook을 처리 중인 요청은 소유권을 얻지 못하고 중복 처리하지 않는다', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )
    const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey)
    const pemBody = Buffer.from(spki).toString('base64').match(/.{1,64}/g).join('\n')
    const pem = `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----`
    const raw = JSON.stringify({ event: 'meeting.started', meeting: { id: 'meeting-1' } })
    const signature = Buffer.from(
      await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        keyPair.privateKey,
        new TextEncoder().encode(raw)
      )
    ).toString('base64')
    let applied = false
    let processed = false
    const db = {
      prepare(sql) {
        const statement = {
          bind() {
            return statement
          },
          async first() {
            if (sql.includes('FROM interview_sessions')) {
              return { id: 'session-1', room_id: 'room-1', provider_meeting_id: 'meeting-1' }
            }
            if (sql.includes('processing_started_at FROM interview_events')) {
              return {
                processed_at: processed ? '2026-09-03 00:00:10' : null,
                processing_started_at: '2026-09-03 00:00:00',
              }
            }
            return null
          },
          async run() {
            if (sql.includes('INSERT OR IGNORE INTO interview_events')) {
              return { meta: { changes: 0 } }
            }
            if (sql.includes('SET processing_started_at')) return { meta: { changes: 0 } }
            if (sql.includes("SET status = 'live'")) applied = true
            return { meta: { changes: 1 } }
          },
        }
        return statement
      },
    }
    const response = await handleRealtimeKitWebhook({
      request: new Request('https://example.test/webhooks/realtimekit', {
        method: 'POST',
        headers: { 'rtk-signature': signature, 'rtk-uuid': 'event-1' },
        body: raw,
      }),
      env: { DB: db, REALTIMEKIT_WEBHOOK_PUBLIC_KEY: pem },
    })
    expect(response.status).toBe(503)
    expect(applied).toBe(false)

    processed = true
    const completedDuplicate = await handleRealtimeKitWebhook({
      request: new Request('https://example.test/webhooks/realtimekit', {
        method: 'POST',
        headers: { 'rtk-signature': signature, 'rtk-uuid': 'event-1' },
        body: raw,
      }),
      env: { DB: db, REALTIMEKIT_WEBHOOK_PUBLIC_KEY: pem },
    })
    expect(completedDuplicate.status).toBe(200)
  })

  it('retry는 공급자 refresh에서 받은 파일명으로 direct R2를 다시 확인한다', async () => {
    const id = '018f23ad-6c37-7b03-9000-fd82908aa222'
    const filename = `${recordingFilePrefix(id)}_meeting_20260903.mp4`
    const initial = {
      id,
      session_id: 'session-1',
      provider_recording_id: 'provider-recording-1',
      status: 'processing',
      storage_status: 'copy_failed',
      filename: null,
      r2_key: null,
      retention_until: null,
      deleted_at: null,
    }
    let adopted = false
    const db = {
      prepare(sql) {
        const statement = {
          bind() {
            return statement
          },
          async first() {
            if (sql.includes('JOIN interview_sessions s')) {
              return {
                id: 'room-1',
                status: 'active',
                interview_session_id: 'session-1',
                video_role: 'host',
              }
            }
            if (sql.includes('FROM interview_sessions s')) {
              return {
                id: 'session-1',
                room_id: 'room-1',
                my_role: 'host',
                status: 'ended',
              }
            }
            if (sql.includes('AND session_id = ?')) return initial
            if (sql.includes('SELECT * FROM interview_recordings WHERE id = ?')) {
              return adopted
                ? {
                    ...initial,
                    filename,
                    status: 'available',
                    storage_status: 'stored',
                    r2_key: `interviews/${filename}`,
                    stopped_at: '2026-09-03T00:00:00Z',
                    retention_until: '2026-10-03 00:00:00',
                  }
                : initial
            }
            return null
          },
          async run() {
            if (sql.includes("storage_status = 'stored'")) adopted = true
            return { meta: { changes: 1 } }
          },
        }
        return statement
      },
    }
    const head = vi.fn(async () => ({ size: 8192, httpMetadata: { contentType: 'video/mp4' } }))
    const fetchMock = vi.fn(async () =>
      Response.json({
        success: true,
        data: {
          recording: {
            id: 'provider-recording-1',
            status: 'UPLOADED',
            output_file_name: filename,
            stopped_time: '2026-09-03T00:00:00Z',
          },
        },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = await retryRecordingStorage({
      env: {
        ...RTK_ENV,
        DB: db,
        REALTIMEKIT_DIRECT_R2_PATH: 'interviews',
        INTERVIEW_RECORDINGS: { head },
      },
      data: { user: { id: 'company-1' } },
      params: { roomId: 'room-1', sessionId: 'session-1', recordingId: id },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ direct: true })
    expect(head).toHaveBeenCalledWith(`interviews/${filename}`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('direct R2 객체가 없으면 다운로드 URL을 중계 복사하지 않고 409로 닫는다', async () => {
    const id = '018f23ad-6c37-7b03-9000-fd82908aa333'
    const filename = `${recordingFilePrefix(id)}_긴_면접.mp4`
    const writes = []
    const initial = {
      id,
      session_id: 'session-1',
      provider_recording_id: 'provider-recording-1',
      status: 'processing',
      storage_status: 'copy_failed',
      filename: null,
      r2_key: null,
      retention_until: null,
      deleted_at: null,
    }
    const db = {
      prepare(sql) {
        const statement = {
          bind() {
            return statement
          },
          async first() {
            if (sql.includes('JOIN interview_sessions s')) {
              return {
                id: 'room-1',
                status: 'active',
                interview_session_id: 'session-1',
                video_role: 'host',
              }
            }
            if (sql.includes('FROM interview_sessions s')) {
              return { id: 'session-1', room_id: 'room-1', my_role: 'host', status: 'ended' }
            }
            if (sql.includes('AND session_id = ?')) return initial
            return null
          },
          async run() {
            writes.push(sql)
            return { meta: { changes: 1 } }
          },
        }
        return statement
      },
    }
    const head = vi.fn(async () => null)
    const fetchMock = vi.fn(async () =>
      Response.json({
        success: true,
        data: {
          recording: {
            id: 'provider-recording-1',
            status: 'UPLOADED',
            output_file_name: filename,
            download_url: 'https://recordings.example.test/large.mp4',
          },
        },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = await retryRecordingStorage({
      env: {
        ...RTK_ENV,
        DB: db,
        REALTIMEKIT_DIRECT_R2_PATH: 'interviews',
        INTERVIEW_RECORDINGS: { head },
      },
      data: { user: { id: 'company-1' } },
      params: { roomId: 'room-1', sessionId: 'session-1', recordingId: id },
    })
    expect(response.status).toBe(409)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(head).toHaveBeenCalledWith(`interviews/${filename}`)
    expect(writes.some((sql) => sql.includes("failure_reason = 'recording_object_not_found'"))).toBe(true)
  })

  it('일반·접미·잘못된 Range를 구분한다', () => {
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19, length: 10 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99, length: 10 })
    expect(parseRange('bytes=100-120', 100)).toEqual({ invalid: true })
    expect(parseRange('bytes=0-1,4-5', 100)).toEqual({ invalid: true })
  })
})
