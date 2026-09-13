import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONSENT_NOTICE,
  CONSENT_NOTICE_HASH,
  consentIsCurrent,
  retentionHasExpired,
  roleFromRoomRole,
  serializeSession,
} from '../server/_lib/interviews.js'
import {
  VideoServiceConfigError,
  createMeeting,
  getSupabaseRealtimeConfig,
  issueParticipantCredentials,
  kickParticipants,
} from '../server/_lib/supabaseRealtime.js'
import { parseRange } from '../server/api/rooms/[roomId]/interviews/[sessionId]/recordings/[recordingId]/file.js'
import { createSupabaseStorage } from '../supabase/functions/api/supabaseStorage.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('화상 면접 정책', () => {
  it('방 역할과 화상 역할을 분리한다', () => {
    expect(roleFromRoomRole('company')).toBe('host')
    expect(roleFromRoomRole('candidate')).toBe('candidate')
    expect(roleFromRoomRole('admin')).toBeNull()
  })

  it('녹화 동의문 해시가 실제 안내 문구와 일치한다', async () => {
    const source = [
      `목적: ${CONSENT_NOTICE.purpose}`,
      `수집·이용 항목: ${CONSENT_NOTICE.items}`,
      `보유 기간: ${CONSENT_NOTICE.retention}`,
      `동의 거부 시 영향: ${CONSENT_NOTICE.refusalEffect}`,
    ].join('\n')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
    const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
    expect(hex).toBe(CONSENT_NOTICE_HASH)
  })

  it('현재 버전·해시의 허용만 유효한 동의다', () => {
    expect(consentIsCurrent({
      granted: 1,
      notice_version: CONSENT_NOTICE.version,
      notice_hash: CONSENT_NOTICE.hash,
      revoked_at: null,
    })).toBe(true)
    expect(consentIsCurrent({
      granted: 1,
      notice_version: CONSENT_NOTICE.version,
      notice_hash: CONSENT_NOTICE.hash,
      revoked_at: '2026-09-03T00:00:00Z',
    })).toBe(false)
  })

  it('동의 미응답과 명시 거절을 별도 값으로 직렬화한다', () => {
    expect(serializeSession({
      id: 'session-1', room_id: 'room-1', title: '면접', status: 'waiting',
      recording_required: 1, my_consent_decided: 0, my_consent_granted: 0,
    })).toMatchObject({ myConsentDecided: false, myConsentGranted: false })
    expect(serializeSession({
      id: 'session-2', room_id: 'room-1', title: '면접', status: 'waiting',
      recording_required: 1, my_consent_decided: 1, my_consent_granted: 0,
    })).toMatchObject({ myConsentDecided: true, myConsentGranted: false })
  })

  it('잘못된 보존 만료 값은 파일을 계속 열어 두지 않는다', () => {
    expect(retentionHasExpired('not-a-date')).toBe(true)
    expect(retentionHasExpired('2999-01-01 00:00:00')).toBe(false)
  })
})

describe('Supabase 화상 신호', () => {
  const env = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
  }

  it('브라우저 연결 설정이 없으면 외부 요청 전에 중단한다', () => {
    expect(() => getSupabaseRealtimeConfig({})).toThrow(VideoServiceConfigError)
  })

  it('회의와 참가자마다 추측하기 어려운 식별·입장 값을 만든다', async () => {
    const first = await createMeeting()
    const second = await createMeeting()
    expect(first.id).not.toBe(second.id)
    const credentials = issueParticipantCredentials(env, {
      meetingId: first.id,
      participantId: 'participant-1',
      customParticipantId: 'custom-1',
      role: 'candidate',
      displayName: '지원자',
    })
    expect(credentials).toMatchObject({
      projectUrl: env.SUPABASE_URL,
      transport: 'authenticated-api',
      meetingId: first.id,
      participantId: 'participant-1',
      role: 'candidate',
    })
    expect(credentials.authToken.length).toBeGreaterThan(30)
    expect(JSON.stringify(credentials)).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY)
  })

  it('강제 퇴장은 공개 방송 없이 서버의 회의별 입장 권한을 폐기한다', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const writes = []
    const DB = {
      prepare(sql) {
        let values
        return {
          bind(...args) { values = args; return this },
          async first() { return { id: 'session-1' } },
          async run() { writes.push({ sql, values }); return { meta: { changes: 1 } } },
        }
      },
    }
    await kickParticipants({ ...env, DB }, {
      meetingId: 'meeting-1',
      customParticipantIds: ['candidate-1'],
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(writes[0].values).toEqual(['session-1', 'candidate-1', 'candidate-1'])
    expect(writes[0].sql).toContain('provider_participant_id = NULL')
  })
})

describe('Supabase 녹화 저장', () => {
  it('서명 업로드와 서명 다운로드를 같은 비공개 버킷에 만든다', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/object/upload/sign/')) {
        return Response.json({ url: '/object/upload/sign/interview-recordings/interviews/a.webm?token=upload-token' })
      }
      return Response.json({ signedURL: '/object/sign/interview-recordings/interviews/a.webm?token=read-token' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const storage = createSupabaseStorage(
      { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret' },
      'interview-recordings'
    )
    await expect(storage.createSignedUploadUrl('interviews/a.webm')).resolves.toEqual({
      path: 'interviews/a.webm', token: 'upload-token',
    })
    await expect(storage.createSignedUrl('interviews/a.webm', 300, 'a.webm')).resolves.toEqual({
      url: 'https://project.supabase.co/storage/v1/object/sign/interview-recordings/interviews/a.webm?token=read-token&download=a.webm',
      expiresIn: 300,
    })
  })

  it('일반·접미·잘못된 Range를 구분한다', () => {
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19, length: 10 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99, length: 10 })
    expect(parseRange('bytes=101-', 100)).toEqual({ invalid: true })
  })

  it('마이그레이션은 업무 표와 저장소를 공개 역할에서 닫는다', () => {
    const sql = readFileSync('supabase/migrations/202609030001_cloudflare_to_supabase.sql', 'utf8')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL')
    expect(sql).toContain("'interview-recordings'")
    expect(sql).toContain("('interview-recordings', 'interview-recordings', false")
  })
})
