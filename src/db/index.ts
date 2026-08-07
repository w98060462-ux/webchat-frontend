import { openDB, type IDBPDatabase } from 'idb'
import type { Message, Conversation } from '../types'

const DB_NAME = 'webchat'
const DB_VERSION = 3  // v3: 新增 keyPairs store 用于 E2E 加密密钥

interface KeyPairRecord {
  username: string
  privateKey: CryptoKey
  publicKeyJwk: JsonWebKey
  createdAt: number
}

let dbInstance: IDBPDatabase | null = null

async function getDb() {
  if (dbInstance) return dbInstance
  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 2) {
        if (database.objectStoreNames.contains('messages')) database.deleteObjectStore('messages')
        if (database.objectStoreNames.contains('conversations')) database.deleteObjectStore('conversations')
      }
      if (!database.objectStoreNames.contains('messages')) {
        const msgStore = database.createObjectStore('messages', { keyPath: 'id' })
        msgStore.createIndex('conversationId', 'conversationId')
        msgStore.createIndex('timestamp', 'timestamp')
      }
      if (!database.objectStoreNames.contains('conversations')) {
        const convStore = database.createObjectStore('conversations', { keyPath: 'id' })
        convStore.createIndex('updatedAt', 'updatedAt')
      }
      if (oldVersion < 3) {
        if (!database.objectStoreNames.contains('keyPairs')) {
          database.createObjectStore('keyPairs', { keyPath: 'username' })
        }
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

  async deleteConversation(convId: string) {
    const d = await getDb()
    await d.delete('conversations', convId)
  },

  async deleteMessagesByConversation(convId: string) {
    const d = await getDb()
    const tx = d.transaction('messages', 'readwrite')
    const keys = await tx.store.index('conversationId').getAllKeys(convId)
    await Promise.all(keys.map(k => tx.store.delete(k)))
    await tx.done
  },

  async saveKeyPair(record: KeyPairRecord) {
    const d = await getDb()
    await d.put('keyPairs', record)
  },

  async getKeyPair(username: string): Promise<KeyPairRecord | undefined> {
    const d = await getDb()
    return d.get('keyPairs', username)
  },
}