// 밝은 화면 / 어두운 화면 결정 (순수 함수 — 단위 테스트 대상).
//
// 사용자가 직접 고른 것이 있으면 그것을 따른다. 고른 사람의 선택을 무엇으로도
// 덮어쓰지 않는다.
//
// 고른 적이 없으면 밝은 화면으로 연다. 처음에는 기기 설정을 따랐는데, 이
// 서비스에서 처음 열리는 화면은 근로계약서다. 계약서는 종이로 출력되고 PDF로
// 교부되는 흰 문서이고, 인쇄 영역만 흰색이면 화면과 문서의 색이 어긋난다.
// 무엇보다 처음 온 사람에게는 이 화면이 그 문서의 모양 그대로여야 한다.
// 어두운 화면이 필요한 사람은 오른쪽 아래 버튼으로 바꾸면 그 선택이 남는다.

export const THEME_KEY = 'theme'
export const THEMES = ['light', 'dark']

export function isTheme(value) {
  return THEMES.includes(value)
}

// stored: 사용자가 고른 값(없으면 null), prefersDark: 기기 설정이 어두움인가
export function resolveTheme(stored) {
  if (isTheme(stored)) return stored
  return 'light'
}

export function nextTheme(current) {
  return current === 'dark' ? 'light' : 'dark'
}

export function themeLabel(theme) {
  return theme === 'dark' ? '어두운 화면' : '밝은 화면'
}

// 다음에 누르면 무엇이 되는지를 버튼 설명으로 쓴다.
export function toggleLabel(current) {
  return `${themeLabel(nextTheme(current))}으로 바꾸기`
}

// 저장된 값을 읽는다. 브라우저 저장소를 쓸 수 없는 환경에서도 죽지 않는다.
export function readStoredTheme(storage) {
  try {
    const value = storage?.getItem(THEME_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

export function writeStoredTheme(storage, theme) {
  try {
    storage?.setItem(THEME_KEY, theme)
    return true
  } catch {
    return false
  }
}
