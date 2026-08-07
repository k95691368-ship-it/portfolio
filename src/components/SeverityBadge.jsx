import { severityClass, severityWord } from '../lib/severity.js'

// 심각도 배지. 색과 함께 반드시 말로도 심각도를 적는다.
export default function SeverityBadge({ severity, children }) {
  return (
    <span className={`badge ${severityClass(severity)}`}>
      <strong className="badge-severity">{severityWord(severity)}</strong> {children}
    </span>
  )
}
