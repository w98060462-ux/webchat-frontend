import { userApi } from '../api'
import type { User } from '../types'

// 内存公钥缓存：username → JWK（null 表示已查询但对方无公钥）
const cache = new Map<string, JsonWebKey | null>()
// in-flight 去重：同一 username 并发请求只发一次 HTTP
const inflight = new Map<string, Promise<JsonWebKey | null>>()

export async function getPublicKey(username: string): Promise<JsonWebKey | null> {
  if (cache.has(username)) return cache.get(username)!
  if (inflight.has(username)) return inflight.get(username)!
  const req = (async () => {
    try {
      const res = await userApi.getUserByUsername(username)
      if (res.success && res.data.publicKey) {
        const jwk = JSON.parse(res.data.publicKey) as JsonWebKey
        cache.set(username, jwk)
        return jwk
      }
      return null
    } catch {
      return null
    } finally {
      inflight.delete(username)
    }
  })()
  inflight.set(username, req)
  return req
}

// 批量写入（在线用户列表加载后调用）
export function setPublicKeys(users: User[]): void {
  for (const u of users) {
    if (u.publicKey) {
      try {
        cache.set(u.username, JSON.parse(u.publicKey) as JsonWebKey)
      } catch { }
    }
    // 无公钥时不写 null，保留下次重试的机会
  }
}

export function invalidatePublicKey(username: string): void {
  cache.delete(username)
}

export function clearPublicKeyCache(): void {
  cache.clear()
}
