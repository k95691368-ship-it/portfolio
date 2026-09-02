import { createDefaultConfig } from '@cloudflare/realtimekit-ui'

const horizontal = (element) => [
  element,
  { variant: 'horizontal', slot: 'more-elements' },
]

/**
 * Deliberately partial: `useLanguage(INTERVIEW_KO_DICTIONARY)` merges these
 * values over RealtimeKit's default dictionary, so keys we have not verified
 * continue to use the SDK default instead of an invented translation.
 */
export const INTERVIEW_KO_DICTIONARY = Object.freeze({
  about_call: '면접 정보',
  screen: '화면',
  camera: '카메라',
  leave: '나가기',
  dismiss: '닫기',
  more: '더보기',
  settings: '설정',
  connection: '연결',
  leave_confirmation: '화상 면접에서 나가시겠습니까?',
  cancel: '취소',
  yes: '나가기',
  '(you)': '(나)',
  you: '나',
  everyone: '전체',
  to: '받는 사람',
  pin: '고정',
  pinned: '고정됨',
  unpin: '고정 해제',
  pip_on: '화면 속 화면 열기',
  pip_off: '화면 속 화면 닫기',
  join: '입장',
  joined: '입장함',
  close: '닫기',
  mic_off: '마이크 꺼짐',
  disable_mic: '마이크 끄기',
  mic_on: '마이크 켜짐',
  enable_mic: '마이크 켜기',
  audio: '오디오',
  test: '테스트',
  video_off: '카메라 꺼짐',
  disable_video: '카메라 끄기',
  video_on: '카메라 켜짐',
  enable_video: '카메라 켜기',
  video: '비디오',
  offline: '인터넷 연결이 끊어졌습니다.',
  'offline.description': '인터넷 연결을 확인해주세요.',
  disconnected: '면접에 입장하지 않았습니다.',
  'disconnected.description': '입장한 뒤 다른 참가자와 대화할 수 있습니다.',
  failed: '면접 연결이 끊어졌습니다.',
  'failed.description': '다시 연결하지 못했습니다. 재입장해주세요.',
  participants: '참가자',
  'participants.errors.empty_results': '일치하는 참가자가 없습니다.',
  'participants.empty_list': '아직 다른 참가자가 없습니다.',
  screenshare: '화면 공유',
  'screenshare.shared': '화면을 공유하고 있습니다.',
  'screenshare.start': '화면 공유',
  'screenshare.stop': '공유 중지',
  'screenshare.error.unknown': '화면 공유를 시작하지 못했습니다.',
  'screenshare.error.max_count': '더 이상 화면을 공유할 수 없습니다.',
  perm_denied: '브라우저 권한이 차단되었습니다.',
  'perm_denied.audio': '마이크 권한이 차단되었습니다.',
  'perm_denied.video': '카메라 권한이 차단되었습니다.',
  'perm_denied.screenshare': '화면 공유 권한이 차단되었습니다.',
  perm_sys_denied: '시스템 권한이 차단되었습니다.',
  'perm_sys_denied.audio': '시스템에서 마이크 권한이 차단되었습니다.',
  'perm_sys_denied.video': '시스템에서 카메라 권한이 차단되었습니다.',
  'perm_sys_denied.screenshare': '시스템에서 화면 공유 권한이 차단되었습니다.',
  full_screen: '전체 화면',
  'full_screen.exit': '전체 화면 종료',
  'setup_screen.join_in_as': '다음 이름으로 입장',
  'setup_screen.your_name': '이름',
  'stage.reconnecting': '다시 연결하는 중…',
  'recording.label': '녹화',
  'recording.indicator': '이 면접은 녹화 중입니다.',
  'recording.started': '녹화가 시작되었습니다.',
  'recording.stopped': '녹화가 종료되었습니다.',
  'recording.paused': '녹화가 일시정지되었습니다.',
  audio_playback: '오디오 재생',
  'audio_playback.title': '오디오 재생 허용',
  'audio_playback.description': '소리를 듣기 위해 오디오 재생을 허용해주세요.',
  end: '종료',
  'end.all': '모두의 면접 종료',
  ended: '면접이 종료되었습니다.',
  network: '네트워크',
  'network.reconnecting': '다시 연결하는 중…',
  'network.disconnected': '연결이 끊어졌습니다.',
  'network.restored': '연결이 복구되었습니다.',
  chat: '채팅',
  'chat.send_msg': '보내기',
  'chat.message_placeholder': '메시지 입력',
  'chat.search_conversations': '대화 검색',
  'chat.start_conversation': '대화 시작',
  'chat.empty_chat': '아직 메시지가 없습니다.',
  'chat.view_chats': '대화 보기',
  'chat.everyone': '전체 대화',
  'settings.microphone_input': '마이크',
  'settings.speaker_output': '스피커',
  'settings.mirror_video': '내 화면 좌우 반전',
  'settings.camera_off': '카메라 꺼짐',
  'dialog.close': '닫기',
  'notifications.joined': '면접에 입장했습니다.',
  'notifications.left': '면접에서 나갔습니다.',
})

const desktopMoreMenu = () => [
  horizontal('rtk-fullscreen-toggle'),
  horizontal('rtk-pip-toggle'),
]

const compactMoreMenu = () => [
  horizontal('rtk-participants-toggle'),
  horizontal('rtk-screen-share-toggle'),
  horizontal('rtk-settings-toggle'),
  horizontal('rtk-fullscreen-toggle'),
  horizontal('rtk-pip-toggle'),
]

export function createInterviewMeetingConfig() {
  const config = createDefaultConfig()

  config.designTokens = {
    ...config.designTokens,
    spacingBase: 4,
    fontFamily:
      '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Apple SD Gothic Neo", "Helvetica Neue", "Noto Sans KR", "Malgun Gothic", "Segoe UI", Arial, sans-serif',
    borderWidth: 'thin',
    borderRadius: 'extra-rounded',
    theme: 'darkest',
    colors: {
      brand: {
        300: '#64D2FF',
        400: '#409CFF',
        500: '#0A84FF',
        600: '#0071E3',
        700: '#0057B8',
      },
      background: {
        1000: '#000000',
        900: '#0B0B0C',
        800: '#1C1C1E',
        700: '#2C2C2E',
        600: '#3A3A3C',
      },
      text: '#F5F5F7',
      'text-on-brand': '#FFFFFF',
      'video-bg': '#000000',
      danger: '#FF453A',
      success: '#30D158',
      warning: '#FFD60A',
    },
  }
  // The document already loads Pretendard from this deployment. Keeping the
  // default `googleFont: Inter` would fetch a second typeface from a third party.
  delete config.designTokens.googleFont

  config.styles = {
    ...config.styles,
    'rtk-meeting': {
      backgroundColor: '#000000',
      color: '#F5F5F7',
      colorScheme: 'dark',
      fontFamily: config.designTokens.fontFamily,
    },
    'rtk-header': {
      ...config.styles?.['rtk-header'],
      height: '56px',
      paddingInline: '16px',
      backgroundColor: 'rgba(11, 11, 12, 0.92)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.10)',
      backdropFilter: 'blur(20px)',
    },
    'rtk-header.sm': {
      ...config.styles?.['rtk-header.sm'],
      height: '52px',
      paddingInline: '12px',
      backgroundColor: 'rgba(11, 11, 12, 0.96)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.10)',
    },
    'rtk-stage': {
      ...config.styles?.['rtk-stage'],
      backgroundColor: '#000000',
      padding: '12px',
    },
    'rtk-controlbar': {
      ...config.styles?.['rtk-controlbar'],
      width: 'calc(100% - 32px)',
      maxWidth: '760px',
      margin: '0 auto 16px',
      padding: '8px 12px',
      backgroundColor: 'rgba(28, 28, 30, 0.92)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '20px',
      boxShadow: '0 16px 48px rgba(0, 0, 0, 0.36)',
      backdropFilter: 'blur(24px)',
    },
    'rtk-controlbar.sm': {
      ...config.styles?.['rtk-controlbar.sm'],
      width: 'calc(100% - 16px)',
      margin: '0 8px 8px',
      padding: '8px',
      backgroundColor: 'rgba(28, 28, 30, 0.96)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '18px',
    },
    'rtk-controlbar.md': {
      ...config.styles?.['rtk-controlbar.md'],
      width: 'calc(100% - 24px)',
      margin: '0 12px 12px',
      padding: '8px',
      backgroundColor: 'rgba(28, 28, 30, 0.96)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '18px',
    },
    'rtk-participant-tile': {
      borderRadius: '18px',
      overflow: 'hidden',
      backgroundColor: '#1C1C1E',
      border: '1px solid rgba(255, 255, 255, 0.10)',
    },
    'rtk-sidebar': {
      backgroundColor: 'rgba(28, 28, 30, 0.96)',
      borderLeft: '1px solid rgba(255, 255, 255, 0.10)',
      backdropFilter: 'blur(24px)',
    },
    'rtk-setup-screen': {
      backgroundColor: '#000000',
    },
  }
  delete config.styles['rtk-breakout-rooms-manager']

  config.root = { ...config.root }

  // The product shell already owns title, connection and recording state. Keep
  // one header instead of repeating the same information inside the SDK tree.
  config.root['rtk-meeting[meeting=joined]'] = [
    'rtk-stage',
    'rtk-controlbar',
    'rtk-participants-audio',
    'rtk-dialog-manager',
  ]
  for (const selector of [
    'rtk-header',
    'rtk-header.sm',
    'div#header-left',
    'div#header-left.sm',
    'div#header-center',
    'div#header-right',
  ]) {
    delete config.root[selector]
  }

  // Stage: live captions/transcriptions and provider plugin surfaces are not
  // part of the interview product. Screen sharing still uses rtk-mixed-grid.
  config.root['rtk-stage'] = {
    states: ['activeSidebar'],
    children: ['rtk-grid', 'rtk-notifications'],
  }
  config.root['rtk-grid'] = {
    states: ['activeScreenShare', 'activeSpotlight'],
    children: ['rtk-simple-grid'],
  }
  for (const selector of Object.keys(config.root)) {
    if (selector.includes('activePlugin')) delete config.root[selector]
  }

  // Desktop controls stay immediately visible; compact layouts move secondary
  // actions into their own allow-listed menu.
  config.root['div#controlbar-left'] = [
    'rtk-settings-toggle',
    'rtk-screen-share-toggle',
  ]
  config.root['div#controlbar-center'] = [
    'rtk-mic-toggle',
    'rtk-camera-toggle',
    'rtk-more-toggle',
    'rtk-leave-button',
  ]
  config.root['div#controlbar-right'] = [
    'rtk-participants-toggle',
  ]
  config.root['div#controlbar-mobile'] = [
    'rtk-mic-toggle',
    'rtk-camera-toggle',
    'rtk-leave-button',
    'rtk-more-toggle',
  ]
  config.root['rtk-more-toggle.activeMoreMenu'] = desktopMoreMenu()
  config.root['rtk-more-toggle.activeMoreMenu.sm'] = compactMoreMenu()
  config.root['rtk-more-toggle.activeMoreMenu.md'] = compactMoreMenu()

  config.config = {
    ...config.config,
    notifications: {
      ...config.config?.notifications,
      polls: false,
      webinar: false,
      tab_sync: false,
    },
    notification_sounds: {
      ...config.config?.notification_sounds,
      polls: false,
      webinar: false,
    },
  }

  return config
}

export const INTERVIEW_MEETING_CONFIG = createInterviewMeetingConfig()

/** Props intended to be spread onto `<RtkMeeting />`. */
export const INTERVIEW_MEETING_UI_PROPS = Object.freeze({
  config: INTERVIEW_MEETING_CONFIG,
  loadConfigFromPreset: false,
})
