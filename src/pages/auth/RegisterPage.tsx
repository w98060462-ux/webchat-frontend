import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi } from '../../api'
import { useAuthStore } from '../../store/authStore'
import { getApiError, saveCredentials } from '../../utils'
import { useWakeHint } from '../../hooks/useWakeHint'

export default function RegisterPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { wakeHint, startWaiting, stopWaiting } = useWakeHint()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) { setError('两次密码不一致'); return }
    setLoading(true)
    startWaiting()
    try {
      const res = await authApi.register({ username, password, confirmPassword })
      stopWaiting()
      if (res.success) {
        saveCredentials(username, password)
        setAuth(res.data.accessToken, res.data.refreshToken, res.data.user)
        navigate('/chat')
      } else {
        // 用户名已被使用时，尝试用相同密码直接登录
        // 场景：用户换手机/清缓存后重新注册，或服务器迁移后用户名已恢复
        if (res.message?.includes('用户名已被使用')) {
          startWaiting()
          try {
            const loginRes = await authApi.login({ login: username, password })
            stopWaiting()
            if (loginRes.success) {
              saveCredentials(username, password)
              setAuth(loginRes.data.accessToken, loginRes.data.refreshToken, loginRes.data.user)
              navigate('/chat')
              return
            }
          } catch {
            stopWaiting()
          }
          setError('该用户名已被注册，请前往登录页使用正确密码登录')
        } else {
          setError(res.message ?? '注册失败')
        }
      }
    } catch (err) {
      stopWaiting()
      setError(getApiError(err))
    } finally {
      setLoading(false)
    }
  }

  const buttonLabel = wakeHint ?? (loading ? '注册中...' : '注册')

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-icon">💬</span>
          <h1>WebChat</h1>
          <p>创建你的账号</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="3-50位字母/数字/下划线"
              required
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="至少6位"
              required
              autoComplete="new-password"
            />
          </div>
          <div className="form-group">
            <label>确认密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="再次输入密码"
              required
              autoComplete="new-password"
            />
          </div>
          {error && <div className="form-error">{error}</div>}
          {wakeHint && !error && (
            <div className="wake-hint">{wakeHint}</div>
          )}
          <button type="submit" className="btn-primary btn-full" disabled={loading}>
            {buttonLabel}
          </button>
        </form>
        <p className="auth-switch">
          已有账号？<Link to="/login">立即登录</Link>
        </p>
      </div>
    </div>
  )
}
