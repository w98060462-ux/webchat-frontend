import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { authApi, groupApi } from '../api'
import { reLoginWithCredentials } from '../api/http'
import { getPrivateConvId, getGroupConvId } from '../utils'
import type { WsMessage, Message } from '../types'
import { getPrivateKey } from '../crypto/keyStore'
import { getPublicKey, invalidatePublicKey } from '../crypto/publicKeyCache'
import { decryptMessage, decryptWithGroupKey, generateGroupKey, wrapGroupKey } from '../crypto/e2e'
import { getGroupKey, setGroupKey, invalidateGroupKey } from '../crypto/groupKeyCache'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'
const PING_INTERVAL = 25000    // 每 25 秒发一次 PING
const MAX_MISSED_PONGS = 3     // 连续 3 次无响应 → 主动断线重连
const RECONNECT_DELAY = 3000

let wsInstance: WebSocket | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let manualClose = false
let missedPongs = 0            // 连续未收到 PONG 的次数

// ACK 等待器：transferId_chunkIndex → { resolve, isError }
const ackWaiters = new Map<string, (ok: boolean) => void>()

// 接收中的传输状态（已接受，持有 writable）
interface TransferState {
  messageId: string
  fromUsername: string
  fromNickname: string | null
  fromAvatar: string | null
  filename: string | undefined
  fileSize: number | undefined
  contentType: string
  totalChunks: number
  received: number
  startedAt: number
  writable: FileSystemWritableFileStream
}
const incomingTransfers = new Map<string, TransferState>()

// 等待用户接受的传输请求（尚无 writable）
type PendingTransferMeta = Omit<TransferState, 'writable'>
const pendingTransfers = new Map<string, PendingTransferMeta>()

export function useWebSocket() {
  const { accessToken } = useAuthStore()
  const { addMessage, updateMessageStatus, upsertConversation } = useChatStore()
  const connectedRef = useRef(false)

  const connect = useCallback(async () => {
    let token = useAuthStore.getState().accessToken
    const currentUser = useAuthStore.getState().user
    if (!token || !currentUser) return
    if (wsInstance?.readyState === WebSocket.OPEN ||
        wsInstance?.readyState === WebSocket.CONNECTING) return

    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      const expMs = payload.exp * 1000
      if (expMs - Date.now() < 60_000) {
        const refreshToken = useAuthStore.getState().refreshToken
        if (refreshToken) {
          try {
            const res = await authApi.refresh(refreshToken)
            if (res.success) {
              useAuthStore.getState().setAuth(res.data.accessToken, res.data.refreshToken, res.data.user)
              token = res.data.accessToken
            } else {
              // refreshToken 业务级失败（已被轮换/失效），用本地凭据无感重登
              const newToken = await reLoginWithCredentials()
              if (!newToken) return
              token = newToken
            }
          } catch {
            // refreshToken 请求网络级失败，用本地凭据无感重登
            const newToken = await reLoginWithCredentials()
            if (!newToken) return
            token = newToken
          }
        }
      }
    } catch { }

    manualClose = false
    wsInstance = new WebSocket(`${WS_URL}/ws/chat?token=${token}`)

    wsInstance.onopen = () => {
      connectedRef.current = true
      missedPongs = 0
      pingTimer = setInterval(() => {
        missedPongs++
        if (missedPongs > MAX_MISSED_PONGS) {
          // 连续 3 次心跳无响应，主动断线触发重连
          wsInstance?.close()
          return
        }
        send({ type: 'PING' })
      }, PING_INTERVAL)
    }

    wsInstance.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        handleIncoming(msg).catch(() => {})
      } catch { }
    }

    wsInstance.onclose = () => {
      connectedRef.current = false
      missedPongs = 0
      if (pingTimer) clearInterval(pingTimer)
      const state = useChatStore.getState()
      for (const [convId, msgs] of Object.entries(state.messages)) {
        for (const m of msgs) {
          if (m.status === 'sending') {
            state.updateMessageStatus(m.id, convId, 'failed')
          }
        }
      }
      if (!manualClose) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY)
      }
    }

    wsInstance.onerror = () => {
      wsInstance?.close()
    }
  }, [accessToken])

  const handleIncoming = useCallback(async (msg: WsMessage) => {
    if (msg.type === 'PONG') {
      missedPongs = 0
      return
    }

    if (msg.type === 'NEW_MESSAGE') {
      const currentUser = useAuthStore.getState().user!

      // 普通文字消息
      const isGroup = !!msg.toGroupName
      const convId = isGroup
        ? getGroupConvId(msg.toGroupName!)
        : getPrivateConvId(currentUser.username, msg.fromUsername!)

      const existingMsgs = useChatStore.getState().messages[convId] ?? []
      if (msg.messageId && existingMsgs.some(m => m.id === msg.messageId)) return

      let content = msg.content ?? ''
      if (!isGroup) {
        try {
          const myPrivKey = await getPrivateKey(currentUser.username)
          const theirPubKey = await getPublicKey(msg.fromUsername!)
          if (myPrivKey && theirPubKey) {
            try {
              content = await decryptMessage(myPrivKey, theirPubKey, content)
            } catch {
              // 解密失败：可能是发送方换了密钥对，清除缓存，下次收到新消息时重拉
              invalidatePublicKey(msg.fromUsername!)
            }
          }
        } catch { }
      } else if (isGroup && msg.groupId) {
        try {
          const groupKey = await getGroupKey(msg.groupId)
          if (groupKey) {
            try {
              content = await decryptWithGroupKey(groupKey, content)
            } catch {
              // 群密钥不匹配，清除缓存，下次收消息时重新从服务器拉取
              invalidateGroupKey(msg.groupId)
            }
          }
        } catch { }
      }

      const localMsg: Message = {
        id: msg.messageId ?? `${Date.now()}_${Math.random()}`,
        conversationId: convId,
        conversationType: isGroup ? 'group' : 'private',
        fromUsername: msg.fromUsername!,
        fromNickname: msg.fromNickname ?? null,
        fromAvatar: msg.fromAvatar ?? null,
        toUsername: msg.toUsername,
        toGroupName: msg.toGroupName,
        contentType: msg.contentType ?? 'text',
        content,
        filename: msg.filename,
        fileSize: msg.fileSize,
        status: 'delivered',
        timestamp: msg.timestamp ?? Date.now(),
        createdAt: Date.now(),
      }
      addMessage(localMsg)

      const existingConv = useChatStore.getState().conversations.find(c => c.id === convId)
      upsertConversation({
        id: convId,
        type: isGroup ? 'group' : 'private',
        targetUsername: isGroup ? msg.toGroupName! : msg.fromUsername!,
        targetNickname: isGroup ? null : (msg.fromNickname ?? null),
        targetAvatar: isGroup ? (existingConv?.targetAvatar ?? null) : (msg.fromAvatar ?? null),
        groupId: isGroup ? (msg.groupId ?? existingConv?.groupId) : undefined,
        lastMessage: msg.contentType === 'text' ? content : `[${msg.contentType}]`,
        lastMessageTime: msg.timestamp ?? Date.now(),
        lastMessageStatus: 'received',
        lastMessageMine: false,
        unreadCount: (existingConv?.unreadCount ?? 0) + 1,
        updatedAt: Date.now(),
      })

      // 系统推送通知（页面不可见时）
      if (document.visibilityState !== 'visible' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const name = msg.fromNickname || msg.fromUsername || '新消息'
        const body = msg.contentType === 'text' ? content.slice(0, 60) : `[${msg.contentType}]`
        new Notification(name, { body, icon: '/icon-192.png' })
      }
    }

    if (msg.type === 'CHAT_DELIVERY' && msg.messageId) {
      const state = useChatStore.getState()
      // status='offline' 表示对方不在线，消息实际未送达
      const finalStatus = msg.status === 'offline' ? 'failed' : 'sent'
      for (const [convId, msgs] of Object.entries(state.messages)) {
        const found = msgs.find(m => m.id === msg.messageId)
        if (found) {
          updateMessageStatus(msg.messageId, convId, finalStatus)
          break
        }
      }
    }

    // 对方打开聊天页面 → 消息变为 delivered（✓✓）
    if (msg.type === 'MESSAGE_READ' && msg.messageId) {
      const state = useChatStore.getState()
      for (const [convId, msgs] of Object.entries(state.messages)) {
        const found = msgs.find(m => m.id === msg.messageId)
        if (found && (found.status === 'sent' || found.status === 'sending')) {
          updateMessageStatus(msg.messageId, convId, 'delivered')
          break
        }
      }
    }

    if (msg.type === 'GROUP_KEY_ROTATE' && msg.groupId) {
      const groupId = msg.groupId
      invalidateGroupKey(groupId)
      try {
        const currentUser = useAuthStore.getState().user!
        const groupRes = await groupApi.get(groupId)
        if (!groupRes.success) return
        const group = groupRes.data
        if (group.owner.username !== currentUser.username) return
        const myPrivKey = await getPrivateKey(currentUser.username)
        if (!myPrivKey) return
        const newGroupKey = await generateGroupKey()
        for (const member of group.members) {
          try {
            const memberPubKey = await getPublicKey(member.username)
            if (!memberPubKey) continue
            const wrapped = await wrapGroupKey(newGroupKey, memberPubKey, myPrivKey)
            await groupApi.uploadGroupKey(groupId, member.username, wrapped, currentUser.username)
          } catch { }
        }
        setGroupKey(groupId, newGroupKey)
      } catch { }
    }

    if (msg.type === 'GROUP_DISSOLVED' && msg.groupId) {
      // 群主解散了群组，把本地该群的会话从列表移除
      const convId = getGroupConvId(msg.toGroupName ?? String(msg.groupId))
      invalidateGroupKey(msg.groupId)
      useChatStore.getState().clearConversation(convId)
    }

    // ===== 在线状态实时推送 =====
    if (msg.type === 'USER_ONLINE' && msg.fromUsername) {
      window.dispatchEvent(new CustomEvent('user-online', { detail: { username: msg.fromUsername } }))
    }
    if (msg.type === 'USER_OFFLINE' && msg.fromUsername) {
      window.dispatchEvent(new CustomEvent('user-offline', { detail: { username: msg.fromUsername } }))
    }

    // ===== 分片 ACK（发送方收到，驱动下一片） =====
    if (msg.type === 'FILE_CHUNK_ACK' && msg.transferId != null && msg.chunkIndex != null) {
      const key = `${msg.transferId}_${msg.chunkIndex}`
      ackWaiters.get(key)?.(true)
    }

    // ===== 接收方：收到分片传输开始，弹接受/拒绝请求 =====
    if (msg.type === 'FILE_TRANSFER_START' && msg.transferId) {
      const totalChunks = msg.totalChunks ?? 0
      pendingTransfers.set(msg.transferId, {
        messageId: msg.messageId ?? msg.transferId,
        fromUsername: msg.fromUsername ?? '',
        fromNickname: msg.fromNickname ?? null,
        fromAvatar: msg.fromAvatar ?? null,
        filename: msg.filename,
        fileSize: msg.fileSize,
        contentType: msg.contentType ?? 'file',
        totalChunks,
        received: 0,
        startedAt: 0,
      })
      window.dispatchEvent(new CustomEvent('file-receive-request', {
        detail: {
          transferId: msg.transferId,
          filename: msg.filename,
          fileSize: msg.fileSize,
          totalChunks,
          fromUsername: msg.fromUsername ?? '',
          fromNickname: msg.fromNickname ?? msg.fromUsername ?? '',
        },
      }))
    }

    // ===== 接收方：收到一个分片，解密后立即写盘 =====
    if (msg.type === 'FILE_CHUNK' && msg.transferId && msg.chunkIndex != null && msg.fileData) {
      const state = incomingTransfers.get(msg.transferId)
      if (!state) return
      if (state.received === 0) state.startedAt = Date.now()

      const currentUser = useAuthStore.getState().user!
      const myPrivKey = await getPrivateKey(currentUser.username)
      const senderPubKey = await getPublicKey(state.fromUsername)

      try {
        if (!myPrivKey || !senderPubKey) {
          await state.writable.abort()
          incomingTransfers.delete(msg.transferId)
          sendWsMessage({ type: 'FILE_TRANSFER_ERROR', transferId: msg.transferId })
          window.dispatchEvent(new CustomEvent('file-receive-done', { detail: { transferId: msg.transferId, filename: state.filename } }))
          return
        }

        const b64 = await decryptMessage(myPrivKey, senderPubKey, msg.fileData)
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        await state.writable.write(bytes)
        state.received++

        // 通知发送方本片已写盘，驱动其发下一片
        sendWsMessage({
          type: 'FILE_CHUNK_ACK',
          transferId: msg.transferId,
          chunkIndex: msg.chunkIndex,
        })

        window.dispatchEvent(new CustomEvent('file-receive-progress', {
          detail: {
            transferId: msg.transferId,
            received: state.received,
            totalChunks: state.totalChunks,
            startedAt: state.startedAt,
          },
        }))

        // 所有分片写盘完毕
        if (state.received === state.totalChunks) {
          await state.writable.close()
          incomingTransfers.delete(msg.transferId)

          const convId = getPrivateConvId(currentUser.username, state.fromUsername)
          const localMsg: Message = {
            id: state.messageId,
            conversationId: convId,
            conversationType: 'private',
            fromUsername: state.fromUsername,
            fromNickname: state.fromNickname,
            fromAvatar: state.fromAvatar,
            toUsername: currentUser.username,
            contentType: state.contentType === 'image' ? 'image' : 'file',
            content: '[已保存到本地]',
            filename: state.filename,
            fileSize: state.fileSize,
            status: 'delivered',
            timestamp: Date.now(),
            createdAt: Date.now(),
          }
          addMessage(localMsg)

          const existingConv = useChatStore.getState().conversations.find(c => c.id === convId)
          upsertConversation({
            id: convId,
            type: 'private',
            targetUsername: state.fromUsername,
            targetNickname: state.fromNickname,
            targetAvatar: state.fromAvatar,
            lastMessage: `[${state.contentType === 'image' ? '图片' : '文件'}] ${state.filename ?? ''}`,
            lastMessageTime: Date.now(),
            unreadCount: (existingConv?.unreadCount ?? 0) + 1,
            updatedAt: Date.now(),
          })

          window.dispatchEvent(new CustomEvent('file-receive-done', {
            detail: { transferId: msg.transferId, filename: state.filename },
          }))
        }
      } catch {
        try { await state.writable.abort() } catch { }
        incomingTransfers.delete(msg.transferId)
        sendWsMessage({ type: 'FILE_TRANSFER_ERROR', transferId: msg.transferId })
        window.dispatchEvent(new CustomEvent('file-receive-done', { detail: { transferId: msg.transferId, filename: state.filename } }))
      }
    }

    // ===== 接收方：传输中断 =====
    if (msg.type === 'FILE_TRANSFER_ERROR' && msg.transferId) {
      // 清理 pending（用户尚未接受时发送方中断）
      pendingTransfers.delete(msg.transferId)
      // 清理 incoming（传输中途中断）
      const state = incomingTransfers.get(msg.transferId)
      if (state) {
        try { await state.writable.abort() } catch { }
        incomingTransfers.delete(msg.transferId)
      }
      window.dispatchEvent(new CustomEvent('file-receive-done', {
        detail: { transferId: msg.transferId },
      }))
      // 立即以 false 解除所有属于此 transferId 的 ACK 等待，让发送方立即感知失败
      const prefix = msg.transferId + '_'
      for (const key of Array.from(ackWaiters.keys())) {
        if (key.startsWith(prefix)) {
          ackWaiters.get(key)?.(false)
          ackWaiters.delete(key)
        }
      }
      if (msg.content) {
        window.dispatchEvent(new CustomEvent('file-transfer-error', { detail: { transferId: msg.transferId, message: msg.content } }))
      }
    }
  }, [addMessage, updateMessageStatus, upsertConversation])

  const send = useCallback((msg: WsMessage) => {
    if (wsInstance?.readyState === WebSocket.OPEN) {
      wsInstance.send(JSON.stringify(msg))
    }
  }, [])

  const disconnect = useCallback(() => {
    manualClose = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (pingTimer) clearInterval(pingTimer)
    wsInstance?.close()
    wsInstance = null
  }, [])

  useEffect(() => {
    // 不再自动 connect，由 MainLayout 在 initSession 完成后显式调用
    return () => { }
  }, [accessToken])

  return { send, connect, disconnect, isConnected: () => connectedRef.current }
}

export function sendWsMessage(msg: WsMessage): boolean {
  if (wsInstance?.readyState === WebSocket.OPEN) {
    wsInstance.send(JSON.stringify(msg))
    return true
  }
  return false
}

// 等待指定传输的指定分片 ACK，超时返回 false
export function waitForChunkAck(transferId: string, chunkIndex: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const key = `${transferId}_${chunkIndex}`
    const timer = setTimeout(() => {
      ackWaiters.delete(key)
      resolve(false)
    }, timeoutMs)
    ackWaiters.set(key, (ok: boolean) => {
      clearTimeout(timer)
      ackWaiters.delete(key)
      resolve(ok)
    })
  })
}

// 用户点"接受"后由 UI 层调用（在 showSaveFilePicker 成功后）
export function acceptTransfer(transferId: string, writable: FileSystemWritableFileStream): void {
  const meta = pendingTransfers.get(transferId)
  if (!meta) return
  pendingTransfers.delete(transferId)
  incomingTransfers.set(transferId, { ...meta, writable })
  // 发 -1 ACK，通知发送方开始发分片
  sendWsMessage({ type: 'FILE_CHUNK_ACK', transferId, chunkIndex: -1 })
  window.dispatchEvent(new CustomEvent('file-receive-start', {
    detail: {
      transferId,
      filename: meta.filename,
      fileSize: meta.fileSize,
      totalChunks: meta.totalChunks,
      fromNickname: meta.fromNickname ?? meta.fromUsername,
    },
  }))
}

// 用户点"拒绝"（或 showSaveFilePicker 被取消）后由 UI 层调用
export function rejectTransfer(transferId: string): void {
  pendingTransfers.delete(transferId)
  sendWsMessage({ type: 'FILE_TRANSFER_ERROR', transferId })
}