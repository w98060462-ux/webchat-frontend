import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

export const http = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
})

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Shared promise to prevent parallel refresh calls (race condition guard)
let refreshPromise: Promise<string> | null = null

http.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        const refreshToken = useAuthStore.getState().refreshToken
        if (!refreshToken) throw new Error('no refresh token')

        // Deduplicate: if a refresh is already in-flight, wait for it
        if (!refreshPromise) {
          refreshPromise = axios
            .post(`${BASE_URL}/api/auth/refresh`, { refreshToken })
            .then((r) => {
              const { accessToken, refreshToken: newRefresh, user } = r.data.data
              useAuthStore.getState().setAuth(accessToken, newRefresh, user)
              return accessToken
            })
            .finally(() => {
              refreshPromise = null
            })
        }

        const newAccessToken = await refreshPromise
        original.headers.Authorization = `Bearer ${newAccessToken}`
        return http(original)
      } catch {
        refreshPromise = null
        useAuthStore.getState().clearAuth()
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default http