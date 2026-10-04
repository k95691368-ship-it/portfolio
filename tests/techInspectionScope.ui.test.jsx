import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const host = vi.hoisted(() => ({ tab: 'stack' }))
vi.mock('react', async original => {
  const react = await original()
  return { ...react, useState(initial) {
    return initial === 'system' ? [host.tab, () => {}] : react.useState(initial)
  } }
})
import TechPage from '../src/pages/TechPage.jsx'

const markup = () => renderToStaticMarkup(<MemoryRouter><TechPage /></MemoryRouter>)
beforeEach(() => { host.tab = 'stack' })

it('separates isolated write coverage from deployed read-only checks and actual effects', () => {
  const html = markup()
  expect(html).toContain('오프라인 단위·UI·격리 DB 회귀')
  expect(html).toContain('격리 로컬 HTTP 계약 경로')
  expect(html).toContain('운영 업무 쓰기와 실제 사용자 효과는 별도 검증합니다')
  expect(html).not.toContain('쓰기와 정리까지 포함한 운영 전 과정 검증')
})

it('does not describe current production account, signing and deletion as an automatic test', () => {
  const html = markup()
  expect(html).toContain('현재 쓰기·정리 검사는 외부 요청이 차단된 격리 로컬 DB·파일·메일함에서 수행합니다')
  expect(html).toContain('운영 자료와 실제 메일·계약·삭제는 별도 승인 없이는 시험하지 않습니다')
  expect(html).not.toContain('프로덕션에서 실제로 계정을 만들고 계약을 맺고 방을 지워 확인합니다')
})

it('preserves stack navigation and the source and trial links', () => {
  const html = markup()
  expect(html).toContain('id="tech-panel-stack"')
  expect(html).toContain('aria-labelledby="tech-tab-stack"')
  expect(html).toContain('href="https://github.com/k95691368-ship-it/portfolio"')
  expect(html).toContain('첫 화면의 1시간 체험')
})

it('keeps the initial system presentation unchanged', () => {
  host.tab = 'system'
  const html = markup()
  expect(html).toContain('id="tech-panel-system"')
  expect(html).toContain('채용 공고와 공개 지원')
  expect(html).not.toContain('id="tech-panel-stack"')
})
