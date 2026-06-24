import { createContext, ReactNode, useContext, useEffect, useState } from 'react'
import { apiFetch, SessionUser } from '../lib/api'

type AuthContextValue = {
  user: SessionUser | null
  loading: boolean
  login: (identifier: string, password: string) => Promise<SessionUser>
  register: (fullName: string, email: string, password: string, refCode?: string | null) => Promise<SessionUser>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const data = await apiFetch<{ user: SessionUser | null }>('/api/auth')
      setUser(data.user)
    } catch { setUser(null) } finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  const login = async (identifier: string, password: string) => {
    const data = await apiFetch<{ user: SessionUser }>('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'login', identifier, password }) })
    setUser(data.user); return data.user
  }
  const register = async (fullName: string, email: string, password: string, refCode?: string | null) => {
    const data = await apiFetch<{ user: SessionUser }>('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'register', fullName, email, password, refCode }) })
    setUser(data.user); return data.user
  }
  const logout = async () => {
    await apiFetch('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) })
    setUser(null)
  }
  return <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return context
}
