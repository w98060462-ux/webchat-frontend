import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '../../store/chatStore'
import type { Conversation } from '../../types'
import { formatTime } from '../../utils'

export default function ChatListPage() {
  const navigate = useNavigate()
  const { conversations, loadConversations, clearConversation } = useChatStore()
  const [search, setSearch] = useState('')
  const [confirmClear, setConfirmClear] = useState<Conversation | null>(null)

  // 长按计时
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressTarget = useRef<Conversation | null>(null)

  useEffect(() => {
    // 防御：ChatPage 异常卸载时 overflow 可能残留，这里主动恢复
    const mainContent = document.querySelector('.main-content') as HTMLElement | null
    if (mainContent) { mainContent.style.overflow = ''; mainContent.style.paddingBottom = '' }
    loadConversations()
  }, [])

  const filtered = conversations.filter(c => {
    const name = c.targetNickname || c.targetUsername || ''
    return name.toLowerCase().includes(search.toLowerCase())
  })

  function openChat(conv: Conversation) {
    navigate(`/chat/${conv.id}`, { state: { conv } })
  }

  function onPressStart(conv: Conversation) {
    pressTarget.current = conv
    pressTimer.current = setTimeout(() => {
      setConfirmClear(conv)
    }, 500)
  }

  function onPressEnd() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
    pressTarget.current = null
  }

  function doClear() {
    if (!confirmClear) return
    clearConversation(confirmClear.id)
    setConfirmClear(null)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>消息</h2>
      </div>

      {confirmClear && (
        <div className="modal-overlay" onClick={() => setConfirmClear(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>清除聊天记录</h3>
            <p style={{ fontSize: 14, color: 'var(--text-sub)', marginBottom: 12 }}>
              确定清除与「{confirmClear.targetNickname || confirmClear.targetUsername}」的所有聊天记录？此操作不可恢复。
            </p>
            <div className="modal-actions">
              <button className="btn-danger" onClick={doClear}>确定清除</button>
              <button onClick={() => setConfirmClear(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      <div className="search-bar">
        <input
          type="search"
          placeholder="搜索会话..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="list">
        {filtered.length === 0 && (
          <div className="empty-state">
            <p>暂无消息</p>
            <p className="empty-hint">去在线列表开始聊天吧</p>
          </div>
        )}
        {filtered.map(conv => {
          const displayName = conv.targetNickname || conv.targetUsername
          return (
            <div
              key={conv.id}
              className="list-item"
              onClick={() => openChat(conv)}
              onMouseDown={() => onPressStart(conv)}
              onMouseUp={onPressEnd}
              onMouseLeave={onPressEnd}
              onTouchStart={() => onPressStart(conv)}
              onTouchEnd={onPressEnd}
              onTouchCancel={onPressEnd}
              onContextMenu={e => { e.preventDefault(); setConfirmClear(conv) }}
            >
              <div className="avatar">
                {conv.targetAvatar
                  ? <img src={conv.targetAvatar} alt="" />
                  : <span>{(displayName || '?')[0].toUpperCase()}</span>
                }
                {conv.type === 'group' && <span className="avatar-badge">群</span>}
              </div>
              <div className="list-item-body">
                <div className="list-item-row">
                  <span className="list-item-name">{displayName || '未知'}</span>
                  {conv.lastMessageTime && (
                    <span className="list-item-time">{formatTime(conv.lastMessageTime)}</span>
                  )}
                </div>
                <div className="list-item-row">
                  <span className="list-item-preview">
                    {conv.lastMessageMine && conv.lastMessageStatus && conv.lastMessageStatus !== 'received' && (
                      <span className={`conv-status conv-status-${conv.lastMessageStatus}`}>
                        {conv.lastMessageStatus === 'sending' ? '○ '
                          : conv.lastMessageStatus === 'sent' ? '✓ '
                          : conv.lastMessageStatus === 'delivered' ? '✓✓ '
                          : '✗ '}
                      </span>
                    )}
                    {conv.lastMessage ?? ''}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="badge">{conv.unreadCount}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
