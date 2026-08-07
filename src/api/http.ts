import axios from 'axios'
import { useAuthStore } from '../store/authStore'
import { loadCredentials, clearCredentials } from '../utils'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

export const http = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,  // 60s：覆盖服务器冷启动场景（Render 免费套餐约 30~60s）
})

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let refreshPromise: Promise<string | null> | null = null

// 用本地存储的凭据重新登录，成功后更新 store 并返回新 accessToken
// 失败则清除认证状态并跳转登录页
export async function reLoginWithCredentials(): Promise<string | null> {
  const creds = loadCredentials()
  if (!creds) {
    useAuthStore.getState().clearAuth()
    clearCredentials()
    window.location.href = '/login'
    return null
  }
  try {
    const r = await axios.post(`${BASE_URL}/api/auth/login`, {
      login: creds.username,
      password: creds.password,
    })
    if (r.data?.success) {
      const { accessToken, refreshToken: newRefresh, user } = r.data.data
      useAuthStore.getState().setAuth(accessToken, newRefresh, user)
      return accessToken
    }
  } catch { }
  useAuthStore.getState().clearAuth()
  clearCredentials()
  window.location.href = '/login'
  return null
}

// 判断是否为网络层错误（服务器未响应，区别于服务器返回的 4xx/5xx）
function isNetworkError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response
}

http.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config

    // 网络层错误（超时/连接拒绝）自动重试一次，覆盖服务器冷启动场景
    // _wakeRetry 标记防止无限重试
    if (isNetworkError(err) && !original._wakeRetry) {
      original._wakeRetry = true
      try {
        return await http(original)
      } catch (retryErr) {
        return Promise.reject(retryErr)
      }
    }

    if (err.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        const refreshToken = useAuthStore.getState().refreshToken

        // 第一步：尝试用 refreshToken 续期
        if (refreshToken) {
          if (!refreshPromise) {
            refreshPromise = axios
              .post(`${BASE_URL}/api/auth/refresh`, { refreshToken })
              .then((r) => {
                const { accessToken, refreshToken: newRefresh, user } = r.data.data
                useAuthStore.getState().setAuth(accessToken, newRefresh, user)
                return accessToken as string
              })
              .catch(async () => {
                // refreshToken 失效，降级用本地凭据重新登录
                refreshPromise = null
                return await reLoginWithCredentials()
              })
              .finally(() => { refreshPromise = null })
          }
          const newAccessToken = await refreshPromise
          if (!newAccessToken) return Promise.reject(err)
          original.headers.Authorization = `Bearer ${newAccessToken}`
          return http(original)
        }

        // 第二步：没有 refreshToken，直接用本地凭据重新登录
        const newAccessToken = await reLoginWithCredentials()
        if (!newAccessToken) return Promise.reject(err)
        original.headers.Authorization = `Bearer ${newAccessToken}`
        return http(original)
      } catch {
        refreshPromise = null
        useAuthStore.getState().clearAuth()
        clearCredentials()
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default http
