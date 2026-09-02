import { describe, expect, it } from 'vitest'
import {
  createDefaultConfig,
  defaultLanguage,
  useLanguage,
} from '@cloudflare/realtimekit-ui'
import {
  createInterviewMeetingConfig,
  INTERVIEW_KO_DICTIONARY,
  INTERVIEW_MEETING_CONFIG,
  INTERVIEW_MEETING_UI_PROPS,
} from '../src/features/interview/interviewMeetingConfig.js'

const childTags = (children) =>
  children.map((child) => (Array.isArray(child) ? child[0] : child))

describe('RealtimeKit 면접 전용 UI 설정', () => {
  it('SDK 기본값을 변경하지 않고 매번 독립된 설정을 만든다', () => {
    const sdkDefault = createDefaultConfig()
    const first = createInterviewMeetingConfig()
    const second = createInterviewMeetingConfig()

    expect(sdkDefault.root['rtk-more-toggle.activeMoreMenu']).toContainEqual([
      'rtk-recording-toggle',
      { variant: 'horizontal', slot: 'more-elements' },
    ])
    expect(first).not.toBe(second)
    expect(first.root).not.toBe(second.root)

    first.root['div#controlbar-center'].push('test-only-control')
    expect(second.root['div#controlbar-center']).not.toContain('test-only-control')
  })

  it('Apple 시스템 글꼴과 Windows용 번들 글꼴을 같은 우선순위로 쓴다', () => {
    const { designTokens, styles } = INTERVIEW_MEETING_CONFIG

    expect(designTokens.googleFont).toBeUndefined()
    expect(designTokens.fontFamily.startsWith('-apple-system, BlinkMacSystemFont')).toBe(true)
    expect(designTokens.fontFamily).toContain('SF Pro Text')
    expect(designTokens.fontFamily).toContain('Apple SD Gothic Neo')
    expect(designTokens.fontFamily).toContain('Pretendard Variable')
    expect(designTokens.fontFamily).toContain('Malgun Gothic')
    expect(designTokens.theme).toBe('darkest')
    expect(designTokens.borderRadius).toBe('extra-rounded')
    expect(designTokens.colors.background[1000]).toBe('#000000')
    expect(designTokens.colors.brand[500]).toBe('#0A84FF')
    expect(styles['rtk-controlbar'].backdropFilter).toBe('blur(24px)')
  })

  it('desktop·sm·md 더보기 메뉴를 허용 목록으로 고정한다', () => {
    const root = INTERVIEW_MEETING_CONFIG.root

    expect(childTags(root['rtk-more-toggle.activeMoreMenu'])).toEqual([
      'rtk-fullscreen-toggle',
      'rtk-pip-toggle',
    ])

    const compact = [
      'rtk-participants-toggle',
      'rtk-screen-share-toggle',
      'rtk-settings-toggle',
      'rtk-fullscreen-toggle',
      'rtk-pip-toggle',
    ]
    expect(childTags(root['rtk-more-toggle.activeMoreMenu.sm'])).toEqual(compact)
    expect(childTags(root['rtk-more-toggle.activeMoreMenu.md'])).toEqual(compact)
  })

  it('AI·전사·polls·plugins·livestream·공급자 녹화·breakout UI를 렌더 트리에 남기지 않는다', () => {
    const serializedRoot = JSON.stringify(INTERVIEW_MEETING_CONFIG.root)
    const removedElements = [
      'rtk-ai',
      'rtk-caption-toggle',
      'rtk-transcript',
      'rtk-polls',
      'rtk-chat-toggle',
      'rtk-plugins',
      'rtk-plugin',
      'rtk-livestream',
      'rtk-recording-toggle',
      'rtk-breakout',
      'rtk-webinar-stage-toggle',
      'rtk-stage-toggle',
      'rtk-mute-all-button',
      'rtk-debugger',
      'rtk-recording-indicator',
      'rtk-header',
      'activePlugin',
    ]

    for (const element of removedElements) {
      expect(serializedRoot, element).not.toContain(element)
    }
  })

  it('면접에 필요한 카메라·마이크·공유·설정·화면·참가자·나가기를 유지한다', () => {
    const serializedRoot = JSON.stringify(INTERVIEW_MEETING_CONFIG.root)
    const retainedElements = [
      'rtk-camera-toggle',
      'rtk-mic-toggle',
      'rtk-screen-share-toggle',
      'rtk-settings-toggle',
      'rtk-fullscreen-toggle',
      'rtk-pip-toggle',
      'rtk-participants-toggle',
      'rtk-leave-button',
    ]

    for (const element of retainedElements) {
      expect(serializedRoot, element).toContain(element)
    }
    expect(INTERVIEW_MEETING_CONFIG.root['rtk-stage'].children).toEqual([
      'rtk-grid',
      'rtk-notifications',
    ])
    expect(INTERVIEW_MEETING_CONFIG.root['rtk-meeting[meeting=joined]']).toEqual([
      'rtk-stage',
      'rtk-controlbar',
      'rtk-participants-audio',
      'rtk-dialog-manager',
    ])
  })

  it('프리셋 UI로 덮어쓰지 않는 RtkMeeting props를 함께 제공한다', () => {
    expect(INTERVIEW_MEETING_UI_PROPS).toEqual({
      config: INTERVIEW_MEETING_CONFIG,
      loadConfigFromPreset: false,
    })
  })
})

describe('RealtimeKit 면접 한국어 사전', () => {
  it('SDK가 실제로 제공하는 키만 덮어쓴다', () => {
    for (const key of Object.keys(INTERVIEW_KO_DICTIONARY)) {
      expect(Object.hasOwn(defaultLanguage, key), key).toBe(true)
    }
  })

  it('핵심 문구는 한국어로 바꾸고 나머지는 SDK 기본값으로 돌아간다', () => {
    const t = useLanguage(INTERVIEW_KO_DICTIONARY)

    expect(t('camera')).toBe('카메라')
    expect(t('chat.message_placeholder')).toBe('메시지 입력')
    expect(t('recording.indicator')).toBe('이 면접은 녹화 중입니다.')
    expect(INTERVIEW_KO_DICTIONARY.polls).toBeUndefined()
    expect(t('polls')).toBe(defaultLanguage.polls)
  })
})
