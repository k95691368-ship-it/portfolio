// 지원서 작성 상태 판단 (순수 함수 — 단위 테스트 대상).
//
// 지원서는 이름·연락처·경력·자기소개·첨부까지 한 화면에서 다 쓰게 되어 있다.
// 다 쓰고 나서 실수로 뒤로 가거나 탭을 닫으면 전부 사라진다. 로그인 없이
// 지원하는 구조라 임시 저장된 것도 없다. 그래서 "쓰다 만 것이 있는가"를
// 판단해, 떠나기 전에 한 번 되묻는다.

function filled(value) {
  return typeof value === 'string' && value.trim() !== ''
}

// 경력 항목은 빈 칸으로 추가만 해 둔 상태일 수 있다. 한 칸이라도 채웠을 때만
// 쓰다 만 것으로 본다.
function careerFilled(career) {
  if (!career || typeof career !== 'object') return false
  return ['employmentType', 'companyName', 'startDate', 'endDate', 'department', 'position', 'description'].some(
    (k) => filled(career[k])
  )
}

export function isApplyFormDirty(form) {
  if (!form) return false
  if ([form.name, form.email, form.phone, form.source, form.coverLetter].some(filled)) return true
  if (form.resume || form.portfolio) return true
  if (Array.isArray(form.careers) && form.careers.some(careerFilled)) return true
  // 동의만 눌러 둔 상태는 잃을 것이 없다고 본다.
  return false
}

export const LEAVE_CONFIRM_MESSAGE =
  '작성 중인 지원서가 있습니다. 이 화면을 벗어나면 입력한 내용이 사라집니다. 나가시겠습니까?'
