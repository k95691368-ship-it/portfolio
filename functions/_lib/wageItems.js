// 임금 구성항목과 최저임금 산입범위 (순수 함수 — 단위 테스트 대상).
//
// 이 앱은 임금을 기본급 하나로만 받아 왔다. 그런데 실제 근로계약서에는 기본급
// 밑에 식대·교통비·직책수당·고정연장수당이 줄줄이 붙는다. 근로기준법 제17조가
// 요구하는 것도 "임금"이 아니라 임금의 구성항목·계산방법·지급방법이다.
//
// 항목을 나누지 않으면 최저임금 판정이 양쪽으로 틀린다.
//
//   기본급 190만 + 식대 20만인 계약은 최저임금 기준으로 210만인데, 기본급만
//   보면 190만으로 읽어 없는 위반을 만들어 낸다. 지금까지 고친 결함들과 반대
//   방향이지만 해로움은 같다 — 틀린 경고가 반복되면 맞는 경고도 무시된다.
//
//   반대로 기본급 180만 + 고정연장수당 40만인 계약은 합계 220만이지만,
//   가산수당은 소정근로의 대가가 아니라 최저임금에 산입되지 않는다. 합계만
//   보면 진짜 위반을 통과시킨다.
//
// 최저임금법 제6조 제4항과 부칙(2018.6.12) 제2조에 따라 산입범위가 단계적으로
// 넓어졌고 2024년부터는 매월 지급하는 상여금과 현금성 복리후생비가 전액
// 산입된다. 산입되지 않는 것은 소정근로 외의 대가(연장·야간·휴일 가산수당,
// 연차수당)와 매월 지급되지 않는 상여금이다.

export const WAGE_ITEM_TYPES = {
  base: {
    label: '기본급',
    included: true,
    note: '소정근로의 대가',
  },
  fixed_allowance: {
    label: '매월 고정수당',
    included: true,
    note: '직책수당·직무수당처럼 매월 정기적으로 지급하는 수당',
  },
  monthly_bonus: {
    label: '매월 지급 상여금',
    included: true,
    note: '2024년부터 전액 산입 (최저임금법 부칙 제2조)',
  },
  welfare: {
    label: '복리후생비(현금)',
    included: true,
    note: '식대·교통비 등 현금으로 지급하는 것. 2024년부터 전액 산입',
  },
  overtime_fixed: {
    label: '고정 연장·야간·휴일수당',
    included: false,
    note: '소정근로 외의 대가라 최저임금에 산입되지 않습니다 (제6조 제4항)',
  },
  annual_leave_allowance: {
    label: '연차수당',
    included: false,
    note: '소정근로 외의 대가라 최저임금에 산입되지 않습니다',
  },
  irregular_bonus: {
    label: '부정기 상여금',
    included: false,
    note: '분기·명절 상여처럼 매월 지급되지 않는 것은 산입되지 않습니다',
  },
  in_kind: {
    label: '현물 지급',
    included: false,
    note: '통화 이외의 것으로 지급하는 것은 산입되지 않습니다',
  },
}

export const MAX_WAGE_ITEMS = 20
const MAX_NAME_LENGTH = 40

export function isIncludedType(type) {
  return WAGE_ITEM_TYPES[type]?.included === true
}

// 화면·API에서 들어온 값을 저장 가능한 형태로 정리한다.
// 알 수 없는 종류는 버리지 않고 '기타'로 두면 산입 여부를 마음대로 정하는 셈이
// 되므로, 종류가 분명하지 않은 항목은 받지 않는다.
export function normalizeWageItems(raw) {
  if (!Array.isArray(raw)) return { ok: true, items: [] }
  if (raw.length > MAX_WAGE_ITEMS) {
    return { ok: false, error: `임금 구성항목은 ${MAX_WAGE_ITEMS}개까지 입력할 수 있습니다.` }
  }

  const items = []
  for (const entry of raw) {
    const name = String(entry?.name ?? '').trim().slice(0, MAX_NAME_LENGTH)
    const type = String(entry?.type ?? '').trim()
    // Number('')는 0이다. 그대로 두면 화면에서 "항목 추가"로 만든 빈 줄이
    // 금액 0원짜리 유효한 항목으로 읽혀, 종류가 비었다는 이유로 저장이 통째로
    // 400이 된다. 비어 있는 것은 숫자가 아닌 것으로 다룬다.
    const rawAmount = entry?.amount
    const amount =
      rawAmount === '' || rawAmount === null || rawAmount === undefined ? NaN : Number(rawAmount)

    if (name === '' && !Number.isFinite(amount)) continue // 빈 줄은 조용히 버린다
    if (!WAGE_ITEM_TYPES[type]) {
      return { ok: false, error: `임금 항목의 종류가 올바르지 않습니다: ${type || '(비어 있음)'}` }
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return { ok: false, error: `${name || '임금 항목'}의 금액이 올바르지 않습니다.` }
    }
    items.push({ name: name || WAGE_ITEM_TYPES[type].label, type, amount: Math.round(amount) })
  }

  const baseCount = items.filter((i) => i.type === 'base').length
  if (items.length > 0 && baseCount === 0) {
    return { ok: false, error: '기본급 항목이 있어야 합니다.' }
  }
  if (baseCount > 1) {
    return { ok: false, error: '기본급은 하나만 입력할 수 있습니다.' }
  }

  return { ok: true, items }
}

export function totalWage(items) {
  return (items || []).reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
}

// 최저임금 비교에 쓰는 임금. 산입되지 않는 항목을 뺀 금액이다.
export function minimumWageBase(items) {
  return (items || [])
    .filter((i) => isIncludedType(i.type))
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
}

// 구성이 없으면 기본급 하나만 있는 것으로 본다. 기존 계약을 소급해 고치지
// 않으므로, 항목을 입력하지 않은 계약은 예전과 똑같이 계산되어야 한다.
export function effectiveWageItems(terms) {
  const items = Array.isArray(terms?.wageItems) ? terms.wageItems : []
  if (items.length > 0) return items
  const base = Number(terms?.wageBaseAmount)
  if (!Number.isFinite(base) || base <= 0) return []
  return [{ name: '기본급', type: 'base', amount: Math.round(base) }]
}

// 화면에 그대로 쓸 수 있는 요약.
export function describeWageComposition(terms) {
  const items = effectiveWageItems(terms)
  if (items.length === 0) return null

  const included = items.filter((i) => isIncludedType(i.type))
  const excluded = items.filter((i) => !isIncludedType(i.type))

  return {
    items: items.map((i) => ({
      ...i,
      typeLabel: WAGE_ITEM_TYPES[i.type]?.label ?? i.type,
      includedInMinimumWage: isIncludedType(i.type),
      note: WAGE_ITEM_TYPES[i.type]?.note ?? null,
    })),
    total: totalWage(items),
    minimumWageBase: minimumWageBase(items),
    excludedTotal: totalWage(excluded),
    hasExcluded: excluded.length > 0,
    detail:
      excluded.length > 0
        ? `월 지급액 합계는 ${totalWage(items).toLocaleString('ko-KR')}원이지만, 최저임금과 비교할 때는 소정근로의 대가가 아닌 ${excluded
            .map((i) => i.name)
            .join('·')}을(를) 제외한 ${minimumWageBase(items).toLocaleString('ko-KR')}원을 씁니다.`
        : `월 지급액 합계 ${totalWage(items).toLocaleString('ko-KR')}원이 모두 최저임금 산입 대상입니다.`,
    included: included.length,
  }
}
