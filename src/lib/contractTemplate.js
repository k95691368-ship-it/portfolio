export const IDENTITY_FIELDS = [
  { key: 'employerName', label: '사업체명(사용자)' },
  { key: 'employerAddress', label: '사업체 주소' },
  { key: 'employeeName', label: '근로자 성명' },
  { key: 'employeeAddress', label: '근로자 주소' },
]

export const TERM_FIELDS = [
  { key: 'contractStartDate', label: '근로개시일', placeholder: '예: 2026-08-01' },
  { key: 'contractEndDate', label: '계약종료일 (기간 정함 없으면 비움)', placeholder: '예: 2027-07-31' },
  { key: 'workLocation', label: '근무장소' },
  { key: 'jobDescription', label: '업무의 내용' },
  { key: 'workHoursStart', label: '근무 시작 시각', placeholder: '예: 09:00' },
  { key: 'workHoursEnd', label: '근무 종료 시각', placeholder: '예: 18:00' },
  { key: 'workDays', label: '근무일', placeholder: '예: 주 5일 (월~금)' },
  { key: 'restDays', label: '휴일', placeholder: '예: 토, 일' },
  { key: 'wageBaseAmount', label: '기본급(원)', type: 'number' },
  { key: 'wagePayMethod', label: '임금 지급 방법', placeholder: '예: 계좌이체' },
  { key: 'wagePayDate', label: '임금 지급일', placeholder: '예: 매월 25일' },
  { key: 'annualLeave', label: '연차유급휴가' },
  { key: 'uniformSize', label: '유니폼 사이즈' },
]

export const SOCIAL_INSURANCE_FIELDS = [
  { key: 'employment_insurance', label: '고용보험' },
  { key: 'health_insurance', label: '건강보험' },
  { key: 'national_pension', label: '국민연금' },
  { key: 'industrial_accident_insurance', label: '산재보험' },
]
