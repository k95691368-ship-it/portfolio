export const POSTING_SECTIONS = ['주요업무', '자격요건', '우대사항', '근무조건', '복지 및 혜택', '채용절차', '유의사항']

export const EXAMPLE_POSTING = {
  title: '[예시 공고] AI 서비스 개발자 (신입·경력)',
  department: '서비스 개발팀', employmentType: '정규직', location: '서울', deadline: '',
  wageType: 'monthly', wageMin: '3200000', wageMax: '3800000',
  workHoursStart: '09:00', workHoursEnd: '18:00', workDays: '주 5일 (월~금)',
  description: `※ 공고 작성과 서비스 체험을 위한 예시입니다. 아래 조건은 실제 채용 제안이 아닙니다. 체험 시 실제 개인정보·이력서를 제출하지 마세요.

📋 주요업무

[업무내용]
• LLM API를 활용한 웹 서비스 기능 개발
• 프론트엔드 화면과 백엔드 API 연결 및 운영
• 반복 업무 자동화 도구 개발과 서비스 성능 개선

[핵심역량]
• 요구사항을 정리하고 작동하는 기능으로 구현하는 능력
• AI 개발 도구의 결과를 검토하고 테스트하는 능력
• 문제를 기록하고 팀과 해결 과정을 공유하는 능력

📌 자격요건

• 신입·경력 지원 가능
• 웹 서비스 프로젝트를 직접 구현한 경험
• 사용한 기술과 본인이 맡은 역할을 설명할 수 있는 분

✨ 우대사항

• 프론트엔드부터 배포까지 프로젝트를 진행한 경험
• 관계형 데이터베이스 및 API 연동 경험
• 코드 리뷰와 협업 도구 사용 경험

🏠 근무조건

• 고용형태: 정규직 (예시)
• 급여: 월 320만~380만원, 세전 (예시)
• 근무지: 서울 (예시)
• 근무요일: 주 5일, 월~금
• 근무시간: 09:00~18:00, 휴게 1시간

🎁 복지 및 혜택

• 업무용 장비 제공 (예시)
• 직무 관련 도서·교육 지원 (예시)
• 복지 항목은 실제 공고 작성 시 회사 운영 기준에 맞게 수정해주세요.

🚀 채용절차

• 접수기간: 상시 접수로 설정한 예시 공고입니다.
• 제출서류: 이력서, 자기소개서, 포트폴리오
• 접수방법: 이 사이트의 지원하기 버튼
• 진행절차: 서류 검토 → 화상 면접 → 결과 안내 → 근로조건 협의

🔔 유의사항

• 실제 공고로 활용하기 전 업무·급여·근무지·복지·접수기간을 확인해주세요.
• 본 예시는 서비스 체험용이며 실제 채용을 진행하지 않습니다.`,
}

export const POSTING_EMOJIS = [
  ['📋', '주요업무'], ['📌', '자격요건'], ['✨', '우대사항'], ['🏠', '근무조건'],
  ['🎁', '복지 및 혜택'], ['🚀', '채용절차'], ['🔔', '유의사항'], ['💼', '채용'],
  ['💻', '개발'], ['🛠️', '기술'], ['📍', '근무지'], ['🕘', '근무시간'],
  ['💰', '급여'], ['📅', '접수기간'], ['📄', '제출서류'], ['✉️', '이메일'],
  ['✅', '확인'], ['⭐', '강조'], ['🤝', '협업'], ['🎯', '목표'],
]

export function insertPostingText(value, insertion, start, end = start) {
  const text = String(value || '')
  const from = Math.max(0, Math.min(start ?? text.length, text.length))
  const to = Math.max(from, Math.min(end ?? from, text.length))
  return { value: text.slice(0, from) + insertion + text.slice(to), cursor: from + insertion.length }
}

// Parse the supported section headings, never arbitrary HTML or executable markdown.
export function parsePostingDescription(value) {
  const blocks = []
  for (const line of String(value || '').split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    const heading = POSTING_SECTIONS.find((title) =>
      text === title || text === `[${title}]` || POSTING_EMOJIS.some(([emoji]) => text === `${emoji} ${title}`))
    blocks.push({ type: heading ? 'heading' : /^\[.+\]$/.test(text) ? 'subheading' : /^[•·-]\s/.test(text) ? 'item' : 'text',
      text: /^[•·-]\s/.test(text) ? text.replace(/^[•·-]\s+/, '') : text })
  }
  return blocks
}
