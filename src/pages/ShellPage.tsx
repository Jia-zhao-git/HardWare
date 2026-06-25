import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { invoke, CmdResult, onLogStreamData, onLogStreamClosed } from '../api/electron-bridge'
import { Terminal, Play, History, Copy, FolderOpen, Package, Activity, BarChart3, RefreshCw } from 'lucide-react'
import VirtualLogViewer from '../components/VirtualLogViewer'

interface Props { selectedDevice: string; showNotif?: (t: string, m: string) => void }

interface HistoryEntry {
  cmd: string; output: string; error?: string; timestamp: number
}

type ShellTab = 'shell' | 'process' | 'log' | 'sysinfo'

const COMMON_COMMANDS = [
  // 系统信息
  { cmd: 'getprop | grep -E "version|build|product|sku"', desc: '系统属性' },
  { cmd: 'cat /proc/cpuinfo | head -10', desc: 'CPU信息' },
  { cmd: 'cat /proc/meminfo | head -10', desc: '内存信息' },
  { cmd: 'df -h', desc: '磁盘空间' },
  { cmd: 'uname -a', desc: '内核版本' },
  { cmd: 'uptime', desc: '运行时间' },
  
  // 进程与资源
  { cmd: 'ps -A', desc: '所有进程' },
  { cmd: 'top -n 1 | head -20', desc: '系统资源' },
  { cmd: 'cat /sys/class/power_supply/battery/capacity', desc: '电量百分比' },
  { cmd: 'cat /sys/class/power_supply/battery/uevent', desc: '电池详情' },
  
  // 网络
  { cmd: 'netstat -an', desc: '网络连接' },
  { cmd: 'ifconfig wlan0', desc: 'WiFi信息' },
  { cmd: 'ip addr show', desc: '网络接口' },
  
  // 存储与文件
  { cmd: 'ls -la /data/', desc: 'data目录' },
  { cmd: 'ls -la /userdisk/', desc: 'userdisk目录' },
  { cmd: 'du -sh /data/* 2>/dev/null | sort -rh | head -10', desc: '目录大小' },
  { cmd: 'cat /proc/partitions', desc: '分区信息' },
  
  // 日志
  { cmd: 'logcat -d -t 30', desc: '最近日志(logcat)' },
  { cmd: 'tail -50 /data/syslog/messages', desc: '系统日志' },
  { cmd: 'tail -50 /data/applog/YD_PEN_APP.log 2>/dev/null || echo "无应用日志"', desc: '应用日志' },
  
  // 电源与显示
  { cmd: 'dumpsys battery', desc: '电池状态' },
  { cmd: 'dumpsys power | head -20', desc: '电源状态' },
  { cmd: 'wm size', desc: '屏幕分辨率' },
  { cmd: 'dumpsys window | head -20', desc: '窗口信息' },
  
  // 应用与Activity
  { cmd: 'dumpsys activity top | head -20', desc: '前台Activity' },
  { cmd: 'pm list packages', desc: '已安装包' },
  { cmd: 'cat /etc/miniapp/resources/cfg.json 2>/dev/null', desc: '屏幕配置' },
  { cmd: 'cat /data/cfg/sys_config.conf 2>/dev/null | head -20', desc: '系统配置' },
  
  // 词典笔专用
  { cmd: 'miniapp_cli capture /tmp/test.png', desc: '截图' },
  { cmd: 'miniapp_cli memoryApp', desc: '内存用量' },
  { cmd: 'miniapp_cli memoryUsage', desc: 'JS内存' },
  { cmd: 'boottime', desc: '开机时间' },
  { cmd: 'show_sysmem_status.sh', desc: '内存状态' },
  { cmd: 'cat /Version', desc: '固件版本' },
  { cmd: 'grep sku /data/cfg/sys_config.conf', desc: 'SKU型号' },
  { cmd: 'cat /tmp/UpdateInfo 2>/dev/null', desc: '分区信息' },
  { cmd: 'ps | grep miniapp', desc: 'MiniApp进程' },
  
  // 测试相关
  { cmd: 'ps | grep -E "monkey|smoke|grafana" | grep -v grep', desc: '测试进程' },
  { cmd: 'tail -30 /data/smoke_test/smoke.log 2>/dev/null || echo "无smoke日志"', desc: 'Smoke日志' },
  { cmd: 'cat /data/smoke_test/cycle_count.txt 2>/dev/null || echo "无"', desc: 'Smoke周期' },
  { cmd: 'cat /data/smoke_test/results.txt 2>/dev/null || echo "无"', desc: 'Smoke结果' },
]

export default function ShellPage({ selectedDevice, showNotif }: Props) {
  const [activeTab, setActiveTab] = useState<ShellTab>('shell')
  const [logLive, setLogLive] = useState(false)
  const logLiveRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [running, setRunning] = useState(false)
  const [cmdHistory, setCmdHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [showQuick, setShowQuick] = useState(true)
  const [processData, setProcessData] = useState('')
  const [logLines, setLogLines] = useState<string[]>([]) // 改为数组存储每行日志
  const [sysinfoData, setSysinfoData] = useState('')
  const [loadingTab, setLoadingTab] = useState<ShellTab | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { outputRef.current?.scrollTo(0, outputRef.current.scrollHeight) }, [history])
  useEffect(() => { inputRef.current?.focus() }, [activeTab])
  
  // 监听流式日志数据
  useEffect(() => {
    if (!selectedDevice || !logLive) return
    
    const unsubscribe = onLogStreamData((data) => {
      if (data.serial === selectedDevice) {
        setLogLines(prev => {
          const newLines = [...prev, data.line]
          // 限制最多保留 5000 行，避免内存溢出（tail -n 200 + 实时日志）
          if (newLines.length > 5000) {
            return newLines.slice(-5000)
          }
          return newLines
        })
      }
    })
    
    const unsubscribeClosed = onLogStreamClosed((data) => {
      if (data.serial === selectedDevice) {
        setLogLive(false)
        showNotif?.('info', '日志流已关闭')
      }
    })
    
    return () => {
      unsubscribe()
      unsubscribeClosed()
    }
  }, [selectedDevice, logLive, showNotif])
  
  // 设备切换时清理日志
  useEffect(() => {
    setLogLines([])
    if (logLive) {
      invoke('stop_log_stream', { serial: selectedDevice }).catch(() => {})
      setLogLive(false)
    }
  }, [selectedDevice])
  // 日志实时更新时自动滚动到底部
  useEffect(() => {
    if (logLive && logLines.length > 0 && logContainerRef.current) {
      requestAnimationFrame(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
        }
      })
    }
  }, [logLines, logLive])
  useEffect(() => {
    return () => { 
      if (logLiveRef.current) clearInterval(logLiveRef.current)
      // 清理日志流
      if (selectedDevice && logLive) {
        invoke('stop_log_stream', { serial: selectedDevice }).catch(() => {})
      }
    }
  }, [])

  const runCmd = async (command: string) => {
    setRunning(true)
    const c = command.trim()
    if (!c) { setRunning(false); return }
    setCmdHistory(h => [c, ...h].slice(0, 100))
    setHistIdx(-1)
    try {
      const r = await invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: c })
      setHistory(h => [...h, { cmd: c, output: r?.output || '', error: r?.error || undefined, timestamp: Date.now() }])
    } catch (e) { setHistory(h => [...h, { cmd: c, output: '', error: String(e), timestamp: Date.now() }]) }
    setRunning(false)
    inputRef.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') runCmd(cmd)
    if (e.key === 'ArrowUp') { e.preventDefault(); const next = Math.min(histIdx + 1, cmdHistory.length - 1); if (next >= 0) { setHistIdx(next); setCmd(cmdHistory[next]) } }
    if (e.key === 'ArrowDown') { e.preventDefault(); const next = Math.max(histIdx - 1, -1); setHistIdx(next); setCmd(next === -1 ? '' : cmdHistory[next] || '') }
    if (e.key === 'Tab' && cmd) { e.preventDefault(); const match = COMMON_COMMANDS.find(c => c.cmd.startsWith(cmd.toLowerCase())); if (match) setCmd(match.cmd) }
  }

  const clearHistory = () => { setHistory([]); setCmdHistory([]); setHistIdx(-1) }
  const copyOutput = (entry: HistoryEntry) => { navigator.clipboard.writeText(`$ ${entry.cmd}\n${entry.output}${entry.error ? '\n' + entry.error : ''}`); showNotif?.('success', '已复制') }
  const runQuick = (command: string) => { runCmd(command) }

  const loadTabData = async (tab: ShellTab, forceRefresh = false) => {
    // 如果不是强制刷新且数据已存在，则跳过
    if (!forceRefresh && tab === activeTab && (tab === 'process' && processData || tab === 'log' && logLines.length > 0 || tab === 'sysinfo' && sysinfoData)) return
    setLoadingTab(tab)
    try {
      if (tab === 'process') {
        const r = await invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: 'ps -A | sort -k9' })
        setProcessData(r?.output || '')
      } else if (tab === 'log') {
        // 非实时模式时，获取最后200行
        const r = await invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: 'LOGFILE=$(ls /data/applog/*.log 2>/dev/null | head -1); if [ -n "$LOGFILE" ]; then tail -200 "$LOGFILE"; else echo "未找到日志"; fi' })
        const output = r?.output || '(无日志)'
        setLogLines(output.split('\n').filter(line => line.trim()))
      } else if (tab === 'sysinfo') {
        const [bat, mem, cpu, ver] = await Promise.all([
          invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: 'dumpsys battery | head -20' }),
          invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: 'cat /proc/meminfo | head -10' }),
          invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: 'cat /proc/cpuinfo | head -10' }),
          invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: 'getprop | grep version' }),
        ])
        setSysinfoData(
          `=== 电池 ===\n${bat?.output || ''}\n` +
          `=== 内存 ===\n${mem?.output || ''}\n` +
          `=== CPU ===\n${cpu?.output || ''}\n` +
          `=== 版本 ===\n${ver?.output || ''}`
        )
      }
    } catch (e) { showNotif?.('error', String(e)) }
    setLoadingTab(null)
  }

  const TABS: { id: ShellTab; label: string; icon: any }[] = [
    { id: 'shell', label: '命令', icon: Terminal },
    { id: 'process', label: '进程', icon: Activity },
    { id: 'log', label: '日志', icon: BarChart3 },
    { id: 'sysinfo', label: '系统', icon: Package },
  ]

  if (!selectedDevice) {
    return <div className="empty-state"><Terminal size={48} style={{ opacity: 0.5 }} /><div className="empty-text">请先连接设备</div></div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab Bar */}
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 0, padding: 0, marginBottom: 12 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setActiveTab(t.id); if (t.id !== 'shell') loadTabData(t.id) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', cursor: 'pointer', border: 'none',
              background: activeTab === t.id ? 'var(--accent-primary)' : 'transparent',
              color: activeTab === t.id ? '#000' : 'var(--text-secondary)',
              borderRadius: 'var(--radius) var(--radius) 0 0',
              fontSize: 13, fontWeight: activeTab === t.id ? 600 : 400,
              transition: 'all 0.15s', borderBottom: activeTab === t.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
            }}
          >
            <t.icon size={14} />{t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {activeTab === 'log' && (
          <>
            <button
              className={`icon-btn ${logLive ? 'active' : ''}`}
              onClick={async () => {
                const next = !logLive
                setLogLive(next)
                if (next) {
                  // 清空旧日志
                  setLogLines([])
                  // 启动流式日志
                  try {
                    await invoke('start_log_stream', { serial: selectedDevice })
                  } catch (e) {
                    showNotif?.('error', `启动日志流失败: ${e}`)
                    setLogLive(false)
                  }
                } else {
                  // 停止流式日志
                  try {
                    await invoke('stop_log_stream', { serial: selectedDevice })
                  } catch (e) {
                    console.error('停止日志流失败:', e)
                  }
                }
              }}
              title={logLive ? '停止实时' : '开启实时'}
              style={logLive ? { color: 'var(--accent-primary)', background: 'rgba(0,212,255,0.15)' } : {}}
            >
              <Activity size={13} />
            </button>
            <button
              className="icon-btn"
              onClick={() => setLogLines([])}
              title="清空日志"
              disabled={logLines.length === 0}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </>
        )}
        {activeTab === 'shell' && (
          <button className="icon-btn" onClick={() => setShowQuick(!showQuick)} title="快捷命令">
            <FolderOpen size={13} />
          </button>
        )}
        <button className="icon-btn" onClick={() => activeTab === 'shell' ? clearHistory() : loadTabData(activeTab, true)} title={activeTab === 'shell' ? '清空' : '刷新'}>
          <RefreshCw size={13} className={loadingTab === activeTab ? 'spinning' : ''} />
        </button>
      </div>

      {activeTab === 'shell' ? (
        <div style={{ display: 'flex', flex: 1, gap: 12, minHeight: 0 }}>
          {/* Terminal Main */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="terminal" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="terminal-header">
                <div className="terminal-dots"><span/><span/><span/></div>
                <div className="terminal-title">ADB Shell — {selectedDevice}</div>
              </div>
              <div className="terminal-output" ref={outputRef} style={{ flex: 1, overflowY: 'auto' }}>
                {history.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', padding: '16px 0', fontSize: 12 }}>
                    <div style={{ marginBottom: 8 }}>ADB Shell · 输入命令执行</div>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>↑↓ 历史命令 | Tab 自动补全 | 点击右侧快捷命令快速执行</div>
                  </div>
                ) : history.map((h, i) => (
                  <div key={i} style={{ marginBottom: 10, padding: '6px 8px', background: 'rgba(0,0,0,0.25)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div><span style={{ color: 'var(--accent-secondary)' }}>$</span> <span style={{ color: 'var(--text-primary)' }}>{h.cmd}</span></div>
                      <button className="icon-btn" onClick={() => copyOutput(h)}><Copy size={10} /></button>
                    </div>
                    {h.error && <div style={{ color: 'var(--accent-error)', marginTop: 3, fontSize: 11 }}>{h.error}</div>}
                    {h.output && <pre style={{ color: '#c9d1d9', marginTop: 3, fontSize: 11, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: "'Cascadia Code', monospace", lineHeight: 1.5 }}>{h.output}</pre>}
                  </div>
                ))}
                {running && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}><div className="spinner" style={{ width: 12, height: 12 }} /><span style={{ fontSize: 11 }}>执行中...</span></div>}
              </div>
              <div className="terminal-input-row">
                <span className="terminal-prompt">$</span>
                <input ref={inputRef} className="terminal-input" value={cmd} onChange={e => setCmd(e.target.value)} onKeyDown={onKey}
                  placeholder="输入命令，回车执行..." autoFocus disabled={running} />
                <button className="btn btn-primary" onClick={() => runCmd(cmd)} disabled={running || !cmd.trim()} style={{ padding: '4px 10px' }}>
                  <Play size={12} />
                </button>
              </div>
            </div>
          </div>

          {/* Quick Commands */}
          {showQuick && (
            <div className="card" style={{ width: 220, height: 'fit-content', maxHeight: '100%', overflow: 'auto', flexShrink: 0 }}>
              <div className="card-title"><History size={13} /> 快捷命令</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {COMMON_COMMANDS.map((item, i) => (
                  <button key={i} className="btn btn-secondary"
                    style={{ justifyContent: 'space-between', fontSize: 11, padding: '5px 8px', textAlign: 'left' }}
                    onClick={() => runQuick(item.cmd)}>
                    <span style={{ color: 'var(--accent-primary)', fontFamily: 'monospace', fontSize: 10 }}>{item.cmd.length > 18 ? item.cmd.slice(0, 18) + '…' : item.cmd}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0, marginLeft: 4 }}>{item.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Process / Log / Sysinfo */
        <div className="terminal" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div className="terminal-header">
            <div className="terminal-dots"><span/><span/><span/></div>
            <div className="terminal-title">{TABS.find(t => t.id === activeTab)?.label} — {selectedDevice}</div>
            <button className="icon-btn" onClick={() => loadTabData(activeTab, true)}><RefreshCw size={11} className={loadingTab === activeTab ? 'spinning' : ''} /></button>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column' }} ref={logContainerRef}>
              {loadingTab === activeTab ? (
                <div className="loading-container"><div className="spinner" />加载中...</div>
              ) : activeTab === 'log' ? (
                // 使用虚拟滚动日志查看器，性能更好
                <VirtualLogViewer 
                  logs={logLines} 
                  height={600}
                  itemHeight={22}
                  style={{ 
                    background: 'transparent',
                    maxHeight: 'calc(100vh - 250px)',
                    overflowY: 'auto'
                  }}
                />
              ) : (
                <pre style={{ fontSize: 11, color: '#c9d1d9', fontFamily: "'Cascadia Code', 'Consolas', monospace", lineHeight: 1.5, whiteSpace: 'pre-wrap', flex: 1, overflow: 'auto' }}>
                  {activeTab === 'process' ? processData : sysinfoData}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}