import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackPageView } from '../lib/analytics.js'

// 화면이 바뀔 때마다 방문 기록을 보낸다.
//
// 이 사이트는 주소가 바뀌어도 브라우저가 새 문서를 받아오지 않는다(SPA).
// 그래서 <head> 의 태그는 처음 한 번만 돌고, 그 뒤로는 공고를 보든 계약서를
// 쓰든 애널리틱스에 아무것도 남지 않는다. 첫 화면 하나만 계속 세는 셈이다.
//
// 라우터가 주소를 바꾸는 것을 여기서 듣고 직접 보낸다. 첫 화면도 여기서
// 보낸다 -- <head> 에서는 send_page_view 를 꺼 두었다.
export default function PageViewTracker() {
  const { pathname } = useLocation()

  useEffect(() => {
    trackPageView(pathname)
  }, [pathname])

  return null
}
