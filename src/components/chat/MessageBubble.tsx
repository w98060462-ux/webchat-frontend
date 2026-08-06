import type { Message } from '../../types'
import { formatTime, formatFileSize } from '../../utils'
import { useState } from 'react'
import { useChatStore } from '../../store/chatStore'

interface Props {
  msg: Message
  isMine: boolean
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080'

export default function MessageBubble({ msg, isMine }: Props) {
  const [showMenu, setShowMenu] = useState(false)
  const deleteMessage = useChatStore(s => s.deleteMessage)

  function handleLongPress() {
    setShowMenu(true)
  }

  function handleDelete() {
    deleteMessage(msg.id, msg.conversationId)
    setShowMenu(false)
  }

  function handleCopy() {
    navigator.clipboard.writeText(msg.content)
    setShowMenu(false)
  }

  function getStatusIcon() {
    if (!isMine) return null
    switch (msg.status) {
      case 'sending': return <span className="msg-status">○</span>
      case 'sent': return <span className="msg-status">✓</span>
      case 'delivered': return <span className="msg-status delivered">✓✓</span>
      case 'failed': return <span className="msg-status failed">✗</span>
      default: return null
    }
  }

  function renderContent() {
    if (msg.contentType === 'image') {
      const url = msg.content.startsWith('http') ? msg.content : `${API_BASE}${msg.content}`
      return (
        <img
          src={url}
          alt="图片"
          className="msg-image"
          onClick={() => window.open(url, '_blank')}
        />
      )
    }
    if (msg.contentType === 'file') {
      const url = msg.content.startsWith('http') ? msg.content : `${API_BASE}${msg.content}`
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="msg-file">
          <span className="msg-file-icon">📄</span>
          <div className="msg-file-info">
            <span className="msg-file-name">{msg.filename ?? '文件'}</span>
            {msg.fileSize && <span className="msg-file-size">{formatFileSize(msg.fileSize)}</span>}
          </div>
        </a>
      )
    }
    return <span className="msg-text">{msg.content}</span>
  }

  return (
    <>
      {showMenu && (
        <div className="menu-overlay" onClick={() => setShowMenu(false)}>
          <div className="context-menu" onClick={e => e.stopPropagation()}>
            {msg.contentType === 'text' && (
              <button onClick={handleCopy}>复制</button>
            )}
            <button onClick={handleDelete} className="danger">删除</button>
            <button onClick={() => setShowMenu(false)}>取消</button>
          </div>
        </div>
      )}
      <div className={`msg-row ${isMine ? 'mine' : 'theirs'}`}>
        {!isMine && (
          <div className="msg-avatar">
            {msg.fromAvatar
              ? <img src={msg.fromAvatar} alt="" />
              : <span>{(msg.fromNickname || msg.fromUsername || '?')[0].toUpperCase()}</span>
            }
          </div>
        )}
        <div
          className="msg-bubble-wrap"
          onContextMenu={e => { e.preventDefault(); handleLongPress() }}
        >
          {!isMine && (
            <span className="msg-sender">{msg.fromNickname || msg.fromUsername}</span>
          )}
          <div className={`msg-bubble ${isMine ? 'bubble-mine' : 'bubble-theirs'}`}>
            {renderContent()}
          </div>
          <div className="msg-meta">
            <span className="msg-time">{formatTime(msg.timestamp)}</span>
            {getStatusIcon()}
          </div>
        </div>
      </div>
    </>
  )
}