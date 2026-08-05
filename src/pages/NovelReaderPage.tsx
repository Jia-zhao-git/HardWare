import { useState, useRef, useCallback, useEffect } from 'react'
import { invoke, open as openDialog } from '../api/electron-bridge'
import { ArrowLeft, BookOpen, Eye, EyeOff, Upload, Trash2, Code2, FileText } from 'lucide-react'

interface Chapter {
  title: string
  content: string
}

interface Props {
  onBack: () => void
}

// 章节拆分正则：匹配 "第X章" "Chapter X" "# 标题" 等
const CHAPTER_RE = /(?:^|\n)\s*(?:第[零一二三四五六七八九十百千万\d]+[章节回]|Chapter\s+\d+|#[^\n]+|(?:序言|前言|后记|尾声|楔子|番外)[^\n]*)\s*(?:\n|$)/g

function splitChapters(text: string): Chapter[] {
  const matches: { index: number; title: string }[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(CHAPTER_RE.source, 'g')
  while ((m = re.exec(text)) !== null) {
    matches.push({ index: m.index, title: m[0].trim() })
  }

  if (matches.length === 0) {
    // 无章节标记，整篇作为一章
    return [{ title: '全文', content: text.trim() }]
  }

  const chapters: Chapter[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length
    chapters.push({
      title: matches[i].title,
      content: text.slice(start, end).replace(matches[i].title, '').trim(),
    })
  }
  return chapters
}

export default function NovelReaderPage({ onBack }: Props) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [activeChapter, setActiveChapter] = useState(0)
  const [codeLines, setCodeLines] = useState<string[]>([])
  const [showNovel, setShowNovel] = useState(true)
  const [novelTitle, setNovelTitle] = useState('')
  const [notification, setNotification] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 生成伪装代码 + 小说注释
  const generateMixedCode = useCallback((chapterList: Chapter[], currentIdx: number) => {
    const ch = chapterList[currentIdx]
    if (!ch) return []

    const codeSnippets = [
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
      '  private maxSize: number = 1024 * 1024 * 50; // 50MB',
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
      'interface CacheEntry<T> {',
      '  value: T;',
      '  expiresAt: number;',
      '  accessCount: number;',
      '  lastAccess: number;',
      '}',
      '',
      'class LRUCache<K, V> {',
      '  private capacity: number;',
      '  private map: Map<K, ListNode<CacheEntry<V>>>;',
      '  private head: ListNode<CacheEntry<V>> | null = null;',
      '  private tail: ListNode<CacheEntry<V>> | null = null;',
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

    // 小说作为注释嵌入
    const novelLines = ch.content.split('\n').filter(l => l.trim())
    const totalNovelLines = novelLines.length
    const targetCodeLines = totalNovelLines * 4 // 80:20 比例
    const result: string[] = []

    // 章节标记
    result.push(`/**`)
    result.push(` * ═══════════════════════════════════════`)
    result.push(` * ${ch.title}`)
    result.push(` * ═══════════════════════════════════════`)
    result.push(` */`)
    result.push('')

    let codeIdx = 0
    let novelIdx = 0

    while (novelIdx < novelLines.length || codeIdx < targetCodeLines) {
      // 插入代码块（4行代码 : 1行小说注释）
      const codeBlock: string[] = []
      while (codeBlock.length < 4 && codeIdx < targetCodeLines) {
        codeBlock.push(codeSnippets[codeIdx % codeSnippets.length])
        codeIdx++
      }
      result.push(...codeBlock)

      // 插入小说行作为注释
      if (novelIdx < novelLines.length) {
        const line = novelLines[novelIdx]
        if (line.trim()) {
          result.push(`// ${line}`)
        }
        novelIdx++
      }

      if (novelIdx >= novelLines.length && codeIdx >= targetCodeLines) break
    }

    return result
  }, [])

  // 导入小说
  const handleImport = async () => {
    try {
      const filePath = await openDialog({
        multiple: false,
        filters: [{ name: '文本文件', extensions: ['txt', 'md', 'text'] }],
      })
      if (!filePath) return

      const result = await invoke<{ success: boolean; content?: string; error?: string }>('read_file', { path: filePath })
      if (!result?.success || !result.content) {
        setNotification('读取文件失败')
        return
      }

      const text = result.content
      const chapterList = splitChapters(text)
      const title = filePath.split(/[\\/]/).pop()?.replace(/\.(txt|md|text)$/, '') || '未命名'

      // 保存到 localStorage
      const novelData = { title, chapters: chapterList, importedAt: Date.now() }
      localStorage.setItem('adb_novel_data', JSON.stringify(novelData))

      setNovelTitle(title)
      setChapters(chapterList)
      setActiveChapter(0)
      setCodeLines(generateMixedCode(chapterList, 0))
      setShowNovel(true)
      setNotification(`已导入「${title}」，共 ${chapterList.length} 章`)
      setTimeout(() => setNotification(''), 3000)
    } catch (e) {
      setNotification(`导入失败: ${String(e)}`)
      setTimeout(() => setNotification(''), 3000)
    }
  }

  // 切换章节
  const switchChapter = (idx: number) => {
    setActiveChapter(idx)
    setCodeLines(generateMixedCode(chapters, idx))
  }

  // 双击切换小说可见性
  const handleDoubleClick = () => {
    setShowNovel(!showNovel)
  }

  // 恢复小说
  useEffect(() => {
    try {
      const saved = localStorage.getItem('adb_novel_data')
      if (saved) {
        const data = JSON.parse(saved)
        setNovelTitle(data.title || '')
        setChapters(data.chapters || [])
        setCodeLines(generateMixedCode(data.chapters || [], 0))
      }
    } catch { /* ignore */ }
  }, [])

  // 清除小说
  const clearNovel = () => {
    localStorage.removeItem('adb_novel_data')
    setChapters([])
    setCodeLines([])
    setNovelTitle('')
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
      {/* 顶栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: '#111',
        borderBottom: '1px solid #1a1a2e',
        fontSize: 12,
        userSelect: 'none',
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: '1px solid #333', borderRadius: 4,
            color: '#888', cursor: 'pointer', padding: '4px 10px',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
          }}
          title="退出"
        >
          <ArrowLeft size={13} /> 退出
        </button>

        <span style={{ color: '#0f0', fontWeight: 600, fontSize: 13 }}>
          <Code2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
          {novelTitle || 'Code Editor'}
        </span>

        <div style={{ flex: 1 }} />

        {/* 小说可见性指示 */}
        <span style={{
          color: showNovel ? '#0f0' : '#600',
          fontSize: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
        }} onClick={() => setShowNovel(!showNovel)}>
          {showNovel ? <Eye size={13} /> : <EyeOff size={13} />}
          {showNovel ? '小说可见' : '小说隐藏'}
          <span style={{ color: '#444', fontSize: 9 }}>（双击切换）</span>
        </span>

        {/* 章节选择 */}
        {chapters.length > 0 && (
          <select
            value={activeChapter}
            onChange={e => switchChapter(Number(e.target.value))}
            style={{
              background: '#1a1a2e', border: '1px solid #333', borderRadius: 4,
              color: '#0f0', padding: '4px 8px', fontSize: 11, outline: 'none',
              maxWidth: 200, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {chapters.map((ch, i) => (
              <option key={i} value={i} style={{ background: '#111', color: '#e0e0e0' }}>
                {ch.title}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={handleImport}
          style={{
            background: 'none', border: '1px solid #333', borderRadius: 4,
            color: '#0af', cursor: 'pointer', padding: '4px 10px',
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
          }}
          title="导入小说"
        >
          <Upload size={13} /> 导入
        </button>

        {chapters.length > 0 && (
          <button
            onClick={clearNovel}
            style={{
              background: 'none', border: '1px solid #333', borderRadius: 4,
              color: '#f55', cursor: 'pointer', padding: '4px 10px',
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
            }}
            title="清除小说"
          >
            <Trash2 size={13} /> 清除
          </button>
        )}
      </div>

      {/* 通知 */}
      {notification && (
        <div style={{
          position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)',
          background: '#1a3a1a', border: '1px solid #0f0', borderRadius: 6,
          color: '#0f0', padding: '6px 16px', fontSize: 12, zIndex: 100,
        }}>
          {notification}
        </div>
      )}

      {/* 代码编辑器主体 */}
      {codeLines.length > 0 ? (
        <div style={{
          flex: 1, overflow: 'auto', padding: '16px 20px',
          fontFamily: "'Cascadia Code', 'Consolas', 'Fira Code', monospace",
          fontSize: 12, lineHeight: '1.7',
        }}>
          {/* 行号 + 代码 */}
          <div style={{ display: 'flex' }}>
            {/* 行号 */}
            <div style={{
              paddingRight: 16, textAlign: 'right', color: '#333',
              userSelect: 'none', flexShrink: 0, minWidth: 40,
              borderRight: '1px solid #1a1a1a',
            }}>
              {codeLines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            {/* 代码 */}
            <div style={{ flex: 1, paddingLeft: 16 }}>
              {codeLines.map((line, i) => {
                const isNovelComment = showNovel && line.trimStart().startsWith('//')
                // 小说注释行用特殊颜色
                const isChapterHeader = line.includes('═══')
                return (
                  <div
                    key={i}
                    style={{
                      whiteSpace: 'pre',
                      color: isChapterHeader ? '#ff0' :
                             isNovelComment ? '#0a0' :
                             line.startsWith('//') ? '#444' :
                             line.match(/^(function|class|const|let|var|interface|export|import|async|return|if|for|while|try|catch|throw|new)\b/) ? '#c678dd' :
                             line.match(/^(private|public|protected|static|readonly)\b/) ? '#c678dd' :
                             line.match(/\b(function|class|const|let|var|interface|export|import|async|return|if|else|for|while|throw|new|this|typeof|instanceof)\b/) ? '#e5c07b' :
                             '#abb2bf',
                    }}
                  >
                    {line}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          color: '#444', gap: 16,
        }}>
          <BookOpen size={48} style={{ opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>暂无内容</div>
          <div style={{ fontSize: 11, color: '#333' }}>
            点击「导入」加载小说，小说将伪装成代码注释
          </div>
          <button
            onClick={handleImport}
            style={{
              background: '#1a1a2e', border: '1px solid #333', borderRadius: 6,
              color: '#0af', cursor: 'pointer', padding: '8px 20px',
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
            }}
          >
            <Upload size={14} /> 导入小说 (TXT/MD)
          </button>
        </div>
      )}

      {/* 底部状态栏 */}
      <div style={{
        display: 'flex', gap: 16, padding: '4px 16px',
        background: '#111', borderTop: '1px solid #1a1a2e',
        fontSize: 10, color: '#444',
        userSelect: 'none',
      }}>
        <span>{codeLines.length} 行</span>
        {chapters.length > 0 && (
          <>
            <span>|</span>
            <span>第 {activeChapter + 1}/{chapters.length} 章</span>
            <span>|</span>
            <span style={{ color: showNovel ? '#0a0' : '#600' }}>
              {showNovel ? '小说注释可见' : '小说已隐藏'}
            </span>
          </>
        )}
        <span style={{ marginLeft: 'auto' }}>双击切换小说可见性 | 代码:小说 = 80:20</span>
      </div>
    </div>
  )
}
