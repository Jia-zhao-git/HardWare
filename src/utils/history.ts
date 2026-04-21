// Shared history utility - import from any page to record operations
const STORAGE_KEY = 'adb-tools-history'
const MAX_ENTRIES = 500

export interface HistoryEntry {
  id: string
  timestamp: number
  device: string
  category: string
  action: string
  detail: string
  status: 'success' | 'error' | 'info'
}

export function getHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function addHistory(entry: Omit<HistoryEntry, 'id' | 'timestamp'>) {
  const history = getHistory()
  const newEntry: HistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
  }
  history.unshift(newEntry)
  if (history.length > MAX_ENTRIES) history.length = MAX_ENTRIES
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch (error) {
    console.error('保存历史记录失败:', error)
  }
  window.dispatchEvent(new CustomEvent('adb-history-update'))
}
