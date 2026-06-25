import { useState, useRef, useEffect } from 'react'
import { invoke, CmdResult, AdbDevice, DeviceInfo, authAutoStopIPC, AuthState } from '../api/electron-bridge'
import {
  Smartphone, Battery, Cpu, MemoryStick, Wifi, HardDrive, RefreshCw,
  CheckCircle, AlertTriangle, XCircle, Info, Tag, Calendar, Factory, Copy, Check,
  Camera, FileText, RotateCcw, Zap,
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
  authState?: AuthState | null
  authAutoStartIPC?: (serial: string) => Promise<any>
}

export default function DevicePage({
  selectedDevice, devices, deviceInfo, showNotif, onSelectDevice, connectedDeviceInfo, onRefresh, authState, authAutoStartIPC
}: Props) {
  const [authenticating, setAuthenticating] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [screenshotting, setScreenshotting] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [rebooting, setRebooting] = useState(false)
  const [enteringFastboot, setEnteringFastboot] = useState(false)
  const [factoryResetting, setFactoryResetting] = useState(false)
  const [usbDebugOn, setUsbDebugOn] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [specsExpanded, setSpecsExpanded] = useState(false) // 设备规格折叠状态，默认折叠

  const refreshDeviceInfo = async (silent = false) => {
    if (!selectedDevice) return
    // 静默刷新（自动轮询）不改变按钮状态
    if (!silent) setRefreshing(true)
    try {
      // 调用父组件的刷新函数
      if (onRefresh) {
        await onRefresh()
      }
      if (!silent) showNotif('success', '设备信息已刷新')
    } catch (e) { 
      console.error('刷新失败', e)
      if (!silent) showNotif('error', '刷新设备信息失败')
    }
    if (!silent) setRefreshing(false)
  }

  // 静默轮询：设备列表无变化时不重复刷新，避免按钮文字闪烁
  const devicesRef = useRef<AdbDevice[]>([])
  const selectedDeviceRef = useRef<string>(selectedDevice)

  useEffect(() => {
    const changed =
      devices.length !== devicesRef.current.length ||
      !devices.every(d => devicesRef.current.some(p => p.serial === d.serial)) ||
      selectedDevice !== selectedDeviceRef.current
    if (changed) {
      refreshDeviceInfo(true) // silent
    }
    devicesRef.current = devices
    selectedDeviceRef.current = selectedDevice
  }, [devices, selectedDevice])

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
      const cleanText = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      await navigator.clipboard.writeText(cleanText)
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

  const doFactoryReset = async () => {
    if (!selectedDevice) return
    if (!confirm('确定要恢复出厂设置吗？设备将重启并清除所有数据。')) return
    setFactoryResetting(true)
    try {
      const r = await invoke<CmdResult>('factory_reset', { serial: selectedDevice })
      showNotif(r?.success ? 'success' : 'error', r?.success ? '设备正在进入恢复模式...' : r?.error || '恢复出厂失败')
    } catch (e) { showNotif('error', String(e)) }
    setFactoryResetting(false)
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
      const interval = Math.max(500, refreshInterval) // 最小500ms，避免过高CPU占用
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

      {/* ===== 重新设计的设备信息区域 ===== */}
      <div className="device-hero-card">
        {/* 第一行：图片 + 基本信息 + 状态 */}
        <div className="device-hero-header">
          {/* 设备图片 */}
          <div className="device-hero-image">
            {matchedDevice?.image ? (
              <img
                src={matchedDevice.image} alt={matchedDevice.name}
                onError={(e) => { e.currentTarget.style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove('hidden') }}
              />
            ) : null}
            <div className={`device-hero-placeholder ${matchedDevice?.image ? 'hidden' : ''}`}>
              {matchedDevice?.category === 'pen' ? '✏️' : matchedDevice?.category === 'audio' ? '🎧' : '📱'}
            </div>
          </div>

          {/* 设备基本信息 */}
          <div className="device-hero-info">
            <div className="device-hero-name">{matchedDevice?.name || deviceInfo?.sku || '未知设备'}</div>
            <div className="device-hero-meta">
              <span className="device-hero-version">{deviceInfo?.version || 'N/A'}</span>
              <span className="device-hero-divider">·</span>
              <span className="device-hero-serial" title={selectedDevice}>SN: {selectedDevice.slice(0, 16)}...</span>
            </div>
          </div>

          {/* 状态标签 */}
          <div className="device-hero-status">
            <div className={`device-status-badge ${currentDevice?.state === 'device' ? 'connected' : currentDevice?.state === 'unauthorized' ? 'warning' : 'error'}`}>
              {getStatusIcon(currentDevice?.state || '')}
              <span>{getStatusText(currentDevice?.state || '')}</span>
            </div>
          </div>
        </div>

        {/* 认证相关操作 */}
        <div className="device-hero-auth">
          {currentDevice?.state === 'unauthorized' && (
            <button className="btn btn-primary btn-sm" onClick={authenticate} disabled={authenticating}>
              {authenticating ? '认证中...' : '点击授权'}
            </button>
          )}

          {/* 自动认证进度显示 */}
          {authState?.serial === selectedDevice && authState.trying && (
            <div className="auth-progress">
              <RefreshCw size={12} className="spinning" />
              <span>
                {authState.current === -1
                  ? '尝试已保存密码...'
                  : `正在认证 (${authState.current}/${authState.total})...`}
              </span>
              <div className="auth-progress-bar">
                <div className="auth-progress-fill" style={{ width: `${Math.round((authState.current / authState.total) * 100)}%` }} />
              </div>
              <button className="btn btn-secondary btn-xs" onClick={() => authAutoStopIPC(selectedDevice)}>停止</button>
            </div>
          )}

          {/* 认证成功 */}
          {authState?.serial === selectedDevice && authState.success && authState.found && (
            <div className="auth-status success">
              <CheckCircle size={12} />
              <span>已认证成功（密钥 #{authState.current}）</span>
            </div>
          )}

          {/* 认证失败 */}
          {authState?.serial === selectedDevice && !authState.trying && !authState.success && (
            <div className="auth-status error">
              <AlertTriangle size={12} />
              <span>认证失败，请手动检查</span>
            </div>
          )}

          <button className="btn btn-secondary btn-sm" onClick={() => { authAutoStartIPC?.(selectedDevice) }}>
            <RefreshCw size={12} /> 重新认证
          </button>
        </div>

        {/* 功能按钮分组 */}
        <div className="device-hero-actions">
          {/* 常用操作组 */}
          <div className="action-group">
            <div className="action-group-title">常用</div>
            <div className="action-group-buttons">
              <button className="action-btn" onClick={() => refreshDeviceInfo(false)} disabled={refreshing}>
                <RefreshCw size={14} className={refreshing ? 'spinning' : ''} />
                <span>{refreshing ? '刷新中' : '刷新'}</span>
              </button>
              <button className="action-btn" onClick={takeScreenshot} disabled={screenshotting}>
                <Camera size={14} />
                <span>{screenshotting ? '截图中' : '截图'}</span>
              </button>
              <button className="action-btn" onClick={extractLogs} disabled={extracting}>
                <FileText size={14} />
                <span>{extracting ? '提取中' : '日志'}</span>
              </button>
            </div>
          </div>

          {/* 实时监控组 */}
          <div className="action-group">
            <div className="action-group-title">监控</div>
            <div className="action-group-buttons">
              <button className={`action-btn ${screenPreviewOn ? 'active' : ''}`} onClick={toggleScreenPreview}>
                <Camera size={14} />
                <span>{screenPreviewOn ? '停止' : '画面'}</span>
              </button>
              <div className="action-input-wrap">
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
                  title="刷新间隔(ms)"
                />
                <span>ms</span>
              </div>
            </div>
          </div>

          {/* 设备控制组 */}
          <div className="action-group">
            <div className="action-group-title">控制</div>
            <div className="action-group-buttons">
              <button className="action-btn warning" onClick={rebootDevice} disabled={rebooting}>
                <RotateCcw size={14} />
                <span>{rebooting ? '重启中' : '重启'}</span>
              </button>
              <button className="action-btn danger" onClick={doFactoryReset} disabled={factoryResetting}>
                <Factory size={14} />
                <span>{factoryResetting ? '恢复中' : '恢复出厂'}</span>
              </button>
              <button className="action-btn danger" onClick={enterFastboot} disabled={enteringFastboot}>
                <Zap size={14} />
                <span>{enteringFastboot ? '进入中' : '刷机'}</span>
              </button>
              <button className={`action-btn ${usbDebugOn ? 'success' : ''}`} onClick={toggleUsbDebug} disabled={usbDebugLoading} title="USB调试保持">
                <Zap size={14} />
                <span>{usbDebugLoading ? '...' : usbDebugOn ? '关调试' : '开调试'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 实时画面预览 */}
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

      {/* Device Specs — Collapsible */}
      {matchedDevice?.specs && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div 
            className="card-title" 
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            onClick={() => setSpecsExpanded(!specsExpanded)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Info size={16} /> 设备规格
            </span>
            <span style={{ 
              fontSize: 11, 
              color: 'var(--text-muted)', 
              display: 'flex', 
              alignItems: 'center', 
              gap: 4 
            }}>
              {specsExpanded ? '收起' : '展开'}
              <span style={{ 
                display: 'inline-block', 
                transform: specsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease'
              }}>▼</span>
            </span>
          </div>
          {specsExpanded && (
            <div className="specs-grid" style={{ animation: 'slideDown 0.2s ease' }}>
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
          )}
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
