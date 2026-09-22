import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import config from '../vite.config.js'
import { boundedRequest, requestBodyLimit } from '../server/_lib/requestBody.js'
import { holdsPersonalData, trackPageView } from '../src/lib/analytics.js'

afterEach(() => vi.unstubAllGlobals())

describe('self-service gateway boundaries', () => {
  it('allows replacement attachments only on the exact management endpoint', async () => {
    expect(requestBodyLimit('/api/application-self-service/example')).toBe(21 * 1024 * 1024)
    expect(requestBodyLimit('/api/application-self-service/example/')).toBe(21 * 1024 * 1024)
    for (const path of ['/api/application-self-service', '/api/application-self-service/example/withdraw', '/api/application-access/request', '/api/account/reset-password']) {
      expect(requestBodyLimit(path)).toBe(256 * 1024)
    }
    const bytes = new Uint8Array(300 * 1024)
    const accepted = await boundedRequest(new Request('https://local.invalid/api/application-self-service/example', { method: 'PATCH', body: bytes }))
    expect((await accepted.arrayBuffer()).byteLength).toBe(bytes.length)
    await expect(boundedRequest(new Request('https://local.invalid/api/application-self-service/example/withdraw', { method: 'POST', body: bytes }))).rejects.toMatchObject({ status: 413 })
  })

  it('caps undeclared streaming upload bodies as well as Content-Length', async () => {
    const request = new Request('https://local.invalid/api/application-self-service/example', {
      method: 'PATCH', body: new Uint8Array(21 * 1024 * 1024 + 1),
    })
    expect(request.headers.has('Content-Length')).toBe(false)
    await expect(boundedRequest(request)).rejects.toMatchObject({ status: 413 })
  })

  it.each(['/verify-email', '/forgot-password', '/reset-password', '/application-manage'])('keeps %s outside page analytics', path => {
    const gtag = vi.fn()
    vi.stubGlobal('window', { gtag, location: { origin: 'https://local.invalid', hash: '#token=example-only' } })
    vi.stubGlobal('document', { title: 'Private page' })
    expect(holdsPersonalData(path)).toBe(true)
    trackPageView(path)
    expect(gtag).not.toHaveBeenCalled()
  })

  it('generates no-referrer/no-store headers for the actual new public routes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portfolio-header-test-'))
    try {
      writeFileSync(join(dir, 'index.html'), '<!doctype html><html><script>void 0</script></html>')
      config.plugins.find(p => p?.name === 'security-headers').writeBundle({ dir })
      const headers = readFileSync(join(dir, '_headers'), 'utf8')
      for (const path of ['/verify-email', '/forgot-password', '/reset-password', '/application-manage']) {
        expect(headers).toContain(`${path}\n  ! Referrer-Policy\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store`)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('allows the management header through the Edge gateway without query credentials', () => {
    const edge = readFileSync('supabase/functions/api/index.ts', 'utf8')
    expect(edge).toMatch(/Access-Control-Allow-Headers':\s*'[^']+X-Application-Authorization/)
    expect(edge).toMatch(/Vary[^\n]+X-Application-Authorization/)
  })
})

describe('wide workspace layout integration', () => {
  it('loads purpose-owned styles without legacy override layers', () => {
    const app = readFileSync('src/App.jsx', 'utf8')
    expect(app).toContain("import './styles/workspace.css'")
    expect(app).not.toContain("import './workspace-layout.css'")
    expect(app).toContain("'app-shell app-shell--interview' : 'app-shell'")
    expect(app).toContain('aria-label="모바일 주요 메뉴"')
    expect(app).toContain("removeAttribute('open')")
  })

  it('has desktop sidebar, responsive narrow layout and independent print layout', () => {
    const css = readFileSync('src/App.css', 'utf8')
    expect(css).toContain("grid-template-areas: 'navigation main' 'navigation footer'")
    expect(css).toContain('@media (max-width: 1023px)')
    expect(css).toContain('@media (max-width: 767px)')
    expect(css).toContain('@media print')
    expect(css).toContain('minmax(0, 1fr)')
    expect(css).not.toContain('overflow-x: hidden') // Do not hide broken layouts.
  })

  it('keeps posting management actions in wrapping cards rather than a wide table', () => {
    const recruit = readFileSync('src/pages/RecruitPage.jsx', 'utf8')
    const css = readFileSync('src/styles/workspace.css', 'utf8')
    expect(recruit).toContain('className="posting-management-list"')
    expect(recruit).toContain('className="posting-management-actions"')
    expect(recruit).toContain('aria-label={`내 임시저장 공고 ${drafts.length}건`}')
    expect(recruit).not.toContain('<caption className="sr-only">내 임시저장 공고')
    expect(css).toMatch(/\.posting-management-actions\s*\{[^}]*flex-wrap: wrap/)
    expect(css).toMatch(/\.posting-management-actions button\s*\{[^}]*max-width: 100%/)
  })

  it('does not force a 320px page wider than the viewport minus its scrollbar', () => {
    for (const path of ['src/index.css', 'src/App.css', 'index.html']) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/min-width:\s*320px/)
    }
  })

  it('allows long record text to wrap and keeps the multi-input wage editor full-width', () => {
    const css = readFileSync('src/styles/workspace.css', 'utf8') + readFileSync('src/styles/contracts.css', 'utf8')
    expect(css).toMatch(/\.job-card-title[^}]+overflow-wrap: anywhere/)
    expect(css).toMatch(/\.contract-page > \*\s*\{[^}]+grid-column: 1 \/ -1/)
    expect(css).not.toMatch(/:is\([^)]*\.wage-composition[^)]*\)\s*\{\s*grid-column: auto/)
    const app = readFileSync('src/App.jsx', 'utf8')
    expect(app).toContain("document.getElementById('main')?.focus({ preventScroll: true })")
    expect(app).toContain('previousLocation.current === locationKey')
  })
})
