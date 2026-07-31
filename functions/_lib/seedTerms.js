// 지원서·공고에서 계약 조건의 출발점을 만든다 (순수 함수 — 단위 테스트 대상).
//
// 이 서비스의 축은 지원 → 면접 → 계약인데, 계약서만 빈 종이에서 시작했다.
// 사업체명·근로자명을 자동으로 채우는 코드가 어디에도 없었다 — AI 추출 스키마에도
// 없고(대화에서 이름을 뽑지 않는다), 서류합격으로 면접방을 만들 때도 승계하지
// 않았다. 앱은 지원서에서 지원자 이름을, 공고와 회사 계정에서 사업체명을 이미
// 알고 있는데도 사람이 다시 손으로 쳐야 했다.
//
// 이 둘은 근로기준법 제17조 제1항 명시사항이고 서명 게이트가 막는 항목이라,
// 채워지지 않으면 서명 자체가 열리지 않는다. 즉 없어도 되는 편의가 아니라
// 끊긴 축을 잇는 일이다.
//
// 빈 문자열이 아니라 null을 쓴다. 빈 문자열은 findMissingFields를 통과해
// "채워졌다"고 잘못 읽히기 때문이다.

function clean(value) {
  const s = String(value ?? '').trim()
  return s === '' ? null : s
}

// 업무의 내용은 공고 제목과 부서를 합쳐 만든다. 계약서의 "종사할 업무"는
// 공고에 적힌 자리 그 자체이므로, 회사가 지우거나 고칠 수 있는 출발점을 준다.
function jobDescriptionFrom(posting) {
  const parts = [clean(posting?.title), clean(posting?.department)].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

// posting: job_postings 행 (title, department, location, employment_type)
// application: applications 행 (applicant_name)
// companyUser: 서류합격을 처리하는 회사 계정 (company_name, display_name)
export function seedTermsFromApplication({ posting, application, companyUser } = {}) {
  return {
    // 사업체명은 회사 계정에 적힌 상호를 쓴다. 표시 이름밖에 없으면 그것으로 둔다.
    employerName: clean(companyUser?.company_name) || clean(companyUser?.display_name),
    employeeName: clean(application?.applicant_name),
    workLocation: clean(posting?.location),
    jobDescription: jobDescriptionFrom(posting),
  }
}

// 채울 값이 하나라도 있는가. 전부 비었으면 굳이 행을 만들지 않는다.
export function hasSeedValues(seed) {
  return Object.values(seed || {}).some((v) => v !== null && v !== undefined)
}
