import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function DemoMenu() {
  const { user } = useAuth()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!user?.developerTrial) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [user?.developerTrial])
  if (!user?.developerTrial) return null
  const seconds = Math.max(0, Math.ceil((Date.parse(user.trialExpiresAt) - now) / 1000))
  const remaining = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return <Link className="app-bar-link" to="/admin" aria-label={`개발자 권한 체험 남은 시간 ${remaining}`}>
    체험 <span role="timer" aria-live="off">{remaining}</span>
  </Link>
}
