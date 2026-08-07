import type { Message } from '../../types'
import { formatTime, formatFileSize } from '../../utils'
import { useState, useRef } from 'react'
import { useChatStore } from '../../store/chatStore'

interface Props {
  msg: Message
  isMine: boolean
}

const EXECUTABLE_EXTS = new Set([
  'exe', 'msi', 'dmg', 'pkg', 'app',
  'apk', 'ipa',
  'sh', 'bash', 'zsh', 'fish',
  'bat', 'cmd', 'ps1', 'vbs',
  'jar',
])

function getExt(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : ''
}

function isExecutable(filename?: string): boolean {
  if (!filename) return false
  return EXECUTABLE_EXTS.has(getExt(filename))
}

function getFileIcon(filename?: string): string {
  if (!filename) return '📄'
  const ext = getExt(filename)
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return '🖼️'
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return '🎬'
  if (['mp3', 'wav', 'aac', 'flac', 'm4a'].includes(ext)) return '🎵'
  if (['pdf'].includes(ext)) return '📕'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['xls', 'xlsx'].includes(ext)) return '📊'
  if (['ppt', 'pptx'].includes(ext)) return '📊'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦'
  if (EXECUTABLE_EXTS.has(ext)) return '⚙️'
  return '📄'
}

export default function MessageBubble({ msg, isMine }: Props) {
  const [showMenu, setShowMenu] = useState(false)
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false)
  const deleteMessage = useChatStore(s => s.deleteMessage)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleLongPress() {
    setShowMenu(true)
  }

  function onTouchStart() {
    longPressTimer.current = setTimeout(() => { handleLongPress() }, 500)
  }

  function onTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
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

  function doDownload() {
    const a = document.createElement('a')
    a.href = msg.content
    a.download = msg.filename ?? 'file'
    a.click()
    setShowDownloadConfirm(false)
  }

  function renderContent() {
    if (msg.contentType === 'image') {
      if (!msg.content) {
        return <span className="msg-text" style={{ opacity: 0.5 }}>图片已过期，请重新发送</span>
      }
      return (
        <img
          src={msg.content}
          alt="图片"
          className="msg-image"
          onClick={() => window.open(msg.content, '_blank')}
        />
      )
    }
    if (msg.contentType === 'file') {
      const exec = isExecutable(msg.filename)
      const expired = !msg.content
      return (
        <>
          <div
            className="msg-file"
            onClick={() => {
              if (expired) return
              isMine ? doDownload() : setShowDownloadConfirm(true)
            }}
            style={expired ? { opacity: 0.5, cursor: 'default' } : undefined}
          >
            <span className="msg-file-icon">{getFileIcon(msg.filename)}</span>
            <div className="msg-file-info">
              <span className="msg-file-name">{msg.filename ?? '文件'}</span>
              {expired
                ? <span className="msg-file-size">文件已过期，请重新发送</span>
                : msg.fileSize != null && (
                  <span className="msg-file-size">{formatFileSize(msg.fileSize)}</span>
                )
              }
              {!expired && exec && (
                <span className="msg-file-exec-warn">⚠️ 程序安装包</span>
              )}
            </div>
          </div>

          {showDownloadConfirm && !expired && (
            <div className="menu-overlay" onClick={() => setShowDownloadConfirm(false)}>
              <div className="context-menu file-confirm" onClick={e => e.stopPropagation()}>
                <div className="file-confirm-title">保存文件</div>
                <div className="file-confirm-name">{msg.filename}</div>
                <div className="file-confirm-tip">这是对方发来的文件，保存后请确认是否信任发件人再打开。</div>
                {exec && (
                  <div className="file-confirm-danger">⚠️ 这是一个程序安装包，打开后会在你的手机或电脑上运行，请确认来自可信的人再保存。</div>
                )}
                <div className="file-confirm-actions">
                  <button className="btn-sm btn-primary" onClick={doDownload}>下载</button>
                  <button className="btn-sm" onClick={() => setShowDownloadConfirm(false)}>取消</button>
                </div>
              </div>
            </div>
          )}
        </>
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
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onTouchMove={onTouchEnd}
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
