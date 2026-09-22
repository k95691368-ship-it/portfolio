import { describe, expect, it } from 'vitest'
import { buildBrandedEmailHtml } from '../server/_lib/emailTemplate.js'

const message = {
  companyName: '테스트 회사', title: '면접방 참여 안내',
  bodyText: '안녕하세요.\n면접방에서 확인해주세요.',
  details: [['제목', '면접 안내']], action: 'room',
}

describe('recruiting HTML email presentation', () => {
  it('uses an image-independent banner, accessible detail table and live CTA', () => {
    const html = buildBrandedEmailHtml(message)
    expect(html).toContain('<h1')
    expect(html).toContain('bgcolor="#0067b8"')
    expect(html).toContain('aria-label="면접방 참여 안내 상세 정보"')
    expect(html).toContain('<th scope="row"')
    expect(html).toContain('면접방 입장 코드 입력')
    expect(html).toContain('href="https://portfolio-epa.pages.dev/jobs"')
    expect(html).toContain('버튼이 열리지 않으면')
    expect(html).not.toMatch(/<img|<script|<iframe|<form|@import|url\(/i)
  })

  it('has a narrow-screen layout and an Outlook fixed-width fallback', () => {
    const html = buildBrandedEmailHtml(message)
    expect(html).toContain('max-width:480px')
    expect(html).toContain('max-width:640px')
    expect(html).toContain('<!--[if mso]>')
    expect(html).toContain('table-layout:fixed')
    expect(html).toContain('name="viewport"')
    expect(html).not.toMatch(/display:\s*(grid|flex)/)
  })

  it('uses the Microsoft white, gray and blue system without requiring remote fonts', () => {
    const html = buildBrandedEmailHtml(message)
    expect(html).toContain('background-color:#ffffff')
    expect(html).toContain('background-color:#f5f5f5')
    expect(html).toContain('color:#1a1a1a')
    expect(html).toContain('color:#616161')
    expect(html).toContain("font-family:'Segoe UI Variable','Segoe UI','SUIT Variable','SUIT'")
    expect(html).toContain('border-radius:20px')
    expect(html).toContain('border-radius:999px')
    expect(html).toContain('min-height:44px')
    expect(html).toContain('box-shadow:0 10px 24px rgba(0,0,0,0.06)')
    expect(html).toContain('name="color-scheme" content="light"')
    expect(html).toContain('class="email-details"')
    expect(html).not.toContain('#0d1b35')
    expect(html).not.toMatch(/@font-face|fonts\.google|Apple SD|SF Pro|-apple-system/)
  })

  it.each(['companyName', 'title', 'bodyText'])('escapes untrusted %s', (field) => {
    const html = buildBrandedEmailHtml({ ...message, [field]: '<img src=x onerror="alert(1)">&\'' })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#039;')
  })

  it('escapes table labels and values without converting arbitrary input to links', () => {
    const html = buildBrandedEmailHtml({ ...message, details: [['<script>', '<a href="javascript:alert(1)">click</a>']] })
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<script>')
  })

  it.each(['javascript:alert(1)', 'https://evil.invalid', '__proto__', 'constructor', undefined])('omits unrecognized action %s', (action) => {
    const html = buildBrandedEmailHtml({ ...message, action })
    expect(html).not.toContain('버튼이 열리지 않으면')
    expect(html).not.toContain('면접방 입장 코드 입력')
    expect(html).not.toContain('href="https://evil.invalid')
  })

  it('only links to the existing application status route for status actions', () => {
    const html = buildBrandedEmailHtml({ ...message, action: 'status' })
    expect(html).toContain('href="https://portfolio-epa.pages.dev/application-status"')
    expect(html).toContain('지원 현황 확인')
    expect(html).not.toMatch(/[?&](code|token)=/)
  })

  it('does not invent missing data or print null/undefined values', () => {
    const html = buildBrandedEmailHtml({ title: '안내', bodyText: '안내 내용', details: [['장소', null], ['일정', undefined], ['빈 값', '  ']] })
    expect(html).not.toContain('<th')
    expect(html).not.toMatch(/undefined|null|장소|일정/)
    expect(html).toContain('채용 담당자')
  })

  it('preserves all newline styles, Korean and emoji without raw markup', () => {
    const html = buildBrandedEmailHtml({ ...message, bodyText: '한글 📋\r\n둘\r셋\n넷' })
    expect(html).toContain('한글 📋<br>둘<br>셋<br>넷')
  })
})
