import { describe, expect, it, vi } from 'vitest'
import {
  activeParticipantsReturnedToParent,
  candidateCustomParticipantIds,
  findHuddleMeeting,
  huddleWorkflowStorageKey,
  huddleLocksRecordingControls,
  huddleTransitionConfirmed,
  HUDDLE_TITLE,
  HUDDLE_WORKFLOW_STORAGE_VERSION,
  normalizeHuddleWorkflow,
  parentReturnConfirmed,
  participantMovePlan,
  placementConfirmed,
  privateMessagePeerIds,
  privateMessageSenderIds,
  privateTextMessages,
  publicChatParticipants,
  recordingMediaState,
  staffCustomParticipantIds,
  waitForConfirmedState,
} from '../src/features/interview/collaborationModel.js'

const members = [
  { userId: 'u-host', customParticipantId: 'c-host', displayName: '진행자', role: 'host' },
  { userId: 'u-panel', customParticipantId: 'c-panel', displayName: '면접관', role: 'interviewer' },
  { userId: 'u-candidate', customParticipantId: 'c-candidate', displayName: '지원자', role: 'candidate' },
]

const participants = [
  { id: 'p-host', userId: 'provider-host', customParticipantId: 'c-host' },
  { id: 'p-panel', userId: 'provider-panel', customParticipantId: 'c-panel' },
  { id: 'p-candidate', userId: 'provider-candidate', customParticipantId: 'c-candidate' },
]

describe('화상 면접 협업 대상 선정', () => {
  it('면접관만 협의실 이동 대상으로 선정한다', () => {
    expect(staffCustomParticipantIds(members)).toEqual(['c-host', 'c-panel'])
    expect(candidateCustomParticipantIds(members)).toEqual(['c-candidate'])
    expect(participantMovePlan(members, participants)).toEqual({
      participantIds: ['p-host', 'p-panel'],
      customParticipantIds: ['c-host', 'c-panel'],
    })
  })

  it('비공개 대화에서 자기 자신과 지원자를 제외한다', () => {
    expect(
      privateMessagePeerIds(members, participants, {
        id: 'p-host',
        customParticipantId: 'c-host',
      })
    ).toEqual(['p-panel'])
    expect(
      privateMessageSenderIds(members, participants.slice(1), participants[0])
    ).toEqual(['p-panel', 'provider-panel', 'c-panel', 'p-host', 'provider-host', 'c-host'])
  })

  it('지원자가 협의실에 있으면 이동 완료로 판정하지 않는다', () => {
    const snapshot = {
      parentMeeting: { id: 'parent', participants: [] },
      meetings: [
        {
          id: 'huddle',
          title: HUDDLE_TITLE,
          participants,
        },
      ],
    }
    expect(findHuddleMeeting(snapshot)?.id).toBe('huddle')
    expect(
      placementConfirmed(snapshot, 'huddle', ['c-host', 'c-panel'], ['c-candidate'])
    ).toBe(false)
  })

  it('100ms client 공백과 실제 회의 id를 구분해 이동·복귀를 확정한다', () => {
    const snapshot = {
      parentMeeting: {
        id: 'parent',
        participants: [participants[2]],
      },
      meetings: [
        {
          id: 'huddle',
          title: HUDDLE_TITLE,
          participants: participants.slice(0, 2),
        },
      ],
    }

    expect(
      huddleTransitionConfirmed(
        snapshot,
        null,
        'huddle',
        ['c-host', 'c-panel'],
        ['c-candidate']
      )
    ).toBe(false)
    expect(
      huddleTransitionConfirmed(
        snapshot,
        'huddle',
        'huddle',
        ['c-host', 'c-panel'],
        ['c-candidate']
      )
    ).toBe(true)

    const returned = {
      parentMeeting: { id: 'parent', participants },
      meetings: [{ id: 'huddle', title: HUDDLE_TITLE, participants: [] }],
    }
    expect(
      parentReturnConfirmed(returned, 'parent', 'parent', [
        'c-host',
        'c-panel',
        'c-candidate',
      ])
    ).toBe(true)
    expect(
      parentReturnConfirmed(returned, 'huddle', 'parent', [
        'c-host',
        'c-panel',
        'c-candidate',
      ])
    ).toBe(false)
  })

  it('공개 대화 표시용 역할을 기존 방 역할로 변환한다', () => {
    expect(publicChatParticipants(members).map((member) => member.role)).toEqual([
      'company',
      'company',
      'candidate',
    ])
  })
})

describe('면접관 비공개 대화', () => {
  it('대상이 지정된 텍스트만 React 표시 모델로 변환한다', () => {
    const result = privateTextMessages(
      [
        {
          id: 'private',
          type: 'text',
          message: '<b>원문</b>',
          displayName: '면접관',
          userId: 'provider-panel',
          targetUserIds: ['provider-target'],
          time: new Date('2026-09-02T01:00:00Z'),
        },
        {
          id: 'candidate-private',
          type: 'text',
          message: '지원자 우회 메시지',
          userId: 'provider-candidate',
          targetUserIds: ['provider-target'],
        },
        { id: 'public', type: 'text', message: '공개', targetUserIds: [] },
        { id: 'html', type: 'custom', html: '<script>alert(1)</script>', targetUserIds: ['x'] },
      ],
      ['provider-panel', 'provider-host']
    )

    expect(result).toHaveLength(1)
    expect(result[0].body).toBe('<b>원문</b>')
  })
})

describe('협의실 상태 검증', () => {
  it('새로고침 복구 정보는 버전과 회의 경계를 검증한다', () => {
    const stored = normalizeHuddleWorkflow({
      version: HUDDLE_WORKFLOW_STORAGE_VERSION,
      parentId: 'parent',
      huddleId: 'huddle',
      staffCustomIds: ['c-host', 'c-host', null],
      candidateCustomIds: ['c-candidate'],
      shouldResume: true,
      recordingId: 'recording-1',
    })
    expect(stored).toEqual({
      parentId: 'parent',
      huddleId: 'huddle',
      staffCustomIds: ['c-host'],
      candidateCustomIds: ['c-candidate'],
      shouldResume: true,
      recordingId: 'recording-1',
    })
    expect(huddleWorkflowStorageKey('session-1')).toBe('interview-huddle:session-1')
    expect(
      normalizeHuddleWorkflow({
        version: HUDDLE_WORKFLOW_STORAGE_VERSION,
        parentId: 'same',
        huddleId: 'same',
      })
    ).toBeNull()
    expect(
      normalizeHuddleWorkflow({
        version: HUDDLE_WORKFLOW_STORAGE_VERSION - 1,
        parentId: 'parent',
        huddleId: 'huddle',
      })
    ).toBeNull()
  })

  it('녹화 상태별 사전 조건을 구분한다', () => {
    expect(recordingMediaState('recording')).toBe('must-pause')
    expect(recordingMediaState('paused')).toBe('already-paused')
    expect(recordingMediaState('processing')).toBe('transitioning')
    expect(recordingMediaState('idle')).toBe('inactive')
    expect(huddleLocksRecordingControls('parent')).toBe(false)
    for (const phase of ['entering', 'huddle', 'returning', 'attention']) {
      expect(huddleLocksRecordingControls(phase), phase).toBe(true)
    }
  })

  it('협의 중 연결을 종료한 참가자는 복귀·녹화 재개를 막지 않는다', () => {
    const disconnectedPanel = {
      parentMeeting: {
        id: 'parent',
        participants: [participants[0], participants[2]],
      },
      meetings: [{ id: 'huddle', title: HUDDLE_TITLE, participants: [] }],
    }
    expect(
      activeParticipantsReturnedToParent(
        disconnectedPanel,
        'parent',
        'parent',
        ['c-host', 'c-panel', 'c-candidate']
      )
    ).toBe(true)

    const panelStillInHuddle = {
      ...disconnectedPanel,
      meetings: [
        { id: 'huddle', title: HUDDLE_TITLE, participants: [participants[1]] },
      ],
    }
    expect(
      activeParticipantsReturnedToParent(
        panelStillInHuddle,
        'parent',
        'parent',
        ['c-host', 'c-panel', 'c-candidate']
      )
    ).toBe(false)
    expect(
      activeParticipantsReturnedToParent(
        disconnectedPanel,
        'huddle',
        'parent',
        ['c-host', 'c-panel']
      )
    ).toBe(false)
  })

  it('조건이 실제로 확인될 때까지만 대기한다', async () => {
    vi.useFakeTimers()
    let checks = 0
    const result = waitForConfirmedState(
      async () => {
        checks += 1
        return checks === 3
      },
      { timeoutMs: 1000, intervalMs: 10 }
    )
    await vi.advanceTimersByTimeAsync(20)
    await expect(result).resolves.toBe(true)
    vi.useRealTimers()
  })
})
