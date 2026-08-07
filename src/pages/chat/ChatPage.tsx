import React, { useEffect, useRef, useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useChatStore } from '../../store/chatStore'
import { useAuthStore } from '../../store/authStore'
import { sendWsMessage, waitForChunkAck, acceptTransfer, rejectTransfer } from '../../hooks/useWebSocket'
import type { Message, Conversation } from '../../types'
import { generateId, getApiError } from '../../utils'
import MessageBubble from '../../components/chat/MessageBubble'
import { getPrivateKey } from '../../crypto/keyStore'
import { getPublicKey } from '../../crypto/publicKeyCache'
import { encryptMessage, encryptWithGroupKey } from '../../crypto/e2e'
import { getGroupKey } from '../../crypto/groupKeyCache'

export default function ChatPage() {
  const { convId } = useParams<{ convId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const conv: Conversation | undefined = location.state?.conv

  const user = useAuthStore(s => s.user)!
  const { messages, loadMessages, addMessage, updateMessageStatus, upsertConversation, clearUnread, clearConversation } = useChatStore()
  const storeConv = useChatStore(s => s.conversations.find(c => c.id === convId))

  const [text, setText] = useState('')
  const [atBottom, setAtBottom] = useState(true)
  const [hasNewMsg, setHasNewMsg] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{
    sent: number; total: number; startedAt: number
  } | null>(null)
  const [receiveProgress, setReceiveProgress] = useState<{
    transferId: string; filename: string; received: number
    total: number; startedAt: number; fromName: string
  } | null>(null)
  const [receiveRequest, setReceiveRequest] = useState<{
    transferId: string; filename: string | undefined
    fileSize: number | undefined; fromName: string
  } | null>(null)
  const [savedToast, setSavedToast] = useState<string | null>(null)
  const [noKeyWarning, setNoKeyWarning] = useState<string | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const currentTransferIdRef = useRef<string | null>(null)

  // 监听 WS 层推来的文件传输事件
  useEffect(() => {
    function onTransferError(e: Event) {
      const { transferId, message } = (e as CustomEvent).detail
      if (currentTransferIdRef.current === transferId) {
        setUploading(false)
        setUploadProgress(null)
        currentTransferIdRef.current = null
        alert(message ?? '文件发送失败，请重试')
      }
    }
    function onReceiveRequest(e: Event) {
      const { transferId, filename, fileSize, fromNickname } = (e as CustomEvent).detail
      setReceiveRequest({ transferId, filename, fileSize, fromName: fromNickname })
    }
    function onReceiveStart(e: Event) {
      const { transferId, filename, totalChunks, fromNickname } = (e as CustomEvent).detail
      setReceiveProgress({ transferId, filename: filename ?? '', received: 0, total: totalChunks, startedAt: 0, fromName: fromNickname ?? '' })
    }
    function onReceiveProgress(e: Event) {
      const { transferId, received, totalChunks, startedAt } = (e as CustomEvent).detail
      setReceiveProgress(prev =>
        prev?.transferId === transferId && prev != null
          ? { ...prev, received, total: totalChunks, startedAt }
          : prev
      )
    }
    function onReceiveDone(e: Event) {
      const { transferId, filename } = (e as CustomEvent).detail
      setReceiveProgress(prev => prev?.transferId === transferId ? null : prev)
      if (filename) {
        setSavedToast(`✅ 「${filename}」已保存到你选择的位置`)
        setTimeout(() => setSavedToast(null), 3000)
      }
    }
    window.addEventListener('file-transfer-error', onTransferError)
    window.addEventListener('file-receive-request', onReceiveRequest)
    window.addEventListener('file-receive-start', onReceiveStart)
    window.addEventListener('file-receive-progress', onReceiveProgress)
    window.addEventListener('file-receive-done', onReceiveDone)
    return () => {
      window.removeEventListener('file-transfer-error', onTransferError)
      window.removeEventListener('file-receive-request', onReceiveRequest)
      window.removeEventListener('file-receive-start', onReceiveStart)
      window.removeEventListener('file-receive-progress', onReceiveProgress)
      window.removeEventListener('file-receive-done', onReceiveDone)
    }
  }, [])

  const convMessages = messages[convId!] ?? []

  // 软键盘处理：监听 visualViewport 高度变化，用 CSS var 驱动消息区 padding-bottom
  // 不用 translateY/height 硬改，避免和 Safari 自身的滚动行为打架产生抖动
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    let rafId = 0
    function onViewportChange() {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        if (!pageRef.current) return
        // windowHeight - viewportHeight = 键盘高度
        const keyboardHeight = Math.max(0, window.innerHeight - vv!.height)
        pageRef.current.style.setProperty('--keyboard-h', `${keyboardHeight}px`)
        if (keyboardHeight > 0) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
        }
      })
    }

    vv.addEventListener('resize', onViewportChange)
    return () => {
      vv.removeEventListener('resize', onViewportChange)
      cancelAnimationFrame(rafId)
      // 页面卸载时重置，避免变量残留影响其他页面
      pageRef.current?.style.removeProperty('--keyboard-h')
    }
  }, [])

  useEffect(() => {
    if (convId) {
      loadMessages(convId)
      clearUnread(convId)
      setAtBottom(true)
      setHasNewMsg(false)
    }
  }, [convId])

  // 进入聊天页时，对当前会话中对方的消息发送已读回执
  // 让发送方知道消息已被阅读（sent → delivered）
  // 注意：接收方本地存的消息 status 是 'delivered'，不能用 status 做过滤条件
  useEffect(() => {
    if (!convId || !user) return
    const msgs = useChatStore.getState().messages[convId] ?? []
    for (const m of msgs) {
      if (m.fromUsername !== user.username) {
        sendWsMessage({
          type: 'MESSAGE_READ',
          messageId: m.id,
          toUsername: m.fromUsername,
          groupId: m.conversationType === 'group' ? (useChatStore.getState().conversations.find(c => c.id === convId)?.groupId) : undefined,
        })
      }
    }
  }, [convId])

  // 监听滚动位置，判断是否在底部
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    function onScroll() {
      const { scrollTop, scrollHeight, clientHeight } = container!
      setAtBottom(scrollHeight - scrollTop - clientHeight < 60)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (convId) clearUnread(convId)
    if (atBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      setHasNewMsg(false)
    } else {
      setHasNewMsg(true)
    }
    // 新消息到达时，若为对方发来的消息，立即发已读回执
    if (!convId || !user) return
    const msgs = useChatStore.getState().messages[convId] ?? []
    const latest = msgs[msgs.length - 1]
    if (latest && latest.fromUsername !== user.username) {
      sendWsMessage({
        type: 'MESSAGE_READ',
        messageId: latest.id,
        toUsername: latest.fromUsername,
        groupId: latest.conversationType === 'group' ? (useChatStore.getState().conversations.find(c => c.id === convId)?.groupId) : undefined,
      })
    }
  }, [convMessages.length])

  function parseConvId(): { type: 'private' | 'group'; targetUsername: string } {
    if (!convId) return { type: 'private', targetUsername: '' }
    if (convId.startsWith('group_')) {
      return { type: 'group', targetUsername: convId.slice(6) }
    }
    // 优先从导航 state 的 conv 对象取（最可靠，无歧义）
    if (conv?.targetUsername) return { type: 'private', targetUsername: conv.targetUsername }
    // 其次从 store 里取（从会话列表进入时已存有 targetUsername）
    if (storeConv?.targetUsername) return { type: 'private', targetUsername: storeConv.targetUsername }
    // 降级：从 convId 字符串还原。格式 private_{sorted[0]}_{sorted[1]}
    // 优先尝试自己排在前（my + '_' + target）
    const withoutPrefix = convId.slice('private_'.length)
    const myUsername = user.username
    const suffix = '_' + myUsername
    if (withoutPrefix.startsWith(myUsername + '_')) {
      return { type: 'private', targetUsername: withoutPrefix.slice(myUsername.length + 1) }
    }
    if (withoutPrefix.endsWith(suffix)) {
      return { type: 'private', targetUsername: withoutPrefix.slice(0, withoutPrefix.length - suffix.length) }
    }
    return { type: 'private', targetUsername: withoutPrefix }
  }

  function buildConversation(msg: Message): Conversation {
    return {
      id: convId!,
      type: convType,
      targetUsername: conv?.targetUsername ?? storeConv?.targetUsername ?? convTarget,
      targetNickname: conv?.targetNickname ?? storeConv?.targetNickname ?? null,
      targetAvatar: conv?.targetAvatar ?? storeConv?.targetAvatar ?? null,
      groupId: convType === 'group' ? (groupIdFromConvId() ?? storeConv?.groupId) : undefined,
      lastMessage: msg.contentType === 'text' ? msg.content : `[${msg.contentType}]`,
      lastMessageTime: msg.timestamp,
      unreadCount: 0,
      updatedAt: Date.now(),
    }
  }

  async function encryptContent(
    type: 'private' | 'group',
    targetUsername: string,
    content: string,
  ): Promise<{ encrypted: string; blocked: boolean }> {
    if (type === 'private') {
      const myPrivKey = await getPrivateKey(user.username)
      const theirPubKey = await getPublicKey(targetUsername)
      if (!myPrivKey || !theirPubKey) {
        setNoKeyWarning('对方尚未设置加密，暂时无法发送消息，请稍后重试')
        return { encrypted: content, blocked: true }
      }
      setNoKeyWarning(null)
      const encrypted = await encryptMessage(myPrivKey, theirPubKey, content)
      return { encrypted, blocked: false }
    }
    const groupId = groupIdFromConvId()
    if (groupId === null) return { encrypted: content, blocked: true }
    const groupKey = await getGroupKey(groupId)
    if (!groupKey) {
      setNoKeyWarning('群密钥加载中，请稍后重试')
      return { encrypted: content, blocked: true }
    }
    setNoKeyWarning(null)
    const encrypted = await encryptWithGroupKey(groupKey, content)
    return { encrypted, blocked: false }
  }

  function groupIdFromConvId(): number | null {
    // 优先从导航 state 取（GroupPage 直接跳转时携带）
    const stateGroupId = (location.state as { groupId?: number } | null)?.groupId
    if (stateGroupId != null) return stateGroupId
    // 其次从 conv 对象取（含 groupId 字段）
    const convGroupId = (location.state as { conv?: { groupId?: number } } | null)?.conv?.groupId
    if (convGroupId != null) return convGroupId
    // 最后从会话 store 取（从会话列表进入时，Conversation 里存有 groupId）
    const storeGroupId = storeConv?.groupId ?? null
    return storeGroupId
  }

  async function sendText() {
    const plainContent = text.trim()
    if (!plainContent || !convId) return
    setText('')  // 立即清空，防止重复发送
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    const msgId = generateId()
    const { encrypted, blocked } = await encryptContent(convType, convTarget, plainContent)
    if (blocked) {
      setText(plainContent)  // 加密失败，把内容还回去
      return
    }
    const msg: Message = {
      id: msgId,
      conversationId: convId,
      conversationType: convType,
      fromUsername: user.username,
      fromNickname: user.nickname,
      fromAvatar: user.avatar,
      toUsername: convType === 'private' ? convTarget : undefined,
      toGroupName: convType === 'group' ? convTarget : undefined,
      contentType: 'text',
      content: plainContent,
      status: 'sending',
      timestamp: Date.now(),
      createdAt: Date.now(),
    }
    addMessage(msg)
    upsertConversation(buildConversation(msg))
    const sent = sendWsMessage({
      type: convType === 'group' ? 'GROUP_CHAT' : 'CHAT',
      messageId: msgId,
      toUsername: convType === 'private' ? convTarget : undefined,
      toGroupName: convType === 'group' ? convTarget : undefined,
      groupId: convType === 'group' ? (groupIdFromConvId() ?? undefined) : undefined,
      contentType: 'text',
      content: encrypted,
    })
    if (!sent) updateMessageStatus(msgId, convId, 'failed')
  }

  async function handleAccept() {
    if (!receiveRequest) return
    const req = receiveRequest
    setReceiveRequest(null)
    try {
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: req.filename ?? 'file',
        types: [{ description: '文件', accept: { '*/*': [] } }],
      })
      const writable = await fileHandle.createWritable()
      acceptTransfer(req.transferId, writable)
    } catch {
      rejectTransfer(req.transferId)
    }
  }

  function handleReject() {
    if (!receiveRequest) return
    rejectTransfer(receiveRequest.transferId)
    setReceiveRequest(null)
  }

  async function handleFileUpload(file: File) {
    if (!convId) return
    if (convType !== 'private') return

    const MAX = 1024 * 1024 * 1024  // 1GB（流式写盘，内存不再是瓶颈）
    if (file.size === 0) {
      alert('不支持发送空文件')
      return
    }
    if (file.size > MAX) {
      alert('文件大小不能超过 1GB')
      return
    }

    // 大文件警告（超过 100MB 提示）
    if (file.size > 100 * 1024 * 1024) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(0)
      const ok = confirm(
        `⚠️ 你即将发送一个 ${sizeMB}MB 的大文件。\n\n` +
        `请注意：\n` +
        `• 传输期间请勿关闭此页面或切换网络\n` +
        `• 对方也必须保持在线，否则传输中断需重新发送\n` +
        `• 传输时间取决于双方网速，可能需要数分钟\n` +
        `• 接收方需在弹出的保存对话框中选择保存位置\n\n` +
        `确定发送吗？`
      )
      if (!ok) return
    }

    setUploading(true)
    const transferId = `${user.username}_${generateId()}`
    currentTransferIdRef.current = transferId
    const msgId = generateId()
    const CHUNK_SIZE = 64 * 1024  // 64KB 每片
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    const sendStart = Date.now()

    setUploadProgress({ sent: 0, total: totalChunks, startedAt: sendStart })

    try {
      const myPrivKey = await getPrivateKey(user.username)
      const theirPubKey = await getPublicKey(convTarget)
      if (!myPrivKey || !theirPubKey) {
        setNoKeyWarning('对方尚未设置加密，暂时无法发送文件，请稍后重试')
        return
      }
      setNoKeyWarning(null)

      const isImage = file.type.startsWith('image/')
      const contentType = isImage ? 'image' : 'file'

      const startOk = sendWsMessage({
        type: 'FILE_TRANSFER_START',
        transferId,
        messageId: msgId,
        toUsername: convTarget,
        filename: file.name,
        fileSize: file.size,
        contentType,
        totalChunks,
      })
      if (!startOk) { alert('当前网络不稳定，请稍后再试'); return }

      // 等接收方接受（chunkIndex = -1），超时或对方拒绝则返回 false
      // 对方拒绝时 file-transfer-error 事件已处理提示并清空 currentTransferIdRef
      const startAcked = await waitForChunkAck(transferId, -1, 30000)
      if (!startAcked) {
        if (currentTransferIdRef.current !== null) {
          // 真正超时（对方30秒内未响应），主动取消并提示
          sendWsMessage({ type: 'FILE_TRANSFER_ERROR', transferId })
          alert('对方未响应，文件发送已取消')
        }
        return
      }

      // 逐片读取 → 加密 → 发送 → 等 ACK
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const slice = file.slice(start, start + CHUNK_SIZE)
        const buf = await slice.arrayBuffer()

        const bytes = new Uint8Array(buf)
        let b64 = ''
        const SUB = 8192
        for (let j = 0; j < bytes.length; j += SUB) {
          b64 += String.fromCharCode(...bytes.subarray(j, j + SUB))
        }
        b64 = btoa(b64)

        const encryptedChunk = await encryptMessage(myPrivKey, theirPubKey, b64)

        const sent = sendWsMessage({
          type: 'FILE_CHUNK',
          transferId,
          chunkIndex: i,
          totalChunks,
          fileData: encryptedChunk,
        })
        if (!sent) {
          sendWsMessage({ type: 'FILE_TRANSFER_ERROR', transferId })
          alert('传输中断，请检查网络后重试')
          return
        }

        const acked = await waitForChunkAck(transferId, i, 15000)
        if (!acked) {
          sendWsMessage({ type: 'FILE_TRANSFER_ERROR', transferId })
          if (currentTransferIdRef.current !== null) {
            alert('传输中断，请检查网络后重试')
          }
          return
        }

        // 更新发送进度
        setUploadProgress({ sent: i + 1, total: totalChunks, startedAt: sendStart })
      }

      sendWsMessage({ type: 'FILE_TRANSFER_END', transferId, messageId: msgId })

      const localUrl = URL.createObjectURL(file)
      const msg: Message = {
        id: msgId,
        conversationId: convId,
        conversationType: 'private',
        fromUsername: user.username,
        fromNickname: user.nickname,
        fromAvatar: user.avatar,
        toUsername: convTarget,
        contentType: isImage ? 'image' : 'file',
        content: localUrl,
        filename: file.name,
        fileSize: file.size,
        status: 'sending',
        timestamp: Date.now(),
        createdAt: Date.now(),
      }
      addMessage(msg)
      upsertConversation(buildConversation(msg))
    } catch (err) {
      sendWsMessage({ type: 'FILE_TRANSFER_ERROR', transferId })
      alert(getApiError(err))
    } finally {
      currentTransferIdRef.current = null
      setUploading(false)
      setUploadProgress(null)
    }
  }

  function handleClearHistory() {
    setShowMenu(false)
    if (!convId) return
    if (!confirm('确定清除此会话的全部聊天记录？清除后无法恢复。')) return
    clearConversation(convId)
    navigate('/chat', { replace: true })
  }

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value)
    // 自动伸展高度：先重置再撑开，避免缩不回去
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendText().catch(() => {})
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  // 根据已传片数、总片数、开始时间，计算进度百分比和预计剩余秒数
  function calcProgress(sent: number, total: number, startedAt: number) {
    const pct = total > 0 ? Math.round((sent / total) * 100) : 0
    if (sent === 0 || startedAt === 0) return { pct, etaStr: '计算中...' }
    const elapsed = (Date.now() - startedAt) / 1000        // 已用秒
    const speed = sent / elapsed                            // 片/秒
    const remaining = (total - sent) / speed               // 预计剩余秒
    const etaStr = remaining < 60
      ? `约 ${Math.ceil(remaining)} 秒`
      : remaining < 3600
        ? `约 ${Math.ceil(remaining / 60)} 分钟`
        : `约 ${(remaining / 3600).toFixed(1)} 小时`
    return { pct, etaStr }
  }

  const { type: convType, targetUsername: convTarget } = parseConvId()

  const title = storeConv?.targetNickname || storeConv?.targetUsername
    || conv?.targetNickname || conv?.targetUsername
    || convId || '聊天'

  const sendProg = uploadProgress
    ? calcProgress(uploadProgress.sent, uploadProgress.total, uploadProgress.startedAt)
    : null

  const recvProg = receiveProgress
    ? calcProgress(receiveProgress.received, receiveProgress.total, receiveProgress.startedAt)
    : null

  return (
    <div className="chat-page" ref={pageRef}>
      <div className="chat-header">
        <button className="icon-btn" onClick={() => navigate('/chat')}>←</button>
        <div className="chat-header-info">
          <span className="chat-header-name">{title}</span>
        </div>
        <button className="icon-btn" onClick={() => setShowMenu(v => !v)}>⋮</button>
      </div>

      {showMenu && (
        <div className="menu-overlay" onClick={() => setShowMenu(false)}>
          <div className="context-menu" onClick={e => e.stopPropagation()}>
            <button className="danger" onClick={handleClearHistory}>清除聊天记录</button>
            <button onClick={() => setShowMenu(false)}>取消</button>
          </div>
        </div>
      )}

      {noKeyWarning && (
        <div className="encryption-warning">
          ⚠️ {noKeyWarning}
        </div>
      )}

      {/* 接收文件请求 banner */}
      {receiveRequest && (
        <div className="file-receive-request">
          <span className="file-receive-info">
            📥 <strong>{receiveRequest.fromName}</strong> 想发给你：
            「{receiveRequest.filename ?? '文件'}」
            {receiveRequest.fileSize != null && ` (${formatFileSize(receiveRequest.fileSize)})`}
          </span>
          <div className="file-receive-actions">
            <button className="btn-sm btn-primary" onClick={handleAccept}>接受</button>
            <button className="btn-sm" onClick={handleReject}>拒绝</button>
          </div>
        </div>
      )}

      {/* 文件已保存 toast */}
      {savedToast && (
        <div className="file-saved-toast">{savedToast}</div>
      )}

      {/* 发送方进度条 */}
      {uploading && sendProg && (
        <div className="transfer-progress-bar send">
          <div className="transfer-progress-header">
            <span>📤 文件发送中 · {sendProg.pct}%</span>
            <span className="transfer-eta">{sendProg.etaStr}</span>
          </div>
          <div className="transfer-progress-track">
            <div className="transfer-progress-fill" style={{ width: `${sendProg.pct}%` }} />
          </div>
          <div className="transfer-progress-warning">
            ⚠️ 请勿关闭此页面或切换网络，否则传输中断需重新发送
          </div>
        </div>
      )}

      {/* 接收方进度条 */}
      {receiveProgress && recvProg && (
        <div className="transfer-progress-bar recv">
          <div className="transfer-progress-header">
            <span>📥 正在接收「{receiveProgress.filename ?? '文件'}」· {recvProg.pct}%</span>
            <span className="transfer-eta">{recvProg.etaStr}</span>
          </div>
          <div className="transfer-progress-track">
            <div className="transfer-progress-fill" style={{ width: `${recvProg.pct}%` }} />
          </div>
          <div className="transfer-progress-warning">
            ⚠️ 请勿关闭此页面或切换网络，否则接收中断需对方重新发送
          </div>
        </div>
      )}

      <div className="chat-messages" ref={messagesContainerRef}>
        {convMessages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} isMine={msg.fromUsername === user.username} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {hasNewMsg && (
        <button
          className="new-msg-hint"
          onClick={() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
            setHasNewMsg(false)
          }}
        >
          有新消息 ↓
        </button>
      )}

      <div className="chat-input-area">
        {convType === 'private' && (
          <button className="icon-btn" onClick={() => fileInputRef.current?.click()} title="发送文件" disabled={uploading}>
            📎
          </button>
        )}
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          rows={1}
          maxLength={5000}
        />
        <button
          className="btn-send"
          onClick={() => sendText().catch(() => {})}
          disabled={!text.trim()}
        >
          发送
        </button>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }}
        />
      </div>
    </div>
  )
}