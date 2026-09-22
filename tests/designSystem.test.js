import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = path => readFileSync(path, 'utf8')
const tokens = read('src/index.css')
const shell = read('src/App.css')
const token = name => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/.{2}/g).map(channel => {
    const n = parseInt(channel, 16) / 255
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4
  })
  return r * .2126 + g * .7152 + b * .0722
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((a, b) => b - a)
  return (light + .05) / (dark + .05)
}

describe('single-source Microsoft design system', () => {
  it('removes legacy theme/override files instead of appending another theme', () => {
    const app = read('src/App.jsx')
    for (const file of ['redesign.css', 'workspace-layout.css', 'posting-tools.css']) {
      expect(app).not.toContain(file)
      expect(existsSync(`src/${file}`)).toBe(false)
    }
    for (const file of ['App.css', 'styles/workspace.css', 'styles/communication.css', 'styles/contracts.css']) {
      expect(app).toContain(`import './${file}'`)
    }
  })

  it('uses reference palette, card/input/button hierarchy and readable contrast', () => {
    expect(token('bg')).toBe('#ffffff')
    expect(token('surface-alt')).toBe('#f5f5f5')
    expect(token('action-bg')).toBe('#0067b8')
    expect(token('action-hover')).toBe('#0078d4')
    expect(token('radius')).toBe('20px')
    expect(token('radius-sm')).toBe('12px')
    expect(token('radius-full')).toBe('999px')
    expect(parseInt(token('tap'))).toBeGreaterThanOrEqual(44)
    for (const foreground of ['text', 'text-muted', 'brand-accent']) {
      for (const background of ['bg', 'surface', 'surface-alt', 'accent-bg']) {
        expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5)
      }
    }
    for (const background of ['action-bg', 'action-hover']) expect(contrast(token('on-accent'), token(background))).toBeGreaterThanOrEqual(4.5)
  })

  it('preserves entry destinations and uses distributed role and support tiles', () => {
    const landing = read('src/pages/LandingPage.jsx')
    for (const text of ['landing-choice--company', 'landing-choice--candidate', 'landing-actions', 'DeveloperTrialEntry', "'/dashboard' : '/login'", 'to="/jobs"', 'to="/verify"', 'to="/tech"']) expect(landing).toContain(text)
    expect(shell).toMatch(/\.landing-hero\s*\{[^}]*grid-template-columns:/)
    expect(shell).toMatch(/\.landing-choice\s*\{[^}]*border-radius:\s*var\(--radius\)/)
    expect(shell).toContain('@media (max-width: 767px)')
  })

  it('keeps keyboard focus, visually hidden text and reduced motion behavior', () => {
    expect(tokens).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--primary-focus\)/)
    expect(tokens).toContain('.skip-link:focus')
    expect(tokens).toContain('.sr-only')
    expect(tokens).toMatch(/\.sr-only\s*\{[^}]*width:\s*1px !important/)
    expect(tokens).toMatch(/\.btn-sm\s*\{[^}]*padding:/)
    expect(tokens.match(/\.btn-sm\s*\{([^}]*)\}/)?.[1]).not.toMatch(/color:|background:|border-color:/)
    expect(tokens).toContain('[hidden] { display: none !important; }')
    expect(tokens).toContain('@media (prefers-reduced-motion: reduce)')
    expect(tokens).toContain('scroll-behavior: auto !important')
    expect(shell).toContain('max-height: calc(100svh - var(--nav-h))')
    expect(shell).toContain('overflow-y: auto')
  })

  it('has no fixed narrow root and does not conceal overflow to fake responsiveness', () => {
    expect(tokens).toMatch(/#root\s*\{[^}]*width:\s*100%/)
    expect(shell).toContain('minmax(0, 1fr)')
    expect(shell).not.toContain('overflow-x: hidden')
    expect(shell).toMatch(/\.app-legal-footer\s*\{[^}]*max-width:\s*none/)
  })

  it('keeps hidden wide-table labels inside the page without moving upload focus to the page top', () => {
    const hidden = tokens.match(/\.sr-only\s*\{([^}]*)\}/)?.[1]
    expect(hidden).toMatch(/inset-inline-start:\s*0 !important/)
    expect(hidden).not.toMatch(/(?:^|;)\s*(?:top|inset-block-start|inset):/)
    expect(hidden).not.toMatch(/(?:display:\s*none|visibility:\s*hidden)/)
    expect(read('src/styles/workspace.css')).toContain('.upload-button:focus-within')
  })

  it('keeps technical disclosure and keyboard tab semantics', () => {
    const page = read('src/pages/TechPage.jsx')
    for (const text of ['className="tech-disclosure"', '<summary>', 'role="tabpanel"', 'aria-controls="tech-panel-system"', "['ArrowLeft', 'ArrowRight', 'Home', 'End']"]) expect(page).toContain(text)
  })

  it('preserves auth remount, masking, mobile focus and deferred restoration', () => {
    const app = read('src/App.jsx')
    for (const text of ['<Routes key={sessionEpoch}>', "'data-clarity-mask': 'true'", 'aria-label="모바일 주요 메뉴"', "removeAttribute('open')", "document.getElementById('main')?.focus({ preventScroll: true })", '<DeferredScrollRestoration />']) expect(app).toContain(text)
  })
})
