import { useState, useMemo } from 'react'
import { invoke, save as saveDialog, writeTextFile, CmdResult } from '../api/electron-bridge'
import { FileText, Download, RefreshCw, FolderOpen, Search } from 'lucide-react'
import VirtualLogViewer from '../components/VirtualLogViewer'

interface Props { selectedDevice: string; showNotif: (t: string, m: string) => void }

export default function LogPage({ selectedDevice, showNotif }: Props) {
  const [logs, setLogs] = useState<string[]>([])
  const [logType, setLogType] = useState<'applog' | 'syslog'>('applog')
  const [loading, setLoading] = useState(false)
  const [logPath, setLogPath] = useState('/data/applog')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs
    const query = searchQuery.toLowerCase()
    return logs.filter(log => log.toLowerCase().includes(query))
  }, [logs, searchQuery])

  const fetchLogs = async () => {
    if (!selectedDevice) return
    setLoading(true)
    try {
      const path = logType === 'applog' ? '/data/applog' : '/data/syslog'
      const r = await invoke<CmdResult>('get_device_logs', { serial: selectedDevice, logPath: path })
      if (r?.success) {
        setLogs(r.output.split('\n').filter((l: string) => l.trim()))
        setLogPath(path)
      } else {
        setLogs([])
        showNotif('warning', r?.error || '日志为空')
      }
    } catch { setLogs([]) }
    setLoading(false)
  }

  const downloadLog = async () => {
    if (!selectedDevice) return
    const path = await saveDialog({
      defaultPath: `${selectedDevice.slice(0, 8)}_${logType}_${Date.now()}.log`,
      filters: [{ name: 'Log', extensions: ['log', 'txt'] }]
    })
    if (!path) return
    try {
      await writeTextFile(path, filteredLogs.join('\n'))
      showNotif('success', `日志已保存到: ${path}`)
    } catch (e) { showNotif('error', String(e)) }
  }

  const stats = useMemo(() => {
    const error = logs.filter(l => /error|fail|错误|失败/i.test(l)).length
    const warning = logs.filter(l => /warn|警告/i.test(l)).length
    return { total: logs.length, error, warning }
  }, [logs])

  if (!selectedDevice) {
    return <div className="empty-state"><div className="empty-icon"><FileText size={48}/></div><div className="empty-text">请先连接设备</div></div>
  }

  return (
    <div>
      <div className="section-title">日志查看</div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`btn ${logType === 'applog' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLogType('applog')}>应用日志</button>
        <button className={`btn ${logType === 'syslog' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLogType('syslog')}>系统日志</button>
        <button className="btn btn-secondary" onClick={fetchLogs} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spinning' : ''} /> 刷新
        </button>
        <button className="btn btn-primary" onClick={downloadLog} disabled={filteredLogs.length === 0}>
          <Download size={13} /> 导出
        </button>
        
        {/* Search */}
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="搜索日志..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 32px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Stats */}
      {logs.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            共 <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{stats.total}</span> 行
          </span>
          {stats.error > 0 && (
            <span style={{ fontSize: 12, color: 'var(--accent-error)' }}>
              错误 <span style={{ fontWeight: 600 }}>{stats.error}</span>
            </span>
          )}
          {stats.warning > 0 && (
            <span style={{ fontSize: 12, color: 'var(--accent-warning)' }}>
              警告 <span style={{ fontWeight: 600 }}>{stats.warning}</span>
            </span>
          )}
          {searchQuery && (
            <span style={{ fontSize: 12, color: 'var(--accent-secondary)' }}>
              筛选结果 <span style={{ fontWeight: 600 }}>{filteredLogs.length}</span> 行
            </span>
          )}
        </div>
      )}

      {/* Log Viewer */}
      <div className="log-viewer" style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ 
          padding: '8px 12px', 
          borderBottom: '1px solid var(--border-color)', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          background: 'var(--bg-secondary)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
            {logPath}
          </span>
        </div>
        
        {loading ? (
          <div className="loading-container" style={{ height: 400 }}><div className="spinner" />加载中...</div>
        ) : logs.length === 0 ? (
          <div className="empty-state" style={{ padding: 60 }}>
            <div className="empty-icon"><FolderOpen size={40}/></div>
            <div className="empty-text">未找到日志</div>
            <div className="empty-sub">设备上的 {logPath} 为空或不存在</div>
          </div>
        ) : (
          <VirtualLogViewer logs={filteredLogs} height={500} />
        )}
      </div>
    </div>
  )
}
