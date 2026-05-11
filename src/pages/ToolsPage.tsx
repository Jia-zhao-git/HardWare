import { useState, useCallback, useEffect } from 'react'
import { invoke, CmdResult } from '../api/electron-bridge'
import { Camera, RotateCcw, Zap, Wifi, WifiOff, Monitor, Shield, Globe, Terminal, Search, FileText, AlertTriangle, BookOpen, Trash2, RefreshCw, HardDrive, Play, Key, FileCheck } from 'lucide-react'
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

// 破坏性测试操作定义
const DESTRUCTIVE_OPS = [
  {
    id: 'break_a',
    label: '破坏 A 分区',
    desc: 'dd 清零 boot_a → 重启',
    cmd: 'mount -o remount,rw / && dd if=/dev/zero of=/dev/block/by-name/boot_a bs=1M count=16',
    reboot: true,
    warn: '此操作将清零 boot_a 分区，设备将无法从 A 槽启动！',
  },
  {
    id: 'break_b',
    label: '破坏 B 分区',
    desc: 'dd 清零 boot_b → 重启',
    cmd: 'mount -o remount,rw / && dd if=/dev/zero of=/dev/block/by-name/boot_b bs=1M count=16',
    reboot: true,
    warn: '此操作将清零 boot_b 分区，设备将无法从 B 槽启动！',
  },
  {
    id: 'break_ab_boot',
    label: '破坏 AB 分区 (boot)',
    desc: 'dd 清零 boot_a + boot_b → 重启',
    cmd: 'mount -o remount,rw / && dd if=/dev/zero of=/dev/block/by-name/boot_a bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/boot_b bs=1M count=16',
    reboot: true,
    warn: '此操作将同时清零 boot_a 和 boot_b，设备将完全无法启动！',
  },
  {
    id: 'break_ab_system',
    label: '破坏 AB 分区 (system)',
    desc: 'dd 清零 system_a/b + rootfs_a/b → 重启',
    cmd: 'mount -o remount,rw / && dd if=/dev/zero of=/dev/block/by-name/system_a bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/system_b bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/rootfs_a bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/rootfs_b bs=1M count=16',
    reboot: true,
    warn: '此操作将清零 system_a/b 和 rootfs_a/b，设备将完全无法启动！',
  },
  {
    id: 'break_aboot_bsystem',
    label: 'A-boot + B-system',
    desc: 'dd 清零 boot_a + system_b + rootfs_b → 重启',
    cmd: 'mount -o remount,rw / && dd if=/dev/zero of=/dev/block/by-name/boot_a bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/system_b bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/rootfs_b bs=1M count=16',
    reboot: true,
    warn: '此操作将清零 A 分区 boot 和 B 分区 system/rootfs！',
  },
  {
    id: 'break_asystem_bboot',
    label: 'A-system + B-boot',
    desc: 'dd 清零 system_a + rootfs_a + boot_b → 重启',
    cmd: 'mount -o remount,rw / && dd if=/dev/zero of=/dev/block/by-name/system_a bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/rootfs_a bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/boot_b bs=1M count=16',
    reboot: true,
    warn: '此操作将清零 A 分区 system/rootfs 和 B 分区 boot！',
  },
  {
    id: 'fill_dictdata',
    label: '填充 DictData',
    desc: 'dd 清零 boot_a/b + DictPenData/CapData/a.bin → 重启',
    cmd: 'mount -o remount,rw / && dd if=/dev/zero of=/dev/block/by-name/boot_a bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/boot_b bs=1M count=16 && dd if=/dev/zero of=/data/DictPenData/CapData/a.bin count=99',
    reboot: true,
    warn: '此操作将清零 boot_a/b 并填充 DictData，设备将无法启动！',
  },
  {
    id: 'delete_wpa',
    label: '删除 WPA',
    desc: 'rm wpa_supplicant.conf + dd 清零 boot_a/b → 重启',
    cmd: 'mount -o remount,rw / && rm -rf /userdata/cfg/wpa_supplicant.conf && dd if=/dev/zero of=/dev/block/by-name/boot_a bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/boot_b bs=1M count=16',
    reboot: true,
    warn: '此操作将删除 WiFi 配置并清零 boot_a/b！',
  },
  {
    id: 'y15_break_boot',
    label: 'Y15 破坏 Boot',
    desc: 'flash_erase /dev/block/by-name/boot → 重启',
    cmd: 'flash_erase /dev/block/by-name/boot 0 16',
    reboot: true,
    warn: '此操作将擦除 /dev/block/by-name/boot，设备将无法从 NAND 启动！',
  },
  {
    id: 'y15_break_rootfs',
    label: 'Y15 破坏 System',
    desc: 'flash_erase /dev/block/by-name/rootfs → 重启',
    cmd: 'flash_erase /dev/block/by-name/rootfs 0 16',
    reboot: true,
    warn: '此操作将擦除 /dev/block/by-name/rootfs，设备将无法进入系统！',
  },
  {
    id: 'fill_applog',
    label: '填充 applog',
    desc: 'dd 清零 boot_a/b + /data/applog/a.bin → 重启',
    cmd: 'mount -o remount,rw / && dd if=/dev/zero of=/dev/block/by-name/boot_a bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/boot_b bs=1M count=16 && dd if=/dev/zero of=/data/applog/a.bin count=99 bs=1M',
    reboot: true,
    warn: '此操作将清零 boot_a/b 并填充 applog 目录！',
  },
  {
    id: 'fill_syslog',
    label: '填充 syslog',
    desc: 'dd 清零 boot_a/b + /data/syslog/a.bin → 重启',
    cmd: 'mount -o remount,rw / && dd if=/dev/zero of=/dev/block/by-name/boot_a bs=1M count=16 && dd if=/dev/zero of=/dev/block/by-name/boot_b bs=1M count=16 && dd if=/dev/zero of=/data/syslog/a.bin count=99 bs=1M',
    reboot: true,
    warn: '此操作将清零 boot_a/b 并填充 syslog 目录！',
  },
  {
    id: 'recovery',
    label: '一键 Recovery',
    desc: 'adb reboot recovery',
    cmd: '__REBOOT_RECOVERY__',
    reboot: false,
    warn: '设备将重启进入 Recovery 模式。',
  },
]

const DICT_OPS = [
  {
    id: 'scan_dict',
    label: '扫描词典文件',
    desc: 'find /userdisk/uresource/localdict -name "*.dat"',
    cmd: 'find /userdisk/uresource/localdict -type f -name "*.dat"',
    confirm: false,
  },
  {
    id: 'del_single_dict',
    label: '删除单本词典',
    desc: 'rm dictpen-charV2.dat',
    cmd: 'rm /userdisk/uresource/localdict/dictpen-charV2.dat',
    confirm: true,
    warn: '将删除 dictpen-charV2.dat，操作不可恢复！',
  },
  {
    id: 'del_multi_dict',
    label: '删除多本词典',
    desc: 'rm *secondV2.dat',
    cmd: 'rm /userdisk/uresource/localdict/*secondV2.dat',
    confirm: true,
    warn: '将删除所有 *secondV2.dat 词典文件，操作不可恢复！',
  },
  {
    id: 'del_all_dict',
    label: '删除全部词典',
    desc: 'rm *.dat',
    cmd: 'rm /userdisk/uresource/localdict/*.dat',
    confirm: true,
    warn: '将删除全部 .dat 词典文件，操作不可恢复！',
  },
]

export default function ToolsPage({ selectedDevice, showNotif }: Props) {
  const [screenOn, setScreenOn] = useState(true)
  const [firmwareResult, setFirmwareResult] = useState<string>('')
  const [firmwareChecking, setFirmwareChecking] = useState(false)
  const [adbDebug, setAdbDebug] = useState(false)
  const [wifiList, setWifiList] = useState<{ssid: string; signal: string; security: string}[]>([])
  const [wifiPasswordDialog, setWifiPasswordDialog] = useState<{isOpen: boolean; ssid: string; security: string}>({ isOpen: false, ssid: '', security: '' })
  const [wifiPassword, setWifiPassword] = useState('')
  const [wifiConnecting, setWifiConnecting] = useState(false)
  // 从 localStorage 加载已保存的 WiFi 密码
  const [savedWifiPasswords, setSavedWifiPasswords] = useState<Record<string, string>>({})
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wifi_passwords')
      if (saved) setSavedWifiPasswords(JSON.parse(saved))
    } catch {}
  }, [])
  const [running, setRunning] = useState(false)
  const [destructRunning, setDestructRunning] = useState<string | null>(null)
  const [dictOutput, setDictOutput] = useState('')
  // 存储填充测试
  const [fillTotalMb, setFillTotalMb] = useState(0)
  const [fillCurrentMb, setFillCurrentMb] = useState(0)
  const [filling, setFilling] = useState(false)
  const [fillDone, setFillDone] = useState(false)
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
    showConfirm('重启设备', '设备将立即重启，当前正在运行的应用将被关闭。\n\n确定要重启设备吗？', 'warning', async () => {
      hideConfirm()
      const r = await run('reboot_device')
      if (r?.success) showNotif('info', '设备重启中...')
    })
  }, [showConfirm, hideConfirm, run, showNotif])

  const fastboot = useCallback(() => {
    showConfirm('进入刷机模式', '设备将进入 Fastboot/Loader 模式，可能需要数据线连接电脑进行刷机操作。\n\n此操作会使设备暂时无法通过 ADB 控制。', 'danger', async () => {
      hideConfirm()
      const r = await run('enter_fastboot')
      if (r?.success) showNotif('warning', '设备已进入刷机模式')
    })
  }, [showConfirm, hideConfirm, run, showNotif])

  const toggleScreenOn = async () => { await run('keep_screen_on', { enable: !screenOn }); setScreenOn(!screenOn) }
  const toggleAdbDebug = async () => { await run('keep_adb_debug', { enable: !adbDebug }); setAdbDebug(!adbDebug) }
  const doFirmwareCheck = async () => {
    if (!selectedDevice) return
    setFirmwareChecking(true)
    setFirmwareResult('')
    try {
      const r = await invoke<CmdResult>('firmware_check', { serial: selectedDevice })
      if (r?.success && r.output) {
        setFirmwareResult(r.output)
        showNotif('success', '固件校验完成')
      } else {
        setFirmwareResult(`错误：${r?.error || '校验失败'}`)
        showNotif('error', r?.error || '固件校验失败')
      }
    } catch (e) {
      const err = String(e)
      setFirmwareResult(`错误：${err}`)
      showNotif('error', err)
    }
    setFirmwareChecking(false)
  }
  const doLogRedirect = async () => { const r = await run('log_redirect'); if (r?.success) showNotif('success', '日志重定向配置完成') }

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

  const connectWifi = async (ssid: string, security: string) => {
    // 检查是否已保存密码
    const savedPwd = savedWifiPasswords[ssid]
    const hasPassword = security.toLowerCase().includes('wpa') || security.toLowerCase().includes('wep')
    
    if (hasPassword && !savedPwd) {
      // 需要密码，打开密码输入对话框
      setWifiPasswordDialog({ isOpen: true, ssid, security })
      setWifiPassword('')
      return
    }
    
    // 有保存的密码或不需要密码，直接连接
    setWifiConnecting(true)
    const pwd = savedPwd || null
    try {
      const r = await run('wifi_connect', { ssid, password: pwd })
      if (r?.success) showNotif('success', `正在连接 ${ssid}...`)
    } finally {
      setWifiConnecting(false)
    }
  }
  
  const handleWifiPasswordSubmit = async () => {
    if (!wifiPassword || !wifiPasswordDialog.ssid) return
    setWifiPasswordDialog({ isOpen: false, ssid: '', security: '' })
    setWifiConnecting(true)
    
    // 保存密码
    const newSaved = { ...savedWifiPasswords, [wifiPasswordDialog.ssid]: wifiPassword }
    setSavedWifiPasswords(newSaved)
    localStorage.setItem('wifi_passwords', JSON.stringify(newSaved))
    
    try {
      const r = await run('wifi_connect', { ssid: wifiPasswordDialog.ssid, password: wifiPassword })
      if (r?.success) showNotif('success', `正在连接 ${wifiPasswordDialog.ssid}...\n密码已保存`)
    } finally {
      setWifiConnecting(false)
      setWifiPassword('')
    }
  }
  
  const clearWifiPassword = (ssid: string) => {
    const newSaved = { ...savedWifiPasswords }
    delete newSaved[ssid]
    setSavedWifiPasswords(newSaved)
    localStorage.setItem('wifi_passwords', JSON.stringify(newSaved))
    showNotif('info', `已清除 ${ssid} 的保存密码`)
  }
  const disconnectWifi = async () => { await run('wifi_disconnect'); setWifiList([]) }

  // 执行破坏性操作
  const runDestructive = async (op: typeof DESTRUCTIVE_OPS[0]) => {
    if (!selectedDevice) return
    setDestructRunning(op.id)
    try {
      if (op.cmd === '__REBOOT_RECOVERY__') {
        const r = await invoke<CmdResult>('reboot_recovery', { serial: selectedDevice })
        showNotif(r?.success ? 'success' : 'error', r?.success ? '设备正在进入 Recovery...' : (r?.error || '操作失败'))
      } else {
        const r = await invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: op.cmd })
        if (r?.success && op.reboot) {
          showNotif('success', `${op.label} 完成，设备重启中...`)
          await invoke<CmdResult>('reboot_device', { serial: selectedDevice })
        } else if (!r?.success) {
          showNotif('error', r?.error || `${op.label} 失败`)
        } else {
          showNotif('success', `${op.label} 完成`)
        }
      }
    } catch (e) { showNotif('error', String(e)) }
    setDestructRunning(null)
  }

  // 执行词典操作
  const runDictOp = async (op: typeof DICT_OPS[0]) => {
    if (!selectedDevice) return
    setDestructRunning(op.id)
    try {
      const r = await invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: op.cmd })
      if (r?.success) {
        if (op.id === 'scan_dict') {
          setDictOutput(r.output || '(无词典文件)')
          showNotif('success', '扫描完成')
        } else {
          showNotif('success', `${op.label} 完成`)
          setDictOutput('')
        }
      } else {
        showNotif('error', r?.error || `${op.label} 失败`)
      }
    } catch (e) { showNotif('error', String(e)) }
    setDestructRunning(null)
  }

  // 存储填充测试
  const startFill = async () => {
    if (!selectedDevice) return
    setFilling(true)
    setFillDone(false)
    setFillCurrentMb(0)
    try {
      const space = await invoke<{success: boolean; mb: number}>('storage_get_space', { serial: selectedDevice })
      if (!space?.success || space.mb <= 0) { showNotif('error', '获取空间失败'); setFilling(false); return }
      setFillTotalMb(space.mb)
      showNotif('info', `可用空间 ${space.mb} MB，正在填充...`)
      const r = await invoke<{success: boolean; filled_mb?: number; error?: string}>('storage_fill_start', { serial: selectedDevice })
      if (r?.success) {
        setFillCurrentMb(r.filled_mb || space.mb)
        setFillDone(true)
        showNotif('success', `填充完成，已写入 ${r.filled_mb || space.mb} MB`)
      } else {
        showNotif('error', r?.error || '填充失败')
      }
    } catch (e) { showNotif('error', String(e)) }
    setFilling(false)
  }

  const cleanFill = async () => {
    if (!selectedDevice) return
    try {
      const r = await invoke<CmdResult>('storage_fill_clean', { serial: selectedDevice })
      setFillDone(false)
      setFillCurrentMb(0)
      setFillTotalMb(0)
      showNotif(r?.success ? 'success' : 'error', r?.success ? '填充文件已清理' : (r?.error || '清理失败'))
    } catch (e) { showNotif('error', String(e)) }
  }

  if (!selectedDevice) {
    return <div className="empty-state"><div className="empty-icon"><Zap size={48}/></div><div className="empty-text">请先连接设备</div></div>
  }

  return (
    <>
      <div className="section-title">工具箱</div>

      {/* Firmware Check Result */}
      {firmwareResult && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">
            <FileCheck size={14} style={{ marginRight: 6 }} />固件校验结果
          </div>
          <pre style={{
            background: 'var(--bg-input)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            fontSize: 12,
            color: 'var(--text-primary)',
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>{firmwareResult}</pre>
        </div>
      )}

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
        <button className="tool-btn" onClick={doFirmwareCheck} disabled={running || firmwareChecking}>
          <FileCheck size={24} /><span className="tool-name">固件校验</span>
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
        <div className="card" style={{ marginBottom: 16 }}>
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
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button 
                      className="btn btn-success" 
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      disabled={wifiConnecting}
                      onClick={() => connectWifi(w.ssid, w.security)}
                    >
                      <Wifi size={10} /> {savedWifiPasswords[w.ssid] ? '已连接' : '连接'}
                    </button>
                    {savedWifiPasswords[w.ssid] && (
                      <button 
                        className="btn btn-secondary"
                        style={{ padding: '2px 6px', fontSize: 10 }}
                        onClick={() => clearWifiPassword(w.ssid)}
                        title="清除保存的密码"
                      >
                        <Key size={9} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* WiFi 密码输入对话框 */}
      {wifiPasswordDialog.isOpen && (
        <div className="modal-overlay" onClick={() => setWifiPasswordDialog({ isOpen: false, ssid: '', security: '' })}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <Wifi size={16} /> 输入 WiFi 密码
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                正在连接: <strong style={{ color: 'var(--text-primary)' }}>{wifiPasswordDialog.ssid}</strong>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                加密方式: {wifiPasswordDialog.security}
              </div>
            </div>
            <input
              type="password"
              className="input"
              placeholder="请输入 WiFi 密码"
              value={wifiPassword}
              onChange={e => setWifiPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleWifiPasswordSubmit()}
              autoFocus
              style={{ marginBottom: 12 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setWifiPasswordDialog({ isOpen: false, ssid: '', security: '' })}>
                取消
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleWifiPasswordSubmit}
                disabled={!wifiPassword || wifiConnecting}
              >
                {wifiConnecting ? '连接中...' : '连接'}
              </button>
            </div>
            {wifiConnecting && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--accent-info)', textAlign: 'center' }}>
                正在连接 {wifiPasswordDialog.ssid}...
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 存储填充测试 ===== */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">
          <HardDrive size={15} style={{ marginRight: 6 }} />存储填充测试
        </div>
        {fillTotalMb > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            可用空间：<strong style={{ color: 'var(--text-primary)' }}>{fillTotalMb} MB</strong>
            {fillDone && <span style={{ color: 'var(--accent-success)' }}> | 已填充 {fillCurrentMb} MB ✅</span>}
          </div>
        )}
        {fillDone && (
          <div style={{
            width: '100%', height: 8, borderRadius: 4, background: 'var(--bg-input)', overflow: 'hidden', marginBottom: 12
          }}>
            <div style={{
              width: '100%', height: '100%', borderRadius: 4, background: 'var(--accent-success)', transition: 'width 0.3s',
            }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {!filling && !fillDone && (
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 14px' }} onClick={startFill}>
              <Play size={12} /> 开始填充
            </button>
          )}
          {filling && (
            <button className="btn btn-secondary" disabled style={{ fontSize: 12, padding: '5px 14px' }}>
              <RefreshCw size={12} className="spinning" /> 填充中...
            </button>
          )}
          <button className="btn btn-danger" style={{ fontSize: 12, padding: '5px 14px' }} onClick={cleanFill} disabled={filling}>
            <Trash2 size={12} /> 清理填充文件
          </button>
        </div>
      </div>

      {/* ===== 破坏性测试区域 ===== */}
      <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(248,81,73,0.3)' }}>
        <div className="card-title" style={{ color: 'var(--accent-error)' }}>
          <AlertTriangle size={15} style={{ marginRight: 6 }} />破坏性测试
          <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
            ⚠️ 以下操作将导致设备无法启动，仅用于测试恢复能力
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {DESTRUCTIVE_OPS.map(op => (
            <button
              key={op.id}
              className="tool-btn-destructive"
              disabled={!!destructRunning}
              onClick={() => showConfirm(
                op.label,
                `⚠️ ${op.warn}\n\n命令：${op.cmd === '__REBOOT_RECOVERY__' ? 'adb reboot recovery' : op.cmd.slice(0, 80) + '...'}\n\n确定要执行吗？`,
                'danger',
                () => { hideConfirm(); runDestructive(op) }
              )}
            >
              <AlertTriangle size={14} />
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{op.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{op.desc}</div>
              </div>
              {destructRunning === op.id && <RefreshCw size={12} className="spinning" />}
            </button>
          ))}
        </div>
      </div>

      {/* ===== 词典管理区域 ===== */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">
          <BookOpen size={15} style={{ marginRight: 6 }} />词典管理
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: dictOutput ? 12 : 0 }}>
          {DICT_OPS.map(op => (
            <button
              key={op.id}
              className={op.confirm ? 'btn btn-danger' : 'btn btn-secondary'}
              style={{ fontSize: 12, padding: '5px 12px' }}
              disabled={!!destructRunning}
              onClick={() => {
                if (op.confirm && 'warn' in op) {
                  showConfirm(op.label, `⚠️ ${op.warn}\n\n确定要执行吗？`, 'danger', () => { hideConfirm(); runDictOp(op) })
                } else {
                  runDictOp(op)
                }
              }}
            >
              {op.id === 'scan_dict' ? <Search size={12} /> : <Trash2 size={12} />}
              {destructRunning === op.id ? '执行中...' : op.label}
            </button>
          ))}
        </div>
        {dictOutput && (
          <pre style={{
            background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', padding: '8px 12px',
            fontSize: 11, color: 'var(--text-secondary)', maxHeight: 200, overflowY: 'auto',
            margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>{dictOutput}</pre>
        )}
      </div>

      {/* Environment Info */}
      <div className="card" style={{ marginTop: 0 }}>
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
