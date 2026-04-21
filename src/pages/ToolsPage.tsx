import { useState, useCallback } from 'react'
import { invoke, CmdResult } from '../api/electron-bridge'
import { Camera, RotateCcw, Zap, Wifi, WifiOff, Monitor, Shield, CheckCircle, Globe, Terminal, Search, FileText } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'
import ScreenshotPreview from '../components/ScreenshotPreview'

interface Props { selectedDevice: string; showNotif: (t: string, m: string) => void }

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  type: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
}

export default function ToolsPage({ selectedDevice, showNotif }: Props) {
  const [screenOn, setScreenOn] = useState(true)
  const [adbDebug, setAdbDebug] = useState(false)
  const [wifiList, setWifiList] = useState<{ssid: string; signal: string; security: string}[]>([])
  const [running, setRunning] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState>({ isOpen: false, title: '', message: '', type: 'warning', onConfirm: () => {} })
  const [screenshotPreview, setScreenshotPreview] = useState<{ isOpen: boolean; path: string }>({ isOpen: false, path: '' })

  const showConfirm = useCallback((title: string, message: string, type: ConfirmState['type'], onConfirm: () => void) => {
    setConfirm({ isOpen: true, title, message, type, onConfirm })
  }, [])

  const hideConfirm = useCallback(() => {
    setConfirm(prev => ({ ...prev, isOpen: false }))
  }, [])

  const run = async (api: string, args: Record<string, unknown> = {}) => {
    if (!selectedDevice) return null
    setRunning(true)
    try {
      const r = await invoke<CmdResult>(api, { serial: selectedDevice, ...args })
      showNotif(r?.success ? 'success' : 'error', r?.success ? (r.output || '操作成功') : (r?.error || '操作失败'))
      return r
    } catch (e) { showNotif('error', String(e)); return null }
    finally { setRunning(false) }
  }

  const screenshot = async () => {
    if (!selectedDevice) return
    setRunning(true)
    try {
      const r = await invoke<CmdResult>('screenshot', { serial: selectedDevice })
      if (r?.success && r.output) {
        setScreenshotPreview({ isOpen: true, path: r.output })
        showNotif('success', `截图已保存到: ${r.output}`)
      } else {
        showNotif('error', r?.error || '截图失败')
      }
    } catch (e) { showNotif('error', String(e)) }
    setRunning(false)
  }

  const extractLogs = async () => {
    if (!selectedDevice) return
    setRunning(true)
    try {
      const r = await invoke<CmdResult>('extract_logs', { serial: selectedDevice })
      if (r?.success) {
        showNotif('success', `日志已提取到: ${r.output}`)
      } else {
        showNotif('error', r?.error || '提取失败')
      }
    } catch (e) { showNotif('error', String(e)) }
    setRunning(false)
  }

  const reboot = useCallback(() => {
    showConfirm(
      '重启设备',
      '设备将立即重启，当前正在运行的应用将被关闭。\n\n确定要重启设备吗？',
      'warning',
      async () => {
        hideConfirm()
        const r = await run('reboot_device')
        if (r?.success) showNotif('info', '设备重启中...')
      }
    )
  }, [showConfirm, hideConfirm, run, showNotif])

  const fastboot = useCallback(() => {
    showConfirm(
      '进入刷机模式',
      '设备将进入 Fastboot/Loader 模式，可能需要数据线连接电脑进行刷机操作。\n\n此操作会使设备暂时无法通过 ADB 控制。',
      'danger',
      async () => {
        hideConfirm()
        const r = await run('enter_fastboot')
        if (r?.success) showNotif('warning', '设备已进入刷机模式')
      }
    )
  }, [showConfirm, hideConfirm, run, showNotif])

  const toggleScreenOn = async () => { 
    await run('keep_screen_on', { enable: !screenOn })
    setScreenOn(!screenOn)
  }

  const toggleAdbDebug = async () => { 
    await run('keep_adb_debug', { enable: !adbDebug })
    setAdbDebug(!adbDebug)
  }

  const doFirmwareCheck = async () => {
    setRunning(true)
    try {
      const r = await invoke<CmdResult>('firmware_check', { serial: selectedDevice })
      showNotif(r?.success ? 'success' : 'error', r?.success ? '固件检查完成' : (r?.error || '检查失败'))
    } catch (e) { showNotif('error', String(e)) }
    setRunning(false)
  }

  const doLogRedirect = async () => { 
    const r = await run('log_redirect')
    if (r?.success) showNotif('success', '日志重定向配置完成')
  }

  const scanWifi = async () => {
    setRunning(true)
    try {
      const r = await invoke<CmdResult>('wifi_scan')
      if (!r?.success) { showNotif('warning', r?.error || 'WiFi扫描失败'); setRunning(false); return }
      const lines = r.output.split('\n')
      const networks: {ssid: string; signal: string; security: string}[] = []
      let current: {ssid?: string; signal?: string; security?: string} = {}
      for (const line of lines) {
        if (line.includes('SSID') && !line.includes('BSSID')) {
          if (current.ssid) networks.push(current as {ssid: string; signal: string; security: string})
          const parts = line.split(':')
          current = { ssid: parts.slice(1).join(':').trim() }
        } else if (line.includes('信号') || line.includes('Signal')) {
          current.signal = line.split(':').slice(1).join(':').trim()
        } else if (line.includes('身份验证') || line.includes('Authentication')) {
          current.security = line.split(':').slice(1).join(':').trim()
        }
      }
      if (current.ssid) networks.push(current as {ssid: string; signal: string; security: string})
      setWifiList(networks)
      showNotif('success', `扫描到 ${networks.length} 个 WiFi 热点`)
    } catch (e) { showNotif('error', String(e)) }
    setRunning(false)
  }

  const connectWifi = async (ssid: string) => {
    const r = await run('wifi_connect', { ssid, password: null })
    if (r?.success) showNotif('success', `正在连接 ${ssid}...`)
  }

  const disconnectWifi = async () => { await run('wifi_disconnect'); setWifiList([]) }

  if (!selectedDevice) {
    return <div className="empty-state"><div className="empty-icon"><Zap size={48}/></div><div className="empty-text">请先连接设备</div></div>
  }

  return (
    <>
      <div className="section-title">工具箱</div>

      {/* Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <button className="tool-btn" onClick={screenshot} disabled={running}>
          <Camera size={24} /><span className="tool-name">截图</span>
        </button>
        <button className="tool-btn" onClick={extractLogs} disabled={running}>
          <FileText size={24} /><span className="tool-name">日志提取</span>
        </button>
        <button className="tool-btn" onClick={reboot} disabled={running}>
          <RotateCcw size={24} /><span className="tool-name">重启设备</span>
        </button>
        <button className="tool-btn" onClick={fastboot} disabled={running}>
          <Zap size={24} /><span className="tool-name">进入刷机模式</span>
        </button>
        <button className="tool-btn" onClick={doFirmwareCheck} disabled={running}>
          <CheckCircle size={24} /><span className="tool-name">固件检查</span>
        </button>
        <button className="tool-btn" onClick={doLogRedirect} disabled={running}>
          <Terminal size={24} /><span className="tool-name">日志重定向</span>
        </button>
        <button className="tool-btn" onClick={toggleScreenOn} disabled={running}>
          <Monitor size={24} />
          <span className="tool-name">{screenOn ? '关闭常亮' : '开启常亮'}</span>
        </button>
        <button className="tool-btn" onClick={toggleAdbDebug} disabled={running}>
          <Shield size={24} /><span className="tool-name">{adbDebug ? '关闭ADB保持' : '开启ADB保持'}</span>
        </button>
        <button className="tool-btn" onClick={scanWifi} disabled={running}>
          <Search size={24} /><span className="tool-name">WiFi扫描</span>
        </button>
      </div>

      {/* WiFi Panel */}
      {wifiList.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              <Globe size={14} style={{ marginRight: 6 }} />WiFi 热点 ({wifiList.length})
            </div>
            <button className="btn btn-danger" style={{ padding: '2px 10px', fontSize: 11 }} onClick={disconnectWifi}>
              <WifiOff size={11} /> 关闭
            </button>
          </div>
          <table className="process-table">
            <thead><tr><th>SSID</th><th>信号</th><th>加密</th><th>操作</th></tr></thead>
            <tbody>
              {wifiList.map((w, i) => (
                <tr key={i}>
                  <td><span className="badge badge-blue">{w.ssid}</span></td>
                  <td>{w.signal}</td>
                  <td><span className="badge badge-purple">{w.security}</span></td>
                  <td>
                    <button className="btn btn-success" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => connectWifi(w.ssid)}>
                      <Wifi size={10} /> 连接
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Environment Info */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">环境信息</div>
        <div className="info-row">
          <span className="info-label">ADB 路径</span>
          <span className="info-value">adb (系统 PATH)</span>
        </div>
        <div className="info-row">
          <span className="info-label">设备序列号</span>
          <span className="info-value">{selectedDevice}</span>
        </div>
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirm.isOpen}
        title={confirm.title}
        message={confirm.message}
        type={confirm.type}
        onConfirm={confirm.onConfirm}
        onCancel={hideConfirm}
      />

      {/* Screenshot Preview */}
      <ScreenshotPreview
        isOpen={screenshotPreview.isOpen}
        imagePath={screenshotPreview.path}
        onClose={() => setScreenshotPreview({ isOpen: false, path: '' })}
      />
    </>
  )
}
