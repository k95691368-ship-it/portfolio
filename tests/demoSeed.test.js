// 데모에 심는 값이 의도한 점검을 실제로 발동시키는지 확인한다.
//
// 데모에서 가장 나쁜 결과는 아무 경고도 뜨지 않는 것이다. 평가자는 "법령 점검"이
// 있다는 말만 듣고 아무것도 못 본 채 나간다. 그래서 심는 값과 점검 코드를
// 여기서 묶어 둔다. 나중에 최저임금이 오르거나 계산식이 바뀌면 이 테스트가 먼저
// 깨져, 데모가 조용히 무력해지는 것을 막는다.
import { describe, expect, it } from 'vitest'
import {
  DEMO_WALKTHROUGH,
  DEMO_ROOM_PENDING,
  DEMO_ROOM_SIGNED,
  DEMO_ROOM_PREVIOUS,
  DEMO_ROOMS,
  DEMO_POSTING,
  DEMO_ACCOUNTS,
  DEMO_APPLICATIONS,
  EXPECTED_PENDING_ISSUES,
  EXPECTED_PENDING_MISSING,
  demoSignatureDataUrl,
  DEMO_DOMAIN,
} from '../functions/_lib/demoSeed.js'
import {
  checkLegalCompliance,
  findMissingFields,
  computeWeeklyHours,
} from '../functions/_lib/contractCheck.js'
import { checkPeriodCompliance, describeRetention } from '../functions/_lib/contractPeriod.js'
import { checkProbationCompliance } from '../functions/_lib/probation.js'
import { comparePostingToContract } from '../functions/_lib/postingMatch.js'

const NOW = new Date(Date.UTC(2026, 8, 15)) // 2026-09-15

function allIssues(terms) {
  return [
    ...checkLegalCompliance(terms),
    ...checkPeriodCompliance(terms, NOW),
    ...checkProbationCompliance(terms),
  ]
}

describe('데모 방 B (서명 전) — 심은 결함이 실제로 발동한다', () => {
  const terms = DEMO_ROOM_PENDING.terms

  it('주 근로시간이 60시간으로 계산된다', () => {
    // 09:00~20:00 = 11시간, 휴게 1시간을 빼면 10시간. 주 6일이면 60시간.
    expect(computeWeeklyHours(terms)).toBe(60)
  })

  it('의도한 위반이 하나도 빠짐없이 나온다', () => {
    const titles = allIssues(terms).map((i) => i.title)
    for (const want of EXPECTED_PENDING_ISSUES) {
      expect(titles, `"${want}"가 점검 결과에 없습니다. 데모가 무력해집니다.`).toContain(want)
    }
  })

  it('최저임금 미달이 high 이고 적법 금액을 제안한다', () => {
    const issue = allIssues(terms).find((i) => i.title === '최저임금 미달 소지')
    expect(issue.severity).toBe('high')
    expect(issue.field).toBe('wageBaseAmount')
    expect(Number(issue.suggestedValue)).toBeGreaterThan(Number(terms.wageBaseAmount))
  })

  it('주 52시간 초과가 high 이다', () => {
    expect(allIssues(terms).find((i) => i.title === '주 52시간 초과').severity).toBe('high')
  })

  // 서명이 확인 체크로도 통과되지 않아야, 아무나 로그인하는 공개 데모에서
  // 이 방이 원래 상태로 남는다.
  it('제17조 명시사항이 비어 있어 서명이 하드 차단된다', () => {
    const missing = findMissingFields(terms).map((m) => m.field)
    for (const want of EXPECTED_PENDING_MISSING) {
      expect(missing).toContain(want)
    }
    expect(missing.length).toBeGreaterThan(0)
  })

  it('공고보다 불리한 조건이 임금·시간·근무일 모두에서 잡힌다', () => {
    const compared = comparePostingToContract(DEMO_POSTING, terms)
    expect(compared.comparable).toBe(true)
    expect(compared.hasUnfavorable).toBe(true)
    const fields = compared.issues.map((i) => i.field)
    expect(fields).toContain('wageBaseAmount')
    expect(compared.issues.length).toBeGreaterThanOrEqual(2)
  })
})

describe('데모 방 A (체결 완료) — 적법하고, 보존 기간이 시작되지 않았다', () => {
  const terms = DEMO_ROOM_SIGNED.terms

  it('법적 문제가 없다', () => {
    const high = allIssues(terms).filter((i) => i.severity === 'high')
    expect(high, `체결된 데모 계약에 high 위반이 있으면 안 됩니다: ${JSON.stringify(high)}`).toHaveLength(0)
  })

  it('제17조 명시사항이 모두 채워져 있다', () => {
    expect(findMissingFields(terms)).toHaveLength(0)
  })

  it('종료일이 없어 재직 중으로 보고 보존 기간을 시작하지 않는다', () => {
    const r = describeRetention(terms, '2026-08-25', NOW)
    expect(r.known).toBe(true)
    expect(r.ongoing).toBe(true)
    expect(r.expired).toBe(false)
  })

  it('공고와 어긋나지 않는다', () => {
    const compared = comparePostingToContract(DEMO_POSTING, terms)
    expect(compared.hasUnfavorable).toBe(false)
  })
})

describe('데모 방 C (이전 기간제 계약)', () => {
  it('그 자체로는 2년을 넘지 않는다', () => {
    const titles = allIssues(DEMO_ROOM_PREVIOUS.terms).map((i) => i.title)
    expect(titles).not.toContain('기간제 2년 초과')
  })

  it('법적 문제가 없다', () => {
    expect(allIssues(DEMO_ROOM_PREVIOUS.terms).filter((i) => i.severity === 'high')).toHaveLength(0)
  })
})

describe('데모 데이터의 안전 조건', () => {
  it('모든 계정이 demo.invalid 도메인이다', () => {
    // 정리가 이 표식 하나로 이루어지므로, 벗어나면 실데이터와 섞인다.
    for (const a of DEMO_ACCOUNTS) expect(a.email.endsWith(`@${DEMO_DOMAIN}`)).toBe(true)
    for (const a of DEMO_APPLICATIONS) expect(a.email.endsWith(`@${DEMO_DOMAIN}`)).toBe(true)
  })

  // 계약서에 적힌 이름과 그 방에 실제로 있는 사람이 다르면 화면이 앞뒤가 안 맞는다.
  it('방마다 계약서의 근로자명과 참여 계정이 일치한다', () => {
    for (const room of DEMO_ROOMS) {
      const account = DEMO_ACCOUNTS.find((a) => a.key === room.candidateKey)
      expect(account, `방 ${room.key} 의 candidateKey 가 계정과 맞지 않습니다`).toBeTruthy()
      expect(account.displayName).toBe(room.terms.employeeName)
    }
  })

  // 공고 대조는 applications.room_id 로 이어진다. 연결이 없으면 그 기능이
  // 데모에서 통째로 사라진다 — 실제로 한 번 그렇게 빠졌다.
  it('결함이 있는 방에는 공고와 이어줄 지원서가 붙어 있다', () => {
    expect(DEMO_ROOM_PENDING.applicationKey).toBeTruthy()
    const app = DEMO_APPLICATIONS.find((a) => a.key === DEMO_ROOM_PENDING.applicationKey)
    expect(app).toBeTruthy()
    expect(app.status).toBe('passed')
    expect(app.name).toBe(DEMO_ROOM_PENDING.terms.employeeName)
  })

  it('서명 이미지가 data URL 형식이다', () => {
    const url = demoSignatureDataUrl('이지원')
    expect(url.startsWith('data:image/')).toBe(true)
    expect(url.length).toBeLessThan(2_000_000)
  })

  it('공고 임금 하한이 방 B 계약 임금보다 높다', () => {
    // 이 관계가 뒤집히면 "공고보다 불리" 장면이 사라진다.
    expect(DEMO_POSTING.wageMin).toBeGreaterThan(DEMO_ROOM_PENDING.terms.wageBaseAmount)
  })
})

// 안내가 가리키는 방이 실제로 있는가.
//
// 안내 문구와 방 제목이 서로 다른 곳에 적혀 있으면, 제목을 고쳐도 안내만 옛
// 이름을 가리킨다. 평가자는 안내가 말하는 방을 찾지 못한다.
describe('데모 안내와 실제 데모가 같은 것을 가리키는가', () => {
  const ROOM_TITLES = [DEMO_ROOM_PREVIOUS, DEMO_ROOM_SIGNED, DEMO_ROOM_PENDING].map((r) => r.title)

  it('안내가 세 단계로 되어 있다', () => {
    expect(DEMO_WALKTHROUGH).toHaveLength(3)
    for (const s of DEMO_WALKTHROUGH) {
      expect(typeof s.title).toBe('string')
      expect(s.title.length).toBeGreaterThan(0)
      expect(typeof s.body).toBe('string')
    }
  })

  it('안내가 인용하는 방 이름이 실제로 심는 방 이름이다', () => {
    const quoted = DEMO_WALKTHROUGH.flatMap((s) => [...s.body.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
    expect(quoted.length).toBeGreaterThan(0)
    for (const name of quoted) {
      expect(ROOM_TITLES).toContain(name)
    }
  })

  it('서명 전 방과 체결된 방을 모두 안내한다', () => {
    const body = DEMO_WALKTHROUGH.map((s) => s.body).join(' ')
    expect(body).toContain(DEMO_ROOM_PENDING.title)
    expect(body).toContain(DEMO_ROOM_SIGNED.title)
  })
})
