import { describe, expect, it } from 'vitest'
import {
  extractJoinCredentials,
  interviewPagePath,
  interviewerPagePath,
  isClosedInterviewStatus,
  normalizeSession,
  recordingFilePath,
  recordingActions,
} from '../src/features/interview/sessionModel.js'

describe('interview frontend session model', () => {
  it('normalizes the wrapped API response and current consent', () => {
    const session = normalizeSession({
      session: {
        id: 'session-1',
        myRole: 'host',
        myConsentGranted: true,
        canManage: true,
        recordingRequired: true,
      },
    })

    expect(session.id).toBe('session-1')
    expect(session.myConsent).toEqual({ granted: true })
    expect(session.canControlRecording).toBe(true)
  })

  it('does not mistake an unanswered consent for a refusal', () => {
    expect(normalizeSession({ id: 'one', myConsentGranted: false }).myConsent).toBeNull()
    expect(
      normalizeSession({
        id: 'two',
        myConsentGranted: false,
        myConsentDecided: true,
      }).myConsent
    ).toEqual({ granted: false })
  })

  it('uses the latest recording when the API returns a recording list', () => {
    const session = normalizeSession({
      id: 'session-1',
      recordings: [
        { id: 'older', status: 'available', startedAt: '2026-09-01T10:00:00Z' },
        { id: 'newer', status: 'recording', startedAt: '2026-09-02T10:00:00Z' },
      ],
    })

    expect(session.recording.id).toBe('newer')
    expect(recordingActions(session.recording)).toEqual(['pause', 'stop'])
  })

  it('accepts the join-token response without retaining unrelated fields', () => {
    expect(extractJoinCredentials({ authToken: 'participant-token' })).toEqual({
      authToken: 'participant-token',
      roomName: undefined,
    })
  })

  it('keeps the browser page route singular while API routes remain separate', () => {
    expect(interviewPagePath('room/a', 'session 1')).toBe(
      '/rooms/room%2Fa/interview/session%201'
    )
    expect(interviewerPagePath('room/a', 'session 1')).toBe(
      '/rooms/room%2Fa/interview/session%201?identity=account'
    )
    expect(recordingFilePath('room/a', 'session 1', 'recording#1', true)).toBe(
      '/api/rooms/room%2Fa/interviews/session%201/recordings/recording%231/file?download=1'
    )
    expect(
      recordingFilePath('room/a', 'session 1', 'recording#1', true, 'code')
    ).toBe(
      '/api/rooms/room%2Fa/interviews/session%201/recordings/recording%231/file?download=1&identity=code'
    )
  })

  it('normalizes registered interview members and retention-expired recordings', () => {
    const session = normalizeSession({
      id: 'session-1',
      viewer_user_id: 'viewer-1',
      members: [
        {
          user_id: 'staff-1',
          custom_participant_id: 'custom-1',
          display_name: '면접관',
          role: 'INTERVIEWER',
        },
      ],
      recordings: [{ id: 'recording-1', status: 'deleted', expired: true }],
    })

    expect(session.viewerUserId).toBe('viewer-1')
    expect(session.members[0]).toMatchObject({
      userId: 'staff-1',
      customParticipantId: 'custom-1',
      displayName: '면접관',
      role: 'interviewer',
    })
    expect(session.recording).toMatchObject({
      id: 'recording-1',
      status: 'deleted',
      label: '보관 기간 만료',
    })
  })

  it('treats failed provider sessions as closed before consent or join', () => {
    expect(isClosedInterviewStatus('ended')).toBe(true)
    expect(isClosedInterviewStatus('cancelled')).toBe(true)
    expect(isClosedInterviewStatus('failed')).toBe(true)
    expect(isClosedInterviewStatus('live')).toBe(false)
  })
})
