import { useState, useEffect } from 'react'
import { invoke, open as openDialog, CmdResult, AppVersion } from '../api/electron-bridge'
import { Upload, Package, RefreshCw, Trash2 } from 'lucide-react'

interface Props {
  selectedDevice: string; showNotif: (t: string, m: string) => void
}

export default function AppPage({ selectedDevice, showNotif }: Props) {
  const [apps, setApps] = useState<AppVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [uninstalling, setUninstalling] = useState<string | null>(null)

  const queryApps = async () => {
    if (!selectedDevice) return
    setLoading(true)
    try {
      const r = await invoke<AppVersion[]>('query_app_versions', { serial: selectedDevice })
      setApps(r)
    } catch { setApps([]) }
    setLoading(false)
  }

  useEffect(() => { if (selectedDevice) queryApps() }, [selectedDevice])

  const installAPK = async () => {
    const file = await openDialog({ multiple: false, filters: [{ name: 'APK', extensions: ['apk'] }] })
    if (!file) return
    setInstalling(true)
    try {
      const r = await invoke<CmdResult>('install_apk', { serial: selectedDevice, filePath: file })
      showNotif(r.success ? 'success' : 'error', r.success ? 'APK 安装成功' : `安装失败: ${r.error || r.output}`)
      if (r.success) queryApps()
    } catch (e) { showNotif('error', String(e)) }
    setInstalling(false)
  }

  const installAMR = async () => {
    const file = await openDialog({ multiple: false, filters: [{ name: 'AMR', extensions: ['amr'] }] })
    if (!file) return
    setInstalling(true)
    try {
      const r = await invoke<CmdResult>('install_amr', { serial: selectedDevice, filePath: file, autoReboot: false })
      showNotif(r.success ? 'success' : 'error', r.success ? r.output : `安装失败: ${r.error}`)
      if (r.success) queryApps()
    } catch (e) { showNotif('error', String(e)) }
    setInstalling(false)
  }

  const uninstallApp = async (appid: string) => {
    if (!selectedDevice) return
    setUninstalling(appid)
    try {
      const r = await invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: `miniapp_cli uninstall ${appid}` })
      showNotif(r?.success ? 'success' : 'error', r?.success ? `${appid} 已卸载` : `卸载失败: ${r?.error || r?.output}`)
      if (r?.success) {
        setApps(prev => prev.filter(a => a.appid !== appid))
      }
    } catch (e) { showNotif('error', String(e)) }
    setUninstalling(null)
  }

  if (!selectedDevice) {
    return <div className="empty-state"><div className="empty-icon">📦</div><div className="empty-text">请先连接设备</div></div>
  }

  return (
    <div>
      <div className="section-title">应用管理</div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button className="btn btn-primary" onClick={installAPK} disabled={installing}>
          <Upload size={14} /> 安装 APK
        </button>
        <button className="btn btn-secondary" onClick={installAMR} disabled={installing}>
          <Package size={14} /> 安装 AMR 小程序
        </button>
        <button className="btn btn-secondary" onClick={queryApps} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spinning' : ''} /> 刷新列表
        </button>
      </div>

      <div className="card">
        <div className="card-title">已安装应用 ({apps.length})</div>
        {loading ? (
          <div className="loading-container"><div className="spinner" />加载中...</div>
        ) : apps.length === 0 ? (
          <div className="empty-state" style={{ padding: 30 }}>
            <div className="empty-text">未找到已安装的小程序</div>
            <div className="empty-sub">从设备 /data/miniapp/.../packages.json 读取</div>
          </div>
        ) : (
          <table className="process-table">
            <thead><tr><th>应用ID</th><th>名称</th><th>版本</th><th style={{ width: 80 }}>操作</th></tr></thead>
            <tbody>
              {apps.map(a => (
                <tr key={a.appid}>
                  <td><span className="badge badge-blue">{a.appid}</span></td>
                  <td>{a.name}</td>
                  <td><span className="badge badge-green">{a.version}</span></td>
                  <td>
                    <button
                      className="btn-delete-row"
                      onClick={() => uninstallApp(a.appid)}
                      disabled={uninstalling === a.appid}
                      title="卸载此应用"
                    >
                      <Trash2 size={12} />
                      <span>{uninstalling === a.appid ? '卸载中...' : '卸载'}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
