import http from './http'
import type { ApiResponse, AuthResponse, User } from '../types'

export const authApi = {
  register: (data: { username: string; password: string; confirmPassword: string }) =>
    http.post<ApiResponse<AuthResponse>>('/api/auth/register', data).then(r => r.data),

  login: (data: { login: string; password: string; deviceName?: string; deviceId?: string }) =>
    http.post<ApiResponse<AuthResponse>>('/api/auth/login', data).then(r => r.data),

  refresh: (refreshToken: string) =>
    http.post<ApiResponse<AuthResponse>>('/api/auth/refresh', { refreshToken }).then(r => r.data),

  logout: (refreshToken: string) =>
    http.post<ApiResponse<void>>('/api/auth/logout', { refreshToken }).then(r => r.data),
}

export const userApi = {
  me: () =>
    http.get<ApiResponse<User>>('/api/users/me').then(r => r.data),

  search: (keyword: string) =>
    http.get<ApiResponse<User[]>>('/api/users/search', { params: { keyword } }).then(r => r.data),

  getUser: (id: number) =>
    http.get<ApiResponse<User>>(`/api/users/${id}`).then(r => r.data),

  updateProfile: (data: { nickname?: string; avatar?: string }) =>
    http.patch<ApiResponse<User>>('/api/users/me', data).then(r => r.data),
}

export const friendApi = {
  sendRequest: (toUserId: number) =>
    http.post<ApiResponse<void>>(`/api/friends/request/${toUserId}`).then(r => r.data),

  accept: (friendshipId: number) =>
    http.post<ApiResponse<void>>(`/api/friends/request/${friendshipId}/accept`).then(r => r.data),

  reject: (friendshipId: number) =>
    http.post<ApiResponse<void>>(`/api/friends/request/${friendshipId}/reject`).then(r => r.data),

  delete: (friendId: number) =>
    http.delete<ApiResponse<void>>(`/api/friends/${friendId}`).then(r => r.data),

  list: () =>
    http.get<ApiResponse<import('../types').FriendItem[]>>('/api/friends').then(r => r.data),

  requests: () =>
    http.get<ApiResponse<import('../types').FriendItem[]>>('/api/friends/requests').then(r => r.data),
}

export const groupApi = {
  create: (name: string) =>
    http.post<ApiResponse<import('../types').Group>>('/api/groups', { name }).then(r => r.data),

  list: () =>
    http.get<ApiResponse<import('../types').Group[]>>('/api/groups').then(r => r.data),

  get: (groupId: number) =>
    http.get<ApiResponse<import('../types').Group>>(`/api/groups/${groupId}`).then(r => r.data),

  invite: (groupId: number, userId: number) =>
    http.post<ApiResponse<import('../types').Group>>(`/api/groups/${groupId}/members/${userId}`).then(r => r.data),

  leave: (groupId: number) =>
    http.delete<ApiResponse<void>>(`/api/groups/${groupId}/members/me`).then(r => r.data),
}

export const uploadApi = {
  image: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http.post<ApiResponse<import('../types').UploadResponse>>('/api/upload/image', form).then(r => r.data)
  },

  file: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http.post<ApiResponse<import('../types').UploadResponse>>('/api/upload/file', form).then(r => r.data)
  },
}