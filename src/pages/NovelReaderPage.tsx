import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke, open as openDialog, readFileRange } from '../api/electron-bridge'
import { ArrowLeft, BookOpen, Eye, EyeOff, Upload, Trash2, Code2, ChevronLeft, ChevronRight } from 'lucide-react'

interface NovelMeta {
  filePath: string
  title: string
  fileSize: number
  importedAt: number
}

interface Props {
  onBack: () => void
}

const CHUNK_CHARS = 8000  // 每段加载的字符数

export default function NovelReaderPage({ onBack }: Props) {
  const [novelMeta, setNovelMeta] = useState<NovelMeta | null>(null)
  const [codeLines, setCodeLines] = useState<string[]>([])
  const [showNovel, setShowNovel] = useState(true)
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)
  const autoLoadingRef = useRef(false)
  // 关键：记录已读到文件的哪个字节位置，自动加载紧接此位置继续
  const readEndByteRef = useRef(0)
  // 记录文件总字节
  const fileSizeRef = useRef(0)

  // 恢复小说元信息
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    try {
      const saved = localStorage.getItem('adb_novel_meta')
      if (saved) {
        const meta: NovelMeta = JSON.parse(saved)
        setNovelMeta(meta)
        fileSizeRef.current = meta.fileSize
        readEndByteRef.current = 0
        loadPosition(meta, 0)
      }
    } catch { /* ignore */ }
  }, [])

  // 按百分比跳转 → 替换当前内容
  const loadPosition = useCallback(async (meta: NovelMeta, pct: number) => {
    setLoading(true)
    const clamped = Math.max(0, Math.min(100, pct))
    try {
      const startByte = Math.floor((clamped / 100) * meta.fileSize)
      const readLen = Math.min(CHUNK_CHARS, meta.fileSize - startByte)
      const endByte = startByte + readLen
      const content = await readFileRange(meta.filePath, startByte, endByte)
      readEndByteRef.current = endByte
      setCodeLines(generateMixedCode(content))
      // 滚动回顶部
      scrollRef.current?.scrollTo(0, 0)
    } catch (e) {
      setNotification('读取失败: ' + String(e))
    }
    setLoading(false)
  }, [])

  // 自动加载 — 紧接上次读取的末尾继续
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
      setCodeLines(prev => [...prev, ...generateMixedCode(content)])
    } catch (e) {
      setNotification('加载失败: ' + String(e))
    }
    autoLoadingRef.current = false
  }, [novelMeta])

  // 滚动到底部自动加载
  const handleScroll = useCallback(() => {
    if (loading || readEndByteRef.current >= fileSizeRef.current) return
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) {
      appendNextChunk()
    }
  }, [loading, appendNextChunk])

  // 跳转到指定百分比（手动拖拽滑块）
  const jumpToPercent = (pct: number) => {
    if (!novelMeta) return
    loadPosition(novelMeta, pct)
  }

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 拖拽中只更新滑块 position，不读盘
    setSliderPos(Number(e.target.value))
  }
  const [sliderPos, setSliderPos] = useState(0)
  // 同步 slider 位置
  useEffect(() => {
    if (novelMeta && readEndByteRef.current > 0) {
      setSliderPos(Math.round((readEndByteRef.current / novelMeta.fileSize) * 100))
    } else {
      setSliderPos(0)
    }
  }, [novelMeta, codeLines])

  const handleSliderCommit = () => {
    jumpToPercent(sliderPos)
  }

  const handleDoubleClick = () => setShowNovel(!showNovel)

  // 导入小说
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
        error?: string
      }>('scan_novel_file', { path: filePath })

      if (!result?.success || result.fileSize == null) {
        setNotification('读取文件失败: ' + (result?.error || '未知错误'))
        setLoading(false)
        return
      }

      const title = filePath.split(/[\\/]/).pop()?.replace(/\.(txt|md|text)$/, '') || '未命名'
      const meta: NovelMeta = {
        filePath,
        title,
        fileSize: result.fileSize,
        importedAt: Date.now(),
      }
      localStorage.setItem('adb_novel_meta', JSON.stringify(meta))
      setNovelMeta(meta)
      fileSizeRef.current = result.fileSize
      readEndByteRef.current = Math.min(CHUNK_CHARS, result.fileSize)
      setSliderPos(0)

      if (result.preview) {
        setCodeLines(generateMixedCode(result.preview))
      }
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
    setNovelMeta(null)
    setCodeLines([])
    readEndByteRef.current = 0
    fileSizeRef.current = 0
    setSliderPos(0)
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0a0a',
        color: '#e0e0e0',
        fontFamily: "'Cascadia Code', 'Consolas', 'Fira Code', monospace",
        position: 'relative',
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px', background: '#111', borderBottom: '1px solid #1a1a2e',
        fontSize: 12, userSelect: 'none',
      }}>
        <button onClick={onBack}
          style={{ background: 'none', border: '1px solid #333', borderRadius: 4, color: '#888', cursor: 'pointer', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <ArrowLeft size={13} /> 退出
        </button>
        <span style={{ color: '#0f0', fontWeight: 600, fontSize: 13 }}>
          <Code2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
          {novelMeta?.title || 'Code Editor'}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ color: showNovel ? '#0f0' : '#600', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setShowNovel(!showNovel)}>
          {showNovel ? <Eye size={13} /> : <EyeOff size={13} />}
          {showNovel ? '小说可见' : '小说隐藏'}
        </span>
        <button onClick={handleImport}
          style={{ background: 'none', border: '1px solid #333', borderRadius: 4, color: '#0af', cursor: 'pointer', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <Upload size={13} /> 导入
        </button>
        {novelMeta && (
          <button onClick={clearNovel}
            style={{ background: 'none', border: '1px solid #333', borderRadius: 4, color: '#f55', cursor: 'pointer', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <Trash2 size={13} /> 清除
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
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflow: 'auto', padding: '16px 20px', fontFamily: "'Cascadia Code','Consolas','Fira Code',monospace", fontSize: 12, lineHeight: '1.7' }}
        >
          <div style={{ display: 'flex' }}>
            <div style={{ paddingRight: 16, textAlign: 'right', color: '#333', userSelect: 'none', flexShrink: 0, minWidth: 40, borderRight: '1px solid #1a1a1a' }}>
              {codeLines.map((_, i) => <div key={i}>{i + 1}</div>)}
            </div>
            <div style={{ flex: 1, paddingLeft: 16 }}>
              {codeLines.map((line, i) => {
                const isNovelComment = showNovel && line.trimStart().startsWith('//')
                const isChapterHeader = line.includes('═══')
                return (
                  <div key={i} style={{
                    whiteSpace: 'pre',
                    color: isChapterHeader ? '#ff0' : isNovelComment ? '#0a0' : line.startsWith('//') ? '#444' :
                      /^(function|class|const|let|var|interface|export|import|async|return|if|for|while|try|catch|throw|new)\b/.test(line) ? '#c678dd' :
                      /\b(function|class|const|let|var|interface|export|import|async|return|if|else|for|while|throw|new|this|typeof|instanceof)\b/.test(line) ? '#e5c07b' : '#abb2bf',
                  }}>{line}</div>
                )
              })}
            </div>
          </div>
          {/* 底部指示 */}
          {loading && readEndByteRef.current < fileSizeRef.current && (
            <div style={{ textAlign: 'center', padding: 12, color: '#555', fontSize: 11 }}>加载中...</div>
          )}
          {readEndByteRef.current >= fileSizeRef.current && codeLines.length > 0 && (
            <div style={{ textAlign: 'center', padding: 12, color: '#333', fontSize: 11 }}>— 已到末尾 —</div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444', gap: 16 }}>
          <BookOpen size={48} style={{ opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>暂无内容</div>
          <div style={{ fontSize: 11, color: '#333' }}>点击「导入」加载小说，伪装成代码注释</div>
          <button onClick={handleImport}
            style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 6, color: '#0af', cursor: 'pointer', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Upload size={14} /> 导入小说 (TXT/MD)
          </button>
        </div>
      )}

      {/* 底部导航：百分比滑块（用于手动跳转） */}
      {novelMeta && (
        <div style={{ padding: '6px 16px 8px', background: '#111', borderTop: '1px solid #1a1a2e', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => jumpToPercent(Math.max(0, sliderPos - 5))}
            style={{ background: 'none', border: '1px solid #333', borderRadius: 3, color: '#888', cursor: 'pointer', padding: '2px 6px', fontSize: 0, display: 'flex', alignItems: 'center' }}>
            <ChevronLeft size={12} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={sliderPos}
            onChange={handleSlider}
            onMouseUp={handleSliderCommit}
            onTouchEnd={handleSliderCommit}
            style={{
              flex: 1, height: 4, WebkitAppearance: 'none', appearance: 'none',
              background: `linear-gradient(to right, #0f0 0%, #0f0 ${sliderPos}%, #1a1a2e ${sliderPos}%, #1a1a2e 100%)`,
              borderRadius: 2, outline: 'none', cursor: 'pointer',
            }}
          />
          <button onClick={() => jumpToPercent(Math.min(100, sliderPos + 5))}
            style={{ background: 'none', border: '1px solid #333', borderRadius: 3, color: '#888', cursor: 'pointer', padding: '2px 6px', fontSize: 0, display: 'flex', alignItems: 'center' }}>
            <ChevronRight size={12} />
          </button>
          <span style={{ color: '#555', fontSize: 10, minWidth: 40, textAlign: 'center' }}>
            {sliderPos}%
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, padding: '4px 16px', background: '#111', borderTop: '1px solid #1a1a2e', fontSize: 10, color: '#444', userSelect: 'none' }}>
        <span>{codeLines.length} 行</span>
        {novelMeta && (
          <>
            <span>|</span>
            <span>进度 {sliderPos}%</span>
            <span>|</span>
            <span style={{ color: showNovel ? '#0a0' : '#600' }}>{showNovel ? '小说可见' : '小说已隐藏'}</span>
          </>
        )}
        <span style={{ marginLeft: 'auto' }}>双击切换 | 滚到底自动续读 | 拖滑块跳转</span>
      </div>
    </div>
  )
}

// ====== 混合代码生成 ======
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
  '  private maxSize: number = 1024 * 1024 * 50;',
  '',
  '  async process(input: StreamData): Promise<ResultSet> {',
  '    const hash = crypto.createHash("sha256").update(input.raw).digest("hex");',
  '    if (this.cache.has(hash)) return this.cache.get(hash);',
  '    const normalized = this.normalize(input);',
  '    const result = await this.pipeline.execute(normalized);',
  '    return this.cacheAndReturn(hash, result);',
  '  }',
  '',
  '  private normalize(data: StreamData): NormalizedData {',
  '    return {',
  '      id: data.id ?? nanoid(),',
  '      timestamp: data.ts || Date.now(),',
  '      payload: Buffer.from(data.raw).toString("base64"),',
  '    };',
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
  '    if (!validated.success) {',
  '      return { status: 400, body: { error: validated.error.flatten() } };',
  '    }',
  '    const result = await processor.process(validated.data);',
  '    metrics.record("request.latency", performance.now() - start);',
  '    return { status: 200, body: result };',
  '  } catch (err) {',
  '    logger.error("Request failed", { error: err.message, stack: err.stack });',
  '    return { status: 500, body: { error: "Internal Server Error" } };',
  '  }',
  '}',
  '',
  'class LRUCache<K, V> {',
  '  private capacity: number;',
  '  private map: Map<K, ListNode<CacheEntry<V>>>;',
  '',
  '  constructor(capacity: number = 1000) {',
  '    this.capacity = capacity;',
  '    this.map = new Map();',
  '  }',
  '',
  '  get(key: K): V | undefined {',
  '    const node = this.map.get(key);',
  '    if (!node) return undefined;',
  '    if (Date.now() > node.value.expiresAt) {',
  '      this.delete(key);',
  '      return undefined;',
  '    }',
  '    this.moveToFront(node);',
  '    node.value.accessCount++;',
  '    return node.value.value;',
  '  }',
  '}',
]

function generateMixedCode(novelContent: string): string[] {
  const novelLines = novelContent.split('\n').filter(l => l.trim())
  const totalNovelLines = novelLines.length
  const targetCodeLines = totalNovelLines * 4
  const result: string[] = []

  result.push('/**')
  result.push(' * ═══════════════════════════════════════')
  result.push(' * 小说阅读器')
  result.push(' * ═══════════════════════════════════════')
  result.push(' */')
  result.push('')

  let codeIdx = 0
  let novelIdx = 0

  while (novelIdx < novelLines.length || codeIdx < targetCodeLines) {
    const codeBlock: string[] = []
    while (codeBlock.length < 4 && codeIdx < targetCodeLines) {
      codeBlock.push(CODE_SNIPPETS[codeIdx % CODE_SNIPPETS.length])
      codeIdx++
    }
    result.push(...codeBlock)
    if (novelIdx < novelLines.length) {
      const line = novelLines[novelIdx]
      if (line.trim()) result.push('// ' + line)
      novelIdx++
    }
    if (novelIdx >= novelLines.length && codeIdx >= targetCodeLines) break
  }
  return result
}
