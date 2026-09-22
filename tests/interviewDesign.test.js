import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/features/interview/interview.css', import.meta.url), 'utf8')
const stylesheet = postcss.parse(css)

// Inspect actual CSS syntax without mixing mobile rules into desktop values.
function declarationsFor(selector, media = '') {
  const declarations = {}
  stylesheet.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return
    const parentMedia = rule.parent.type === 'atrule' ? rule.parent.params : ''
    if (parentMedia !== media) return
    rule.walkDecls((declaration) => { declarations[declaration.prop] = declaration.value })
  })
  return declarations
}

describe('single Microsoft interview presentation', () => {
  it('uses the application light surfaces and does not carry a second color token system', () => {
    expect(declarationsFor('.interview-page')['color-scheme']).toBe('light')
    expect(declarationsFor('.interview-page--meeting')['color-scheme']).toBe('light')
    expect(declarationsFor('.interview-page').background).toBe('var(--surface-alt)')
    expect(declarationsFor('.webrtc-controls').background).toBe('var(--surface)')
    expect(declarationsFor('.webrtc-device-panel').background).toBe('var(--surface)')
    expect(declarationsFor('.interview-page')['font-family']).toBe('var(--font-body)')
    expect(css).not.toMatch(/--interview-(?:ui-|bg|card|text|blue)|backdrop-filter|Apple SD|SF Pro/)
  })

  it('keeps the actual video canvas dark with legible overlay labels', () => {
    expect(declarationsFor('.webrtc-video-tile').background).toBe('#171717')
    expect(declarationsFor('.webrtc-video-tile')['color-scheme']).toBe('dark')
    expect(declarationsFor('.webrtc-video-tile > strong').color).toBe('#ffffff')
    expect(declarationsFor('.webrtc-video-avatar').color).toBe('#ffffff')
  })

  it('retains dark text on light chat panels and white text on blue outgoing messages', () => {
    expect(declarationsFor('.interview-conversation-panel').color).toBe('var(--text)')
    expect(declarationsFor('.interview-conversation-message p').color).toBe('var(--text)')
    expect(declarationsFor('.interview-conversation-message.is-mine p').background).toBe('var(--accent)')
    expect(declarationsFor('.interview-conversation-message.is-mine p').color).toBe('#ffffff')
    expect(declarationsFor('.webrtc-controls button.is-active').color).toBe('#ffffff')
    expect(declarationsFor('.interview-conversation-message__meta time').color).toBe('var(--text-muted)')
  })

  it('uses modular cards, rounded inputs and touchable pill buttons', () => {
    for (const selector of ['.interview-state-card', '.interview-consent-card', '.interview-session-card', '.webrtc-prejoin__settings']) {
      expect(declarationsFor(selector)['border-radius']).toBe('var(--r)')
    }
    expect(declarationsFor('.interview-state-card')['box-shadow']).toBe('0 10px 24px rgba(0, 0, 0, 0.06)')
    expect(declarationsFor('.webrtc-device-panel select')['border-radius']).toBe('var(--r-sm)')
    expect(declarationsFor('.interview-page button')['border-radius']).toBe('var(--r-pill)')
    expect(declarationsFor('.interview-page button')['min-height']).toBe('44px')
    expect(declarationsFor('.interview-session-panel button')['min-height']).toBe('44px')
    expect(declarationsFor('.interview-conversation-composer textarea:focus')['box-shadow']).toBe('0 0 0 4px rgba(0, 120, 212, 0.18)')
  })

  it('allocates space for media controls instead of floating them over the video', () => {
    expect(declarationsFor('.interview-meeting-stage')['grid-template-rows']).toBe('minmax(0, 1fr) auto')
    expect(declarationsFor('.webrtc-controls').position).toBeUndefined()
    expect(declarationsFor('.webrtc-controls')['flex-wrap']).toBe('wrap')
    expect(declarationsFor('.webrtc-video-grid').overflow).toBe('auto')
    expect(declarationsFor('.webrtc-prejoin')['overflow-y']).toBe('auto')
    expect(declarationsFor('.webrtc-prejoin__preview .webrtc-video-tile').height).toBe('100%')
  })

  it('keeps conversation hiding, independent scrolling and mobile overlay behavior', () => {
    expect(declarationsFor('.interview-conversation-panel[hidden]').display).toBe('none')
    expect(declarationsFor('.interview-conversation-log')['overflow-y']).toBe('auto')
    expect(declarationsFor('.interview-conversation-panel', '(max-width: 767px)').position).toBe('absolute')
    expect(declarationsFor('.interview-conversation-panel', '(max-width: 767px)').width).toBe('min(420px, 100%)')
    expect(declarationsFor('.webrtc-prejoin', '(max-width: 1023px)')['grid-template-columns']).toBe('minmax(0, 1fr)')
    expect(declarationsFor('.interview-session-form', '(max-width: 767px)')['grid-template-columns']).toBe('minmax(0, 1fr)')
  })

  it('retains reduced-motion and keyboard-focus safeguards', () => {
    expect(declarationsFor('.interview-spinner', '(prefers-reduced-motion: reduce)').animation).toBe('none')
    expect(declarationsFor('.interview-page :where(button, a):focus-visible').outline).toBe('2px solid var(--accent-hover)')
    expect(declarationsFor('.interview-conversation-composer label')['clip-path']).toBe('inset(50%)')
  })
})
