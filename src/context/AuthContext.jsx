import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from '../api/client.js'

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

function isLoggedOut(err) {
  return err?.status === 401
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // 서버에 닿지 못한 상태. null 이면 문제 없음.
  const [connectionError, setConnectionError] = useState(null)

  const refresh = useCallback(async () => {
    const data = await api.get('/me')
    setUser(data.user)
    setConnectionError(null)
    return data.user
  }, [])

  useEffect(() => {
    let cancelled = false

    const attempt = async (retriesLeft) => {
      try {
        const data = await api.get('/me')
        if (cancelled) return
        setUser(data.user)
        setConnectionError(null)
      } catch (err) {
        if (cancelled) return
        if (isLoggedOut(err)) {
          setUser(null)
          setConnectionError(null)
          return
        }
        if (retriesLeft > 0) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
          if (cancelled) return
          return attempt(retriesLeft - 1)
        }
        // 로그인 상태를 지우지 않는다. 모르는 것이지 로그아웃된 것이 아니다.
        setConnectionError('서버에 연결하지 못했습니다. 잠시 후 새로고침해주세요.')
      }
    }

    attempt(1).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const login = async (email, password, remember = true) => {
    const loggedInUser = await api.post('/login', { email, password, remember })
    setUser(loggedInUser)
    setConnectionError(null)
    return loggedInUser
  }

  const signup = async (payload) => {
    const newUser = await api.post('/signup', payload)
    setUser(newUser)
    setConnectionError(null)
    return newUser
  }

  // 체험 계정으로 바로 들어간다.
  //
  // 로그인과 같은 자리에 둔다. 화면이 따로 쿠키를 다루지 않고, 로그인 상태를
  // 들고 있는 곳이 한 군데로 유지되어야 한다.
  const startDemo = async (role) => {
    const user = await api.post('/demo/login', { role })
    setUser(user)
    setConnectionError(null)
    return user
  }

  const logout = async () => {
    await api.post('/logout', {})
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, connectionError, login, signup, startDemo, logout, refresh }}
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
