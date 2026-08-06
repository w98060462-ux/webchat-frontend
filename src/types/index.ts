// 服务端数据类型
export interface User {
  id: number
  uid: string
  username: string
  nickname: string | null
  avatar: string | null
  createdAt: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: User
}

export interface FriendItem {
  friendshipId: number
  user: User
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  createdAt: string
}

export interface GroupMember {
  id: number
  uid: string
  username: string
  nickname: string | null
  avatar: string | null
}

export interface Group {
  id: number
  name: string
  avatar: string | null
  owner: User
  members: GroupMember[]
  memberCount: number
  createdAt: string
}

export interface UploadResponse {
  url: string
  filename: string
  originalName: string
  size: number
  mimeType: string
}

export interface ApiResponse<T> {
  success: boolean
  message: string | null
  data: T
}

// 本地消息类型（存在 IndexedDB）
export type MessageContentType = 'text' | 'image' | 'file'
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed'
export type ConversationType = 'private' | 'group'

export interface Message {
  id: string            // 客户端生成 UUID
  conversationId: string
  conversationType: ConversationType
  fromUserId: number
  fromUsername: string
  fromNickname: string | null
  fromAvatar: string | null
  toUserId?: number
  toGroupId?: number
  contentType: MessageContentType
  content: string
  filename?: string
  fileSize?: number
  status: MessageStatus
  timestamp: number
  createdAt: number     // 本地入库时间
}

export interface Conversation {
  id: string
  type: ConversationType
  targetId: number      // userId 或 groupId
  targetName: string
  targetAvatar: string | null
  lastMessage: string | null
  lastMessageTime: number | null
  unreadCount: number
  updatedAt: number
}

// WebSocket 消息类型
export type WsMessageType =
  | 'CHAT' | 'GROUP_CHAT' | 'PING'
  | 'CHAT_DELIVERY' | 'NEW_MESSAGE' | 'PONG' | 'ERROR'
  | 'FRIEND_REQUEST' | 'FRIEND_ACCEPTED'
  | 'USER_ONLINE' | 'USER_OFFLINE'

export interface WsMessage {
  type: WsMessageType
  messageId?: string
  toUserId?: number
  toGroupId?: number
  contentType?: MessageContentType
  content?: string
  filename?: string
  fileSize?: number
  fromUserId?: number
  fromUsername?: string
  fromNickname?: string
  fromAvatar?: string
  timestamp?: number
}