import { useTheme } from '../context/ThemeContext.jsx'
import { toggleLabel } from '../lib/theme.js'

// 밝은 화면 / 어두운 화면 전환.
//
// 아이콘만으로는 무엇을 하는 버튼인지 화면을 읽어 주는 도구가 알 수 없으므로,
// 눌렀을 때 무엇이 되는지를 설명으로 붙인다.
export default function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme()
  const label = toggleLabel(theme)

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        {theme === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
          </>
        ) : (
          <path d="M20.1 15.2A8.4 8.4 0 0 1 8.8 3.9 8.5 8.5 0 1 0 20.1 15.2Z" />
        )}
      </svg>
    </button>
  )
}
