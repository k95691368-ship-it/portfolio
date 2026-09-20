import { useContext, useEffect, useRef } from 'react'
import { UNSAFE_DataRouterStateContext, useLocation, useNavigationType } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { restoreDeferredScroll } from '../lib/deferredScroll.js'

export default function DeferredScrollRestoration() {
  // This exported UNSAFE context is not a stable public API. Keep the adapter
  // here only; navigation regression tests must run when React Router changes.
  const routerState = useContext(UNSAFE_DataRouterStateContext)
  const { key, hash } = useLocation()
  const navigationType = useNavigationType()
  const { sessionEpoch } = useAuth()
  const locationIdentity = useRef({ key, sessionEpoch })
  const targetY = routerState?.restoreScrollPosition

  useEffect(() => {
    if (locationIdentity.current.key !== key) locationIdentity.current = { key, sessionEpoch }
    // Account transitions cancel, rather than restart, the old account's target.
    if (locationIdentity.current.sessionEpoch !== sessionEpoch) return undefined
    if (navigationType !== 'POP' || hash) return undefined
    return restoreDeferredScroll(targetY)
  }, [key, hash, navigationType, sessionEpoch, targetY])

  return null
}
