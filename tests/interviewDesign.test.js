import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/features/interview/interview.css', import.meta.url), 'utf8')

// Read repeated rules in source order so late presentation overrides are checked too.
function declarationsFor(selector) {
  const declarations = {}
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').some((part) => part.trim() === selector)) continue
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      declarations[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim()
    }
  }
  return declarations
}

describe('Microsoft light interview presentation', () => {
  it('keeps the interview page and meeting controls in the light color scheme', () => {
    expect(declarationsFor('.interview-page')['color-scheme']).toBe('light')
    expect(declarationsFor('.interview-page--meeting')['color-scheme']).toBe('light')
    expect(declarationsFor('.interview-page')['--interview-card']).toBe('var(--panel)')
    expect(declarationsFor('.webrtc-controls').background).toBe('var(--panel)')
    expect(declarationsFor('.webrtc-device-panel').background).toBe('var(--panel)')
  })

  it('keeps the actual video canvas dark with legible overlay labels', () => {
    expect(declarationsFor('.webrtc-video-tile').background).toBe('#171717')
    expect(declarationsFor('.webrtc-video-tile')['color-scheme']).toBe('dark')
    expect(declarationsFor('.webrtc-video-tile > strong').color).toBe('#ffffff')
    expect(declarationsFor('.webrtc-video-avatar').color).toBe('#ffffff')
  })

  it('retains dark text on light chat panels and white text on blue outgoing messages', () => {
    expect(declarationsFor('.interview-conversation-panel').color).toBe('#1a1a1a')
    expect(declarationsFor('.interview-conversation-message p').color).toBe('#1a1a1a')
    expect(declarationsFor('.interview-conversation-message.is-mine p').color).toBe('#ffffff')
    expect(declarationsFor('.webrtc-controls button.is-active').color).toBe('#ffffff')
    expect(declarationsFor('.interview-conversation-message__meta time').color).toBe('#616161')
  })

  it('uses modular cards, rounded inputs and touchable pill buttons', () => {
    expect(declarationsFor('.interview-state-card')['border-radius']).toBe('20px')
    expect(declarationsFor('.interview-consent-card')['border-radius']).toBe('20px')
    expect(declarationsFor('.webrtc-device-panel select')['border-radius']).toBe('12px')
    expect(declarationsFor('.interview-page button')['border-radius']).toBe('999px')
    expect(declarationsFor('.interview-page button')['min-height']).toBe('44px')
  })
})
