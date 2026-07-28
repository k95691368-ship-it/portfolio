// 밝은 화면 / 어두운 화면 결정 (순수 함수 — 단위 테스트 대상).
//
// 규칙은 하나다: 사용자가 직접 고른 것이 있으면 그것을 따르고, 없으면 기기
// 설정을 따른다. 고르지 않은 사람에게 기기 설정과 다른 화면을 보여주지 않고,
// 고른 사람의 선택을 기기 설정으로 덮어쓰지 않기 위해서다.

export const THEME_KEY = 'theme'
export const THEMES = ['light', 'dark']

export function isTheme(value) {
  return THEMES.includes(value)
}

// stored: 사용자가 고른 값(없으면 null), prefersDark: 기기 설정이 어두움인가
export function resolveTheme(stored, prefersDark) {
  if (isTheme(stored)) return stored
  return prefersDark ? 'dark' : 'light'
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
