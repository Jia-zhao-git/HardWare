import { useState, useEffect, useRef } from 'react'
import { invoke } from '../api/electron-bridge'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { Play, Square } from 'lucide-react'

interface Props {
  selectedDevice: string
  // 从父组件传入的状态（跨 Tab 保留）
  perfHistory?: DataPoint[]
  setPerfHistory?: (data: DataPoint[] | ((prev: DataPoint[]) => DataPoint[])) => void
  perfLive?: DataPoint | null
  setPerfLive?: (data: DataPoint | null) => void
  perfProcesses?: ProcessInfo[]
  setPerfProcesses?: (data: ProcessInfo[] | ((prev: ProcessInfo[]) => ProcessInfo[])) => void
}

interface ProcessInfo {
  label: string
  pid?: number
  vmrss?: number
  threads?: number
}

interface DataPoint {
  time: string
  t: number
  cpu: number
  mem: number
  battery: number
  cpuTemp: number
  batTemp: number
}

const INTERVALS = [
  { label: '0.5s', ms: 500 },
  { label: '1s', ms: 1000 },
  { label: '2s', ms: 2000 },
  { label: '3s', ms: 3000 },
]

const tempColor = (v: number) => v > 70 ? '#ef4444' : v > 50 ? '#f59e0b' : '#10b981'
const batColor  = (v: number) => v > 80 ? '#10b981' : v > 20 ? '#3b82f6' : '#ef4444'

function ArcGauge({ value, max, label, color, sub }: { value: number; max: number; label: string; color: string; sub?: string }) {
  const pct = Math.min((value / max) * 100, 100)
  const r = 38, cx = 50, cy = 50
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ textAlign: 'center', position: 'relative' }}>
      <svg viewBox="0 0 100 100" width="100" height="80">
        {/* 背景圆环 - 使用 CSS 变量适配主题 */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-color)" strokeWidth="6" />
        <circle
          cx={cx} cy={cy} r={r} fill="none" stroke={color}
          strokeWidth="6" strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 0.5s' }}
        />
        {/* 数值文字 - 使用主题色 */}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text-primary)" fontSize="16" fontWeight="700" fontFamily="monospace">
          {value.toFixed(1)}
        </text>
        {/* 标签文字 - 使用次要文字色 */}
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--text-secondary)" fontSize="9">
          {label}
        </text>
      </svg>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function PerfPage({ 
  selectedDevice, 
  perfHistory: externalHistory,
  setPerfHistory: externalSetHistory,
  perfLive: externalLive,
  setPerfLive: externalSetLive,
  perfProcesses: externalProcesses,
  setPerfProcesses: externalSetProcesses,
}: Props) {
  // 使用父组件的状态，如果没有则使用本地状态（向后兼容）
  const [data, setData] = useState<DataPoint[]>(externalHistory || [])
  const [live, setLive] = useState<DataPoint | null>(externalLive || null)
  const [processes, setProcesses] = useState<ProcessInfo[]>(externalProcesses || [])
  const [monitoring, setMonitoring] = useState(false)
  const [chartType, setChartType] = useState<'all' | 'cpu' | 'mem' | 'temp'>('all')
  const [intervalMs, setIntervalMs] = useState(2000)
  const ivRef = useRef<NodeJS.Timeout | null>(null)
  const aliveRef = useRef(false)

  // Start / Stop monitoring
  const startMonitoring = () => {
    if (!selectedDevice || monitoring) return
    setMonitoring(true)
    aliveRef.current = true

    const fetchPerf = async () => {
      try {
        const r = await invoke<any>('get_performance_monitor', { serial: selectedDevice })
        if (!r || !aliveRef.current) return

        const usr = parseFloat(r.cpu_usr) || 0
        const sys = parseFloat(r.cpu_sys) || 0
        const cpu = Math.min(usr + sys, 100)
        const memAvail = r.mem_available || 1
        const memFree   = r.mem_free || 0
        const memUsed  = memAvail - memFree
        const memPct   = (memUsed / memAvail) * 100
        const cpuTemp  = (r.cpu_temp || 0) / 1000
        const batTemp  = (r.battery_temp || 0) / 10
        const battery  = r.battery_capacity || 0
        const now = new Date()
        const t = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`

        const point: DataPoint = { time: t, t: now.getTime(), cpu, mem: memPct, battery, cpuTemp, batTemp }
        
        // 更新本地状态（限制最大 5000 条数据，防止内存溢出）
        setLive(point)
        setData(prev => {
          const newData = [...prev, point]
          return newData.length > 5000 ? newData.slice(-5000) : newData
        })
        
        // 同步到父组件（跨 Tab 保留）
        if (externalSetLive) externalSetLive(point)
        if (externalSetHistory) {
          externalSetHistory(prev => {
            const newData = [...prev, point]
            return newData.length > 5000 ? newData.slice(-5000) : newData
          })
        }

        const newProcesses = [
          { label: 'MiniApp',      pid: r.miniapp_pid,      vmrss: r.miniapp_vmrss,      threads: r.miniapp_threads },
          { label: 'SoundPlayer',  pid: r.soundplayer_pid,  vmrss: r.soundplayer_vmrss,  threads: r.soundplayer_threads },
          { label: 'CaptureFrame', pid: r.captureframe_pid, vmrss: r.captureframe_vmrss, threads: r.captureframe_threads },
          { label: 'SoundRecord',  pid: r.soundrecord_pid, vmrss: r.soundrecord_vmrss,   threads: r.soundrecord_threads },
        ]
        setProcesses(newProcesses)
        if (externalSetProcesses) externalSetProcesses(newProcesses)
      } catch (error) {
        console.error('获取性能数据失败:', error)
        // 静默失败，不影响监控继续运行
      }
    }

    fetchPerf()
    ivRef.current = setInterval(fetchPerf, intervalMs)
  }

  const stopMonitoring = () => {
    aliveRef.current = false
    if (ivRef.current) { clearInterval(ivRef.current); ivRef.current = null }
    setMonitoring(false)
  }

  // When interval changes while monitoring, restart
  useEffect(() => {
    if (monitoring) {
      stopMonitoring()
      // Small delay to allow state update, then restart
      const timer = setTimeout(() => startMonitoring(), 100)
      return () => clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs])

  // Cleanup on unmount - 不清空数据，只停止定时器
  useEffect(() => {
    return () => { 
      aliveRef.current = false
      if (ivRef.current) clearInterval(ivRef.current)
      // 注意：不再清空 data、live、processes，保留数据
    }
  }, [])

  // 从父组件恢复数据（当组件重新挂载时）
  useEffect(() => {
    if (externalHistory && externalHistory.length > 0) {
      setData(externalHistory)
    }
    if (externalLive) {
      setLive(externalLive)
    }
    if (externalProcesses && externalProcesses.length > 0) {
      setProcesses(externalProcesses)
    }
  }, [externalHistory, externalLive, externalProcesses])

  // Reset data when device changes - 只在设备真正改变时清空
  useEffect(() => {
    stopMonitoring()
    // 注释掉清空数据的逻辑，保留历史数据
    // setData([])
    // setLive(null)
    // setProcesses([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice])

  if (!selectedDevice) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📊</div>
        <div className="empty-text">请先连接设备</div>
      </div>
    )
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{label}</div>
        {payload.map((p: any) => (
          <div key={p.dataKey} style={{ color: p.color }}>
            {p.name}: <b>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}{p.unit || ''}</b>
          </div>
        ))}
      </div>
    )
  }

  const chartLines = {
    all:  [
      { key: 'cpu',      name: 'CPU%',   color: '#3b82f6', unit: '%',  yAxisId: 'pct' },
      { key: 'mem',      name: '内存%',  color: '#a855f7', unit: '%',  yAxisId: 'pct' },
      { key: 'battery',  name: '电量%',  color: '#10b981', unit: '%',  yAxisId: 'pct' },
      { key: 'cpuTemp',  name: 'CPU温',  color: '#ef4444', unit: '°',  yAxisId: 'temp' },
      { key: 'batTemp',  name: '电池温', color: '#f59e0b', unit: '°',  yAxisId: 'temp' },
    ],
    cpu: [
      { key: 'cpu',      name: 'CPU%',   color: '#3b82f6', unit: '%',  yAxisId: 'pct' },
      { key: 'mem',      name: '内存%',  color: '#a855f7', unit: '%',  yAxisId: 'pct' },
    ],
    mem: [
      { key: 'cpu',      name: 'CPU%',   color: '#3b82f6', unit: '%',  yAxisId: 'pct' },
      { key: 'mem',      name: '内存%',  color: '#a855f7', unit: '%',  yAxisId: 'pct' },
    ],
    temp: [
      { key: 'cpuTemp',  name: 'CPU温',  color: '#ef4444', unit: '°',  yAxisId: 'temp' },
      { key: 'batTemp',  name: '电池温', color: '#f59e0b', unit: '°',  yAxisId: 'temp' },
    ],
  }

  const lines = chartLines[chartType]
  const needRightAxis = chartType === 'all' || chartType === 'temp'
  const totalMem = live ? (live.mem * 0.01 * (1024 * 1024)) : 1
  const durationMin = data.length > 0 ? ((data[data.length - 1].t - data[0].t) / 60000).toFixed(1) : '0'

  return (
    <div>
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>性能监控</span>

        {/* Monitor toggle */}
        <button
          className={`btn btn-sm ${monitoring ? 'btn-danger' : 'btn-success'}`}
          onClick={monitoring ? stopMonitoring : startMonitoring}
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {monitoring ? <><Square size={12} /> 停止</> : <><Play size={12} /> 开始监控</>}
        </button>

        {/* Interval selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>刷新间隔</span>
          {INTERVALS.map(iv => (
            <button
              key={iv.ms}
              className={`btn btn-sm ${intervalMs === iv.ms ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setIntervalMs(iv.ms)}
              style={{ padding: '2px 8px', fontSize: 11 }}
            >
              {iv.label}
            </button>
          ))}
        </div>

        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {monitoring ? `已采集 ${data.length} 点 · ${durationMin} 分钟` : data.length > 0 ? `共 ${data.length} 点 · ${durationMin} 分钟（已暂停）` : '未开始'}
        </span>
      </div>

      {/* Arc Gauges */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
        <ArcGauge value={live?.cpu     ?? 0} max={100} label="CPU%"  color="#3b82f6" sub="usr/sys" />
        <ArcGauge value={live?.mem     ?? 0} max={100} label="内存%" color="#a855f7" sub="已用%" />
        <ArcGauge value={live?.battery ?? 0} max={100} label="电量%" color={batColor(live?.battery ?? 0)} />
        <ArcGauge value={live?.cpuTemp ?? 0} max={100} label="°C"    color={tempColor(live?.cpuTemp ?? 0)} />
        <ArcGauge value={live?.batTemp ?? 0} max={60}  label="°C"   color={tempColor(live?.batTemp ?? 0)} />
      </div>

      {/* Chart Area */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            <span>📈 实时曲线</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            {(['all', 'cpu', 'mem', 'temp'] as const).map(t => (
              <button key={t} className={`btn btn-sm ${chartType === t ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setChartType(t)} style={{ padding: '3px 10px', fontSize: 11 }}>
                {t === 'all' ? '全部' : t === 'cpu' ? 'CPU' : t === 'mem' ? '内存' : '温度'}
              </button>
            ))}
            {data.length > 60 && (
              <button className="btn btn-sm btn-secondary" onClick={() => setData([])} style={{ padding: '3px 10px', fontSize: 11 }}>
                清空数据
              </button>
            )}
          </div>
        </div>

        {data.length < 2 ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            {!monitoring ? '点击「开始监控」采集数据' : '数据采集中...'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="time" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
                interval="preserveStartEnd" minTickGap={60}
              />
              <YAxis
                yAxisId="pct"
                domain={[0, 100]} tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
                width={30} tickFormatter={v => `${v}%`}
              />
              {needRightAxis && (
                <YAxis
                  yAxisId="temp" orientation="right"
                  domain={[0, 100]} tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
                  width={30} tickFormatter={v => `${v}°`}
                />
              )}
              <Tooltip content={<CustomTooltip />} />
              {chartType !== 'temp' && <ReferenceLine yAxisId="pct" y={80} stroke="rgba(239,68,68,0.3)" strokeDasharray="4 4" />}
              {chartType !== 'temp' && <ReferenceLine yAxisId="pct" y={60} stroke="rgba(245,158,11,0.3)" strokeDasharray="4 4" />}
              {lines.map(l => (
                <Line
                  key={l.key}
                  type="monotone"
                  dataKey={l.key}
                  name={l.name}
                  stroke={l.color}
                  strokeWidth={2}
                  yAxisId={l.yAxisId}
                  dot={false}
                  isAnimationActive={false}
                  unit={l.unit}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Process + Mem Detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-title">进程监控</div>
          <table className="process-table">
            <thead><tr><th>进程</th><th>PID</th><th>VmRSS</th><th>线程</th></tr></thead>
            <tbody>
              {processes.map(p => (
                <tr key={p.label}>
                  <td><span className={`badge ${p.vmrss && p.vmrss > 0 ? 'badge-green' : 'badge-red'}`}>{p.label}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.pid && p.pid > 0 ? p.pid : '-'}</td>
                  <td style={{ color: p.vmrss && p.vmrss > 0 ? 'var(--text-primary)' : 'var(--accent-error)' }}>
                    {p.vmrss && p.vmrss > 0 ? `${(p.vmrss / 1024).toFixed(1)} MB` : '未运行'}
                  </td>
                  <td>{p.threads && p.threads > 0 ? p.threads : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">内存详情</div>
          {live && (
            <>
              <div className="info-row"><span className="info-label">已用内存</span>
                <span className="info-value">{((live.mem / 100) * (totalMem / 1024)).toFixed(1)} GB</span>
              </div>
              <div className="info-row"><span className="info-label">内存占用</span>
                <span className="info-value">{live.mem.toFixed(1)}%</span>
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  <span>占用</span><span>{live.mem.toFixed(1)}%</span>
                </div>
                <div className="progress-bar" style={{ height: 8 }}>
                  <div className={`progress-fill ${live.mem > 80 ? 'red' : 'blue'}`}
                    style={{ width: `${live.mem}%`, transition: 'width 0.5s' }} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
