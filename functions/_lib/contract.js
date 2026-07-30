// 계약서에서 값을 고칠 수 있는 항목 (API 이름 → DB 컬럼).
// 계약 조건 수정과 수정 요청이 같은 목록을 공유한다.
export const EDITABLE_FIELDS = {
  employerName: 'employer_name',
  employerAddress: 'employer_address',
  employeeName: 'employee_name',
  employeeAddress: 'employee_address',
  workLocation: 'work_location',
  jobDescription: 'job_description',
  contractStartDate: 'contract_start_date',
  contractEndDate: 'contract_end_date',
  workHoursStart: 'work_hours_start',
  workHoursEnd: 'work_hours_end',
  workDays: 'work_days',
  restDays: 'rest_days',
  wageBaseAmount: 'wage_base_amount',
  wagePayMethod: 'wage_pay_method',
  wagePayDate: 'wage_pay_date',
  annualLeave: 'annual_leave',
  uniformSize: 'uniform_size',
}

// AI 초안이 아직 없는 계약서도 번역할 수 있도록, 입력된 조건을 조항 형태로 만든다.
export function buildArticlesFromTerms(terms) {
  if (!terms) return []
  const rows = [
    ['근로계약기간', [terms.contractStartDate, terms.contractEndDate].filter(Boolean).join(' ~ ')],
    ['근무장소', terms.workLocation],
    ['업무의 내용', terms.jobDescription],
    [
      '소정근로시간',
      [terms.workHoursStart, terms.workHoursEnd].filter(Boolean).join(' ~ '),
    ],
    ['근무일 및 휴일', [terms.workDays, terms.restDays].filter(Boolean).join(' / ')],
    [
      '임금',
      [
        terms.wageBaseAmount ? `기본급 ${Number(terms.wageBaseAmount).toLocaleString('ko-KR')}원` : '',
        terms.wagePayMethod,
        terms.wagePayDate,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    ['연차유급휴가', terms.annualLeave],
  ]

  const articles = rows
    .filter(([, value]) => value && String(value).trim() !== '')
    .map(([heading, body], i) => ({ heading: `제${i + 1}조 (${heading})`, body: String(body) }))

  const insurance = terms.socialInsurance
  if (insurance && typeof insurance === 'object') {
    const labels = {
      employment_insurance: '고용보험',
      health_insurance: '건강보험',
      national_pension: '국민연금',
      industrial_accident_insurance: '산재보험',
    }
    const applied = Object.entries(insurance)
      .filter(([, v]) => v === true)
      .map(([k]) => labels[k] || k)
    if (applied.length > 0) {
      articles.push({
        heading: `제${articles.length + 1}조 (사회보험 적용여부)`,
        body: `${applied.join(', ')}을(를) 적용한다.`,
      })
    }
  }

  return articles
}

// DB에 담긴 JSON 컬럼을 읽는다. 이 함수는 계약서 화면·서명·번역·분석이 모두
// 거쳐 가는 길목이라, 컬럼 하나가 깨져 있다고 여기서 예외가 나면 계약서를
// 열지도 서명하지도 못하게 된다. 읽지 못한 값은 비운 것으로 보고 넘어간다.
function parseJsonColumn(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function rowToCamelTerms(row) {
  if (!row) return null
  return {
    employerName: row.employer_name ?? null,
    employerAddress: row.employer_address ?? null,
    employeeName: row.employee_name ?? null,
    employeeAddress: row.employee_address ?? null,
    workLocation: row.work_location ?? null,
    jobDescription: row.job_description ?? null,
    contractStartDate: row.contract_start_date ?? null,
    contractEndDate: row.contract_end_date ?? null,
    workHoursStart: row.work_hours_start ?? null,
    workHoursEnd: row.work_hours_end ?? null,
    workDays: row.work_days ?? null,
    restDays: row.rest_days ?? null,
    wageBaseAmount: row.wage_base_amount ?? null,
    wagePayMethod: row.wage_pay_method ?? null,
    wagePayDate: row.wage_pay_date ?? null,
    annualLeave: row.annual_leave ?? null,
    socialInsurance: parseJsonColumn(row.social_insurance_json, null),
    uniformSize: row.uniform_size ?? null,
    customTerms: parseJsonColumn(row.custom_terms_json, []),
    aiDocument: parseJsonColumn(row.ai_document_json, null),
    analysisWarnings: parseJsonColumn(row.analysis_warnings_json, []),
  }
}
