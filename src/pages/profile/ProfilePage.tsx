import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { userApi, authApi } from '../../api'
import { useAuthStore } from '../../store/authStore'
import { getApiError } from '../../utils'

export default function ProfilePage() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const refreshToken = useAuthStore(s => s.refreshToken)
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(user?.nickname ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveProfile() {
    setSaving(true)
    setError('')
    try {
      const res = await userApi.updateProfile({ nickname: nickname.trim() || undefined })
      if (res.success) {
        setUser(res.data)
        setEditing(false)
      } else {
        setError(res.message ?? '保存失败')
      }
    } catch (err) {
      setError(getApiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function logout() {
    if (!confirm('确定退出登录？')) return
    try {
      if (refreshToken) await authApi.logout(refreshToken)
    } catch { /* ignore */ }
    clearAuth()
    navigate('/login')
  }

  if (!user) return null

  return (
    <div className="page">
      <div className="page-header">
        <h2>我的</h2>
      </div>

      <div className="profile-card">
        <div className="profile-avatar">
          {user.avatar
            ? <img src={user.avatar} alt="" />
            : <span>{(user.nickname || user.username)[0].toUpperCase()}</span>
          }
        </div>
        <div className="profile-info">
          {editing ? (
            <div className="form-group">
              <label>昵称</label>
              <input
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                placeholder="输入昵称"
              />
              {error && <div className="form-error">{error}</div>}
              <div className="btn-group">
                <button className="btn-primary" onClick={saveProfile} disabled={saving}>
                  {saving ? '保存中...' : '保存'}
                </button>
                <button onClick={() => { setEditing(false); setNickname(user.nickname ?? '') }}>取消</button>
              </div>
            </div>
          ) : (
            <>
              <h3>{user.nickname || user.username}</h3>
              <p className="profile-uid">UID: {user.uid}</p>
              <p className="profile-username">用户名: @{user.username}</p>
            </>
          )}
        </div>
        {!editing && (
          <button className="btn-sm" onClick={() => setEditing(true)}>编辑</button>
        )}
      </div>

      <div className="settings-list">
        <div className="settings-item">
          <span>聊天记录存储</span>
          <span className="settings-value">本地设备</span>
        </div>
        <div className="settings-item">
          <span>服务器数据</span>
          <span className="settings-value">账号信息仅</span>
        </div>
      </div>

      <div className="profile-actions">
        <button className="btn-danger btn-full" onClick={logout}>退出登录</button>
      </div>
    </div>
  )
}