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
// 문장이 확정을 **부정**하고 있으면 확정으로 읽지 않는다.
//
// 표현이 있는지만 보고 극성을 보지 않아서, "합격이 아닙니다"와 "아직 채용을
// 확정하지 않았습니다"가 확정 근거가 됐다. 가장 나빴던 것은 "내정 취소를
// 검토 중입니다" — 취소를 검토한다는 말 자체가 내정 성립 판정을 만들고, 그
// 문장이 "확정으로 본 근거"로 인용됐다.
const NEGATION_RE =
  /불합격|탈락|아닙니다|아닙니다만|아니에요|아직\s*(?:아니|정해지지|확정하지|결정하지)|않았|않습니다|못했|어렵겠|어렵습니다|취소|철회|없던\s*일|보류|다음\s*기회|안\s*됩니다|안됩니다|마세요|말아\s*주세요/

// 확정 여부를 아직 알리지 않는다는 예고. 확정이 아니다.
const PENDING_RE = /합격\s*(?:자|여부)?\s*(?:발표|안내|통보)?\s*(?:는|은)?\s*(?:다음|추후|나중|아직|이후|내주|곧)/

const STRONG_PATTERNS = [
  // '불합격'의 뒤 두 글자에 그대로 걸리지 않도록 앞을 막는다.
  { re: /(?<![불부])합격(?!\s*자\s*발표)/, label: '합격 통보' },
  {
    re: /채용하기로|채용을?\s*(?:확정|결정)|뽑기로|모시기로|함께\s*(?:하기로|일하게|근무하게)|오퍼\s*(?:드립|드릴|를\s*드)/,
    label: '채용 확정 표현',
  },
  {
    re: /출근\s*해\s*주세요|출근하시면|출근하세요|첫\s*출근|나오시죠|나와\s*주세요|출근일(?:은|이)|출근\s*부탁/,
    label: '출근 지시',
  },
  // 조사를 붙이지 않고 "입사일 9월 1일로 하시죠"라고 쓰는 쪽이 더 흔하다.
  { re: /입사일\s*(?:은|이|을)?\s*\d|입사\s*날짜\s*(?:는|가)?\s*\d|자로\s*발령/, label: '입사일 지정' },
  { re: /최종\s*합격|최종\s*확정|채용내정|내정\s*통지/, label: '최종 확정 표현' },
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

// 한 메시지 안에서도 문장마다 말하는 바가 다르다.
//
// 부정 표현을 메시지 통째로 보고 있었다. 그래서 "최종 합격하셨습니다. 9월
// 1일부터 출근해 주세요. 사정이 생기면 미리 알려 주세요 — 취소는 어렵습니다"
// 같은 메시지가 '취소'라는 두 글자 때문에 통째로 건너뛰어졌다. 확정을 알리는
// 바로 그 메시지가 확정 근거에서 빠진 것이다. "걱정하지 마세요, 최종
// 합격입니다"도 마찬가지였다.
//
// 반대 방향도 같다. 부정을 아예 안 보면 "합격이 아닙니다"가 확정이 된다.
// 그래서 문장 단위로 본다 — 부정이 있는 문장은 버리고, 남은 문장에서 찾는다.
// 문장 부호가 없으면 통째로 한 문장이라 예전과 같게 동작한다(보수적).
function sentencesOf(body) {
  return String(body ?? '')
    .split(/(?<=[.!?…])\s+|[\n·]+/)
    .map((s) => s.trim())
    .filter(Boolean)
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

    const at = m.created_at ?? m.createdAt ?? null
    let strongHit = null
    let weakHit = null

    for (const sentence of sentencesOf(body)) {
      // 확정을 부정하거나 아직 알리지 않겠다는 문장은 확정 근거로 삼지 않는다.
      // 없는 확정을 만들면 회사가 방을 닫지 못하고, 감사 증명서에는 있지도
      // 않았던 채용내정의 취소가 기록된다.
      if (NEGATION_RE.test(sentence) || PENDING_RE.test(sentence)) continue

      if (!strongHit) {
        for (const p of STRONG_PATTERNS) {
          if (p.re.test(sentence)) {
            strongHit = { label: p.label, text: excerpt(sentence), at }
            break
          }
        }
      }
      if (!weakHit) {
        for (const p of WEAK_PATTERNS) {
          if (p.re.test(sentence)) {
            weakHit = { label: p.label, text: excerpt(sentence), at }
            break
          }
        }
      }
      if (strongHit && weakHit) break
    }

    if (strongHit) strong.push(strongHit)
    if (weakHit) weak.push(weakHit)
  }

  // 앞에서부터 남긴다. 확정을 성립시킨 것은 처음 그렇게 말한 문장이므로,
  // 뒤에서 자르면 정작 근거가 될 문장이 잘려 나간다.
  return { strong: strong.slice(0, MAX_SIGNALS), weak: weak.slice(0, MAX_SIGNALS) }
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
  //
  // DB 행을 그대로 넘기는 호출부와 카멜로 바꿔 넘기는 호출부가 섞여 있다.
  // 한쪽 이름만 읽으면 확정 여부가 판정에 도달하지 않고, 그러면 이 시스템이
  // 하려는 일 전체가 조용히 꺼진다. 실제로 그렇게 한 번 꺼졌다.
  const confirmed = !!(terms?.hireConfirmed ?? terms?.hire_confirmed)
  const confirmedAt = terms?.hireConfirmedAt ?? terms?.hire_confirmed_at ?? null
  const aiExcerpt = terms?.confirmationExcerpt ?? terms?.hire_confirmation_excerpt ?? null
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
    // 확정을 성립시킨 것은 처음 그렇게 말한 문장이다. 시각과 인용문이 서로
    // 다른 메시지를 가리키면 "언제 무슨 말로 확정됐는가"가 어긋난다.
    at: confirmedAt ?? signals.strong[0]?.at ?? null,
    // 단정하지 않고 근거를 보여 준다. "AI가 그렇다는데요"로는 아무도 승복하지
    // 않고, 승복하지 않으면 그냥 취소 버튼을 누른다.
    excerpt: aiExcerpt ?? signals.strong[0]?.text ?? null,
    signals,
    risk: describeCancellationRisk(terms),
    note: confirmed
      ? '이 방은 채용이 확정된 상태입니다.'
      : '아직 채용 확정 처리는 되지 않았지만, 대화에 확정으로 읽힐 수 있는 표현이 있습니다. 실제로 확정했다면 지금 취소는 해고에 해당합니다.',
  }
}

// 확정 뒤의 조건 변경도 실질적으로는 취소일 수 있다.
//
// 내정 취소는 "없던 일로 합시다"라는 통보로만 일어나지 않는다. 임금을 깎거나
// 출근일을 미뤄서 지원자가 스스로 포기하게 만드는 쪽이 실무에서 더 흔하고,
// 회사 입장에서는 그것이 취소라는 자각조차 없다. 근로계약이 이미 성립한 이상
// 그 내용을 일방적으로 불리하게 바꾸는 것은 근로조건의 불이익 변경이고,
// 지원자가 이를 거부해 관계가 끝나면 그 책임은 회사에 돌아온다.
//
// 막지는 않는다 — 양측이 합의해 바꾸는 것은 정당하다. 다만 그것이 무엇인지
// 모르고 하는 일이 없게, 무엇이 어떻게 불리해졌는지 짚어 준다.
const UNFAVOURABLE_FIELDS = {
  wageBaseAmount: { label: '임금', direction: 'down' },
  contractStartDate: { label: '근로개시일', direction: 'later' },
  contractEndDate: { label: '계약 종료일', direction: 'earlier' },
}

function toNumber(v) {
  // 빈 값을 0 으로 읽고 있었다. 임금 칸을 비우면 "2,900,000원에서 0원으로
  // 낮아집니다"라는, 아무도 하지 않은 제안이 불이익 변경으로 기록됐다.
  // 비어 있는 것은 0원이 아니라 모르는 것이다.
  const s = String(v ?? '').replace(/[,\s원]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function describeUnfavourableChanges(changes) {
  const found = []
  for (const c of changes || []) {
    const spec = UNFAVOURABLE_FIELDS[c.field]
    if (!spec) continue

    if (spec.direction === 'down') {
      const from = toNumber(c.from)
      const to = toNumber(c.to)
      if (from !== null && to !== null && to < from) {
        found.push({
          field: c.field,
          label: spec.label,
          detail: `${from.toLocaleString('ko-KR')}원에서 ${to.toLocaleString('ko-KR')}원으로 ${(from - to).toLocaleString('ko-KR')}원 낮아집니다.`,
        })
      }
      continue
    }

    const from = String(c.from ?? '')
    const to = String(c.to ?? '')
    if (!from || !to || from === to) continue
    const worse = spec.direction === 'later' ? to > from : to < from
    if (worse) {
      found.push({
        field: c.field,
        label: spec.label,
        detail: `${from}에서 ${to}로 바뀝니다.`,
      })
    }
  }
  return found
}
