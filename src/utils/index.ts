export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`
}

// 会话 ID 全部基于 username，不再用数字 ID
export function getPrivateConvId(myUsername: string, targetUsername: string): string {
  const [a, b] = [myUsername, targetUsername].sort()
  return `private_${a}_${b}`
}

export function getGroupConvId(groupName: string): string {
  return `group_${groupName}`
}

export function getApiError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { data?: { message?: string } } }).response
    return r?.data?.message ?? '操作失败'
  }
  return '网络错误'
}

// 凭据简单混淆存储（非真正加密，仅防止明文暴露在 localStorage）
export function saveCredentials(username: string, password: string) {
  const raw = JSON.stringify({ username, password })
  localStorage.setItem('webchat-creds', btoa(encodeURIComponent(raw)))
}

export function loadCredentials(): { username: string; password: string } | null {
  try {
    const stored = localStorage.getItem('webchat-creds')
    if (!stored) return null
    const raw = decodeURIComponent(atob(stored))
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function clearCredentials() {
  localStorage.removeItem('webchat-creds')
}