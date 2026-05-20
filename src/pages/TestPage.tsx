import { useState, useEffect } from 'react'
import { invoke, open as openDialog, CmdResult } from '../api/electron-bridge'
import {
  FlaskConical, Square, Trash2, Download, Search, Battery,
  Activity, Clock, FileText, RefreshCw, AlertCircle, CheckCircle2, Terminal, FolderOpen,
  Zap, XCircle, Play
} from 'lucide-react'

interface Props { selectedDevice: string; showNotif: (t: string, m: string) => void }

interface TestResult { name: string; status: 'running' | 'success' | 'error' | 'idle'; output: string; startTime?: number }
interface ScriptPaths { monkey: string | null; grafana: string | null; power: string | null }
interface DurationInfo { duration_formatted: string; start_time: string; end_time: string; total_hours: number; format_type: string }
interface CollectResult extends CmdResult { duration?: DurationInfo | null }

const STORAGE_KEY = 'adb-tools-scripts'

export default function TestPage({ selectedDevice, showNotif }: Props) {
  const [running, setRunning] = useState(false)
  const [processOutput, setProcessOutput] = useState('')
  const [activeTests, setActiveTests] = useState<Record<string, TestResult>>({})
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [scriptPaths, setScriptPaths] = useState<ScriptPaths>({ monkey: null, grafana: null, power: null })
  const [customParam, setCustomParam] = useState('')
  // Collect results output areas
  const [stabilityResult, setStabilityResult] = useState<string | null>(null)
  const [batteryResult, setBatteryResult] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setScriptPaths(JSON.parse(saved))
    } catch (error) {
      console.error('加载脚本路径失败:', error)
    }
  }, [])

  const saveScriptPaths = (paths: ScriptPaths) => {
    setScriptPaths(paths)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(paths))
    } catch (error) {
      console.error('保存脚本路径失败:', error)
    }
  }

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  const uploadScript = async (type: 'monkey' | 'grafana' | 'power') => {
    const file = await openDialog({ multiple: false, filters: [{ name: 'Shell Script', extensions: ['sh'] }] })
    if (!file) return
    saveScriptPaths({ ...scriptPaths, [type]: file })
    addLog(`[脚本] ${type} 已选择: ${file.split(/[\\/]/).pop()}`)
    showNotif('success', `${type}脚本已选择`)
  }

  const pushStabilityScripts = async () => {
    if (!selectedDevice) return false
    if (!scriptPaths.monkey && !scriptPaths.grafana) { showNotif('warning', '请先选择 monkey 或 grafana 脚本'); return false }
    addLog('[推送] 开始推送稳定性脚本...')
    if (scriptPaths.monkey) {
      const r = await invoke<CmdResult>('push_script', { serial: selectedDevice, localPath: scriptPaths.monkey, remotePath: '/data/monkey.sh' })
      if (!r?.success) { showNotif('error', `推送 monkey.sh 失败: ${r?.error}`); return false }
      addLog('[推送] /data/monkey.sh OK')
    }
    if (scriptPaths.grafana) {
      const r = await invoke<CmdResult>('push_script', { serial: selectedDevice, localPath: scriptPaths.grafana, remotePath: '/data/grafana.sh' })
      if (!r?.success) { showNotif('error', `推送 grafana.sh 失败: ${r?.error}`); return false }
      addLog('[推送] /data/grafana.sh OK')
    }
    return true
  }

  const pushPowerScript = async () => {
    if (!selectedDevice) return false
    if (!scriptPaths.power) { showNotif('warning', '请先选择功耗脚本'); return false }
    addLog('[推送] 开始推送功耗脚本...')
    const r = await invoke<CmdResult>('push_script', { serial: selectedDevice, localPath: scriptPaths.power, remotePath: '/data/power_test.sh' })
    if (!r?.success) { showNotif('error', `推送功耗脚本失败: ${r?.error}`); return false }
    addLog('[推送] /data/power_test.sh OK')
    return true
  }

  const runStabilityTest = async (testType: string, testName: string) => {
    if (!selectedDevice) return
    setRunning(true)
    setActiveTests(prev => ({ ...prev, [testName]: { name: testName, status: 'running', output: '', startTime: Date.now() } }))
    addLog(`[稳定性] 启动: ${testName}`)
    try {
      const pushOk = await pushStabilityScripts()
      if (!pushOk) { setActiveTests(prev => ({ ...prev, [testName]: { ...prev[testName], status: 'error', output: '脚本推送失败' } })); setRunning(false); return }
      const r = await invoke<CmdResult>('start_stability_test', { serial: selectedDevice, testType })
      const status = r?.success ? 'success' : 'error'
      setActiveTests(prev => ({ ...prev, [testName]: { ...prev[testName], status, output: r?.output || r?.error || '' } }))
      showNotif(r?.success ? 'success' : 'error', r?.success ? `${testName} 已启动` : r?.error || '启动失败')
      addLog(`[稳定性] ${testName}: ${r?.success ? '已启动' : '失败 - ' + (r?.error || '')}`)
    } catch (e) {
      setActiveTests(prev => ({ ...prev, [testName]: { ...prev[testName], status: 'error', output: String(e) } }))
      showNotif('error', `${testName} 异常: ${e}`)
    }
    setRunning(false)
  }

  const runPowerTest = async (testType: string, testName: string) => {
    if (!selectedDevice) return
    setRunning(true)
    setActiveTests(prev => ({ ...prev, [testName]: { name: testName, status: 'running', output: '', startTime: Date.now() } }))
    addLog(`[功耗] 启动: ${testName}`)
    try {
      const pushOk = await pushPowerScript()
      if (!pushOk) { setActiveTests(prev => ({ ...prev, [testName]: { ...prev[testName], status: 'error', output: '脚本推送失败' } })); setRunning(false); return }
      const r = await invoke<CmdResult>('start_power_test', { serial: selectedDevice, testType })
      const status = r?.success ? 'success' : 'error'
      setActiveTests(prev => ({ ...prev, [testName]: { ...prev[testName], status, output: r?.output || r?.error || '' } }))
      showNotif(r?.success ? 'success' : 'error', r?.success ? `${testName} 已启动` : r?.error || '启动失败')
      addLog(`[功耗] ${testName}: ${r?.success ? '已启动' : '失败 - ' + (r?.error || '')}`)
    } catch (e) {
      setActiveTests(prev => ({ ...prev, [testName]: { ...prev[testName], status: 'error', output: String(e) } }))
      showNotif('error', `${testName} 异常: ${e}`)
    }
    setRunning(false)
  }

  const queryStabilityProcess = async () => {
    if (!selectedDevice) return
    setRunning(true)
    try {
      const r = await invoke<CmdResult>('query_test_process', { serial: selectedDevice })
      setProcessOutput(r?.success ? (r.output || '无运行中的进程') : (r?.error || '查询失败'))
      addLog(`[稳定性] 进程查询: ${r?.success ? '完成' : r?.error}`)
    } catch (e) { showNotif('error', String(e)) }
    setRunning(false)
  }

  const closeStabilityProcess = async () => {
    if (!selectedDevice) return
    setRunning(true)
    try {
      await invoke<CmdResult>('close_stability_process', { serial: selectedDevice })
      showNotif('success', '稳定性进程已关闭'); addLog('[稳定性] 进程已关闭')
      setActiveTests(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(k => { if (k.includes('稳定性')) next[k] = { ...next[k], status: 'error', output: '已手动关闭' } })
        return next
      })
    } catch (e) { showNotif('error', String(e)) }
    setRunning(false)
  }

  const clearStabilityLogs = async () => {
    if (!selectedDevice) return
    setRunning(true)
    try {
      const r = await invoke<CmdResult>('clear_stability_log', { serial: selectedDevice })
      showNotif(r?.success ? 'success' : 'error', r?.success ? '稳定性日志已清除' : r?.error || '清除失败')
      addLog('[稳定性] 日志已清除')
    } catch (e) { showNotif('error', String(e)) }
    setRunning(false)
  }

  const collectStabilityResults = async () => {
    if (!selectedDevice) return
    setRunning(true); addLog('[稳定性] 开始收集结果...')
    setStabilityResult(null)
    try {
      const r = await invoke<CollectResult>('collect_stability_results', { serial: selectedDevice })
      if (r?.success) {
        const dur = r.duration
        const resultPath = `D:\\HardWare\\Stableness\\${selectedDevice}`
        const msg = dur
          ? `✅ 收集成功\n⏱ 时长: ${dur.duration_formatted}\n🕐 开始: ${dur.start_time}\n🕐 结束: ${dur.end_time}\n📁 路径: ${resultPath}`
          : `✅ 稳定性结果已收集`
        setStabilityResult(msg)
        showNotif('success', '稳定性结果收集完成')
        // 自动打开结果目录
        try {
          await invoke('open_file_location', { filePath: resultPath })
        } catch (_) { /* 非关键 */ }
      } else {
        const msg = `❌ 收集失败: ${r?.error || '未知错误'}`
        setStabilityResult(msg)
        showNotif('error', msg)
      }
      addLog(`[稳定性] ${r?.success ? '收集成功' : '失败'} ${r?.duration ? '时长=' + r.duration.duration_formatted : ''}`)
    } catch (e) {
      const msg = `❌ 异常: ${e}`
      setStabilityResult(msg); showNotif('error', msg); addLog(`[稳定性] 收集异常: ${e}`)
    }
    setRunning(false)
  }

  const stopPowerTest = async () => {
    if (!selectedDevice) return
    setRunning(true)
    try {
      await invoke<CmdResult>('close_power_process', { serial: selectedDevice })
      showNotif('success', '功耗进程已关闭'); addLog('[功耗] 进程已关闭')
      setActiveTests(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(k => { if (k.includes('功耗')) next[k] = { ...next[k], status: 'error', output: '已手动关闭' } })
        return next
      })
    } catch (e) { showNotif('error', String(e)) }
    setRunning(false)
  }

  const clearBatteryLog = async () => {
    if (!selectedDevice) return
    setRunning(true)
    try {
      const r = await invoke<CmdResult>('clear_power_log', { serial: selectedDevice })
      showNotif(r?.success ? 'success' : 'error', r?.success ? '电量记录已清除' : r?.error || '清除失败')
      addLog('[功耗] 电量记录已清除')
    } catch (e) { showNotif('error', String(e)) }
    setRunning(false)
  }

  const startBatteryLog = async () => {
    if (!selectedDevice) return
    setRunning(true); addLog('[功耗] 启动电量记录...')
    setActiveTests(prev => ({ ...prev, ['单电量记录']: { name: '单电量记录', status: 'running', output: '', startTime: Date.now() } }))
    try {
      const r = await invoke<CmdResult>('start_battery_log', { serial: selectedDevice })
      const status = r?.success ? 'success' : 'error'
      setActiveTests(prev => ({ ...prev, ['单电量记录']: { ...prev['单电量记录'], status, output: r?.output || r?.error || '' } }))
      if (!r?.success) {
        showNotif('error', r?.error || '启动失败')
      }
      addLog(`[功耗] 电量记录: ${r?.success ? '已启动' : '失败 - ' + (r?.error || '')}`)
    } catch (e) {
      setActiveTests(prev => ({ ...prev, ['单电量记录']: { ...prev['单电量记录'], status: 'error', output: String(e) } }))
      showNotif('error', `单电量记录异常: ${e}`)
    }
    setRunning(false)
  }

  const collectBatteryLog = async () => {
    if (!selectedDevice) return
    setRunning(true); addLog('[功耗] 开始收集功耗记录...')
    setBatteryResult(null)
    try {
      const r = await invoke<CollectResult>('collect_battery_log', { serial: selectedDevice })
      if (r?.success) {
        const dur = r.duration
        const resultPath = `D:\\HardWare\\Stableness\\${selectedDevice}`
        const msg = dur
          ? `✅ 收集成功\n⏱ 时长: ${dur.duration_formatted}\n🕐 开始: ${dur.start_time}\n🕐 结束: ${dur.end_time}\n📁 路径: ${resultPath}`
          : `✅ 功耗记录已收集`
        setBatteryResult(msg)
        showNotif('success', '功耗记录收集完成')
        // 自动打开结果目录
        try {
          await invoke('open_file_location', { filePath: resultPath })
        } catch (_) { /* 非关键 */ }
      } else {
        const msg = `❌ 收集失败: ${r?.error || '未知错误'}`
        setBatteryResult(msg)
        showNotif('error', msg)
      }
      addLog(`[功耗] ${r?.success ? '收集成功' : '失败'} ${r?.duration ? '时长=' + r.duration.duration_formatted : ''}`)
    } catch (e) {
      const msg = `❌ 异常: ${e}`
      setBatteryResult(msg); showNotif('error', msg); addLog(`[功耗] 收集异常: ${e}`)
    }
    setRunning(false)
  }

  const runCustomTest = async () => {
    if (!customParam.trim()) { showNotif('warning', '请输入自定义参数'); return }
    await runStabilityTest(customParam, `自定义: ${customParam}`)
  }

  const stopAllTests = async () => {
    if (!selectedDevice) return
    setRunning(true)
    try {
      await closeStabilityProcess(); await stopPowerTest()
      showNotif('success', '所有测试已停止'); setActiveTests({}); addLog('[控制] 停止全部测试')
    } catch (e) { showNotif('error', String(e)) }
    setRunning(false)
  }

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
      <div className="section-title">测试套件</div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><FolderOpen size={14} /> 脚本选择（运行时自动推送）</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { key: 'monkey', label: 'Monkey 脚本', color: '#10b981' },
            { key: 'grafana', label: 'Grafana 脚本', color: '#10b981' },
            { key: 'power', label: '功耗脚本', color: '#f59e0b' },
          ].map(({ key, label, color }) => {
            const k = key as 'monkey' | 'grafana' | 'power'
            const selected = scriptPaths[k]
            return (
              <div key={key}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>{label}</label>
                <button onClick={() => uploadScript(k)} style={{
                  width: '100%', padding: '10px 12px',
                  background: selected ? color + '18' : 'var(--bg-card)',
                  border: selected ? '1px solid ' + color : '1px dashed var(--border-color)',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13,
                  color: selected || 'var(--text-muted)', textAlign: 'left',
                }}>
                  {selected ? '\u2705 ' + selected.split(/[\\/]/).pop() : '\ud83d\udcc1 选择 ' + key + '.sh'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Stability Test */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><Activity size={14} /> 稳定性测试</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          <button className="tool-btn" onClick={() => runStabilityTest('scan', '扫描稳定性')} disabled={running}>
            <Activity size={18} /><span className="tool-name">扫描稳定性</span>
          </button>
          <button className="tool-btn" onClick={() => runStabilityTest('random', '随机稳定性')} disabled={running}>
            <RefreshCw size={18} /><span className="tool-name">随机稳定性</span>
          </button>
          <button className="tool-btn" onClick={() => runStabilityTest('mem', '内存记录')} disabled={running}>
            <FileText size={18} /><span className="tool-name">内存记录</span>
          </button>
          <button className="tool-btn" onClick={queryStabilityProcess} disabled={running}>
            <Search size={18} /><span className="tool-name">查询进程</span>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
          <button className="btn btn-danger" onClick={closeStabilityProcess} disabled={running} style={{ fontSize: 12, padding: '5px 12px' }}>
            <XCircle size={12} /> 关闭进程
          </button>
          <button className="btn btn-secondary" onClick={clearStabilityLogs} disabled={running} style={{ fontSize: 12, padding: '5px 12px' }}>
            <Trash2 size={12} /> 清除日志
          </button>
          <button className="btn btn-success" onClick={collectStabilityResults} disabled={running} style={{ fontSize: 12, padding: '5px 12px' }}>
            <Download size={12} /> 收集结果
          </button>
        </div>
        {/* Process output inside stability card */}
        {processOutput && (
          <div className="terminal" style={{ marginTop: 10 }}>
            <div className="terminal-header">
              <div className="terminal-dots"><span /><span /><span /></div>
              <div className="terminal-title">进程状态</div>
              <button className="icon-btn" onClick={() => setProcessOutput('')}><Trash2 size={11} /></button>
            </div>
            <div className="terminal-output" style={{ maxHeight: 200 }}>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{processOutput}</pre>
            </div>
          </div>
        )}
        {/* Stability collect result output */}
        {stabilityResult && (
          <div className="collect-result-box" style={{ marginTop: 10 }}>
            <div className="collect-result-header">
              <Download size={13} /> 稳定性收集结果
              <button onClick={() => setStabilityResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
            <pre className="collect-result-content">{stabilityResult}</pre>
          </div>
        )}
      </div>

      {/* Power Test */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><Battery size={14} /> 功耗测试</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          <button className="tool-btn" onClick={() => runPowerTest('idle', '屏幕常亮功耗')} disabled={running}>
            <Clock size={18} /><span className="tool-name">屏幕常亮功耗</span>
          </button>
          <button className="tool-btn" onClick={() => runPowerTest('ocr', '扫描功耗')} disabled={running}>
            <Zap size={18} /><span className="tool-name">扫描功耗</span>
          </button>
          <button className="tool-btn" onClick={startBatteryLog} disabled={running}>
            <Play size={18} /><span className="tool-name">单电量记录</span>
          </button>
          <button className="tool-btn" onClick={stopPowerTest} disabled={running}>
            <XCircle size={18} /><span className="tool-name">停止测试</span>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
          <button className="btn btn-danger" onClick={stopPowerTest} disabled={running} style={{ fontSize: 12, padding: '5px 12px' }}>
            <XCircle size={12} /> 关闭进程
          </button>
          <button className="btn btn-secondary" onClick={clearBatteryLog} disabled={running} style={{ fontSize: 12, padding: '5px 12px' }}>
            <Trash2 size={12} /> 清除日志
          </button>
          <button className="btn btn-success" onClick={collectBatteryLog} disabled={running} style={{ fontSize: 12, padding: '5px 12px' }}>
            <Download size={12} /> 收集结果
          </button>
        </div>
        {/* Battery result output */}
        {batteryResult && (
          <div className="collect-result-box" style={{ marginTop: 10 }}>
            <div className="collect-result-header">
              <Download size={13} /> 功耗收集结果
              <button onClick={() => setBatteryResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
            <pre className="collect-result-content">{batteryResult}</pre>
          </div>
        )}
      </div>

      {/* Custom Test */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><Terminal size={14} /> 自定义稳定性测试</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="text" value={customParam} onChange={e => setCustomParam(e.target.value)}
            placeholder="输入 monkey.sh 后置参数，如: ocr"
            style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 13 }} />
          <button className="btn btn-success" onClick={runCustomTest} disabled={running}>
            <Play size={12} /> 执行
          </button>
        </div>
      </div>

      {/* Global Control */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><Terminal size={14} /> 全局控制</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-danger" onClick={stopAllTests} disabled={running}>
            <Square size={12} /> 停止全部测试
          </button>
          <button className="btn btn-secondary" onClick={() => setShowLogs(!showLogs)}>
            <FileText size={12} /> {showLogs ? '隐藏' : '显示'}日志
          </button>
        </div>
      </div>

      {/* Active Tests */}
      {Object.keys(activeTests).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title"><CheckCircle2 size={14} /> 测试状态</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.values(activeTests).map(test => (
              <div key={test.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)' }}>
                {test.status === 'running' ? (
                  <div className="spinner" style={{ width: 14, height: 14 }} />
                ) : test.status === 'success' ? (
                  <CheckCircle2 size={14} style={{ color: 'var(--accent-secondary)' }} />
                ) : (
                  <AlertCircle size={14} style={{ color: 'var(--accent-error)' }} />
                )}
                <span style={{ flex: 1 }}>{test.name}</span>
                <span className={'badge badge-' + (test.status === 'success' ? 'green' : test.status === 'error' ? 'red' : 'blue')}>
                  {test.status === 'running' ? '运行中' : test.status === 'success' ? '成功' : '失败'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Logs */}
      {showLogs && logs.length > 0 && (
        <div className="terminal" style={{ marginTop: 16 }}>
          <div className="terminal-header">
            <div className="terminal-dots"><span /><span /><span /></div>
            <div className="terminal-title">操作日志 ({logs.length})</div>
            <button className="icon-btn" onClick={() => setLogs([])}><Trash2 size={11} /></button>
          </div>
          <div className="terminal-output" style={{ maxHeight: 250 }}>
            {logs.map((log, i) => <div key={i} className="log-line">{log}</div>)}
          </div>
        </div>
      )}

      {running && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, color: 'var(--accent-primary)', fontSize: 12 }}>
          <div className="spinner" /> 正在执行...
        </div>
      )}
    </div>
  )
}
