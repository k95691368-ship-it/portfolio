// 채용내정이 성립했는가, 그리고 그것을 취소하면 무슨 일이 벌어지는가.
// (순수 함수 — 단위 테스트 대상)
//
// 이 서비스가 존재하는 이유가 여기다.
//
// 채용내정 취소로 회사가 손해배상을 무는 일은 대개 악의가 아니라 무지에서
// 난다. 담당자의 머릿속에서 채용은 "최종 결재가 나야 확정"이지만, 판례는
// 채용내정 통지로 근로계약이 이미 성립한 것으로 보고 그 취소를 해고로 다룬다.
// 면접 자리에서 "다음 주 월요일부터 나오시죠"라고 말한 순간 담당자는 아직
// 협의 중이라고 생각하지만, 법적으로는 이미 계약이 서 있다. 그 상태에서
// "없던 일로" 하면 그건 취소가 아니라 해고다.
//
// 그러니 이 시스템이 할 일은 하나다 — 회사가 자기가 언제 선을 넘었는지 알게
// 하는 것. 넘은 뒤에 알려 주는 것은 사고 보고서이지 예방이 아니므로, 취소를
// 누르는 그 자리에서 말해야 한다.

import { workplaceScope } from './workplaceScope.js'

// 회사 쪽 발화가 채용 확정으로 읽힐 수 있는 표현들.
//
// AI 판정과 별개로 코드가 먼저 훑는다. 두 가지 이유다.
//
//   AI 조건 정리는 회사가 버튼을 눌러야 돈다. 누르지 않으면 아무 판정도 없고,
//   판정이 없으면 경고도 없다. 감시라고 부를 수 없다.
//
//   그리고 이 판정은 재현되어야 한다. 같은 대화에 대해 오늘과 내일의 답이
//   다르면, 그것을 근거로 회사의 행동을 막을 수 없다.
//
// 여기서 잡는 것은 "확정"이 아니라 "확정으로 읽힐 수 있는 표현"이다. 단정하지
// 않고 그 문장을 그대로 보여 주어 사람이 판단하게 한다.
const STRONG_PATTERNS = [
  { re: /합격(?!\s*자\s*발표\s*는)/, label: '합격 통보' },
  { re: /채용하기로|채용을?\s*확정|모시기로|함께하기로|함께하게\s*되/, label: '채용 확정 표현' },
  { re: /출근\s*해\s*주세요|출근하시면|출근하세요|첫\s*출근/, label: '출근 지시' },
  { re: /입사일(은|이)|입사\s*날짜(는|가)/, label: '입사일 지정' },
  { re: /최종\s*합격|최종\s*확정|내정/, label: '최종 확정 표현' },
]

const WEAK_PATTERNS = [
  { re: /언제부터\s*(출근|가능|근무)/, label: '출근 가능일 확인' },
  { re: /자리[를]?\s*(준비|마련)/, label: '자리 준비 언급' },
  { re: /계약서[를]?\s*(준비|보내|작성)/, label: '계약서 준비 언급' },
  { re: /서류[를]?\s*준비/, label: '입사 서류 언급' },
]

const MAX_SIGNALS = 5
const EXCERPT_MAX = 200

function excerpt(body) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text
}

// 회사가 보낸 메시지만 본다. 지원자가 "언제부터 출근하면 되나요"라고 묻는 것은
// 확정이 아니다. 확정은 회사만 할 수 있다.
export function scanForOfferSignals(messages) {
  const strong = []
  const weak = []

  for (const m of messages || []) {
    const role = m.role_in_room ?? m.role
    if (role !== 'company') continue
    const body = String(m.body ?? '')
    if (!body.trim()) continue

    for (const p of STRONG_PATTERNS) {
      if (p.re.test(body)) {
        strong.push({ label: p.label, text: excerpt(body), at: m.created_at ?? m.createdAt ?? null })
        break
      }
    }
    for (const p of WEAK_PATTERNS) {
      if (p.re.test(body)) {
        weak.push({ label: p.label, text: excerpt(body), at: m.created_at ?? m.createdAt ?? null })
        break
      }
    }
  }

  return { strong: strong.slice(-MAX_SIGNALS), weak: weak.slice(-MAX_SIGNALS) }
}

// 취소하면 무슨 일이 벌어지는가.
//
// 사업장 규모로 갈린다. 부당해고 구제신청(제28조)은 제23조와 함께 상시 5명
// 이상 사업장에만 적용된다. 그렇다고 4명 이하가 안전한 것은 아니다 — 구제신청
// 경로가 없을 뿐, 근로계약이 이미 성립한 이상 그 파기에 대한 손해배상 책임은
// 남는다. "우리는 작아서 괜찮다"고 읽히지 않도록 그 사실을 함께 적는다.
export function describeCancellationRisk(terms) {
  const scope = workplaceScope(terms)

  const remedies = ['법원에 손해배상 청구', '근로자 지위 확인 소송']
  if (!scope.small) remedies.unshift('노동위원회에 부당해고 구제신청')

  return {
    isDismissal: true,
    headline: '지금 전형을 끝내면 그것은 채용 취소가 아니라 해고로 다뤄질 수 있습니다.',
    reason:
      '판례는 채용내정 통지로 근로계약이 이미 성립한 것으로 보고, 그 취소를 해고로 다룹니다. 해고에는 정당한 이유가 필요합니다(근로기준법 제23조 제1항).',
    remedies,
    scopeNote: scope.small
      ? `상시 근로자 ${scope.count}명(4명 이하)이라 제23조와 부당해고 구제신청은 적용되지 않습니다. 다만 근로계약이 이미 성립한 이상, 그것을 일방적으로 깬 데 대한 손해배상 책임은 그대로 남습니다.`
      : scope.known
        ? null
        : '상시 5명 이상 사업장을 전제로 한 안내입니다. 계약서에 상시 근로자 수를 적으면 그에 맞게 안내합니다.',
    // 판례·다수설이 정당한 취소 사유로 드는 것들. 해당하지 않으면 정당한 이유를
    // 따로 갖춰야 한다.
    lawfulGrounds: [
      '졸업이 연기되어 입사일에 근로를 시작할 수 없게 된 경우',
      '요양이 필요한 질병이 발생한 경우',
      '경력·신상 기재에 중요한 허위가 확인된 경우',
      '내정 이후에 발생한 사유로 노동력이 현저히 저하된 경우',
    ],
    law: '근로기준법 제23조 제1항 · 제28조',
  }
}

// 이 방의 채용내정 상태.
//
// terms: contract_terms 행(카멜) — hireConfirmed / hireConfirmedAt / confirmationExcerpt
// messages: 이 방의 대화 (회사 발화 훑기용)
export function describeOfferStatus({ terms, messages } = {}) {
  const signals = scanForOfferSignals(messages)

  // AI 판정이 있으면 그것이 우선한다. 없으면 표현으로 정황을 잡는다.
  const confirmed = !!terms?.hireConfirmed
  const strongPhrase = signals.strong.length > 0

  if (!confirmed && !strongPhrase) {
    return {
      established: false,
      likely: signals.weak.length > 0,
      basis: null,
      signals,
      // 아직 성립하지 않았어도, 성립에 가까워지는 표현이 있으면 알려 준다.
      note:
        signals.weak.length > 0
          ? '아직 채용 확정으로 보기는 어렵지만, 확정으로 읽힐 수 있는 표현이 오갔습니다. 여기서 출근일이나 합격을 말하면 그 순간 채용내정이 성립해 이후 취소는 해고가 됩니다.'
          : null,
    }
  }

  return {
    established: true,
    likely: true,
    basis: confirmed ? 'ai' : 'phrase',
    at: terms?.hireConfirmedAt ?? signals.strong[0]?.at ?? null,
    // 단정하지 않고 근거를 보여 준다. "AI가 그렇다는데요"로는 아무도 승복하지
    // 않고, 승복하지 않으면 그냥 취소 버튼을 누른다.
    excerpt: terms?.confirmationExcerpt ?? signals.strong[signals.strong.length - 1]?.text ?? null,
    signals,
    risk: describeCancellationRisk(terms),
    note: confirmed
      ? '이 방은 채용이 확정된 상태입니다.'
      : '아직 채용 확정 처리는 되지 않았지만, 대화에 확정으로 읽힐 수 있는 표현이 있습니다. 실제로 확정했다면 지금 취소는 해고에 해당합니다.',
  }
}
