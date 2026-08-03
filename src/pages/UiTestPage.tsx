import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke, onUitestLog, onUitestDone } from '../api/electron-bridge'
import type { AdbDevice } from '../api/electron-bridge'
import {
  FlaskConical, Play, Square, RefreshCw, FileText,
  Activity, Clock, Terminal, Trash2, ChevronRight,
  Loader, ExternalLink, Settings, Edit3, Save, X,
  Zap, RotateCcw, FilePlus, CheckCircle, AlertTriangle
} from 'lucide-react'

interface Template { name: string; label: string; description: string; content: string }

interface DeviceRunInfo {
  serial: string; sku: string; hostname: string;
  screen_physical: string; screenshot: string;
  direction: number; tp_direction: number;
  tp_xoffset: number; tp_yoffset: number;
  test: string; loop: string; duration_min: string | number;
  apps_per_cycle: number; est_cycle_min: number;
}

interface Props {
  selectedDevice: string
  devices?: AdbDevice[]
  showNotif: (t: string, m: string) => void
}

interface UitestStatus {
  running: boolean
  serial: string | null
  startTime: number | null
  cycles: number
  lastStatus: string
  summaryReport: string | null
  logCount: number
  recentLogs: string[]
}

interface UitestReport {
  name: string
  path: string
  mtime: string
}

interface UitestTestFile {
  name: string
  path: string
}

// Tab types
type TabId = 'run' | 'edit' | 'reports'

export default function UiTestPage({ selectedDevice, devices = [], showNotif }: Props) {
  // Multi-device selection state
  const onlineDevices = devices.filter(d => d.state === 'device')
  const [selectedSerials, setSelectedSerials] = useState<string[]>([])
  // Derive active serials: multi-select if available, else fall back to single selectedDevice
  const activeSerials = selectedSerials.length > 0 ? selectedSerials : (selectedDevice ? [selectedDevice] : [])
  const isMulti = activeSerials.length > 1
  // Per-device log state (only used when multi)
  const [deviceLogs, setDeviceLogs] = useState<Record<string, string[]>>({})
  const [activeLogDevice, setActiveLogDevice] = useState<string>('')
  const [activeTab, setActiveTab] = useState<TabId>('run')
  const [tests, setTests] = useState<UitestTestFile[]>([])
  const [selectedTest, setSelectedTest] = useState('tests/all-apps.yaml')
  const [loops, setLoops] = useState(0)
  const [duration, setDuration] = useState(0)
  const [status, setStatus] = useState<UitestStatus | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [reports, setReports] = useState<UitestReport[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  // Editor state
  const [editContent, setEditContent] = useState('')
  const [editFile, setEditFile] = useState('')
  const [editDirty, setEditDirty] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [calibLoading, setCalibLoading] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [validateMsg, setValidateMsg] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [stoppedElapsed, setStoppedElapsed] = useState(0)
  const [deviceInfo, setDeviceInfo] = useState<DeviceRunInfo | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number | null>(null)  // avoids stale closure in onUitestDone
  const runStartRef = useRef<string | null>(null)   // run_id of first cycle in this session

  const loadTests = useCallback(async () => {
    const r = await invoke<{ tests: UitestTestFile[] }>('uitest_list_tests', {})
    if (r?.tests?.length) {
      setTests(r.tests)
      if (!r.tests.find(t => `tests/${t.name}` === selectedTest)) {
        setSelectedTest(`tests/${r.tests[0].name}`)
      }
    }
  }, [])

  const loadReports = useCallback(async () => {
    const r = await invoke<{ reports: UitestReport[] }>('uitest_list_reports', {})
    if (r?.reports) setReports(r.reports)
  }, [])

  const loadStatus = useCallback(async () => {
    const s = await invoke<UitestStatus>('uitest_status', {})
    if (s) setStatus(s)
  }, [])

  // Poll status while running
  const startPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(loadStatus, 3000)
  }
  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => {
    loadTests()
    loadTemplates()
    loadStatus()
    loadReports()
    return () => stopPoll()
  }, [])

  useEffect(() => {
    const unsubLog = onUitestLog(({ line, serial: logSerial }) => {
      // Detect device_info event in the log stream
      try {
        const obj = JSON.parse(line)
        if (obj.event === 'device_info') {
          setDeviceInfo(obj as DeviceRunInfo)
          return  // don't add to log — shown in header card
        }
      } catch (_) {}
      // Multi-device: route to per-device log
      if (logSerial) {
        setDeviceLogs(prev => ({
          ...prev,
          [logSerial]: [...(prev[logSerial] || []).slice(-1999), line]
        }))
      }
      setLogs(prev => [...prev.slice(-1999), line])
    })
    const unsubDone = onUitestDone(({ code, cycles, summaryReport, lastStatus, serial: doneSN }) => {
      // Use ref to avoid stale closure (callback captured at mount with [] deps)
      const t0 = startTimeRef.current
      setStoppedElapsed(t0 ? Math.round((Date.now() - t0) / 1000) : 0)
      setStatus(prev => prev ? { ...prev, running: false, cycles, lastStatus, summaryReport } : null)
      stopPoll()
      loadReports()
      const label = doneSN ? `[设备 ${doneSN.slice(-6)}] ` : ''
      showNotif(code === 0 ? 'success' : 'error', `${label}测试完成: ${cycles} 轮, ${lastStatus}`)
      if (summaryReport) {
        setTimeout(() => {
          invoke('uitest_open_report', { reportPath: summaryReport })
          setActiveTab('reports')
        }, 600)
      }
    })
    return () => { unsubLog(); unsubDone() }
  }, [])

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const start = async () => {
    if (activeSerials.length === 0) { showNotif('warning', '请先连接设备'); return }
    setLogs([])
    setDeviceLogs({})
    setDeviceInfo(null)
    setStoppedElapsed(0)
    startTimeRef.current = Date.now()
    runStartRef.current = null
    setActiveTab('run')
    const ipcName = activeSerials.length > 1 ? 'uitest_start_multi' : 'uitest_start'
    const payload = activeSerials.length > 1
      ? { serials: activeSerials, testFile: selectedTest, loops, durationMin: duration }
      : { serial: activeSerials[0], testFile: selectedTest, loops, durationMin: duration }
    const r = await invoke<{ success: boolean; error?: string; results?: Record<string, { success: boolean; error?: string }> }>(ipcName, payload)
    if (r?.success) {
      const label = activeSerials.length > 1 ? `已在 ${activeSerials.length} 台设备同时启动` : 'UI 自动化测试已启动'
      showNotif('success', label)
      setStatus(prev => prev ? { ...prev, running: true } : null)
      startPoll()
    } else {
      showNotif('error', r?.error || '启动失败')
    }
  }

  const stop = async () => {
    // Freeze elapsed time before sending stop (use ref to avoid stale closure)
    const t0 = startTimeRef.current
    setStoppedElapsed(t0 ? Math.round((Date.now() - t0) / 1000) : 0)
    await invoke('uitest_stop', {})
    showNotif('success', '已发送停止信号')
    stopPoll()
    setTimeout(loadStatus, 1000)
  }

  // ── Editor ──────────────────────────────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    try {
      const r = await invoke<{ success: boolean; content?: string }>('uitest_read_test', { testFile: 'tests/templates.yaml' })
      if (r?.success && r.content) {
        const lines = r.content.split('\n')
        const parsed: Template[] = []
        let cur: Partial<Template> | null = null
        let inContent = false
        for (const line of lines) {
          if (line.trim().startsWith('- name: ')) {
            if (cur && cur.content) parsed.push(cur as Template)
            cur = { name: line.split(':')[1]?.trim() || '', label: '', description: '', content: '' }
            inContent = false
          } else if (cur) {
            const lm = line.match(/\s+label:\s*(.+)/)
            const dm = line.match(/\s+description:\s*(.+)/)
            if (lm) cur.label = lm[1].trim()
            else if (dm) cur.description = dm[1].trim()
            else if (line.trim() === 'content: |') inContent = true
            else if (inContent && line.startsWith('      ')) cur.content = (cur.content || '') + line.substring(6) + '\n'
          }
        }
        if (cur && cur.content) parsed.push(cur as Template)
        setTemplates(parsed)
      }
    } catch (_) {}
  }, [])

  const validateYaml = () => {
    const lines = editContent.split('\n')
    if (!editContent.trim()) { setValidateMsg('Empty file'); return }
    const errors: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (!l.trim() || l.trim().startsWith('#')) continue
      const m = l.match(/^(\s*)/)
      const spaces = m ? m[1].length : 0
      if (spaces % 2 !== 0 && !l.trim().startsWith('-')) {
        errors.push(`L${i + 1}: indent must be multiple of 2 (got ${spaces})`)
      }
    }
    const stepCount = lines.filter(l => l.trimStart().startsWith('- name:')).length
    if (stepCount === 0) errors.push('No steps found (missing steps: section?)')
    if (errors.length > 0) {
      setValidateMsg(errors.slice(0, 5).join('; '))
    } else {
      setValidateMsg(`Valid YAML · ${stepCount} steps · ${lines.length} lines`)
    }
  }

  const newFromTemplate = (tmpl: Template) => {
    const name = newFileName.trim() || 'new-test.yaml'
    const fileName = name.endsWith('.yaml') || name.endsWith('.yml') ? name : `${name}.yaml`
    setEditContent(tmpl.content)
    setEditFile(`tests/${fileName}`)
    setEditDirty(true)
    setNewFileName('')
    showNotif('info', `Created from template: ${tmpl.label}`)
  }

  const openEditor = async (testFile: string) => {
    setEditLoading(true)
    const r = await invoke<{ success: boolean; content?: string; error?: string }>('uitest_read_test', { testFile })
    setEditLoading(false)
    if (r?.success && r.content != null) {
      setEditContent(r.content)
      setEditFile(testFile)
      setEditDirty(false)
      setActiveTab('edit')
    } else {
      showNotif('error', r?.error || '读取失败')
    }
  }

  const saveEditor = async () => {
    if (!editFile) return
    const r = await invoke<{ success: boolean; error?: string }>('uitest_write_test', {
      testFile: editFile,
      content: editContent,
    })
    if (r?.success) {
      showNotif('success', '保存成功')
      setEditDirty(false)
      loadTests()
    } else {
      showNotif('error', r?.error || '保存失败')
    }
  }

  const runCalibrate = async () => {
    if (!selectedDevice) { showNotif('warning', '请先连接设备'); return }
    setCalibLoading(true)
    setActiveTab('run')
    setLogs(prev => [...prev, '[CALIB] 开始快速校准，预计耗时60秒，请保持设备连接并保持在主界面...'])
    const r = await invoke<{ success: boolean; calibrated?: boolean; sku?: string; note?: string; error?: string }>(
      'uitest_calibrate', { serial: selectedDevice }
    )
    setCalibLoading(false)
    if (r?.calibrated) {
      showNotif('success', `校准完成: ${r.sku} 已保存`)
      setLogs(prev => [...prev, `[CALIB] 成功！校准文件已保存: ui-map/${r.sku}.json (note: ${r.note || ''})`])
    } else if (r?.success === false) {
      showNotif('error', r.error || '校准失败')
    } else {
      showNotif('warning', `校准完成，但未找到相交点，已使用 cfg.json 默认内容保存 (note: ${r?.note || ''})`)
    }
  }

  const runGen = async () => {
    if (!selectedDevice) { showNotif('warning', '请先连接设备'); return }
    setGenLoading(true)
    const r = await invoke<{ success: boolean; output?: string; error?: string }>('uitest_run_gen', {
      serial: selectedDevice,
    })
    setGenLoading(false)
    if (r?.success) {
      showNotif('success', '测试用例已从设备重新生成')
      loadTests()
      // Reload in editor if currently editing all-apps
      if (editFile.includes('all-apps')) openEditor(editFile)
    } else {
      showNotif('error', r?.error || '生成失败')
    }
  }

  const running = status?.running ?? false
  const elapsed = running
    ? (startTimeRef.current ? Math.round((Date.now() - startTimeRef.current) / 1000) : 0)
    : stoppedElapsed
  const elapsedStr = (running || stoppedElapsed > 0) ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : '—'
  const statusColor = running ? '#4fc3f7'
    : status?.lastStatus === 'passed' ? '#10b981'
    : status?.lastStatus === 'failed' ? '#e94560'
    : '#888'

  if (!selectedDevice) {
    return (
      <div className="empty-state">
        <FlaskConical size={48} style={{ opacity: 0.5 }} />
        <div className="empty-text">请先连接设备</div>
      </div>
    )
  }

  return (
    <div>
      {/* ── Status bar (always visible) ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px', background: 'var(--bg-card)',
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          {running
            ? <Loader size={14} className="spinning" style={{ color: '#4fc3f7' }} />
            : <Activity size={14} style={{ color: statusColor }} />}
          <span style={{ color: statusColor, fontWeight: 700 }}>
            {running ? '运行中'
              : status?.lastStatus === 'idle' ? '空闲'
              : (status?.lastStatus || '空闲').toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> {elapsedStr}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChevronRight size={12} /> {status?.cycles ?? 0} 轮
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn btn-success" onClick={start} disabled={running}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 14px', fontSize: 13 }}>
            <Play size={12} /> 开始测试
          </button>
          <button className="btn btn-danger" onClick={stop} disabled={!running}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 13 }}>
            <Square size={12} /> 停止
          </button>
          <button className="btn btn-secondary" onClick={loadStatus}
            style={{ padding: '5px 8px' }} title="刷新状态">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── Inner Tabs ── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', marginBottom: 16 }}>
        {([
          { id: 'run' as TabId, label: '▶ 运行', icon: Zap },
          { id: 'edit' as TabId, label: '✏ 用例编辑', icon: Edit3 },
          { id: 'reports' as TabId, label: '📋 测试报告', icon: FileText },
        ]).map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            background: 'none', border: 'none', padding: '8px 16px', cursor: 'pointer',
            fontSize: 13, fontWeight: activeTab === t.id ? 700 : 400,
            color: activeTab === t.id ? 'var(--accent-primary)' : 'var(--text-muted)',
            borderBottom: activeTab === t.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Run Tab ── */}
      {activeTab === 'run' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title"><Settings size={14} /> 测试配置</div>
            {/* ── Multi-device selector (shown when 2+ devices connected) ── */}
            {onlineDevices.length > 1 && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.2)', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Activity size={12} /> 检测到 {onlineDevices.length} 台设备 — 选择执行设备（不选则使用当前设备）
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {onlineDevices.map(d => {
                    const checked = selectedSerials.includes(d.serial)
                    return (
                      <label key={d.serial} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                        padding: '4px 10px', borderRadius: 4, fontSize: 12,
                        background: checked ? 'rgba(16,185,129,0.12)' : 'var(--bg-card)',
                        border: `1px solid ${checked ? '#10b981' : 'var(--border-color)'}`,
                        color: checked ? '#10b981' : 'var(--text-primary)' }}>
                        <input type="checkbox" checked={checked} style={{ display: 'none' }}
                          onChange={e => setSelectedSerials(prev =>
                            e.target.checked ? [...prev, d.serial] : prev.filter(s => s !== d.serial)
                          )} />
                        {checked ? <CheckCircle size={11} /> : <Activity size={11} />}
                        {d.serial.slice(-8)}{d.model ? ` (${d.model})` : ''}
                      </label>
                    )
                  })}
                  <button style={{ fontSize: 11, padding: '4px 8px', background: 'none', border: '1px solid var(--border-color)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)' }}
                    onClick={() => setSelectedSerials(selectedSerials.length === onlineDevices.length ? [] : onlineDevices.map(d => d.serial))}>
                    {selectedSerials.length === onlineDevices.length ? '取消全部' : '全选'}
                  </button>
                </div>
                {isMulti && <div style={{ fontSize: 11, color: '#ffb700', marginTop: 4 }}>将同时在 {activeSerials.length} 台设备上运行，各自生成独立报告</div>}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 150px', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>测试用例</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={selectedTest} onChange={e => setSelectedTest(e.target.value)}
                    style={{ flex: 1, padding: '7px 10px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 13 }}>
                    {tests.length
                      ? tests.map(t => <option key={t.path} value={`tests/${t.name}`}>{t.name}</option>)
                      : <option value="tests/all-apps.yaml">all-apps.yaml</option>}
                  </select>
                  <button className="btn btn-sm btn-secondary" onClick={() => openEditor(selectedTest)}
                    title="编辑此用例" style={{ padding: '0 10px', display: 'flex', alignItems: 'center' }}>
                    <Edit3 size={13} />
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={runGen} disabled={genLoading}
                    title="从设备重新生成 all-apps.yaml"
                    style={{ padding: '0 10px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    {genLoading ? <Loader size={12} className="spinning" /> : <RotateCcw size={12} />}
                    重新生成
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={runCalibrate} disabled={calibLoading || running}
                    title="快速校准坐标映射（约 60 秒）— 用于新 SKU 或首次连接"
                    style={{ padding: '0 10px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    {calibLoading ? <Loader size={12} className="spinning" /> : <Settings size={12} />}
                    校准
                  </button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>循环（0=无限）</label>
                <input type="number" min={0} value={loops} onChange={e => setLoops(Number(e.target.value))}
                  style={{ width: '100%', padding: '7px 10px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>时长分钟（0=不限）</label>
                <input type="number" min={0} value={duration} onChange={e => setDuration(Number(e.target.value))}
                  style={{ width: '100%', padding: '7px 10px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 13 }} />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
              {/* ── Device info card (shown when test starts) ── */}
              {deviceInfo && (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '6px 12px', padding: '10px 14px',
                  background: '#0d1117', border: '1px solid #30363d',
                  borderRadius: 6, marginBottom: 10, fontSize: 12,
                }}>
                  <div><span style={{ color: '#58a6ff' }}>设备</span> <span style={{ color: '#c9d1d9', fontFamily: 'monospace' }}>{deviceInfo.serial}</span></div>
                  <div><span style={{ color: '#58a6ff' }}>SKU</span> <span style={{ color: '#c9d1d9', fontFamily: 'monospace' }}>{deviceInfo.sku}</span></div>
                  <div><span style={{ color: '#58a6ff' }}>分辨率</span> <span style={{ color: '#c9d1d9' }}>{deviceInfo.screen_physical} → {deviceInfo.screenshot}</span></div>
                  <div><span style={{ color: '#58a6ff' }}>方向</span> <span style={{ color: '#7ee787' }}>屏幕={deviceInfo.direction}° 触摸={deviceInfo.tp_direction}°</span></div>
                  <div><span style={{ color: '#58a6ff' }}>测试用例</span> <span style={{ color: '#c9d1d9', fontFamily: 'monospace' }}>{deviceInfo.test}</span></div>
                  <div><span style={{ color: '#58a6ff' }}>每轮步骤</span> <span style={{ color: '#d2a8ff' }}>{deviceInfo.apps_per_cycle} 步</span></div>
                  <div><span style={{ color: '#58a6ff' }}>循环次数</span> <span style={{ color: '#ffb700' }}>{deviceInfo.loop}</span></div>
                  <div><span style={{ color: '#58a6ff' }}>时长限制</span> <span style={{ color: '#ffb700' }}>{String(deviceInfo.duration_min)} min</span></div>
                  <div><span style={{ color: '#58a6ff' }}>预计/轮</span> <span style={{ color: '#8b949e' }}>~{deviceInfo.est_cycle_min} min</span></div>
                  {deviceInfo.tp_xoffset !== 0 && <div><span style={{ color: '#58a6ff' }}>偏移</span> <span style={{ color: '#f78166' }}>X={deviceInfo.tp_xoffset} Y={deviceInfo.tp_yoffset}</span></div>}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Terminal size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>实时日志（{logs.length} 行）</span>
                {/* Multi-device log tabs */}
                {isMulti && activeSerials.map(s => (
                  <button key={s}
                    onClick={() => setActiveLogDevice(activeLogDevice === s ? '' : s)}
                    style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                      background: activeLogDevice === s ? 'rgba(79,195,247,0.15)' : 'none',
                      border: `1px solid ${activeLogDevice === s ? '#4fc3f7' : 'var(--border-color)'}`,
                      color: activeLogDevice === s ? '#4fc3f7' : 'var(--text-muted)' }}>
                    {s.slice(-6)}
                  </button>
                ))}
                <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} /> 自动滚动
                </label>
                <button className="btn btn-sm btn-secondary" onClick={() => setLogs([])}
                  style={{ padding: '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Trash2 size={10} /> 清空
                </button>
              </div>
              <div ref={logRef} style={{
                height: 300, overflowY: 'auto', background: '#0a0a1a',
                borderRadius: 'var(--radius-md)', padding: '8px 12px',
                fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, color: '#b0b0c0',
              }}>
                {(() => {
                  const displayLogs = (isMulti && activeLogDevice && deviceLogs[activeLogDevice])
                    ? deviceLogs[activeLogDevice]
                    : logs
                  return displayLogs.length === 0
                    ? <span style={{ color: '#444' }}>{isMulti && activeLogDevice ? `等待 ${activeLogDevice.slice(-6)} 躺动...` : '等待测试启动...'}</span>
                    : displayLogs.map((l, i) => (
                      <div key={i} style={{
                        color: l.includes('[ERR]') || l.includes('"failed"') || l.includes('failed_steps') ? '#e94560'
                          : l.includes('"passed"') ? '#10b981'
                          : l.includes('"warned"') ? '#ffb700'
                          : l.includes('[DONE]') || l.includes('[START]') ? '#4fc3f7'
                          : '#b0b0c0',
                      }}>{l}</div>
                    ))
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Tab ── */}
      {activeTab === 'edit' && (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Edit3 size={14} /> 测试用例编辑
              {editDirty && <span style={{ fontSize: 11, color: '#ffb700', marginLeft: 4 }}>●未保存</span>}
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {/* File selector */}
              <select value={editFile} onChange={e => { setValidateMsg(null); openEditor(e.target.value) }}
                style={{ padding: '4px 8px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 12 }}>
                {tests.length
                  ? tests.map(t => <option key={t.path} value={`tests/${t.name}`}>{t.name}</option>)
                  : <option value="">— 无 —</option>}
              </select>
              {/* Template picker */}
              <button className="btn btn-sm btn-secondary" onClick={() => setShowTemplatePicker(!showTemplatePicker)}
                style={{ padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <FilePlus size={12} /> 模板
              </button>
              {/* Validate */}
              <button className="btn btn-sm btn-secondary" onClick={validateYaml}
                style={{ padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle size={12} /> 验证
              </button>
              {/* Save */}
              <button className="btn btn-sm btn-success" onClick={saveEditor} disabled={!editDirty || !editFile}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 12 }}>
                <Save size={12} /> 保存
              </button>
              {/* Help toggle */}
              <button className="btn btn-sm btn-secondary" onClick={() => setShowHelp(!showHelp)}
                style={{ padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, background: showHelp ? 'rgba(79,195,247,0.15)' : undefined, borderColor: showHelp ? '#4fc3f7' : undefined }}>
                {showHelp ? <X size={12} /> : <span style={{ fontWeight: 700 }}>?</span>} 帮助
              </button>
            </div>
          </div>

          {/* ── Help Panel ── */}
          {showHelp && (
            <div style={{
              background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
              padding: '14px 16px', marginBottom: 12, maxHeight: 360, overflowY: 'auto',
              fontSize: 12, lineHeight: 1.8, color: '#c9d1d9',
            }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: '#58a6ff', display: 'flex', alignItems: 'center', gap: 6 }}>
                📖 YAML 用例编写指南
                <X size={12} style={{ marginLeft: 'auto', cursor: 'pointer', opacity: 0.5 }} onClick={() => setShowHelp(false)} />
              </div>

              <div style={{ fontWeight: 600, color: '#f78166', marginTop: 10 }}>文件结构</div>
              <pre style={{ background: '#161b22', padding: '8px 10px', borderRadius: 4, fontSize: 11, color: '#8b949e', margin: '4px 0 10px' }}>{`name: my_test          # 用例名称
on_failure:
  stop: true           # 失败后是否停止 (true/false)
  keep_failed_screenshots_only: true  # 磁盘清理
steps:                 # 步骤列表 (每个以 - name: 开头)
  - name: step_name
    action: press_key   # 动作类型
    key: asr            # 动作参数`}</pre>

              <div style={{ fontWeight: 600, color: '#f78166', marginTop: 12 }}>支持的动作类型</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '6px 16px', marginTop: 4 }}>
                {[
                  { action: 'press_key', params: 'key: asr | camera | menu | power', desc: '按下物理按键' },
                  { action: 'shell', params: 'command: <shell命令>', desc: '执行 shell 命令 (如 miniapp_cli start)' },
                  { action: 'wait', params: 'wait: <秒数>', desc: '等待指定秒数' },
                  { action: 'assert', params: '见下方「断言类型」', desc: '执行断言验证' },
                  { action: 'random_tap', params: 'count: <次数>', desc: '随机位置快速点击' },
                  { action: 'random_swipe', params: 'count: <次数>', desc: '随机方向滑动' },
                  { action: 'long_press', params: 'sx, sy: <坐标>, duration_ms: <ms>', desc: '长按指定位置' },
                  { action: 'edge_swipe', params: 'edge: top | bottom | left | right', desc: '从屏幕边缘向内滑动' },
                  { action: 'shuffle', params: 'n: <操作次数>', desc: '随机混合 tap/swipe/long_press' },
                  { action: 'proc_snapshot', params: 'label: <标签>', desc: '进程 PID 快照 (检测崩溃)' },
                  { action: 'tap', params: 'x, y: <截图坐标>', desc: '精确点击 (已自动转物理坐标)' },
                  { action: 'swipe', params: 'from: [x1,y1], to: [x2,y2]', desc: '两点间滑动 (自动转物理坐标)' },
                ].map(a => (
                  <div key={a.action} style={{ padding: '6px 8px', background: '#161b22', borderRadius: 4, border: '1px solid #21262d' }}>
                    <code style={{ color: '#7ee787', fontWeight: 600 }}>{a.action}</code>
                    <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2 }}>{a.desc}</div>
                    <div style={{ color: '#79c0ff', fontSize: 10, marginTop: 1, fontFamily: 'monospace' }}>{a.params}</div>
                  </div>
                ))}
              </div>

              <div style={{ fontWeight: 600, color: '#f78166', marginTop: 14 }}>断言 (assert) 类型</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '6px 16px', marginTop: 4 }}>
                {[
                  { key: 'screen_changed_from', params: 'current: <截图标签>', desc: '验证截图 A → 截图 B 有变化', example: 'screen_changed_from: home\ncurrent: after_tap' },
                  { key: 'capture_not_blank', params: 'min_kb: <最小KB>', desc: '验证截图大于指定大小 (防黑屏)', example: 'capture_not_blank: enter_1\nmin_kb: 3' },
                  { key: 'proc_alive', params: '<进程名列表>', desc: '验证关键进程存活', example: 'proc_alive:\n  - miniapp\n  - runDictPen' },
                  { key: 'mem_delta_ok', params: '<阈值MB>', desc: '内存变化不超过阈值 (负数=允许下降值)', example: 'mem_delta_ok: -30  # 最多降30MB' },
                  { key: 'file_exists', params: '<文件路径>', desc: '验证文件存在' },
                  { key: 'warn_only', params: 'true', desc: '失败仅警告不停止 (加在 assert 块内)' },
                ].map(a => (
                  <div key={a.key} style={{ padding: '6px 8px', background: '#161b22', borderRadius: 4, border: '1px solid #21262d' }}>
                    <code style={{ color: '#d2a8ff', fontWeight: 600 }}>{a.key}</code>
                    <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2 }}>{a.desc}</div>
                    <div style={{ color: '#79c0ff', fontSize: 10, marginTop: 1, fontFamily: 'monospace' }}>{a.params}</div>
                    {a.example && <pre style={{ background: '#0d1117', padding: '4px 6px', borderRadius: 3, fontSize: 10, color: '#8b949e', margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{a.example}</pre>}
                  </div>
                ))}
              </div>

              <div style={{ fontWeight: 600, color: '#f78166', marginTop: 14 }}>快捷操作键</div>
              <div style={{ color: '#8b949e', marginBottom: 6 }}>
                <code style={{ color: '#79c0ff' }}>Tab</code> — 插入 2 空格缩进 &nbsp;&nbsp;
                <code style={{ color: '#79c0ff' }}>Ctrl+S</code> — 保存 &nbsp;&nbsp;
                <code style={{ color: '#79c0ff' }}>Ctrl+Enter</code> — 验证语法
              </div>

              <div style={{ fontWeight: 600, color: '#f78166', marginTop: 12 }}>注意事项</div>
              <ul style={{ color: '#8b949e', paddingLeft: 18, marginBottom: 4 }}>
                <li>截图标签通过 <code style={{ color: '#79c0ff' }}>capture: &lt;标签&gt;</code> 定义，后续断言引用同一个标签</li>
                <li>坐标自动从 cfg.json 转换为物理触摸坐标，无需手动算</li>
                <li>YAML 缩进必须用 <b>2 空格</b>（不要用 Tab 字符）</li>
                <li>appid 从 <code style={{ color: '#79c0ff' }}>packages.json</code> 获取，不同设备 APP 列表不同</li>
                <li>使用 <code style={{ color: '#79c0ff' }}>warn_only: true</code> 让某些断言失败时只警告不终止</li>
              </ul>
            </div>
          )}

          {/* Template picker panel */}
          {showTemplatePicker && (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)', padding: '10px 12px', marginBottom: 10,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <FilePlus size={13} /> 从模板创建新用例
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input type="text" value={newFileName} onChange={e => setNewFileName(e.target.value)}
                  placeholder="新文件名（如 my-test.yaml）"
                  style={{ flex: 1, padding: '5px 8px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                {templates.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>无可用模板</div>
                ) : templates.map(t => (
                  <div key={t.name} onClick={() => newFromTemplate(t)} style={{
                    padding: '8px 10px', border: '1px solid var(--border-color)',
                    borderRadius: 6, cursor: 'pointer', background: 'rgba(0,0,0,0.1)',
                    transition: '.15s',
                  }} onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Validation message */}
          {validateMsg && (
            <div style={{
              padding: '6px 10px', borderRadius: 4, marginBottom: 8, fontSize: 12,
              background: validateMsg.startsWith('Valid') ? 'rgba(16,185,129,0.15)' : 'rgba(233,69,96,0.15)',
              color: validateMsg.startsWith('Valid') ? '#10b981' : '#e94560',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {validateMsg.startsWith('Valid') ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
              {validateMsg}
              <X size={12} style={{ marginLeft: 'auto', cursor: 'pointer', opacity: 0.6 }} onClick={() => setValidateMsg(null)} />
            </div>
          )}

          {editLoading ? (
            <div className="loading-container" style={{ padding: 24 }}>
              <div className="spinner" /> 加载中...
            </div>
          ) : editFile ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
                <span>{editFile}</span>
                <span>{editContent.split('\n').length} 行 · {editContent.split('\n').filter((l: string) => l.trimStart().startsWith('- name:')).length} 个步骤</span>
              </div>
              {/* Editor with line numbers */}
              <div style={{ display: 'flex', minHeight: 480, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                {/* Line numbers gutter */}
                <div style={{
                  width: 44, flexShrink: 0, background: '#050510',
                  padding: '10px 0', overflow: 'hidden',
                  fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7,
                  color: '#555', textAlign: 'right', userSelect: 'none',
                  borderRight: '1px solid var(--border-color)',
                }}>
                  {editContent.split('\n').map((_: string, i: number) => (
                    <div key={i} style={{ padding: '0 8px' }}>{i + 1}</div>
                  ))}
                </div>
                {/* Textarea */}
                <textarea
                  value={editContent}
                  onChange={e => { setEditContent(e.target.value); setEditDirty(true); setValidateMsg(null) }}
                  spellCheck={false}
                  style={{
                    flex: 1, minWidth: 0,
                    background: '#0a0a1a', border: 'none',
                    padding: '10px 12px',
                    fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7,
                    color: '#c8c8d4', resize: 'vertical', outline: 'none',
                    tabSize: 2,
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const el = e.currentTarget as HTMLTextAreaElement
                      const start = el.selectionStart
                      const end = el.selectionEnd
                      const newVal = el.value.substring(0, start) + '  ' + el.value.substring(end)
                      setEditContent(newVal)
                      setEditDirty(true)
                      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2 })
                    }
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                      e.preventDefault(); saveEditor()
                    }
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault(); validateYaml()
                    }
                  }}
                  onScroll={e => {
                    const gutter = e.currentTarget.previousElementSibling as HTMLElement
                    if (gutter) gutter.scrollTop = e.currentTarget.scrollTop
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', gap: 16 }}>
                <span>Tab 缩进</span><span>Ctrl+S 保存</span><span>Ctrl+Enter 验证</span>
                <span style={{ marginLeft: 'auto' }}>支持动作: press_key | shell | assert | random_tap | random_swipe | long_press | edge_swipe | shuffle | wait | proc_snapshot</span>
              </div>
            </>
          ) : (
            <div style={{ padding: '24px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              <FilePlus size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
              <div>点击「模板」按钮从模板创建新用例，或选择上方文件列表编辑现有用例</div>
            </div>
          )}
        </div>
      )}

      {/* ── Reports Tab ── */}
      {activeTab === 'reports' && (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText size={14} /> 测试报告
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {reports.length > 0 && (
                <button className="btn btn-sm"
                  onClick={async () => {
                    const ok = confirm(`确认删除全部 ${reports.length} 个报告?`)
                    if (!ok) return
                    let deleted = 0
                    for (const r of reports) {
                      const res = await invoke<{success:boolean}>('uitest_delete_report', { reportPath: r.path })
                      if (res?.success) deleted++
                    }
                    showNotif('success', `已删除 ${deleted}/${reports.length} 个报告`)
                    loadReports()
                  }}
                  style={{ padding: '3px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(233,69,96,0.08)', border: '1px solid rgba(233,69,96,0.3)', color: '#e94560', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                  <Trash2 size={10} /> 全部删除
                </button>
              )}
              <button className="btn btn-sm btn-secondary" onClick={loadReports}
                style={{ padding: '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
                <RefreshCw size={10} /> 刷新
              </button>
            </div>
          </div>
          {reports.length === 0 ? (
            <div style={{ padding: '24px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              暂无报告，运行测试后自动生成
            </div>
          ) : (
            reports.map(r => (
              <div key={r.path} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)', marginBottom: 6,
                background: 'rgba(0,0,0,0.1)',
              }}>
                <FileText size={14} style={{ color: '#4fc3f7', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(r.mtime).toLocaleString('zh-CN')}
                  </div>
                </div>
                <button className="btn btn-sm btn-success"
                  onClick={() => invoke('uitest_open_report', { reportPath: r.path })}
                  style={{ padding: '4px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <ExternalLink size={11} /> 打开报告
                </button>
                <button className="btn btn-sm"
                  onClick={async () => {
                    const ok = confirm(`确认删除报告: ${r.name}?`)
                    if (!ok) return
                    const res = await invoke<{success:boolean;error?:string}>('uitest_delete_report', { reportPath: r.path })
                    if (res?.success) {
                      showNotif('success', '已删除')
                      loadReports()
                    } else {
                      showNotif('error', res?.error || '删除失败')
                    }
                  }}
                  style={{ padding: '4px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, background: 'rgba(233,69,96,0.08)', border: '1px solid rgba(233,69,96,0.3)', color: '#e94560', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                  <X size={11} /> 删除
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
