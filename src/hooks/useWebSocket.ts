import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { authApi } from '../api'
import type { WsMessage, Message, Conversation } from '../types'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'
const PING_INTERVAL = 30000
const RECONNECT_DELAY = 3000

let wsInstance: WebSocket | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let manualClose = false

export function useWebSocket() {
  const { accessToken, user } = useAuthStore()
  const { addMessage, updateMessageStatus, upsertConversation } = useChatStore()
  const connectedRef = useRef(false)

  const connect = useCallback(async () => {
    // Always read the freshest token from the store
    let token = useAuthStore.getState().accessToken
    const currentUser = useAuthStore.getState().user
    if (!token || !currentUser) return
    if (wsInstance?.readyState === WebSocket.OPEN) return

    // If token looks expired (JWT exp check via payload), refresh first
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      const expMs = payload.exp * 1000
      if (expMs - Date.now() < 60_000) {
        // Token expires within 60 s — refresh before connecting
        const refreshToken = useAuthStore.getState().refreshToken
        if (refreshToken) {
          try {
            const res = await authApi.refresh(refreshToken)
            if (res.success) {
              useAuthStore.getState().setAuth(res.data.accessToken, res.data.refreshToken, res.data.user)
              token = res.data.accessToken
            } else {
              useAuthStore.getState().clearAuth()
              return
            }
          } catch {
            useAuthStore.getState().clearAuth()
            return
          }
        }
      }
    } catch {
      // If token parsing fails, proceed with the existing token
    }

    manualClose = false
    wsInstance = new WebSocket(`${WS_URL}/ws/chat?token=${token}`)

    wsInstance.onopen = () => {
      connectedRef.current = true
      pingTimer = setInterval(() => {
        send({ type: 'PING' })
      }, PING_INTERVAL)
    }

    wsInstance.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        handleIncoming(msg)
      } catch { /* ignore */ }
    }

    wsInstance.onclose = () => {
      connectedRef.current = false
      if (pingTimer) clearInterval(pingTimer)
      if (!manualClose) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY)
      }
    }

    wsInstance.onerror = () => {
      wsInstance?.close()
    }
  }, [accessToken, user])

  const handleIncoming = useCallback((msg: WsMessage) => {
    if (msg.type === 'NEW_MESSAGE') {
      const currentUser = useAuthStore.getState().user!
      const isGroup = !!msg.toGroupId
      const convId = isGroup
        ? `group_${msg.toGroupId}`
        : `private_${Math.min(msg.fromUserId!, currentUser.id)}_${Math.max(msg.fromUserId!, currentUser.id)}`

      const localMsg: Message = {
        id: msg.messageId ?? `${Date.now()}_${Math.random()}`,
        conversationId: convId,
        conversationType: isGroup ? 'group' : 'private',
        fromUserId: msg.fromUserId!,
        fromUsername: msg.fromUsername ?? '',
        fromNickname: msg.fromNickname ?? null,
        fromAvatar: msg.fromAvatar ?? null,
        toUserId: msg.toUserId,
        toGroupId: msg.toGroupId,
        contentType: msg.contentType ?? 'text',
        content: msg.content ?? '',
        filename: msg.filename,
        fileSize: msg.fileSize,
        status: 'delivered',
        timestamp: msg.timestamp ?? Date.now(),
        createdAt: Date.now(),
      }
      addMessage(localMsg)

      // For group messages: preserve existing targetName from store if already known
      const existingConv = useChatStore.getState().conversations.find(c => c.id === convId)
      const conv: Conversation = {
        id: convId,
        type: isGroup ? 'group' : 'private',
        targetId: isGroup ? msg.toGroupId! : msg.fromUserId!,
        targetName: existingConv?.targetName
          ?? (isGroup ? `群组 ${msg.toGroupId}` : (msg.fromNickname || msg.fromUsername || '')),
        targetAvatar: isGroup ? (existingConv?.targetAvatar ?? null) : (msg.fromAvatar ?? null),
        lastMessage: msg.contentType === 'text' ? (msg.content ?? '') : `[${msg.contentType}]`,
        lastMessageTime: msg.timestamp ?? Date.now(),
        unreadCount: (existingConv?.unreadCount ?? 0) + 1,
        updatedAt: Date.now(),
      }
      upsertConversation(conv)
    }

    if (msg.type === 'CHAT_DELIVERY' && msg.messageId) {
      const state = useChatStore.getState()
      for (const [convId, msgs] of Object.entries(state.messages)) {
        const found = msgs.find(m => m.id === msg.messageId)
        if (found) {
          updateMessageStatus(msg.messageId, convId, 'delivered')
          break
        }
      }
    }

    if (msg.type === 'FRIEND_REQUEST' || msg.type === 'FRIEND_ACCEPTED') {
      // Optionally: could dispatch a toast/notification here
      // For now just log; the FriendPage will refresh on next visit
    }
  }, [user, addMessage, updateMessageStatus, upsertConversation])

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
    if (accessToken && user) connect()
    return () => { /* keep alive across re-renders */ }
  }, [accessToken, user, connect])

  return { send, connect, disconnect, isConnected: () => connectedRef.current }
}

export function sendWsMessage(msg: WsMessage) {
  if (wsInstance?.readyState === WebSocket.OPEN) {
    wsInstance.send(JSON.stringify(msg))
  }
}