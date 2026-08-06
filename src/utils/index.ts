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

export function getConvId(type: 'private' | 'group', myId: number, targetId: number): string {
  if (type === 'group') return `group_${targetId}`
  return `private_${Math.min(myId, targetId)}_${Math.max(myId, targetId)}`
}

export function getApiError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { data?: { message?: string } } }).response
    return r?.data?.message ?? '操作失败'
  }
  return '网络错误'
}