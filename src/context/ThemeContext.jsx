import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  resolveTheme,
  nextTheme,
  readStoredTheme,
  writeStoredTheme,
} from '../lib/theme.js'

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  // 고른 값이 있으면 그것을, 없으면 밝은 화면으로 연다.
  const [stored, setStored] = useState(() =>
    typeof window === 'undefined' ? null : readStoredTheme(window.localStorage)
  )

  const theme = resolveTheme(stored)

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    // 스크롤바·기본 위젯도 함께 바뀌도록 브라우저에 알린다.
    root.style.colorScheme = theme
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      // 아직 직접 고른 적이 없다는 뜻.
      followsSystem: stored === null,
      toggle: () => {
        const next = nextTheme(theme)
        setStored(next)
        writeStoredTheme(window.localStorage, next)
      },
    }),
    [theme, stored]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme는 ThemeProvider 안에서만 쓸 수 있습니다.')
  return ctx
}
