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
  // 휴게시간. 인쇄본에는 자리가 있었는데 저장할 칸이 없어 언제나 빈칸으로
  // 나갔다. 근로기준법 제54조가 정하고 제17조가 명시를 요구하는 값이다.
  //
  // TERM_ORDER 에는 넣지 않는다 — 넣으면 이미 서명된 계약서의 지문이 소급해
  // 바뀐다. employeeCount 와 같은 이유다.
  breakTime: 'break_time',
  workDays: 'work_days',
  restDays: 'rest_days',
  wageBaseAmount: 'wage_base_amount',
  wagePayMethod: 'wage_pay_method',
  wagePayDate: 'wage_pay_date',
  annualLeave: 'annual_leave',
  // 상시 근로자 수. 어느 조항이 적용되는지가 이 값에서 갈린다(제11조).
  //
  // 정본 직렬화의 TERM_ORDER 에는 넣지 않는다. 표준근로계약서가 명시를 요구하는
  // 항목이 아니고, 넣으면 이미 서명된 계약서의 지문이 소급해서 바뀌어 손대지
  // 않은 계약이 '변조됨'으로 뒤집힌다.
  employeeCount: 'employee_count',
}

// 아래 둘은 번역본에만 쓴다.
//
// buildArticlesFromTerms 의 출력은 정본 직렬화의 [본문] 구간에 그대로 들어가
// 문서 지문이 된다. 거기에 조항을 더하면 이미 서명된 계약서의 지문이 소급해서
// 바뀌어, 아무도 손대지 않은 계약이 "서명한 내용과 다름"으로 뒤집힌다.
// 그래서 정본 본문은 건드리지 않고 번역용 조항만 따로 만든다. 내용이 빠지는
// 것은 아니다 — 그 밖의 사항과 유니폼 사이즈는 정본의 [계약조건]·[그밖의사항]
// 구간에 이미 들어가 있고, 계약서 인쇄 화면에도 표에 그대로 나온다.
function wageDescription(terms) {
  const items = Array.isArray(terms?.wageItems) ? terms.wageItems : []
  if (items.length > 0) {
    const parts = items
      .filter((i) => Number(i?.amount) > 0)
      .map((i) => `${i.name} ${Number(i.amount).toLocaleString('ko-KR')}원`)
    if (parts.length > 0) return parts.join(' + ')
  }
  return terms?.wageBaseAmount
    ? `기본급 ${Number(terms.wageBaseAmount).toLocaleString('ko-KR')}원`
    : ''
}

function describeCustomTerms(customTerms) {
  if (!Array.isArray(customTerms)) return ''
  // 이 조항은 문서 지문에 그대로 들어간다. 입력 순서대로 이으면 같은 내용의
  // 계약이 순서만 다르다는 이유로 다른 지문이 되고, 서명해 둔 계약서가
  // "변조됨"으로 뒤집힌다. 정본 직렬화(contractDocument.js)와 같은 규칙으로
  // 라벨 기준 정렬한다.
  return [...customTerms]
    .filter((c) => c && (c.label || c.value))
    .map((c) => ({ label: String(c.label ?? '').trim(), value: String(c.value ?? '').trim() }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
    .map((c) => [c.label, c.value].filter(Boolean).join(': '))
    .join(' / ')
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
    // 근로관계가 실제로 끝난 날. 보존 기간(제42조)의 기산일이 된다.
    employmentEndedAt: row.employment_ended_at ?? null,
    employmentEndReason: row.employment_end_reason ?? null,
    socialInsurance: parseJsonColumn(row.social_insurance_json, null),
    uniformSize: row.uniform_size ?? null,
    employeeCount: row.employee_count ?? null,
    customTerms: parseJsonColumn(row.custom_terms_json, []),
    // 임금 구성항목 (근로기준법 제17조: 임금의 구성항목·계산방법·지급방법)
    wageItems: parseJsonColumn(row.wage_items_json, []),
    aiDocument: parseJsonColumn(row.ai_document_json, null),
    analysisWarnings: parseJsonColumn(row.analysis_warnings_json, []),
  }
}

// 번역할 조항.
//
// '그 밖의 사항'에는 수습기간처럼 법적으로 무거운 약정이 들어가고, 임금은
// 기본급 하나가 아니라 구성항목으로 담긴다. 그런데 번역 원본은 정본 본문
// 생성기를 그대로 쓰고 있어서 둘 다 빠져 있었다. 한국어 계약서에는 있고
// 외국어 계약서에만 없는 조항이 생기는 셈이라, 정작 그 조항의 적용을 받는
// 사람이 그것을 읽지 못한다.
export function buildArticlesForTranslation(terms) {
  const base = buildArticlesFromTerms(terms)
  if (base.length === 0) return base

  // 임금 조항은 구성항목이 있으면 항목별로 다시 쓴다.
  const wage = wageDescription(terms)
  const articles = base.map((a) =>
    a.heading.includes('임금') && wage
      ? {
          ...a,
          body: [wage, terms?.wagePayMethod, terms?.wagePayDate].filter(Boolean).join(' · '),
        }
      : a
  )

  const extra = [
    ['그 밖의 사항', describeCustomTerms(terms?.customTerms)],
  ].filter(([, value]) => value && String(value).trim() !== '')

  return articles.concat(
    extra.map(([heading, body], i) => ({
      heading: `제${articles.length + i + 1}조 (${heading})`,
      body: String(body),
    }))
  )
}
