import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { redactPath, trackPageView, holdsPersonalData } from '../src/lib/analytics.js'

describe('방문 기록의 주소 가리기', () => {
  it('면접방 id 를 내보내지 않는다', () => {
    expect(redactPath('/rooms/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b')).toBe('/rooms/:roomId')
    expect(redactPath('/rooms/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/contract')).toBe(
      '/rooms/:roomId/contract'
    )
    expect(
      redactPath(
        '/rooms/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/interview/1c3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b'
      )
    ).toBe('/rooms/:roomId/interview/:sessionId')
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

describe('녹화에서 가려야 하는 화면', () => {
  it('사람의 개인정보가 뜨는 화면은 전부 가린다', () => {
    // 클래리티는 화면을 그대로 저장한다. 기본 설정은 숫자와 이메일만 가리므로
    // 이름·오간 대화·근로계약서 조건은 그냥 마이크로소프트로 넘어간다.
    const sensitive = [
      '/rooms/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
      '/rooms/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/contract',
      '/rooms/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/interview/1c3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
      '/jobs/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/apply',
      '/application-status',
      '/verify',
      '/dashboard',
      '/recruit',
      '/admin',
    ]
    for (const path of sensitive) {
      expect(holdsPersonalData(path), path).toBe(true)
    }
  })

  it('회사가 쓴 글만 있는 화면은 열어 둔다 — 다 가리면 볼 것이 없다', () => {
    const open = ['/', '/login', '/signup', '/change-password', '/jobs', '/tech']
    for (const path of open) {
      expect(holdsPersonalData(path), path).toBe(false)
    }
    // 공고 상세는 회사가 쓴 글이다.
    expect(holdsPersonalData('/jobs/8f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b')).toBe(false)
  })

  it('모르는 새 화면은 가리는 쪽으로 떨어진다', () => {
    // 화면 하나 만들 때마다 목록을 기억할 것이라고 기대하지 않는다.
    // 잊었을 때 새어 나가는 쪽이 아니라 가려지는 쪽이어야 한다.
    expect(holdsPersonalData('/무언가-새로-만든-화면')).toBe(true)
    expect(holdsPersonalData('/jobs/abc/def/ghi')).toBe(true)
  })
})

describe('측정 ID 는 한 곳에만 있다', () => {
  it('index.html 말고 다른 곳에 ID 가 박혀 있지 않다', async () => {
    // 계정을 세 번 갈아 끼우는 동안 ID 가 두 곳에 있었다. 한쪽만 고치면
    // 태그는 새 계정으로 켜지는데 화면 이동 신호만 옛 계정으로 가고, 새 계정
    // 화면에는 첫 화면 하나만 뜬다. 아무도 그것을 오류로 보지 않는다.
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')

    const walk = (dir) =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : [full]
      })

    const offenders = walk('src').filter((f) => /G-[A-Z0-9]{8,}/.test(readFileSync(f, 'utf-8')))
    expect(offenders).toEqual([])

    // 그리고 <head> 에는 실제로 있어야 한다 — 없으면 통계가 아예 안 잡힌다.
    const html = readFileSync('index.html', 'utf-8')
    expect(html).toMatch(/G-[A-Z0-9]{8,}/)
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
