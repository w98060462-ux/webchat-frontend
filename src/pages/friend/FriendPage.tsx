import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { friendApi, userApi } from '../../api'
import { useAuthStore } from '../../store/authStore'
import { useChatStore } from '../../store/chatStore'
import type { FriendItem, User } from '../../types'
import { getConvId, getApiError } from '../../utils'

export default function FriendPage() {
  const user = useAuthStore(s => s.user)!
  const { upsertConversation } = useChatStore()
  const navigate = useNavigate()

  const [tab, setTab] = useState<'list' | 'requests' | 'search'>('list')
  const [friends, setFriends] = useState<FriendItem[]>([])
  const [requests, setRequests] = useState<FriendItem[]>([])
  const [searchKw, setSearchKw] = useState('')
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadFriends() }, [])
  useEffect(() => { if (tab === 'requests') loadRequests() }, [tab])

  async function loadFriends() {
    try {
      const res = await friendApi.list()
      if (res.success) setFriends(res.data)
    } catch { /* ignore */ }
  }

  async function loadRequests() {
    try {
      const res = await friendApi.requests()
      if (res.success) setRequests(res.data)
    } catch { /* ignore */ }
  }

  async function handleSearch() {
    if (!searchKw.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await userApi.search(searchKw.trim())
      if (res.success) setSearchResults(res.data.filter(u => u.id !== user.id))
    } catch (err) {
      setError(getApiError(err))
    } finally {
      setLoading(false)
    }
  }

  async function sendRequest(toUserId: number) {
    try {
      await friendApi.sendRequest(toUserId)
      alert('好友申请已发送')
    } catch (err) {
      alert(getApiError(err))
    }
  }

  async function handleAccept(friendshipId: number) {
    try {
      await friendApi.accept(friendshipId)
      await loadRequests()
      await loadFriends()
    } catch (err) {
      alert(getApiError(err))
    }
  }

  async function handleReject(friendshipId: number) {
    try {
      await friendApi.reject(friendshipId)
      setRequests(r => r.filter(f => f.friendshipId !== friendshipId))
    } catch (err) {
      alert(getApiError(err))
    }
  }

  function startChat(friend: User) {
    const convId = getConvId('private', user.id, friend.id)
    upsertConversation({
      id: convId,
      type: 'private',
      targetId: friend.id,
      targetName: friend.nickname || friend.username,
      targetAvatar: friend.avatar,
      lastMessage: null,
      lastMessageTime: null,
      unreadCount: 0,
      updatedAt: Date.now(),
    })
    navigate(`/chat/${convId}`, {
      state: {
        conv: {
          id: convId,
          type: 'private',
          targetId: friend.id,
          targetName: friend.nickname || friend.username,
          targetAvatar: friend.avatar,
        },
      },
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>好友</h2>
      </div>
      <div className="tab-bar">
        <button className={tab === 'list' ? 'tab active' : 'tab'} onClick={() => setTab('list')}>好友列表</button>
        <button className={tab === 'requests' ? 'tab active' : 'tab'} onClick={() => setTab('requests')}>
          申请{requests.length > 0 && <span className="badge">{requests.length}</span>}
        </button>
        <button className={tab === 'search' ? 'tab active' : 'tab'} onClick={() => setTab('search')}>搜索</button>
      </div>

      {tab === 'list' && (
        <div className="list">
          {friends.length === 0 && <div className="empty-state"><p>暂无好友</p><p className="empty-hint">去搜索添加好友吧</p></div>}
          {friends.map(f => (
            <div key={f.friendshipId} className="list-item" onClick={() => startChat(f.user)}>
              <div className="avatar">
                {f.user.avatar ? <img src={f.user.avatar} alt="" /> : <span>{(f.user.nickname || f.user.username)[0].toUpperCase()}</span>}
              </div>
              <div className="list-item-body">
                <span className="list-item-name">{f.user.nickname || f.user.username}</span>
                <span className="list-item-sub">UID: {f.user.uid}</span>
              </div>
              <button className="btn-sm" onClick={e => { e.stopPropagation(); startChat(f.user) }}>发消息</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'requests' && (
        <div className="list">
          {requests.length === 0 && <div className="empty-state"><p>暂无好友申请</p></div>}
          {requests.map(f => (
            <div key={f.friendshipId} className="list-item">
              <div className="avatar">
                {f.user.avatar ? <img src={f.user.avatar} alt="" /> : <span>{(f.user.nickname || f.user.username)[0].toUpperCase()}</span>}
              </div>
              <div className="list-item-body">
                <span className="list-item-name">{f.user.nickname || f.user.username}</span>
                <span className="list-item-sub">UID: {f.user.uid}</span>
              </div>
              <div className="btn-group">
                <button className="btn-sm btn-primary" onClick={() => handleAccept(f.friendshipId)}>同意</button>
                <button className="btn-sm btn-danger" onClick={() => handleReject(f.friendshipId)}>拒绝</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'search' && (
        <div className="search-section">
          <div className="search-input-row">
            <input
              type="search"
              placeholder="搜索用户名或 UID"
              value={searchKw}
              onChange={e => setSearchKw(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <button className="btn-primary" onClick={handleSearch} disabled={loading}>
              {loading ? '搜索中' : '搜索'}
            </button>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="list">
            {searchResults.map(u => (
              <div key={u.id} className="list-item">
                <div className="avatar">
                  {u.avatar ? <img src={u.avatar} alt="" /> : <span>{(u.nickname || u.username)[0].toUpperCase()}</span>}
                </div>
                <div className="list-item-body">
                  <span className="list-item-name">{u.nickname || u.username}</span>
                  <span className="list-item-sub">UID: {u.uid}</span>
                </div>
                <button className="btn-sm btn-primary" onClick={() => sendRequest(u.id)}>添加</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}