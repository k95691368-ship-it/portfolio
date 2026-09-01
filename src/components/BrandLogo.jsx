import { Link } from 'react-router-dom'

// 화면 왼쪽 위에 늘 있는 표지.
//
// 어느 화면에 있든 "여기가 어디인지"와 "돌아갈 곳"을 알려 준다. 지금까지는
// 화면마다 제목만 있고 사이트를 나타내는 것이 없어서, 면접방이나 계약서
// 화면에 바로 들어온 사람은 자기가 어느 서비스에 있는지 알 수 없었다.
//
// 누르면 채용 공고로 간다. 첫 화면이 아니라 공고다 -- 이 사이트에 오는
// 사람의 대부분은 일자리를 보러 오고, 첫 화면은 "회사인가 지원자인가"를
// 한 번 더 묻는 자리일 뿐이다. 돌아갈 곳은 물음이 아니라 목록이어야 한다.
//
// 그림은 파일로 두지 않고 코드로 그린다. 파일이면 어두운 화면에서 한 벌을
// 더 만들어야 하고, 요청이 하나 늘고, 크기를 바꿀 때마다 흐려진다.
// currentColor 로 그리면 글자색을 따라가므로 밝은 화면과 어두운 화면이
// 저절로 맞는다.
export default function BrandLogo({ to = '/jobs' }) {
  return (
    <Link to={to} className="brand" aria-label="채용 공고로 이동">
      <svg
        className="brand-mark"
        viewBox="0 0 28 28"
        width="28"
        height="28"
        aria-hidden="true"
        focusable="false"
      >
        {/* 서류 한 장. 이 서비스가 다루는 것이 근로계약서다. */}
        <rect x="4.5" y="2.5" width="16" height="23" rx="3.5" fill="currentColor" opacity="0.16" />
        <rect
          x="4.5"
          y="2.5"
          width="16"
          height="23"
          rx="3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        {/* 적힌 조건들. */}
        <path
          d="M8.6 9h7.8M8.6 13h7.8M8.6 17h4.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.55"
        />
        {/* 확인 표시. 이 앱이 실제로 하는 일은 "맞는지 보고 막는 것"이다. */}
        <circle cx="20.5" cy="19.5" r="6" fill="var(--bg)" />
        <circle cx="20.5" cy="19.5" r="5.1" fill="currentColor" />
        <path
          d="M18.1 19.6l1.7 1.7 3.2-3.4"
          stroke="var(--bg)"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span className="brand-name">전자근로계약</span>
    </Link>
  )
}
