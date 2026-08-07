import { db } from '../db'
import { userApi } from '../api'
import { generateKeyPair } from './e2e'

// 确保当前用户有密钥对，并且服务器上有对应公钥
// 每次进入 app 时调用：有密钥则补传公钥（幂等），没有则生成后上传
export async function ensureKeyPair(username: string): Promise<void> {
  const existing = await db.getKeyPair(username)
  if (existing) {
    await userApi.uploadPublicKey(JSON.stringify(existing.publicKeyJwk))
    return
  }
  const { privateKey, publicKeyJwk } = await generateKeyPair()
  await db.saveKeyPair({ username, privateKey, publicKeyJwk, createdAt: Date.now() })
  await userApi.uploadPublicKey(JSON.stringify(publicKeyJwk))
}

export async function getPrivateKey(username: string): Promise<CryptoKey | null> {
  const record = await db.getKeyPair(username)
  return record?.privateKey ?? null
}

export async function getOwnPublicKeyJwk(username: string): Promise<JsonWebKey | null> {
  const record = await db.getKeyPair(username)
  return record?.publicKeyJwk ?? null
}
