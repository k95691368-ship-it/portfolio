import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import MyApplications from '../src/components/MyApplications.jsx'
import { describeApplicationProgress } from '../server/_lib/applicationProgress.js'

const application = overrides => {
  const row = {
    id: 'synthetic-application', postingTitle: '합성 공고', status: 'passed',
    roomId: 'synthetic-room', roomStatus: 'signed', roomArchived: false,
    createdAt: '2026-09-01T00:00:00Z', reviewedAt: '2026-09-02T00:00:00Z',
    signedAt: '2026-09-03T00:00:00Z', lookupCode: 'SYNTHETIC1', ...overrides,
  }
  return { ...row, progress: describeApplicationProgress(row) }
}
const markup = row => renderToStaticMarkup(
  <MemoryRouter><MyApplications applications={[row]} /></MemoryRouter>,
)
const step = (html, label) => [...html.matchAll(/<li class="[^"]+">[\s\S]*?<\/li>/g)]
  .map(match => match[0]).find(item => item.includes(`>${label}</span>`))

describe('my applications accessible stage descriptions', () => {
  it.each([false, true])('describes the reached signed stage without contradicting completion, archived=%s', roomArchived => {
    const row = application({ roomArchived })
    const html = markup(row)
    const contract = step(html, '근로계약 체결')
    // current means the reached stage; its visual/model meaning stays unchanged.
    expect(row.progress.steps.find(item => item.key === 'contract').state).toBe('current')
    expect(contract).toContain('class="step-current"')
    expect(contract).toContain('class="sr-only"> — 현재 단계</span>')
    expect(contract).not.toContain(' — 진행 중')
    expect(html).toContain(row.progress.headline)
    expect(html).toContain('href="/rooms/synthetic-room/contract"')
    expect(html).toContain(roomArchived ? '보관된 면접방 보기' : '체결된 계약서 보기')
  })

  it.each([
    { status: 'submitted', roomId: null, roomStatus: null, active: '지원서 접수', wording: '현재 단계' },
    { status: 'passed', roomId: null, roomStatus: null, active: '서류 심사', wording: '현재 단계' },
    { status: 'passed', roomStatus: 'open', active: '면접 진행', wording: '현재 단계' },
    { status: 'passed', roomStatus: 'contract_pending', active: '면접 진행', wording: '현재 단계' },
    { status: 'passed', roomStatus: 'closed', active: '면접 진행', wording: '여기서 중단됨' },
    { status: 'rejected', roomId: null, roomStatus: null, active: '서류 심사', wording: '여기서 중단됨' },
    { status: 'withdrawn', roomId: null, roomStatus: null, active: '지원서 접수', wording: '여기서 중단됨' },
  ])('preserves $status / $roomStatus descriptions without claiming contract completion', scenario => {
    const row = application(scenario)
    const html = markup(row)
    expect(step(html, scenario.active)).toContain(`class="sr-only"> — ${scenario.wording}</span>`)
    expect(step(html, '근로계약 체결')).toContain('class="sr-only"> — 예정</span>')
    expect(html).toContain(row.progress.headline)
  })

  it('does not relabel a stopped contract merely because the room status is signed', () => {
    const row = application()
    row.progress = { ...row.progress, steps: row.progress.steps.map(item => item.key === 'contract'
      ? { ...item, state: 'stopped' } : item) }
    expect(step(markup(row), '근로계약 체결')).toContain('class="sr-only"> — 여기서 중단됨</span>')
  })

  it('still renders no section for an empty application list', () => {
    expect(renderToStaticMarkup(<MemoryRouter><MyApplications applications={[]} /></MemoryRouter>)).toBe('')
  })
})
