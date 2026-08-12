// 계약서 화면의 폼 상태 — 빈 상태와, 서버 값에서 폼을 세우는 일.
//
// 이 둘이 계약서 화면 안에 나란히 적혀 있었다. 그래서 한쪽에만 있고 다른
// 쪽에 없는 항목이 생겼다. 상시 근로자 수가 그랬다 — 빈 상태에는 있고 서버
// 값에서 세울 때는 없어서, 저장한 값이 화면에 다시 나타나지 않았다. 서버에는
// 남아 있으니 판정은 그 값으로 도는데, 회사는 빈칸을 보고 다른 기준으로
// 판정받는 줄 안다. 화면에서 고칠 수도 없다 — 폼에 키가 없으니 다음 저장에도
// 실리지 않는다.
//
// 두 곳을 한 파일로 모으고, 항목이 빠지면 테스트가 잡게 한다.

export const EMPTY_FORM = {
  employerName: '',
  employerAddress: '',
  employeeName: '',
  employeeAddress: '',
  contractStartDate: '',
  contractEndDate: '',
  workLocation: '',
  jobDescription: '',
  workHoursStart: '',
  workHoursEnd: '',
  breakTime: '',
  workDays: '',
  restDays: '',
  wageBaseAmount: '',
  wagePayMethod: '',
  wagePayDate: '',
  annualLeave: '',
  employeeCount: '',
  socialInsurance: {},
  customTerms: [],
  wageItems: [],
}

// 서버가 준 계약 조건으로 폼을 세운다.
//
// 아직 아무것도 저장되지 않은 방에서는 당사자 이름을 참여자에서 끌어와
// 미리 채운다 — 회사명과 지원자 이름은 이미 아는 값이라 다시 묻지 않는다.
export function formFromTerms(terms, participants = []) {
  const t = terms || {}
  const company = (participants || []).find((p) => p.role === 'company')
  const candidate = (participants || []).find((p) => p.role === 'candidate')

  const form = {}
  for (const [key, empty] of Object.entries(EMPTY_FORM)) {
    form[key] = t[key] ?? (Array.isArray(empty) ? [] : typeof empty === 'object' ? {} : '')
  }

  if (!form.employerName) form.employerName = company?.companyName ?? company?.displayName ?? ''
  if (!form.employeeName) form.employeeName = candidate?.displayName ?? ''

  return form
}
