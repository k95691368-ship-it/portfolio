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
    socialInsurance: row.social_insurance_json ? JSON.parse(row.social_insurance_json) : null,
    uniformSize: row.uniform_size ?? null,
    customTerms: row.custom_terms_json ? JSON.parse(row.custom_terms_json) : [],
    aiDocument: row.ai_document_json ? JSON.parse(row.ai_document_json) : null,
    analysisWarnings: row.analysis_warnings_json ? JSON.parse(row.analysis_warnings_json) : [],
  }
}
