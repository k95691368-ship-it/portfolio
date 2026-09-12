import { describe, it, expect } from 'vitest'
import { EXAMPLE_POSTING, POSTING_SECTIONS, POSTING_EMOJIS, insertPostingText, parsePostingDescription } from '../shared/jobPostingTemplate.js'
describe('job posting tools', () => {
  it('includes all seven requested sections in order and labels the public example', () => {
    const headings = parsePostingDescription(EXAMPLE_POSTING.description).filter(b => b.type === 'heading')
    expect(headings).toHaveLength(7)
    headings.forEach((h, i) => expect(h.text).toContain(POSTING_SECTIONS[i]))
    expect(EXAMPLE_POSTING.title).toContain('[예시 공고]')
    expect(EXAMPLE_POSTING.description).toContain('실제 채용을 진행하지 않습니다')
    expect(EXAMPLE_POSTING.description).toContain('월 320만~380만원')
  })
  it.each(POSTING_EMOJIS)('inserts %s at the current cursor', (emoji) => {
    expect(insertPostingText('앞뒤', emoji, 1)).toEqual({ value: `앞${emoji}뒤`, cursor: 1 + emoji.length })
  })
  it('replaces only the selection and preserves existing emoji', () => {
    expect(insertPostingText('📋 앞뒤', '✨', 3, 4)).toEqual({ value: '📋 ✨뒤', cursor: 4 })
  })
  it('does not interpret arbitrary HTML as structure', () => {
    expect(parsePostingDescription('<script>alert(1)</script>')).toEqual([{ type: 'text', text: '<script>alert(1)</script>' }])
  })
})
