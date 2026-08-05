
import { useState, useCallback, useEffect } from 'react'
import { invoke, open as openDialog, readFileRange } from '../api/electron-bridge'
import { ArrowLeft, BookOpen, Eye, EyeOff, Upload, Trash2, Code2 } from 'lucide-react'

interface ChapterMeta {
  title: string
  byteStart: number
  byteEnd: number
}

interface NovelMeta {
  filePath: string
  title: string
  chapters: ChapterMeta[]
  importedAt: number
}

interface Props {
  onBack: () => void
}

export default function NovelReaderPage({ onBack }: Props) {
  const [novelMeta, setNovelMeta] = useState<NovelMeta | null>(null)
  const [activeChapter, setActiveChapter] = useState(0)
  const [codeLines, setCodeLines] = useState<string[]>([])
  const [showNovel, setShowNovel] = useState(true)
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState('')
  const [chapterContent, setChapterContent] = useState('')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('adb_novel_meta')
      if (saved) {
        const meta: NovelMeta = JSON.parse(saved)
        setNovelMeta(meta)
        loadChapterContent(meta, 0)
      }
    } catch { /* ignore */ }
  }, [])

  const loadChapterContent = useCallback(async (meta: NovelMeta, idx: number) => {
    if (idx < 0 || idx >= meta.chapters.length) return
    setLoading(true)
    try {
      const ch = meta.chapters[idx]
      const content = await readFileRange(meta.filePath, ch.byteStart, ch.byteEnd)
      setChapterContent(content)
      setActiveChapter(idx)
      setCodeLines(generateMixedCode(meta.chapters[idx].title, content))
    } catch (e) {
      setNotification('??????: ' + String(e))
    }
    setLoading(false)
  }, [])

  const switchChapter = (idx: number) => {
    if (novelMeta) loadChapterContent(novelMeta, idx)
  }

  const handleDoubleClick = () => setShowNovel(!showNovel)

  const handleImport = async () => {
    try {
      const filePath = await openDialog({
        multiple: false,
        filters: [{ name: '????', extensions: ['txt', 'md', 'text'] }],
      })
      if (!filePath) return

      setLoading(true)

      const result = await invoke<{
        success: boolean
        preview?: string
        chapters?: ChapterMeta[]
        error?: string
      }>('scan_novel_file', { path: filePath })

      if (!result?.success || !result.chapters) {
        setNotification('??????: ' + (result?.error || '????'))
        setLoading(false)
        return
      }

      const title = filePath.split(/[\\/]/).pop()?.replace(/\.(txt|md|text)$/, '') || '???'
      const meta: NovelMeta = {
        filePath,
        title,
        chapters: result.chapters,
        importedAt: Date.now(),
      }

      localStorage.setItem('adb_novel_meta', JSON.stringify(meta))
      setNovelMeta(meta)

      const firstContent = result.preview || ''
      setChapterContent(firstContent)
      setActiveChapter(0)
      setCodeLines(generateMixedCode(meta.chapters[0].title, firstContent))
      setShowNovel(true)
      setNotification('????' + title + '??? ' + meta.chapters.length + ' ?')
      setTimeout(() => setNotification(''), 3000)
    } catch (e) {
      setNotification('????: ' + String(e))
      setTimeout(() => setNotification(''), 3000)
    }
    setLoading(false)
  }

  const clearNovel = () => {
    localStorage.removeItem('adb_novel_meta')
    setNovelMeta(null)
    setCodeLines([])
    setChapterContent('')
    setActiveChapter(0)
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
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px', background: '#111', borderBottom: '1px solid #1a1a2e',
        fontSize: 12, userSelect: 'none',
      }}>
        <button onClick={onBack}
          style={{ background: 'none', border: '1px solid #333', borderRadius: 4, color: '#888', cursor: 'pointer', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <ArrowLeft size={13} /> ??
        </button>
        <span style={{ color: '#0f0', fontWeight: 600, fontSize: 13 }}>
          <Code2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
          {novelMeta?.title || 'Code Editor'}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ color: showNovel ? '#0f0' : '#600', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setShowNovel(!showNovel)}>
          {showNovel ? <Eye size={13} /> : <EyeOff size={13} />}
          {showNovel ? '????' : '????'}
        </span>
        {novelMeta && (
          <select value={activeChapter} onChange={e => switchChapter(Number(e.target.value))}
            style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 4, color: '#0f0', padding: '4px 8px', fontSize: 11, outline: 'none', maxWidth: 200, cursor: 'pointer', fontFamily: 'inherit' }}>
            {novelMeta.chapters.map((ch, i) => (
              <option key={i} value={i} style={{ background: '#111', color: '#e0e0e0' }}>{ch.title}</option>
            ))}
          </select>
        )}
        <button onClick={handleImport}
          style={{ background: 'none', border: '1px solid #333', borderRadius: 4, color: '#0af', cursor: 'pointer', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <Upload size={13} /> ??
        </button>
        {novelMeta && (
          <button onClick={clearNovel}
            style={{ background: 'none', border: '1px solid #333', borderRadius: 4, color: '#f55', cursor: 'pointer', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <Trash2 size={13} /> ??
          </button>
        )}
      </div>

      {notification && (
        <div style={{ position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)', background: '#1a3a1a', border: '1px solid #0f0', borderRadius: 6, color: '#0f0', padding: '6px 16px', fontSize: 12, zIndex: 100 }}>
          {notification}
        </div>
      )}

      {loading && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: '#0f0', fontSize: 14 }}>
          ???...
        </div>
      )}

      {codeLines.length > 0 ? (
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', fontFamily: "'Cascadia Code','Consolas','Fira Code',monospace", fontSize: 12, lineHeight: '1.7' }}>
          <div style={{ display: 'flex' }}>
            <div style={{ paddingRight: 16, textAlign: 'right', color: '#333', userSelect: 'none', flexShrink: 0, minWidth: 40, borderRight: '1px solid #1a1a1a' }}>
              {codeLines.map((_, i) => <div key={i}>{i + 1}</div>)}
            </div>
            <div style={{ flex: 1, paddingLeft: 16 }}>
              {codeLines.map((line, i) => {
                const isNovelComment = showNovel && line.trimStart().startsWith('//')
                const isChapterHeader = line.includes('???')
                return (
                  <div key={i} style={{
                    whiteSpace: 'pre',
                    color: isChapterHeader ? '#ff0' : isNovelComment ? '#0a0' : line.startsWith('//') ? '#444' :
                      /^(function|class|const|let|var|interface|export|import|async|return|if|for|while|try|catch|throw|new)/.test(line) ? '#c678dd' :
                      /(function|class|const|let|var|interface|export|import|async|return|if|else|for|while|throw|new|this|typeof|instanceof)/.test(line) ? '#e5c07b' : '#abb2bf',
                  }}>{line}</div>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444', gap: 16 }}>
          <BookOpen size={48} style={{ opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>????</div>
          <div style={{ fontSize: 11, color: '#333' }}>????????????????????</div>
          <button onClick={handleImport}
            style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 6, color: '#0af', cursor: 'pointer', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Upload size={14} /> ???? (TXT/MD)
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, padding: '4px 16px', background: '#111', borderTop: '1px solid #1a1a2e', fontSize: 10, color: '#444', userSelect: 'none' }}>
        <span>{codeLines.length} ?</span>
        {novelMeta && (
          <>
            <span>|</span>
            <span>? {activeChapter + 1}/{novelMeta.chapters.length} ?</span>
            <span>|</span>
            <span style={{ color: showNovel ? '#0a0' : '#600' }}>{showNovel ? '??????' : '?????'}</span>
          </>
        )}
        <span style={{ marginLeft: 'auto' }}>????????? | ??:?? = 80:20</span>
      </div>
    </div>
  )
}

// ====== generateMixedCode ======
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

function generateMixedCode(chapterTitle: string, novelContent: string): string[] {
  const novelLines = novelContent.split('\n').filter(l => l.trim())
  const totalNovelLines = novelLines.length
  const targetCodeLines = totalNovelLines * 4
  const result: string[] = []

  result.push('/**')
  result.push(' * ???????????????????????????????????????')
  result.push(' * ' + chapterTitle)
  result.push(' * ???????????????????????????????????????')
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
