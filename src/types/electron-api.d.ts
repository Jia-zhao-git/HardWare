// Electron API 类型声明，消除 (window as any).electronAPI 的使用

export interface ElectronAPI {
  invoke: <T = unknown>(channel: string, data?: Record<string, unknown>) => Promise<T>
  openFile: (options: {
    multiple?: boolean
    filters?: { name: string; extensions: string[] }[]
    defaultPath?: string
  }) => Promise<string | null>
  saveFile: (options: {
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }) => Promise<string | null>
  on: (channel: string, callback: (...args: any[]) => void) => () => void
  authStateSubscribe: (callback: (state: any) => void) => () => void
  deviceChangeSubscribe: (callback: (devices: any[]) => void) => () => void
  onAuthDeviceInfoRefresh: (callback: (data: { serial: string }) => void) => () => void
  onScriptOutput: (callback: (data: { serial: string; line: string; type?: 'info' | 'error'; lines: string[] }) => void) => () => void
  onScriptDone: (callback: (data: { serial: string; code: number; lines: string[] }) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
