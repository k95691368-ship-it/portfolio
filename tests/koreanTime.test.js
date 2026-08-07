// 서버는 UTC, 사용자는 한국(UTC+9).
//
// 한국시간 0시부터 9시까지 아홉 시간 동안 서버가 보는 "오늘"은 사용자가 보는
// "어제"다. 날짜만 비교하는 자리에서 이 어긋남이 그대로 들어가면, 그 아홉 시간
// 동안 사용자는 오늘 날짜조차 미래로 거부당한다.
import { describe, expect, it } from 'vitest'
import { koreanToday, koreanDateString } from '../functions/_lib/koreanTime.js'
import { describeContractPeriod, describeRetention } from '../functions/_lib/contractPeriod.js'
import { describeAnnualLeave } from '../functions/_lib/workerRights.js'

// 한국시간 2026-08-08 01:00 = UTC 2026-08-07 16:00
const KST_EARLY_MORNING = new Date('2026-08-07T16:00:00Z')
// 한국시간 2026-08-07 22:00 = UTC 2026-08-07 13:00 (같은 날)
const KST_EVENING = new Date('2026-08-07T13:00:00Z')

describe('koreanToday', () => {
  it('한국시간 새벽에는 UTC보다 하루 앞선 날짜다', () => {
    expect(KST_EARLY_MORNING.toISOString().slice(0, 10)).toBe('2026-08-07') // 서버가 보는 날
    expect(koreanDateString(KST_EARLY_MORNING)).toBe('2026-08-08') // 사용자가 보는 날
  })

  it('한국시간 저녁에는 UTC와 같은 날짜다', () => {
    expect(koreanDateString(KST_EVENING)).toBe('2026-08-07')
  })

  it('UTC 자정 Date 로 돌려준다 (계약 날짜와 같은 형태)', () => {
    const t = koreanToday(KST_EARLY_MORNING)
    expect(t.getUTCHours()).toBe(0)
    expect(t.toISOString()).toBe('2026-08-08T00:00:00.000Z')
  })
})

describe('새벽에도 날짜 판정이 밀리지 않는다', () => {
  // 만료일이 오늘(한국 기준)이면 아직 만료가 아니다. UTC로 재면 어제가 되어
  // "만료 1일 전"이 하루 더 붙는다.
  it('계약 만료일이 한국 기준 오늘이면 남은 일수가 0이다', () => {
    const p = describeContractPeriod(
      { contractStartDate: '2026-01-01', contractEndDate: '2026-08-08' },
      KST_EARLY_MORNING
    )
    expect(p.remainingDays).toBe(0)
    expect(p.status).toBe('expiring_soon')
  })

  it('한국 기준 어제 끝난 계약은 만료로 본다', () => {
    const p = describeContractPeriod(
      { contractStartDate: '2026-01-01', contractEndDate: '2026-08-07' },
      KST_EARLY_MORNING
    )
    expect(p.status).toBe('expired')
  })

  it('보존 기간도 한국 달력으로 센다', () => {
    // 근로관계가 2023-08-08 에 끝났으면 보존 기한은 2026-08-08. 오늘이 그 날이면
    // 아직 지나지 않았다.
    const r = describeRetention({}, '2023-01-01', KST_EARLY_MORNING, '2023-08-08')
    expect(r.until).toBe('2026-08-08')
    expect(r.remainingDays).toBe(0)
    expect(r.expired).toBe(false)
  })

  it('연차 발생일이 한국 기준 오늘이면 이미 발생한 것으로 본다', () => {
    // 2025-08-08 입사 → 1년째가 2026-08-08. 한국 기준 오늘이므로 "다음 발생"은
    // 그 이후여야 한다.
    const a = describeAnnualLeave(
      {
        contractStartDate: '2025-08-08',
        workHoursStart: '09:00',
        workHoursEnd: '18:00',
        workDays: '주 5일 (월~금)',
      },
      KST_EARLY_MORNING
    )
    expect(a.upcoming?.at).not.toBe('2026-08-08')
  })
})

describe('공고 마감일도 한국 달력으로', () => {
  it('한국 기준 오늘이 마감일이면 아직 마감이 아니다', async () => {
    const { describeDeadline } = await import('../src/lib/deadline.js')
    // 한국시간 2026-08-08 01:00. 마감일이 오늘이면 "오늘 마감"이어야 한다.
    const d = describeDeadline('2026-08-08', KST_EARLY_MORNING)
    expect(d.over).toBe(false)
    expect(d.daysLeft).toBe(0)
    expect(d.label).toBe('오늘 마감')
  })

  it('한국 기준 어제 마감된 공고는 마감으로 본다', async () => {
    const { describeDeadline } = await import('../src/lib/deadline.js')
    expect(describeDeadline('2026-08-07', KST_EARLY_MORNING).over).toBe(true)
  })
})
