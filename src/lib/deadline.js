// 채용 공고 마감일 안내 (순수 함수 — 단위 테스트 대상).
//
// 목록에는 마감일 날짜만 적혀 있었다. 오늘이 며칠인지 세어 봐야 급한지
// 알 수 있고, 오늘까지인 공고와 두 달 남은 공고가 똑같아 보인다.
// 남은 날을 대신 세어 준다.

import { koreanToday } from '../../functions/_lib/koreanTime.js'

const DAY_MS = 24 * 60 * 60 * 1000
export const DEADLINE_SOON_DAYS = 7

function parseDay(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [, y, mo, d] = m.map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

// { known, daysLeft, label, soon, over }
export function describeDeadline(deadline, now = new Date()) {
  const end = parseDay(deadline)
  if (!end) return { known: false, label: '상시 모집' }

  // 브라우저의 now 는 사용자 로컬 시각이지만 getUTC* 로 꺼내면 UTC 날짜가 된다.
  // 한국시간 새벽에는 그것이 어제라, 오늘 마감인 공고가 "1일 남음"으로 보이고
  // 어제 마감된 공고가 "오늘 마감"으로 보였다. 마감일은 공고를 낸 한국 회사의
  // 달력이 기준이므로 서버와 같은 함수를 쓴다.
  const today = koreanToday(now)
  const daysLeft = Math.round((end.getTime() - today.getTime()) / DAY_MS)

  if (daysLeft < 0) return { known: true, daysLeft, over: true, soon: false, label: '마감됨' }
  if (daysLeft === 0) return { known: true, daysLeft, over: false, soon: true, label: '오늘 마감' }
  return {
    known: true,
    daysLeft,
    over: false,
    soon: daysLeft <= DEADLINE_SOON_DAYS,
    label: `마감 ${daysLeft}일 전`,
  }
}
