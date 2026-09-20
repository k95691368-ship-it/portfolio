import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { api, getAccountSessionIdentity } from '../api/client.js'
import { assertVerifiedAccount } from '../utils/verifiedAccount.js'

const AuthContext = createContext(null)

// 응답을 못 받은 것과 로그인이 안 된 것은 다르다.
//
// 앱을 열면 "이 사람 누구야?"를 서버에 한 번 묻는다. 지금까지는 그 요청이
// 어떤 이유로 실패하든 전부 삼키고 로그인 안 된 사람으로 처리했다. 네트워크가
// 잠깐 끊겼거나 서버가 한 번 흔들린 것뿐인데도, 30일짜리 로그인 표시가 멀쩡히
// 남아 있는 채로 로그인 화면으로 튕겼다 — "로그인 유지가 안 된다"는 증상의
// 가장 유력한 원인이다.
//
// 401 만 '로그인 안 됨'이다. 그 밖의 실패는 한 번 더 물어보고, 그래도 안 되면
// 연결 문제로 두고 로그인 화면으로 보내지 않는다.
const RETRY_DELAY_MS = 1200
const CONNECTION_ERROR = '서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요.'

function isLoggedOut(err) {
  return err?.status === 401
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // 서버에 닿지 못한 상태. null 이면 문제 없음.
  const [connectionError, setConnectionError] = useState(null)
  const [sessionEpoch, setSessionEpoch] = useState(0)
  // undefined means that startup has not identified the account yet. Resolving
  // that lookup must not remount public forms already being filled out.
  const resolvedUserIdentity = useRef(undefined)
  // 늦게 끝난 세션 조회가 이후의 로그인·로그아웃을 덮어쓰지 않도록 한다.
  const sessionRevision = useRef(0)
  const observedSession = useRef(getAccountSessionIdentity())

  const setSessionUser = useCallback((nextUser, reset = false) => {
    const identity = nextUser?.id ?? null
    if (reset || (resolvedUserIdentity.current !== undefined && resolvedUserIdentity.current !== identity)) {
      setSessionEpoch((epoch) => epoch + 1)
    }
    resolvedUserIdentity.current = identity
    setUser(nextUser)
  }, [])

  useEffect(() => {
    if (!user?.developerTrial || !user.trialExpiresAt) return undefined
    const remaining = Date.parse(user.trialExpiresAt) - Date.now()
    const timer = setTimeout(() => {
      sessionRevision.current += 1
      setSessionUser(null)
    }, Math.max(0, remaining))
    return () => clearTimeout(timer)
  }, [user?.developerTrial, user?.trialExpiresAt, setSessionUser])

  const refresh = useCallback(async () => {
    const revision = ++sessionRevision.current
    observedSession.current = getAccountSessionIdentity()
    try {
      const data = await api.get('/me')
      if (revision !== sessionRevision.current) {
        const error = new Error('로그인 상태가 변경되었습니다. 다시 확인해주세요.')
        error.code = 'STALE_AUTH_RESPONSE'
        throw error
      }
      setSessionUser(data.user)
      setConnectionError(null)
      return data.user
    } catch (err) {
      if (revision === sessionRevision.current && err?.code !== 'STALE_AUTH_RESPONSE') {
        if (isLoggedOut(err)) {
          setSessionUser(null)
          setConnectionError(null)
        } else {
          setConnectionError(CONNECTION_ERROR)
        }
      }
      throw err
    } finally {
      if (revision === sessionRevision.current) setLoading(false)
    }
  }, [setSessionUser])

  useEffect(() => {
    const syncStoredSession = () => {
      const identity = getAccountSessionIdentity()
      if (identity === observedSession.current) return
      observedSession.current = identity
      sessionRevision.current += 1
      // Never show the previous account's private screen while a different
      // tab's credentials are being verified. Stored user/role data is not trusted.
      setSessionUser(null, true)
      setConnectionError(null)
      setLoading(!!identity)
      if (identity) void refresh().catch(() => {})
    }
    const onStorage = (event) => {
      if (event.key === 'portfolioSession' || event.key === null) syncStoredSession()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', syncStoredSession)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', syncStoredSession)
    }
  }, [refresh, setSessionUser])

  useEffect(() => {
    let cancelled = false
    const revision = ++sessionRevision.current
    const isCurrent = () => !cancelled && revision === sessionRevision.current

    const attempt = async (retriesLeft) => {
      try {
        const data = await api.get('/me')
        if (!isCurrent()) return
        setSessionUser(data.user)
        setConnectionError(null)
      } catch (err) {
        if (!isCurrent() || err?.code === 'STALE_AUTH_RESPONSE') return
        if (isLoggedOut(err)) {
          setSessionUser(null)
          setConnectionError(null)
          return
        }
        if (retriesLeft > 0) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
          if (!isCurrent()) return
          return attempt(retriesLeft - 1)
        }
        // 로그인 상태를 지우지 않는다. 모르는 것이지 로그아웃된 것이 아니다.
        setConnectionError(CONNECTION_ERROR)
      }
    }

    attempt(1).finally(() => {
      if (isCurrent()) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [setSessionUser])

  const login = async (email, password, remember = true) => {
    const loggedInUser = await api.post('/login', { email, password, remember })
    sessionRevision.current += 1
    observedSession.current = getAccountSessionIdentity()
    setLoading(false)
    setSessionUser(loggedInUser, true)
    setConnectionError(null)
    return loggedInUser
  }

  const signup = async (payload) => {
    const newUser = await api.post('/signup', payload)
    if (newUser.verificationRequired) return newUser
    sessionRevision.current += 1
    observedSession.current = getAccountSessionIdentity()
    setLoading(false)
    setSessionUser(newUser, true)
    setConnectionError(null)
    return newUser
  }

  const verifyEmail = async (token, password, options = {}) => {
    const revision = sessionRevision.current
    const assertCurrent = () => {
      if (revision !== sessionRevision.current || options.signal?.aborted || (options.isCurrent && !options.isCurrent())) {
        const error = new Error('이메일 확인 화면 또는 로그인 상태가 변경되었습니다. 현재 화면에서 다시 확인해주세요.')
        error.code = 'STALE_AUTH_RESPONSE'
        throw error
      }
    }
    assertCurrent()
    const verifiedUser = await api.post('/account/verify-email', { token, password }, ...(options.signal ? [{ signal: options.signal }] : []))
    assertCurrent()
    assertVerifiedAccount(verifiedUser)
    // Changing the session can remount the route. Finish proof cleanup and
    // navigation synchronously before publishing that change. A callback error
    // must not leave a falsely completed session in the UI.
    options.onVerified?.(verifiedUser)
    sessionRevision.current += 1
    observedSession.current = getAccountSessionIdentity()
    setLoading(false)
    setSessionUser(verifiedUser, true)
    setConnectionError(null)
    return verifiedUser
  }

  // 체험 계정으로 바로 들어간다.
  //
  // 로그인과 같은 자리에 둔다. 화면이 따로 쿠키를 다루지 않고, 로그인 상태를
  // 들고 있는 곳이 한 군데로 유지되어야 한다.
  const startDemo = async (role) => {
    const user = await api.post('/demo/login', { role })
    sessionRevision.current += 1
    observedSession.current = getAccountSessionIdentity()
    setLoading(false)
    setSessionUser(user, true)
    setConnectionError(null)
    return user
  }

  const logout = async () => {
    // Hide private views immediately, even offline. The API client clears the
    // captured local token before waiting for the server to revoke it.
    sessionRevision.current += 1
    setSessionUser(null, true)
    setConnectionError(null)
    setLoading(false)
    const pending = api.post('/logout', {})
    observedSession.current = getAccountSessionIdentity()
    return pending
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, connectionError, sessionEpoch, login, signup, verifyEmail, startDemo, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
