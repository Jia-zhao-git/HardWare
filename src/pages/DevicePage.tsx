import { useState, useRef, useEffect } from 'react'
import { invoke, CmdResult, AdbDevice, DeviceInfo } from '../api/electron-bridge'
import {
  Smartphone, Battery, Cpu, MemoryStick, Wifi, HardDrive, RefreshCw,
  CheckCircle, AlertTriangle, XCircle, Info, Tag, Calendar, Factory, Copy, Check,
  Camera, FileText, RotateCcw, Zap
} from 'lucide-react'
import { getDeviceBySku } from '../config/deviceConfig'

interface Props {
  selectedDevice: string
  devices: AdbDevice[]
  deviceInfo: DeviceInfo | null
  showNotif: (type: string, msg: string) => void
  onSelectDevice: (serial: string) => void
  connectedDeviceInfo: any
  onRefresh?: () => void
}

export default function DevicePage({
  selectedDevice, devices, deviceInfo, showNotif, onSelectDevice, connectedDeviceInfo, onRefresh
}: Props) {
  const [authenticating, setAuthenticating] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [screenshotting, setScreenshotting] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [rebooting, setRebooting] = useState(false)
  const [enteringFastboot, setEnteringFastboot] = useState(false)
  const [usbDebugOn, setUsbDebugOn] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const refreshDeviceInfo = async () => {
    if (!selectedDevice) return
    setRefreshing(true)
    try {
      // 调用父组件的刷新函数
      if (onRefresh) {
        await onRefresh()
      }
      showNotif('success', '设备信息已刷新')
    } catch (e) { 
      console.error('刷新失败', e)
      showNotif('error', '刷新设备信息失败')
    }
    setRefreshing(false)
  }

  // 进入页面时检测调试状态
  useEffect(() => {
    const checkDebugStatus = async () => {
      if (!selectedDevice) return
      try {
        const r = await invoke<CmdResult>('check_adb_debug_status', { serial: selectedDevice })
        console.log('调试状态检测结果:', r)
        setUsbDebugOn(r?.output?.includes('enabled') || false)
      } catch (e) {
        console.error('检测调试状态失败:', e)
        setUsbDebugOn(false)
      }
    }
    checkDebugStatus()
  }, [selectedDevice])
  const [usbDebugLoading, setUsbDebugLoading] = useState(false)
  const [screenPreview, setScreenPreview] = useState<string | null>(null)
  const [screenPreviewOn, setScreenPreviewOn] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(1000) // 默认1秒
  const screenRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
      showNotif('success', `已复制: ${text}`)
    } catch { showNotif('error', '复制失败') }
  }

  const authenticate = async () => {
    if (!selectedDevice) return
    setAuthenticating(true)
    try {
      const r = await invoke<CmdResult>('authenticate_device', { serial: selectedDevice })
      showNotif(r?.success ? 'success' : 'error', r?.output || r?.error || '认证失败')
    } catch (e) { showNotif('error', String(e)) }
    setAuthenticating(false)
  }

  const takeScreenshot = async () => {
    if (!selectedDevice) return
    setScreenshotting(true)
    try {
      const r = await invoke<CmdResult>('screenshot', { serial: selectedDevice })
      if (r?.success) {
        if (r?.base64) setScreenPreview(r.base64)
        showNotif('success', '截图已保存到 D:\\HardWare\\Screen')
      } else { showNotif('error', r?.error || '截图失败') }
    } catch (e) { showNotif('error', String(e)) }
    setScreenshotting(false)
  }

  const extractLogs = async () => {
    if (!selectedDevice) return
    setExtracting(true)
    try {
      const r = await invoke<CmdResult>('extract_logs', { serial: selectedDevice })
      showNotif(r?.success ? 'success' : 'error', r?.success ? `日志已保存到 D:\\HardWare\\LOG\\${selectedDevice}` : r?.error || '提取失败')
    } catch (e) { showNotif('error', String(e)) }
    setExtracting(false)
  }

  const rebootDevice = async () => {
    if (!selectedDevice) return
    setRebooting(true)
    try {
      const r = await invoke<CmdResult>('reboot_device', { serial: selectedDevice })
      showNotif(r?.success ? 'success' : 'error', r?.success ? '设备正在重启...' : r?.error || '重启失败')
    } catch (e) { showNotif('error', String(e)) }
    setRebooting(false)
  }

  const enterFastboot = async () => {
    if (!selectedDevice) return
    setEnteringFastboot(true)
    try {
      const r = await invoke<CmdResult>('enter_fastboot', { serial: selectedDevice })
      showNotif(r?.success ? 'success' : 'error', r?.success ? '设备正在进入刷机模式...' : r?.error || '进入刷机模式失败')
    } catch (e) { showNotif('error', String(e)) }
    setEnteringFastboot(false)
  }

  const toggleUsbDebug = async () => {
    if (!selectedDevice) return
    setUsbDebugLoading(true)
    try {
      const r = await invoke<CmdResult>('keep_adb_debug', { serial: selectedDevice, enable: !usbDebugOn })
      if (r?.success) {
        setUsbDebugOn(!usbDebugOn)
        showNotif('success', !usbDebugOn ? 'USB调试保持已开启' : 'USB调试保持已关闭')
      } else { showNotif('error', r?.error || '操作失败') }
    } catch (e) { showNotif('error', String(e)) }
    setUsbDebugLoading(false)
  }

  const loadScreenPreview = async () => {
    if (!selectedDevice) return
    try {
      const r = await invoke<CmdResult>('screenshot', { serial: selectedDevice })
      if (r?.base64) setScreenPreview(r.base64)
    } catch (error) {
      console.error('截图失败:', error)
    }
  }

  const toggleScreenPreview = () => {
    if (screenPreviewOn) {
      if (screenRef.current) { clearInterval(screenRef.current); screenRef.current = null }
      setScreenPreviewOn(false); setScreenPreview(null)
    } else {
      loadScreenPreview()
      setScreenPreviewOn(true)
      const interval = Math.max(100, refreshInterval) // 最小100ms
      screenRef.current = setInterval(loadScreenPreview, interval)
    }
  }

  useEffect(() => {
    return () => { if (screenRef.current) clearInterval(screenRef.current) }
  }, [])

  const getStatusIcon = (state: string) => {
    switch (state) {
      case 'device': return <CheckCircle size={16} style={{ color: 'var(--accent-secondary)' }} />
      case 'unauthorized': return <AlertTriangle size={16} style={{ color: 'var(--accent-warning)' }} />
      case 'offline': return <XCircle size={16} style={{ color: 'var(--accent-error)' }} />
      default: return <XCircle size={16} style={{ color: 'var(--text-muted)' }} />
    }
  }

  const getStatusText = (state: string) => {
    switch (state) {
      case 'device': return '已连接'
      case 'unauthorized': return '待授权'
      case 'offline': return '离线'
      default: return '未知'
    }
  }

  const matchedDevice = connectedDeviceInfo || (deviceInfo?.sku ? getDeviceBySku(deviceInfo.sku) : null)

  const formatPartition = (raw: string | undefined) => {
    if (!raw || raw === 'N/A') return 'N/A'
    const verA = raw.match(/version_a[=:]\s*([^\s,;]+)/i)
    const verB = raw.match(/version_b[=:]\s*([^\s,;]+)/i)
    if (verA && verB) return `A: ${verA[1]}  B: ${verB[1]}`
    return raw
  }

  if (!selectedDevice || devices.length === 0) {
    return (
      <div className="empty-state">
        <Smartphone size={64} style={{ opacity: 0.3 }} />
        <div className="empty-text">未检测到设备</div>
        <div className="empty-sub">请连接 ADB 设备，并确保 ADB 权限已开启</div>
      </div>
    )
  }

  const currentDevice = devices.find(d => d.serial === selectedDevice)

  return (
    <div>
      <div className="section-title">
        <Smartphone size={20} /> 设备信息
      </div>

      {/* Device Header: Image + Info + Screen Preview */}
      <div className="device-header">
        {/* Image */}
        <div className="device-image-box">
          {matchedDevice?.image ? (
            <img
              src={matchedDevice.image} alt={matchedDevice.name}
              onError={(e) => { e.currentTarget.style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove('hidden') }}
            />
          ) : null}
          <div className={`device-image-placeholder ${matchedDevice?.image ? 'hidden' : ''}`}>
            {matchedDevice?.category === 'pen' ? '✏️' : matchedDevice?.category === 'audio' ? '🎧' : '📱'}
          </div>
        </div>

        {/* Info */}
        <div className="device-info-box">
          <div className="device-name">{matchedDevice?.name || deviceInfo?.sku || '未知设备'}</div>
          <div className="device-model">
            {deviceInfo?.version || 'N/A'} · Serial: {selectedDevice.slice(0, 20)}...
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
              background: currentDevice?.state === 'device' ? 'rgba(63,185,80,0.1)' : 'rgba(210,153,34,0.1)',
              borderRadius: 'var(--radius-md)',
            }}>
              {getStatusIcon(currentDevice?.state || '')}
              <span style={{
                color: currentDevice?.state === 'device' ? 'var(--accent-secondary)' : 'var(--accent-warning)',
                fontWeight: 600
              }}>{getStatusText(currentDevice?.state || '')}</span>
            </div>

            {currentDevice?.state === 'unauthorized' && (
              <button className="btn btn-primary" onClick={authenticate} disabled={authenticating}>
                {authenticating ? '认证中...' : '点击授权'}
              </button>
            )}
            <button className="btn btn-secondary" onClick={authenticate}>
              <RefreshCw size={12} /> 重新认证
            </button>
          </div>

          {/* Action Buttons */}
          <div className="device-action-row">
            <button className="device-action-btn-inline" onClick={refreshDeviceInfo} disabled={refreshing}
              style={{ background: 'rgba(88,166,255,0.1)', borderColor: 'var(--accent-primary)' }}>
              <RefreshCw size={14} className={refreshing ? 'spinning' : ''} />
              <span>{refreshing ? '刷新中...' : '刷新信息'}</span>
            </button>
            <button className="device-action-btn-inline" onClick={takeScreenshot} disabled={screenshotting}>
              <Camera size={14} /><span>{screenshotting ? '截图中...' : '设备截图'}</span>
            </button>
            <button className="device-action-btn-inline" onClick={toggleScreenPreview}
              style={screenPreviewOn ? { background: 'rgba(0,212,255,0.15)', borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' } : {}}>
              <Camera size={14} /><span>{screenPreviewOn ? '停止画面' : '实时画面'}</span>
            </button>
            <input
              type="number"
              value={refreshInterval}
              onChange={e => {
                const v = parseInt(e.target.value) || 1000
                setRefreshInterval(Math.max(100, v))
                if (screenPreviewOn && screenRef.current) {
                  clearInterval(screenRef.current)
                  screenRef.current = setInterval(loadScreenPreview, Math.max(100, v))
                }
              }}
              style={{ width: 50, padding: '2px 4px', fontSize: 10, textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: 4, background: 'var(--bg-card)', color: 'var(--text-primary)' }}
              title="刷新间隔(ms)，最小100"
            /><span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2 }}>ms</span>
            <button className="device-action-btn-inline" onClick={extractLogs} disabled={extracting}>
              <FileText size={14} /><span>{extracting ? '提取中...' : '提取日志'}</span>
            </button>
            <button className="device-action-btn-inline device-action-btn-warn" onClick={rebootDevice} disabled={rebooting}>
              <RotateCcw size={14} /><span>{rebooting ? '重启中...' : '重启设备'}</span>
            </button>
            <button className="device-action-btn-inline device-action-btn-danger" onClick={enterFastboot} disabled={enteringFastboot}>
              <Zap size={14} /><span>{enteringFastboot ? '进入中...' : '刷机模式'}</span>
            </button>
            <button className="device-action-btn-inline" onClick={toggleUsbDebug} disabled={usbDebugLoading}
              style={usbDebugOn ? { background: 'rgba(63,185,80,0.15)', borderColor: 'var(--accent-secondary)', color: 'var(--accent-secondary)' } : {}}
              title="USB调试保持">
              <Zap size={14} /><span>{usbDebugLoading ? '...' : usbDebugOn ? '关闭调试' : '开启调试'}</span>
            </button>
          </div>

          {/* Screen Preview */}
          {screenPreviewOn && (
            <div className="device-screen-preview">
              <div className="screen-preview-header">
                <span>实时画面</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>每2秒刷新</span>
                  <button className="icon-btn" onClick={toggleScreenPreview} title="关闭" style={{ color: 'var(--accent-error)' }}>×</button>
                </div>
              </div>
              <div className="screen-preview-content">
                {screenPreview ? (
                  <img src={screenPreview} alt="设备画面" style={{ width: '100%', borderRadius: 'var(--radius-sm)' }} />
                ) : (
                  <div className="loading-container"><div className="spinner" />加载中...</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Device Specs */}
      {matchedDevice?.specs && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title"><Info size={16} /> 设备规格</div>
          <div className="specs-grid">
            {[
              { icon: Cpu, label: 'CPU', val: matchedDevice.specs.cpu },
              { icon: HardDrive, label: '存储', val: matchedDevice.specs.storage },
              { icon: MemoryStick, label: '内存', val: matchedDevice.specs.ram },
              { icon: Smartphone, label: '屏幕', val: matchedDevice.specs.display },
              { icon: Battery, label: '电池', val: matchedDevice.specs.battery },
              { icon: Wifi, label: 'WiFi', val: matchedDevice.specs.wifi },
              { icon: Tag, label: 'SKU', val: matchedDevice.specs.sku },
              { icon: Factory, label: '厂商', val: matchedDevice.specs.manufacturer },
              ...(matchedDevice.specs.releaseDate ? [{ icon: Calendar, label: '发布时间', val: matchedDevice.specs.releaseDate }] : []),
            ].map(({ icon: Icon, label, val }) => (
              <div key={label} className="spec-item">
                <span className="spec-label"><Icon size={12} /> {label}</span>
                <span className="spec-value">{val || 'N/A'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* System Info */}
      <div className="card">
        <div className="card-title"><Info size={16} /> 系统信息</div>
        <div className="info-grid-2">
          <div className="info-box">
            <div className="info-box-label"><Tag size={14} /> SKU</div>
            <div className="info-box-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{deviceInfo?.sku || 'N/A'}</span>
              {deviceInfo?.sku && (
                <button className="icon-btn" onClick={() => copyToClipboard(deviceInfo.sku!, 'sku')} title="复制SKU">
                  {copiedField === 'sku' ? <Check size={14} style={{ color: 'var(--accent-secondary)' }} /> : <Copy size={14} />}
                </button>
              )}
            </div>
          </div>
          <div className="info-box">
            <div className="info-box-label"><Smartphone size={14} /> SN</div>
            <div className="info-box-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{deviceInfo?.serial || selectedDevice}</span>
              {(deviceInfo?.serial || selectedDevice) && (
                <button className="icon-btn" onClick={() => copyToClipboard(deviceInfo?.serial || selectedDevice, 'sn')} title="复制SN">
                  {copiedField === 'sn' ? <Check size={14} style={{ color: 'var(--accent-secondary)' }} /> : <Copy size={14} />}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="info-grid-2">
          <div className="info-box">
            <div className="info-box-label"><Smartphone size={14} /> 版本</div>
            <div className="info-box-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{deviceInfo?.version || 'N/A'}</span>
              {deviceInfo?.version && (
                <button className="icon-btn" onClick={() => copyToClipboard(deviceInfo.version!, 'version')} title="复制版本">
                  {copiedField === 'version' ? <Check size={14} style={{ color: 'var(--accent-secondary)' }} /> : <Copy size={14} />}
                </button>
              )}
            </div>
          </div>
          <div className="info-box">
            <div className="info-box-label"><HardDrive size={14} /> 分区</div>
            <div className="info-box-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{formatPartition(deviceInfo?.partition)}</span>
              {deviceInfo?.partition && (
                <button className="icon-btn" onClick={() => copyToClipboard(deviceInfo.partition!, 'partition')} title="复制分区">
                  {copiedField === 'partition' ? <Check size={14} style={{ color: 'var(--accent-secondary)' }} /> : <Copy size={14} />}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="info-grid-1">
          <div className="info-box">
            <div className="info-box-label"><RefreshCw size={14} /> 当前槽位</div>
            <div className="info-box-value">
              <span style={{
                display: 'inline-block', padding: '2px 12px', borderRadius: 'var(--radius-sm)',
                background: deviceInfo?.current_slot === 'a' ? 'rgba(88,166,255,0.15)' : 'rgba(16,185,129,0.15)',
                color: deviceInfo?.current_slot === 'a' ? 'var(--accent-primary)' : 'var(--accent-secondary)',
                fontWeight: 700, fontSize: 16,
              }}>
                {deviceInfo?.current_slot ? `Slot ${deviceInfo.current_slot.toUpperCase()}` : 'N/A'}
              </span>
            </div>
          </div>
        </div>
        <div className="info-grid-3">
          <div className="info-box info-box-accent">
            <div className="info-box-label"><Battery size={14} /> 电池</div>
            <div className="info-box-value">{deviceInfo?.battery || 'N/A'}</div>
          </div>
          <div className="info-box info-box-accent">
            <div className="info-box-label"><Cpu size={14} /> CPU</div>
            <div className="info-box-value">{deviceInfo?.cpu_usage || '0'}%</div>
          </div>
          <div className="info-box info-box-accent">
            <div className="info-box-label"><MemoryStick size={14} /> 内存</div>
            <div className="info-box-value">{deviceInfo?.memory_mb || '0'}%</div>
          </div>
        </div>
        <div className="info-grid-1">
          <div className="info-box">
            <div className="info-box-label"><Wifi size={14} /> IP 地址</div>
            <div className="info-box-value" style={{ fontFamily: 'monospace' }}>{deviceInfo?.ip || 'N/A'}</div>
          </div>
        </div>
      </div>

      {/* All Devices */}
      <div className="card">
        <div className="card-title">已连接设备 ({devices.length})</div>
        <table className="process-table">
          <thead><tr><th>状态</th><th>Serial</th><th>型号</th></tr></thead>
          <tbody>
            {devices.map(d => (
              <tr key={d.serial}
                onClick={() => onSelectDevice(d.serial)}
                style={{ cursor: 'pointer', background: d.serial === selectedDevice ? 'rgba(88,166,255,0.1)' : undefined }}>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {getStatusIcon(d.state)}
                    <span className={`badge ${d.state === 'device' ? 'badge-green' : d.state === 'unauthorized' ? 'badge-warning' : 'badge-red'}`}>
                      {getStatusText(d.state)}
                    </span>
                  </span>
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.serial}</td>
                <td>{d.serial === selectedDevice ? (matchedDevice?.specs?.codeName || matchedDevice?.name || d.model || 'N/A') : (d.model || 'N/A')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
