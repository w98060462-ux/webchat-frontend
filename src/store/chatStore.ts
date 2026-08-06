import { create } from 'zustand'
import type { Conversation, Message } from '../types'
import { db } from '../db'

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Record<string, Message[]>
  setConversations: (convs: Conversation[]) => void
  setActiveConversation: (id: string | null) => void
  addMessage: (msg: Message) => void
  updateMessageStatus: (msgId: string, convId: string, status: Message['status']) => void
  deleteMessage: (msgId: string, convId: string) => void
  loadMessages: (conversationId: string) => Promise<void>
  loadConversations: () => Promise<void>
  upsertConversation: (conv: Conversation) => void
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},

  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (id) => set({ activeConversationId: id }),

  addMessage: (msg) => {
    set((state) => {
      const existing = state.messages[msg.conversationId] ?? []
      return {
        messages: {
          ...state.messages,
          [msg.conversationId]: [...existing, msg],
        },
      }
    })
    db.saveMessage(msg)
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
    set((state) => ({
      messages: { ...state.messages, [conversationId]: msgs },
    }))
  },

  loadConversations: async () => {
    const convs = await db.getConversations()
    set({ conversations: convs })
  },

  upsertConversation: (conv) => {
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.id === conv.id)
      const next = [...state.conversations]
      if (idx >= 0) next[idx] = conv
      else next.unshift(conv)
      next.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      db.saveConversation(conv)
      return { conversations: next }
    })
  },
}))