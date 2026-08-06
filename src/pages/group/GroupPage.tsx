import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { groupApi, friendApi } from '../../api'
import { useChatStore } from '../../store/chatStore'
import type { Group, FriendItem } from '../../types'
import { getApiError } from '../../utils'

export default function GroupPage() {
  const { upsertConversation } = useChatStore()
  const navigate = useNavigate()

  const [groups, setGroups] = useState<Group[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showInvite, setShowInvite] = useState<Group | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [friends, setFriends] = useState<FriendItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => { loadGroups() }, [])
  useEffect(() => {
    if (showInvite) friendApi.list().then(r => { if (r.success) setFriends(r.data) })
  }, [showInvite])

  async function loadGroups() {
    try {
      const res = await groupApi.list()
      if (res.success) setGroups(res.data)
    } catch { /* ignore */ }
  }

  async function createGroup() {
    if (!newGroupName.trim()) return
    setError('')
    try {
      const res = await groupApi.create(newGroupName.trim())
      if (res.success) {
        setGroups(g => [res.data, ...g])
        setShowCreate(false)
        setNewGroupName('')
      } else {
        setError(res.message ?? '创建失败')
      }
    } catch (err) {
      setError(getApiError(err))
    }
  }

  async function inviteMember(groupId: number, userId: number) {
    try {
      await groupApi.invite(groupId, userId)
      alert('邀请成功')
      await loadGroups()
    } catch (err) {
      alert(getApiError(err))
    }
  }

  async function leaveGroup(groupId: number) {
    if (!confirm('确定退出群组？')) return
    try {
      await groupApi.leave(groupId)
      setGroups(g => g.filter(gr => gr.id !== groupId))
    } catch (err) {
      alert(getApiError(err))
    }
  }

  function openGroupChat(group: Group) {
    const convId = `group_${group.id}`
    upsertConversation({
      id: convId,
      type: 'group',
      targetId: group.id,
      targetName: group.name,
      targetAvatar: group.avatar,
      lastMessage: null,
      lastMessageTime: null,
      unreadCount: 0,
      updatedAt: Date.now(),
    })
    navigate(`/chat/${convId}`, {
      state: { conv: { id: convId, type: 'group', targetId: group.id, targetName: group.name, targetAvatar: group.avatar } },
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>群组</h2>
        <button className="btn-icon-text" onClick={() => setShowCreate(true)}>+ 创建</button>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>创建群组</h3>
            <input
              type="text"
              placeholder="群组名称"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createGroup()}
            />
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn-primary" onClick={createGroup}>创建</button>
              <button onClick={() => setShowCreate(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>邀请好友加入「{showInvite.name}」</h3>
            <div className="list">
              {friends.filter(f => !showInvite.members.find(m => m.id === f.user.id)).map(f => (
                <div key={f.user.id} className="list-item">
                  <div className="avatar"><span>{(f.user.nickname || f.user.username)[0].toUpperCase()}</span></div>
                  <div className="list-item-body">
                    <span className="list-item-name">{f.user.nickname || f.user.username}</span>
                  </div>
                  <button className="btn-sm btn-primary" onClick={() => inviteMember(showInvite.id, f.user.id)}>邀请</button>
                </div>
              ))}
              {friends.filter(f => !showInvite.members.find(m => m.id === f.user.id)).length === 0 && (
                <p className="empty-state">所有好友都已在群组中</p>
              )}
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowInvite(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      <div className="list">
        {groups.length === 0 && <div className="empty-state"><p>暂无群组</p><p className="empty-hint">创建或被邀请加入群组</p></div>}
        {groups.map(g => (
          <div key={g.id} className="list-item" onClick={() => openGroupChat(g)}>
            <div className="avatar">
              {g.avatar ? <img src={g.avatar} alt="" /> : <span>{g.name[0].toUpperCase()}</span>}
              <span className="avatar-badge">群</span>
            </div>
            <div className="list-item-body">
              <span className="list-item-name">{g.name}</span>
              <span className="list-item-sub">{g.memberCount} 名成员</span>
            </div>
            <div className="btn-group" onClick={e => e.stopPropagation()}>
              <button className="btn-sm" onClick={() => setShowInvite(g)}>邀请</button>
              <button className="btn-sm btn-danger" onClick={() => leaveGroup(g.id)}>退出</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}