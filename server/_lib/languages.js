// 계약서 번역 지원 언어.
// 고용노동부 표준근로계약서 외국어본과 고용허가제(EPS) 송출국 구성을 참고했다.
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'zh', label: '중국어', nativeLabel: '中文' },
  { code: 'vi', label: '베트남어', nativeLabel: 'Tiếng Việt' },
  { code: 'th', label: '태국어', nativeLabel: 'ไทย' },
  { code: 'id', label: '인도네시아어', nativeLabel: 'Bahasa Indonesia' },
  { code: 'uz', label: '우즈베크어', nativeLabel: "O'zbekcha" },
  { code: 'ne', label: '네팔어', nativeLabel: 'नेपाली' },
  { code: 'km', label: '크메르어', nativeLabel: 'ភាសាខ្មែរ' },
  { code: 'my', label: '미얀마어', nativeLabel: 'မြန်မာဘာသာ' },
  { code: 'mn', label: '몽골어', nativeLabel: 'Монгол' },
]

const BY_CODE = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l]))

export function findLanguage(code) {
  return BY_CODE.get(String(code || '').toLowerCase()) ?? null
}

