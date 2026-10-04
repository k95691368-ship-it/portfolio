import { useState } from 'react'
import Fold from '../Fold.jsx'

// 외국인 근로자용 번역본 — 원본과 나란히 보여준다(공식 표준근로계약서 외국어본 방식).
export default function ContractTranslations({
  translations,
  sourceArticles,
  languages,
  canTranslate,
  onTranslate,
  busy,
}) {
  const [language, setLanguage] = useState(languages[0]?.code ?? 'en')
  // useState 초기값은 첫 렌더에만 쓰인다. 계약서 화면은 한 번만 마운트되므로,
  // 번역이 없던 상태에서 잡힌 null 이 그대로 남아 번역을 마쳐도 아무것도
  // 펼쳐지지 않았다. "아직 고르지 않음"과 "사용자가 접음"을 구분해, 고르지
  // 않았으면 가장 최근 번역을 보여 준다.
  const [shown, setShown] = useState(undefined)
  const effectiveShown = shown === undefined ? (translations[translations.length - 1]?.language ?? null) : shown

  const current = translations.find((t) => t.language === effectiveShown) ?? null

  if (!canTranslate && translations.length === 0) return null

  return (
    <Fold
      className="contract-translation"
      title="외국어 계약서"
      hint={translations.length > 0 ? `${translations.length}개 언어` : '아직 번역 없음'}
    >
      <p className="translation-note">
        법적 효력은 한국어 원본에 있으며, 번역본은 근로자가 내용을 정확히 이해하도록 돕기 위한
        참고본입니다.
      </p>

      {canTranslate && (
        <div className="translation-controls">
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.nativeLabel})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || sourceArticles.length === 0}
            onClick={() => onTranslate(language)}
          >
            {busy ? '번역 중...' : '이 언어로 번역하기'}
          </button>
          {sourceArticles.length === 0 && (
            <span className="translation-hint">계약 조건을 먼저 입력해주세요.</span>
          )}
        </div>
      )}

      {translations.length > 0 && (
        <div className="translation-tabs">
          {translations.map((t) => (
            <button
              key={t.language}
              type="button"
              className={`btn-sm${effectiveShown === t.language ? ' active' : ''}`}
              onClick={() => setShown(effectiveShown === t.language ? null : t.language)}
            >
              {t.nativeLabel}
              {t.stale !== false && <span className="translation-stale-mark"> ⚠</span>}
            </button>
          ))}
        </div>
      )}

      {/* 번역한 뒤에 조건이 바뀌었으면, 지금 보이는 번역본은 지금 계약서의
          번역이 아니다. 한국어를 읽지 못하는 사람은 스스로 확인할 방법이 없다. */}
      {current && current.stale !== false && (
        <p className="translation-alert" role="alert">
          {current.stale
            ? '이 번역본을 만든 뒤 계약 조건이 바뀌었습니다. 지금 계약서와 다른 내용이므로, 다시 번역한 뒤 확인해주세요.'
            : '이 번역본이 어느 시점의 내용을 옮긴 것인지 확인할 수 없습니다. 정확한 대조가 필요하면 다시 번역해주세요.'}
        </p>
      )}

      {current && (
        <div className="translation-body">
          {current.articles.map((a, i) => (
            <div className="translation-row" key={i}>
              <div className="translation-source">
                <strong>{sourceArticles[i]?.heading}</strong>
                <p>{sourceArticles[i]?.body}</p>
              </div>
              <div className="translation-target" lang={current.language}>
                <strong>{a.heading}</strong>
                <p>{a.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Fold>
  )
}
