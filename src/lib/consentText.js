// Shared by the form and API; retained verbatim with each submission.
export const CONSENT_VERSION = '2026-09-13.1'
export const CONSENT_ITEMS = [
  {
    key: 'consentRequired', required: true,
    label: '개인정보 필수항목 수집 및 이용 동의',
    text: `1. 수집 항목: 성명, 전화번호, 이메일, 이력서 또는 경력기술서에 직접 기재한 채용 심사 정보
2. 이용 목적: 해당 공고의 서류 심사, 면접 진행, 결과 및 계약 절차 안내
3. 보유 기간: 지원 후 3년. 삭제 요청은 운영자에게 접수할 수 있으며 별도 보존 근거가 있는 경우 해당 범위와 기간을 안내합니다.
4. 동의 거부: 필수 정보 수집에 동의하지 않으면 지원서를 접수할 수 없습니다.
주민등록번호, 건강·종교 등 심사에 불필요한 민감정보는 기재하지 마세요.`,
  },
  {
    key: 'consentOptional', required: false,
    label: '개인정보 선택항목 수집 및 이용 동의',
    text: `1. 수집 항목: 별도로 입력한 경력사항, 자기소개, 지원 경로 및 첨부한 포트폴리오
2. 이용 목적: 해당 공고의 채용 심사 보충 자료
3. 보유 기간: 지원 후 3년. 삭제 요청과 별도 보존 근거에 대한 처리는 필수항목과 같습니다.
4. 동의 거부: 동의하지 않아도 지원할 수 있습니다. 동의하지 않는 경우 선택 입력 내용과 포트폴리오를 제거해주세요. 선택 정보를 입력했다는 이유만으로 동의한 것으로 간주하지 않습니다.`,
  },
]
export const CONSENT_SNAPSHOT = JSON.stringify({ version: CONSENT_VERSION, items: CONSENT_ITEMS })
