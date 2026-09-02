import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import InterviewConversationPanel from '../src/features/interview/InterviewConversationPanel.jsx'
import RecordingBar from '../src/features/interview/RecordingBar.jsx'

const session = {
  id: 'session-1',
  viewerUserId: 'candidate-user',
  myRole: 'candidate',
  members: [
    {
      userId: 'host-user',
      customParticipantId: 'host-custom',
      displayName: '진행자',
      role: 'host',
    },
    {
      userId: 'candidate-user',
      customParticipantId: 'candidate-custom',
      displayName: '지원자',
      role: 'candidate',
    },
  ],
}

describe('화상 면접 대화 역할 경계', () => {
  it('지원자에게 면접관 전용 탭과 입력창을 렌더하지 않는다', () => {
    const html = renderToStaticMarkup(
      <InterviewConversationPanel
        open={true}
        onClose={() => {}}
        roomId="room-1"
        session={session}
        meeting={null}
      />
    )

    expect(html).toContain('공개 메시지')
    expect(html).not.toContain('면접관 대화')
    expect(html).not.toContain('interview-private-message')
    expect(html).not.toContain('면접관만 표시')
  })

  it('등록된 면접관에게만 비공개 대화 탭을 렌더한다', () => {
    const html = renderToStaticMarkup(
      <InterviewConversationPanel
        open={true}
        onClose={() => {}}
        roomId="room-1"
        session={{ ...session, myRole: 'interviewer', viewerUserId: 'host-user' }}
        meeting={null}
      />
    )

    expect(html).toContain('공개 대화')
    expect(html).toContain('면접관 대화')
  })
})

describe('면접관 협의 중 녹화 제어', () => {
  it('독립 녹화 막대의 재개·종료 버튼을 모두 잠근다', () => {
    const html = renderToStaticMarkup(
      <RecordingBar
        roomId="room-1"
        session={{
          id: 'session-1',
          recordingRequired: true,
          canControlRecording: true,
          recording: { id: 'recording-1', status: 'paused' },
        }}
        meetingJoined={true}
        controlsLocked={true}
      />
    )

    expect(html).toContain('녹화 재개')
    expect(html).toContain('녹화 종료')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('면접관 협의 중에는 녹화 제어가 잠깁니다.')
  })
})
