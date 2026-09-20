import { useCallback, useEffect } from 'react'
import { useBlocker } from 'react-router-dom'
import Modal from './Modal.jsx'
import { shouldBlockFormNavigation } from '../lib/navigationGuard.js'

// One guard per active page. Router navigation (including Back/Forward) and
// document navigation need separate protection; input is never persisted here.
export default function UnsavedChangesGuard({ when, message = '저장하지 않은 내용이 있습니다. 이동하면 입력한 내용이 사라집니다.' }) {
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) =>
    shouldBlockFormNavigation(when, currentLocation, nextLocation), [when]))

  useEffect(() => {
    if (!when) return undefined
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [when])

  useEffect(() => {
    // A save may finish while the confirmation is visible. Dismiss the prompt
    // without unexpectedly navigating; the next navigation is then unblocked.
    if (!when && blocker.state === 'blocked') blocker.reset()
  }, [when, blocker])

  if (!when || blocker.state !== 'blocked') return null
  return <Modal title="작성 중인 내용이 있습니다" onClose={() => blocker.reset()}>
    <h2>작성 중인 내용이 있습니다</h2>
    <p>{message}</p>
    <div className="modal-actions">
      <button type="button" onClick={() => blocker.reset()}>계속 작성</button>
      <button type="button" className="btn-danger" onClick={() => blocker.proceed()}>저장하지 않고 나가기</button>
    </div>
  </Modal>
}
