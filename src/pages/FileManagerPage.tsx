import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke, CmdResult, open as openDialog, save as saveDialog } from '../api/electron-bridge'
import { 
  FolderOpen, File, ArrowUp, Home, RefreshCw, Upload, 
  Trash2, Plus, ChevronRight, Search, Image, FileText, Code
} from 'lucide-react'

interface Props { selectedDevice: string; showNotif: (t: string, m: string) => void }

interface FileItem {
  name: string
  type: 'file' | 'dir' | 'link'
  size?: string
  perms?: string
  date?: string
}

export default function FileManagerPage({ selectedDevice, showNotif }: Props) {
  const [currentPath, setCurrentPath] = useState('/userdata')
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewName, setPreviewName] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false)

  const pathHistory = useRef<string[]>(['/userdata'])
  const historyIndex = useRef(0)

  const listFiles = useCallback(async (path: string) => {
    if (!selectedDevice) return
    setLoading(true)
    try {
      const r = await invoke<CmdResult>('run_shell_command', { 
        serial: selectedDevice, 
        command: `ls -la "${path}" 2>/dev/null || ls -la ${path}` 
      })
      if (r?.success) {
        const lines = r.output.split('\n').slice(1)
        const items: FileItem[] = []
        for (const line of lines) {
          const parts = line.trim().split(/\s+/)
          if (parts.length < 9) continue
          const perms = parts[0]
          const size = parts[4]
          const date = `${parts[5]} ${parts[6]} ${parts[7]}`
          const name = parts.slice(8).join(' ')
          if (name === '.' || name === '..') continue
          if (!showHidden && name.startsWith('.')) continue
          
          items.push({
            name,
            type: perms.startsWith('d') ? 'dir' : perms.startsWith('l') ? 'link' : 'file',
            size: perms.startsWith('d') ? '-' : size,
            perms,
            date
          })
        }
        setFiles(items.sort((a, b) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1
          if (a.type !== 'dir' && b.type === 'dir') return 1
          return a.name.localeCompare(b.name)
        }))
      } else {
        showNotif('error', '无法读取目录')
      }
    } catch (e) {
      showNotif('error', String(e))
    }
    setLoading(false)
  }, [selectedDevice, showHidden])

  useEffect(() => {
    listFiles(currentPath)
  }, [currentPath, listFiles])

  const navigateTo = (path: string) => {
    pathHistory.current = pathHistory.current.slice(0, historyIndex.current + 1)
    pathHistory.current.push(path)
    historyIndex.current++
    setCurrentPath(path)
  }

  const goBack = () => {
    if (historyIndex.current > 0) {
      historyIndex.current--
      setCurrentPath(pathHistory.current[historyIndex.current])
    }
  }

  const goForward = () => {
    if (historyIndex.current < pathHistory.current.length - 1) {
      historyIndex.current++
      setCurrentPath(pathHistory.current[historyIndex.current])
    }
  }

  const goUp = () => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    navigateTo(parent)
  }

  const goHome = () => navigateTo('/data')

  const openItem = (item: FileItem) => {
    if (item.type === 'dir') {
      setPreviewContent(null); setPreviewName('')
      navigateTo(`${currentPath}/${item.name}`.replace(/\/+/g, '/'))
    } else {
      previewFile(item)
    }
  }

  const previewFile = async (item: FileItem) => {
    if (item.type !== 'file') return
    const ext = item.name.split('.').pop()?.toLowerCase()
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext || '')) {
      const localPath = await pullFile(item.name)
      if (localPath) { setPreviewName(item.name); setPreviewContent(`[图片] ${localPath}`) }
    } else if (['txt', 'log', 'json', 'xml', 'conf', 'sh'].includes(ext || '')) {
      setPreviewLoading(true)
      setPreviewName(item.name)
      setPreviewContent(null)
      try {
        const r = await invoke<CmdResult>('run_shell_command', {
          serial: selectedDevice,
          command: `cat "${currentPath}/${item.name}" | head -200`
        })
        setPreviewContent(r?.output || '(无内容)')
      } catch (e) { setPreviewContent(`加载失败: ${e}`) }
      setPreviewLoading(false)
    } else {
      setPreviewName(item.name)
      setPreviewContent(`[二进制文件，无法预览]
路径: ${currentPath}/${item.name}`)
    }
  }

  const doPullFile = async (filename: string, localPath: string): Promise<boolean> => {
    const r = await invoke<CmdResult>('pull_file', {
      serial: selectedDevice,
      remotePath: `${currentPath}/${filename}`,
      localPath
    })
    console.log('[doPullFile]', { filename, localPath, r })
    return !!r?.success
  }

  const pullFile = async (filename: string): Promise<string | null> => {
    const savePath = await saveDialog({
      defaultPath: filename,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (!savePath) return null
    const ok = await doPullFile(filename, savePath)
    if (ok) { showNotif('success', `文件已下载: ${savePath}`); return savePath }
    showNotif('error', `下载失败: ${filename}`); return null
  }

  const exportSelected = async () => {
    if (exporting) return;
    setExporting(true);
    try {
    if (selectedItems.size === 0) return
    const fileList: { name: string; type: string }[] = []
    for (const name of selectedItems) {
      const item = files.find(f => f.name === name)
      if (item && item.type !== 'dir') fileList.push({ name: item.name, type: item.type })
    }
    if (fileList.length === 0) return

    if (fileList.length === 1) {
      const result = await pullFile(fileList[0].name)
      if (!result) showNotif('error', '导出失败')
      return
    }

    const dir = await openDialog({ properties: ['openDirectory'] })
    if (!dir) return
    let ok = 0
    for (const f of fileList) {
      const target = `${dir}\${f.name}`
      const r = await doPullFile(f.name, target)
      if (r) ok++
    }
    showNotif(ok > 0 ? 'success' : 'error', ok > 0 ? `已导出 ${ok}/${fileList.length} 个文件到: ${dir}` : '导出失败')
  } finally {
    setExporting(false);
  }
  }

  const pushFile = async () => {
    const file = await openDialog({ multiple: false })
    if (!file) return
    const filename = file.split(/[\\/]/).pop()
    const r = await invoke<CmdResult>('push_script', {
      serial: selectedDevice,
      localPath: file,
      remotePath: `${currentPath}/${filename}`
    })
    if (r?.success) {
      showNotif('success', `文件已上传: ${filename}`)
      listFiles(currentPath)
    } else {
      showNotif('error', r?.error || '上传失败')
    }
  }

  const deleteSelected = async () => {
    if (selectedItems.size === 0) return
    for (const name of selectedItems) {
      const item = files.find(f => f.name === name)
      if (!item) continue
      const cmd = item.type === 'dir' ? `rm -rf "${currentPath}/${name}"` : `rm -f "${currentPath}/${name}"`
      await invoke<CmdResult>('run_shell_command', { serial: selectedDevice, command: cmd })
    }
    showNotif('success', `已删除 ${selectedItems.size} 项`)
    setSelectedItems(new Set())
    listFiles(currentPath)
  }

  const createFolder = async () => {
    const name = prompt('输入文件夹名称:')
    if (!name) return
    const r = await invoke<CmdResult>('run_shell_command', {
      serial: selectedDevice,
      command: `mkdir -p "${currentPath}/${name}"`
    })
    if (r?.success) {
      showNotif('success', `文件夹已创建: ${name}`)
      listFiles(currentPath)
    }
  }

  const toggleSelect = (name: string) => {
    const newSet = new Set(selectedItems)
    if (newSet.has(name)) newSet.delete(name)
    else newSet.add(name)
    setSelectedItems(newSet)
  }

  const getFileIcon = (item: FileItem) => {
    if (item.type === 'dir') return <FolderOpen size={16} style={{ color: 'var(--accent-warning)' }} />
    const ext = item.name.split('.').pop()?.toLowerCase()
    if (['png', 'jpg', 'jpeg', 'gif'].includes(ext || '')) return <Image size={16} style={{ color: 'var(--accent-purple)' }} />
    if (['txt', 'log', 'md'].includes(ext || '')) return <FileText size={16} style={{ color: 'var(--text-secondary)' }} />
    if (['sh', 'py', 'js'].includes(ext || '')) return <Code size={16} style={{ color: 'var(--accent-secondary)' }} />
    return <File size={16} style={{ color: 'var(--accent-primary)' }} />
  }

  const filteredFiles = files.filter(f => 
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (!selectedDevice) {
    return (
      <div className="empty-state">
        <FolderOpen size={48} style={{ opacity: 0.5 }} />
        <div className="empty-text">请先连接设备</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="section-title">
        <FolderOpen size={16} /> 文件管理器
      </div>

      {/* Toolbar */}
      <div style={{ 
        display: 'flex', 
        gap: 8, 
        marginBottom: 12, 
        padding: 8,
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        alignItems: 'center',
        flexWrap: 'wrap'
      }}>
        <button className="icon-btn" onClick={goBack} title="后退"><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /></button>
        <button className="icon-btn" onClick={goForward} title="前进"><ChevronRight size={14} /></button>
        <button className="icon-btn" onClick={goUp} title="上级目录"><ArrowUp size={14} /></button>
        <button className="icon-btn" onClick={goHome} title="主页"><Home size={14} /></button>
        <button className="icon-btn" onClick={() => listFiles(currentPath)} title="刷新"><RefreshCw size={14} className={loading ? 'spinning' : ''} /></button>
        
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <FolderOpen size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={currentPath}
            onChange={e => setCurrentPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && listFiles(currentPath)}
            style={{ width: '100%', padding: '5px 8px 5px 26px', fontSize: 12, fontFamily: 'monospace' }}
          />
        </div>

        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="搜索..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: 140, padding: '5px 8px 5px 26px', fontSize: 12 }}
          />
        </div>

        <button className="btn btn-secondary" onClick={pushFile}><Upload size={12} /> 上传</button>
        <button className="btn btn-secondary" onClick={createFolder}><Plus size={12} /> 新建</button>
        <button className="btn btn-secondary" onClick={exportSelected} disabled={selectedItems.size === 0 || exporting}><FolderOpen size={12} /> 导出 ({selectedItems.size || 0})</button>
        {selectedItems.size > 0 && (
          <button className="btn btn-danger" onClick={deleteSelected}><Trash2 size={12} /> 删除 ({selectedItems.size})</button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
          隐藏文件
        </label>
      </div>

      {/* File Preview Panel */}
      {previewName && (
        <div className="card" style={{ marginBottom: 12, maxHeight: 300, display: 'flex', flexDirection: 'column' }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={13} /> {previewName}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{currentPath}/{previewName}</span>
            <button className="icon-btn" onClick={() => { setPreviewContent(null); setPreviewName('') }} style={{ marginLeft: 4 }}>×</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
            {previewLoading ? (
              <div className="loading-container"><div className="spinner" />加载中...</div>
            ) : (
              <pre style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontFamily: "'Cascadia Code', 'Consolas', monospace", lineHeight: 1.6 }}>
                {previewContent}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* File List */}
      <div className="card" style={{ flex: 1, overflow: 'auto', padding: 0 }}>
        <table className="process-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}><input type="checkbox" checked={selectedItems.size === files.length && files.length > 0} onChange={() => {}} onClick={() => {
                if (selectedItems.size === files.length) setSelectedItems(new Set())
                else setSelectedItems(new Set(files.map(f => f.name)))
              }} /></th>
              <th>名称</th>
              <th style={{ width: 80 }}>大小</th>
              <th style={{ width: 100 }}>权限</th>
              <th style={{ width: 120 }}>日期</th>
            </tr>
          </thead>
          <tbody>
            {filteredFiles.map(item => (
              <tr 
                key={item.name}
                onClick={() => openItem(item)}
                style={{ cursor: 'pointer', background: selectedItems.has(item.name) ? 'rgba(0,212,255,0.1)' : undefined }}
              >
                <td onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedItems.has(item.name)} onChange={() => toggleSelect(item.name)} />
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {getFileIcon(item)}
                    <span style={{ color: item.type === 'dir' ? 'var(--accent-warning)' : 'var(--text-primary)' }}>
                      {item.name}
                    </span>
                    {item.type === 'link' && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>→</span>}
                  </div>
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{item.size}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{item.perms}</td>
                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredFiles.length === 0 && !loading && (
          <div className="empty-state" style={{ padding: 40 }}>
            <div className="empty-text">目录为空</div>
          </div>
        )}
        {loading && (
          <div className="loading-container" style={{ padding: 40 }}>
            <div className="spinner" />
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
        {filteredFiles.length} 项 | {files.filter(f => f.type === 'dir').length} 文件夹 | {files.filter(f => f.type === 'file').length} 文件
      </div>
    </div>
  )
}
