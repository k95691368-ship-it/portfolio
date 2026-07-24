const MODEL = 'claude-opus-4-8'

const ANALYSIS_TOOL = {
  name: 'record_interview_analysis',
  description:
    '지금까지의 면접 채팅 대화에서 언급된 채용 조건을 구조화해서 기록하고, 회사와 지원자가 명시적으로 채용을 확정했는지 판단한다.',
  input_schema: {
    type: 'object',
    required: ['terms', 'hire_confirmed', 'confirmation_confidence', 'reasoning'],
    properties: {
      terms: {
        type: 'object',
        properties: {
          work_location: { type: ['string', 'null'], description: '근무장소' },
          job_description: { type: ['string', 'null'], description: '업무의 내용' },
          contract_start_date: { type: ['string', 'null'], description: '근로개시일 (알 수 있는 형식 그대로)' },
          contract_end_date: { type: ['string', 'null'], description: '근로계약 종료일, 기간 정함이 없으면 null' },
          work_hours_start: { type: ['string', 'null'], description: '소정근로 시작 시각' },
          work_hours_end: { type: ['string', 'null'], description: '소정근로 종료 시각' },
          work_days: { type: ['string', 'null'], description: '근무일 (예: 주 5일, 월~금)' },
          rest_days: { type: ['string', 'null'], description: '휴일 (예: 토, 일)' },
          wage_base_amount: { type: ['number', 'null'], description: '기본급 (원 단위 숫자)' },
          wage_pay_method: { type: ['string', 'null'], description: '임금 지급 방법 (예: 계좌이체)' },
          wage_pay_date: { type: ['string', 'null'], description: '임금 지급일 (예: 매월 25일)' },
          annual_leave: { type: ['string', 'null'], description: '연차유급휴가 관련 언급' },
          social_insurance: {
            type: 'object',
            properties: {
              employment_insurance: { type: ['boolean', 'null'] },
              health_insurance: { type: ['boolean', 'null'] },
              national_pension: { type: ['boolean', 'null'] },
              industrial_accident_insurance: { type: ['boolean', 'null'] },
            },
          },
          uniform_size: { type: ['string', 'null'], description: '유니폼 사이즈 등 언급된 값' },
          custom_terms: {
            type: 'array',
            description: '위 항목에 해당하지 않지만 대화에서 언급된 기타 조건',
            items: {
              type: 'object',
              required: ['label', 'value'],
              properties: { label: { type: 'string' }, value: { type: 'string' } },
            },
          },
        },
      },
      hire_confirmed: {
        type: 'boolean',
        description: '회사의 명확한 채용/합격 의사표시와 지원자의 명확한 수락 의사표시가 모두 있었는지 여부',
      },
      confirmation_confidence: { type: 'number', description: '0.0~1.0' },
      confirmation_excerpt: {
        type: ['string', 'null'],
        description: 'hire_confirmed가 true인 경우, 그 근거가 되는 대화 인용',
      },
      reasoning: { type: 'string', description: '판단 근거를 한두 문장으로 설명' },
    },
  },
}

const SYSTEM_PROMPT = `당신은 한국 채용 면접 채팅 대화를 분석하는 어시스턴트입니다.

규칙:
1. 대화에서 언급된 근로조건(근무장소, 업무내용, 근무시간, 임금, 사회보험 등)을 최대한 정확히 추출하세요. 언급되지 않은 항목은 null로 두세요.
2. hire_confirmed는 반드시 "회사 측의 명확한 합격/채용 통보"와 "지원자의 명확한 수락 의사표시"가 모두 확인될 때만 true로 표시하세요. 단순히 우호적인 대화, 조건 협의 중인 상태만으로는 false로 유지하세요.
3. [이전에 추출된 조건]이 주어지면, 이번 대화에서 새로 명확히 확인된 값이 있을 때만 그 필드를 채우고, 새로 언급되지 않은 필드는 null로 반환하세요(병합은 호출 측에서 처리합니다).`

const DRAFT_TOOL = {
  name: 'record_contract_draft',
  description:
    '주어진 근로조건 값들을 바탕으로 대한민국 고용노동부 표준근로계약서 양식에 맞춰 조항별 계약서 본문을 작성한다.',
  input_schema: {
    type: 'object',
    required: ['articles'],
    properties: {
      articles: {
        type: 'array',
        description:
          '표준근로계약서의 조항들. 순서대로: 근로계약기간, 근무장소, 업무의 내용, 소정근로시간, 근무일/휴일, 임금, 연차유급휴가, 사회보험 적용여부, 기타',
        items: {
          type: 'object',
          required: ['heading', 'body'],
          properties: {
            heading: { type: 'string', description: '조항 제목 (예: "제1조 (근로계약기간)")' },
            body: {
              type: 'string',
              description:
                '해당 조항의 본문. 제공된 값을 자연스러운 계약서 문장으로 반영하고, 값이 없는 항목은 "추후 협의"로 표기한다.',
            },
          },
        },
      },
    },
  },
}

const DRAFT_SYSTEM_PROMPT = `당신은 대한민국 고용노동부 표준근로계약서 양식에 따라 근로계약서 초안을 작성하는 어시스턴트입니다.

규칙:
1. 아래 [근로조건 데이터]에 있는 값만 사용하고, 데이터에 없는 사실을 지어내지 마세요.
2. 값이 비어있거나 null인 항목은 "추후 협의" 또는 "미정"으로 자연스럽게 표기하세요.
3. 법적 계약서에 맞는 정중하고 명확한 문어체(합니다체/한다체)를 사용하세요.
4. 각 조항은 실제 표준근로계약서처럼 "제n조 (제목)" 형식의 heading과, 해당 조항 내용을 완결된 문장으로 서술한 body로 구성하세요.
5. 사회보험 항목은 값이 true인 것만 "적용"으로 표기하고, 값이 없으면 "추후 협의"로 표기하세요.`

export async function draftContractDocument(env, terms) {
  const apiKey = env.CLAUDE_API_KEY
  if (!apiKey) throw new Error('CLAUDE_API_KEY가 설정되지 않았습니다. Cloudflare 시크릿을 등록해주세요.')

  const userContent = `[근로조건 데이터]\n${JSON.stringify(terms)}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: DRAFT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: 'record_contract_draft' },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Claude API 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }

  const data = await res.json()
  const toolUse = Array.isArray(data.content)
    ? data.content.find((block) => block.type === 'tool_use')
    : null
  if (!toolUse || !Array.isArray(toolUse.input?.articles) || toolUse.input.articles.length === 0) {
    if (data.stop_reason === 'max_tokens') {
      throw new Error('AI 응답이 너무 길어 계약서 생성이 중단되었습니다. 입력 조건을 줄여 다시 시도해주세요.')
    }
    throw new Error('AI 응답에서 유효한 계약서 초안을 찾을 수 없습니다. 잠시 후 다시 시도해주세요.')
  }

  return toolUse.input
}

export async function analyzeConversation(env, transcript, previousTerms) {
  const apiKey = env.CLAUDE_API_KEY
  if (!apiKey) throw new Error('CLAUDE_API_KEY가 설정되지 않았습니다. Cloudflare 시크릿을 등록해주세요.')

  const userContent = `[이전에 추출된 조건]\n${JSON.stringify(previousTerms)}\n\n[대화 내용]\n${transcript}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'record_interview_analysis' },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Claude API 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }

  const data = await res.json()
  const toolUse = Array.isArray(data.content)
    ? data.content.find((block) => block.type === 'tool_use')
    : null
  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
    throw new Error('AI 응답에서 분석 결과를 찾을 수 없습니다. 잠시 후 다시 시도해주세요.')
  }

  return toolUse.input
}
