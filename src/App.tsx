import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke, AdbDevice, DeviceInfo, PerformanceData, CmdResult, authStateSubscribe, authAutoStartIPC, AuthState, deviceChangeSubscribe, onAuthDeviceInfoRefresh } from './api/electron-bridge'
import { 
  Terminal, Package, FileCode, FlaskConical, Wrench, 
  RefreshCw, Palette, FolderOpen, Zap, Battery, Cpu, MemoryStick, 
  Activity, Clock, Smartphone, Wifi, Minus, Square, X, History, Copy, Check
} from 'lucide-react'

import DevicePage from './pages/DevicePage'
import PerfPage from './pages/PerfPage'
import ShellPage from './pages/ShellPage'
import AppPage from './pages/AppPage'
import ScriptEditorPage from './pages/ScriptEditorPage'
import TestPage from './pages/TestPage'
import ToolsPage from './pages/ToolsPage'
import FileManagerPage from './pages/FileManagerPage'
import HistoryPage from './pages/HistoryPage'
import { themes, applyTheme, saveTheme, loadTheme, isLightTheme } from './styles/themes'
import { getDeviceBySku } from './config/deviceConfig'
import { addHistory } from './utils/history'
import { ErrorBoundary } from './components/ErrorBoundary'

// 性能监控数据类型
type DataPoint = {
  time: string
  t: number
  cpu: number
  mem: number
  battery: number
  cpuTemp: number
  batTemp: number
}

type ProcessInfo = {
  label: string
  pid?: number
  vmrss?: number
  threads?: number
}

type Page = 'device' | 'perf' | 'shell' | 'app' | 'script' | 'test' | 'tools' | 'files' | 'history'

const NAV_ITEMS = [
  { id: 'device' as Page, label: '设备管理', icon: Smartphone, shortcut: '1', color: '#00d4ff', desc: '连接设备、查看详情' },
  { id: 'perf' as Page, label: '性能监控', icon: Activity, shortcut: '2', color: '#10b981', desc: 'CPU、内存、电池实时监控' },
  { id: 'shell' as Page, label: 'Shell终端', icon: Terminal, shortcut: '3', color: '#a855f7', desc: '执行ADB Shell命令' },
  { id: 'app' as Page, label: '应用管理', icon: Package, shortcut: '4', color: '#f59e0b', desc: '安装APK、管理小程序' },
  { id: 'files' as Page, label: '文件管理', icon: FolderOpen, shortcut: '5', color: '#8b5cf6', desc: '浏览设备文件系统' },
  { id: 'script' as Page, label: '脚本编辑', icon: FileCode, shortcut: '6', color: '#ef4444', desc: '可视化脚本编辑与执行' },
  { id: 'test' as Page, label: '测试套件', icon: FlaskConical, shortcut: '7', color: '#ec4899', desc: '稳定性、功耗测试' },
  { id: 'tools' as Page, label: '工具箱', icon: Wrench, shortcut: '8', color: '#06b6d4', desc: '截图、WiFi、固件等工具' },
  { id: 'history' as Page, label: '历史记录', icon: History, shortcut: '9', color: '#64748b', desc: '操作历史' },
]

const winMinimize = () => invoke<{}>('window_minimize', {})
const winMaximize = () => invoke<{}>('window_maximize', {})
const winClose = () => invoke<{}>('window_close', {})

function App() {
  const [activePage, setActivePage] = useState<Page>('device')
  const [devices, setDevices] = useState<AdbDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [perfData, setPerfData] = useState<PerformanceData | null>(null)
  // 性能监控历史数据（跨 Tab 保留）
  const [perfHistory, setPerfHistory] = useState<DataPoint[]>([])
  const [perfLive, setPerfLive] = useState<DataPoint | null>(null)
  const [perfProcesses, setPerfProcesses] = useState<ProcessInfo[]>([])
  const [notif, setNotif] = useState<{ type: string; text: string } | null>(null)
  const [currentTheme, setCurrentTheme] = useState<string>(loadTheme())
  const [showThemePanel, setShowThemePanel] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [connectedDeviceInfo, setConnectedDeviceInfo] = useState<DeviceInfo | null>(null)
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [infoCopied, setInfoCopied] = useState(false)

  const showNotifRef = useRef<(type: string, text: string) => void>(() => {})

  const showNotif = useCallback((type: string, text: string) => {
    setNotif({ type, text })
    setTimeout(() => setNotif(null), 3000)
  }, [])
  showNotifRef.current = showNotif

  const copyDeviceInfo = useCallback(() => {
    if (!deviceInfo) return
    const lines = [
      `设备序列号: ${deviceInfo.serial}`,
      `SKU: ${deviceInfo.sku || '-'}`,
      `版本: ${deviceInfo.version || '-'}`,
      `分区: ${deviceInfo.partition || '-'}`,
      `当前槽位: ${deviceInfo.current_slot || '-'}`,
      `电池: ${deviceInfo.battery || '-'}`,
      `内存: ${deviceInfo.memory_mb || '-'}%`,
      `IP: ${deviceInfo.ip || '-'}`,
    ]
    const text = lines.join('\n')
    console.log('[copyDeviceInfo] copying:', text.substring(0, 50))
    setInfoCopied(true)
    setTimeout(() => setInfoCopied(false), 2000)
    invoke<{ success: boolean }>('copy_to_clipboard', { text }).then(r => {
      console.log('[copyDeviceInfo] result:', r)
      if (r?.success) {
        showNotifRef.current('success', '设备信息已复制到剪贴板')
      } else {
        showNotifRef.current('error', '复制失败')
      }
    }).catch(e => {
      console.error('[copyDeviceInfo] error:', e)
      navigator.clipboard.writeText(text).catch(() => {})
      showNotifRef.current('success', '设备信息已复制到剪贴板')
    })
  }, [deviceInfo])

  // 用 ref 避免 auth callback 依赖问题
  const refreshDeviceInfoRef = useRef<() => void>(() => {})
  // 用 ref 捕获 devices 避免 setDevices 触发 useCallback 重建（多定时器叠加）
  const devicesRef = useRef<AdbDevice[]>(devices ?? [])
  devicesRef.current = devices ?? []

  useEffect(() => {
    const theme = themes[currentTheme]
    applyTheme(theme)
    document.body.setAttribute('data-nav-style', theme.colors.navStyle || 'fill')
    // Set html data-theme for CSS overrides
    document.documentElement.setAttribute('data-theme', isLightTheme(currentTheme) ? 'light' : 'dark')
    
    // 添加主题切换动画 — 仅对颜色相关属性过渡，避免重排性能问题
    document.body.style.transition = 'background-color 0.3s ease, color 0.3s ease'
    const timer = setTimeout(() => {
      document.body.style.transition = ''
    }, 300)
    return () => clearTimeout(timer)
  }, [currentTheme])
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const idx = parseInt(e.key) - 1
        if (NAV_ITEMS[idx]) setActivePage(NAV_ITEMS[idx].id)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); refreshDevices(true) }
      if ((e.ctrlKey || e.metaKey) && e.key === 't') { e.preventDefault(); setShowThemePanel(p => !p) }
      if (e.key === 'Escape') setShowThemePanel(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    invoke<CmdResult>('check_adb_available').then(r => { if (!r?.success) showNotif('error', 'ADB 未安装') })
  }, [])

  // 订阅 auth 状态变化（自动轮询进度）
  useEffect(() => {
    const unsub = authStateSubscribe((state) => {
      setAuthState(state)
      // 认证成功后刷新设备信息（由 auth_device_info_refresh 事件单独处理，不再在此重复）
    })
    return unsub
  }, [])

  // 订阅认证成功后的设备信息刷新通知（防抖：1秒内只刷新一次）
  const authRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const unsub = onAuthDeviceInfoRefresh(({ serial }) => {
      console.log('[AUTH] 认证成功，刷新设备信息:', serial)
      // 防抖：多次认证事件只触发一次刷新
      if (authRefreshTimerRef.current) clearTimeout(authRefreshTimerRef.current)
      authRefreshTimerRef.current = setTimeout(() => {
        authRefreshTimerRef.current = null
        refreshDeviceInfoRef.current?.()
      }, 1000)
    })
    return unsub
  }, [])

  // 订阅 track-devices 实时设备变化（替代5秒轮询作为快速响应）
  const trackHandledRef = useRef(new Set<string>())  // 已处理过的设备serial，防止重复
  useEffect(() => {
    const unsub = deviceChangeSubscribe((trackDevices) => {
      console.log('[TRACK] 设备变化:', trackDevices)
      if (!trackDevices || trackDevices.length < 0) return

      const prevSerials = new Set((devicesRef.current ?? []).map(d => d.serial))
      const newOnlineDevices = trackDevices.filter(d => d.state === 'device' && !prevSerials.has(d.serial))

      // 更新设备列表
      setDevices(trackDevices)

      if (trackDevices.length > 0) {
        // 如果选中的设备不在列表中，自动选第一个
        if (!trackDevices.find(d => d.serial === selectedDevice)) {
          setSelectedDevice(trackDevices[0].serial)
        }
        // 只对真正的新设备触发认证和历史记录
        for (const d of newOnlineDevices) {
          if (!trackHandledRef.current.has(d.serial)) {
            trackHandledRef.current.add(d.serial)
            authAutoStartIPC(d.serial).catch(() => {})
            // 获取设备信息并记录历史
            invoke<any>('get_device_info', { serial: d.serial }).then(info => {
              setDeviceInfo(info)
              if (info?.sku) {
                const matched = getDeviceBySku(info.sku)
                setConnectedDeviceInfo(matched)
              }
              const detail = info?.version
                ? `版本: ${info.version} · 型号: ${info.sku || d.model || '-'} · SN: ${info.serial || d.serial}`
                : `SN: ${d.serial}${d.model ? ' · 型号: ' + d.model : ''}`
              addHistory({ device: d.serial, category: 'device', action: '设备连接', detail, status: 'success' })
            }).catch(() => {
              addHistory({ device: d.serial, category: 'device', action: '设备连接', detail: `SN: ${d.serial}${d.model ? ' · 型号: ' + d.model : ''}`, status: 'success' })
            })
          }
        }
      } else {
        // 所有设备断开，清除已处理记录
        setSelectedDevice('')
        setDeviceInfo(null)
        setConnectedDeviceInfo(null)
        trackHandledRef.current.clear()
      }

      // 清理已断开设备的记录
      const currentSerials = new Set(trackDevices.map(d => d.serial))
      for (const s of trackHandledRef.current) {
        if (!currentSerials.has(s)) trackHandledRef.current.delete(s)
      }
    })
    return unsub
  }, [selectedDevice])

  // 使用 ref 存储 selectedDevice，避免 refreshDevices 因依赖变化而频繁重建
  const selectedDeviceRef = useRef(selectedDevice)
  selectedDeviceRef.current = selectedDevice

  const refreshDevices = useCallback(async (showIndicator = false) => {
    if (showIndicator) setIsRefreshing(true)
    try {
      const devs = await invoke<AdbDevice[]>('get_devices')
      // 用 ref 捕获上次的设备列表，避免 setDevices 触发 useCallback 重建
      const prevSerials = new Set((devicesRef.current ?? []).map(d => d.serial))
      setDevices(devs ?? [])

      const currentSelected = selectedDeviceRef.current
      if ((devs?.length ?? 0) > 0 && !devs?.find(d => d.serial === currentSelected)) {
        setSelectedDevice(devs![0].serial)
      }

      for (const d of devs ?? []) {
        if (d.state === 'device') {
          // 始终触发认证（设备重启后 skip 脚本消失，需要重新轮询）
          authAutoStartIPC(d.serial).catch(() => {})
          // 新设备连接时记录历史
          if (!prevSerials.has(d.serial)) {
            invoke<any>('get_device_info', { serial: d.serial }).then(info => {
              const detail = info?.version
                ? `版本: ${info.version} · 型号: ${info.sku || d.model || '-'} · SN: ${info.serial || d.serial}`
                : `SN: ${d.serial}${d.model ? ' · 型号: ' + d.model : ''}`
              addHistory({ device: d.serial, category: 'device', action: '设备连接', detail, status: 'success' })
            }).catch(() => {
              addHistory({ device: d.serial, category: 'device', action: '设备连接', detail: `SN: ${d.serial}${d.model ? ' · 型号: ' + d.model : ''}`, status: 'success' })
            })
          }
        }
      }
    } catch (e) {
      console.error('获取设备列表失败:', e)
      showNotif('error', '获取设备列表失败')
    }
    if (showIndicator) setIsRefreshing(false)
  }, []) // 空依赖数组，内部通过 ref 读取最新值

  useEffect(() => {
    refreshDevices()
    // track-devices 实时监听作为主要推送，3秒轮询作为心跳兜底（更快响应）
    // 窗口切回时立即刷新以获取最新状态
    const interval = setInterval(refreshDevices, 3000)
    const onVisible = () => { 
      if (document.visibilityState === 'visible') { 
        // 清理已处理记录，确保后台回来后能重新触发认证
        trackHandledRef.current.clear(); 
        refreshDevices(); 
      } 
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshDevices])

  useEffect(() => {
    if (!selectedDevice) { setDeviceInfo(null); setConnectedDeviceInfo(null); return }
    invoke<DeviceInfo>('get_device_info', { serial: selectedDevice })
      .then(info => {
        setDeviceInfo(info)
        if (info?.sku) {
          const matched = getDeviceBySku(info.sku)
          setConnectedDeviceInfo(matched)
        }
      })
      .catch((e) => {
        console.error('获取设备信息失败:', e)
        setDeviceInfo(null)
      })
  }, [selectedDevice])

  useEffect(() => {
    if (!selectedDevice || activePage !== 'perf') return
    const fetch = () => {
      invoke<PerformanceData>('get_performance_monitor', { serial: selectedDevice })
        .then(setPerfData)
        .catch((e) => console.error('获取性能数据失败:', e))
    }
    fetch()
    const interval = setInterval(fetch, 2000)
    return () => clearInterval(interval)
  }, [selectedDevice, activePage])

  // 刷新设备详细信息
  const refreshDeviceInfo = useCallback(async () => {
    if (!selectedDevice) return
    try {
      const info = await invoke<DeviceInfo>('get_device_info', { serial: selectedDevice })
      setDeviceInfo(info)
      if (info?.sku) {
        const matched = getDeviceBySku(info.sku)
        setConnectedDeviceInfo(matched)
      }
    } catch (e) {
      console.error('刷新设备信息失败:', e)
    }
  }, [selectedDevice])
  refreshDeviceInfoRef.current = refreshDeviceInfo

  const pageProps = {
    selectedDevice, devices, deviceInfo, perfData,
    showNotif, onSelectDevice: setSelectedDevice, onRefreshDevices: refreshDevices,
    connectedDeviceInfo, onRefresh: refreshDeviceInfo,
    authState, authAutoStartIPC,
    // 性能监控状态（跨 Tab 保留）
    perfHistory, setPerfHistory,
    perfLive, setPerfLive,
    perfProcesses, setPerfProcesses,
  }

  const currentPage = NAV_ITEMS.find(n => n.id === activePage)
  const connectedCount = devices.filter(d => d.state === 'device').length

  return (
    <div className="app-layout">
      <div className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon"><Zap size={20} /></div>
          <div>
            <div className="logo-text">智能硬件</div>
            <div className="logo-version">v1.0 · zhaojia08</div>
          </div>
        </div>
        
        {devices.length > 0 && (
          <div className="device-selector-box">
            <div className="device-selector-label">当前设备</div>
            <select className="device-select-full" value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)}>
              {devices.map(d => (
                <option key={d.serial} value={d.serial}>
                  {d.state === 'device' ? '✓ ' : '○ '}{d.serial.slice(0, 16)}...
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <div
              key={item.id}
              className={`nav-item ${activePage === item.id ? 'active' : ''}`}
              onClick={() => setActivePage(item.id)}
              title={item.desc}
            >
              <span className="nav-icon" style={{ color: activePage === item.id ? item.color : undefined }}>
                <item.icon size={18} />
              </span>
              <span className="nav-label">{item.label}</span>
              <span className="nav-shortcut">{item.shortcut}</span>
            </div>
          ))}
        </div>

        {deviceInfo && (
          <div className="sidebar-stats">
            <div className="stats-title">实时状态</div>
            <div className="stats-grid">
              <div className="stat-item"><Battery size={14} /><span>{deviceInfo.battery}</span></div>
              <div className="stat-item"><Cpu size={14} /><span>{deviceInfo.cpu_usage}%</span></div>
              <div className="stat-item"><MemoryStick size={14} /><span>{deviceInfo.memory_mb}%</span></div>
              <div className="stat-item"><Wifi size={14} /><span>{deviceInfo.ip?.split('.').slice(-2).join('.') || '—'}</span></div>
            </div>
          </div>
        )}
        
        <div className="sidebar-bottom">
          <button className="sidebar-btn" onClick={() => setShowThemePanel(true)}>
            <Palette size={16} /><span>主题</span>
          </button>
          <button className="sidebar-btn" onClick={() => refreshDevices(true)} disabled={isRefreshing}>
            <RefreshCw size={16} className={isRefreshing ? 'spinning' : ''} /><span>刷新</span>
          </button>
        </div>
      </div>

      <div className="main-content">
        <div className="header-bar">
          <div className="header-title">
            {currentPage && <currentPage.icon size={18} style={{ color: currentPage.color }} />}
            <span>{currentPage?.label}</span>
          </div>
          <div className="header-right">
            {deviceInfo && (
              <div className="header-device-stats">
                {deviceInfo.battery != null && (
                  <div className="header-stat" title="电量">
                    <Battery size={12} style={{ color: Number(deviceInfo.battery) < 20 ? 'var(--accent-error)' : 'var(--accent-secondary)' }} />
                    <span>{deviceInfo.battery}</span>
                  </div>
                )}
                {deviceInfo.memory_mb != null && (
                  <div className="header-stat" title="内存">
                    <MemoryStick size={12} style={{ color: 'var(--accent-purple)' }} />
                    <span>{deviceInfo.memory_mb}%</span>
                  </div>
                )}
                {deviceInfo.ip && (
                  <div className="header-stat" title="IP">
                    <Wifi size={12} style={{ color: 'var(--accent-primary)' }} />
                    <span style={{ fontSize: 10 }}>{deviceInfo.ip}</span>
                  </div>
                )}
                <div className="header-sep" />
                <button
                  className="header-stat"
                  onClick={copyDeviceInfo}
                  title="复制设备信息"
                  style={{ cursor: 'pointer', background: 'none', border: 'none', gap: 4, ...( { WebkitAppRegion: 'no-drag' } as React.CSSProperties ) }}
                >
                  {infoCopied ? <Check size={12} style={{ color: 'var(--accent-secondary)' }} /> : <Copy size={12} style={{ color: 'var(--text-muted)' }} />}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{infoCopied ? '已复制' : '复制信息'}</span>
                </button>
              </div>
            )}
            <div className={`connection-status ${connectedCount > 0 ? 'online' : 'offline'}`}>
              <span className="status-dot"></span>
              <span>{connectedCount > 0 ? `${connectedCount} 设备` : '未连接'}</span>
            </div>
            <div className="time-display">
              <Clock size={12} />
              {currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          </div>
          <div className="window-controls">
            <button className="win-ctrl-btn" onClick={winMinimize} title="最小化"><Minus size={14} /></button>
            <button className="win-ctrl-btn" onClick={winMaximize} title="最大化"><Square size={12} /></button>
            <button className="win-ctrl-btn win-ctrl-close" onClick={winClose} title="关闭"><X size={14} /></button>
          </div>
        </div>

        <div className="page-content">
          <ErrorBoundary>
            {activePage === 'device' && <DevicePage {...pageProps} />}
            {activePage === 'perf' && <PerfPage {...pageProps} />}
            {activePage === 'shell' && <ShellPage {...pageProps} />}
            {activePage === 'app' && <AppPage {...pageProps} />}
            {activePage === 'script' && <ScriptEditorPage {...pageProps} />}
            {activePage === 'test' && <TestPage {...pageProps} />}
            {activePage === 'tools' && <ToolsPage {...pageProps} />}
            {activePage === 'files' && <FileManagerPage {...pageProps} />}
            {activePage === 'history' && <HistoryPage />}
          </ErrorBoundary>
        </div>
      </div>

      {notif && <div className={`notification ${notif.type}`}>{notif.text}</div>}

      {/* 全局加载指示器 */}
      {isRefreshing && (
        <div style={{
          position: 'fixed',
          top: '60px',
          right: '20px',
          zIndex: 9999,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          animation: 'slideIn 0.3s ease'
        }}>
          <RefreshCw size={16} className="spinning" style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>刷新中...</span>
        </div>
      )}

      {showThemePanel && (
        <div className="theme-panel-overlay" onClick={() => setShowThemePanel(false)}>
          <div className="theme-panel" onClick={e => e.stopPropagation()}>
            <div className="theme-panel-header">
              <h3><Palette size={18} /> 主题设置</h3>
              <button className="close-btn" onClick={() => setShowThemePanel(false)}>×</button>
            </div>
            <div className="theme-list">
              {Object.entries(themes).map(([key, theme]) => (
                <button
                  key={key}
                  className={`theme-item ${currentTheme === key ? 'active' : ''}`}
                  onClick={() => { setCurrentTheme(key); saveTheme(key) }}
                >
                  <div 
                    className="theme-preview" 
                    style={{ 
                      background: `linear-gradient(135deg, ${theme.colors.accentPrimary} 0%, ${theme.colors.accentSecondary} 100%)`,
                      boxShadow: currentTheme === key ? `0 0 20px ${theme.colors.accentPrimary}40` : 'none'
                    }} 
                  />
                  <div style={{ textAlign: 'left', flex: 1 }}>
                    <div style={{ fontWeight: currentTheme === key ? 600 : 400, fontSize: '14px' }}>{theme.name}</div>
                    {theme.subname && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: '2px' }}>{theme.subname}</div>}
                  </div>
                  {currentTheme === key && (
                    <div style={{ 
                      width: '20px', 
                      height: '20px', 
                      borderRadius: '50%', 
                      background: theme.colors.accentPrimary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      color: '#fff',
                      fontWeight: 'bold'
                    }}>✓</div>
                  )}
                </button>
              ))}
            </div>
            <div style={{ 
              marginTop: '12px', 
              padding: '10px', 
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '8px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              textAlign: 'center'
            }}>
              💡 提示: 按 Ctrl+T 快速打开主题面板
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
