import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useChatStore } from '../../store/chatStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { ensureKeyPair } from '../../crypto/keyStore'

export default function MainLayout() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { disconnect } = useWebSocket()

  const { loadConversations } = useChatStore()
  const totalUnread = useChatStore(s =>
    s.conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)
  )

  const [keyState, setKeyState] = useState<'pending' | 'ready' | 'failed'>('pending')

  useEffect(() => {
    if (!user) {
      disconnect()
      navigate('/login')
      return
    }
    setKeyState('pending')
    ensureKeyPair(user.username)
      .then(() => {
        setKeyState('ready')
        loadConversations()
        // 密钥就绪后请求通知权限（在用户操作上下文中，避免冷启动被浏览器拦截）
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission()
        }
      })
      .catch(() => setKeyState('failed'))
  }, [user?.username])

  // document.title 实时反映未读数，页面隐藏时闪烁提示
  useEffect(() => {
    if (totalUnread === 0) {
      document.title = 'WebChat'
      return
    }
    document.title = `(${totalUnread}) WebChat`
    if (document.visibilityState === 'visible') return
    let show = true
    const timer = setInterval(() => {
      document.title = show ? `(${totalUnread}) WebChat` : 'WebChat'
      show = !show
    }, 1500)
    return () => { clearInterval(timer) }
  }, [totalUnread])

  useEffect(() => {
    function onVis() {
      if (document.visibilityState === 'visible') {
        document.title = totalUnread > 0 ? `(${totalUnread}) WebChat` : 'WebChat'
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [totalUnread])

  if (!user) return null

  if (keyState === 'pending') {
    return (
      <div className="app-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-sub)', fontSize: 14 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔐</div>
          <div>正在初始化加密...</div>
        </div>
      </div>
    )
  }

  if (keyState === 'failed') {
    return (
      <div className="app-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', color: 'var(--text-sub)', fontSize: 14, maxWidth: 280 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ marginBottom: 16 }}>加密初始化失败，请检查网络后重试</div>
          <button
            className="btn-primary"
            onClick={() => {
              setKeyState('pending')
              ensureKeyPair(user.username)
                .then(() => { setKeyState('ready'); loadConversations() })
                .catch(() => setKeyState('failed'))
            }}
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      <div className="main-content">
        <Outlet />
      </div>
      <nav className="bottom-nav">
        <NavLink to="/chat" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <span className="nav-icon">
            💬
            {totalUnread > 0 && (
              <span className="nav-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
            )}
          </span>
          <span>消息</span>
        </NavLink>
        <NavLink to="/friends" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <span className="nav-icon">👥</span>
          <span>好友</span>
        </NavLink>
        <NavLink to="/groups" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <span className="nav-icon">🏠</span>
          <span>群组</span>
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <span className="nav-icon">👤</span>
          <span>我的</span>
        </NavLink>
      </nav>
    </div>
  )
}
