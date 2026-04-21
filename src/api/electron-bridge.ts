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
export interface DurationInfo { duration_formatted: string; start_time: string; end_time: string; total_hours: number; format_type: string }
export interface CollectResult extends CmdResult { duration?: DurationInfo | null }

export async function invoke<T = unknown>(channel: string, data?: Record<string, unknown>): Promise<T> {
  return await (window as any).electronAPI.invoke(channel, data) as T;
}

export async function invokeRaw(channel: string, data?: Record<string, unknown>): Promise<unknown> {
  return await (window as any).electronAPI.invoke(channel, data);
}

export async function open(options: { multiple?: boolean; filters?: { name: string; extensions: string[] }[]; defaultPath?: string }): Promise<string | null> {
  return await (window as any).electronAPI.openFile(options);
}

export async function save(options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> {
  return await (window as any).electronAPI.saveFile(options);
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke<{ success: boolean; error?: string }>('write_file', { path, content });
}

// Log stream types and listeners
export interface LogStreamData {
  serial: string;
  line: string;
  type: 'info' | 'error';
}

export function onLogStreamData(callback: (data: LogStreamData) => void) {
  return (window as any).electronAPI.on('log_stream_data', callback);
}

export function onLogStreamClosed(callback: (data: { serial: string; code: number }) => void) {
  return (window as any).electronAPI.on('log_stream_closed', callback);
}
