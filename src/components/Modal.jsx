import { useEffect, useRef } from 'react'
import { FOCUSABLE_SELECTOR, wrapFocusIndex, initialFocusIndex } from '../lib/focusTrap.js'

// 화면을 덮는 창.
//
// 지금까지 이 앱의 창들은 화면 위에 얹혀 있기만 했다. 탭을 누르면 초점이 뒤에
// 있는 화면으로 빠져나갔고, Esc로 닫히지 않았고, 닫은 뒤 초점이 어디로 가는지
// 알 수 없었다. 화면을 보지 못하는 사람에게는 창이 떠 있다는 사실 자체가
// 전달되지 않았다.
export default function Modal({ title, onClose, children, className = '' }) {
  const contentRef = useRef(null)
  const restoreRef = useRef(null)

  // 초점 가두기는 창이 뜨고 질 때 한 번씩만 일어나야 한다.
  //
  // 의존성에 onClose 를 걸어 두었는데, 호출부는 전부 인라인 화살표를 넘긴다.
  // 그래서 부모가 다시 그려질 때마다 새 함수가 되고, effect 가 정리됐다가 다시
  // 걸렸다. 정리는 초점을 창 뒤로 돌려주고 재설치는 창의 첫 요소로 잡는다.
  //
  // 방 화면은 2.5초마다 대화를 확인하므로, 상대가 입력 중이면 이 일이 계속
  // 반복된다. 채용내정 취소 확인창에서 Tab 으로 버튼까지 갔다가 메시지 하나에
  // 초점이 체크박스로 되돌아가면, 키보드만 쓰는 사람은 이 앱에서 가장 중요한
  // 창을 끝까지 조작할 수 없다.
  //
  // onClose 를 ref 에 담아 최신 것을 부르되, 설치·해제는 마운트/언마운트에서만.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    // 닫은 뒤 원래 있던 자리로 초점을 돌려주기 위해 기억해 둔다.
    restoreRef.current = document.activeElement
    const node = contentRef.current

    const focusables = () =>
      Array.from(node?.querySelectorAll(FOCUSABLE_SELECTOR) || []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      )

    const items = focusables()
    const startIndex = initialFocusIndex(items.length)
    if (startIndex >= 0) items[startIndex].focus()
    else node?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const list = focusables()
      if (list.length === 0) {
        event.preventDefault()
        return
      }
      const target = wrapFocusIndex(list.length, list.indexOf(document.activeElement), event.shiftKey)
      if (target !== null) {
        event.preventDefault()
        list[target].focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    // 창이 떠 있는 동안 뒤 화면이 함께 스크롤되지 않게 한다.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      restoreRef.current?.focus?.()
    }
    // 마운트/언마운트에서만. 위 주석 참고.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modal-overlay" onClick={() => onCloseRef.current()}>
      <div
        ref={contentRef}
        className={`modal-content ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
