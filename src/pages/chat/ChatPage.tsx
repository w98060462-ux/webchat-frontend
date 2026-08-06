import React, { useEffect, useRef, useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useChatStore } from '../../store/chatStore'
import { useAuthStore } from '../../store/authStore'
import { sendWsMessage } from '../../hooks/useWebSocket'
import { uploadApi } from '../../api'
import type { Message, Conversation } from '../../types'
import { generateId, getApiError } from '../../utils'
import MessageBubble from '../../components/chat/MessageBubble'

export default function ChatPage() {
  const { convId } = useParams<{ convId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const conv: Conversation | undefined = location.state?.conv

  const user = useAuthStore(s => s.user)!
  const { messages, loadMessages, addMessage, updateMessageStatus, upsertConversation } = useChatStore()

  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const convMessages = messages[convId!] ?? []

  useEffect(() => {
    if (convId) loadMessages(convId)
  }, [convId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [convMessages.length])

  function buildConversation(msg: Message): Conversation {
    return {
      id: convId!,
      type: conv?.type ?? 'private',
      targetId: conv?.targetId ?? 0,
      targetName: conv?.targetName ?? '',
      targetAvatar: conv?.targetAvatar ?? null,
      lastMessage: msg.contentType === 'text' ? msg.content : `[${msg.contentType}]`,
      lastMessageTime: msg.timestamp,
      unreadCount: 0,
      updatedAt: Date.now(),
    }
  }

  function parseConvId() {
    if (!convId) return { type: 'private' as const, targetId: 0 }
    if (convId.startsWith('group_')) return { type: 'group' as const, targetId: parseInt(convId.slice(6)) }
    const parts = convId.split('_')
    const ids = [parseInt(parts[1]), parseInt(parts[2])]
    const targetId = ids.find(id => id !== user.id) ?? 0
    return { type: 'private' as const, targetId }
  }

  function sendText() {
    if (!text.trim() || !convId) return
    const { type, targetId } = parseConvId()
    const msgId = generateId()
    const msg: Message = {
      id: msgId,
      conversationId: convId,
      conversationType: type,
      fromUserId: user.id,
      fromUsername: user.username,
      fromNickname: user.nickname,
      fromAvatar: user.avatar,
      toUserId: type === 'private' ? targetId : undefined,
      toGroupId: type === 'group' ? targetId : undefined,
      contentType: 'text',
      content: text.trim(),
      status: 'sending',
      timestamp: Date.now(),
      createdAt: Date.now(),
    }
    addMessage(msg)
    upsertConversation(buildConversation(msg))
    sendWsMessage({
      type: type === 'group' ? 'GROUP_CHAT' : 'CHAT',
      messageId: msgId,
      toUserId: type === 'private' ? targetId : undefined,
      toGroupId: type === 'group' ? targetId : undefined,
      contentType: 'text',
      content: text.trim(),
    })
    updateMessageStatus(msgId, convId, 'sent')
    setText('')
  }

  async function handleFileUpload(file: File, isImage: boolean) {
    if (!convId) return
    setUploading(true)
    try {
      const res = isImage ? await uploadApi.image(file) : await uploadApi.file(file)
      if (!res.success) return
      const { type, targetId } = parseConvId()
      const msgId = generateId()
      const msg: Message = {
        id: msgId,
        conversationId: convId,
        conversationType: type,
        fromUserId: user.id,
        fromUsername: user.username,
        fromNickname: user.nickname,
        fromAvatar: user.avatar,
        toUserId: type === 'private' ? targetId : undefined,
        toGroupId: type === 'group' ? targetId : undefined,
        contentType: isImage ? 'image' : 'file',
        content: res.data.url,
        filename: res.data.originalName,
        fileSize: res.data.size,
        status: 'sending',
        timestamp: Date.now(),
        createdAt: Date.now(),
      }
      addMessage(msg)
      upsertConversation(buildConversation(msg))
      sendWsMessage({
        type: type === 'group' ? 'GROUP_CHAT' : 'CHAT',
        messageId: msgId,
        toUserId: type === 'private' ? targetId : undefined,
        toGroupId: type === 'group' ? targetId : undefined,
        contentType: isImage ? 'image' : 'file',
        content: res.data.url,
        filename: res.data.originalName,
        fileSize: res.data.size,
      })
      updateMessageStatus(msgId, convId, 'sent')
    } catch (err) {
      alert(getApiError(err))
    } finally {
      setUploading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendText()
    }
  }

  const title = conv?.targetName ?? convId ?? '聊天'

  return (
    <div className="chat-page">
      <div className="chat-header">
        <button className="icon-btn" onClick={() => navigate(-1)}>←</button>
        <div className="chat-header-info">
          <span className="chat-header-name">{title}</span>
        </div>
      </div>

      <div className="chat-messages">
        {convMessages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} isMine={msg.fromUserId === user.id} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <button className="icon-btn" onClick={() => imageInputRef.current?.click()} title="图片">
          🖼️
        </button>
        <button className="icon-btn" onClick={() => fileInputRef.current?.click()} title="文件">
          📎
        </button>
        <textarea
          className="chat-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={uploading ? '上传中...' : '输入消息...'}
          rows={1}
          disabled={uploading}
        />
        <button
          className="btn-send"
          onClick={sendText}
          disabled={!text.trim() || uploading}
        >
          发送
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, true); e.target.value = '' }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.txt"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, false); e.target.value = '' }}
        />
      </div>
    </div>
  )
}