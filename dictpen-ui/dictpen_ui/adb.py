from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional


class AdbError(RuntimeError):
    pass


@dataclass
class CommandResult:
    args: list[str]
    returncode: int
    stdout: str
    stderr: str

    def check(self) -> "CommandResult":
        if self.returncode != 0:
            cmd = " ".join(self.args)
            raise AdbError(f"Command failed ({self.returncode}): {cmd}\nSTDOUT:\n{self.stdout}\nSTDERR:\n{self.stderr}")
        return self


class Adb:
    def __init__(self, serial: Optional[str] = None, adb_path: str = "adb", timeout: int = 30):
        self.serial = serial
        self.adb_path = adb_path
        self.timeout = timeout

    def _base(self) -> list[str]:
        args = [self.adb_path]
        if self.serial:
            args += ["-s", self.serial]
        return args

    def run(self, args: Iterable[str], timeout: Optional[int] = None, check: bool = True) -> CommandResult:
        cmd = self._base() + list(args)
        proc = subprocess.run(
            cmd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout or self.timeout,
        )
        result = CommandResult(cmd, proc.returncode, proc.stdout, proc.stderr)
        return result.check() if check else result

    def shell(self, command: str, timeout: Optional[int] = None, check: bool = True) -> str:
        return self.run(["shell", command], timeout=timeout, check=check).stdout

    def pull(self, remote: str, local: Path, timeout: Optional[int] = None) -> None:
        local.parent.mkdir(parents=True, exist_ok=True)
        self.run(["pull", remote, str(local)], timeout=timeout or 60)

    def push(self, local: Path, remote: str, timeout: Optional[int] = None) -> None:
        self.run(["push", str(local), remote], timeout=timeout or 60)

    @staticmethod
    def devices(adb_path: str = "adb") -> list[dict[str, str]]:
        proc = subprocess.run([adb_path, "devices", "-l"], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        if proc.returncode != 0:
            raise AdbError(proc.stderr or proc.stdout)
        rows: list[dict[str, str]] = []
        for line in proc.stdout.splitlines()[1:]:
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            serial = parts[0]
            state = parts[1] if len(parts) > 1 else "unknown"
            info = {"serial": serial, "state": state}
            for token in parts[2:]:
                if ":" in token:
                    k, v = token.split(":", 1)
                    info[k] = v
            rows.append(info)
        return rows
