import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'

const FIT_BADGE = {
  high: 'badge-success',
  medium: 'badge-accent',
  low: 'badge-warning',
  unknown: 'badge-neutral',
}
const STATUS_LABEL = {
  submitted: '심사 대기',
  passed: '서류합격',
  rejected: '불합격',
}

// 한 공고의 지원자를 한 화면에서 견준다.
//
// 순서는 AI가 사람을 서열화한 결과가 아니라, 지원서마다 개별적으로 나온 직무
// 적합도와 경력 기간으로 정한 것이다. 그래서 각 줄에 "왜 이 자리인지"를 함께
// 보여주고, 아직 심사하지 않은 지원서가 몇 건인지도 분명히 알린다.
export default function ApplicantCompare({ postingId, postingTitle, onClose, onOpenApplication }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .get(`/postings/${postingId}/applications`)
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((err) => toast.error(err.message))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [postingId, toast])

  return (
    <section className="recruit-section applicant-compare">
      <div className="period-head">
        <h2>지원자 비교 — {postingTitle}</h2>
        <button type="button" className="btn-sm" onClick={onClose}>
          닫기
        </button>
      </div>

      {loading && <p>불러오는 중...</p>}

      {!loading && data && data.applicants.length === 0 && (
        <p className="notice">이 공고에 접수된 지원서가 없습니다.</p>
      )}

      {!loading && data && data.applicants.length > 0 && (
        <>
          <p className="compare-summary">
            전체 {data.summary.total}명 · 적합 {data.summary.byFit.high} · 보통{' '}
            {data.summary.byFit.medium} · 낮음 {data.summary.byFit.low} · 서류합격{' '}
            {data.summary.passed}
          </p>
          {data.truncated && (
            <p className="notice">
              지원자가 많아 최근 {data.limit}명까지만 비교했습니다. 나머지는 지원서 목록에서
              확인해주세요.
            </p>
          )}
          {data.summary.unscreened > 0 && (
            <p className="notice">
              아직 AI 심사를 하지 않은 지원서가 {data.summary.unscreened}건 있습니다. 심사를 마치면
              같은 기준으로 비교할 수 있습니다.
            </p>
          )}
          <p className="compare-note">
            순서는 직무 적합도와 경력 기간으로만 정합니다. 나이·성별·출신지역 같은 직무와 무관한
            정보는 쓰지 않으며, 최종 판단은 채용 담당자가 합니다.
          </p>

          {/* 표를 읽어 주는 도구가 어느 열의 값인지 알 수 있도록 열 머리를 연결하고,
              무엇을 비교하는 표인지 이름을 붙인다. */}
          <div className="table-scroll" tabIndex={0} role="region" aria-label="지원자 비교 표">
            <table className="admin-table">
              <caption className="sr-only">
                {postingTitle} 지원자 {data.applicants.length}명을 직무 적합도와 경력 기간으로 정렬한
                표
              </caption>
              <thead>
                <tr>
                  <th scope="col">순위</th>
                  <th scope="col">이름</th>
                  <th scope="col">적합도</th>
                  <th scope="col">경력</th>
                  <th scope="col">근거</th>
                  <th scope="col">강점 / 확인 필요</th>
                  <th scope="col">상태</th>
                  <th scope="col">
                    <span className="sr-only">지원서 열기</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.applicants.map((a) => (
                  <tr key={a.id}>
                    <td>{a.rank}</td>
                    <th scope="row" className="compare-name">
                      {a.applicantName}
                    </th>
                    <td>
                      <span className={`badge ${FIT_BADGE[a.fit]}`}>{a.fitLabel}</span>
                    </td>
                    <td>
                      {a.careerLabel}
                      {a.companies.length > 0 && (
                        <div className="compare-companies">{a.companies.join(', ')}</div>
                      )}
                    </td>
                    <td className="compare-basis">{a.basis}</td>
                    <td className="compare-points">
                      {a.strengths.slice(0, 2).map((s, i) => (
                        <div key={`s${i}`}>+ {s}</div>
                      ))}
                      {a.concerns.slice(0, 2).map((s, i) => (
                        <div key={`c${i}`} className="compare-concern">
                          − {s}
                        </div>
                      ))}
                      {a.strengths.length === 0 && a.concerns.length === 0 && '—'}
                    </td>
                    <td>{STATUS_LABEL[a.status] || a.status}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => onOpenApplication(a.id)}
                        aria-label={`${a.applicantName} 지원서 보기`}
                      >
                        지원서 보기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
