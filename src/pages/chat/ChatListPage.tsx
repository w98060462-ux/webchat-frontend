import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '../../store/chatStore'
import type { Conversation } from '../../types'
import { formatTime } from '../../utils'

export default function ChatListPage() {
  const navigate = useNavigate()
  const { conversations, loadConversations } = useChatStore()
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadConversations()
  }, [])

  const filtered = conversations.filter(c =>
    c.targetName.toLowerCase().includes(search.toLowerCase())
  )

  function openChat(conv: Conversation) {
    navigate(`/chat/${conv.id}`, { state: { conv } })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>消息</h2>
      </div>
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
            <p className="empty-hint">去好友列表开始聊天吧</p>
          </div>
        )}
        {filtered.map(conv => (
          <div key={conv.id} className="list-item" onClick={() => openChat(conv)}>
            <div className="avatar">
              {conv.targetAvatar
                ? <img src={conv.targetAvatar} alt="" />
                : <span>{(conv.targetName || '?')[0].toUpperCase()}</span>
              }
              {conv.type === 'group' && <span className="avatar-badge">群</span>}
            </div>
            <div className="list-item-body">
              <div className="list-item-row">
                <span className="list-item-name">{conv.targetName || '未知'}</span>
                {conv.lastMessageTime && (
                  <span className="list-item-time">{formatTime(conv.lastMessageTime)}</span>
                )}
              </div>
              <div className="list-item-row">
                <span className="list-item-preview">{conv.lastMessage ?? ''}</span>
                {conv.unreadCount > 0 && (
                  <span className="badge">{conv.unreadCount}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}