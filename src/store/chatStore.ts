import { create } from 'zustand'
import type { Conversation, Message } from '../types'
import { db } from '../db'

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Record<string, Message[]>
  setConversations: (convs: Conversation[]) => void
  setActiveConversation: (id: string | null) => void
  resetAll: () => void
  addMessage: (msg: Message) => void
  updateMessageStatus: (msgId: string, convId: string, status: Message['status']) => void
  deleteMessage: (msgId: string, convId: string) => void
  loadMessages: (conversationId: string) => Promise<void>
  loadConversations: () => Promise<void>
  upsertConversation: (conv: Conversation) => void
  removeConversation: (convId: string) => void
  clearConversation: (convId: string) => void
  clearUnread: (convId: string) => void
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},

  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (id) => set({ activeConversationId: id }),

  resetAll: () => set({ conversations: [], messages: {}, activeConversationId: null }),

  addMessage: (msg) => {
    set((state) => {
      const existing = state.messages[msg.conversationId] ?? []
      if (existing.some(m => m.id === msg.id)) return {}
      return {
        messages: {
          ...state.messages,
          [msg.conversationId]: [...existing, msg],
        },
      }
    })
    // Blob URL 是内存临时引用，刷新后失效，不存入 IndexedDB
    const toStore = (msg.contentType === 'image' || msg.contentType === 'file') && msg.content.startsWith('blob:')
      ? { ...msg, content: '' }
      : msg
    db.saveMessage(toStore)
  },

  updateMessageStatus: (msgId, convId, status) => {
    set((state) => {
      const msgs = state.messages[convId] ?? []
      return {
        messages: {
          ...state.messages,
          [convId]: msgs.map((m) => (m.id === msgId ? { ...m, status } : m)),
        },
      }
    })
    db.updateMessageStatus(msgId, status)
  },

  deleteMessage: (msgId, convId) => {
    set((state) => {
      const msgs = state.messages[convId] ?? []
      return {
        messages: {
          ...state.messages,
          [convId]: msgs.filter((m) => m.id !== msgId),
        },
      }
    })
    db.deleteMessage(msgId)
  },

  loadMessages: async (conversationId) => {
    const msgs = await db.getMessages(conversationId)
    set((state) => {
      const inMemory = state.messages[conversationId] ?? []
      const dbIds = new Set(msgs.map(m => m.id))
      // 保留内存里有但 DB 里没有的消息（WS 刚推来未持久化的）
      const memoryOnly = inMemory.filter(m => !dbIds.has(m.id))
      const merged = [...msgs, ...memoryOnly].sort((a, b) => a.timestamp - b.timestamp)
      return { messages: { ...state.messages, [conversationId]: merged } }
    })
  },

  loadConversations: async () => {
    const convs = await db.getConversations()
    set((state) => {
      const dbIds = new Set(convs.map(c => c.id))
      // 保留内存里有但 DB 里没有的会话（WS 刚推来尚未持久化的）
      const memoryOnly = state.conversations.filter(c => !dbIds.has(c.id))
      const merged = [...convs, ...memoryOnly].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      return { conversations: merged }
    })
  },

  upsertConversation: (conv) => {
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.id === conv.id)
      const next = [...state.conversations]
      let merged: Conversation
      if (idx >= 0) {
        const old = next[idx]
        merged = {
          ...old,
          ...conv,
          targetNickname: conv.targetNickname ?? old.targetNickname,
          targetAvatar: conv.targetAvatar ?? old.targetAvatar,
          groupId: conv.groupId ?? old.groupId,
          lastMessage: conv.lastMessage ?? old.lastMessage,
          lastMessageTime: conv.lastMessageTime ?? old.lastMessageTime,
        }
        next[idx] = merged
      } else {
        merged = conv
        next.unshift(merged)
      }
      next.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      db.saveConversation(merged)
      return { conversations: next }
    })
  },

  clearUnread: (convId) => {
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.id === convId)
      if (idx < 0) return {}
      const next = [...state.conversations]
      next[idx] = { ...next[idx], unreadCount: 0 }
      db.saveConversation(next[idx])
      return { conversations: next }
    })
  },

  removeConversation: (convId) => {
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== convId),
    }))
    db.deleteConversation(convId)
  },

  clearConversation: (convId) => {
    set((state) => {
      const msgs = { ...state.messages }
      delete msgs[convId]
      return {
        conversations: state.conversations.filter((c) => c.id !== convId),
        messages: msgs,
      }
    })
    db.deleteConversation(convId)
    db.deleteMessagesByConversation(convId)
  },
}))