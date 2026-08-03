from __future__ import annotations

import re
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

from .adb import Adb

KEY_PROCESS_PATTERNS = [
    "miniapp", "runDictPen", "guardian_run", "SoundRecord", "SoundPlayer",
    "CaptureFrame", "adbd", "sysconfig-manager", "ota_mgr",
]


@dataclass
class MemSnapshot:
    ts: float = 0.0
    label: str = ""
    mem_total_kb: int = 0
    mem_free_kb: int = 0
    mem_available_kb: int = 0
    mem_used_kb: int = 0
    swap_total_kb: int = 0
    swap_free_kb: int = 0
    swap_used_kb: int = 0
    buffers_kb: int = 0
    cached_kb: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CpuSnapshot:
    ts: float = 0.0
    label: str = ""
    usr: float = 0.0
    sys: float = 0.0
    idle: float = 0.0
    load1: float = 0.0
    load5: float = 0.0
    load15: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProcMemSnapshot:
    ts: float = 0.0
    label: str = ""
    # {proc_name: vsz_kb}
    procs: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"ts": self.ts, "label": self.label, "procs": self.procs}


@dataclass
class ProcessSnapshot:
    ts: float = 0.0
    label: str = ""
    procs: dict[str, int] = field(default_factory=dict)  # name -> pid

    def to_dict(self) -> dict[str, Any]:
        return {"ts": self.ts, "label": self.label, "procs": self.procs}


class DeviceMonitor:
    def __init__(self, adb: Adb):
        self.adb = adb
        self.mem_snapshots: list[MemSnapshot] = []
        self.cpu_snapshots: list[CpuSnapshot] = []
        self.proc_mem_snapshots: list[ProcMemSnapshot] = []
        self.proc_snapshots: list[ProcessSnapshot] = []

    # ------------------------------------------------------------------
    # Memory (from free -k)
    # ------------------------------------------------------------------
    def snapshot_mem(self, label: str = "") -> MemSnapshot:
        raw = self.adb.shell("free -k", check=False)
        s = MemSnapshot(ts=time.time(), label=label)
        for line in raw.splitlines():
            parts = line.split()
            if parts and parts[0].startswith("Mem"):
                # free -k: total used free shared buff/cache available
                try:
                    s.mem_total_kb     = int(parts[1])
                    s.mem_used_kb      = int(parts[2])
                    s.mem_free_kb      = int(parts[3])
                    s.buffers_kb       = int(parts[5]) if len(parts) > 5 else 0
                    s.mem_available_kb = int(parts[6]) if len(parts) > 6 else s.mem_free_kb
                except (IndexError, ValueError):
                    # fallback: parse /proc/meminfo style
                    pass
            elif parts and parts[0].startswith("Swap"):
                try:
                    s.swap_total_kb = int(parts[1])
                    s.swap_used_kb  = int(parts[2])
                    s.swap_free_kb  = int(parts[3])
                except (IndexError, ValueError):
                    pass
        if s.mem_available_kb == 0:
            s.mem_available_kb = s.mem_total_kb - s.mem_used_kb
        self.mem_snapshots.append(s)
        return s

    # ------------------------------------------------------------------
    # CPU + load average (from top -b -n1 header + /proc/loadavg)
    # ------------------------------------------------------------------
    def snapshot_cpu(self, label: str = "") -> CpuSnapshot:
        raw_top = self.adb.shell("top -b -n 1 2>/dev/null | head -5", check=False)
        raw_load = self.adb.shell("cat /proc/loadavg", check=False).strip()
        s = CpuSnapshot(ts=time.time(), label=label)
        # CPU line: CPU:  0.0% usr  9.0% sys ... 90.9% idle
        for line in raw_top.splitlines():
            if line.startswith("CPU"):
                m_usr  = re.search(r"([\d.]+)%\s*usr",  line)
                m_sys  = re.search(r"([\d.]+)%\s*sys",  line)
                m_idle = re.search(r"([\d.]+)%\s*idle", line)
                if m_usr:  s.usr  = float(m_usr.group(1))
                if m_sys:  s.sys  = float(m_sys.group(1))
                if m_idle: s.idle = float(m_idle.group(1))
                break
        # loadavg: 1min 5min 15min running/total lastpid
        parts = raw_load.split()
        if len(parts) >= 3:
            try:
                s.load1  = float(parts[0])
                s.load5  = float(parts[1])
                s.load15 = float(parts[2])
            except ValueError:
                pass
        self.cpu_snapshots.append(s)
        return s

    # ------------------------------------------------------------------
    # Per-process memory (VSZ) from top
    # ------------------------------------------------------------------
    def snapshot_proc_mem(self, label: str = "") -> ProcMemSnapshot:
        raw = self.adb.shell("top -b -n 1 2>/dev/null | tail -n +5", check=False)
        s = ProcMemSnapshot(ts=time.time(), label=label)
        for line in raw.splitlines():
            parts = line.split()
            # top columns: PID PPID USER STAT VSZ %VSZ CPU %CPU COMMAND
            if len(parts) < 9:
                continue
            try:
                vsz_str = parts[4]
                cmd = parts[8].split("/")[-1][:24]
                vsz_kb = _parse_vsz(vsz_str)
                for pat in KEY_PROCESS_PATTERNS:
                    if pat in parts[8]:
                        s.procs[cmd] = vsz_kb
                        break
            except (ValueError, IndexError):
                continue
        self.proc_mem_snapshots.append(s)
        return s

    # ------------------------------------------------------------------
    # Process PID snapshot
    # ------------------------------------------------------------------
    def snapshot_procs(self, label: str = "") -> ProcessSnapshot:
        raw = self.adb.shell("ps", check=False)
        snap = ProcessSnapshot(ts=time.time(), label=label)
        for line in raw.splitlines():
            parts = line.split()
            if len(parts) < 5:
                continue
            pid_str, cmd = parts[0], parts[-1]
            try:
                pid = int(pid_str)
            except ValueError:
                continue
            for pattern in KEY_PROCESS_PATTERNS:
                if pattern in cmd:
                    name = cmd.split("/")[-1][:32]
                    snap.procs[name] = pid
                    break
        self.proc_snapshots.append(snap)
        return snap

    # ------------------------------------------------------------------
    # Full snapshot (all in one call, used per step)
    # ------------------------------------------------------------------
    def full_snapshot(self, label: str = "") -> dict[str, Any]:
        mem = self.snapshot_mem(label)
        cpu = self.snapshot_cpu(label)
        self.snapshot_proc_mem(label)
        return {"mem": mem.to_dict(), "cpu": cpu.to_dict()}

    # ------------------------------------------------------------------
    # Analysis helpers
    # ------------------------------------------------------------------
    def check_crashes(self) -> list[dict[str, Any]]:
        if len(self.proc_snapshots) < 2:
            return []
        first = self.proc_snapshots[0]
        last  = self.proc_snapshots[-1]
        issues: list[dict[str, Any]] = []
        for name, pid in first.procs.items():
            if name not in last.procs:
                issues.append({"proc": name, "issue": "disappeared", "original_pid": pid})
            elif last.procs[name] != pid:
                issues.append({"proc": name, "issue": "restarted",
                                "original_pid": pid, "new_pid": last.procs[name]})
        return issues

    def mem_series(self) -> list[dict[str, Any]]:
        return [s.to_dict() for s in self.mem_snapshots]

    def cpu_series(self) -> list[dict[str, Any]]:
        return [s.to_dict() for s in self.cpu_snapshots]

    def proc_mem_series(self) -> list[dict[str, Any]]:
        return [s.to_dict() for s in self.proc_mem_snapshots]

    def proc_series(self) -> list[dict[str, Any]]:
        return [s.to_dict() for s in self.proc_snapshots]


def _parse_vsz(s: str) -> int:
    """Parse VSZ field like '744m', '166m', '5676' → KB."""
    s = s.strip()
    if s.endswith("m"):
        return int(float(s[:-1]) * 1024)
    if s.endswith("g"):
        return int(float(s[:-1]) * 1024 * 1024)
    return int(s)
