// Typed invoke for Electron IPC
export interface CmdResult { success: boolean; output: string; error?: string | null; base64?: string }
export interface AdbDevice { serial: string; state: string; model?: string }
export interface DeviceInfo { 
  serial: string; 
  sku: string;
  version: string;
  partition: string;
  current_slot: string;
  battery: string; 
  memory_mb: number | string; 
  cpu_usage: string; 
  ip: string;
}
export interface PerformanceData {
  battery_capacity: number; battery_voltage: number; battery_current: number
  cpu_temp: number; battery_temp: number; cpu_usr: string; cpu_sys: string; cpu_idle: string
  mem_available: number; mem_free: number; mem_buffers: number; mem_cached: number
  miniapp_vmrss: number; miniapp_threads: number; miniapp_pid?: number
  soundplayer_vmrss: number; soundplayer_threads: number; soundplayer_pid?: number
  captureframe_vmrss: number; captureframe_threads: number; captureframe_pid?: number
  soundrecord_vmrss: number; soundrecord_threads: number; soundrecord_pid?: number
}
export interface AppVersion { appid: string; name: string; version: string }
export interface AuthResult { success: boolean; message: string; key_index?: number | null; cached: boolean }

// Auto auth types
export interface AuthState { serial: string; trying: boolean; current: number; total: number; success: boolean; found: boolean }

// Auto auth IPC helpers
export function authAutoStartIPC(serial: string) {
  return invoke<{ success: boolean }>('auth_auto_start', { serial });
}
export function authAutoStopIPC(serial: string) {
  return invoke<{ success: boolean }>('auth_auto_stop', { serial });
}
export function authAutoStatus(serial: string) {
  return invoke<AuthState>('auth_auto_status', { serial });
}
export function authStateSubscribe(callback: (state: AuthState) => void): () => void {
  return window.electronAPI.authStateSubscribe(callback);
}

// Device change subscribe (track-devices 实时设备变化)
export function deviceChangeSubscribe(callback: (devices: AdbDevice[]) => void): () => void {
  return window.electronAPI.deviceChangeSubscribe(callback);
}

// Auth success → refresh device info 通知
export function onAuthDeviceInfoRefresh(callback: (data: { serial: string }) => void): () => void {
  return window.electronAPI.onAuthDeviceInfoRefresh(callback);
}
export interface DurationInfo { duration_formatted: string; start_time: string; end_time: string; total_hours: number; format_type: string }
export interface CollectResult extends CmdResult { duration?: DurationInfo | null }

export async function invoke<T = unknown>(channel: string, data?: Record<string, unknown>): Promise<T> {
  return await window.electronAPI.invoke<T>(channel, data);
}

export async function invokeRaw(channel: string, data?: Record<string, unknown>): Promise<unknown> {
  return await window.electronAPI.invoke(channel, data);
}

export async function open(options: { multiple?: boolean; filters?: { name: string; extensions: string[] }[]; defaultPath?: string; properties?: string[] }): Promise<string | null> {
  return await window.electronAPI.openFile(options);
}

export async function save(options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> {
  return await window.electronAPI.saveFile(options);
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke<{ success: boolean; error?: string }>('write_file', { path, content });
}

export async function readTextFile(path: string): Promise<string> {
  const result = await invoke<{ success: boolean; content?: string; error?: string }>('read_file', { path });
  if (!result.success || !result.content) {
    throw new Error(result.error || 'Failed to read file');
  }
  return result.content;
}

// Log stream types and listeners
export interface LogStreamData {
  serial: string;
  line: string;
  type: 'info' | 'error';
}

export function onLogStreamData(callback: (data: LogStreamData) => void) {
  return window.electronAPI.on('log_stream_data', callback);
}

export function onLogStreamClosed(callback: (data: { serial: string; code: number }) => void) {
  return window.electronAPI.on('log_stream_closed', callback);
}

// Script editor event types
export interface ScriptOutputData { serial: string; line: string; type?: 'info' | 'error'; lines: string[] }
export interface ScriptDoneData { serial: string; code: number; lines: string[] }

export function onScriptOutput(callback: (data: ScriptOutputData) => void): () => void {
  return window.electronAPI.onScriptOutput(callback);
}

export function onScriptDone(callback: (data: ScriptDoneData) => void): () => void {
  return window.electronAPI.onScriptDone(callback);
}
