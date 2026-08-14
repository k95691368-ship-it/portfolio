import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { redactPath, trackPageView } from '../src/lib/analytics.js'

describe('방문 기록의 주소 가리기', () => {
  it('면접방 id 를 내보내지 않는다', () => {
    expect(redactPath('/rooms/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b')).toBe('/rooms/:roomId')
    expect(redactPath('/rooms/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/contract')).toBe(
      '/rooms/:roomId/contract'
    )
  })

  it('공고·지원서 id 를 내보내지 않는다', () => {
    expect(redactPath('/jobs/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b')).toBe('/jobs/:id')
    expect(redactPath('/jobs/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/apply')).toBe('/jobs/:id/apply')
    expect(redactPath('/jobs/42')).toBe('/jobs/:id')
  })

  it('사람이 읽는 화면 이름은 그대로 둔다 — 가리기만 하면 통계가 쓸모없다', () => {
    expect(redactPath('/')).toBe('/')
    expect(redactPath('/jobs')).toBe('/jobs')
    expect(redactPath('/verify')).toBe('/verify')
    expect(redactPath('/application-status')).toBe('/application-status')
    expect(redactPath('/tech')).toBe('/tech')
  })

  it('등록해 두지 않은 새 화면에서도 id 처럼 생긴 토막은 가린다', () => {
    // 화면이 늘 때마다 이 파일을 같이 고칠 것이라고 기대하지 않는다.
    expect(redactPath('/anything/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/deep')).toBe(
      '/anything/:id/deep'
    )
    expect(redactPath('/anything/12345')).toBe('/anything/:id')
  })
})

describe('실제로 보내는 값', () => {
  let sent

  beforeEach(() => {
    sent = []
    globalThis.window = {
      gtag: (...args) => sent.push(args),
      location: { origin: 'https://portfolio-epa.pages.dev' },
    }
    globalThis.document = { title: '테스트' }
  })

  afterEach(() => {
    delete globalThis.window
    delete globalThis.document
    vi.restoreAllMocks()
  })

  it('보내기 전에 전역 값을 먼저 덮어쓴다', () => {
    // send_page_view 를 끄는 것만으로는 모자랐다. 그것은 page_view 하나만
    // 막고, GA4 가 스스로 보내는 나머지(세션 시작·스크롤·참여 시간)는 보낼
    // 때마다 주소 표시줄을 다시 읽어 싣는다. 실제 브라우저로 확인했을 때
    // 방 화면의 uuid 가 바로 그 경로로 나갔다.
    trackPageView('/rooms/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b')
    const kinds = sent.map((args) => args[0])
    expect(kinds).toContain('set')
    expect(kinds.indexOf('set')).toBeLessThan(kinds.indexOf('event'))

    const [, setFields] = sent.find((args) => args[0] === 'set')
    expect(setFields.page_path).toBe('/rooms/:roomId')
    expect(JSON.stringify(setFields)).not.toContain('8f3a1c2e')
  })

  it('접수번호·발급번호가 붙은 주소에서도 물음표 뒤를 보내지 않는다', () => {
    // 접수번호 하나면 남의 지원 내역이 열린다. 통계 보고서에 그것이 목록으로
    // 쌓이면 개인정보를 제3자에게 넘긴 것이 된다.
    trackPageView('/application-status')
    const [, , params] = sent.find((args) => args[0] === 'event')
    expect(JSON.stringify(params)).not.toContain('ABCD1234')
    expect(params.page_path).toBe('/application-status')
    expect(params.page_location).toBe('https://portfolio-epa.pages.dev/application-status')
  })

  it('보내는 주소에도 id 가 들어가지 않는다', () => {
    trackPageView('/rooms/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/contract')
    const [, , params] = sent.find((args) => args[0] === 'event')
    expect(JSON.stringify(params)).not.toContain('8f3a1c2e')
    expect(params.page_location).toBe(
      'https://portfolio-epa.pages.dev/rooms/:roomId/contract'
    )
  })

  it('태그가 막혀 있어도 화면이 죽지 않는다', () => {
    // 광고 차단기가 gtag.js 를 막는 일이 흔하다. 통계 때문에 사이트가
    // 멈추면 안 된다.
    globalThis.window = { location: { origin: 'https://x' } }
    expect(() => trackPageView('/jobs')).not.toThrow()
  })
})
