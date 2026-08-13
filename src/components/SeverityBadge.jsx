import { severityClass, severityWord } from '../lib/severity.js'

// 심각도 배지. 색과 함께 반드시 말로도 심각도를 적는다.
//
// 배지 중 유일하게 한 문장이 들어가는 자리다. 나머지 배지는 짧은 라벨이라
// 한 줄로 두어야 하므로, 감싸는 것은 여기서만 연다(.badge-wrap).
export default function SeverityBadge({ severity, children }) {
  return (
    <span className={`badge badge-wrap ${severityClass(severity)}`}>
      <strong className="badge-severity">{severityWord(severity)}</strong> {children}
    </span>
  )
}
