import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Exercise the extracted UI handlers without a browser, network, or contract writes.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const index = host.index++
    const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => {
      cell.value = typeof value === 'function' ? value(cell.value) : value
      host.dirty = true
    }]
  },
  useEffect(effect, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) {
      host.cells[index] = { deps }
      host.effects.push(effect)
    }
  },
}))

import ContractTranslations from '../src/components/contract/ContractTranslations.jsx'
import ChangeRequests from '../src/components/contract/ChangeRequests.jsx'
import ContractLifecycle from '../src/components/contract/ContractLifecycle.jsx'
import ContractPeriod from '../src/components/contract/ContractPeriod.jsx'
import EmploymentEnd from '../src/components/contract/EmploymentEnd.jsx'
import PreSignCheck from '../src/components/contract/PreSignCheck.jsx'
import { buildArticlesFromTerms } from '../server/_lib/contract.js'
import { checkLegalCompliance, diffAgreedVsCurrent, findMissingFields } from '../server/_lib/contractCheck.js'
import { checkContractDocument } from '../server/_lib/documentCheck.js'
import { checkPeriodCompliance, checkContinuityCompliance } from '../server/_lib/contractPeriod.js'
import { checkProbationCompliance } from '../server/_lib/probation.js'

const walk = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? ''
  : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && text(node) === label)
const field = (tree, label) => walk(walk(tree).find(node => node.type === 'label' && text(node).startsWith(label)))
  .find(node => node.type === 'input' || node.type === 'select')
function render(Component, props) {
  for (let count = 0; count < 10; count++) {
    host.index = 0; host.effects = []; host.dirty = false
    const tree = Component(props)
    for (const effect of host.effects) effect()
    if (!host.dirty) return tree
  }
  throw new Error('Contract section did not settle')
}

beforeEach(() => {
  vi.clearAllMocks()
  host.cells = []; host.index = 0; host.effects = []; host.dirty = false
})

const translation = (language, stale = false) => ({
  language, nativeLabel: language, stale, articles: [{ heading: language, body: `translated ${language}` }],
})
const translationProps = () => ({
  translations: [], sourceArticles: [{ heading: '원문', body: '원문 내용' }],
  languages: [{ code: 'en', label: '영어', nativeLabel: 'English' }],
  canTranslate: true, onTranslate: vi.fn(), busy: false,
})

describe('contract translations', () => {
  it('shows the newest translation when one arrives after the initial empty render', () => {
    const props = translationProps()
    expect(text(render(ContractTranslations, props))).not.toContain('translated en')
    props.translations = [translation('en')]
    expect(text(render(ContractTranslations, props))).toContain('translated en')
    props.translations = [...props.translations, translation('vi')]
    const tree = render(ContractTranslations, props)
    expect(text(tree)).toContain('translated vi')
    expect(text(tree)).not.toContain('translated en')
  })

  it('keeps an explicit collapse until the user chooses another language', () => {
    const props = { ...translationProps(), translations: [translation('en')] }
    button(render(ContractTranslations, props), 'en').props.onClick()
    props.translations = [...props.translations, translation('vi')]
    const collapsed = render(ContractTranslations, props)
    expect(text(collapsed)).not.toContain('translated')
    button(collapsed, 'vi').props.onClick()
    expect(text(render(ContractTranslations, props))).toContain('translated vi')
  })

  it.each([
    [true, '지금 계약서와 다른 내용'],
    [null, '어느 시점의 내용을 옮긴 것인지 확인할 수 없습니다'],
    [false, null],
  ])('reports translation freshness %s without hiding the comparison', (stale, warning) => {
    const tree = render(ContractTranslations, { ...translationProps(), translations: [translation('en', stale)] })
    const alert = walk(tree).find(node => node.props?.role === 'alert')
    if (warning) expect(text(alert)).toContain(warning)
    else expect(alert).toBeUndefined()
    expect(text(tree)).toContain('원문 내용')
    expect(text(tree)).toContain('translated en')
  })

  it('respects translation permissions, source availability, and busy state', () => {
    const props = translationProps()
    expect(render(ContractTranslations, { ...props, canTranslate: false })).toBeNull()
    const empty = render(ContractTranslations, { ...props, sourceArticles: [] })
    expect(button(empty, '이 언어로 번역하기').props.disabled).toBe(true)
    expect(button(render(ContractTranslations, { ...props, busy: true }), '번역 중...').props.disabled).toBe(true)
    const ready = render(ContractTranslations, props)
    button(ready, '이 언어로 번역하기').props.onClick()
    expect(props.onTranslate).toHaveBeenCalledExactlyOnceWith('en')
  })
})

const requestProps = () => ({
  requests: [], myRole: 'candidate', canRequest: true, canRespond: false,
  onCreate: vi.fn(), onRespond: vi.fn(), busy: false, prefill: null,
})

describe('contract change requests', () => {
  it.each([false, true])('only clears the draft when submission confirms success: %s', async sent => {
    const props = requestProps()
    props.onCreate.mockResolvedValue(sent)
    let tree = render(ChangeRequests, props)
    for (const [label, value] of [['항목', 'workLocation'], ['요청하는 값', '테스트 근무지'], ['사유 (선택)', '합의 내용']]) {
      field(tree, label).props.onChange({ target: { value } })
      tree = render(ChangeRequests, props)
    }
    await walk(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    tree = render(ChangeRequests, props)
    expect(props.onCreate).toHaveBeenCalledExactlyOnceWith({ field: 'workLocation', requestedValue: '테스트 근무지', reason: '합의 내용' })
    expect(field(tree, '항목').props.value).toBe(sent ? '' : 'workLocation')
    expect(field(tree, '요청하는 값').props.value).toBe(sent ? '' : '테스트 근무지')
    expect(field(tree, '사유 (선택)').props.value).toBe(sent ? '' : '합의 내용')
  })

  it('applies a new check-result prefill and keeps subsequent user edits', () => {
    const props = requestProps()
    render(ChangeRequests, props)
    props.prefill = { field: 'wageBaseAmount', requestedValue: '2000000', reason: '합의 금액' }
    const tree = render(ChangeRequests, props)
    expect(field(tree, '항목').props.value).toBe('wageBaseAmount')
    expect(field(tree, '요청하는 값').props.value).toBe('2000000')
    field(tree, '요청하는 값').props.onChange({ target: { value: '2500000' } })
    expect(field(render(ChangeRequests, props), '요청하는 값').props.value).toBe('2500000')
  })

  it('opens pending requests and restricts responses to an authorized company', () => {
    const props = { ...requestProps(), requests: [{ id: 'request', label: '기본급', status: 'pending', requestedValue: '2000000' }] }
    const candidate = render(ChangeRequests, props)
    expect(candidate.props.defaultOpen).toBe(true)
    expect(candidate.props.hint).toBe('검토 중 1건')
    expect(button(candidate, '거절')).toBeUndefined()
    props.myRole = 'company'
    expect(button(render(ChangeRequests, props), '거절')).toBeUndefined()
    props.canRespond = true
    const company = render(ChangeRequests, props)
    button(company, '수락하고 계약서에 반영').props.onClick()
    button(company, '거절').props.onClick()
    expect(props.onRespond.mock.calls).toEqual([['request', 'accept'], ['request', 'decline']])
    props.busy = true
    expect(button(render(ChangeRequests, props), '거절').props.disabled).toBe(true)
  })
})

describe('contract lifecycle and sign checks', () => {
  const checkedTerms = () => ({
    employerName: 'Synthetic employer', employeeName: 'Synthetic employee',
    contractStartDate: '2026-09-01', contractEndDate: '2027-08-31',
    workLocation: '합성 테스트 근무지', jobDescription: '고객 응대 및 매장 관리',
    workHoursStart: '09:00', workHoursEnd: '18:00', workDays: '주 5일 (월~금)',
    restDays: '토요일, 일요일', breakTime: '12:00~13:00', wageBaseAmount: 3200000,
    wagePayMethod: '계좌이체', wagePayDate: '매월 25일', annualLeave: '근로기준법에 따름',
    employeeCount: 10,
  })
  // Mirror contract-view's pure checks, without storage, signing, AI or mail.
  const checked = terms => ({
    diffs: diffAgreedVsCurrent([], terms),
    legalIssues: [...checkLegalCompliance(terms), ...checkProbationCompliance(terms),
      ...checkPeriodCompliance(terms), ...checkContinuityCompliance(null)],
    missingFields: findMissingFields(terms), documentCheck: checkContractDocument(terms),
  })
  const assertScope = tree => {
    expect(text(tree)).toContain('기록된 변경 이력과 입력 조건, 일부 본문 표현')
    expect(text(tree)).toContain('전체 합의나 계약의 법적 유효성을 보증하지 않습니다')
    expect(text(tree)).toContain('계약서 전체를 직접 대조해주세요')
    expect(text(tree)).not.toContain('채팅에서 합의한 조건과 계약서 내용이 일치하며')
  }

  it('limits a clean manual-contract result to automatic checks without claiming a recorded agreement', () => {
    const check = checked(checkedTerms())
    expect(check.diffs).toEqual([])
    expect(check.legalIssues).toEqual([])
    expect(check.missingFields).toEqual([])
    expect(check.documentCheck).toEqual({ hasDocument: false, issues: [], missingArticles: [], hasConflict: false })
    const tree = PreSignCheck({ check })
    expect(text(tree)).toContain('자동 점검 대상 항목에서 차이·누락·경고가 발견되지 않았습니다')
    assertScope(tree)
  })

  it('does not certify whole-document agreement when an excluded semantic field differs', () => {
    const terms = checkedTerms()
    const articles = [...buildArticlesFromTerms(terms),
      { heading: '계약 당사자', body: `사업주 ${terms.employerName}, 근로자 ${terms.employeeName}` }]
    const jobArticle = articles.find(article => /업무의 내용/.test(article.heading))
    expect(jobArticle).toBeDefined()
    terms.aiDocument = articles.map(article => article === jobArticle
      ? { ...article, body: '일반 사무 보조 및 재고 운반 업무를 담당한다.' } : article)
    const check = checked(terms)
    expect(check.documentCheck.hasDocument).toBe(true)
    expect(check.documentCheck.issues).toEqual([])
    expect(check.documentCheck.missingArticles).toEqual([])
    const tree = PreSignCheck({ check })
    assertScope(tree)
    expect(text(tree)).toContain('자동 점검 대상 항목에서 차이·누락·경고가 발견되지 않았습니다')
    expect(text(tree)).not.toContain('계약서 본문도 조건과 같습니다')
  })

  it('keeps the checking limits visible for a warning and preserves existing repair actions', () => {
    const props = { check: checked({ ...checkedTerms(), wageBaseAmount: 1000 }), onRequestFix: vi.fn() }
    const tree = PreSignCheck(props)
    assertScope(tree)
    expect(text(tree)).not.toContain('자동 점검 대상 항목에서 차이·누락·경고가 발견되지 않았습니다')
    expect(text(tree)).toContain('최저임금 미달 소지')
    button(tree, '최소 적법 금액으로 요청').props.onClick()
    expect(props.onRequestFix).toHaveBeenCalledOnce()
    expect(props.onRequestFix.mock.calls[0][0].field).toBe('wageBaseAmount')
  })

  it('does not turn an unreadable time into a clean check result', () => {
    const check = checked({ ...checkedTerms(), workHoursStart: '아홉시' })
    expect(check.missingFields.some(item => item.field === 'workHoursStart' && item.unreadable)).toBe(true)
    const tree = PreSignCheck({ check })
    assertScope(tree)
    expect(text(tree)).toContain('필수 항목 누락')
    expect(text(tree)).not.toContain('자동 점검 대상 항목에서 차이·누락·경고가 발견되지 않았습니다')
  })

  it('keeps lifecycle status visible in the folded summary and gates linking', () => {
    const props = {
      continuity: null, retention: null, linkableRooms: [], canLink: false, canRecordEnd: false,
      onLink: vi.fn(), busy: false,
    }
    expect(render(ContractLifecycle, props)).toBeNull()
    props.canLink = true
    props.linkableRooms = [{ id: 'previous', title: '이전 계약' }]
    let tree = render(ContractLifecycle, props)
    expect(button(tree, '이전 계약으로 연결').props.disabled).toBe(true)
    walk(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'previous' } })
    tree = render(ContractLifecycle, props)
    button(tree, '이전 계약으로 연결').props.onClick()
    expect(props.onLink).toHaveBeenCalledExactlyOnceWith('previous')
    props.retention = { known: true, label: '보존 중', detail: '보존 안내', expired: false }
    props.employmentEnd = { endedAt: '2026-09-20' }
    expect(render(ContractLifecycle, props).props.hint).toBe('근로관계 종료 기록됨 · 보존 중')
  })

  it('submits employment-end input and limits clearing to authorized users', () => {
    const props = { employmentEnd: null, canRecord: false, onRecord: vi.fn(), onClear: vi.fn(), busy: false }
    expect(render(EmploymentEnd, props)).toBeNull()
    props.canRecord = true
    let tree = render(EmploymentEnd, props)
    expect(button(tree, '종료 기록하기').props.disabled).toBe(true)
    field(tree, '근로관계 종료일').props.onChange({ target: { value: '2026-09-20' } })
    field(tree, '사유 (선택)').props.onChange({ target: { value: '계약기간 만료' } })
    tree = render(EmploymentEnd, props)
    tree.props.onSubmit({ preventDefault() {} })
    expect(props.onRecord).toHaveBeenCalledExactlyOnceWith({ endedOn: '2026-09-20', reason: '계약기간 만료' })
    props.employmentEnd = { endedAt: '2026-09-20', reason: '계약기간 만료' }
    button(render(EmploymentEnd, props), '종료 기록 취소').props.onClick()
    expect(props.onClear).toHaveBeenCalledOnce()
    props.canRecord = false
    expect(button(render(EmploymentEnd, props), '종료 기록 취소')).toBeUndefined()
  })

  it('renders expiration status and its warning while hiding unknown periods', () => {
    expect(ContractPeriod({ period: { known: false } })).toBeNull()
    const html = renderToStaticMarkup(ContractPeriod({ period: {
      known: true, status: 'expiring_soon', label: '곧 만료', startDate: '2026-01-01',
      endDate: '2026-09-30', months: 9, remainingDays: 4, exceedsFixedTermLimit: false,
    } }))
    expect(html).toContain('badge-warning')
    expect(html).toContain('곧 만료')
    expect(html).toContain('계약 만료가 4일 남았습니다.')
  })

  it('keeps sign warnings and forwards repair requests from agreed values', () => {
    const props = {
      check: { diffs: [{ field: 'wageBaseAmount', label: '기본급', agreed: '2,000,000', current: '1,900,000' }],
        legalIssues: [], missingFields: [], documentCheck: { issues: [{ field: 'wageBaseAmount', label: '기본급', severity: 'high', conflict: true, message: '금액 불일치' }], missingArticles: [] } },
      onRequestFix: vi.fn(), onRedraft: vi.fn(), redrafting: false,
    }
    const tree = PreSignCheck(props)
    expect(text(tree)).toContain('이 상태로는 서명할 수 없습니다')
    button(tree, '합의대로 요청').props.onClick()
    expect(props.onRequestFix).toHaveBeenCalledExactlyOnceWith({
      field: 'wageBaseAmount', requestedValue: '2000000', reason: '면접에서 합의한 기본급(2,000,000)과(와) 다릅니다.',
    })
    button(tree, '현재 조건으로 본문 다시 작성').props.onClick()
    expect(props.onRedraft).toHaveBeenCalledOnce()
    expect(button(PreSignCheck({ ...props, redrafting: true }), '본문을 다시 쓰는 중...').props.disabled).toBe(true)
  })
})
