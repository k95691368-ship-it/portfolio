// 내려받는 파일의 이름과, 개인정보 응답의 캐시 지시.
import { describe, expect, it } from 'vitest'
import { contentDisposition, isAppFetch, jsonResponse } from '../functions/_lib/http.js'

describe('contentDisposition', () => {
  // 한글 이름이 퍼센트 인코딩된 채로 저장되면, 자기 이력서를 내려받고도
  // 무슨 파일인지 알아볼 수 없다.
  it('한글 파일명은 RFC 5987 파라미터로 담는다', () => {
    const h = contentDisposition('이력서.pdf')
    expect(h).toContain("filename*=UTF-8''%EC%9D%B4%EB%A0%A5%EC%84%9C.pdf")
    // 옛 브라우저를 위한 아스키 대체 이름도 함께 둔다.
    expect(h).toMatch(/filename="[\x20-\x7e]+"/)
  })

  it('헤더를 깨뜨릴 수 있는 글자를 지운다', () => {
    const h = contentDisposition('a"b\r\nX-Evil: 1\\c.pdf')
    expect(h).not.toContain('\r')
    expect(h).not.toContain('\n')
    expect(h).not.toContain('\\')
    expect(h.match(/filename="([^"]*)"/)[1]).not.toContain('"')
  })

  it('이름이 비어도 무너지지 않는다', () => {
    expect(contentDisposition('')).toContain('download')
    expect(contentDisposition(null)).toContain('download')
  })
})

describe('jsonResponse', () => {
  it('개인정보 응답을 캐시에 남기지 말라고 명시한다', () => {
    const res = jsonResponse({ wage: 3000000 })
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    expect(res.headers.get('Vary')).toContain('Cookie')
  })

  it('추가 헤더를 덮어쓸 수 있다', () => {
    const res = jsonResponse({ ok: true }, 200, { 'Set-Cookie': 'session=x' })
    expect(res.headers.get('Set-Cookie')).toBe('session=x')
    expect(res.headers.get('Cache-Control')).toContain('no-store')
  })
})

// 링크 한 번으로 '근로자가 계약서를 열람했다'는 법적 증거가 만들어지면 안 된다.
describe('isAppFetch', () => {
  const req = (headers) => ({ headers: { get: (k) => headers[k] ?? null } })

  it('주소창 이동은 화면의 요청이 아니다', () => {
    expect(
      isAppFetch(req({ 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'cross-site' }))
    ).toBe(false)
    // 같은 사이트에서 온 이동이라도 사람이 계약서 화면을 본 것은 아니다.
    expect(isAppFetch(req({ 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin' }))).toBe(
      false
    )
  })

  it('우리 화면이 부른 fetch 는 기록 대상이다', () => {
    expect(isAppFetch(req({ 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin' }))).toBe(true)
  })

  it('다른 사이트가 부른 fetch 는 아니다', () => {
    expect(isAppFetch(req({ 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'cross-site' }))).toBe(false)
  })

  it('헤더가 없으면 Accept 로 가린다', () => {
    expect(isAppFetch(req({ Accept: 'text/html,application/xhtml+xml' }))).toBe(false)
    expect(isAppFetch(req({ Accept: 'application/json' }))).toBe(true)
    expect(isAppFetch(req({}))).toBe(true)
  })
})
