import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <section className="status-page" aria-labelledby="not-found-title">
      <header className="page-header">
        <h1 id="not-found-title">페이지를 찾을 수 없습니다</h1>
        <p>주소가 변경되었거나 존재하지 않는 페이지입니다. 아래 메뉴에서 다시 이동해주세요.</p>
      </header>
      <nav className="header-actions" aria-label="페이지 찾기">
        <Link to="/">처음으로</Link>
        <Link to="/jobs">채용 공고 보기</Link>
      </nav>
    </section>
  )
}
