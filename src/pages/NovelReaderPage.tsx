import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke, open as openDialog, readFileRange } from '../api/electron-bridge'
import {
  ArrowLeft, BookOpen, Eye, EyeOff, Upload, Trash2, Code2,
  ChevronLeft, ChevronRight, Palette, Baseline
} from 'lucide-react'

interface NovelMeta {
  filePath: string
  title: string
  fileSize: number
  importedAt: number
}

interface Props {
  onBack: () => void
}

const CHUNK_CHARS = 8000

const COMMENT_COLORS = [
  { label: '绿', value: '#0a0' },
  { label: '灰', value: '#888' },
  { label: '蓝', value: '#5af' },
  { label: '黄', value: '#da2' },
  { label: '青', value: '#0cc' },
  { label: '紫', value: '#c0f' },
]

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18]

export default function NovelReaderPage({ onBack }: Props) {
  const [novelMeta, setNovelMeta] = useState<NovelMeta | null>(null)
  const [codeLines, setCodeLines] = useState<string[]>([])
  const [showNovel, setShowNovel] = useState(true)
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)
  const autoLoadingRef = useRef(false)
  const readEndByteRef = useRef(0)
  const readStartByteRef = useRef(0)
  const fileSizeRef = useRef(0)
  const pendingScrollRef = useRef(-1)
  const prependingRef = useRef(false)
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentByteRef = useRef(0)
  const scrollRatioRef = useRef(0)

  // 自定义：注释颜色 + 字号
  const [commentColor, setCommentColor] = useState('#0a0')
  const [fontSize, setFontSize] = useState(12)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showFontPicker, setShowFontPicker] = useState(false)
  const [currentByte, setCurrentByte] = useState(0)

  // 当前阅读字节 = 视口“顶部”对应的字节
  // 必须与恢复逻辑 (el.scrollTop = ratio * scrollHeight) 保持同一基准，
  // 否则每次保存/恢复都会累积半个视口的偏移（表现为切 tab progress 固定 +0.01%）
  const getViewportByte = useCallback(() => {
    const el = scrollRef.current
    const blockBytes = Math.max(1, readEndByteRef.current - readStartByteRef.current)
    if (!el || el.scrollHeight === 0) return readStartByteRef.current

    const ratio = el.scrollTop / el.scrollHeight
    const clampedRatio = Math.max(0, Math.min(1, ratio))
    return Math.floor(readStartByteRef.current + clampedRatio * blockBytes)
  }, [])

  // 恢复
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    try {
      const saved = localStorage.getItem('adb_novel_meta')
      if (saved) {
        const meta: NovelMeta = JSON.parse(saved)
        setNovelMeta(meta)
        fileSizeRef.current = meta.fileSize
        // 恢复上次阅读字节位置（直接按字节加载，不走百分比防精度丢失）
        const lastByte = Number(localStorage.getItem('adb_novel_last_byte') || '0')
        restorePosition(meta, lastByte)
      }
    } catch { /* ignore */ }
    // 恢复偏好
    const c = localStorage.getItem('adb_novel_comment_color')
    if (c) setCommentColor(c)
    const s = localStorage.getItem('adb_novel_font_size')
    if (s) setFontSize(Number(s))
  }, [])

  // 退出/卸载时兜底保存（onScroll 节流 100ms 内可能没写完）
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current)
      }
      if (novelMeta) {
        const viewportByte = getViewportByte()
        localStorage.setItem('adb_novel_last_byte', String(viewportByte))
        localStorage.setItem('adb_novel_scroll_ratio', String(scrollRatioRef.current))
      }
    }
  }, [novelMeta, getViewportByte])

  // 恢复滚动位置（等 codeLines 渲染完成后）
  useEffect(() => {
    if (pendingScrollRef.current >= 0 && scrollRef.current) {
      const el = scrollRef.current
      const ratio = pendingScrollRef.current
      pendingScrollRef.current = -1
      // 用 rAF 确保 DOM 已绘制完成再设 scrollTop
      requestAnimationFrame(() => {
        el.scrollTop = ratio * el.scrollHeight
      })
    }
  }, [codeLines])

  const loadPosition = useCallback(async (meta: NovelMeta, pct: number) => {
    setLoading(true)
    const clamped = Math.max(0, Math.min(100, pct))
    try {
      const startByte = Math.floor((clamped / 100) * meta.fileSize)
      const readLen = Math.min(CHUNK_CHARS, meta.fileSize - startByte)
      const endByte = startByte + readLen
      const content = await readFileRange(meta.filePath, startByte, endByte)
      readEndByteRef.current = endByte
      readStartByteRef.current = startByte
      currentByteRef.current = startByte
      setCurrentByte(startByte)
      scrollRatioRef.current = 0
      pendingScrollRef.current = -1
      setCodeLines(await generateMixedCode(content))
      scrollRef.current?.scrollTo(0, 0)
      localStorage.setItem('adb_novel_last_byte', String(startByte))
      localStorage.setItem('adb_novel_scroll_ratio', '0')
    } catch (e) {
      setNotification('读取失败: ' + String(e))
    }
    setLoading(false)
  }, [])

  // 按精确字节恢复（从块起点加载，再按比例恢复 scrollTop）
  const restorePosition = useCallback(async (meta: NovelMeta, startByte: number) => {
    setLoading(true)
    const clampedViewport = Math.max(0, Math.min(startByte, meta.fileSize - 1))
    const clampedStart = Math.max(0, Math.min(clampedViewport - Math.floor(CHUNK_CHARS / 2), meta.fileSize - CHUNK_CHARS))
    try {
      const readLen = Math.min(CHUNK_CHARS, meta.fileSize - clampedStart)
      const endByte = clampedStart + readLen
      const content = await readFileRange(meta.filePath, clampedStart, endByte)
      readEndByteRef.current = endByte
      readStartByteRef.current = clampedStart
      const blockBytes = Math.max(1, endByte - clampedStart)
      const clampedRatio = (clampedViewport - clampedStart) / blockBytes
      pendingScrollRef.current = Math.max(0, Math.min(1, clampedRatio))
      currentByteRef.current = clampedViewport
      setCurrentByte(clampedViewport)
      scrollRatioRef.current = pendingScrollRef.current
      setCodeLines(await generateMixedCode(content))
      localStorage.setItem('adb_novel_last_byte', String(clampedViewport))
      localStorage.setItem('adb_novel_scroll_ratio', String(pendingScrollRef.current))
    } catch (e) {
      setNotification('读取失败: ' + String(e))
    }
    setLoading(false)
  }, [])

  const appendNextChunk = useCallback(async () => {
    if (autoLoadingRef.current) return
    autoLoadingRef.current = true
    const fileSize = fileSizeRef.current
    const startByte = readEndByteRef.current
    if (startByte >= fileSize) {
      autoLoadingRef.current = false
      return
    }
    const readLen = Math.min(CHUNK_CHARS, fileSize - startByte)
    const endByte = startByte + readLen
    try {
      const content = await readFileRange(novelMeta!.filePath, startByte, endByte)
      readEndByteRef.current = endByte
      const mixed = await generateMixedCode(content)
      setCodeLines(prev => [...prev, ...mixed])
    } catch (e) {
      setNotification('加载失败: ' + String(e))
    }
    autoLoadingRef.current = false
  }, [novelMeta])

  // 向上滚动时预加载前面的内容
  const prependPrevChunk = useCallback(async () => {
    if (prependingRef.current || autoLoadingRef.current) return
    prependingRef.current = true
    const startByte = readStartByteRef.current
    if (startByte <= 0) {
      prependingRef.current = false
      return
    }
    const prevEndByte = startByte
    const prevStartByte = Math.max(0, startByte - CHUNK_CHARS)
    try {
      const oldScrollHeight = scrollRef.current?.scrollHeight || 0
      const content = await readFileRange(novelMeta!.filePath, prevStartByte, prevEndByte)
      readStartByteRef.current = prevStartByte
      const mixed = await generateMixedCode(content)
      setCodeLines(prev => {
        // 插入新内容后补偿滚动位置
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight - oldScrollHeight
          }
        })
        return [...mixed, ...prev]
      })
    } catch (e) {
      setNotification('向上加载失败: ' + String(e))
    }
    prependingRef.current = false
  }, [novelMeta])

  // 滚动到底部触发加载 / 滚动到顶部加载之前内容
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    // 实时节流保存阅读位置（100ms 防抖）
    // 保存块起点字节（精确）+ scrollTop/scrollHeight 比例（0~1）
    if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
    scrollSaveTimerRef.current = setTimeout(() => {
      const viewportByte = getViewportByte()
      currentByteRef.current = viewportByte
      setCurrentByte(viewportByte)
      if (el.scrollHeight > 0) {
        scrollRatioRef.current = el.scrollTop / el.scrollHeight
      }
      localStorage.setItem('adb_novel_last_byte', String(viewportByte))
      localStorage.setItem('adb_novel_scroll_ratio', String(scrollRatioRef.current))
    }, 100)

    if (!loading && readEndByteRef.current < fileSizeRef.current) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
      if (nearBottom) appendNextChunk()
    }
    // 向上滚动接近顶部时预加载前面内容
    if (el.scrollTop < 100 && readStartByteRef.current > 0) {
      prependPrevChunk()
    }
  }, [loading, appendNextChunk, prependPrevChunk, getViewportByte])

  const jumpToPercent = (pct: number) => {
    if (!novelMeta) return
    loadPosition(novelMeta, pct)
  }

  const [sliderPos, setSliderPos] = useState(0)
  // 百分比输入框值（支持 0.01 精度）
  const [inputPct, setInputPct] = useState('0.00')
  const [showPctInput, setShowPctInput] = useState(false)
  useEffect(() => {
    if (novelMeta && novelMeta.fileSize > 0) {
      const pct = (currentByte / novelMeta.fileSize) * 100
      setSliderPos(Math.round(pct))
      setInputPct(pct.toFixed(2))
    } else {
      setSliderPos(0)
      setInputPct('0.00')
    }
  }, [novelMeta, currentByte])

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) =>
    setSliderPos(Number(e.target.value))

  const handleSliderCommit = () => jumpToPercent(sliderPos)

  const handleDoubleClick = () => setShowNovel(!showNovel)

  const handleImport = async () => {
    try {
      const filePath = await openDialog({
        multiple: false,
        filters: [{ name: '文本文件', extensions: ['txt', 'md', 'text'] }],
      })
      if (!filePath) return
      setLoading(true)
      const result = await invoke<{
        success: boolean
        preview?: string
        fileSize?: number
        previewBytes?: number
        error?: string
      }>('scan_novel_file', { path: filePath })
      if (!result?.success || result.fileSize == null) {
        setNotification('读取文件失败: ' + (result?.error || '未知错误'))
        setLoading(false)
        return
      }
      const title = filePath.split(/[\\/]/).pop()?.replace(/\.(txt|md|text)$/, '') || '未命名'
      const meta: NovelMeta = { filePath, title, fileSize: result.fileSize, importedAt: Date.now() }
      localStorage.setItem('adb_novel_meta', JSON.stringify(meta))
      setNovelMeta(meta)
      fileSizeRef.current = result.fileSize
      readEndByteRef.current = result.previewBytes ?? Math.min(CHUNK_CHARS, result.fileSize)
      readStartByteRef.current = 0
      currentByteRef.current = 0
      scrollRatioRef.current = 0
      pendingScrollRef.current = -1
      setCurrentByte(0)
      setSliderPos(0)
      if (result.preview) setCodeLines(await generateMixedCode(result.preview))
      setShowNovel(true)
      setNotification('已导入「' + title + '」')
      setTimeout(() => setNotification(''), 3000)
    } catch (e) {
      setNotification('导入失败: ' + String(e))
      setTimeout(() => setNotification(''), 3000)
    }
    setLoading(false)
  }

  const clearNovel = () => {
    localStorage.removeItem('adb_novel_meta')
    localStorage.removeItem('adb_novel_last_byte')
    localStorage.removeItem('adb_novel_last_scroll')
    setNovelMeta(null)
    setCodeLines([])
    readEndByteRef.current = 0
    readStartByteRef.current = 0
    fileSizeRef.current = 0
    currentByteRef.current = 0
    scrollRatioRef.current = 0
    setCurrentByte(0)
    setSliderPos(0)
  }

  // ====== 渲染行 ======
  const renderLine = (line: string, i: number) => {
    const isNovelComment = line.startsWith('// ') && !line.startsWith('// ===') &&
      !line.startsWith('// @') && !line.startsWith('// TODO') &&
      !line.startsWith('// FIXME')
    const isChapterHeader = line.includes('═══')

    // 隐藏模式：彻底隐藏注释行
    if (!showNovel && isNovelComment) return null

    const color = isChapterHeader ? '#ff0'
      : isNovelComment ? commentColor
      : line.startsWith('//') ? '#444'
      : /^(function|class|const|let|var|interface|export|import|async|return|if|for|while|try|catch|throw|new|switch|case|default)\b/.test(line.trimStart()) ? '#c678dd'
      : /\b(function|class|const|let|var|interface|export|import|async|return|if|else|for|while|throw|new|this|typeof|instanceof|switch|case|default)\b/.test(line) ? '#e5c07b'
      : '#abb2bf'

    return (
      <div key={i} style={{ whiteSpace: 'pre', color }}>
        {line}
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        background: '#0a0a0a', color: '#e0e0e0',
        fontFamily: "'Cascadia Code','Consolas','Fira Code',monospace",
        position: 'relative',
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 14px', background: '#111', borderBottom: '1px solid #1a1a2e',
        fontSize: 12, userSelect: 'none', flexWrap: 'wrap',
      }}>
        <button onClick={onBack} style={btnStyle('#888')}>
          <ArrowLeft size={13} /> 退出
        </button>
        <span style={{ color: '#0f0', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Code2 size={13} />
          {novelMeta?.title || 'Code Editor'}
        </span>
        <div style={{ flex: 1 }} />

        {/* 字号选择 */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setShowFontPicker(!showFontPicker); setShowColorPicker(false) }}
            style={btnStyle('#aaa')} title="字号">
            <Baseline size={12} /> {fontSize}px
          </button>
          {showFontPicker && (
            <div style={popupStyle}>
              {FONT_SIZES.map(s => (
                <div key={s}
                  onClick={() => { setFontSize(s); localStorage.setItem('adb_novel_font_size', String(s)); setShowFontPicker(false) }}
                  style={{ ...popupItemStyle, fontWeight: s === fontSize ? 700 : 400, color: s === fontSize ? '#0f0' : '#aaa' }}>
                  {s}px
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 注释颜色选择 */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setShowColorPicker(!showColorPicker); setShowFontPicker(false) }}
            style={btnStyle(commentColor)} title="注释颜色">
            <Palette size={12} />
          </button>
          {showColorPicker && (
            <div style={popupStyle}>
              {COMMENT_COLORS.map(c => (
                <div key={c.value}
                  onClick={() => { setCommentColor(c.value); localStorage.setItem('adb_novel_comment_color', c.value); setShowColorPicker(false) }}
                  style={{ ...popupItemStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, background: c.value, display: 'inline-block' }} />
                  {c.label}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 显示/隐藏 */}
        <button onClick={() => setShowNovel(!showNovel)}
          style={btnStyle(showNovel ? '#0f0' : '#600')} title={showNovel ? '小说可见' : '小说已隐藏'}>
          {showNovel ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>

        <button onClick={handleImport} style={btnStyle('#0af')}>
          <Upload size={12} /> 导入
        </button>
        {novelMeta && (
          <button onClick={clearNovel} style={btnStyle('#f55')}>
            <Trash2 size={12} /> 清除
          </button>
        )}
      </div>

      {notification && (
        <div style={{ position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)', background: '#1a3a1a', border: '1px solid #0f0', borderRadius: 6, color: '#0f0', padding: '6px 16px', fontSize: 12, zIndex: 100 }}>
          {notification}
        </div>
      )}

      {/* 阅读区 */}
      {codeLines.length > 0 ? (
        <div ref={scrollRef} onScroll={handleScroll}
          style={{
            flex: 1, overflow: 'auto', padding: '14px 18px',
            fontFamily: "'Cascadia Code','Consolas','Fira Code',monospace",
            fontSize, lineHeight: '1.7',
          }}>
          <div style={{ display: 'flex' }}>
            <div style={{
              paddingRight: 14, textAlign: 'right', color: '#333', userSelect: 'none',
              flexShrink: 0, minWidth: 36, borderRight: '1px solid #1a1a1a', fontSize: fontSize - 1,
            }}>
              {codeLines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <div style={{ flex: 1, paddingLeft: 14, minWidth: 0 }}>
              {codeLines.map((line, i) => renderLine(line, i))}
            </div>
          </div>
          {loading && readEndByteRef.current < fileSizeRef.current && (
            <div style={{ textAlign: 'center', padding: 12, color: '#555', fontSize: fontSize - 1 }}>加载中...</div>
          )}
          {readEndByteRef.current >= fileSizeRef.current && codeLines.length > 0 && (
            <div style={{ textAlign: 'center', padding: 12, color: '#333', fontSize: fontSize - 1 }}>— 完 —</div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444', gap: 12 }}>
          <BookOpen size={48} style={{ opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>暂无内容，点击导入小说</div>
          <button onClick={handleImport}
            style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 6, color: '#0af', cursor: 'pointer', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Upload size={14} /> 导入 TXT/MD
          </button>
        </div>
      )}

      {/* 底部滑块 + 精确输入 */}
      {novelMeta && (
        <div style={{ padding: '6px 14px 8px', background: '#111', borderTop: '1px solid #1a1a2e', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => jumpToPercent(Math.max(0, sliderPos - 3))}
            style={btnStyle('#888')}>
            <ChevronLeft size={12} />
          </button>
          <input type="range" min={0} max={100} value={sliderPos}
            onChange={handleSlider} onMouseUp={handleSliderCommit} onTouchEnd={handleSliderCommit}
            style={{
              flex: 1, height: 4, WebkitAppearance: 'none', appearance: 'none',
              background: `linear-gradient(to right, #0f0 0%, #0f0 ${sliderPos}%, #1a1a2e ${sliderPos}%, #1a1a2e 100%)`,
              borderRadius: 2, outline: 'none', cursor: 'pointer',
            }} />
          <button onClick={() => jumpToPercent(Math.min(100, sliderPos + 3))}
            style={btnStyle('#888')}>
            <ChevronRight size={12} />
          </button>

          {/* 精确百分比输入 */}
          {showPctInput ? (
            <input
              type="number"
              min={0} max={100} step={0.01}
              value={inputPct}
              onChange={e => setInputPct(e.target.value)}
              onBlur={() => {
                const n = parseFloat(inputPct)
                if (!isNaN(n) && n >= 0 && n <= 100) {
                  jumpToPercent(n)
                }
                setShowPctInput(false)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const n = parseFloat(inputPct)
                  if (!isNaN(n) && n >= 0 && n <= 100) {
                    jumpToPercent(n)
                  }
                  setShowPctInput(false)
                }
              }}
              autoFocus
              style={{
                width: 60, background: '#1a1a2e', border: '1px solid #333',
                borderRadius: 3, color: '#0f0', fontSize: 11, padding: '2px 6px',
                outline: 'none', textAlign: 'right',
              }}
            />
          ) : (
            <span
              onClick={() => setShowPctInput(true)}
              style={{ color: '#555', fontSize: 10, minWidth: 36, textAlign: 'center', cursor: 'pointer' }}
              title="点击精确跳转"
            >
              {inputPct}%
            </span>
          )}
        </div>
      )}

      {/* 状态栏 */}
      <div style={{ display: 'flex', gap: 14, padding: '3px 14px', background: '#111', borderTop: '1px solid #1a1a2e', fontSize: 10, color: '#444', userSelect: 'none' }}>
        <span>{codeLines.length} 行</span>
        {novelMeta && (
          <>
            <span>|</span>
            <span>进度 {sliderPos}%</span>
            <span>|</span>
            <span style={{ color: showNovel ? '#0a0' : '#a00' }}>{showNovel ? '小说可见' : '小说已隐藏'}</span>
          </>
        )}
        <span style={{ marginLeft: 'auto' }}>双击切换 | 滑到底自动续读 | 拖滑块跳转</span>
      </div>
    </div>
  )
}

// ====== 混合代码生成（无空白填充） ======
const CODE_SNIPPETS = [
  'function initializeRuntime() {',
  '  const config = loadConfig("/etc/app/config.json");',
  '  if (!config.debug) {',
  '    process.env.NODE_ENV = "production";',
  '  }',
  '  return bootstrap(config);',
  '}',
  '',
  'class DataProcessor {',
  '  private cache: Map<string, any> = new Map();',
  '  async process(input: StreamData): Promise<ResultSet> {',
  '    const hash = crypto.createHash("sha256").update(input.raw).digest("hex");',
  '    if (this.cache.has(hash)) return this.cache.get(hash);',
  '    const normalized = this.normalize(input);',
  '    const result = await this.pipeline.execute(normalized);',
  '    return this.cacheAndReturn(hash, result);',
  '  }',
  '  private normalize(data: StreamData): NormalizedData {',
  '    return { id: data.id ?? nanoid(), timestamp: data.ts || Date.now(), payload: Buffer.from(data.raw).toString("base64") };',
  '  }',
  '}',
  '',
  'const pipeline = new PipelineBuilder()',
  '  .stage("validate", validateSchema)',
  '  .stage("transform", applyTransforms)',
  '  .stage("enrich", enrichWithContext)',
  '  .stage("index", buildSearchIndex)',
  '  .build();',
  '',
  'export async function handleRequest(req: HttpRequest): Promise<HttpResponse> {',
  '  const start = performance.now();',
  '  try {',
  '    const body = await parseBody(req);',
  '    const validated = schema.safeParse(body);',
  '    if (!validated.success) return { status: 400, body: { error: validated.error.flatten() } };',
  '    const result = await processor.process(validated.data);',
  '    metrics.record("request.latency", performance.now() - start);',
  '    return { status: 200, body: result };',
  '  } catch (err) {',
  '    logger.error("Request failed", { error: err.message });',
  '    return { status: 500, body: { error: "Internal Server Error" } };',
  '  }',
  '}',
  '',
  'class LRUCache<K, V> {',
  '  private capacity: number;',
  '  private map: Map<K, ListNode<CacheEntry<V>>>;',
  '  constructor(capacity: number = 1000) { this.capacity = capacity; this.map = new Map(); }',
  '  get(key: K): V | undefined {',
  '    const node = this.map.get(key);',
  '    if (!node || Date.now() > node.value.expiresAt) return undefined;',
  '    this.moveToFront(node);',
  '    node.value.accessCount++;',
  '    return node.value.value;',
  '  }',
  '}',
]

// 单步 mix 20 条代码 + 5 条小说，循环直到小说行用完即止（不留空白填充）
function *mixGenerator(novelLines: string[]): Generator<string> {
  yield '/**'
  yield ' * ═══════════════════════════════════════'
  yield ' * 小说阅读器'
  yield ' * ═══════════════════════════════════════'
  yield ' */'
  yield ''
  let codeIdx = 0
  let novelIdx = 0
  while (novelIdx < novelLines.length) {
    // 4 行代码
    for (let k = 0; k < 4; k++) {
      if (codeIdx >= CODE_SNIPPETS.length) codeIdx = 0
      yield CODE_SNIPPETS[codeIdx++]
    }
    // 1 行小说注释
    const l = novelLines[novelIdx].trim()
    if (l) yield '// ' + l
    novelIdx++
  }
}

async function generateMixedCode(novelContent: string): Promise<string[]> {
  const novelLines = novelContent.split('\n').filter(l => l.trim())
  const result: string[] = []
  for (const line of mixGenerator(novelLines)) {
    result.push(line)
  }
  return result
}

// ====== 样式工具 ======
const btnStyle = (color: string): React.CSSProperties => ({
  background: 'none', border: '1px solid #333', borderRadius: 3,
  color, cursor: 'pointer', padding: '3px 8px',
  display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
})

const popupStyle: React.CSSProperties = {
  position: 'absolute', top: 26, right: 0, background: '#1a1a2e',
  border: '1px solid #333', borderRadius: 4, padding: '4px 0',
  zIndex: 200, minWidth: 70,
}

const popupItemStyle: React.CSSProperties = {
  padding: '4px 12px', cursor: 'pointer', fontSize: 11,
  color: '#aaa', whiteSpace: 'nowrap',
}
