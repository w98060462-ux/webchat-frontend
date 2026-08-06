import { openDB, type IDBPDatabase } from 'idb'
import type { Message, Conversation } from '../types'

const DB_NAME = 'webchat'
const DB_VERSION = 1

let dbInstance: IDBPDatabase | null = null

async function getDb() {
  if (dbInstance) return dbInstance
  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('messages')) {
        const msgStore = database.createObjectStore('messages', { keyPath: 'id' })
        msgStore.createIndex('conversationId', 'conversationId')
        msgStore.createIndex('timestamp', 'timestamp')
      }
      if (!database.objectStoreNames.contains('conversations')) {
        const convStore = database.createObjectStore('conversations', { keyPath: 'id' })
        convStore.createIndex('updatedAt', 'updatedAt')
      }
    },
  })
  return dbInstance
}

export const db = {
  async saveMessage(msg: Message) {
    const d = await getDb()
    await d.put('messages', msg)
  },

  async getMessages(conversationId: string, limit = 100): Promise<Message[]> {
    const d = await getDb()
    const all = await d.getAllFromIndex('messages', 'conversationId', conversationId)
    return all.sort((a, b) => a.timestamp - b.timestamp).slice(-limit)
  },

  async updateMessageStatus(msgId: string, status: Message['status']) {
    const d = await getDb()
    const msg = await d.get('messages', msgId)
    if (msg) {
      msg.status = status
      await d.put('messages', msg)
    }
  },

  async saveConversation(conv: Conversation) {
    const d = await getDb()
    await d.put('conversations', conv)
  },

  async getConversations(): Promise<Conversation[]> {
    const d = await getDb()
    const all = await d.getAll('conversations')
    return all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  },

  async deleteMessage(msgId: string) {
    const d = await getDb()
    await d.delete('messages', msgId)
  },
}