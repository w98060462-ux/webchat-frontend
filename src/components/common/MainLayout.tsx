import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useWebSocket } from '../../hooks/useWebSocket'

export default function MainLayout() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  useWebSocket()

  useEffect(() => {
    if (!user) navigate('/login')
  }, [user])

  return (
    <div className="app-layout">
      <div className="main-content">
        <Outlet />
      </div>
      <nav className="bottom-nav">
        <NavLink to="/chat" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <span className="nav-icon">💬</span>
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