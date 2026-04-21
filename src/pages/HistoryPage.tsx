import { useState, useEffect } from 'react'
import { History, Trash2, Clock, Smartphone, Battery, Terminal, FlaskConical, Camera, FileText, Wrench, RotateCcw, Zap, Download, Activity, Package, FolderOpen } from 'lucide-react'
import { getHistory, HistoryEntry } from '../utils/history'


const CATEGORY_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  device:   { icon: Smartphone, color: '#00d4ff', label: '设备' },
  perf:     { icon: Activity,   color: '#10b981', label: '性能' },
  shell:    { icon: Terminal,   color: '#a855f7', label: '终端' },
  app:      { icon: Package,    color: '#f59e0b', label: '应用' },
  log:      { icon: FileText,   color: '#ef4444', label: '日志' },
  test:     { icon: FlaskConical, color: '#ec4899', label: '测试' },
  tools:    { icon: Wrench,     color: '#06b6d4', label: '工具' },
  files:    { icon: FolderOpen, color: '#8b5cf6', label: '文件' },
  screenshot: { icon: Camera,   color: '#8b5cf6', label: '截图' },
  reboot:   { icon: RotateCcw,  color: '#f59e0b', label: '重启' },
  fastboot: { icon: Zap,        color: '#ef4444', label: '刷机' },
  collect:  { icon: Download,   color: '#10b981', label: '收集' },
  battery:  { icon: Battery,    color: '#3b82f6', label: '功耗' },
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [searchText, setSearchText] = useState('')

  const loadHistory = () => { setHistory(getHistory()) }

  useEffect(() => { loadHistory(); window.addEventListener('adb-history-update', loadHistory); return () => { window.removeEventListener('adb-history-update', loadHistory) } }, [])

  const clearHistory = () => {
    if (!confirm('确定要清空所有历史记录吗？')) return
    localStorage.removeItem('adb-tools-history'); setHistory([])
  }

  const filtered = history.filter(h => {
    if (filter !== 'all' && h.category !== filter) return false
    if (searchText && !h.action.toLowerCase().includes(searchText.toLowerCase()) && !h.detail.toLowerCase().includes(searchText.toLowerCase())) return false
    return true
  })

  const categories = [...new Set(history.map(h => h.category))]

  return (
    <div>
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <History size={20} /> 操作历史
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>共 {history.length} 条记录</span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="搜索操作..."
          style={{ flex: 1, minWidth: 200, padding: '7px 12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 13 }} />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('all')} style={{ padding: '4px 10px', fontSize: 11 }}>全部</button>
          {categories.map(cat => {
            const cfg = CATEGORY_CONFIG[cat]; return (
              <button key={cat} className={`btn btn-sm ${filter === cat ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(cat)} style={{ padding: '4px 10px', fontSize: 11 }}>
                {cfg?.label || cat}
              </button>
            )
          })}
        </div>
        <button className="btn btn-danger" onClick={clearHistory} style={{ fontSize: 11, padding: '4px 12px' }}><Trash2 size={11} /> 清空</button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>
          <History size={48} style={{ opacity: 0.3 }} />
          <div className="empty-text">暂无历史记录</div>
          <div className="empty-sub">操作设备时会自动记录</div>
        </div>
      ) : (
        <div className="history-list">
          {filtered.map(entry => {
            const cfg = CATEGORY_CONFIG[entry.category] || { icon: Clock, color: '#8b949e', label: entry.category }
            const Icon = cfg.icon
            return (
              <div key={entry.id} className="history-item">
                <div className="history-icon" style={{ color: cfg.color }}><Icon size={16} /></div>
                <div className="history-content">
                  <div className="history-action">{entry.action}</div>
                  {entry.detail && <div className="history-detail">{entry.detail}</div>}
                </div>
                <div className="history-meta">
                  <span className={`badge badge-${entry.status === 'success' ? 'green' : entry.status === 'error' ? 'red' : 'blue'}`}>
                    {entry.status === 'success' ? '成功' : entry.status === 'error' ? '失败' : '信息'}
                  </span>
                  <span className="history-time">{formatTime(entry.timestamp)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
