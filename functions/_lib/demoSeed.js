// 평가자용 체험 데모의 내용 (순수 데이터·함수 — 단위 테스트 대상).
//
// 이 서비스가 하는 일의 대부분은 로그인 뒤에 있다. 채용 담당자가 링크를 열면
// 공고 목록만 보이고, 법령 점검·전자서명·교부·감사추적·증명서는 하나도 보이지
// 않는다. 그것을 보려면 계정 두 개를 만들고 브라우저 두 개를 띄워 방을 만들고
// 초대코드를 옮겨 적고 조건 열다섯 개를 채우고 양쪽에서 서명해야 한다.
// 아무도 하지 않는다.
//
// 그래서 이미 그 지점까지 진행된 계약을 미리 심어 둔다. 아이디 하나로 3분이면
// 전체를 보게 하는 것이 목적이다.
//
// 심는 값은 임의로 정하지 않았다. contractCheck.js·contractPeriod.js·
// postingMatch.js 의 실제 계산식에서 역산해, 의도한 점검이 반드시 발동하도록
// 맞췄다. 데모에서 아무 경고도 뜨지 않는 것이 가장 나쁜 결과다.

export const DEMO_DOMAIN = 'demo.invalid'
// 공개된 체험 계정의 비밀번호. 실제 사용자의 비밀번호가 아니라 체험용으로
// 만들어 공개하는 값이므로, 화면에 그대로 적는다.
export const DEMO_PASSWORD = 'demo-1234'

export const DEMO_ACCOUNTS = [
  {
    key: 'company',
    email: `company@${DEMO_DOMAIN}`,
    role: 'company',
    displayName: '박서준',
    companyName: '(주)한빛테크',
    isRecruiter: true,
  },
  {
    key: 'candidate',
    email: `candidate@${DEMO_DOMAIN}`,
    role: 'candidate',
    displayName: '이지원',
    companyName: null,
    isRecruiter: false,
  },
  // 서명 전 계약의 상대방. 계약서에 적힌 이름과 실제로 그 방에 있는 사람이
  // 다르면 화면이 앞뒤가 맞지 않는다.
  {
    key: 'candidate2',
    email: `candidate2@${DEMO_DOMAIN}`,
    role: 'candidate',
    displayName: '최민수',
    companyName: null,
    isRecruiter: false,
  },
]

// 공고. 방 B의 계약 조건과 대조되어 채용절차법 제4조 제3항 위반을 드러낸다.
// 제목에 시연용임을 박아 둔다.
//
// 이 공고는 공개 목록에 뜨고 로그인 없이 지원할 수 있다. 그런데 회사 계정의
// 비밀번호가 공개돼 있으므로, 실제 구직자가 여기에 지원하면 그 사람의 이름·
// 연락처·자기소개를 누구나 열어 볼 수 있다. 본문 아래쪽 안내만으로는 목록에서
// 보이지 않으므로, 지원을 누르기 전에 알아볼 수 있는 자리에 적는다.
export const DEMO_POSTING = {
  title: '[시연용 예시] 백엔드 개발자 (신입/경력)',
  department: 'Platform',
  employmentType: '정규직',
  location: '서울 강남',
  wageType: 'monthly',
  wageMin: 2800000,
  wageMax: 3200000,
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  workDays: '주 5일 (월~금)',
  description: `※ 이 공고는 서비스 시연을 위한 예시이며, 실제 채용이 아닙니다.
   이 공고의 지원 내역은 시연용 계정으로 열람되고 초기화 시 삭제되므로,
   실제 개인정보(이름·연락처·이력서)를 입력하지 마세요.

한빛테크 플랫폼팀에서 함께할 백엔드 개발자를 찾습니다.

[담당 업무]
- 사내 서비스 API 설계·개발·운영
- 데이터 모델링 및 성능 개선

[자격 요건]
- 서버 사이드 언어 1개 이상 실무 또는 프로젝트 경험
- 관계형 데이터베이스에 대한 이해

[근로조건]
- 근무지: 서울 강남
- 근무시간: 09:00 ~ 18:00 (휴게 1시간)
- 근무일: 주 5일 (월~금)
- 임금: 월 280만원 ~ 320만원

※ 이 공고는 서비스 시연을 위한 예시입니다.`,
}

// 지원자 비교·랭킹 화면을 채우기 위한 지원서들.
export const DEMO_APPLICATIONS = [
  {
    key: 'jiwon',
    name: '이지원',
    email: `candidate@${DEMO_DOMAIN}`,
    phone: '010-0000-0001',
    status: 'passed',
    coverLetter:
      '대학 재학 중 팀 프로젝트로 사내 근태관리 API를 설계·구현했습니다. 요구사항을 코드로 옮기기 전에 규칙을 문장으로 정리하는 습관이 있습니다.',
    career: [
      { company: '한빛테크 인턴', role: '백엔드 인턴', period: '2025.07 ~ 2025.12', description: '내부 API 유지보수' },
    ],
  },
  {
    key: 'minsu',
    name: '최민수',
    email: `candidate2@${DEMO_DOMAIN}`,
    phone: '010-0000-0002',
    status: 'passed',
    coverLetter:
      '3년간 커머스 백엔드를 담당하며 주문·정산 도메인을 맡았습니다. 트래픽이 몰리는 구간의 병목을 찾아 개선한 경험이 있습니다.',
    career: [
      { company: '(주)마켓원', role: '백엔드 개발자', period: '2023.03 ~ 2026.02', description: '주문·정산 API' },
    ],
  },
  {
    key: 'hayeon',
    name: '정하연',
    email: `applicant-hayeon@${DEMO_DOMAIN}`,
    phone: '010-0000-0003',
    status: 'submitted',
    coverLetter:
      '데이터 파이프라인 운영 경험이 있으며, 로그 기반으로 장애 원인을 추적하는 일을 좋아합니다.',
    career: [
      { company: '(주)데이터랩', role: '데이터 엔지니어', period: '2024.01 ~ 2026.06', description: '수집·적재 파이프라인' },
    ],
  },
]

const INSURANCE_ALL = {
  employment_insurance: true,
  health_insurance: true,
  national_pension: true,
  industrial_accident_insurance: true,
}

// 방 A — 체결이 끝난 계약.
//
// 종료일을 비운다. 기간의 정함이 없는 근로계약이므로 근로관계가 아직 끝나지
// 않았고, 따라서 보존 기간(제42조)이 시작되지 않는다. 서명일로부터 3년을 세던
// 예전 계산이었다면 여기서 "보존 종료"가 떴을 자리다.
//
// 임금은 적법하다. 09:00~18:00 주 5일이면 주 40시간, 월 소정근로 약 209시간이라
// 290만원은 시급 약 13,900원으로 2026년 최저시급(10,320원)을 넘는다.
export const DEMO_ROOM_SIGNED = {
  key: 'signed',
  title: '백엔드 개발자 최종 계약 - 이지원',
  status: 'signed',
  candidateKey: 'candidate',
  applicationKey: 'jiwon',
  terms: {
    employerName: '(주)한빛테크',
    employerAddress: '서울특별시 강남구 테헤란로 123, 8층',
    employeeName: '이지원',
    employeeAddress: '서울특별시 마포구 월드컵북로 45',
    workLocation: '서울 강남 본사',
    jobDescription: '플랫폼팀 백엔드 API 개발 및 운영',
    contractStartDate: '2026-09-01',
    contractEndDate: null,
    workHoursStart: '09:00',
    workHoursEnd: '18:00',
    workDays: '주 5일 (월~금)',
    restDays: '토요일, 일요일 (주휴일: 일요일)',
    wageBaseAmount: 2900000,
    // 기본급 265만 + 식대 25만. 식대는 2024년부터 전액 산입되므로 290만이
    // 그대로 최저임금 비교 대상이 된다.
    wageItems: [
      { name: '기본급', type: 'base', amount: 2650000 },
      { name: '식대', type: 'welfare', amount: 250000 },
    ],
    wagePayMethod: '근로자 명의 예금통장에 입금',
    wagePayDate: '매월 25일 (휴일인 경우 직전 영업일)',
    annualLeave: '근로기준법 제60조에 따라 부여',
    uniformSize: null,
    socialInsurance: INSURANCE_ALL,
    customTerms: [
      { label: '수습기간', value: '3개월 (임금 감액 없음)' },
      { label: '퇴직급여', value: '근로자퇴직급여보장법에 따라 지급' },
    ],
  },
}

// 방 B — 서명 전. 일부러 결함을 심는다.
//
// 여기가 이 데모의 핵심 장면이다. 법을 아는 척하는 화면과 실제로 막는 시스템의
// 차이는 "눌러도 안 된다"에서만 드러난다.
//
// 심은 결함과 그것이 발동하는 근거:
//   1) 주 52시간 초과 — 09:00~20:00은 휴게 1시간을 빼면 하루 10시간,
//      주 6일이면 60시간. computeWeeklyHours > MAX_WEEKLY_HOURS(52). [high]
//   2) 최저임금 미달 — 주 60시간의 월 소정근로는 약 295시간. 190만원은
//      시급 약 6,430원으로 10,320원에 미달. [high]
//   3) 연차유급휴가 미기재 — REQUIRED_FIELDS에 있으므로 findMissingFields가
//      잡고, 서버가 서명을 409로 막는다. 확인 체크로도 통과할 수 없다.
//      (이 덕분에 아무나 로그인하는 공개 데모에서도 이 방은 서명되지 않고
//       원래 상태로 남는다.)
//   4) 기간제 2년 초과 — 2026-09-01 시작, 2028-12-31 종료는 시작일+2년을 넘는다. [medium]
//   5) 사회보험 일부 미적용 — 고용보험을 false로 표기. [medium]
//   6) 공고보다 불리 — 공고는 09~18시·주5일·최소 280만원인데 계약은
//      09~20시·주6일이고 월 지급액 합계가 265만원이다. 채용절차법 제4조 제3항.
//      (기본급만 190만원이지만, 공고 대조는 기본급이 아니라 실제 월 지급액으로
//       한다 — 공고가 약속한 것은 '받는 돈'이지 '기본급'이 아니기 때문이다.)
//   7) 수습 감액 위반 — '수습 6개월, 임금의 80%'. 감액이 허용되는 것은
//      수습 시작 3개월 이내이고 하한은 최저임금의 90%다
//      (최저임금법 제5조 제2항·시행령 제3조). 기간과 폭 양쪽에서 어긋난다.
export const DEMO_ROOM_PENDING = {
  key: 'pending',
  title: '백엔드 개발자 계약 검토 - 최민수',
  status: 'contract_pending',
  candidateKey: 'candidate2',
  // 공고와 계약을 대조하려면 지원서가 이 방에 연결돼 있어야 한다
  // (contract-view 는 applications.room_id 로 공고를 찾는다).
  applicationKey: 'minsu',
  terms: {
    employerName: '(주)한빛테크',
    employerAddress: '서울특별시 강남구 테헤란로 123, 8층',
    employeeName: '최민수',
    employeeAddress: '경기도 성남시 분당구 판교로 200',
    workLocation: '서울 강남 본사',
    jobDescription: '플랫폼팀 백엔드 API 개발 및 운영',
    contractStartDate: '2026-09-01',
    contractEndDate: '2028-12-31',
    workHoursStart: '09:00',
    workHoursEnd: '20:00',
    workDays: '주 6일 (월~토)',
    restDays: '일요일',
    wageBaseAmount: 1900000,
    // 합계는 265만이지만 고정연장수당 75만은 소정근로의 대가가 아니라
    // 최저임금에 산입되지 않는다. 산입 대상은 190만이라 미달이다.
    // 합계만 보면 넉넉해 보이는 계약이 실제로는 위반인, 흔하고 잘 안 보이는 형태.
    wageItems: [
      { name: '기본급', type: 'base', amount: 1900000 },
      { name: '고정연장수당', type: 'overtime_fixed', amount: 750000 },
    ],
    wagePayMethod: '근로자 명의 예금통장에 입금',
    wagePayDate: '매월 25일',
    annualLeave: null,
    uniformSize: null,
    socialInsurance: { ...INSURANCE_ALL, employment_insurance: false },
    customTerms: [{ label: '수습기간', value: '6개월 (수습 중 임금의 80% 지급)' }],
  },
}

// 방 C — 방 A의 이전 계약. 이어 붙이면 계속근로기간이 합산된다.
// 2년짜리 기간제를 끝내고 무기계약으로 전환한 모습이라, 기간제법 제4조의
// 2년 상한이 실제로 어떻게 계산되는지 보여 준다.
export const DEMO_ROOM_PREVIOUS = {
  key: 'previous',
  title: '백엔드 개발자 계약(기간제) - 이지원',
  status: 'signed',
  candidateKey: 'candidate',
  applicationKey: null,
  terms: {
    employerName: '(주)한빛테크',
    employerAddress: '서울특별시 강남구 테헤란로 123, 8층',
    employeeName: '이지원',
    employeeAddress: '서울특별시 마포구 월드컵북로 45',
    workLocation: '서울 강남 본사',
    jobDescription: '플랫폼팀 백엔드 API 개발',
    contractStartDate: '2024-09-01',
    contractEndDate: '2026-08-31',
    workHoursStart: '09:00',
    workHoursEnd: '18:00',
    workDays: '주 5일 (월~금)',
    restDays: '토요일, 일요일 (주휴일: 일요일)',
    wageBaseAmount: 2600000,
    wagePayMethod: '근로자 명의 예금통장에 입금',
    wagePayDate: '매월 25일',
    annualLeave: '근로기준법 제60조에 따라 부여',
    uniformSize: null,
    socialInsurance: INSURANCE_ALL,
    customTerms: [],
  },
}

export const DEMO_ROOMS = [DEMO_ROOM_PREVIOUS, DEMO_ROOM_SIGNED, DEMO_ROOM_PENDING]

// 방 B에서 반드시 보여야 하는 점검 결과. 시드 값이 바뀌어도 이 목록이
// 그대로 나오는지 테스트가 확인한다 — 경고가 사라진 데모는 데모가 아니다.
export const EXPECTED_PENDING_ISSUES = [
  '주 52시간 초과',
  '최저임금 미달 소지',
  '사회보험 미적용 항목',
  '기간제 2년 초과',
  // 수습 6개월은 감액 허용 기간(3개월)을 넘고, 80%는 하한(90%)을 밑돈다.
  '수습 감액 기간 초과',
  '수습 감액 한도 초과',
]

export const EXPECTED_PENDING_MISSING = ['annualLeave']

// 대화 기록. 계약 조건이 어디서 나왔는지 보여 주고, 면접 요약 기능이 쓸 재료가 된다.
export const DEMO_MESSAGES = {
  signed: [
    ['company', '안녕하세요 이지원님, 한빛테크 플랫폼팀 박서준입니다. 서류 전형 합격을 축하드립니다.'],
    ['candidate', '안녕하세요! 연락 주셔서 감사합니다. 잘 부탁드립니다.'],
    ['company', '근무지는 서울 강남 본사이고, 근무시간은 09시부터 18시까지 휴게 1시간 포함입니다. 주 5일 근무입니다.'],
    ['candidate', '네 확인했습니다. 임금 조건은 어떻게 되나요?'],
    ['company', '기본급은 월 290만원으로 책정했습니다. 매월 25일에 지급되고, 4대보험은 모두 가입합니다.'],
    ['candidate', '좋습니다. 계약 기간은 어떻게 되는지도 확인 부탁드립니다.'],
    ['company', '기간의 정함이 없는 정규직입니다. 근로개시일은 9월 1일로 하겠습니다.'],
    ['candidate', '네 동의합니다. 계약서 확인 후 서명하겠습니다.'],
  ],
  pending: [
    ['company', '안녕하세요 최민수님. 계약 조건 초안을 계약서에 정리해 두었습니다. 확인 부탁드립니다.'],
    ['candidate', '확인하겠습니다. 근무시간이 공고와 달라 보이는데 맞나요?'],
    ['company', '초기 몇 달은 업무량이 많아 09시부터 20시까지, 토요일도 근무로 잡아두었습니다.'],
    ['candidate', '임금도 공고에 적힌 280만원보다 낮은 것 같습니다. 다시 확인 부탁드립니다.'],
  ],
  previous: [
    ['company', '이지원님, 기간제 계약으로 먼저 시작하고 이후 정규직 전환을 검토하겠습니다.'],
    ['candidate', '네 알겠습니다. 조건 확인했습니다.'],
  ],
}

// 서명 이미지.
//
// 1픽셀 투명 PNG를 넣으면 서명란이 점 하나로 보인다. 서명은 이 서비스에서
// 가장 자주 보이는 이미지이므로, 이름을 흘려 쓴 모양의 SVG를 만들어 둔다.
// base64는 한글에서 깨지므로 URI 인코딩 형식을 쓴다.
export function demoSignatureDataUrl(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90" viewBox="0 0 240 90">
<rect width="240" height="90" fill="none"/>
<text x="20" y="58" font-family="'Gungsuh','Batang',serif" font-size="38" font-style="italic" fill="#14263f">${name}</text>
<path d="M16 70 C 70 62, 150 78, 224 66" stroke="#14263f" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\n/g, ''))}`
}

// 랜딩 화면에 적을 안내. 평가자가 무엇을 눌러 무엇을 볼지 미리 알려 준다.
export const DEMO_WALKTHROUGH = [
  {
    step: 1,
    action: '회사 계정으로 로그인 → "백엔드 개발자 계약 검토 - 최민수" 방 → 계약서',
    sees: '최저임금 미달·주 52시간 초과·연차 미기재·기간제 2년 초과·공고보다 불리한 조건을 한 화면에서 잡아냅니다. 서명 버튼을 눌러도 서버가 막습니다.',
  },
  {
    step: 2,
    action: '"백엔드 개발자 최종 계약 - 이지원" 방 → 계약서 → 증명서 발급',
    sees: '양측 서명·문서 지문·교부와 열람 시각·계약 이력이 담긴 증명서가 발급번호와 함께 나옵니다.',
  },
  {
    step: 3,
    action: '로그아웃 후 /verify 에 발급번호 입력',
    sees: '로그인 없이 진위가 확인됩니다. 정본 문자열을 내려받아 직접 SHA-256을 계산해 대조할 수도 있습니다.',
  },
]
