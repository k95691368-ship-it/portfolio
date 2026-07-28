import { describe, it, expect } from 'vitest'
import {
  careerMonths,
  formatCareer,
  toComparable,
  rankApplicants,
  summarizeRanking,
} from '../functions/_lib/ranking.js'

const NOW = new Date(Date.UTC(2026, 8, 15)) // 2026-09-15 기준으로 고정

describe('careerMonths', () => {
  it('시작월과 종료월을 모두 재직으로 센다', () => {
    expect(careerMonths([{ startDate: '2024-01', endDate: '2024-12' }], NOW)).toBe(12)
    expect(careerMonths([{ startDate: '2024-01', endDate: '2024-01' }], NOW)).toBe(1)
  })

  it('재직 중이면 오늘까지 센다', () => {
    expect(careerMonths([{ startDate: '2026-01', current: true }], NOW)).toBe(9)
  })

  it('겹치는 기간을 두 번 세지 않는다', () => {
    const overlapping = [
      { startDate: '2024-01', endDate: '2024-12' },
      { startDate: '2024-07', endDate: '2025-06' },
    ]
    // 2024-01 ~ 2025-06 = 18개월 (24개월이 아니다)
    expect(careerMonths(overlapping, NOW)).toBe(18)
  })

  it('떨어져 있는 경력은 각각 더한다', () => {
    const gapped = [
      { startDate: '2020-01', endDate: '2020-06' },
      { startDate: '2024-01', endDate: '2024-06' },
    ]
    expect(careerMonths(gapped, NOW)).toBe(12)
  })

  it('날짜를 알 수 없거나 순서가 뒤집힌 항목은 무시한다', () => {
    expect(careerMonths([{ startDate: '', endDate: '2024-01' }], NOW)).toBe(0)
    expect(careerMonths([{ startDate: '2024-12', endDate: '2024-01' }], NOW)).toBe(0)
    expect(careerMonths([], NOW)).toBe(0)
    expect(careerMonths(null, NOW)).toBe(0)
  })

  it('여러 표기를 읽는다', () => {
    expect(careerMonths([{ startDate: '2024년 1월', endDate: '2024.06' }], NOW)).toBe(6)
  })
})

describe('formatCareer', () => {
  it('사람이 읽는 형태로 바꾼다', () => {
    expect(formatCareer(0)).toBe('경력 정보 없음')
    expect(formatCareer(7)).toBe('7개월')
    expect(formatCareer(24)).toBe('2년')
    expect(formatCareer(30)).toBe('2년 6개월')
  })
})

describe('toComparable', () => {
  it('심사 전 지원서는 판단 보류로 둔다', () => {
    const c = toComparable(
      { id: 'a', applicantName: '홍길동', status: 'submitted', createdAt: '2026-01-01', career: [] },
      NOW
    )
    expect(c.screened).toBe(false)
    expect(c.fit).toBe('unknown')
    expect(c.fitLabel).toBe('판단 보류')
  })

  it('알 수 없는 적합도 값은 판단 보류로 되돌린다', () => {
    const c = toComparable(
      {
        id: 'a',
        applicantName: '홍길동',
        status: 'submitted',
        createdAt: '2026-01-01',
        career: [],
        screening: { fit: '아주좋음' },
      },
      NOW
    )
    expect(c.fit).toBe('unknown')
  })
})

function applicant(over) {
  return {
    id: over.id,
    applicantName: over.name,
    status: over.status ?? 'submitted',
    createdAt: over.createdAt ?? '2026-01-01',
    career: over.career ?? [],
    screening: over.fit ? { fit: over.fit, fitReason: '', strengths: [], concerns: [] } : null,
  }
}

describe('rankApplicants', () => {
  it('적합도가 높은 순으로 세운다', () => {
    const ranked = rankApplicants(
      [
        applicant({ id: 'low', name: 'C', fit: 'low' }),
        applicant({ id: 'high', name: 'A', fit: 'high' }),
        applicant({ id: 'mid', name: 'B', fit: 'medium' }),
      ],
      NOW
    )
    expect(ranked.map((r) => r.id)).toEqual(['high', 'mid', 'low'])
    expect(ranked[0].rank).toBe(1)
  })

  it('적합도가 같으면 경력이 긴 쪽이 앞선다', () => {
    const ranked = rankApplicants(
      [
        applicant({ id: 'short', name: 'A', fit: 'high', career: [{ startDate: '2025-01', endDate: '2025-06' }] }),
        applicant({ id: 'long', name: 'B', fit: 'high', career: [{ startDate: '2020-01', endDate: '2025-12' }] }),
      ],
      NOW
    )
    expect(ranked.map((r) => r.id)).toEqual(['long', 'short'])
  })

  it('기준이 모두 같으면 먼저 지원한 사람이 앞서되 순위는 같다', () => {
    const ranked = rankApplicants(
      [
        applicant({ id: 'late', name: 'B', fit: 'high', createdAt: '2026-02-01' }),
        applicant({ id: 'early', name: 'A', fit: 'high', createdAt: '2026-01-01' }),
      ],
      NOW
    )
    expect(ranked.map((r) => r.id)).toEqual(['early', 'late'])
    expect(ranked[0].rank).toBe(1)
    expect(ranked[1].rank).toBe(1)
  })

  it('심사 전 지원서는 뒤로, 불합격은 맨 뒤로 보낸다', () => {
    const ranked = rankApplicants(
      [
        applicant({ id: 'rejected', name: 'X', fit: 'high', status: 'rejected' }),
        applicant({ id: 'unscreened', name: 'Y' }),
        applicant({ id: 'low', name: 'Z', fit: 'low' }),
      ],
      NOW
    )
    expect(ranked.map((r) => r.id)).toEqual(['low', 'unscreened', 'rejected'])
  })

  it('서류합격자를 맨 앞에 둔다', () => {
    const ranked = rankApplicants(
      [
        applicant({ id: 'high', name: 'A', fit: 'high' }),
        applicant({ id: 'passed', name: 'B', fit: 'low', status: 'passed' }),
      ],
      NOW
    )
    expect(ranked[0].id).toBe('passed')
  })

  it('왜 그 자리인지 근거를 함께 준다', () => {
    const ranked = rankApplicants(
      [applicant({ id: 'a', name: 'A', fit: 'high', career: [{ startDate: '2024-01', endDate: '2025-12' }] })],
      NOW
    )
    expect(ranked[0].basis).toContain('직무 적합도 적합')
    expect(ranked[0].basis).toContain('경력 2년')
  })

  it('심사 전이라는 사실을 근거에 밝힌다', () => {
    const ranked = rankApplicants([applicant({ id: 'a', name: 'A' })], NOW)
    expect(ranked[0].basis).toContain('AI 심사 전')
  })

  it('빈 목록도 처리한다', () => {
    expect(rankApplicants([], NOW)).toEqual([])
    expect(rankApplicants(null, NOW)).toEqual([])
  })
})

describe('summarizeRanking', () => {
  it('한눈에 볼 수 있게 집계한다', () => {
    const ranked = rankApplicants(
      [
        applicant({ id: '1', name: 'A', fit: 'high' }),
        applicant({ id: '2', name: 'B', fit: 'high' }),
        applicant({ id: '3', name: 'C', fit: 'low' }),
        applicant({ id: '4', name: 'D' }),
        applicant({ id: '5', name: 'E', fit: 'medium', status: 'rejected' }),
      ],
      NOW
    )
    const s = summarizeRanking(ranked)
    expect(s.total).toBe(5)
    expect(s.byFit.high).toBe(2)
    expect(s.unscreened).toBe(1)
    expect(s.rejected).toBe(1)
  })
})
