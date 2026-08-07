import { groupApi } from '../api'
import { getPrivateKey } from './keyStore'
import { getPublicKey } from './publicKeyCache'
import { unwrapGroupKey } from './e2e'
import { useAuthStore } from '../store/authStore'

// 内存缓存：groupId → 解密后的 CryptoKey
const cache = new Map<number, CryptoKey>()

// 获取群密钥（先查内存，未命中则从服务器拉取并解密）
export async function getGroupKey(groupId: number): Promise<CryptoKey | null> {
  if (cache.has(groupId)) return cache.get(groupId)!
  const username = useAuthStore.getState().user?.username
  if (!username) return null
  try {
    const res = await groupApi.getMyGroupKey(groupId)
    if (!res.success || !res.data) return null

    // 服务器返回格式：encryptedKey|wrappedBy
    const pipeIdx = res.data.lastIndexOf('|')
    if (pipeIdx < 0) return null
    const encryptedKey = res.data.slice(0, pipeIdx)
    const wrappedBy = res.data.slice(pipeIdx + 1)

    const myPrivKey = await getPrivateKey(username)
    const wrapperPubKey = await getPublicKey(wrappedBy)
    if (!myPrivKey || !wrapperPubKey) return null

    const groupKey = await unwrapGroupKey(encryptedKey, wrapperPubKey, myPrivKey)
    cache.set(groupId, groupKey)
    return groupKey
  } catch {
    return null
  }
}

export function setGroupKey(groupId: number, key: CryptoKey): void {
  cache.set(groupId, key)
}

export function invalidateGroupKey(groupId: number): void {
  cache.delete(groupId)
}

export function clearGroupKeyCache(): void {
  cache.clear()
}
